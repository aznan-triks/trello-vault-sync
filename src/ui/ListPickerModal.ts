import { FuzzySuggestModal, type App } from "obsidian";
import type { TrelloList } from "../trello/client";

/**
 * Fuzzy-search picker for choosing a Trello list, used when creating cards from
 * phantom notes and no destination list is preconfigured.
 */
export class ListPickerModal extends FuzzySuggestModal<TrelloList> {
	constructor(
		app: App,
		private readonly lists: TrelloList[],
		private readonly onPick: (list: TrelloList) => void,
	) {
		super(app);
		this.setPlaceholder("Choose a Trello list…");
	}

	getItems(): TrelloList[] {
		return this.lists;
	}

	getItemText(list: TrelloList): string {
		return list.name;
	}

	onChooseItem(list: TrelloList): void {
		this.onPick(list);
	}
}
