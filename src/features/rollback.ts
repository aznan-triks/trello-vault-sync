import type { LogLevel } from "../core/journal";
import { planActionUndo, type SyncAction, type SyncRun } from "../core/syncHistory";
import type { VaultGateway } from "../obsidian/gateway";

export interface UndoStats {
	reverted: number;
	skipped: number;
}

async function currentStateAt(vault: VaultGateway, path: string): Promise<{ exists: boolean; content: string | null }> {
	const note = vault.noteAt(path);
	if (!note) return { exists: false, content: null };
	return { exists: true, content: await vault.read(note) };
}

/** Applies one action's undo plan to the vault. Returns whether it reverted (vs. skipped). */
async function applyUndo(vault: VaultGateway, action: SyncAction, log: (level: LogLevel, message: string) => void): Promise<boolean> {
	const current = await currentStateAt(vault, action.path);
	const plan = planActionUndo(action, current);

	if (plan.op === "skip") {
		log("skip", `${action.path} — ${plan.reason}`);
		return false;
	}
	if (plan.op === "write") {
		const note = vault.noteAt(plan.path);
		if (!note) {
			log("skip", `${plan.path} — note no longer exists`);
			return false;
		}
		await vault.write(note, plan.content);
	} else if (plan.op === "create") {
		await vault.create(plan.path, plan.content);
	} else if (plan.op === "trash") {
		const note = vault.noteAt(plan.path);
		if (!note) {
			log("skip", `${plan.path} — already gone`);
			return false;
		}
		await vault.trash(note);
	} else if (plan.op === "rename") {
		const note = vault.noteAt(plan.from);
		if (!note) {
			log("skip", `${plan.from} — note no longer exists`);
			return false;
		}
		await vault.rename(note, plan.to);
	}
	log("info", `${action.path} — reverted`);
	return true;
}

/**
 * Undoes every action of a run, in reverse chronological order (last write undone first).
 *
 * `signal` is checked at the top of each iteration only — an in-flight action always
 * runs to completion, it is never interrupted mid-write. Actions never reached because
 * of the abort are returned in `remainingRun`, in their original order, so the caller
 * can keep them in history for a later undo.
 */
export async function undoRun(
	vault: VaultGateway,
	run: SyncRun,
	log: (level: LogLevel, message: string) => void = () => {},
	signal?: AbortSignal,
): Promise<{ stats: UndoStats; remainingRun: SyncRun }> {
	const stats: UndoStats = { reverted: 0, skipped: 0 };
	const reversed = [...run.actions].reverse();
	let processed = 0;
	for (const action of reversed) {
		if (signal?.aborted) break;
		const reverted = await applyUndo(vault, action, log);
		if (reverted) stats.reverted++;
		else stats.skipped++;
		processed++;
	}
	// Whatever the loop never reached is the earliest slice of the run — put it back in original order.
	const remainingActions = reversed.slice(processed).reverse();
	return { stats, remainingRun: { ...run, actions: remainingActions } };
}

/**
 * Undoes only the actions of a run that touch `notePath`, in reverse order.
 * Returns the run with those actions removed — the caller decides whether the
 * remaining run (if any actions are left) stays in history.
 *
 * `signal` is checked at the top of each iteration only, same contract as `undoRun`.
 * On abort, both the other-note actions (always carried over) and the not-yet-reached
 * target-note actions end up in `remainingRun`, in their original order.
 */
export async function undoRunForNote(
	vault: VaultGateway,
	run: SyncRun,
	notePath: string,
	log: (level: LogLevel, message: string) => void = () => {},
	signal?: AbortSignal,
): Promise<{ stats: UndoStats; remainingRun: SyncRun }> {
	const stats: UndoStats = { reverted: 0, skipped: 0 };
	const reversed = [...run.actions].reverse();
	const remaining: SyncAction[] = [];
	let processed = 0;
	for (const action of reversed) {
		if (signal?.aborted) break;
		processed++;
		if (action.path !== notePath) {
			remaining.unshift(action);
			continue;
		}
		const reverted = await applyUndo(vault, action, log);
		if (reverted) stats.reverted++;
		else stats.skipped++;
	}
	// Not-yet-visited actions are the earliest slice of the run; put them back in original order ahead of the kept ones.
	const unvisited = reversed.slice(processed).reverse();
	return { stats, remainingRun: { ...run, actions: [...unvisited, ...remaining] } };
}
