import { AbstractInputSuggest, Notice, type App } from "obsidian";
import { errorMessage } from "../core/errorMessage";

export interface IdName {
	id: string;
	name: string;
}

/**
 * Inline autocomplete for a Trello board/list id text field: matching names
 * drop down as you type, fetched once per field-focus and filtered
 * client-side afterwards — not once per keystroke, to stay well clear of
 * Trello's rate limit. Selecting a suggestion writes the id into the field
 * (that's what the setting actually stores) and hands the full picked
 * board/list to `onPick` for any extra bookkeeping (e.g. showing its name).
 */
export class TrelloPickerSuggest extends AbstractInputSuggest<IdName> {
	private cache: IdName[] | null = null;

	constructor(
		app: App,
		textInputEl: HTMLInputElement,
		private readonly fetchItems: () => Promise<IdName[]>,
		private readonly onPick: (item: IdName) => void,
	) {
		super(app, textInputEl);
	}

	protected async getSuggestions(query: string): Promise<IdName[]> {
		if (this.cache === null) {
			try {
				this.cache = await this.fetchItems();
			} catch (error) {
				new Notice(`❌ ${errorMessage(error)}`);
				console.error("[trello-vault-sync]", error);
				this.cache = [];
			}
		}
		const needle = query.toLowerCase();
		return this.cache.filter((item) => item.name.toLowerCase().includes(needle));
	}

	renderSuggestion(item: IdName, el: HTMLElement): void {
		el.createDiv({ text: item.name });
		el.createEl("small", { text: item.id });
	}

	override selectSuggestion(item: IdName): void {
		this.setValue(item.id);
		this.onPick(item);
		this.close();
	}
}
