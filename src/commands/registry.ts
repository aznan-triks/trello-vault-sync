import * as auditCommands from "./auditCommands";
import type { CommandContext } from "./context";
import { createCardFromActiveNote, createCardsFromPhantomNotes } from "./createCardCommand";
import { createNoteFromOrphanCard } from "./createNoteCommand";
import * as forceSyncCommands from "./forceSyncCommands";
import * as historyCommands from "./historyCommands";
import * as noteCommands from "./noteCommands";
import * as syncCommands from "./syncCommands";

export type CommandSection = "Active note" | "Folders" | "Vault";

/** Display order shared by every UI that groups commands by section (sidebar, settings). */
export const ALL_SECTIONS: CommandSection[] = ["Active note", "Folders", "Vault"];

/**
 * Visual color category for a sidebar action button — explicit per command
 * (below), not guessed from `id` (the old `getActionTone` in `SidebarView.ts`
 * matched `startsWith`/`includes` patterns that missed ids like
 * "create-cards-from-phantom-notes", which fell back to grey; see
 * `AUDIT_2026-09-25_ux-settings-features.md` §C).
 */
export type CommandTone = "sync" | "pull" | "push" | "link" | "audit" | "history" | "default";

export interface CommandDescriptor {
	id: string;
	name: string;
	/** Lucide icon name — shown on the sidebar button next to `name`. */
	icon: string;
	section: CommandSection;
	/** One sentence, shown as the sidebar button's tooltip (aria-label/title). */
	description: string;
	/** Sidebar button color category — every entry must set one explicitly (tested in `tests/registry.test.ts`). */
	tone: CommandTone;
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
		description: "Reconcile the open note with its linked Trello card, in whichever direction the newest change points.",
		tone: "sync",
		run: (ctx) => noteCommands.syncActive(ctx),
	},
	{
		id: "pull-active-note",
		name: "Pull from Trello (active note)",
		icon: "download",
		section: "Active note",
		description: "Overwrite the open note with the linked card's current content.",
		tone: "pull",
		run: (ctx) => noteCommands.syncActive(ctx, "pull"),
	},
	{
		id: "push-active-note",
		name: "Push to Trello (active note)",
		icon: "upload",
		section: "Active note",
		description: "Overwrite the linked Trello card with the open note's current content.",
		tone: "push",
		run: (ctx) => noteCommands.syncActive(ctx, "push"),
	},
	{
		id: "force-pull-note",
		name: "Force pull (active note)",
		icon: "download",
		section: "Active note",
		description: "Pull from the linked card regardless of which side changed more recently.",
		tone: "pull",
		run: (ctx) => forceSyncCommands.forcePullActiveNote(ctx),
	},
	{
		id: "force-push-note",
		name: "Force push (active note)",
		icon: "upload",
		section: "Active note",
		description: "Push to the linked card regardless of which side changed more recently.",
		tone: "push",
		run: (ctx) => forceSyncCommands.forcePushActiveNote(ctx),
	},
	{
		id: "link-active-note",
		name: "Link active note to a card",
		icon: "link",
		section: "Active note",
		description: "Find the best-matching Trello card by title and link it to the open note.",
		tone: "link",
		run: (ctx) => noteCommands.linkActive(ctx),
	},
	{
		id: "link-active-note-pick",
		name: "Link active note to a card (pick manually)",
		icon: "link-2",
		section: "Active note",
		description: "Search Trello cards by name and link the one you pick to the open note.",
		tone: "link",
		run: (ctx) => noteCommands.linkActivePick(ctx),
	},
	{
		id: "resolve-conflict",
		name: "Resolve conflict (active note), side by side",
		icon: "git-compare",
		section: "Active note",
		description: "Show the note and its card side by side when both changed, and choose which one wins.",
		tone: "history",
		run: (ctx) => noteCommands.resolveConflict(ctx),
	},
	{
		id: "create-card-from-active-note",
		name: "Create Trello card from active note",
		icon: "plus-circle",
		section: "Active note",
		description: "Create a new Trello card from the open note and link it back.",
		tone: "link",
		run: (ctx) => createCardFromActiveNote(ctx),
	},
	{
		id: "sync-mapping",
		name: "Sync a list with its folder",
		icon: "folder-sync",
		section: "Folders",
		description: "Pick one list ↔ folder mapping and reconcile just that pair.",
		tone: "sync",
		run: (ctx) => syncCommands.syncOneMapping(ctx),
	},
	{
		id: "sync-all-mappings",
		name: "Sync every list with its folder",
		icon: "folder-kanban",
		section: "Folders",
		description: "Reconcile every configured list ↔ folder mapping in one pass.",
		tone: "sync",
		run: (ctx) => syncCommands.syncAllMappings(ctx),
	},
	{
		id: "force-pull-folder",
		name: "Force pull (mapped folder)",
		icon: "folder-down",
		section: "Folders",
		description: "Pull every mapped folder from Trello regardless of which side changed more recently.",
		tone: "pull",
		run: (ctx) => forceSyncCommands.forcePullFolder(ctx),
	},
	{
		id: "force-push-folder",
		name: "Force push (mapped folder)",
		icon: "folder-up",
		section: "Folders",
		description: "Push every mapped folder to Trello regardless of which side changed more recently.",
		tone: "push",
		run: (ctx) => forceSyncCommands.forcePushFolder(ctx),
	},
	{
		id: "open-sidebar",
		name: "Open Trello Vault Sync",
		icon: "panel-right",
		section: "Vault",
		description: "Open this panel — mostly useful from the command palette when the panel is closed.",
		tone: "default",
		run: (ctx) => ctx.activateSidebarView(),
	},
	{
		id: "sync-vault",
		name: "Sync all linked notes",
		icon: "kanban-square",
		section: "Vault",
		description: "Reconcile every note in the vault that's already linked to a Trello card.",
		tone: "sync",
		run: (ctx) => syncCommands.syncAllLinked(ctx),
	},
	{
		id: "force-pull-vault",
		name: "Force pull (vault)",
		icon: "download",
		section: "Vault",
		description: "Pull every linked note in the vault from Trello regardless of which side changed more recently.",
		tone: "pull",
		run: (ctx) => forceSyncCommands.forcePullVault(ctx),
	},
	{
		id: "force-push-vault",
		name: "Force push (vault)",
		icon: "upload",
		section: "Vault",
		description: "Push every linked note in the vault to Trello regardless of which side changed more recently.",
		tone: "push",
		run: (ctx) => forceSyncCommands.forcePushVault(ctx),
	},
	{
		id: "create-note-from-card",
		name: "Create note from a Trello card",
		icon: "file-plus",
		section: "Vault",
		description: "Pick a Trello card with no linked note yet and create one for it.",
		tone: "link",
		run: (ctx) => createNoteFromOrphanCard(ctx),
	},
	{
		id: "create-cards-from-phantom-notes",
		name: "Create Trello cards from phantom notes",
		icon: "file-plus-2",
		section: "Vault",
		description: "Pick a note with no linked Trello card yet and create one for it.",
		tone: "link",
		run: (ctx) => createCardsFromPhantomNotes(ctx),
	},
	{
		id: "audit-links",
		name: "Audit links (orphan cards and notes)",
		icon: "search",
		section: "Vault",
		description: "Report Trello cards with no linked note, and notes with no linked card.",
		tone: "audit",
		run: (ctx) => auditCommands.runLinkAudit(ctx),
	},
	{
		id: "audit-locations",
		name: "Compare locations against Trello lists",
		icon: "map-pin",
		section: "Vault",
		description: "Report notes whose folder doesn't match their card's current Trello list.",
		tone: "audit",
		run: (ctx) => auditCommands.runLocationAudit(ctx),
	},
	{
		id: "audit-changes",
		name: "Audit changes (Trello change log)",
		icon: "history",
		section: "Vault",
		description: "Report what changed on Trello since the last time this audit ran.",
		tone: "audit",
		run: (ctx) => auditCommands.runChangesAudit(ctx),
	},
	{
		id: "export-changes-html",
		name: "Export change log as HTML",
		icon: "file-code",
		section: "Vault",
		description: "Write the Trello change log to a standalone HTML page in the vault.",
		tone: "audit",
		run: (ctx) => auditCommands.runChangesHtmlExport(ctx),
	},
	{
		id: "show-sync-history",
		name: "Show sync history",
		icon: "history",
		section: "Vault",
		description: "List past sync runs and what each one wrote.",
		tone: "history",
		run: (ctx) => historyCommands.showSyncHistory(ctx),
	},
	{
		id: "undo-last-sync-run",
		name: "Undo last sync run",
		icon: "undo-2",
		section: "Vault",
		description: "Revert every write made by the most recent sync run.",
		tone: "history",
		run: (ctx) => historyCommands.undoLastSyncRun(ctx),
	},
	{
		id: "undo-sync-run-picked",
		name: "Undo a sync run (pick what to undo)",
		icon: "list-checks",
		section: "Vault",
		description: "Pick a past sync run and choose which of its writes to revert.",
		tone: "history",
		run: (ctx) => historyCommands.undoSyncRunPicked(ctx),
	},
	{
		id: "undo-last-sync-active-note",
		name: "Undo last sync for the active note",
		icon: "undo",
		section: "Active note",
		description: "Revert the most recent sync write made to the open note.",
		tone: "history",
		run: (ctx) => historyCommands.undoLastSyncForActiveNote(ctx),
	},
];
