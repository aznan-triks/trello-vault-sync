import * as auditCommands from "./auditCommands";
import { createFromAuditReport } from "./auditReportCreateCommand";
import type { CommandContext } from "./context";
import { createCardFromActiveNote, createCardsFromPhantomNotes } from "./createCardCommand";
import { createNoteFromOrphanCard } from "./createNoteCommand";
import * as forceSyncCommands from "./forceSyncCommands";
import * as historyCommands from "./historyCommands";
import * as noteCommands from "./noteCommands";
import * as syncCommands from "./syncCommands";

export type CommandSection = "Active note" | "Folders" | "Vault" | "Create" | "Audit" | "History";

/** Display order shared by every UI that groups commands by section (sidebar, settings). */
export const ALL_SECTIONS: CommandSection[] = ["Active note", "Folders", "Vault", "Create", "Audit", "History"];

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
 * command declared once, not twice. "Turn test mode (dry-run) on or off" isn't here: the
 * sidebar renders it as a settings-synced switch, not a one-shot button, so
 * it stays a plain `addCommand` call in `main.ts` for the palette only.
 */
export const COMMANDS: CommandDescriptor[] = [
	{
		id: "sync-active-note",
		name: "Sync this note with its card",
		icon: "refresh-cw",
		section: "Active note",
		description: "Reconcile the open note with its linked Trello card, in whichever direction the newest change points.",
		tone: "sync",
		run: (ctx) => noteCommands.syncActive(ctx),
	},
	{
		id: "pull-active-note",
		name: "Update this note from its card",
		icon: "download",
		section: "Active note",
		description: "Overwrite the open note with the linked card's current content.",
		tone: "pull",
		run: (ctx) => noteCommands.syncActive(ctx, "pull"),
	},
	{
		id: "push-active-note",
		name: "Update the card from this note",
		icon: "upload",
		section: "Active note",
		description: "Overwrite the linked Trello card with the open note's current content.",
		tone: "push",
		run: (ctx) => noteCommands.syncActive(ctx, "push"),
	},
	{
		id: "force-pull-note",
		name: "Overwrite this note with its card",
		icon: "download",
		section: "Active note",
		description: "Pull from the linked card regardless of which side changed more recently.",
		tone: "pull",
		run: (ctx) => forceSyncCommands.forcePullActiveNote(ctx),
	},
	{
		id: "force-push-note",
		name: "Overwrite the card with this note",
		icon: "upload",
		section: "Active note",
		description: "Push to the linked card regardless of which side changed more recently.",
		tone: "push",
		run: (ctx) => forceSyncCommands.forcePushActiveNote(ctx),
	},
	{
		id: "link-active-note",
		name: "Link this note to the card with the same name",
		icon: "link",
		section: "Active note",
		description: "Find the best-matching Trello card by title and link it to the open note.",
		tone: "link",
		run: (ctx) => noteCommands.linkActive(ctx),
	},
	{
		id: "link-active-note-pick",
		name: "Link this note to a card I choose",
		icon: "link-2",
		section: "Active note",
		description: "Search Trello cards by name and link the one you pick to the open note.",
		tone: "link",
		run: (ctx) => noteCommands.linkActivePick(ctx),
	},
	{
		id: "unlink-active-note",
		name: "Unlink this note from its card",
		icon: "unlink",
		section: "Active note",
		description: "Remove the Trello properties from the open note. The card and the note's text are left untouched.",
		tone: "link",
		run: (ctx) => noteCommands.unlinkActive(ctx),
	},
	{
		id: "resolve-conflict",
		name: "Compare this note and its card side by side",
		icon: "git-compare",
		section: "Active note",
		description: "Show the note and its card side by side when both changed, and choose which one wins.",
		tone: "history",
		run: (ctx) => noteCommands.resolveConflict(ctx),
	},
	{
		id: "create-card-from-active-note",
		name: "Create a card from this note",
		icon: "plus-circle",
		section: "Active note",
		description: "Create a new Trello card from the open note and link it back.",
		tone: "link",
		run: (ctx) => createCardFromActiveNote(ctx),
	},
	{
		id: "sync-mapping",
		name: "Sync one folder with its list",
		icon: "folder-sync",
		section: "Folders",
		description: "Pick one list ↔ folder mapping and reconcile just that pair.",
		tone: "sync",
		run: (ctx) => syncCommands.syncOneMapping(ctx),
	},
	{
		id: "sync-all-mappings",
		name: "Sync every folder with its list",
		icon: "folder-kanban",
		section: "Folders",
		description: "Reconcile every configured list ↔ folder mapping in one pass.",
		tone: "sync",
		run: (ctx) => syncCommands.syncAllMappings(ctx),
	},
	{
		id: "pull-folder",
		name: "Update a folder's notes from its list",
		icon: "download",
		section: "Folders",
		description: "Pull a mapped folder's cards into its notes; a genuine conflict is reported, not overwritten.",
		tone: "pull",
		run: (ctx) => syncCommands.syncOneMapping(ctx, "pull"),
	},
	{
		id: "push-folder",
		name: "Update a list's cards from its folder",
		icon: "upload",
		section: "Folders",
		description: "Push a mapped folder's notes to their cards; a genuine conflict is reported, not overwritten.",
		tone: "push",
		run: (ctx) => syncCommands.syncOneMapping(ctx, "push"),
	},
	{
		id: "force-pull-folder",
		name: "Overwrite a folder's notes with its list",
		icon: "folder-down",
		section: "Folders",
		description: "Pull every mapped folder from Trello regardless of which side changed more recently.",
		tone: "pull",
		run: (ctx) => forceSyncCommands.forcePullFolder(ctx),
	},
	{
		id: "force-push-folder",
		name: "Overwrite a list's cards with its folder",
		icon: "folder-up",
		section: "Folders",
		description: "Push every mapped folder to Trello regardless of which side changed more recently.",
		tone: "push",
		run: (ctx) => forceSyncCommands.forcePushFolder(ctx),
	},
	{
		id: "open-sidebar",
		name: "Open the sidebar",
		icon: "panel-right",
		section: "Vault",
		description: "Open this panel — mostly useful from the command palette when the panel is closed.",
		tone: "default",
		run: (ctx) => ctx.activateSidebarView(),
	},
	{
		id: "sync-vault",
		name: "Sync every linked note with its card",
		icon: "kanban-square",
		section: "Vault",
		description: "Reconcile every note in the vault that's already linked to a Trello card.",
		tone: "sync",
		run: (ctx) => syncCommands.syncAllLinked(ctx),
	},
	{
		id: "pull-vault",
		name: "Update every linked note from its card",
		icon: "download",
		section: "Vault",
		description: "Pull every linked card into its note; a genuine conflict is reported, not overwritten.",
		tone: "pull",
		run: (ctx) => syncCommands.syncAllLinked(ctx, "pull"),
	},
	{
		id: "push-vault",
		name: "Update every card from its linked note",
		icon: "upload",
		section: "Vault",
		description: "Push every linked note to its card; a genuine conflict is reported, not overwritten.",
		tone: "push",
		run: (ctx) => syncCommands.syncAllLinked(ctx, "push"),
	},
	{
		id: "force-pull-vault",
		name: "Overwrite every linked note with its card",
		icon: "download",
		section: "Vault",
		description: "Pull every linked note in the vault from Trello regardless of which side changed more recently.",
		tone: "pull",
		run: (ctx) => forceSyncCommands.forcePullVault(ctx),
	},
	{
		id: "force-push-vault",
		name: "Overwrite every card with its linked note",
		icon: "upload",
		section: "Vault",
		description: "Push every linked note in the vault to Trello regardless of which side changed more recently.",
		tone: "push",
		run: (ctx) => forceSyncCommands.forcePushVault(ctx),
	},
	{
		id: "create-note-from-card",
		name: "Create a note from an unlinked card",
		icon: "file-plus",
		section: "Create",
		description: "Pick a Trello card with no linked note yet and create one for it.",
		tone: "link",
		run: (ctx) => createNoteFromOrphanCard(ctx),
	},
	{
		id: "create-cards-from-phantom-notes",
		name: "Recreate the missing cards of notes",
		icon: "file-plus-2",
		section: "Create",
		description: "Pick a note with no linked Trello card yet and create one for it.",
		tone: "link",
		run: (ctx) => createCardsFromPhantomNotes(ctx),
	},
	{
		id: "audit-links",
		name: "Report unlinked cards and notes",
		icon: "search",
		section: "Audit",
		description: "Report Trello cards with no linked note, and notes with no linked card.",
		tone: "audit",
		run: (ctx) => auditCommands.runLinkAudit(ctx),
	},
	{
		id: "create-from-audit-report",
		name: "Create notes and cards from the link report",
		icon: "clipboard-check",
		section: "Create",
		description:
			"Create notes for the orphan cards and cards for the unlinked notes left unchecked in the link audit report — all of it, or one list or folder.",
		tone: "link",
		run: (ctx) => createFromAuditReport(ctx),
	},
	{
		id: "create-notes-from-audit-report",
		name: "Create notes from the link report",
		icon: "file-plus",
		section: "Create",
		description: "Create notes only for the orphan cards left unchecked in the link audit report — all of them, or one list.",
		tone: "link",
		run: (ctx) => createFromAuditReport(ctx, "notes"),
	},
	{
		id: "create-cards-from-audit-report",
		name: "Create cards from the link report",
		icon: "file-plus-2",
		section: "Create",
		description: "Create Trello cards only for the unlinked notes left unchecked in the link audit report — all of them, or one folder.",
		tone: "link",
		run: (ctx) => createFromAuditReport(ctx, "cards"),
	},
	{
		id: "open-link-audit-report",
		name: "Open the link report",
		icon: "file-search",
		section: "Audit",
		description: "Open the note where \"Report unlinked cards and notes\" writes its report.",
		tone: "audit",
		run: (ctx) => auditCommands.openLinkReport(ctx),
	},
	{
		id: "audit-locations",
		name: "Report notes in the wrong folder",
		icon: "map-pin",
		section: "Audit",
		description: "Report notes whose folder doesn't match their card's current Trello list.",
		tone: "audit",
		run: (ctx) => auditCommands.runLocationAudit(ctx),
	},
	{
		id: "audit-changes",
		name: "Fetch the Trello change log",
		icon: "history",
		section: "Audit",
		description: "Report what changed on Trello since the last time this audit ran.",
		tone: "audit",
		run: (ctx) => auditCommands.runChangesAudit(ctx),
	},
	{
		id: "export-changes-html",
		name: "Export the change log as HTML",
		icon: "file-code",
		section: "Audit",
		description: "Write the Trello change log to a standalone HTML page in the vault.",
		tone: "audit",
		run: (ctx) => auditCommands.runChangesHtmlExport(ctx),
	},
	{
		id: "show-sync-history",
		name: "Show the sync history",
		icon: "history",
		section: "History",
		description: "List past sync runs and what each one wrote.",
		tone: "history",
		run: (ctx) => historyCommands.showSyncHistory(ctx),
	},
	{
		id: "undo-last-sync-run",
		name: "Undo the last sync",
		icon: "undo-2",
		section: "History",
		description: "Revert every write made by the most recent sync run.",
		tone: "history",
		run: (ctx) => historyCommands.undoLastSyncRun(ctx),
	},
	{
		id: "undo-sync-run-picked",
		name: "Undo part of a past sync",
		icon: "list-checks",
		section: "History",
		description: "Pick a past sync run and choose which of its writes to revert.",
		tone: "history",
		run: (ctx) => historyCommands.undoSyncRunPicked(ctx),
	},
	{
		id: "undo-last-sync-active-note",
		name: "Undo the last sync of this note",
		icon: "undo",
		section: "Active note",
		description: "Revert the most recent sync write made to the open note.",
		tone: "history",
		run: (ctx) => historyCommands.undoLastSyncForActiveNote(ctx),
	},
];
