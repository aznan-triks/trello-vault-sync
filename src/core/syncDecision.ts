import { isCollisionVariant, sanitizeFileName } from "./fileName";
import { sameLabelSet } from "./labelRef";
import { normalizeBody } from "./noteBody";

/** How to resolve a note and a card that both changed. */
export type ConflictPolicy = "newer-wins" | "prefer-local" | "prefer-remote";

/** `merge`: some fields come from the card and others go to it (only a decision made against a base can say so). */
export type SyncDirection = "skip" | "pull" | "push" | "conflict" | "merge";

/** Which way one field travels. */
export type Side = "pull" | "push" | "none";

/** What happens to each field the decision covers. */
export interface FieldSides {
	title: Side;
	body: Side;
	due: Side;
	/** Only ever set in `overwrite` mode — in `merge` mode labels converge outside the decision. */
	labels: Side;
}

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
	/** The caller settles the checklists item by item (from a base), so a difference there is no reason to pick a direction. Only read by `decideWithBase`. */
	checklistsByItem?: boolean;
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
	fields: FieldSides;
	reason: "identical" | "remote-newer" | "local-newer" | "within-margin" | "policy" | "remote-changed" | "local-changed" | "both-changed" | "checklists";
}

const NO_SIDES: FieldSides = { title: "none", body: "none", due: "none", labels: "none" };

/** A single-direction `direction` applied to the fields that differ (what `decideSync`, and a forced pull/push, mean by it). */
export function sidesFor(
	direction: SyncDirection,
	changed: Pick<SyncDecision, "titleChanged" | "bodyChanged" | "dueChanged" | "labelsChanged">,
): FieldSides {
	if (direction !== "pull" && direction !== "push") return NO_SIDES;
	return {
		title: changed.titleChanged ? direction : "none",
		body: changed.bodyChanged ? direction : "none",
		due: changed.dueChanged ? direction : "none",
		labels: changed.labelsChanged ? direction : "none",
	};
}

/** The card title as the note's file name would carry it — the form titles are compared in. */
export function comparableTitle(title: string, maxNameLength?: number): string {
	return sanitizeFileName(title, maxNameLength).trim();
}

/** Empty string and absent are the same "no due date" for comparison purposes. */
export function normalizeDue(value: string | null): string | null {
	return value === "" ? null : value;
}

/** Same instant counts as the same due date, whatever the ISO spelling ("…:00Z" vs "…:00.000Z"); text that does not parse is compared as written. */
export function sameDue(a: string | null, b: string | null): boolean {
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
	const remoteName = comparableTitle(input.remoteTitle, input.maxNameLength);
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

	const finish = (direction: SyncDirection, reason: SyncDecision["reason"]): SyncDecision => ({
		direction,
		bodyChanged,
		titleChanged,
		dueChanged,
		labelsChanged,
		fields: sidesFor(direction, { titleChanged, bodyChanged, dueChanged, labelsChanged }),
		reason,
	});

	if (!bodyChanged && !titleChanged && !dueChanged && !labelsChanged && input.checklistsChanged !== true) {
		return finish("skip", "identical");
	}

	if (input.policy === "prefer-local") {
		return finish("push", "policy");
	}
	if (input.policy === "prefer-remote") {
		return finish("pull", "policy");
	}

	const delta = input.remoteMtime - input.localMtime;
	// An exact tie is a conflict regardless of the configured margin — there is
	// no clock-skew tolerance to apply, and picking a direction here would just
	// misreport an arbitrary side as "newer" when neither is.
	if (delta === 0 || (Math.abs(delta) <= input.marginMs && input.marginMs > 0)) {
		return finish("conflict", "within-margin");
	}
	return delta > 0
		? finish("pull", "remote-newer")
		: finish("push", "local-newer");
}
