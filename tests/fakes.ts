import { parseCardRef, formatCardRef, type CardRef } from "../src/core/cardRef";
import { excludeFolders } from "../src/core/fileName";
import { splitFrontmatter } from "../src/core/noteBody";
import type { NoteHandle, Reporter, VaultGateway } from "../src/obsidian/gateway";
import { TrelloClient, type HttpRequest, type HttpResponse, type TrelloCard } from "../src/trello/client";

/** In-memory vault, faithful enough to exercise the engines end to end. */
export class FakeVault implements VaultGateway {
	private files = new Map<string, { content: string; mtime: number }>();
	readonly templates = new Map<string, string>();
	readonly trashed: string[] = [];

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
}

export function card(partial: Partial<TrelloCard> & { id: string }): TrelloCard {
	return {
		idBoard: "board",
		name: partial.id,
		desc: "",
		url: `https://trello.com/c/${partial.id}`,
		dateLastActivity: "2026-08-01T00:00:00.000Z",
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

/** A client wired to a fake board's cards and lists, plus the requests it made. */
export function clientFor(cards: unknown[], lists: unknown[] = [{ id: "l1", name: "Idées" }]) {
	const { transport, requests } = routedTransport({
		"/boards/board/cards": cards,
		"/boards/board/lists": lists,
	});
	return { client: new TrelloClient({ apiKey: "k", token: "t" }, transport), requests };
}
