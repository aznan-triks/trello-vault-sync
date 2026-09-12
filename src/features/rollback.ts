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

/** Undoes every action of a run, in reverse chronological order (last write undone first). */
export async function undoRun(
	vault: VaultGateway,
	run: SyncRun,
	log: (level: LogLevel, message: string) => void = () => {},
): Promise<UndoStats> {
	const stats: UndoStats = { reverted: 0, skipped: 0 };
	for (const action of [...run.actions].reverse()) {
		const reverted = await applyUndo(vault, action, log);
		if (reverted) stats.reverted++;
		else stats.skipped++;
	}
	return stats;
}

/**
 * Undoes only the actions of a run that touch `notePath`, in reverse order.
 * Returns the run with those actions removed — the caller decides whether the
 * remaining run (if any actions are left) stays in history.
 */
export async function undoRunForNote(
	vault: VaultGateway,
	run: SyncRun,
	notePath: string,
	log: (level: LogLevel, message: string) => void = () => {},
): Promise<{ stats: UndoStats; remainingRun: SyncRun }> {
	const stats: UndoStats = { reverted: 0, skipped: 0 };
	const remaining: SyncAction[] = [];
	for (const action of [...run.actions].reverse()) {
		if (action.path !== notePath) {
			remaining.unshift(action);
			continue;
		}
		const reverted = await applyUndo(vault, action, log);
		if (reverted) stats.reverted++;
		else stats.skipped++;
	}
	return { stats, remainingRun: { ...run, actions: remaining } };
}
