import { Modal, Setting, type App } from "obsidian";
import { describeSyncAction, type SyncRun } from "../core/syncHistory";
import { renderConfirmActions } from "./confirmActions";

/**
 * Lets the user check which of one run's actions to undo, leaving the rest in
 * place — the one genuinely new component of this feature: no existing modal
 * does multi-selection, and `FuzzySuggestModal` (used for `SyncRunPickerModal`)
 * can't by construction. Lists what each action touched (kind + path/card),
 * never its content. Nothing checked and "Undo selected" clicked → `onConfirm`
 * is still called, with an empty set; the caller decides how to report that.
 */
export class SyncActionPickerModal extends Modal {
	private readonly selected = new Set<number>();

	constructor(
		app: App,
		private readonly run: SyncRun,
		private readonly onConfirm: (selectedIndices: ReadonlySet<number>) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("tvs-action-picker");
		contentEl.createEl("h3", { text: `Undo — ${this.run.scope || "(vault)"}` });
		contentEl.createEl("p", {
			cls: "tvs-action-picker__hint",
			text: "Check the writes to undo. Anything left unchecked stays in history, still undoable later.",
		});

		const list = contentEl.createDiv({ cls: "tvs-action-picker__list" });
		this.run.actions.forEach((action, index) => {
			new Setting(list).setName(describeSyncAction(action)).addToggle((toggle) =>
				toggle.setValue(false).onChange((value) => {
					if (value) this.selected.add(index);
					else this.selected.delete(index);
				}),
			);
		});

		renderConfirmActions(
			contentEl,
			{
				label: "Undo selected",
				cls: "mod-warning",
				onClick: () => {
					this.onConfirm(new Set(this.selected));
					this.close();
				},
			},
			() => this.close(),
			// Destructive action (reverts writes) — Cancel gets initial focus (§C4).
			"cancel",
		);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
