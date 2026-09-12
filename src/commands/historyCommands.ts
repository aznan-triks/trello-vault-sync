import { Notice } from "obsidian";
import type { CommandContext } from "./context";
import { lastRun } from "../core/syncHistory";
import { undoRun, undoRunForNote } from "../features/rollback";

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

	await ctx.run(
		`Undo — ${last.scope || "vault"}`,
		async (reporter) => {
			const stats = await undoRun(ctx.vault, last, (level, message) => reporter.log(level, message));
			await ctx.setHistory(ctx.history.slice(0, -1));
			return `${stats.reverted} reverted, ${stats.skipped} skipped.`;
		},
		{ cancellable: false },
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

	await ctx.run(
		`Undo — ${note.basename}`,
		async (reporter) => {
			const { stats, remainingRun } = await undoRunForNote(ctx.vault, last, note.path, (level, message) =>
				reporter.log(level, message),
			);
			const rest = ctx.history.slice(0, -1);
			await ctx.setHistory(remainingRun.actions.length === 0 ? rest : [...rest, remainingRun]);
			return `${stats.reverted} reverted, ${stats.skipped} skipped.`;
		},
		{ cancellable: false },
	);
}
