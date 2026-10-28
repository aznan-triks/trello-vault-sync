import { Notice } from "obsidian";
import { confirmIfEnabled } from "./confirmAction";
import type { CommandContext } from "./context";
import { lastRun, replaceRunAt, type SyncAction, type SyncRun } from "../core/syncHistory";
import { undoRun, undoRunForNote, undoSelectedActions, type UndoStats } from "../features/rollback";
import { SyncActionPickerModal } from "../ui/SyncActionPickerModal";
import { SyncRunPickerModal } from "../ui/SyncRunPickerModal";
import type { TrelloClient } from "../trello/client";
import type { Reporter } from "../obsidian/gateway";

/** One short sentence covering both sides of an undo, readable whether or not either side had anything to do. */
function describeUndoStats(stats: UndoStats): string {
	if (stats.revertedRemote === 0) return `${stats.reverted} reverted, ${stats.skipped} skipped.`;
	return `${stats.reverted} reverted in the vault, ${stats.revertedRemote} on Trello, ${stats.skipped} skipped.`;
}

/**
 * The Trello client to hand an undo, and whether Trello-side actions are
 * skipped on purpose — `historyRevertTrelloWrites` off means no client is
 * built at all (no unwanted request, no unwanted retry/backoff noise), and
 * `rollback.ts` reports the skip as "disabled in settings" rather than
 * "needs a connection".
 */
function undoClientFor(ctx: CommandContext, reporter: Reporter): { client: TrelloClient | undefined; trelloRevertDisabled: boolean } {
	if (!ctx.settings.historyRevertTrelloWrites) return { client: undefined, trelloRevertDisabled: true };
	return { client: ctx.client(reporter), trelloRevertDisabled: false };
}

/** The card each action touched, read before an undo: an undo may trash or move the very note that names the card. */
function cardIdsOf(ctx: CommandContext, run: SyncRun): Map<SyncAction, string> {
	const ids = new Map<SyncAction, string>();
	for (const action of run.actions) {
		const note = "cardId" in action ? null : (ctx.vault.noteAt(action.path) ?? (action.kind === "rename" ? ctx.vault.noteAt(action.previousPath) : null));
		const cardId = "cardId" in action ? action.cardId : note ? ctx.vault.getCardRef(note)?.cardId : undefined;
		if (cardId) ids.set(action, cardId);
	}
	return ids;
}

/**
 * After an undo, what each side holds is no longer what the recorded sync base describes: drop the base of every
 * card an undone action touched, so the next sync decides those pairs by the clocks again (the safe fallback).
 */
function forgetBases(ctx: CommandContext, ids: ReadonlyMap<SyncAction, string>, reverted: readonly SyncAction[]): void {
	const store = ctx.noteOptions().syncBase;
	if (!store) return;
	for (const action of reverted) {
		const cardId = ids.get(action);
		if (cardId) store.drop(cardId);
	}
}

export async function showSyncHistory(ctx: CommandContext): Promise<void> {
	if (ctx.history.length === 0) {
		new Notice("Trello Vault Sync: no sync history yet.");
		return;
	}

	await ctx.run(
		"Sync history",
		async (reporter) => {
			for (const run of [...ctx.history].reverse()) {
				reporter.log("info", `${run.timestamp} — ${run.scope || "(vault)"} — ${run.actions.length} action(s)`);
			}
			reporter.log("info", 'To undo a run other than the last, or just part of one, use "Undo a sync run (pick what to undo)".');
			return `${ctx.history.length} run(s) recorded.`;
		},
		// Iterates the in-memory history only: no IO, nothing to interrupt.
		{ cancellable: false },
	);
}

export async function undoLastSyncRun(ctx: CommandContext): Promise<void> {
	if (!ctx.settings.historyEnabled) {
		new Notice("Trello Vault Sync: sync history is disabled in settings.");
		return;
	}
	const last = lastRun(ctx.history);
	if (!last) {
		new Notice("Trello Vault Sync: no sync run to undo.");
		return;
	}

	const doUndo = async () => {
		await ctx.run(`Undo — ${last.scope || "vault"}`, async (reporter, signal) => {
			const { client, trelloRevertDisabled } = undoClientFor(ctx, reporter);
			const ids = cardIdsOf(ctx, last);
			const { stats, remainingRun, reverted } = await undoRun(
				ctx.vault,
				last,
				(level, message) => reporter.log(level, message),
				signal,
				client,
				trelloRevertDisabled,
			);
			forgetBases(ctx, ids, reverted);
			await ctx.setHistory(replaceRunAt(ctx.history, ctx.history.length - 1, remainingRun));
			return describeUndoStats(stats);
		});
	};

	await confirmIfEnabled(
		ctx,
		ctx.settings.confirmUndo,
		`Undo the last sync run (${last.scope || "vault"})? This reverts its writes in the vault${
			ctx.settings.historyRevertTrelloWrites ? " and on Trello" : ""
		}.`,
		"Undo",
		doUndo,
	);
}

export async function undoLastSyncForActiveNote(ctx: CommandContext): Promise<void> {
	if (!ctx.settings.historyEnabled) {
		new Notice("Trello Vault Sync: sync history is disabled in settings.");
		return;
	}
	const note = ctx.activeNote();
	if (!note) return;
	const last = lastRun(ctx.history);
	if (!last) {
		new Notice("Trello Vault Sync: no sync run to undo.");
		return;
	}

	const doUndo = async () => {
		await ctx.run(`Undo — ${note.basename}`, async (reporter, signal) => {
			const { client, trelloRevertDisabled } = undoClientFor(ctx, reporter);
			const ids = cardIdsOf(ctx, last);
			const { stats, remainingRun, reverted } = await undoRunForNote(
				ctx.vault,
				last,
				note.path,
				(level, message) => reporter.log(level, message),
				signal,
				client,
				trelloRevertDisabled,
			);
			forgetBases(ctx, ids, reverted);
			await ctx.setHistory(replaceRunAt(ctx.history, ctx.history.length - 1, remainingRun));
			return describeUndoStats(stats);
		});
	};

	await confirmIfEnabled(
		ctx,
		ctx.settings.confirmUndo,
		`Undo the last sync for "${note.basename}"? This reverts its writes in the vault${
			ctx.settings.historyRevertTrelloWrites ? " and on Trello" : ""
		}.`,
		"Undo",
		doUndo,
	);
}

/** Undoes exactly the checked actions of `run`, wherever it sits in `ctx.history`, leaving the rest of that run and every other run untouched. */
async function undoPickedActions(ctx: CommandContext, run: SyncRun, selectedIndices: ReadonlySet<number>): Promise<void> {
	await ctx.run(`Undo — ${run.scope || "vault"}`, async (reporter, signal) => {
		const { client, trelloRevertDisabled } = undoClientFor(ctx, reporter);
		const ids = cardIdsOf(ctx, run);
		const { stats, remainingRun, reverted } = await undoSelectedActions(
			ctx.vault,
			run,
			(_action, index) => selectedIndices.has(index),
			(level, message) => reporter.log(level, message),
			signal,
			client,
			trelloRevertDisabled,
		);
		forgetBases(ctx, ids, reverted);
		// The run object is the very one taken from `ctx.history` when the picker
		// opened; `indexOf` finds it by identity. If history moved on in the
		// meantime (another undo, a new sync) and it's no longer there, there is
		// nothing left to replace — leave history exactly as it is rather than
		// guess at a position.
		const index = ctx.history.indexOf(run);
		if (index !== -1) await ctx.setHistory(replaceRunAt(ctx.history, index, remainingRun));
		return describeUndoStats(stats);
	});
}

/**
 * Turns "Show the sync history" from a dead end into an entry point: pick any
 * recorded run (not just the last), then check exactly which of its writes
 * to undo — everything left unchecked stays in history, still undoable later.
 *
 * Not gated behind `confirmUndo`: the action picker this opens into already
 * ends on its own explicit "Undo selected" button, which is itself the
 * confirmation — stacking a second modal in front of it would just be one
 * more click to dismiss before reaching the real decision.
 */
export async function undoSyncRunPicked(ctx: CommandContext): Promise<void> {
	if (!ctx.settings.historyEnabled) {
		new Notice("Trello Vault Sync: sync history is disabled in settings.");
		return;
	}
	if (ctx.history.length === 0) {
		new Notice("Trello Vault Sync: no sync history yet.");
		return;
	}

	new SyncRunPickerModal(ctx.app, ctx.history, (run) => {
		new SyncActionPickerModal(ctx.app, run, (selectedIndices) => {
			if (selectedIndices.size === 0) {
				new Notice("Trello Vault Sync: nothing selected — nothing undone.");
				return;
			}
			void undoPickedActions(ctx, run, selectedIndices);
		}).open();
	}).open();
}
