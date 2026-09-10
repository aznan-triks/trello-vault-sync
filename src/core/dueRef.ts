/**
 * A note carries a Trello card's due date through a single frontmatter string,
 * stored exactly as Trello returns it (ISO 8601) — no reformatting, no timezone
 * conversion. `null` means "no due date" and, on write, "clear the field".
 */

/** Default frontmatter key for the card's due date — configurable via `dueFrontmatterKey`. */
export const DEFAULT_DUE_KEY = "trello_due";

/** Parse a frontmatter value, returning `null` for anything unusable. */
export function parseDueRef(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	return trimmed === "" ? null : trimmed;
}

/** Render a due date back into its frontmatter form — the string as-is, or `null` to clear it. */
export function formatDueRef(due: string | null): string | null {
	return due;
}
