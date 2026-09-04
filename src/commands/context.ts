import type { App } from "obsidian";
import type { AuditOptions } from "../features/auditShared";
import type { FolderSyncOptions } from "../features/syncFolder";
import type { NoteSyncOptions } from "../features/syncNote";
import type { NoteHandle, Reporter, VaultGateway } from "../obsidian/gateway";
import type { TrelloVaultSyncSettings } from "../settings/types";
import type { TrelloClient } from "../trello/client";

/**
 * Everything a command handler needs from the plugin, without depending on the
 * `Plugin` subclass itself — lets `src/commands/*.ts` stay about "what a command
 * does" instead of "how the plugin is wired".
 */
export interface CommandContext {
	readonly app: App;
	readonly vault: VaultGateway;
	readonly settings: TrelloVaultSyncSettings;
	client(reporter?: Reporter): TrelloClient;
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
