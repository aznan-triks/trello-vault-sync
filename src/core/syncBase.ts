import { isCollisionVariant } from "./fileName";
import { normalizeBody } from "./noteBody";
import {
	comparableTitle,
	decideSync,
	normalizeDue,
	sameDue,
	sidesFor,
	type FieldSides,
	type Side,
	type SyncDecision,
	type SyncInput,
} from "./syncDecision";
import { fingerprint } from "./syncHistory";

/**
 * What a linked note/card pair looked like right after its last successful sync: the common ancestor that
 * lets each field tell which side changed since, without asking either side's clock. A field left out was not
 * in agreement on both sides (or not synced) when it was recorded — the decision then falls back to the clocks.
 */
export interface SyncBase {
	/** Card title as compared (see `comparableTitle`). */
	title?: string;
	/** `bodyKey` of the normalized body. */
	body?: string;
	/** Due date as an instant (`dueKey`); `null` = no due date. */
	due?: number | string | null;
	/** `checkItemId` → checked, for every item both sides agreed on. */
	checkItems?: Record<string, boolean>;
	/** Epoch ms of the recording — diagnostics only, never a decision clock. */
	at: number;
}

/** How `syncNote` reaches the bases kept in `data.json`. */
export interface SyncBaseStore {
	get(cardId: string): SyncBase | undefined;
	set(cardId: string, base: SyncBase): void;
	drop(cardId: string): void;
}

/**
 * Body fingerprint plus length.
 * shortcut: a 32-bit hash plus the length — a collision would hide one change (~1 in 250 million), move to SHA-256 (crypto.subtle) if a real case shows up.
 */
export function bodyKey(body: string): string {
	const normalized = normalizeBody(body);
	return `${fingerprint(normalized)}:${normalized.length}`;
}

/** A due date as an instant, so two spellings of the same moment are one value; text that does not parse is kept as written. */
export function dueKey(due: string | null): number | string | null {
	const normalized = normalizeDue(due);
	if (normalized === null) return null;
	const instant = Date.parse(normalized);
	return Number.isNaN(instant) ? normalized : instant;
}

/** Both sides of the pair as they stand once a sync is over, plus which fields the sync keeps in step. */
export interface SyncedState {
	localTitle: string;
	remoteTitle: string;
	maxNameLength?: number;
	localBody: string;
	remoteBody: string;
	localDue: string | null;
	remoteDue: string | null;
	syncTitle?: boolean;
	syncDescription?: boolean;
	syncDue?: boolean;
	checkItems?: Record<string, boolean>;
}

/** The base to record for a pair in this state: each synced field the two sides agree on, nothing for the others. */
export function baseFromState(state: SyncedState, at: number): SyncBase {
	const base: SyncBase = { at };
	const remoteName = comparableTitle(state.remoteTitle, state.maxNameLength);
	const localName = state.localTitle.trim();
	if (state.syncTitle !== false && (localName === remoteName || isCollisionVariant(localName, remoteName))) base.title = remoteName;
	if (state.syncDescription !== false && bodyKey(state.localBody) === bodyKey(state.remoteBody)) base.body = bodyKey(state.localBody);
	if (state.syncDue !== false && sameDue(state.localDue, state.remoteDue)) base.due = dueKey(state.localDue);
	if (state.checkItems) base.checkItems = state.checkItems;
	return base;
}

const FIELDS = ["title", "body", "due"] as const;
type Field = (typeof FIELDS)[number];

/**
 * `decideSync` with a common ancestor. Per field, a side that moved away from the base is the one that changed:
 * one side changed → it wins whatever the clocks say; both changed to the same value → nothing; both changed
 * differently → the policy (and the clocks, for `newer-wins`) settles that field, a tie being a conflict of the
 * whole pair. No base, or a synced field the base does not know → exactly `decideSync`.
 *
 * Labels (`overwrite` mode) and checklists are not fields of the base: a divergence in them is arbitrated as
 * `decideSync` does, and checklists are reconciled item by item by the caller.
 */
export function decideWithBase(input: SyncInput, base: SyncBase | undefined): SyncDecision {
	const legacy = decideSync(input);
	if (!base) return legacy;

	const synced: Record<Field, boolean> = {
		title: input.syncTitle !== false,
		body: input.syncDescription !== false,
		due: input.syncDue !== false,
	};
	if (FIELDS.some((field) => synced[field] && base[field] === undefined)) return legacy;

	const differs: Record<Field, boolean> = { title: legacy.titleChanged, body: legacy.bodyChanged, due: legacy.dueChanged };
	const localName = input.localTitle.trim();
	const moved = {
		local: {
			title: localName !== base.title && !isCollisionVariant(localName, base.title ?? ""),
			body: bodyKey(input.localBody) !== base.body,
			due: dueKey(input.localDue) !== base.due,
		},
		remote: {
			title: comparableTitle(input.remoteTitle, input.maxNameLength) !== base.title,
			body: bodyKey(input.remoteBody) !== base.body,
			due: dueKey(input.remoteDue) !== base.due,
		},
	};

	// A field that differs is one-sided when only one side moved; otherwise (both moved apart) the policy arbitrates it.
	const arbitrated = legacy.labelsChanged || FIELDS.some((field) => differs[field] && moved.local[field] === moved.remote[field]);
	if (arbitrated && legacy.direction === "conflict") return { ...legacy, fields: sidesFor("conflict", legacy) };
	const side = (field: Field): Side => {
		if (!differs[field]) return "none";
		if (moved.local[field] !== moved.remote[field]) return moved.local[field] ? "push" : "pull";
		return legacy.direction === "pull" || legacy.direction === "push" ? legacy.direction : "none";
	};
	const fields: FieldSides = {
		title: side("title"),
		body: side("body"),
		due: side("due"),
		labels: legacy.labelsChanged && (legacy.direction === "pull" || legacy.direction === "push") ? legacy.direction : "none",
	};

	const sides = Object.values(fields);
	const pull = sides.includes("pull");
	const push = sides.includes("push");
	// Nothing tracked changed: identical, or only the checklists differ — which keep the clock-based direction.
	if (!pull && !push) return legacy;
	const direction = pull && push ? "merge" : pull ? "pull" : "push";
	const reason = arbitrated ? legacy.reason : direction === "merge" ? "both-changed" : direction === "pull" ? "remote-changed" : "local-changed";
	return { ...legacy, direction, fields, reason };
}
