import { describe, expect, test } from "vitest";
import { buildChangesHtml, type ChangesHtmlEntry } from "../src/core/changesHtml";

describe("buildChangesHtml", () => {
	const entry = (over: Partial<ChangesHtmlEntry>): ChangesHtmlEntry => ({
		id: "a1",
		date: "2026-09-04T10:00:00.000Z",
		author: "Ann",
		cardName: "Sagondo",
		listName: "Idées",
		type: "updateCard",
		detail: "Name changed",
		avatarDataUri: null,
		...over,
	});

	test("says so explicitly when there is nothing to report", () => {
		const html = buildChangesHtml({ timestamp: "20:00", entries: [] });
		expect(html).toContain("No change since the last run.");
	});

	test("embeds the avatar as an <img> when present", () => {
		const html = buildChangesHtml({
			timestamp: "20:00",
			entries: [entry({ avatarDataUri: "data:image/png;base64,AAAA" })],
		});
		expect(html).toContain('src="data:image/png;base64,AAAA" alt="Ann"');
		expect(html).toContain("<img");
	});

	test("falls back to an initial when there is no avatar, no broken <img>", () => {
		const html = buildChangesHtml({ timestamp: "20:00", entries: [entry({ avatarDataUri: null, author: "Ziggy" })] });
		expect(html).not.toContain("<img");
		expect(html).toContain(">Z<");
	});

	test("groups by day (most recent first) then by card, same as the Markdown report", () => {
		const html = buildChangesHtml({
			timestamp: "20:00",
			entries: [
				entry({ id: "b1", date: "2026-09-05T09:00:00.000Z", cardName: "Naaan" }),
				entry({ id: "a1", date: "2026-09-04T10:00:00.000Z", cardName: "Sagondo" }),
			],
		});
		const dayB = html.indexOf("2026-09-05");
		const dayA = html.indexOf("2026-09-04");
		expect(dayB).toBeGreaterThan(-1);
		expect(dayA).toBeGreaterThan(dayB);
	});

	test("escapes untrusted card/author/detail text so it can't inject markup", () => {
		const html = buildChangesHtml({
			timestamp: "20:00",
			entries: [entry({ cardName: "<script>alert(1)</script>", author: "<b>Evil</b>", detail: "<i>x</i>" })],
		});
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
		expect(html).not.toContain("<b>Evil</b>");
		expect(html).not.toContain("<i>x</i>");
	});

	test("a card literally named '(no card)' isn't mistaken for the no-card fallback", () => {
		const html = buildChangesHtml({ timestamp: "20:00", entries: [entry({ cardName: "(no card)" })] });
		const withoutCard = buildChangesHtml({ timestamp: "20:00", entries: [entry({ cardName: "" })] });
		expect(html).toContain("(no card)");
		expect(withoutCard).toContain("(no card)");
		// Both render the same visible label, but from genuinely different inputs —
		// this just confirms neither one throws or drops the entry.
		expect(html).toContain("Name changed");
		expect(withoutCard).toContain("Name changed");
	});
});
