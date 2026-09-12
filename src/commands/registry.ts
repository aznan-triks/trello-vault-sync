import * as auditCommands from "./auditCommands";
import type { CommandContext } from "./context";
import * as historyCommands from "./historyCommands";
import * as noteCommands from "./noteCommands";
import * as syncCommands from "./syncCommands";

export type CommandSection = "Active note" | "Folders" | "Vault";

/** Display order shared by every UI that groups commands by section (sidebar, settings). */
export const ALL_SECTIONS: CommandSection[] = ["Active note", "Folders", "Vault"];

export interface CommandDescriptor {
	id: string;
	name: string;
	/** Lucide icon name — shown on the sidebar button next to `name`. */
	icon: string;
	section: CommandSection;
	run: (ctx: CommandContext) => void | Promise<void>;
}

/**
 * The single source of truth for every command's id/name/icon, consumed both
 * by `main.ts` (command palette) and `SidebarView` (sidebar buttons) — one
 * command declared once, not twice. "Toggle dry-run mode" isn't here: the
 * sidebar renders it as a settings-synced switch, not a one-shot button, so
 * it stays a plain `addCommand` call in `main.ts` for the palette only.
 */
export const COMMANDS: CommandDescriptor[] = [
	{
		id: "sync-active-note",
		name: "Sync active note",
		icon: "refresh-cw",
		section: "Active note",
		run: (ctx) => noteCommands.syncActive(ctx),
	},
	{
		id: "pull-active-note",
		name: "Pull from Trello (active note)",
		icon: "download",
		section: "Active note",
		run: (ctx) => noteCommands.syncActive(ctx, "pull"),
	},
	{
		id: "push-active-note",
		name: "Push to Trello (active note)",
		icon: "upload",
		section: "Active note",
		run: (ctx) => noteCommands.syncActive(ctx, "push"),
	},
	{
		id: "link-active-note",
		name: "Link active note to a card",
		icon: "link",
		section: "Active note",
		run: (ctx) => noteCommands.linkActive(ctx),
	},
	{
		id: "link-active-note-pick",
		name: "Link active note to a card (pick manually)",
		icon: "link-2",
		section: "Active note",
		run: (ctx) => noteCommands.linkActivePick(ctx),
	},
	{
		id: "resolve-conflict",
		name: "Resolve conflict (active note), side by side",
		icon: "git-compare",
		section: "Active note",
		run: (ctx) => noteCommands.resolveConflict(ctx),
	},
	{
		id: "sync-mapping",
		name: "Sync a list with its folder",
		icon: "folder-sync",
		section: "Folders",
		run: (ctx) => syncCommands.syncOneMapping(ctx),
	},
	{
		id: "sync-all-mappings",
		name: "Sync every list with its folder",
		icon: "folder-kanban",
		section: "Folders",
		run: (ctx) => syncCommands.syncAllMappings(ctx),
	},
	{
		id: "sync-vault",
		name: "Sync all linked notes",
		icon: "kanban-square",
		section: "Vault",
		run: (ctx) => syncCommands.syncAllLinked(ctx),
	},
	{
		id: "audit-links",
		name: "Audit links (orphan cards and notes)",
		icon: "search",
		section: "Vault",
		run: (ctx) => auditCommands.runLinkAudit(ctx),
	},
	{
		id: "audit-locations",
		name: "Compare locations against Trello lists",
		icon: "map-pin",
		section: "Vault",
		run: (ctx) => auditCommands.runLocationAudit(ctx),
	},
	{
		id: "audit-changes",
		name: "Audit changes (Trello change log)",
		icon: "history",
		section: "Vault",
		run: (ctx) => auditCommands.runChangesAudit(ctx),
	},
	{
		id: "export-changes-html",
		name: "Export change log as HTML",
		icon: "file-code",
		section: "Vault",
		run: (ctx) => auditCommands.runChangesHtmlExport(ctx),
	},
	{
		id: "show-sync-history",
		name: "Show sync history",
		icon: "history",
		section: "Vault",
		run: (ctx) => historyCommands.showSyncHistory(ctx),
	},
	{
		id: "undo-last-sync-run",
		name: "Undo last sync run",
		icon: "undo-2",
		section: "Vault",
		run: (ctx) => historyCommands.undoLastSyncRun(ctx),
	},
	{
		id: "undo-last-sync-active-note",
		name: "Undo last sync for the active note",
		icon: "undo",
		section: "Active note",
		run: (ctx) => historyCommands.undoLastSyncForActiveNote(ctx),
	},
];
