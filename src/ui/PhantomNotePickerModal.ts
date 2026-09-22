import { FuzzySuggestModal, type App } from "obsidian";
import type { PhantomCandidate } from "../core/phantomCardDestination";
import type { NoteHandle } from "../obsidian/gateway";

export type PhantomNoteChoice =
	| { type: "all"; count: number }
	| { type: "single"; candidate: PhantomCandidate<NoteHandle> };

/**
 * Picker modal that lets the user choose either to create cards for ALL detected
 * phantom/unlinked notes, or pick a specific one from the list.
 */
export class PhantomNotePickerModal extends FuzzySuggestModal<PhantomNoteChoice> {
	constructor(
		app: App,
		private readonly candidates: readonly PhantomCandidate<NoteHandle>[],
		private readonly onPick: (choice: PhantomNoteChoice) => void,
	) {
		super(app);
		this.setPlaceholder("Choose a phantom note or create cards for all…");
	}

	getItems(): PhantomNoteChoice[] {
		if (this.candidates.length === 0) return [];
		const choices: PhantomNoteChoice[] = [];
		if (this.candidates.length > 1) {
			choices.push({ type: "all", count: this.candidates.length });
		}
		for (const candidate of this.candidates) {
			choices.push({ type: "single", candidate });
		}
		return choices;
	}

	getItemText(item: PhantomNoteChoice): string {
		if (item.type === "all") {
			return `→ ✨ Create Trello cards for ALL ${item.count} phantom notes`;
		}
		const { note, kind } = item.candidate;
		const location = note.folder ? `${note.folder}/` : "";
		const tag = kind === "phantom" ? "[phantom]" : "[unlinked]";
		return `${note.basename} (${location || "root"}) ${tag}`;
	}

	onChooseItem(item: PhantomNoteChoice): void {
		this.onPick(item);
	}
}
