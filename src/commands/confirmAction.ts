import type { CommandContext } from "./context";
import { ConfirmModal } from "../ui/ConfirmModal";

/**
 * Runs `action` immediately when `enabled` is false; otherwise shows a
 * `ConfirmModal` first — never a native `confirm()`. Shared by force-sync
 * commands (gated on `confirmForceSync`) and undo commands (gated on
 * `confirmUndo`): same gate, different setting.
 *
 * When `enabled` is false, `action` is awaited in place so a caller that
 * awaits this function sees the work done before it resolves. When `enabled`
 * is true, the modal's own click handler drives `action` — there is nothing
 * to await until the user responds, so this resolves as soon as the modal is
 * shown.
 */
export async function confirmIfEnabled(
	ctx: CommandContext,
	enabled: boolean,
	message: string,
	confirmLabel: string,
	action: () => void | Promise<void>,
): Promise<void> {
	if (!enabled) {
		await action();
		return;
	}
	new ConfirmModal(ctx.app, message, () => void action(), confirmLabel).open();
}
