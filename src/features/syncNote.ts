import {
	DEFAULT_ATTACHMENTS_KEY,
	DEFAULT_LINKED_CARDS_KEY,
	DEFAULT_SYNC_ATTACHMENTS,
	formatAttachmentsRef,
	formatLinkedCardsRef,
	parseAttachmentsRef,
	parseLinkedCardsRef,
} from "../core/attachmentRef";
import { DEFAULT_CHECKLIST_HEADING, DEFAULT_SYNC_CHECKLISTS } from "../core/checklistRef";
import { DEFAULT_DUE_KEY, formatDueRef, parseDueRef } from "../core/dueRef";
import { errorMessage } from "../core/errorMessage";
import { sanitizeFileName, uniqueNotePath } from "../core/fileName";
import { DEFAULT_LABELS_KEY, formatLabelsRef, normalizeLabelName, parseLabelsRef } from "../core/labelRef";
import { DEFAULT_LABELS_SYNC_MODE, resolveLabelSync, type LabelSyncMode } from "../core/labelMerge";
import { extractBody, insertChecklistSection, replaceBody, splitChecklistSection } from "../core/noteBody";
import { decideSync, type ConflictPolicy, type SyncDecision, type SyncDirection } from "../core/syncDecision";
import { buildCardIndex, resolveAttachments } from "./attachmentSync";
import { resolveChecklists } from "./checklistSync";
import type { CardRefStore, NoteHandle, VaultGateway } from "../obsidian/gateway";
import type { TrelloCard, TrelloClient, TrelloLabel } from "../trello/client";

export interface NoteSyncOptions {
	policy: ConflictPolicy;
	marginMs: number;
	/** Whether the note file name and the card title follow each other. */
	syncTitle: boolean;
	dryRun: boolean;
	/** Explicit user choice, bypassing timestamps entirely. */
	force?: "pull" | "push";
	/** `undefined` behaves as `"merge"` — the non-destructive default. */
	labelsSyncMode?: LabelSyncMode;
	/** `undefined` behaves as `DEFAULT_DUE_KEY`. */
	dueFrontmatterKey?: string;
	/** `undefined` behaves as `DEFAULT_LABELS_KEY`. */
	labelsFrontmatterKey?: string;
	/** Pull-only, on by default (`undefined` behaves as `true`) — costs one extra Trello request per note, see `DEFAULT_SYNC_ATTACHMENTS`. */
	syncAttachments?: boolean;
	/** `undefined` behaves as `DEFAULT_ATTACHMENTS_KEY`. */
	attachmentsFrontmatterKey?: string;
	/** `undefined` behaves as `DEFAULT_LINKED_CARDS_KEY`. */
	linkedCardsFrontmatterKey?: string;
	/** Costs one extra Trello request per note synced, see `DEFAULT_SYNC_CHECKLISTS`. `undefined` behaves as `true`. */
	syncChecklists?: boolean;
	/** `undefined` behaves as `DEFAULT_CHECKLIST_HEADING`. */
	checklistHeading?: string;
}

export interface NoteSyncResult {
	direction: SyncDirection | "unlinked";
	renamed: boolean;
	/** The note after the operation — the path changes on rename. */
	note: NoteHandle;
	reason: string;
}

/**
 * What a note and its already-fetched card need, without touching either side.
 * Shared by the sync engines and by the "resolve conflict" UI, which needs the
 * same decision just to know whether there is a conflict to show at all.
 */
/** The card's own label names — a nameless (color-only) label is never surfaced. */
function remoteLabelsOf(card: TrelloCard): string[] {
	return (card.labels ?? []).map((label) => label.name).filter((name) => name.trim() !== "");
}

export function decideForCard(
	note: Pick<NoteHandle, "basename" | "mtime">,
	card: TrelloCard,
	localBody: string,
	options: Pick<NoteSyncOptions, "policy" | "marginMs" | "labelsSyncMode">,
	localDue: string | null,
	localLabels: string[] = [],
): SyncDecision {
	const remoteMtime = new Date(card.dateLastActivity).getTime();
	if (!Number.isFinite(remoteMtime)) {
		throw new Error(
			`Card "${card.name}" (${card.id}) has an unreadable dateLastActivity: "${card.dateLastActivity}" — refusing to guess a sync direction.`,
		);
	}
	return decideSync({
		localTitle: note.basename,
		localBody,
		localMtime: note.mtime,
		localDue,
		localLabels,
		remoteTitle: card.name,
		remoteBody: card.desc ?? "",
		remoteMtime,
		remoteDue: card.due,
		remoteLabels: remoteLabelsOf(card),
		labelsSyncMode: options.labelsSyncMode,
		policy: options.policy,
		marginMs: options.marginMs,
	});
}

/** Resolve label names to board ids, logging (not throwing) on a name with no match. */
function resolveLabelIds(names: string[], boardLabels: TrelloLabel[]): string[] {
	const ids: string[] = [];
	for (const name of names) {
		const match = boardLabels.find((label) => normalizeLabelName(label.name) === normalizeLabelName(name));
		if (match) ids.push(match.id);
		else console.warn(`[trello-vault-sync] Label "${name}" has no match on the Trello board — left unassigned.`);
	}
	return ids;
}

/** Write a resolved label list into a note's frontmatter, deleting the key when empty. */
async function writeLocalLabels(
	vault: VaultGateway,
	note: NoteHandle,
	labels: string[],
	labelsKey: string,
): Promise<void> {
	await vault.writeFrontmatter(note, (frontmatter) => {
		const formatted = formatLabelsRef(labels);
		if (formatted === null) delete frontmatter[labelsKey];
		else frontmatter[labelsKey] = formatted;
	});
}

/** Resolve a label list to the card's board's ids — one `getBoardLabels` call, shared by every push path. */
async function resolveLabelIdsForCard(client: TrelloClient, card: TrelloCard, labels: string[]): Promise<string[]> {
	const boardLabels = await client.getBoardLabels(card.idBoard);
	return resolveLabelIds(labels, boardLabels);
}

/** Resolve a label list to ids and push it as the card's full label set, on its own `updateCard` call. */
async function pushRemoteLabels(client: TrelloClient, card: TrelloCard, labels: string[]): Promise<void> {
	await client.updateCard(card.id, { idLabels: await resolveLabelIdsForCard(client, card, labels) });
}

/**
 * Converges labels in `merge` mode: both sides move to their union, independently
 * of whatever direction was decided for title/body/due — a name typed on either
 * side is never lost. No-op under `overwrite` mode, where labels instead ride
 * the pull/push branches below like `due` does.
 */
async function convergeLabelsOnMerge(
	vault: VaultGateway,
	client: TrelloClient,
	note: NoteHandle,
	card: TrelloCard,
	localLabels: string[],
	remoteLabels: string[],
	labelsKey: string,
): Promise<void> {
	const { nextLocal, nextRemote } = resolveLabelSync(localLabels, remoteLabels, "merge", "pull");
	if (nextLocal !== null) await writeLocalLabels(vault, note, nextLocal, labelsKey);
	if (nextRemote !== null) await pushRemoteLabels(client, card, nextRemote);
}

/** Order-sensitive equality — attachment/linked-card lists follow Trello's own order, never sorted. */
function sameOrderedList(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Converges a note's attachment-derived frontmatter (plain urls + linked-card
 * wikilinks) from the card's current attachments. Pull-only, independent of
 * whatever direction was decided for title/body/due — same hook point as
 * `convergeLabelsOnMerge`, runs even when that direction is "skip"/"conflict".
 * Unlike labels, the remote read here is its own Trello request every time
 * (attachments aren't embedded in the already-fetched card), so a failure is
 * treated as best-effort: logged to the console and otherwise ignored, the
 * same non-fatal treatment `resolveLabelIds` already gives an unmatched label
 * name — not reported through `Reporter`/`NoteSyncResult`, so it stays
 * invisible in the progress panel (a known, pre-existing limitation of that
 * console.warn pattern, not something this feature was meant to fix).
 */
async function convergeAttachments(
	vault: VaultGateway,
	client: TrelloClient,
	note: NoteHandle,
	card: TrelloCard,
	cardIndex: Map<string, NoteHandle>,
	attachmentsKey: string,
	linkedCardsKey: string,
): Promise<void> {
	try {
		const { urls, linkedCards } = await resolveAttachments(client, card.id, cardIndex);
		const frontmatter = vault.readFrontmatter(note);
		const currentUrls = parseAttachmentsRef(frontmatter?.[attachmentsKey]);
		const currentLinkedCards = parseLinkedCardsRef(frontmatter?.[linkedCardsKey]);
		if (sameOrderedList(currentUrls, urls) && sameOrderedList(currentLinkedCards, linkedCards)) return;

		await vault.writeFrontmatter(note, (fm) => {
			const formattedUrls = formatAttachmentsRef(urls);
			if (formattedUrls === null) delete fm[attachmentsKey];
			else fm[attachmentsKey] = formattedUrls;

			const formattedLinkedCards = formatLinkedCardsRef(linkedCards);
			if (formattedLinkedCards === null) delete fm[linkedCardsKey];
			else fm[linkedCardsKey] = formattedLinkedCards;
		});
	} catch (error) {
		console.warn(
			`[trello-vault-sync] Could not sync attachments for card "${card.name}" (${card.id}): ${errorMessage(error)}`,
		);
	}
}

/**
 * Converges a note's checklist section from the card's current checklists.
 * Same hook point and failure handling as `convergeAttachments` — runs
 * independently of the title/body/due direction (a checkbox toggle must reach
 * Trello even when that direction is "skip"), never throws.
 *
 * Obsidian wins the checked state of an item known to both sides (pushed via
 * `resolveChecklists`'s `pushes`); Trello wins which items/checklists exist at
 * all, so the section is always rewritten to Trello's own structure — see
 * `resolveChecklists` for the full reconciliation rule.
 */
async function convergeChecklists(
	vault: VaultGateway,
	client: TrelloClient,
	note: NoteHandle,
	card: TrelloCard,
	heading: string,
): Promise<void> {
	try {
		const content = await vault.read(note);
		const fullBody = extractBody(content);
		const { rest: description, checklistBlock } = splitChecklistSection(fullBody, heading);

		const remoteChecklists = await client.getCardChecklists(card.id);
		const { markdown, pushes } = resolveChecklists(remoteChecklists, checklistBlock, heading);

		for (const push of pushes) {
			await client.updateCheckItemState(card.id, push.checkItemId, push.state);
		}

		if (markdown === checklistBlock) return;
		const nextContent = replaceBody(content, insertChecklistSection(description, markdown));
		if (nextContent !== content) await vault.write(note, nextContent);
	} catch (error) {
		console.warn(
			`[trello-vault-sync] Could not sync checklists for card "${card.name}" (${card.id}): ${errorMessage(error)}`,
		);
	}
}

/** Sync one note against a card that has already been fetched. */
export async function syncNoteWithCard(
	vault: VaultGateway & CardRefStore,
	client: TrelloClient,
	note: NoteHandle,
	card: TrelloCard,
	options: NoteSyncOptions,
	/** Pre-built vault-wide card index for resolving card-link attachments — built lazily (one extra vault scan) when omitted. */
	cardIndex?: Map<string, NoteHandle>,
): Promise<NoteSyncResult> {
	const dueKey = options.dueFrontmatterKey ?? DEFAULT_DUE_KEY;
	const labelsKey = options.labelsFrontmatterKey ?? DEFAULT_LABELS_KEY;
	const syncChecklists = options.syncChecklists ?? DEFAULT_SYNC_CHECKLISTS;
	const checklistHeading = options.checklistHeading ?? DEFAULT_CHECKLIST_HEADING;
	let content = await vault.read(note);
	const localBody = extractBody(content, syncChecklists ? checklistHeading : undefined);
	const localDue = parseDueRef(vault.readFrontmatter(note)?.[dueKey]);
	const localLabels = parseLabelsRef(vault.readFrontmatter(note)?.[labelsKey]);
	const remoteLabels = remoteLabelsOf(card);
	const labelsSyncMode = options.labelsSyncMode ?? DEFAULT_LABELS_SYNC_MODE;

	const decision = decideForCard(note, card, localBody, options, localDue, localLabels);
	const direction = options.force ?? decision.direction;

	// Independent of the direction decided above for title/body/due — it can
	// write both sides in the same pass, and runs even when that direction ends
	// up "skip" or "conflict". Re-reading `content` afterwards matters: the pull
	// branch below rebuilds the whole file from this snapshot, and a stale one
	// would silently undo the frontmatter write just made here.
	if (labelsSyncMode === "merge" && !options.dryRun) {
		await convergeLabelsOnMerge(vault, client, note, card, localLabels, remoteLabels, labelsKey);
		content = await vault.read(note);
	}

	const syncAttachments = options.syncAttachments ?? DEFAULT_SYNC_ATTACHMENTS;
	if (syncAttachments && !options.dryRun) {
		const attachmentsKey = options.attachmentsFrontmatterKey ?? DEFAULT_ATTACHMENTS_KEY;
		const linkedCardsKey = options.linkedCardsFrontmatterKey ?? DEFAULT_LINKED_CARDS_KEY;
		await convergeAttachments(
			vault,
			client,
			note,
			card,
			cardIndex ?? buildCardIndex(vault, vault.listNotes("")),
			attachmentsKey,
			linkedCardsKey,
		);
		content = await vault.read(note);
	}

	if (syncChecklists && !options.dryRun) {
		await convergeChecklists(vault, client, note, card, checklistHeading);
		content = await vault.read(note);
	}

	if (direction === "skip" || direction === "conflict") {
		return { direction, renamed: false, note, reason: decision.reason };
	}

	if (options.dryRun) {
		return { direction, renamed: false, note, reason: `${decision.reason} (simulation)` };
	}

	if (direction === "pull") {
		let current = note;
		const nextContent = replaceBody(content, card.desc ?? "", syncChecklists ? checklistHeading : undefined);
		if (nextContent !== content) await vault.write(current, nextContent);

		if (decision.dueChanged) {
			await vault.writeFrontmatter(current, (frontmatter) => {
				const formatted = formatDueRef(card.due);
				if (formatted === null) delete frontmatter[dueKey];
				else frontmatter[dueKey] = formatted;
			});
		}

		if (labelsSyncMode === "overwrite") {
			const { nextLocal } = resolveLabelSync(localLabels, remoteLabels, "overwrite", "pull");
			if (nextLocal !== null) await writeLocalLabels(vault, current, nextLocal, labelsKey);
		}

		let renamed = false;
		if (options.syncTitle && sanitizeFileName(card.name) !== current.basename) {
			const target = uniqueNotePath(
				current.folder,
				sanitizeFileName(card.name),
				(path) => vault.exists(path),
				current.path,
			);
			if (target !== current.path) {
				current = await vault.rename(current, target);
				renamed = true;
			}
		}
		return { direction, renamed, note: current, reason: decision.reason };
	}

	const fields: { name?: string; desc?: string; due?: string | null; idLabels?: string[] } = { desc: localBody };
	if (options.syncTitle && decision.titleChanged) fields.name = note.basename;
	if (decision.dueChanged) fields.due = localDue;
	if (labelsSyncMode === "overwrite") {
		const { nextRemote } = resolveLabelSync(localLabels, remoteLabels, "overwrite", "push");
		if (nextRemote !== null) fields.idLabels = await resolveLabelIdsForCard(client, card, nextRemote);
	}
	await client.updateCard(card.id, fields);
	return { direction, renamed: false, note, reason: decision.reason };
}

/** Sync one note, fetching its card first. */
export async function syncNote(
	vault: VaultGateway & CardRefStore,
	client: TrelloClient,
	note: NoteHandle,
	options: NoteSyncOptions,
): Promise<NoteSyncResult> {
	const ref = vault.getCardRef(note);
	if (!ref) {
		return { direction: "unlinked", renamed: false, note, reason: "no card id" };
	}
	const card = await client.getCard(ref.cardId);
	return syncNoteWithCard(vault, client, note, card, options);
}
