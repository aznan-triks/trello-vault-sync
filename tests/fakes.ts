import { parseCardRef, formatCardRef, type CardRef } from "../src/core/cardRef";
import { excludeFolders } from "../src/core/fileName";
import { splitFrontmatter } from "../src/core/noteBody";
import type { CardRefStore, NoteHandle, Reporter, TemplateResolver, VaultGateway } from "../src/obsidian/gateway";
import { TrelloClient, type HttpRequest, type HttpResponse, type TrelloCard } from "../src/trello/client";

/** In-memory vault, faithful enough to exercise the engines end to end. */
export class FakeVault implements VaultGateway, CardRefStore, TemplateResolver {
	private files = new Map<string, { content: string; mtime: number }>();
	readonly templates = new Map<string, string>();
	readonly trashed: string[] = [];
	/** Binary files (attachments), tracked separately from notes — path -> byte size, matching what `binarySize` needs. */
	private binaries = new Map<string, number>();

	constructor(files: Record<string, { content: string; mtime?: number }> = {}) {
		for (const [path, file] of Object.entries(files)) {
			this.files.set(path, { content: file.content, mtime: file.mtime ?? 0 });
		}
	}

	private handle(path: string): NoteHandle {
		const file = this.files.get(path);
		if (!file) throw new Error(`missing file ${path}`);
		const segments = path.split("/");
		return {
			path,
			basename: (segments.pop() ?? "").replace(/\.md$/, ""),
			folder: segments.join("/"),
			mtime: file.mtime,
		};
	}

	listNotes(folder: string, excludedFolders: string[] = []): NoteHandle[] {
		const handles = [...this.files.keys()]
			.filter((path) => folder === "" || path.startsWith(`${folder}/`))
			.sort()
			.map((path) => this.handle(path));
		return excludeFolders(handles, excludedFolders);
	}

	noteAt(path: string): NoteHandle | null {
		return this.files.has(path) ? this.handle(path) : null;
	}

	note(path: string): NoteHandle {
		return this.handle(path);
	}

	contentOf(path: string): string {
		return this.files.get(path)?.content ?? "";
	}

	paths(): string[] {
		return [...this.files.keys()].sort();
	}

	getCardRef(note: NoteHandle): CardRef | null {
		const frontmatter = splitFrontmatter(this.contentOf(note.path)).frontmatter ?? "";
		const match = frontmatter.match(/trello_board_card_id:\s*"?([^"\n]*)"?/);
		return parseCardRef(match?.[1]);
	}

	/** One frontmatter scalar, parsed from its raw (already-trimmed) text form. */
	private parseScalar(raw: string): unknown {
		const quoted = raw.match(/^"(.*)"$/);
		if (quoted) return quoted[1];
		if (raw === "true") return true;
		if (raw === "false") return false;
		if (raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
		return raw;
	}

	/** One array item, parsed the same way this class always has: unquote if quoted, otherwise keep the literal string — no bool/number coercion (every array-valued key here — labels, members, attachments — is a string list; `serializeEntry` always quotes them on the way out anyway). */
	private parseArrayItem(raw: string): unknown {
		const quoted = raw.match(/^"(.*)"$/);
		return quoted ? quoted[1] : raw;
	}

	/**
	 * Minimal `key: value` YAML parsing — enough for what the generic
	 * frontmatter tests need: a block list (`key:` then `  - "item"` lines) for
	 * array-valued keys, and one level of nested `key:` then `  sub: value`
	 * lines for an object-valued key (the custom-fields feature's shape).
	 */
	private parseFrontmatterBlock(block: string): Record<string, unknown> {
		const lines = block.replace(/\r\n/g, "\n").split("\n").slice(1, -1);
		const result: Record<string, unknown> = {};
		let i = 0;
		while (i < lines.length) {
			const line = lines[i] ?? "";
			const match = line.match(/^([^:]+):\s*(.*)$/);
			if (!match) {
				i++;
				continue;
			}
			const key = (match[1] ?? "").trim();
			const raw = (match[2] ?? "").trim();
			if (raw !== "") {
				result[key] = this.parseScalar(raw);
				i++;
				continue;
			}

			const next = lines[i + 1] ?? "";
			if (/^\s*-\s*/.test(next)) {
				const items: unknown[] = [];
				i++;
				let itemMatch: RegExpMatchArray | null;
				while (i < lines.length && (itemMatch = (lines[i] ?? "").match(/^\s*-\s*(.*)$/))) {
					items.push(this.parseArrayItem((itemMatch[1] ?? "").trim()));
					i++;
				}
				result[key] = items;
				continue;
			}
			if (/^\s{2}\S[^:]*:\s*/.test(next)) {
				const nested: Record<string, unknown> = {};
				i++;
				let subMatch: RegExpMatchArray | null;
				while (i < lines.length && (subMatch = (lines[i] ?? "").match(/^\s{2}([^:]+):\s*(.*)$/))) {
					nested[(subMatch[1] ?? "").trim()] = this.parseScalar((subMatch[2] ?? "").trim());
					i++;
				}
				result[key] = nested;
				continue;
			}
			result[key] = [];
			i++;
		}
		return result;
	}

	/** One frontmatter entry's serialized lines — recurses one level for an object value (never deeper, matching `parseFrontmatterBlock`). */
	private serializeEntry(key: string, value: unknown, indent: string): string[] {
		if (Array.isArray(value)) {
			return value.length === 0
				? [`${indent}${key}: []`]
				: [`${indent}${key}:`, ...value.map((entry) => `${indent}  - "${entry}"`)];
		}
		if (value !== null && typeof value === "object") {
			const entries = Object.entries(value as Record<string, unknown>);
			return entries.length === 0
				? [`${indent}${key}: {}`]
				: [`${indent}${key}:`, ...entries.flatMap(([k, v]) => this.serializeEntry(k, v, `${indent}  `))];
		}
		return [typeof value === "string" ? `${indent}${key}: "${value}"` : `${indent}${key}: ${value}`];
	}

	private serializeFrontmatterBlock(frontmatter: Record<string, unknown>): string {
		const lines = Object.entries(frontmatter).flatMap(([key, value]) => this.serializeEntry(key, value, ""));
		return `---\n${lines.join("\n")}\n---`;
	}

	readFrontmatter(note: NoteHandle): Record<string, unknown> | null {
		const { frontmatter } = splitFrontmatter(this.contentOf(note.path));
		return frontmatter === null ? null : this.parseFrontmatterBlock(frontmatter);
	}

	async writeFrontmatter(note: NoteHandle, mutate: (frontmatter: Record<string, unknown>) => void): Promise<void> {
		const content = this.contentOf(note.path);
		const { frontmatter, body } = splitFrontmatter(content);
		const parsed = frontmatter === null ? {} : this.parseFrontmatterBlock(frontmatter);
		mutate(parsed);
		const block = this.serializeFrontmatterBlock(parsed);
		const next = frontmatter === null ? `${block}\n\n${content}` : `${block}${body}`;
		await this.write(note, next);
	}

	async setCardRef(note: NoteHandle, ref: CardRef): Promise<void> {
		const content = this.contentOf(note.path);
		const line = `trello_board_card_id: "${formatCardRef(ref.boardId, ref.cardId)}"`;
		const { frontmatter, body } = splitFrontmatter(content);
		const next =
			frontmatter === null
				? `---\n${line}\n---\n\n${content}`
				: `${frontmatter.slice(0, -3)}${line}\n---${body}`;
		await this.write(note, next);
	}

	async read(note: NoteHandle): Promise<string> {
		return this.contentOf(note.path);
	}

	async write(note: NoteHandle, content: string): Promise<void> {
		const previous = this.files.get(note.path);
		this.files.set(note.path, { content, mtime: (previous?.mtime ?? 0) + 1 });
	}

	async rename(note: NoteHandle, newPath: string): Promise<NoteHandle> {
		const file = this.files.get(note.path);
		if (!file) throw new Error(`missing file ${note.path}`);
		this.files.delete(note.path);
		this.files.set(newPath, file);
		return this.handle(newPath);
	}

	async create(path: string, content: string): Promise<NoteHandle> {
		if (this.files.has(path)) throw new Error(`already exists: ${path}`);
		this.files.set(path, { content, mtime: 0 });
		return this.handle(path);
	}

	async trash(note: NoteHandle): Promise<void> {
		this.files.delete(note.path);
		this.trashed.push(note.path);
	}

	exists(path: string): boolean {
		return this.files.has(path);
	}

	async readTemplate(name: string): Promise<string | null> {
		return this.templates.get(name) ?? null;
	}

	binarySize(path: string): number | null {
		return this.binaries.get(path) ?? null;
	}

	async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
		this.binaries.set(path, data.byteLength);
	}
}

export function card(partial: Partial<TrelloCard> & { id: string }): TrelloCard {
	return {
		idBoard: "board",
		name: partial.id,
		desc: "",
		url: `https://trello.com/c/${partial.id}`,
		dateLastActivity: "2026-08-01T00:00:00.000Z",
		due: null,
		labels: [],
		...partial,
	};
}

/** Transport returning canned payloads keyed by a url fragment. */
export function routedTransport(routes: Record<string, unknown>) {
	const requests: HttpRequest[] = [];
	const transport = async (request: HttpRequest): Promise<HttpResponse> => {
		requests.push(request);
		if (request.method !== "GET") return { status: 200, text: "{}" };
		for (const [fragment, payload] of Object.entries(routes)) {
			if (request.url.includes(fragment)) {
				return { status: 200, text: JSON.stringify(payload) };
			}
		}
		return { status: 404, text: "no route" };
	};
	return { transport, requests };
}

export const at = (iso: string): number => new Date(iso).getTime();

/** A reporter that keeps every logged line, so a test can assert on it. */
export function recordingReporter(): Reporter & { logs: Array<{ level: string; message: string }> } {
	const logs: Array<{ level: string; message: string }> = [];
	return {
		logs,
		setTotal: () => {},
		step: () => {},
		count: () => {},
		log: (level, message) => logs.push({ level, message }),
		finish: () => {},
	};
}

/** A client wired to a fake board's cards, lists and actions, plus the requests it made. */
export function clientFor(
	cards: unknown[],
	lists: unknown[] = [{ id: "l1", name: "Idées" }],
	actions: unknown[] = [],
) {
	const { transport, requests } = routedTransport({
		"/boards/board/cards": cards,
		"/boards/board/lists": lists,
		"/boards/board/actions": actions,
	});
	return { client: new TrelloClient({ apiKey: "k", token: "t" }, transport), requests };
}
