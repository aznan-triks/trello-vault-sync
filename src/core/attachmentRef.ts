/**
 * A note carries a Trello card's attachments through two frontmatter lists:
 * plain URLs (`trello_attachments`) and, for attachments that are themselves
 * links to another Trello card, wikilinks (`trello_linked_cards`) — resolved
 * to the linked card's own note when one exists in the vault, or a
 * placeholder built from the card's name otherwise.
 */

/** Default frontmatter key for plain attachment URLs — configurable via `attachmentsFrontmatterKey`. */
export const DEFAULT_ATTACHMENTS_KEY = "trello_attachments";

/** On by default — costs one extra Trello request per note synced (attachments aren't embedded in the card object), see `syncAttachments` setting. */
export const DEFAULT_SYNC_ATTACHMENTS = true;
/** Default frontmatter key for card-link attachments — configurable via `linkedCardsFrontmatterKey`. */
export const DEFAULT_LINKED_CARDS_KEY = "trello_linked_cards";

/** Parse a frontmatter value into a list of trimmed, non-empty strings. */
export function parseAttachmentsRef(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
}

/** Render a string list back into its frontmatter form — `null` clears the key. */
export function formatAttachmentsRef(values: string[]): string[] | null {
	return values.length === 0 ? null : values;
}

/** Same shape as `parseAttachmentsRef`, kept as a separate name for the linked-cards key. */
export const parseLinkedCardsRef = parseAttachmentsRef;
/** Same shape as `formatAttachmentsRef`, kept as a separate name for the linked-cards key. */
export const formatLinkedCardsRef = formatAttachmentsRef;

/** A Trello card attachment's url, e.g. `https://trello.com/c/AbC123/45-title` — the shortLink is the segment right after `/c/`. */
const CARD_LINK_URL_PATTERN = /^https:\/\/trello\.com\/c\/([A-Za-z0-9]+)/;

/** The card shortLink an attachment url points at, or `null` if it isn't a card-link attachment. */
export function extractCardShortLink(url: string): string | null {
	return CARD_LINK_URL_PATTERN.exec(url)?.[1] ?? null;
}

/** Render a name as an Obsidian wikilink. */
export function formatWikilink(name: string): string {
	return `[[${name}]]`;
}

/** Default frontmatter key for a card's cover image — `"banner"` is the key Pixelbanner itself reads. */
export const DEFAULT_COVER_KEY = "banner";

/** On by default — no extra Trello request: `cover` rides the same card object every fetch already pulls. */
export const DEFAULT_SYNC_CARD_COVER = true;

/** A card's cover, as much of Trello's `cover` field as this plugin reads (see `trello/client.ts::TrelloCard`). */
export interface CardCoverLike {
	scaled?: { url: string; width: number }[];
}

/** The largest "scaled" rendition's url from a card's cover, or `null` when the cover isn't image-based (a plain color, nothing set, or an old cached card with no `cover` at all). */
export function coverImageUrl(cover: CardCoverLike | null | undefined): string | null {
	const images = cover?.scaled;
	if (!images || images.length === 0) return null;
	return images.reduce((largest, image) => (image.width > largest.width ? image : largest)).url;
}
