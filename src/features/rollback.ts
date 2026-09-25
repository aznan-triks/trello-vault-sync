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
	signal?: AbortSignal,
): Promise<T | null> {
	let promise = cache.get(cardId);
	if (!promise) {
		promise = (async () => {
			try {
				return await fetch();
			} catch (error) {
				if (signal?.aborted) {
					log("skip", `card ${cardId} — cancelled`);
				} else {
					log("skip", `card ${cardId} — could not read its current state: ${errorMessage(error)}`);
				}
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
				closed: remoteCard.closed ?? false,
			};
		},
		log,
		signal,
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
		signal,
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
	trelloRevertDisabled = false,
): Promise<UndoOutcome> {
	if (action.kind === "trello-card" || action.kind === "trello-checkitem" || action.kind === "trello-card-create") {
		if (!client) {
			const reason = trelloRevertDisabled ? "disabled in settings" : "needs a connection";
			log("skip", `${action.path} — Trello revert ${reason}`);
			return "skipped";
		}
		if (signal?.aborted) {
			log("skip", `${action.path} — cancelled`);
			return "skipped";
		}
		let current: CurrentTrelloState = null;
		if (action.kind === "trello-checkitem") {
			const state = await currentCheckItemState(client, cache, action.cardId, action.checkItemId, signal, log);
			if (state) current = { kind: "checkitem", state };
			else if (signal?.aborted) current = { kind: "cancelled" };
		} else {
			// "trello-card" and "trello-card-create" both compare against the card's current fields.
			const fields = await currentCardFields(client, cache, action.cardId, signal, log);
			if (fields) current = { kind: "card", fields };
			else if (signal?.aborted) current = { kind: "cancelled" };
		}
		const plan = planTrelloUndo(action, current);
		if (plan.op === "skip") {
			log("skip", `${action.path} — ${plan.reason}`);
			return "skipped";
		}
		if (plan.op === "update-card") {
			await client.updateCard(plan.cardId, plan.fields, signal);
		} else if (plan.op === "archive-card") {
			await client.updateCard(plan.cardId, { closed: true }, signal);
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
 * Undoes the actions of a run for which `isSelected` returns `true`, in
 * reverse chronological order (last write undone first) — the single engine
 * behind `undoRun` (select everything) and `undoRunForNote` (select one
 * note's actions), and behind the "pick individual actions" command.
 *
 * `signal` is checked at the top of each iteration only — an in-flight action
 * always runs to completion, it is never interrupted mid-write.
 *
 * `remainingRun` keeps, in original order:
 *  - every unselected action (never touched);
 *  - every selected action the loop never reached because of an abort.
 * A selected action that was processed is dropped whether it reverted or was
 * skipped: a skip (e.g. the note changed since the run) would be skipped again
 * on every later attempt, so keeping it would pin the run as "last" forever
 * and block "Undo last sync run".
 *
 * `client` is optional — without it, Trello-side actions (`trello-card`,
 * `trello-checkitem`) are skipped rather than reverted; the skip message says
 * "needs a connection" unless `trelloRevertDisabled` is true, in which case it
 * says "disabled in settings" — the caller's `historyRevertTrelloWrites`
 * setting is off, so no client was ever passed on purpose, not because one is
 * missing. Every existing caller that never passed either keeps behaving
 * exactly as before.
 */
export async function undoSelectedActions(
	vault: VaultGateway,
	run: SyncRun,
	isSelected: (action: SyncAction, index: number) => boolean,
	log: (level: LogLevel, message: string) => void = () => {},
	signal?: AbortSignal,
	client?: TrelloClient,
	trelloRevertDisabled = false,
): Promise<{ stats: UndoStats; remainingRun: SyncRun }> {
	const stats: UndoStats = { reverted: 0, revertedRemote: 0, skipped: 0 };
	const cache = createTrelloCache();
	const kept = new Map<number, SyncAction>();
	let stop = false;

	for (let index = run.actions.length - 1; index >= 0; index--) {
		const action = run.actions[index];
		if (!action) continue;
		if (stop || !isSelected(action, index)) {
			kept.set(index, action);
			continue;
		}
		if (signal?.aborted) {
			stop = true;
			kept.set(index, action);
			continue;
		}
		const outcome = await applyUndo(vault, action, log, client, cache, signal, trelloRevertDisabled);
		tally(stats, outcome);
	}

	const remainingActions = run.actions.filter((_, index) => kept.has(index));
	return { stats, remainingRun: { ...run, actions: remainingActions } };
}

/**
 * Undoes every action of a run — `undoSelectedActions` with every action selected.
 * See its doc comment for the exact contract (abort behaviour, skipped actions,
 * optional `client`, `trelloRevertDisabled`).
 */
export function undoRun(
	vault: VaultGateway,
	run: SyncRun,
	log: (level: LogLevel, message: string) => void = () => {},
	signal?: AbortSignal,
	client?: TrelloClient,
	trelloRevertDisabled = false,
): Promise<{ stats: UndoStats; remainingRun: SyncRun }> {
	return undoSelectedActions(vault, run, () => true, log, signal, client, trelloRevertDisabled);
}

/**
 * Undoes only the actions of a run that touch `notePath` — `undoSelectedActions`
 * filtered to that note's actions. See its doc comment for the exact contract.
 */
export function undoRunForNote(
	vault: VaultGateway,
	run: SyncRun,
	notePath: string,
	log: (level: LogLevel, message: string) => void = () => {},
	signal?: AbortSignal,
	client?: TrelloClient,
	trelloRevertDisabled = false,
): Promise<{ stats: UndoStats; remainingRun: SyncRun }> {
	return undoSelectedActions(vault, run, (action) => action.path === notePath, log, signal, client, trelloRevertDisabled);
}
