import { TFile, getFrontMatterInfo, parseYaml, type App, type DataWriteOptions } from "obsidian";
import {
	DEFAULT_CARD_REF_KEY,
	DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY,
	formatCardRef,
	newPluginNoteId,
	parseCardRef,
	type CardRef,
} from "../core/cardRef";
import { excludeFolders, notesInFolder } from "../core/fileName";
import type { CardRefStore, NoteHandle, TemplateResolver, VaultGateway, WriteOptions } from "./gateway";

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
		private readonly getWritePluginNoteId: () => boolean = () => false,
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

	async writeFrontmatter(
		note: NoteHandle,
		mutate: (frontmatter: Record<string, unknown>) => void,
		options?: WriteOptions,
	): Promise<void> {
		// processFrontMatter round-trips the YAML properly — no string surgery.
		// Obsidian types the callback parameter as `any`; it always hands over the
		// parsed YAML mapping, so the conversion happens once, here, explicitly.
		const file = this.toFile(note);
		const writeOptions: DataWriteOptions | undefined = options?.keepMtime ? { mtime: file.stat.mtime } : undefined;
		await this.app.fileManager.processFrontMatter(
			file,
			(frontmatter: unknown) => {
				mutate(frontmatter as Record<string, unknown>);
			},
			writeOptions,
		);
	}

	getCardRef(note: NoteHandle): CardRef | null {
		return parseCardRef(this.readFrontmatter(note)?.[this.getCardRefKey()]);
	}

	async setCardRef(note: NoteHandle, ref: CardRef): Promise<void> {
		const key = this.getCardRefKey();
		await this.writeFrontmatter(
			note,
			(frontmatter) => {
				frontmatter[key] = formatCardRef(ref.boardId, ref.cardId);
				this.addPluginNoteId(frontmatter);
			},
			{ keepMtime: true },
		);
	}

	/** Adds the "Trello" plugin's per-note id when the option is on and the note has none yet. */
	private addPluginNoteId(frontmatter: Record<string, unknown>): void {
		if (!this.getWritePluginNoteId()) return;
		if (typeof frontmatter[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY] === "string") return;
		frontmatter[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY] = newPluginNoteId();
	}

	async read(note: NoteHandle): Promise<string> {
		return this.app.vault.read(this.toFile(note));
	}

	async write(note: NoteHandle, content: string, options?: WriteOptions): Promise<void> {
		const file = this.toFile(note);
		const writeOptions: DataWriteOptions | undefined = options?.keepMtime ? { mtime: file.stat.mtime } : undefined;
		await this.app.vault.modify(file, content, writeOptions);
	}

	async rename(note: NoteHandle, newPath: string): Promise<NoteHandle> {
		const file = this.toFile(note);
		// Moving a note to a mapped folder that doesn't exist yet (a new mapping, or a folder the user
		// typed by hand) failed with ENOENT: `renameFile` doesn't create the parent folder, `create` does.
		await this.ensureParentFolder(newPath);
		await this.app.fileManager.renameFile(file, newPath);
		return this.toHandle(file);
	}

	/** Creates `path`'s parent folder if it doesn't exist yet — shared by `create` and `writeBinary`. */
	private async ensureParentFolder(path: string): Promise<void> {
		const folder = path.split("/").slice(0, -1).join("/");
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}
	}

	async create(path: string, content: string): Promise<NoteHandle> {
		await this.ensureParentFolder(path);
		const handle = this.toHandle(await this.app.vault.create(path, content));
		if (this.getWritePluginNoteId() && this.carriesCardRef(content)) {
			await this.writeFrontmatter(handle, (frontmatter) => this.addPluginNoteId(frontmatter));
		}
		return handle;
	}

	/** Reads the YAML straight from the content: the metadata cache isn't ready right after `create`. */
	private carriesCardRef(content: string): boolean {
		const info = getFrontMatterInfo(content);
		if (!info.exists) return false;
		const parsed: unknown = parseYaml(info.frontmatter);
		const raw = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)[this.getCardRefKey()] : undefined;
		return parseCardRef(raw) !== null;
	}

	async trash(note: NoteHandle): Promise<void> {
		// Obsidian's own deletion path, so it stays recoverable and follows the
		// user's "Deleted files" preference instead of forcing one destination.
		await this.app.fileManager.trashFile(this.toFile(note));
	}

	exists(path: string): boolean {
		return this.app.vault.getAbstractFileByPath(path) !== null;
	}

	binarySize(path: string): number | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file.stat.size : null;
	}

	async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
		await this.ensureParentFolder(path);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, data);
		else await this.app.vault.createBinary(path, data);
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
