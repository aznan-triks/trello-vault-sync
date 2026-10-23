import { isCollisionVariant, sanitizeFileName } from "./fileName";
import { sameLabelSet } from "./labelRef";
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
	/** `trello_labels` frontmatter value, parsed. Defaults to `[]`. */
	localLabels?: string[];
	/** Card's own label names, parsed. Defaults to `[]`. */
	remoteLabels?: string[];
	/**
	 * `undefined`/`"merge"` keeps labels out of the direction/skip calculation
	 * entirely — convergence happens as a non-destructive side effect elsewhere,
	 * never as a conflict. Only `"overwrite"` makes a label divergence behave
	 * like `dueChanged` here.
	 */
	labelsSyncMode?: "merge" | "overwrite";
	/** Whether the note body and the card description follow each other. Defaults to true. */
	syncDescription?: boolean;
	/** Whether the note file name and the card title follow each other. Defaults to true. */
	syncTitle?: boolean;
	/** Longest note base name (`noteNameMaxLength`) — a title truncated to it is not a title change. */
	maxNameLength?: number;
	/** Whether the note frontmatter due date and the card due follow each other. Defaults to true. */
	syncDue?: boolean;
	/** Whether labels are synchronized. Defaults to true. */
	syncLabels?: boolean;
	/** The note's checklist section and the card's checklists differ (items or checked states). Defaults to false. */
	checklistsChanged?: boolean;
	policy: ConflictPolicy;
	/** Timestamp tolerance below which the two sides are considered simultaneous. */
	marginMs: number;
}

export interface SyncDecision {
	direction: SyncDirection;
	bodyChanged: boolean;
	titleChanged: boolean;
	dueChanged: boolean;
	labelsChanged: boolean;
	reason: "identical" | "remote-newer" | "local-newer" | "within-margin" | "policy";
}

/** Empty string and absent are the same "no due date" for comparison purposes. */
function normalizeDue(value: string | null): string | null {
	return value === "" ? null : value;
}

/** Same instant counts as the same due date, whatever the ISO spelling ("…:00Z" vs "…:00.000Z"); text that does not parse is compared as written. */
function sameDue(a: string | null, b: string | null): boolean {
	const x = normalizeDue(a);
	const y = normalizeDue(b);
	if (x === y) return true;
	if (x === null || y === null) return false;
	const instant = Date.parse(x);
	return !Number.isNaN(instant) && instant === Date.parse(y);
}

/**
 * Decide what a linked note/card pair needs, without touching either side.
 *
 * Unlike the legacy scripts, the clock margin is applied *after* the content
 * comparison: two sides that genuinely diverged within the margin surface as a
 * `conflict` instead of being silently skipped.
 */
export function decideSync(input: SyncInput): SyncDecision {
	const bodyChanged = input.syncDescription !== false && normalizeBody(input.localBody) !== normalizeBody(input.remoteBody);
	// Compare against the sanitized form of the remote title: the note's own
	// title is always filesystem-sanitized, so comparing against the raw card
	// title would flag every special-character title as "changed" forever and
	// push the sanitized filename back to Trello as if it were a real rename.
	// A " (2)" on the note is the collision suffix a pull added, not a rename to push back.
	const remoteName = sanitizeFileName(input.remoteTitle, input.maxNameLength).trim();
	const localName = input.localTitle.trim();
	const titleChanged = input.syncTitle !== false && localName !== remoteName && !isCollisionVariant(localName, remoteName);
	const dueChanged = input.syncDue !== false && !sameDue(input.localDue, input.remoteDue);
	// A "merge" (or unset) mode never surfaces a label divergence as a reason to
	// sync or conflict — the labels converge as a non-destructive side effect
	// wherever the direction ends up, never a cause of it.
	const labelsChanged =
		input.syncLabels !== false &&
		input.labelsSyncMode === "overwrite" &&
		!sameLabelSet(input.localLabels ?? [], input.remoteLabels ?? []);

	if (!bodyChanged && !titleChanged && !dueChanged && !labelsChanged && input.checklistsChanged !== true) {
		return { direction: "skip", bodyChanged, titleChanged, dueChanged, labelsChanged, reason: "identical" };
	}

	if (input.policy === "prefer-local") {
		return { direction: "push", bodyChanged, titleChanged, dueChanged, labelsChanged, reason: "policy" };
	}
	if (input.policy === "prefer-remote") {
		return { direction: "pull", bodyChanged, titleChanged, dueChanged, labelsChanged, reason: "policy" };
	}

	const delta = input.remoteMtime - input.localMtime;
	// An exact tie is a conflict regardless of the configured margin — there is
	// no clock-skew tolerance to apply, and picking a direction here would just
	// misreport an arbitrary side as "newer" when neither is.
	if (delta === 0 || (Math.abs(delta) <= input.marginMs && input.marginMs > 0)) {
		return { direction: "conflict", bodyChanged, titleChanged, dueChanged, labelsChanged, reason: "within-margin" };
	}
	return delta > 0
		? { direction: "pull", bodyChanged, titleChanged, dueChanged, labelsChanged, reason: "remote-newer" }
		: { direction: "push", bodyChanged, titleChanged, dueChanged, labelsChanged, reason: "local-newer" };
}
