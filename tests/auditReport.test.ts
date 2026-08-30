import { describe, expect, test } from "vitest";
import {
	LINK_REPORT_HEADING,
	buildLinkReport,
	buildLocationReport,
	extractCheckedKeys,
	mergeReport,
} from "../src/core/auditReport";

describe("extractCheckedKeys", () => {
	test("remembers a ticked card by its Trello url", () => {
		const md = "- [x] [NAAAN](https://trello.com/c/1QSpEAj0/126-naaan)\n";
		expect(extractCheckedKeys(md).has("https://trello.com/c/1QSpEAj0/126-naaan")).toBe(true);
	});

	test("remembers a ticked note by its wikilink target, alias stripped", () => {
		const md = "- [x] [[WoT/85_Idées/Sagondo.md|Sagondo]]\n";
		expect(extractCheckedKeys(md).has("WoT/85_Idées/Sagondo.md")).toBe(true);
	});

	test("ignores unticked lines", () => {
		const md = "- [ ] [NAAAN](https://trello.com/c/1QSpEAj0/126-naaan)\n";
		expect(extractCheckedKeys(md).size).toBe(0);
	});

	test("returns an empty set for an empty document", () => {
		expect(extractCheckedKeys("").size).toBe(0);
	});
});

describe("buildLinkReport", () => {
	const card = (id: string, name: string, idList: string) => ({
		id,
		idBoard: "b",
		name,
		desc: "",
		url: `https://trello.com/c/${id}`,
		dateLastActivity: "",
		idList,
	});

	const input = {
		scope: "WoT",
		timestamp: "27/08/2026 20:00",
		listNames: new Map([["l1", "Idées"]]),
		orphanCards: [card("c1", "Sagondo", "l1")],
		phantomNotes: [{ path: "WoT/a.md", basename: "a", folder: "WoT", cardId: "gone" }],
		unlinkedNotes: [{ path: "WoT/b.md", basename: "b", folder: "WoT", cardId: null }],
		checked: new Set<string>(),
	};

	test("opens with the stable heading used to find the report again", () => {
		expect(buildLinkReport(input).startsWith(LINK_REPORT_HEADING)).toBe(true);
	});

	test("counts each category in its section title", () => {
		const md = buildLinkReport(input);
		expect(md).toContain("Orphan Trello cards (1)");
		expect(md).toContain("Phantom notes (1)");
		expect(md).toContain("Unlinked notes (1)");
	});

	test("groups orphan cards under their Trello list name", () => {
		expect(buildLinkReport(input)).toContain("### 📋 Idées");
	});

	test("re-ticks a card the previous report had ticked", () => {
		const md = buildLinkReport({ ...input, checked: new Set(["https://trello.com/c/c1"]) });
		expect(md).toContain("- [x] [Sagondo](https://trello.com/c/c1)");
	});

	test("leaves an unknown card unticked", () => {
		expect(buildLinkReport(input)).toContain("- [ ] [Sagondo](https://trello.com/c/c1)");
	});

	test("says so explicitly when a category is empty", () => {
		const md = buildLinkReport({ ...input, orphanCards: [] });
		expect(md).toContain("No orphan card");
	});
});

describe("buildLocationReport", () => {
	test("renders one table per Trello list", () => {
		const md = buildLocationReport({
			scope: "WoT",
			timestamp: "20:00",
			rows: [
				{ listName: "Idées", cardName: "Sagondo", folder: "85_Idées", notePath: "WoT/85_Idées/S.md" },
			],
		});
		expect(md).toContain("### 📋 Idées");
		expect(md).toContain("| Sagondo | 📂 85_Idées |");
	});

	test("escapes a pipe in a card title so the table survives", () => {
		const md = buildLocationReport({
			scope: "WoT",
			timestamp: "20:00",
			rows: [{ listName: "L", cardName: "a|b", folder: "f", notePath: "p" }],
		});
		expect(md).toContain("| a-b | 📂 f |");
	});
});

describe("mergeReport", () => {
	test("replaces a previous report and keeps whatever came before it", () => {
		const existing = `My notes\n\n${LINK_REPORT_HEADING}\nold content`;
		const merged = mergeReport(existing, `${LINK_REPORT_HEADING}\nnew`, LINK_REPORT_HEADING);
		expect(merged).toBe(`My notes\n\n${LINK_REPORT_HEADING}\nnew`);
	});

	test("appends the report when the note has none yet", () => {
		const merged = mergeReport("My notes", `${LINK_REPORT_HEADING}\nnew`, LINK_REPORT_HEADING);
		expect(merged).toBe(`My notes\n\n${LINK_REPORT_HEADING}\nnew`);
	});

	test("writes the report alone into an empty note", () => {
		const merged = mergeReport("", `${LINK_REPORT_HEADING}\nnew`, LINK_REPORT_HEADING);
		expect(merged).toBe(`${LINK_REPORT_HEADING}\nnew`);
	});
});
