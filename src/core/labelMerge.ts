import { normalizeLabelSet, sameLabelSet } from "./labelRef";

export type LabelSyncMode = "merge" | "overwrite";

/** The non-destructive default — `undefined`/missing settings behave as this. */
export const DEFAULT_LABELS_SYNC_MODE: LabelSyncMode = "merge";

export interface LabelSyncResult {
	/** Names to write into the note's frontmatter, or `null` if unchanged. */
	nextLocal: string[] | null;
	/** Names to push to the card (after id resolution), or `null` if unchanged. */
	nextRemote: string[] | null;
}

/**
 * Decide what a note and its card need for their `trello_labels` /
 * "assigned labels" pair, without touching either side. Pure and
 * transport-agnostic — resolving a name to a Trello label id happens in the
 * caller, once it knows which names actually need pushing.
 *
 * `merge`: both sides converge on their union, regardless of `direction` — a
 * name typed on one side and missing from the other is never lost.
 * `overwrite`: mirrors `trello_due` — the `direction` side wins outright, the
 * other side is replaced wholesale (including down to an empty list).
 */
export function resolveLabelSync(
	local: string[],
	remote: string[],
	mode: LabelSyncMode,
	direction: "pull" | "push",
): LabelSyncResult {
	if (mode === "overwrite") {
		if (direction === "pull") {
			return { nextLocal: sameLabelSet(local, remote) ? null : normalizeLabelSet(remote), nextRemote: null };
		}
		return { nextLocal: null, nextRemote: sameLabelSet(local, remote) ? null : normalizeLabelSet(local) };
	}

	const union = normalizeLabelSet([...local, ...remote]);
	return {
		nextLocal: sameLabelSet(local, union) ? null : union,
		nextRemote: sameLabelSet(remote, union) ? null : union,
	};
}
