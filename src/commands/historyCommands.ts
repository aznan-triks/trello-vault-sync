import { Notice } from "obsidian";
import type { CommandContext } from "./context";
import { lastRun } from "../core/syncHistory";
import { undoRun, undoRunForNote, type UndoStats } from "../features/rollback";

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
		const rest = ctx.history.slice(0, -1);
		await ctx.setHistory(remainingRun.actions.length === 0 ? rest : [...rest, remainingRun]);
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
		const rest = ctx.history.slice(0, -1);
		await ctx.setHistory(remainingRun.actions.length === 0 ? rest : [...rest, remainingRun]);
		return describeUndoStats(stats);
	});
}
