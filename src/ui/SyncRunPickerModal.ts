import { FuzzySuggestModal, type App } from "obsidian";
import type { SyncRun } from "../core/syncHistory";

/**
 * Fuzzy-search picker for one recorded sync run, used when the user wants to
 * undo a run other than the last one. Same shape as `CardPickerModal` —
 * dismissing it (Escape, click outside) never calls `onPick`, that's
 * `FuzzySuggestModal`'s own contract, not something this class adds.
 */
export class SyncRunPickerModal extends FuzzySuggestModal<SyncRun> {
	constructor(
		app: App,
		private readonly runs: readonly SyncRun[],
		private readonly onPick: (run: SyncRun) => void,
	) {
		super(app);
		this.setPlaceholder("Search a sync run…");
	}

	getItems(): SyncRun[] {
		// Most recent first — the run someone wants to undo is usually a recent one.
		return [...this.runs].reverse();
	}

	getItemText(run: SyncRun): string {
		return `${run.timestamp} — ${run.scope || "(vault)"} — ${run.actions.length} action(s)`;
	}

	onChooseItem(run: SyncRun): void {
		this.onPick(run);
	}
}
