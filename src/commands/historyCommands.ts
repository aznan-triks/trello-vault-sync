import { Notice } from "obsidian";
import type { CommandContext } from "./context";
import { lastRun, replaceRunAt, type SyncRun } from "../core/syncHistory";
import { undoRun, undoRunForNote, undoSelectedActions, type UndoStats } from "../features/rollback";
import { SyncActionPickerModal } from "../ui/SyncActionPickerModal";
import { SyncRunPickerModal } from "../ui/SyncRunPickerModal";

/** One short sentence covering both sides of an undo, readable whether or not either side had anything to do. */
function describeUndoStats(stats: UndoStats): string {
	if (stats.revertedRemote === 0) return `${stats.reverted} reverted, ${stats.skipped} skipped.`;
	return `${stats.reverted} reverted in the vault, ${stats.revertedRemote} on Trello, ${stats.skipped} skipped.`;
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

	await ctx.run(`Undo — ${last.scope || "vault"}`, async (reporter, signal) => {
		const { stats, remainingRun } = await undoRun(
			ctx.vault,
			last,
			(level, message) => reporter.log(level, message),
			signal,
			ctx.client(reporter),
		);
		await ctx.setHistory(replaceRunAt(ctx.history, ctx.history.length - 1, remainingRun));
		return describeUndoStats(stats);
	});
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

	await ctx.run(`Undo — ${note.basename}`, async (reporter, signal) => {
		const { stats, remainingRun } = await undoRunForNote(
			ctx.vault,
			last,
			note.path,
			(level, message) => reporter.log(level, message),
			signal,
			ctx.client(reporter),
		);
		await ctx.setHistory(replaceRunAt(ctx.history, ctx.history.length - 1, remainingRun));
		return describeUndoStats(stats);
	});
}

/** Undoes exactly the checked actions of `run`, wherever it sits in `ctx.history`, leaving the rest of that run and every other run untouched. */
async function undoPickedActions(ctx: CommandContext, run: SyncRun, selectedIndices: ReadonlySet<number>): Promise<void> {
	await ctx.run(`Undo — ${run.scope || "vault"}`, async (reporter, signal) => {
		const { stats, remainingRun } = await undoSelectedActions(
			ctx.vault,
			run,
			(_action, index) => selectedIndices.has(index),
			(level, message) => reporter.log(level, message),
			signal,
			ctx.client(reporter),
		);
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
 * Turns "Show sync history" from a dead end into an entry point: pick any
 * recorded run (not just the last), then check exactly which of its writes
 * to undo — everything left unchecked stays in history, still undoable later.
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
