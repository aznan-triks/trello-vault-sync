import { Notice } from "obsidian";
import { confirmIfEnabled } from "./confirmAction";
import type { CommandContext } from "./context";
import { batchCreateCardsFromNotesAction } from "./createCardCommand";
import { batchCreateNotesFromCardsAction, folderCandidates } from "./createNoteCommand";
import {
	matchReportKeys,
	parseLinkReportGroups,
	selectUncheckedKeys,
	type ReportGroup,
	type ReportGroupSelection,
} from "../core/auditReportSelection";
import { resolveOrphanCardDestination } from "../core/orphanCardDestination";
import { resolvePhantomCardDestination, type PhantomCandidate } from "../core/phantomCardDestination";
import { buildCardIndex } from "../features/attachmentSync";
import { fetchBoardIndex } from "../features/boardIndex";
import { unlinkedCards } from "../features/createNoteFromCard";
import type { NoteHandle } from "../obsidian/gateway";
import type { TrelloCard } from "../trello/client";
import { AuditReportGroupPickerModal, type AuditReportGroupChoice } from "../ui/AuditReportGroupPickerModal";
import { FolderPickerModal } from "../ui/FolderPickerModal";
import { ListPickerModal } from "../ui/ListPickerModal";

interface ResolvedSelection {
	cards: TrelloCard[];
	notes: PhantomCandidate<NoteHandle>[];
	skipped: number;
	listNames: Map<string, string>;
}

function groupLabel(group: ReportGroup): string {
	const checked = group.checked > 0 ? ` (${group.checked} checked)` : "";
	return group.kind === "orphan-cards"
		? `📋 ${group.name} — ${group.unchecked.length} unchecked card(s)${checked}`
		: `📁 ${group.name} — ${group.unchecked.length} unchecked note(s)${checked}`;
}

function groupChoices(groups: readonly ReportGroup[]): AuditReportGroupChoice[] {
	const all = selectUncheckedKeys(groups, "all");
	return [
		{
			label: `All groups — ${all.cardKeys.length} card(s) → notes · ${all.noteKeys.length} note(s) → cards`,
			selection: "all",
		},
		...groups.map((group) => ({ label: groupLabel(group), selection: { kind: group.kind, name: group.name } })),
	];
}

/**
 * Re-reads the board and the vault so the report is never trusted blindly: an
 * unchecked card that got a note since the audit, or an unchecked note that got
 * a card (or moved, or was deleted), is skipped and logged — never recreated.
 */
async function resolveAgainstLiveData(
	ctx: CommandContext,
	groups: readonly ReportGroup[],
	selection: ReportGroupSelection,
): Promise<ResolvedSelection | null> {
	let resolved: ResolvedSelection | null = null;
	await ctx.run("Check audit report items", async (reporter, signal) => {
		const { cardKeys, noteKeys } = selectUncheckedKeys(groups, selection);
		const { cards, listNames } = await fetchBoardIndex(ctx.client(reporter), ctx.settings.boardId, signal);
		const linkedCardIds = new Set(buildCardIndex(ctx.vault, ctx.vault.listNotes("")).keys());
		const orphanByUrl = new Map(
			unlinkedCards(
				cards.filter((card) => !card.closed),
				linkedCardIds,
			).map((card) => [card.url, card]),
		);
		const unlinkedByPath = new Map(
			ctx.vault
				.listNotes(ctx.settings.scope, ctx.settings.excludedFolders)
				.filter((note) => !ctx.vault.getCardRef(note))
				.map((note) => [note.path, note]),
		);

		const cardMatch = matchReportKeys(cardKeys, orphanByUrl);
		const noteMatch = matchReportKeys(noteKeys, unlinkedByPath);
		for (const key of cardMatch.skipped) reporter.log("skip", `${key} — no longer an orphan card`);
		for (const key of noteMatch.skipped) reporter.log("skip", `${key} — no longer an unlinked note`);

		const skipped = cardMatch.skipped.length + noteMatch.skipped.length;
		resolved = {
			cards: cardMatch.matched,
			notes: noteMatch.matched.map((note) => ({ note, kind: "unlinked" as const })),
			skipped,
			listNames,
		};
		return `${cardMatch.matched.length} card(s) and ${noteMatch.matched.length} note(s) still to create from · ${skipped} skipped`;
	});
	return resolved;
}

/** Runs both batches one after the other (one sync at a time) — the notes batch first, then the cards batch. */
async function createBoth(
	ctx: CommandContext,
	resolved: ResolvedSelection,
	promptedFolder: string | undefined,
	listId: string,
	listName: string | undefined,
): Promise<void> {
	if (resolved.cards.length > 0) await batchCreateNotesFromCardsAction(ctx, resolved.cards, promptedFolder);
	if (resolved.notes.length > 0) await batchCreateCardsFromNotesAction(ctx, resolved.notes, listId, listName);
}

/** Asks for a fallback folder / list only when some item has no configured destination — same rule as the individual pickers. */
function promptThenCreate(ctx: CommandContext, resolved: ResolvedSelection): void {
	const { settings } = ctx;
	const needsFolder = resolved.cards.some(
		(card) => resolveOrphanCardDestination(card.idList, settings.mappings, settings.orphanCardFolder).needsPrompt,
	);
	const needsList = resolved.notes.some(
		(candidate) =>
			resolvePhantomCardDestination(
				candidate.note.folder,
				settings.mappings,
				settings.phantomCardListId,
				settings.phantomNotePreferFolderMapping,
			).needsPrompt,
	);

	const withList = (folder: string | undefined): void => {
		if (!needsList) {
			void createBoth(ctx, resolved, folder, settings.phantomCardListId, resolved.listNames.get(settings.phantomCardListId));
			return;
		}
		const lists = [...resolved.listNames.entries()].map(([id, name]) => ({ id, name }));
		if (lists.length === 0) {
			new Notice("No lists found on the Trello board.");
			return;
		}
		new ListPickerModal(ctx.app, lists, (list) => void createBoth(ctx, resolved, folder, list.id, list.name)).open();
	};

	if (needsFolder) {
		new FolderPickerModal(ctx.app, () => folderCandidates(ctx), "", (folder) => withList(folder)).open();
	} else {
		withList(undefined);
	}
}

async function createFromSelection(
	ctx: CommandContext,
	groups: readonly ReportGroup[],
	selection: ReportGroupSelection,
): Promise<void> {
	const resolved = await resolveAgainstLiveData(ctx, groups, selection);
	if (!resolved) return;
	const { cards, notes, skipped } = resolved as ResolvedSelection;
	const skippedText = skipped > 0 ? ` ${skipped} item(s) skipped (no longer orphan or unlinked).` : "";
	if (cards.length === 0 && notes.length === 0) {
		new Notice(`Nothing left to create from the audit report.${skippedText}`);
		return;
	}
	const dryRun = ctx.settings.dryRun ? "[Dry-run] " : "";
	await confirmIfEnabled(
		ctx,
		ctx.settings.confirmBatchCreate,
		`${dryRun}Create ${cards.length} note(s) from orphan cards and ${notes.length} card(s) from unlinked notes?${skippedText}`,
		"Create",
		() => promptThenCreate(ctx, resolved as ResolvedSelection),
	);
}

/**
 * "Create from audit report (unchecked items)": acts on the link report's
 * checkboxes — unchecked orphan cards become notes, unchecked unlinked notes
 * become cards (each direction behind its own setting). Checked items are the
 * user's "leave this alone" triage and are never touched.
 */
export async function createFromAuditReport(ctx: CommandContext): Promise<void> {
	if (!ctx.ready(true)) return;
	const { auditReportCreateNotes, auditReportCreateCards } = ctx.settings;
	if (!auditReportCreateNotes && !auditReportCreateCards) {
		new Notice(
			"Creating from the audit report is disabled — turn on notes and/or cards under Settings → Creation → Create from audit report.",
		);
		return;
	}

	const reportPath = ctx.auditOptions("links").reportPath;
	const reportNote = reportPath.trim() === "" ? null : ctx.vault.noteAt(reportPath);
	const groups = reportNote ? parseLinkReportGroups(await ctx.vault.read(reportNote)) : null;
	if (!groups) {
		new Notice(
			`No link report found${reportPath.trim() ? ` in ${reportPath}` : ""}. Run "Audit links (orphan cards and notes)" first.`,
		);
		return;
	}

	const usable = groups.filter(
		(group) =>
			group.unchecked.length > 0 && (group.kind === "orphan-cards" ? auditReportCreateNotes : auditReportCreateCards),
	);
	if (usable.length === 0) {
		new Notice("Nothing is left unchecked in the link report.");
		return;
	}

	new AuditReportGroupPickerModal(ctx.app, groupChoices(usable), (choice) => {
		void createFromSelection(ctx, usable, choice.selection);
	}).open();
}
