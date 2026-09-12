/**
 * A note carries a card's assigned members through a single frontmatter list
 * of readable names — never raw Trello member ids, so the frontmatter stays
 * useful in a Dataview query or a Base without a lookup table. Resolving an
 * id to a name happens where the frontmatter meets the Trello API (see
 * `features/syncNote.ts::convergeMembers`), never here.
 */

/** Default frontmatter key for a card's assigned members — configurable via `membersFrontmatterKey`. */
export const DEFAULT_MEMBERS_KEY = "trello_members";

/** On by default — costs one extra Trello request per *run*, not per note: the board's member directory, fetched once and reused. */
export const DEFAULT_SYNC_MEMBERS = true;

/** Parse a frontmatter value into a list of trimmed, non-empty member names. */
export function parseMembersRef(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
}

/** Render a member-name list back into its frontmatter form — `null` clears the key. */
export function formatMembersRef(names: string[]): string[] | null {
	return names.length === 0 ? null : names;
}

/**
 * Resolves member ids to their board directory's display names, in the
 * card's own order. An id no longer on the board (left the workspace, no
 * longer a board member) is omitted — never written raw — and reported via
 * `onUnresolved` for the caller to log.
 */
export function resolveMemberNames(
	memberIds: readonly string[],
	directory: ReadonlyMap<string, string>,
	onUnresolved?: (id: string) => void,
): string[] {
	const names: string[] = [];
	for (const id of memberIds) {
		const name = directory.get(id);
		if (name) names.push(name);
		else onUnresolved?.(id);
	}
	return names;
}
