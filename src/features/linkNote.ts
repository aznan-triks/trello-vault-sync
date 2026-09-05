import { bestMatch } from "../core/similarity";
import type { NoteHandle, VaultGateway } from "../obsidian/gateway";
import type { TrelloCard, TrelloClient } from "../trello/client";

export interface LinkOptions {
	boardId: string;
	/** Minimum title similarity, 0 to 1, below which nothing is linked. */
	threshold: number;
}

export interface LinkResult {
	linked: boolean;
	score: number;
	card: TrelloCard | null;
	reason: "linked" | "already-linked" | "no-match";
}

/** Attach a note to the board card whose title is closest to the file name. */
export async function linkActiveNote(
	vault: VaultGateway,
	client: TrelloClient,
	note: NoteHandle,
	options: LinkOptions,
): Promise<LinkResult> {
	if (vault.getCardRef(note)) {
		return { linked: false, score: 0, card: null, reason: "already-linked" };
	}

	const cards = await client.getBoardCards(options.boardId);
	const match = bestMatch(note.basename, cards, (card) => card.name, options.threshold);
	if (!match) return { linked: false, score: 0, card: null, reason: "no-match" };

	await vault.setCardRef(note, { boardId: match.item.idBoard, cardId: match.item.id });
	return { linked: true, score: match.score, card: match.item, reason: "linked" };
}

/**
 * Attach a note to a card the user picked manually.
 * Deliberately skips `linkActiveNote`'s "already-linked" guard — the user
 * explicitly chose this card, so overwriting a prior link (right or wrong)
 * is the intended behavior, not a bug.
 */
export async function linkNoteToCard(vault: VaultGateway, note: NoteHandle, card: TrelloCard): Promise<void> {
	await vault.setCardRef(note, { boardId: card.idBoard, cardId: card.id });
}
