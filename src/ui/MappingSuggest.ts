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
		this.setPlaceholder("Quelle correspondance synchroniser ?");
	}

	getSuggestions(query: string): FolderMapping[] {
		const needle = query.toLowerCase();
		return this.mappings.filter((mapping) => mapping.folder.toLowerCase().includes(needle));
	}

	renderSuggestion(mapping: FolderMapping, el: HTMLElement): void {
		el.createDiv({ text: mapping.folder || "(dossier non défini)" });
		el.createEl("small", { text: `liste ${mapping.listId || "?"} · modèle ${mapping.templateName || "aucun"}` });
	}

	onChooseSuggestion(mapping: FolderMapping): void {
		this.onPick(mapping);
	}
}
