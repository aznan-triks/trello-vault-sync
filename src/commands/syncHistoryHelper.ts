import type { CommandContext } from "./context";
import type { SyncAction, TrelloCardUpdateAction, TrelloCheckItemAction } from "../core/syncHistory";
import { wrapWithHistoryRecorder } from "../features/syncHistoryRecorder";
import type { CardRefStore, TemplateResolver, VaultGateway } from "../obsidian/gateway";

/** Callback shape `NoteSyncOptions.onTrelloWrite`/`FolderSyncOptions.onTrelloWrite` expect. */
type OnTrelloWrite = (action: TrelloCardUpdateAction | TrelloCheckItemAction) => void;

/**
 * Wraps `ctx.vault` with history recording (when `historyEnabled`) for the
 * duration of `fn`, then always records whatever actions happened — even if
 * `fn` throws — before rethrowing. Shared by every sync entry point
 * (`noteCommands.syncActive`, `syncCommands.*`) so this shape lives once.
 *
 * `fn` also receives `onTrelloWrite` — pass it straight into the sync
 * options' `onTrelloWrite` field so Trello writes land in the SAME `actions`
 * array as the vault writes, interleaved in true chronological order. It is
 * `undefined` when `historyEnabled` is off, mirroring the vault wrapper.
 */
export async function withHistoryRecording<T>(
	ctx: CommandContext,
	scope: string,
	fn: (vault: VaultGateway & CardRefStore & TemplateResolver, onTrelloWrite: OnTrelloWrite | undefined) => Promise<T>,
): Promise<T> {
	const actions: SyncAction[] = [];
	const historyEnabled = ctx.settings.historyEnabled;
	const vault = historyEnabled ? wrapWithHistoryRecorder(ctx.vault, (a) => actions.push(a)) : ctx.vault;
	const onTrelloWrite: OnTrelloWrite | undefined = historyEnabled ? (a) => actions.push(a) : undefined;
	try {
		return await fn(vault, onTrelloWrite);
	} finally {
		await ctx.recordSyncRun(scope, actions);
	}
}
