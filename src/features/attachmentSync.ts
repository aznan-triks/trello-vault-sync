import { extractCardShortLink, formatWikilink } from "../core/attachmentRef";
import type { CardRefStore, NoteHandle } from "../obsidian/gateway";
import type { TrelloClient } from "../trello/client";

/**
 * Vault-wide index of card id → note, so a card-link attachment on ANY card can
 * be resolved to its note regardless of which folder/scope is being synced.
 * Built once per run by the caller (from a vault scan it usually already did
 * for its own purposes) rather than once per note.
 */
export function buildCardIndex(vault: CardRefStore, notes: NoteHandle[]): Map<string, NoteHandle> {
	const index = new Map<string, NoteHandle>();
	for (const note of notes) {
		const ref = vault.getCardRef(note);
		if (ref) index.set(ref.cardId, note);
	}
	return index;
}

export interface ResolvedAttachments {
	/** Plain attachment urls, excluding card-link attachments. */
	urls: string[];
	/** Wikilinks for card-link attachments — the linked card's own note if found, else a placeholder by card name. */
	linkedCards: string[];
}

/** Appends `value` unless it's already present — exact-match dedup, preserving first-seen order (Trello's own). */
function pushUnique(list: string[], value: string): void {
	if (!list.includes(value)) list.push(value);
}

/**
 * Fetches a card's attachments and splits them into plain urls and card-link
 * wikilinks, each deduplicated by exact match (a card can carry the same
 * attachment or the same linked card more than once). A card-link
 * attachment's url only carries the linked card's shortLink, not its real id,
 * so resolving it against `cardIndex` costs one extra `getCard` call per such
 * attachment.
 */
export async function resolveAttachments(
	client: TrelloClient,
	cardId: string,
	cardIndex: Map<string, NoteHandle>,
	signal?: AbortSignal,
): Promise<ResolvedAttachments> {
	const attachments = await client.getCardAttachments(cardId, signal);
	const urls: string[] = [];
	const linkedCards: string[] = [];
	for (const attachment of attachments) {
		const shortLink = extractCardShortLink(attachment.url);
		if (shortLink === null) {
			pushUnique(urls, attachment.url);
			continue;
		}
		const linkedCard = await client.getCard(shortLink, signal);
		const note = cardIndex.get(linkedCard.id);
		pushUnique(linkedCards, formatWikilink(note ? note.basename : attachment.name));
	}
	return { urls, linkedCards };
}
