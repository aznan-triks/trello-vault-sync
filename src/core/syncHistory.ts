/** One reversible write a sync made, as recorded by `features/syncHistoryRecorder.ts`. */
export type SyncActionKind = "body" | "frontmatter" | "create" | "rename" | "trash";

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

export type SyncAction = BodyOrFrontmatterAction | CreateAction | RenameAction | TrashAction;

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
export function planActionUndo(action: SyncAction, current: { exists: boolean; content: string | null }): UndoPlan {
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
