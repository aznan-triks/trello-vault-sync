import type { CommandContext } from "./context";
import type { SyncAction } from "../core/syncHistory";
import { wrapWithHistoryRecorder } from "../features/syncHistoryRecorder";
import type { CardRefStore, TemplateResolver, VaultGateway } from "../obsidian/gateway";

/**
 * Wraps `ctx.vault` with history recording (when `historyEnabled`) for the
 * duration of `fn`, then always records whatever actions happened — even if
 * `fn` throws — before rethrowing. Shared by every sync entry point
 * (`noteCommands.syncActive`, `syncCommands.*`) so this shape lives once.
 */
export async function withHistoryRecording<T>(
	ctx: CommandContext,
	scope: string,
	fn: (vault: VaultGateway & CardRefStore & TemplateResolver) => Promise<T>,
): Promise<T> {
	const actions: SyncAction[] = [];
	const vault = ctx.settings.historyEnabled ? wrapWithHistoryRecorder(ctx.vault, (a) => actions.push(a)) : ctx.vault;
	try {
		return await fn(vault);
	} finally {
		await ctx.recordSyncRun(scope, actions);
	}
}
