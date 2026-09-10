/**
 * A note carries a Trello card's labels through a single frontmatter list of
 * names — never ids, never colors, so the frontmatter stays readable and
 * editable by hand (the id/color resolution against the board's catalog
 * happens where the frontmatter meets the Trello API, not here).
 */

/** Frontmatter key the vault uses for the card's labels. */
export const LABELS_KEY = "trello_labels";

/** Parse a frontmatter value into a list of trimmed, non-empty label names. */
export function parseLabelsRef(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
}

/** Render a label list back into its frontmatter form — `null` clears the key. */
export function formatLabelsRef(labels: string[]): string[] | null {
	return labels.length === 0 ? null : labels;
}

/** Case-insensitive comparison key for one label name. */
export function normalizeLabelName(name: string): string {
	return name.trim().toLowerCase();
}

/**
 * The single source of truth for "same label": trims, dedups case-insensitively
 * (keeping the first-seen casing), and sorts — so two lists holding the same
 * names in a different order or case compare equal.
 */
export function normalizeLabelSet(labels: string[]): string[] {
	const seen = new Map<string, string>();
	for (const raw of labels) {
		const trimmed = raw.trim();
		if (trimmed === "") continue;
		const key = normalizeLabelName(trimmed);
		if (!seen.has(key)) seen.set(key, trimmed);
	}
	return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Lowercase, deduped, sorted comparison keys — casing-blind unlike `normalizeLabelSet`. */
function canonicalKeys(labels: string[]): string[] {
	const keys = new Set<string>();
	for (const raw of labels) {
		const trimmed = raw.trim();
		if (trimmed !== "") keys.add(normalizeLabelName(trimmed));
	}
	return [...keys].sort();
}

/** Whether two label lists hold the same names, ignoring case, order and duplicates. */
export function sameLabelSet(a: string[], b: string[]): boolean {
	const ka = canonicalKeys(a);
	const kb = canonicalKeys(b);
	return ka.length === kb.length && ka.every((value, index) => value === kb[index]);
}
