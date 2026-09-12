/**
 * Shared "primary action + Cancel" button row for a small confirmation-style
 * modal (`ConfirmModal`, `FolderPickerModal`) — same markup and `tvs-confirm__actions`
 * styling built once instead of copied into every modal that needs it.
 */
export function renderConfirmActions(
	contentEl: HTMLElement,
	primary: { label: string; cls?: string; onClick: () => void },
	onCancel: () => void,
): void {
	const actions = contentEl.createDiv({ cls: "tvs-confirm__actions" });
	const confirm = actions.createEl("button", primary.cls ? { cls: primary.cls, text: primary.label } : { text: primary.label });
	confirm.addEventListener("click", primary.onClick);
	const cancel = actions.createEl("button", { text: "Cancel" });
	cancel.addEventListener("click", onCancel);
}
