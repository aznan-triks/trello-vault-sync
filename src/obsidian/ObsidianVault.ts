import { TFile, type App } from "obsidian";
import { formatCardRef, parseCardRef, type CardRef } from "../core/cardRef";
import type { NoteHandle, VaultGateway } from "./gateway";

/** Frontmatter key the vault has always used to point at a Trello card. */
export const CARD_REF_KEY = "trello_board_card_id";

/** The real vault, behind the interface the engines depend on. */
export class ObsidianVault implements VaultGateway {
	private readonly handles = new WeakMap<TFile, NoteHandle>();

	constructor(private readonly app: App) {}

	private toHandle(file: TFile): NoteHandle {
		const handle: NoteHandle = {
			path: file.path,
			basename: file.basename,
			folder: file.parent?.path === "/" ? "" : (file.parent?.path ?? ""),
			mtime: file.stat.mtime,
		};
		this.handles.set(file, handle);
		return handle;
	}

	private toFile(note: NoteHandle): TFile {
		const file = this.app.vault.getAbstractFileByPath(note.path);
		if (!(file instanceof TFile)) throw new Error(`Note not found: ${note.path}`);
		return file;
	}

	listNotes(folder: string): NoteHandle[] {
		const prefix = folder === "" || folder === "/" ? "" : `${folder.replace(/\/$/, "")}/`;
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => prefix === "" || file.path.startsWith(prefix))
			.sort((a, b) => a.path.localeCompare(b.path))
			.map((file) => this.toHandle(file));
	}

	/** Handle for a single path, without walking the whole vault. */
	noteAt(path: string): NoteHandle | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? this.toHandle(file) : null;
	}

	getCardRef(note: NoteHandle): CardRef | null {
		const cache = this.app.metadataCache.getFileCache(this.toFile(note));
		return parseCardRef(cache?.frontmatter?.[CARD_REF_KEY]);
	}

	async setCardRef(note: NoteHandle, ref: CardRef): Promise<void> {
		// processFrontMatter round-trips the YAML properly — no string surgery.
		await this.app.fileManager.processFrontMatter(this.toFile(note), (frontmatter) => {
			frontmatter[CARD_REF_KEY] = formatCardRef(ref.boardId, ref.cardId);
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
		// Obsidian's own trash, so the user can undo from inside the vault.
		await this.app.vault.trash(this.toFile(note), false);
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
