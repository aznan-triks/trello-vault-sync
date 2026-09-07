import type { App } from "obsidian";
import type { JournalEntry } from "../core/journal";
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
	client(reporter?: Reporter): TrelloClient;
	/** Downloads a public url (a Trello avatar, not the authenticated API) — `null` on anything short of success. */
	fetchBinary(url: string, signal?: AbortSignal): Promise<ArrayBuffer | null>;
	run(
		title: string,
		body: (reporter: Reporter, signal: AbortSignal) => Promise<string>,
		opts?: { cancellable?: boolean },
	): Promise<void>;
	activeNote(): NoteHandle | null;
	ready(needsBoard?: boolean): boolean;
	noteOptions(force?: "pull" | "push"): NoteSyncOptions;
	folderOptions(): FolderSyncOptions;
	auditOptions(): AuditOptions;
	saveSettings(): Promise<void>;
}
