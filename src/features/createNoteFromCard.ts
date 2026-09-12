import { formatCardRef } from "../core/cardRef";
import { sanitizeFileName, uniqueNotePath } from "../core/fileName";
import { renderTemplate } from "../core/template";
import type { NoteHandle, VaultGateway } from "../obsidian/gateway";
import type { TrelloCard } from "../trello/client";

/** The content of a brand-new note created from a card — a rendered template, or a bare frontmatter + description fallback when the mapping has none. */
export function newNoteContentFromCard(card: TrelloCard, template: string | null, cardRefKey: string): string {
	const vars = {
		TITLE: card.name,
		DESCRIPTION: card.desc ?? "",
		URL: card.url,
		CARD_ID: card.id,
		BOARD_ID: card.idBoard,
	};
	if (template) return renderTemplate(template, vars);
	const ref = formatCardRef(card.idBoard, card.id);
	return `---\n${cardRefKey}: "${ref}"\n---\n\n${card.desc ?? ""}`;
}

/**
 * Creates a brand-new note from a card in `folder`, sanitizing its file name
 * and adding a "(2)", "(3)"… suffix on a name collision (`uniqueNotePath`) —
 * never overwrites an existing note. The single place a note is ever
 * fabricated from a card: shared by `syncFolder`'s "create missing" branch
 * and the "Create note from a Trello card" command, so there is only ever
 * one way a note-from-card looks.
 */
/** Cards not yet claimed by any note in the vault — the picker for "Create note from a Trello card" never re-offers an already-linked card. */
export function unlinkedCards(cards: readonly TrelloCard[], linkedCardIds: ReadonlySet<string>): TrelloCard[] {
	return cards.filter((card) => !linkedCardIds.has(card.id));
}

export async function createNoteFromCard(
	vault: Pick<VaultGateway, "exists" | "create">,
	card: TrelloCard,
	folder: string,
	template: string | null,
	cardRefKey: string,
): Promise<NoteHandle> {
	const safeName = sanitizeFileName(card.name);
	const path = uniqueNotePath(folder, safeName, (p) => vault.exists(p));
	return vault.create(path, newNoteContentFromCard(card, template, cardRefKey));
}
