/**
 * A note points at a Trello card through a single frontmatter string.
 * Historically that string is `"<boardId>;<cardId>"`, but bare card ids and
 * un-substituted template placeholders both occur in real vaults.
 */
export interface CardRef {
	boardId: string | null;
	cardId: string;
}

const PLACEHOLDER = /\{\{|\}\}/;

/** True when the value still contains an un-substituted `{{...}}` template slot. */
export function isPlaceholder(value: string): boolean {
	return PLACEHOLDER.test(value);
}

/** Parse a frontmatter reference, returning `null` for anything unusable. */
export function parseCardRef(raw: unknown): CardRef | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	if (trimmed === "" || isPlaceholder(trimmed)) return null;

	const separator = trimmed.indexOf(";");
	if (separator === -1) return { boardId: null, cardId: trimmed };

	const boardId = trimmed.slice(0, separator).trim();
	const cardId = trimmed.slice(separator + 1).trim();
	if (cardId === "") return null;
	return { boardId: boardId === "" ? null : boardId, cardId };
}

/** Render a reference back into its frontmatter form. */
export function formatCardRef(boardId: string | null | undefined, cardId: string): string {
	return boardId ? `${boardId};${cardId}` : cardId;
}
