/**
 * Shared "primary action + Cancel" button row for a small confirmation-style
 * modal (`ConfirmModal`, `FolderPickerModal`) — same markup and `tvs-confirm__actions`
 * styling built once instead of copied into every modal that needs it.
 *
 * `focus` sets which button gets initial keyboard focus when the modal opens
 * (§C4 of `AUDIT_2026-09-25_ux-settings-features.md` — no modal focused anything
 * before this): `"primary"` (default) for a safe default action, `"cancel"` for a
 * destructive one so pressing Enter without looking doesn't trigger it.
 */
export function renderConfirmActions(
	contentEl: HTMLElement,
	primary: { label: string; cls?: string; onClick: () => void },
	onCancel: () => void,
	focus: "primary" | "cancel" = "primary",
): void {
	const actions = contentEl.createDiv({ cls: "tvs-confirm__actions" });
	const confirm = actions.createEl("button", primary.cls ? { cls: primary.cls, text: primary.label } : { text: primary.label });
	confirm.addEventListener("click", primary.onClick);
	const cancel = actions.createEl("button", { text: "Cancel" });
	cancel.addEventListener("click", onCancel);
	(focus === "cancel" ? cancel : confirm).focus();
}
