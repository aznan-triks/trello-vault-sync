import { parseCardRef } from "../core/cardRef";
import { sanitizeFileName, uniqueNotePath } from "../core/fileName";
import { extractBody, replaceBody } from "../core/noteBody";
import { decideSync, type ConflictPolicy, type SyncDecision, type SyncDirection } from "../core/syncDecision";
import type { NoteHandle, VaultGateway } from "../obsidian/gateway";
import type { TrelloCard, TrelloClient } from "../trello/client";

export interface NoteSyncOptions {
	policy: ConflictPolicy;
	marginMs: number;
	/** Whether the note file name and the card title follow each other. */
	syncTitle: boolean;
	dryRun: boolean;
	/** Explicit user choice, bypassing timestamps entirely. */
	force?: "pull" | "push";
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
export function decideForCard(
	note: Pick<NoteHandle, "basename" | "mtime">,
	card: TrelloCard,
	localBody: string,
	options: Pick<NoteSyncOptions, "policy" | "marginMs">,
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
		remoteTitle: card.name,
		remoteBody: card.desc ?? "",
		remoteMtime,
		policy: options.policy,
		marginMs: options.marginMs,
	});
}

/** Sync one note against a card that has already been fetched. */
export async function syncNoteWithCard(
	vault: VaultGateway,
	client: TrelloClient,
	note: NoteHandle,
	card: TrelloCard,
	options: NoteSyncOptions,
): Promise<NoteSyncResult> {
	const content = await vault.read(note);
	const localBody = extractBody(content);

	const decision = decideForCard(note, card, localBody, options);
	const direction = options.force ?? decision.direction;
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

	const fields: { name?: string; desc?: string } = { desc: localBody };
	if (options.syncTitle && decision.titleChanged) fields.name = note.basename;
	await client.updateCard(card.id, fields);
	return { direction, renamed: false, note, reason: decision.reason };
}

/** Sync one note, fetching its card first. */
export async function syncNote(
	vault: VaultGateway,
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

/** Re-export so callers do not need to reach into core for the common case. */
export { parseCardRef };
