import { TFile, type App } from "obsidian";
import { DEFAULT_CARD_REF_KEY, formatCardRef, parseCardRef, type CardRef } from "../core/cardRef";
import { excludeFolders, notesInFolder } from "../core/fileName";
import type { CardRefStore, NoteHandle, TemplateResolver, VaultGateway } from "./gateway";

/** The real vault, behind the interfaces the engines depend on. */
export class ObsidianVault implements VaultGateway, CardRefStore, TemplateResolver {
	/**
	 * `getCardRefKey` is a live accessor, not a value captured once — the
	 * plugin's own settings object is mutated in place (a settings-tab save
	 * never replaces it), so reading through a closure keeps this in sync with
	 * the current setting without this class knowing about `TrelloVaultSyncSettings`.
	 */
	constructor(
		private readonly app: App,
		private readonly getCardRefKey: () => string = () => DEFAULT_CARD_REF_KEY,
	) {}

	private toHandle(file: TFile): NoteHandle {
		return {
			path: file.path,
			basename: file.basename,
			folder: file.parent?.path === "/" ? "" : (file.parent?.path ?? ""),
			mtime: file.stat.mtime,
		};
	}

	private toFile(note: NoteHandle): TFile {
		const file = this.app.vault.getAbstractFileByPath(note.path);
		if (!(file instanceof TFile)) throw new Error(`Note not found: ${note.path}`);
		return file;
	}

	listNotes(folder: string, excludedFolders: string[] = []): NoteHandle[] {
		const handles = this.app.vault.getMarkdownFiles().map((file) => this.toHandle(file));
		return excludeFolders(notesInFolder(handles, folder), excludedFolders).sort((a, b) =>
			a.path.localeCompare(b.path),
		);
	}

	/** Handle for a single path, without walking the whole vault. */
	noteAt(path: string): NoteHandle | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? this.toHandle(file) : null;
	}

	readFrontmatter(note: NoteHandle): Record<string, unknown> | null {
		const cache = this.app.metadataCache.getFileCache(this.toFile(note));
		return cache?.frontmatter ?? null;
	}

	async writeFrontmatter(note: NoteHandle, mutate: (frontmatter: Record<string, unknown>) => void): Promise<void> {
		// processFrontMatter round-trips the YAML properly — no string surgery.
		// Obsidian types the callback parameter as `any`; it always hands over the
		// parsed YAML mapping, so the conversion happens once, here, explicitly.
		await this.app.fileManager.processFrontMatter(this.toFile(note), (frontmatter: unknown) => {
			mutate(frontmatter as Record<string, unknown>);
		});
	}

	getCardRef(note: NoteHandle): CardRef | null {
		return parseCardRef(this.readFrontmatter(note)?.[this.getCardRefKey()]);
	}

	async setCardRef(note: NoteHandle, ref: CardRef): Promise<void> {
		const key = this.getCardRefKey();
		await this.writeFrontmatter(note, (frontmatter) => {
			frontmatter[key] = formatCardRef(ref.boardId, ref.cardId);
		});
	}

	async read(note: NoteHandle): Promise<string> {
		return this.app.vault.read(this.toFile(note));
	}

	async write(note: NoteHandle, content: string): Promise<void> {
		await this.app.vault.modify(this.toFile(note), content);
	}

	async rename(note: NoteHandle, newPath: string): Promise<NoteHandle> {
		const file = this.toFile(note);
		await this.app.fileManager.renameFile(file, newPath);
		return this.toHandle(file);
	}

	async create(path: string, content: string): Promise<NoteHandle> {
		const folder = path.split("/").slice(0, -1).join("/");
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}
		return this.toHandle(await this.app.vault.create(path, content));
	}

	async trash(note: NoteHandle): Promise<void> {
		// Obsidian's own deletion path, so it stays recoverable and follows the
		// user's "Deleted files" preference instead of forcing one destination.
		await this.app.fileManager.trashFile(this.toFile(note));
	}

	exists(path: string): boolean {
		return this.app.vault.getAbstractFileByPath(path) !== null;
	}

	async readTemplate(name: string): Promise<string | null> {
		const wanted = name.endsWith(".md") ? name : `${name}.md`;
		const file =
			this.app.vault.getAbstractFileByPath(wanted) ??
			this.app.vault.getMarkdownFiles().find((candidate) => candidate.name === wanted) ??
			null;
		return file instanceof TFile ? this.app.vault.read(file) : null;
	}
}
