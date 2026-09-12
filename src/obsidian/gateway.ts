import type { CardRef } from "../core/cardRef";
import type { LogLevel } from "../core/journal";

/** A note, reduced to what the sync engines need. Mirrors Obsidian's `TFile`. */
export interface NoteHandle {
	path: string;
	basename: string;
	/** Parent folder path, "" at the vault root. */
	folder: string;
	/** Modification time, epoch ms. */
	mtime: number;
}

/**
 * Generic file IO the engines are allowed to do to the vault, plus generic
 * frontmatter access — independent of any Trello concept or template concern.
 *
 * Keeping this an interface is what lets the sync logic run against an in-memory
 * vault in the tests, and against Obsidian at runtime, with no branching.
 */
export interface VaultGateway {
	/** Markdown notes under `folder` ("" = whole vault), minus any under `excludedFolders`, in a stable order. */
	listNotes(folder: string, excludedFolders?: string[]): NoteHandle[];
	/** Handle for a single known path, without walking the whole vault. `null` if missing. */
	noteAt(path: string): NoteHandle | null;
	read(note: NoteHandle): Promise<string>;
	write(note: NoteHandle, content: string): Promise<void>;
	rename(note: NoteHandle, newPath: string): Promise<NoteHandle>;
	create(path: string, content: string): Promise<NoteHandle>;
	trash(note: NoteHandle): Promise<void>;
	exists(path: string): boolean;
	/** The note's frontmatter fields, or `null` when it has none. */
	readFrontmatter(note: NoteHandle): Record<string, unknown> | null;
	/** Mutate the note's frontmatter in place; created if missing. */
	writeFrontmatter(note: NoteHandle, mutate: (frontmatter: Record<string, unknown>) => void): Promise<void>;

	/** Byte size of a binary file (an attachment, not a note) at `path`, or `null` if missing — cheap enough to call once per attachment to decide whether a download is a no-op. */
	binarySize(path: string): number | null;
	/** Writes bytes to `path` (an attachment, not a note), creating parent folders as needed — replaces the file if one is already there. */
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
}

/** The Trello card concept, kept out of `VaultGateway` so generic-IO consumers never see it. */
export interface CardRefStore {
	/** The card this note points at, or `null` when unlinked or unusable. */
	getCardRef(note: NoteHandle): CardRef | null;
	/** Write the card reference into the note's frontmatter. */
	setCardRef(note: NoteHandle, ref: CardRef): Promise<void>;
}

/** Template lookup, kept out of `VaultGateway` so consumers that never create notes don't see it. */
export interface TemplateResolver {
	/** Content of a template note by name, or `null` when it is missing. */
	readTemplate(name: string): Promise<string | null>;
}

/** Progress and log sink. The UI panel implements it; tests use a silent one. */
export interface Reporter {
	setTotal(total: number): void;
	step(label: string): void;
	count(key: string, value: number): void;
	log(level: LogLevel, message: string): void;
	finish(outcome: "done" | "aborted" | "error", summary: string): void;
}

/** Reporter that swallows everything — default for headless calls and tests. */
export const silentReporter: Reporter = {
	setTotal: () => {},
	step: () => {},
	count: () => {},
	log: () => {},
	finish: () => {},
};
