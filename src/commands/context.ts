import type { App } from "obsidian";
import type { JournalEntry } from "../core/journal";
import type { SyncAction, SyncRun } from "../core/syncHistory";
import type { AuditOptions } from "../features/auditShared";
import type { FolderSyncOptions } from "../features/syncFolder";
import type { NoteSyncOptions } from "../features/syncNote";
import type { CardRefStore, NoteHandle, Reporter, TemplateResolver, VaultGateway } from "../obsidian/gateway";
import type { TrelloVaultSyncSettings } from "../settings/types";
import type { TrelloClient } from "../trello/client";

/**
 * Everything a command handler needs from the plugin, without depending on the
 * `Plugin` subclass itself — lets `src/commands/*.ts` stay about "what a command
 * does" instead of "how the plugin is wired".
 */
export interface CommandContext {
	readonly app: App;
	readonly vault: VaultGateway & CardRefStore & TemplateResolver;
	readonly settings: TrelloVaultSyncSettings;
	/** In-memory log history, oldest first, capped — survives the floating panel closing. */
	readonly journal: readonly JournalEntry[];
	/** Completed sync runs, oldest first, capped at `settings.historyMaxRuns` — feeds "Show sync history" / "Undo last sync run". */
	readonly history: readonly SyncRun[];
	/** Appends a completed run's actions to `history` (a no-op when `actions` is empty) and persists. */
	recordSyncRun(scope: string, actions: SyncAction[]): Promise<void>;
	/** Replaces `history` wholesale — how "Undo last sync run"/"Undo last sync for the active note" consume a run after applying it. */
	setHistory(next: readonly SyncRun[]): Promise<void>;
	client(reporter?: Reporter): TrelloClient;
	/** Downloads a url's bytes — `null` on anything short of success. `redactFrom` masks secrets out of a failure's console warning, for an authenticated attachment url (see `TrelloClient.authenticatedAttachmentUrl`); omitted for a public url (a Trello avatar) with nothing to redact. */
	fetchBinary(url: string, signal?: AbortSignal, redactFrom?: (text: string) => string): Promise<ArrayBuffer | null>;
	run(
		title: string,
		body: (reporter: Reporter, signal: AbortSignal) => Promise<string>,
		opts?: { cancellable?: boolean },
	): Promise<void>;
	activeNote(): NoteHandle | null;
	/** Whether a sync (manual or auto) is already running — the single-sync-at-a-time lock `run()` enforces. */
	isSyncing(): boolean;
	ready(needsBoard?: boolean): boolean;
	noteOptions(force?: "pull" | "push"): NoteSyncOptions;
	folderOptions(force?: "pull" | "push"): FolderSyncOptions;
	auditOptions(): AuditOptions;
	saveSettings(): Promise<void>;
}
