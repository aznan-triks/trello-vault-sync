/** One reversible write a sync made, as recorded by `features/syncHistoryRecorder.ts`. */
export type SyncActionKind = "body" | "frontmatter" | "create" | "rename" | "trash" | "trello-card" | "trello-checkitem";

interface SyncActionBase {
	kind: SyncActionKind;
	/** Path where the note lives right after this action — its identity going forward. */
	path: string;
	/** Fingerprint of the note's content right after this action; `null` when the action leaves nothing at `path` ("trash"). */
	fingerprint: string | null;
}

export interface BodyOrFrontmatterAction extends SyncActionBase {
	kind: "body" | "frontmatter";
	/** Full file content right before this action. */
	previousContent: string;
}

export interface CreateAction extends SyncActionBase {
	kind: "create";
}

export interface RenameAction extends SyncActionBase {
	kind: "rename";
	/** Path before the rename. */
	previousPath: string;
}

export interface TrashAction extends SyncActionBase {
	kind: "trash";
	fingerprint: null;
	/** Full file content right before it was trashed. */
	previousContent: string;
}

/** Card fields as recorded by a Trello write: `updateCard(cardId, {name?, desc?, due?, idLabels?})`. */
export interface TrelloCardFields {
	name?: string;
	desc?: string;
	due?: string | null;
	idLabels?: string[];
}

/** Card fields as they were immediately before a push, and as the push left them. Only the fields the push actually wrote appear. */
export interface TrelloCardUpdateAction {
	kind: "trello-card";
	/** Path of the note whose sync made this write — lets per-note undo filter on it, exactly like the vault actions. */
	path: string;
	cardId: string;
	previous: TrelloCardFields;
	written: TrelloCardFields;
}

export interface TrelloCheckItemAction {
	kind: "trello-checkitem";
	path: string;
	cardId: string;
	checkItemId: string;
	previousState: "complete" | "incomplete";
	writtenState: "complete" | "incomplete";
}

export type SyncAction =
	| BodyOrFrontmatterAction
	| CreateAction
	| RenameAction
	| TrashAction
	| TrelloCardUpdateAction
	| TrelloCheckItemAction;

/** One completed sync, as an ordered, invertible list of the writes it made. */
export interface SyncRun {
	/** ISO timestamp of the run. */
	timestamp: string;
	/** Note path, folder, or "" for a whole-vault run — whatever scope the command targeted. */
	scope: string;
	actions: SyncAction[];
}

/**
 * Deterministic, non-cryptographic content fingerprint (FNV-1a, 32-bit) — only
 * used to detect "has this file changed since the run", not a security
 * primitive, so a 32-bit hash is enough headroom for accidental collisions.
 */
export function fingerprint(content: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < content.length; i++) {
		hash ^= content.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Appends a run to a bounded history kept oldest-first, dropping the oldest
 * once `maxRuns` is exceeded — same shape as `journal.ts::appendJournalEntry`.
 */
export function appendSyncRun(runs: readonly SyncRun[], run: SyncRun, maxRuns: number): SyncRun[] {
	const next = [...runs, run];
	return next.length > maxRuns ? next.slice(next.length - maxRuns) : next;
}

/** The most recently recorded run, or `undefined` when history is empty. */
export function lastRun(runs: readonly SyncRun[]): SyncRun | undefined {
	return runs[runs.length - 1];
}

/** What `features/rollback.ts` should do to the vault to invert one action, decided without touching any IO. */
export type UndoPlan =
	| { op: "write"; path: string; content: string }
	| { op: "create"; path: string; content: string }
	| { op: "trash"; path: string }
	| { op: "rename"; from: string; to: string }
	| { op: "skip"; reason: string };

/**
 * Decides how to invert one action given the note's *current* state at
 * `action.path` — pure so every edge case (note edited, note deleted, a note
 * already occupying a to-be-recreated path) is a plain unit test, no fake
 * vault required. Fail Fast: anything but an exact fingerprint match (or, for
 * "trash", an exact absence) is a "skip", never a silent overwrite of content
 * the user changed after the run.
 */
export function planActionUndo(
	action: BodyOrFrontmatterAction | CreateAction | RenameAction | TrashAction,
	current: { exists: boolean; content: string | null },
): UndoPlan {
	switch (action.kind) {
		case "body":
		case "frontmatter": {
			if (!current.exists || current.content === null) return { op: "skip", reason: "note no longer exists" };
			if (fingerprint(current.content) !== action.fingerprint) return { op: "skip", reason: "changed since the run" };
			return { op: "write", path: action.path, content: action.previousContent };
		}
		case "create": {
			if (!current.exists || current.content === null) return { op: "skip", reason: "note no longer exists" };
			if (fingerprint(current.content) !== action.fingerprint) return { op: "skip", reason: "changed since the run" };
			return { op: "trash", path: action.path };
		}
		case "rename": {
			if (!current.exists || current.content === null) return { op: "skip", reason: "note no longer exists" };
			if (fingerprint(current.content) !== action.fingerprint) return { op: "skip", reason: "changed since the run" };
			return { op: "rename", from: action.path, to: action.previousPath };
		}
		case "trash": {
			if (current.exists) return { op: "skip", reason: "a note already exists at that path" };
			return { op: "create", path: action.path, content: action.previousContent };
		}
	}
}

/**
 * What a Trello object looks like right now, as read back just before an undo.
 * Discriminated rather than a bare union of shapes: `planTrelloUndo` then cannot
 * compare a checklist item's state against a card's fields even by accident.
 * `null` means it could not be read at all (deleted card, failed request).
 */
export type CurrentTrelloState =
	| { kind: "card"; fields: TrelloCardFields }
	| { kind: "checkitem"; state: "complete" | "incomplete" }
	| null;

/** What `features/rollback.ts` should do to Trello to invert one Trello write, decided without touching any network call. */
export type TrelloUndoPlan =
	| { op: "update-card"; cardId: string; fields: TrelloCardFields }
	| { op: "set-check-item"; cardId: string; checkItemId: string; state: "complete" | "incomplete" }
	| { op: "skip"; reason: string };

function idLabelsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	if (a.length !== b.length) return false;
	return a.every((value, index) => value === b[index]);
}

function trelloFieldEquals<K extends keyof TrelloCardFields>(field: K, a: TrelloCardFields, b: TrelloCardFields): boolean {
	if (field === "idLabels") return idLabelsEqual(a.idLabels, b.idLabels);
	return a[field] === b[field];
}

/**
 * Decides how to invert one Trello write given the card's *current* remote
 * state — pure so every edge case (card gone, field changed remotely, field
 * re-toggled) is a plain unit test, no live Trello call required. Fail Fast:
 * a field is only reverted when it still holds exactly what the run wrote;
 * anything else is dropped from the revert rather than silently overwritten.
 */
export function planTrelloUndo(
	action: TrelloCardUpdateAction | TrelloCheckItemAction,
	current: CurrentTrelloState,
): TrelloUndoPlan {
	if (current === null) return { op: "skip", reason: "card no longer exists" };

	switch (action.kind) {
		case "trello-card": {
			// Discriminated, so a caller that fetched the wrong thing is a compile
			// error at the call site and a loud skip here — never a silent
			// comparison of a checklist state against card fields.
			if (current.kind !== "card") return { op: "skip", reason: "unexpected remote state" };
			const fields: TrelloCardFields = {};
			for (const key of Object.keys(action.written) as (keyof TrelloCardFields)[]) {
				if (!trelloFieldEquals(key, current.fields, action.written)) continue;
				(fields as Record<string, unknown>)[key] = action.previous[key];
			}
			if (Object.keys(fields).length === 0) return { op: "skip", reason: "changed since the run" };
			const revertsSomething = (Object.keys(fields) as (keyof TrelloCardFields)[]).some(
				(key) => !trelloFieldEquals(key, fields, action.written),
			);
			if (!revertsSomething) return { op: "skip", reason: "nothing to revert" };
			return { op: "update-card", cardId: action.cardId, fields };
		}
		case "trello-checkitem": {
			if (current.kind !== "checkitem") return { op: "skip", reason: "unexpected remote state" };
			if (current.state !== action.writtenState) return { op: "skip", reason: "changed since the run" };
			if (action.previousState === action.writtenState) return { op: "skip", reason: "nothing to revert" };
			return { op: "set-check-item", cardId: action.cardId, checkItemId: action.checkItemId, state: action.previousState };
		}
	}
}
