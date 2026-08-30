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
	remoteTitle: string;
	remoteBody: string;
	/** Card `dateLastActivity`, epoch ms. */
	remoteMtime: number;
	policy: ConflictPolicy;
	/** Timestamp tolerance below which the two sides are considered simultaneous. */
	marginMs: number;
}

export interface SyncDecision {
	direction: SyncDirection;
	bodyChanged: boolean;
	titleChanged: boolean;
	reason: "identical" | "remote-newer" | "local-newer" | "within-margin" | "policy";
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

	if (!bodyChanged && !titleChanged) {
		return { direction: "skip", bodyChanged, titleChanged, reason: "identical" };
	}

	if (input.policy === "prefer-local") {
		return { direction: "push", bodyChanged, titleChanged, reason: "policy" };
	}
	if (input.policy === "prefer-remote") {
		return { direction: "pull", bodyChanged, titleChanged, reason: "policy" };
	}

	const delta = input.remoteMtime - input.localMtime;
	// An exact tie is a conflict regardless of the configured margin — there is
	// no clock-skew tolerance to apply, and picking a direction here would just
	// misreport an arbitrary side as "newer" when neither is.
	if (delta === 0 || (Math.abs(delta) <= input.marginMs && input.marginMs > 0)) {
		return { direction: "conflict", bodyChanged, titleChanged, reason: "within-margin" };
	}
	return delta > 0
		? { direction: "pull", bodyChanged, titleChanged, reason: "remote-newer" }
		: { direction: "push", bodyChanged, titleChanged, reason: "local-newer" };
}
