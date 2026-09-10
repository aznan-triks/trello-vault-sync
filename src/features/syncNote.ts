import { DUE_KEY, formatDueRef, parseDueRef } from "../core/dueRef";
import { sanitizeFileName, uniqueNotePath } from "../core/fileName";
import { LABELS_KEY, formatLabelsRef, normalizeLabelName, parseLabelsRef } from "../core/labelRef";
import { DEFAULT_LABELS_SYNC_MODE, resolveLabelSync, type LabelSyncMode } from "../core/labelMerge";
import { extractBody, replaceBody } from "../core/noteBody";
import { decideSync, type ConflictPolicy, type SyncDecision, type SyncDirection } from "../core/syncDecision";
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
async function writeLocalLabels(vault: VaultGateway, note: NoteHandle, labels: string[]): Promise<void> {
	await vault.writeFrontmatter(note, (frontmatter) => {
		const formatted = formatLabelsRef(labels);
		if (formatted === null) delete frontmatter[LABELS_KEY];
		else frontmatter[LABELS_KEY] = formatted;
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
): Promise<void> {
	const { nextLocal, nextRemote } = resolveLabelSync(localLabels, remoteLabels, "merge", "pull");
	if (nextLocal !== null) await writeLocalLabels(vault, note, nextLocal);
	if (nextRemote !== null) await pushRemoteLabels(client, card, nextRemote);
}

/** Sync one note against a card that has already been fetched. */
export async function syncNoteWithCard(
	vault: VaultGateway,
	client: TrelloClient,
	note: NoteHandle,
	card: TrelloCard,
	options: NoteSyncOptions,
): Promise<NoteSyncResult> {
	let content = await vault.read(note);
	const localBody = extractBody(content);
	const localDue = parseDueRef(vault.readFrontmatter(note)?.[DUE_KEY]);
	const localLabels = parseLabelsRef(vault.readFrontmatter(note)?.[LABELS_KEY]);
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
		await convergeLabelsOnMerge(vault, client, note, card, localLabels, remoteLabels);
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
		const nextContent = replaceBody(content, card.desc ?? "");
		if (nextContent !== content) await vault.write(current, nextContent);

		if (decision.dueChanged) {
			await vault.writeFrontmatter(current, (frontmatter) => {
				const formatted = formatDueRef(card.due);
				if (formatted === null) delete frontmatter[DUE_KEY];
				else frontmatter[DUE_KEY] = formatted;
			});
		}

		if (labelsSyncMode === "overwrite") {
			const { nextLocal } = resolveLabelSync(localLabels, remoteLabels, "overwrite", "pull");
			if (nextLocal !== null) await writeLocalLabels(vault, current, nextLocal);
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
