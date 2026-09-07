import { sanitizeFileName } from "./fileName";
import { normalizeBody } from "./noteBody";

/** How to resolve a note and a card that both changed. */
export type ConflictPolicy = "newer-wins" | "prefer-local" | "prefer-remote";

export type SyncDirection = "skip" | "pull" | "push" | "conflict";

export interface SyncInput {
	localTitle: string;
	localBody: string;
	/** Note modification time, epoch ms. */
	localMtime: number;
	/** `trello_due` frontmatter value, or `null` when absent. */
	localDue: string | null;
	remoteTitle: string;
	remoteBody: string;
	/** Card `dateLastActivity`, epoch ms. */
	remoteMtime: number;
	/** Card `due` field, or `null` when unset. */
	remoteDue: string | null;
	policy: ConflictPolicy;
	/** Timestamp tolerance below which the two sides are considered simultaneous. */
	marginMs: number;
}

export interface SyncDecision {
	direction: SyncDirection;
	bodyChanged: boolean;
	titleChanged: boolean;
	dueChanged: boolean;
	reason: "identical" | "remote-newer" | "local-newer" | "within-margin" | "policy";
}

/** Empty string and absent are the same "no due date" for comparison purposes. */
function normalizeDue(value: string | null): string | null {
	return value === "" ? null : value;
}

/**
 * Decide what a linked note/card pair needs, without touching either side.
 *
 * Unlike the legacy scripts, the clock margin is applied *after* the content
 * comparison: two sides that genuinely diverged within the margin surface as a
 * `conflict` instead of being silently skipped.
 */
export function decideSync(input: SyncInput): SyncDecision {
	const bodyChanged = normalizeBody(input.localBody) !== normalizeBody(input.remoteBody);
	// Compare against the sanitized form of the remote title: the note's own
	// title is always filesystem-sanitized, so comparing against the raw card
	// title would flag every special-character title as "changed" forever and
	// push the sanitized filename back to Trello as if it were a real rename.
	const titleChanged = input.localTitle.trim() !== sanitizeFileName(input.remoteTitle).trim();
	const dueChanged = normalizeDue(input.localDue) !== normalizeDue(input.remoteDue);

	if (!bodyChanged && !titleChanged && !dueChanged) {
		return { direction: "skip", bodyChanged, titleChanged, dueChanged, reason: "identical" };
	}

	if (input.policy === "prefer-local") {
		return { direction: "push", bodyChanged, titleChanged, dueChanged, reason: "policy" };
	}
	if (input.policy === "prefer-remote") {
		return { direction: "pull", bodyChanged, titleChanged, dueChanged, reason: "policy" };
	}

	const delta = input.remoteMtime - input.localMtime;
	// An exact tie is a conflict regardless of the configured margin — there is
	// no clock-skew tolerance to apply, and picking a direction here would just
	// misreport an arbitrary side as "newer" when neither is.
	if (delta === 0 || (Math.abs(delta) <= input.marginMs && input.marginMs > 0)) {
		return { direction: "conflict", bodyChanged, titleChanged, dueChanged, reason: "within-margin" };
	}
	return delta > 0
		? { direction: "pull", bodyChanged, titleChanged, dueChanged, reason: "remote-newer" }
		: { direction: "push", bodyChanged, titleChanged, dueChanged, reason: "local-newer" };
}
