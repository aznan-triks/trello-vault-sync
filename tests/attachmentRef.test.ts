import { describe, expect, test } from "vitest";
import {
	DEFAULT_ATTACHMENTS_KEY,
	DEFAULT_COVER_KEY,
	DEFAULT_LINKED_CARDS_KEY,
	coverImageUrl,
	extractCardShortLink,
	formatAttachmentsRef,
	formatLinkedCardsRef,
	formatWikilink,
	parseAttachmentsRef,
	parseLinkedCardsRef,
} from "../src/core/attachmentRef";

describe("DEFAULT_ATTACHMENTS_KEY", () => {
	test("is the frontmatter key used for plain attachment URLs", () => {
		expect(DEFAULT_ATTACHMENTS_KEY).toBe("trello_attachments");
	});
});

describe("DEFAULT_LINKED_CARDS_KEY", () => {
	test("is the frontmatter key used for card-link attachments", () => {
		expect(DEFAULT_LINKED_CARDS_KEY).toBe("trello_linked_cards");
	});
});

describe("DEFAULT_COVER_KEY", () => {
	test("is the key Pixelbanner itself reads", () => {
		expect(DEFAULT_COVER_KEY).toBe("banner");
	});
});

describe("coverImageUrl", () => {
	test("picks the largest scaled rendition", () => {
		const cover = { scaled: [{ url: "small", width: 100 }, { url: "big", width: 800 }, { url: "medium", width: 400 }] };
		expect(coverImageUrl(cover)).toBe("big");
	});

	test("returns null when the cover has no scaled images (a color cover, or none set)", () => {
		expect(coverImageUrl({})).toBeNull();
		expect(coverImageUrl({ scaled: [] })).toBeNull();
	});

	test("returns null when the card carries no cover field at all", () => {
		expect(coverImageUrl(null)).toBeNull();
		expect(coverImageUrl(undefined)).toBeNull();
	});
});

describe("parseAttachmentsRef", () => {
	test("keeps a well-formed string array as is", () => {
		expect(parseAttachmentsRef(["https://a", "https://b"])).toEqual(["https://a", "https://b"]);
	});

	test("drops non-string entries instead of throwing", () => {
		expect(parseAttachmentsRef(["https://a", 42, null] as unknown[])).toEqual(["https://a"]);
	});

	test("drops empty/blank entries", () => {
		expect(parseAttachmentsRef(["https://a", "", "   "])).toEqual(["https://a"]);
	});

	test("returns an empty list for anything that isn't an array", () => {
		expect(parseAttachmentsRef(undefined)).toEqual([]);
		expect(parseAttachmentsRef(null)).toEqual([]);
	});
});

describe("formatAttachmentsRef", () => {
	test("passes a non-empty list through unchanged", () => {
		expect(formatAttachmentsRef(["https://a"])).toEqual(["https://a"]);
	});

	test("returns null for an empty list, meaning the caller should clear the key", () => {
		expect(formatAttachmentsRef([])).toBeNull();
	});
});

describe("parseLinkedCardsRef / formatLinkedCardsRef", () => {
	test("mirror parseAttachmentsRef/formatAttachmentsRef", () => {
		expect(parseLinkedCardsRef(["[[A]]", " "])).toEqual(["[[A]]"]);
		expect(formatLinkedCardsRef([])).toBeNull();
		expect(formatLinkedCardsRef(["[[A]]"])).toEqual(["[[A]]"]);
	});
});

describe("extractCardShortLink", () => {
	test("extracts the shortLink from a card attachment url", () => {
		expect(extractCardShortLink("https://trello.com/c/AbC123")).toBe("AbC123");
	});

	test("extracts the shortLink even when the url has a trailing slug", () => {
		expect(extractCardShortLink("https://trello.com/c/AbC123/45-some-card-title")).toBe("AbC123");
	});

	test("returns null for a non-card url", () => {
		expect(extractCardShortLink("https://example.com/file.pdf")).toBeNull();
	});

	test("returns null for a trello board/other url", () => {
		expect(extractCardShortLink("https://trello.com/b/AbC123")).toBeNull();
	});
});

describe("formatWikilink", () => {
	test("wraps a name in double brackets", () => {
		expect(formatWikilink("Idée business X")).toBe("[[Idée business X]]");
	});
});
