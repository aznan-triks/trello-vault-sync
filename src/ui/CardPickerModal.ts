import { FuzzySuggestModal, type App } from "obsidian";
import type { TrelloCard } from "../trello/client";

/**
 * Fuzzy-search picker for one Trello card, used when the user wants to link a
 * note to a specific card by name instead of relying on the title-match
 * command. Dismissing it (Escape, click outside) never calls `onPick` — that's
 * `FuzzySuggestModal`'s own contract, not something this class adds.
 */
export class CardPickerModal extends FuzzySuggestModal<TrelloCard> {
	constructor(
		app: App,
		private readonly cards: TrelloCard[],
		private readonly onPick: (card: TrelloCard) => void,
	) {
		super(app);
		this.setPlaceholder("Search a card by name…");
	}

	getItems(): TrelloCard[] {
		return this.cards;
	}

	getItemText(card: TrelloCard): string {
		return card.name;
	}

	onChooseItem(card: TrelloCard): void {
		this.onPick(card);
	}
}
