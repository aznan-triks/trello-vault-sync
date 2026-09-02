import { AbstractInputSuggest, type App } from "obsidian";

/**
 * Inline autocomplete for a vault-relative path field (a folder, a note, a
 * template name), over a plain list of candidate strings computed on demand.
 * Selecting a suggestion writes it into the field and fires a real "input"
 * event — the field's own `onChange` handler (already wired for typing) is
 * what actually saves the value, so the suggest doesn't need its own copy of
 * that logic.
 */
export class VaultPathSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly inputEl: HTMLInputElement,
		private readonly getCandidates: () => string[],
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): string[] {
		const needle = query.toLowerCase();
		return this.getCandidates().filter((candidate) => candidate.toLowerCase().includes(needle));
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	override selectSuggestion(value: string): void {
		this.setValue(value);
		this.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
		this.close();
	}
}
