import { Modal, type App } from "obsidian";
import { renderConfirmActions } from "./confirmActions";

/** Generic yes/no confirmation before a destructive action — same `Modal` pattern as `ConflictModal`, never a native `confirm()`. */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly message: string,
		private readonly onConfirm: () => void,
		private readonly confirmLabel = "Continue",
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("tvs-confirm");
		contentEl.createEl("p", { text: this.message });

		renderConfirmActions(
			contentEl,
			{
				label: this.confirmLabel,
				cls: "mod-warning",
				onClick: () => {
					this.onConfirm();
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
