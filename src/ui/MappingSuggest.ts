import { SuggestModal, type App } from "obsidian";
import type { FolderMapping } from "../features/syncFolder";

/** Pick which list ↔ folder pair to run, replacing one script per folder. */
export class MappingSuggest extends SuggestModal<FolderMapping> {
	constructor(
		app: App,
		private readonly mappings: FolderMapping[],
		private readonly onPick: (mapping: FolderMapping) => void,
	) {
		super(app);
		this.setPlaceholder("Which mapping do you want to sync?");
	}

	getSuggestions(query: string): FolderMapping[] {
		const needle = query.toLowerCase();
		return this.mappings.filter((mapping) => mapping.folder.toLowerCase().includes(needle));
	}

	renderSuggestion(mapping: FolderMapping, el: HTMLElement): void {
		el.createDiv({ text: mapping.folder || "(no folder set)" });
		el.createEl("small", { text: `list ${mapping.listId || "?"} · template ${mapping.templateName || "none"}` });
	}

	onChooseSuggestion(mapping: FolderMapping): void {
		this.onPick(mapping);
	}
}
