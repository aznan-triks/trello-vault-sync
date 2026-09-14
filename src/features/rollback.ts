import { errorMessage } from "../core/errorMessage";
import type { LogLevel } from "../core/journal";
import {
	planActionUndo,
	planTrelloUndo,
	type CurrentTrelloState,
	type SyncAction,
	type SyncRun,
	type TrelloCardFields,
} from "../core/syncHistory";
import type { VaultGateway } from "../obsidian/gateway";
import type { TrelloChecklist, TrelloClient } from "../trello/client";

export interface UndoStats {
	/** Vault writes reverted. */
	reverted: number;
	/** Trello writes reverted. */
	revertedRemote: number;
	/** Both sides combined — an action whose plan came back "skip", for any reason. */
	skipped: number;
}

async function currentStateAt(vault: VaultGateway, path: string): Promise<{ exists: boolean; content: string | null }> {
	const note = vault.noteAt(path);
	if (!note) return { exists: false, content: null };
	return { exists: true, content: await vault.read(note) };
}

/**
 * Per-undo-run cache so a card's current remote state (fields, or its
 * checklists) is fetched at most once even when several actions in the same
 * run touch it.
 */
interface TrelloStateCache {
	cardFields: Map<string, Promise<TrelloCardFields | null>>;
	checklists: Map<string, Promise<TrelloChecklist[] | null>>;
}

function createTrelloCache(): TrelloStateCache {
	return { cardFields: new Map(), checklists: new Map() };
}

/**
 * Reads through a cache, fetching at most once per key. A failed fetch is
 * logged and becomes `null` rather than rejecting: one unreadable card must
 * skip its own actions, never abort the rest of the undo. The cached value is
 * the promise itself, so the rejection is already handled inside it and a
 * second reader can never see an unhandled rejection.
 */
function cachedFetch<T>(
	cache: Map<string, Promise<T | null>>,
	cardId: string,
	fetch: () => Promise<T>,
	log: (level: LogLevel, message: string) => void,
): Promise<T | null> {
	let promise = cache.get(cardId);
	if (!promise) {
		promise = (async () => {
			try {
				return await fetch();
			} catch (error) {
				log("skip", `card ${cardId} — could not read its current state: ${errorMessage(error)}`);
				return null;
			}
		})();
		cache.set(cardId, promise);
	}
	return promise;
}

/** Fetches (and caches) a card's current fields, mapped to `TrelloCardFields`; `null` on a failed fetch (e.g. the card was deleted). */
function currentCardFields(
	client: TrelloClient,
	cache: TrelloStateCache,
	cardId: string,
	signal: AbortSignal | undefined,
	log: (level: LogLevel, message: string) => void,
): Promise<TrelloCardFields | null> {
	return cachedFetch(
		cache.cardFields,
		cardId,
		async () => {
			const remoteCard = await client.getCard(cardId, signal);
			return {
				name: remoteCard.name,
				desc: remoteCard.desc,
				due: remoteCard.due,
				idLabels: (remoteCard.labels ?? []).map((label) => label.id),
			};
		},
		log,
	);
}

/** Finds `checkItemId` among a card's (cached) checklists; `null` when the fetch failed or the item is gone. */
async function currentCheckItemState(
	client: TrelloClient,
	cache: TrelloStateCache,
	cardId: string,
	checkItemId: string,
	signal: AbortSignal | undefined,
	log: (level: LogLevel, message: string) => void,
): Promise<"complete" | "incomplete" | null> {
	const checklists = await cachedFetch(
		cache.checklists,
		cardId,
		() => client.getCardChecklists(cardId, signal),
		log,
	);
	if (!checklists) return null;
	for (const checklist of checklists) {
		const item = checklist.checkItems.find((candidate) => candidate.id === checkItemId);
		if (item) return item.state;
	}
	return null;
}

type UndoOutcome = "reverted" | "reverted-remote" | "skipped";

/** Applies one action's undo plan, vault-side or Trello-side. Returns which side (if any) it reverted on. */
async function applyUndo(
	vault: VaultGateway,
	action: SyncAction,
	log: (level: LogLevel, message: string) => void,
	client: TrelloClient | undefined,
	cache: TrelloStateCache,
	signal?: AbortSignal,
): Promise<UndoOutcome> {
	if (action.kind === "trello-card" || action.kind === "trello-checkitem") {
		if (!client) {
			log("skip", `${action.path} — Trello revert needs a connection`);
			return "skipped";
		}
		let current: CurrentTrelloState = null;
		if (action.kind === "trello-card") {
			const fields = await currentCardFields(client, cache, action.cardId, signal, log);
			if (fields) current = { kind: "card", fields };
		} else {
			const state = await currentCheckItemState(client, cache, action.cardId, action.checkItemId, signal, log);
			if (state) current = { kind: "checkitem", state };
		}
		const plan = planTrelloUndo(action, current);
		if (plan.op === "skip") {
			log("skip", `${action.path} — ${plan.reason}`);
			return "skipped";
		}
		if (plan.op === "update-card") {
			await client.updateCard(plan.cardId, plan.fields, signal);
		} else {
			await client.updateCheckItemState(plan.cardId, plan.checkItemId, plan.state, signal);
		}
		// The card no longer looks like what the cache holds. Drop it so a later
		// action on the same card is compared against the state this revert just
		// produced, not against the pre-revert snapshot.
		cache.cardFields.delete(action.cardId);
		cache.checklists.delete(action.cardId);
		log("info", `${action.path} — reverted on Trello`);
		return "reverted-remote";
	}

	const current = await currentStateAt(vault, action.path);
	const plan = planActionUndo(action, current);

	if (plan.op === "skip") {
		log("skip", `${action.path} — ${plan.reason}`);
		return "skipped";
	}
	if (plan.op === "write") {
		const note = vault.noteAt(plan.path);
		if (!note) {
			log("skip", `${plan.path} — note no longer exists`);
			return "skipped";
		}
		await vault.write(note, plan.content);
	} else if (plan.op === "create") {
		await vault.create(plan.path, plan.content);
	} else if (plan.op === "trash") {
		const note = vault.noteAt(plan.path);
		if (!note) {
			log("skip", `${plan.path} — already gone`);
			return "skipped";
		}
		await vault.trash(note);
	} else if (plan.op === "rename") {
		const note = vault.noteAt(plan.from);
		if (!note) {
			log("skip", `${plan.from} — note no longer exists`);
			return "skipped";
		}
		await vault.rename(note, plan.to);
	}
	log("info", `${action.path} — reverted`);
	return "reverted";
}

function tally(stats: UndoStats, outcome: UndoOutcome): void {
	if (outcome === "reverted") stats.reverted++;
	else if (outcome === "reverted-remote") stats.revertedRemote++;
	else stats.skipped++;
}

/**
 * Undoes every action of a run, in reverse chronological order (last write undone first).
 *
 * `signal` is checked at the top of each iteration only — an in-flight action always
 * runs to completion, it is never interrupted mid-write. Actions never reached because
 * of the abort are returned in `remainingRun`, in their original order, so the caller
 * can keep them in history for a later undo.
 *
 * `client` is optional — without it, Trello-side actions (`trello-card`,
 * `trello-checkitem`) are skipped with a "needs a connection" message rather
 * than reverted; every existing caller that never passed one keeps behaving
 * exactly as before.
 */
export async function undoRun(
	vault: VaultGateway,
	run: SyncRun,
	log: (level: LogLevel, message: string) => void = () => {},
	signal?: AbortSignal,
	client?: TrelloClient,
): Promise<{ stats: UndoStats; remainingRun: SyncRun }> {
	const stats: UndoStats = { reverted: 0, revertedRemote: 0, skipped: 0 };
	const cache = createTrelloCache();
	const reversed = [...run.actions].reverse();
	let processed = 0;
	for (const action of reversed) {
		if (signal?.aborted) break;
		const outcome = await applyUndo(vault, action, log, client, cache, signal);
		tally(stats, outcome);
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
 *
 * `client` behaves exactly as in `undoRun`.
 */
export async function undoRunForNote(
	vault: VaultGateway,
	run: SyncRun,
	notePath: string,
	log: (level: LogLevel, message: string) => void = () => {},
	signal?: AbortSignal,
	client?: TrelloClient,
): Promise<{ stats: UndoStats; remainingRun: SyncRun }> {
	const stats: UndoStats = { reverted: 0, revertedRemote: 0, skipped: 0 };
	const cache = createTrelloCache();
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
		const outcome = await applyUndo(vault, action, log, client, cache, signal);
		tally(stats, outcome);
	}
	// Not-yet-visited actions are the earliest slice of the run; put them back in original order ahead of the kept ones.
	const unvisited = reversed.slice(processed).reverse();
	return { stats, remainingRun: { ...run, actions: [...unvisited, ...remaining] } };
}
