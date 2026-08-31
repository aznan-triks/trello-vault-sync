import { SuggestModal, type App } from "obsidian";

export interface IdName {
	id: string;
	name: string;
}

/**
 * Pick one Trello board or list by name (substring search), from a list
 * fetched fresh right before opening — Trello ids are painful to find by
 * hand in the browser, and a stale cached list would defeat the point.
 */
export class IdNameSuggest extends SuggestModal<IdName> {
	constructor(
		app: App,
		private readonly items: IdName[],
		placeholder: string,
		private readonly onPick: (item: IdName) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getSuggestions(query: string): IdName[] {
		const needle = query.toLowerCase();
		return this.items.filter((item) => item.name.toLowerCase().includes(needle));
	}

	renderSuggestion(item: IdName, el: HTMLElement): void {
		el.createDiv({ text: item.name });
		el.createEl("small", { text: item.id });
	}

	onChooseSuggestion(item: IdName): void {
		this.onPick(item);
	}
}
