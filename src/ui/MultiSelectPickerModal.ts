import { Modal, Setting, type App } from "obsidian";
import { renderConfirmActions } from "./confirmActions";

/**
 * Generic checkbox picker for "act on a chosen subset" — the "Select
 * several…" entry in `OrphanCardPickerModal`/`PhantomNotePickerModal` opens
 * this instead of a bespoke modal per item type, same reasoning as
 * `SyncActionPickerModal` (the project's only other multi-selection modal):
 * one implementation, parameterized by a label function, rather than one
 * copy per T. Nothing checked and the confirm button clicked → `onConfirm`
 * is still called, with an empty array; the caller decides how to report that.
 */
export class MultiSelectPickerModal<T> extends Modal {
	private readonly selected = new Set<number>();

	constructor(
		app: App,
		private readonly title: string,
		private readonly items: readonly T[],
		private readonly labelFor: (item: T) => string,
		private readonly confirmLabel: string,
		private readonly onConfirm: (selected: T[]) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("tvs-multi-select");
		contentEl.createEl("h3", { text: this.title });
		contentEl.createEl("p", {
			cls: "tvs-multi-select__hint",
			text: "Check the items to include. Nothing checked means nothing happens.",
		});

		const list = contentEl.createDiv({ cls: "tvs-multi-select__list" });
		this.items.forEach((item, index) => {
			new Setting(list).setName(this.labelFor(item)).addToggle((toggle) =>
				toggle.setValue(false).onChange((value) => {
					if (value) this.selected.add(index);
					else this.selected.delete(index);
				}),
			);
		});

		renderConfirmActions(
			contentEl,
			{
				label: this.confirmLabel,
				cls: "mod-cta",
				onClick: () => {
					const chosen = this.items.filter((_, index) => this.selected.has(index));
					this.onConfirm(chosen);
					this.close();
				},
			},
			() => this.close(),
		);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
