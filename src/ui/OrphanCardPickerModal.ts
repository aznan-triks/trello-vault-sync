import { FuzzySuggestModal, type App } from "obsidian";
import type { TrelloCard } from "../trello/client";

export type OrphanCardChoice =
	| { type: "all"; count: number }
	| { type: "single"; card: TrelloCard };

/**
 * Picker modal that lets the user choose either to create notes for ALL detected
 * orphan cards, or pick a specific card from the list.
 */
export class OrphanCardPickerModal extends FuzzySuggestModal<OrphanCardChoice> {
	constructor(
		app: App,
		private readonly cards: readonly TrelloCard[],
		private readonly allowBatch: boolean,
		private readonly onPick: (choice: OrphanCardChoice) => void,
	) {
		super(app);
		this.setPlaceholder("Choose a card or create notes for all…");
	}

	getItems(): OrphanCardChoice[] {
		if (this.cards.length === 0) return [];
		const choices: OrphanCardChoice[] = [];
		if (this.allowBatch && this.cards.length > 1) {
			choices.push({ type: "all", count: this.cards.length });
		}
		for (const card of this.cards) {
			choices.push({ type: "single", card });
		}
		return choices;
	}

	getItemText(item: OrphanCardChoice): string {
		if (item.type === "all") {
			return `→ ✨ Create notes for ALL ${item.count} orphan cards`;
		}
		return item.card.name;
	}

	onChooseItem(item: OrphanCardChoice): void {
		this.onPick(item);
	}
}
