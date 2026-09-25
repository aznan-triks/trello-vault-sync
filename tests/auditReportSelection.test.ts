import { describe, expect, test } from "vitest";
import { buildLinkReport } from "../src/core/auditReport";
import { matchReportKeys, parseLinkReportGroups, selectUncheckedKeys } from "../src/core/auditReportSelection";

const REPORT = buildLinkReport({
	scope: "",
	timestamp: "t",
	listNames: new Map([
		["l1", "To do"],
		["l2", "Done"],
	]),
	orphanCards: [
		{ id: "c1", name: "Alpha", url: "https://trello.com/c/c1", idList: "l1" },
		{ id: "c2", name: "Beta (draft)", url: "https://trello.com/c/c2", idList: "l1" },
		{ id: "c3", name: "Gamma", url: "https://trello.com/c/c3", idList: "l2" },
	],
	phantomNotes: [{ path: "Ideas/ghost.md", basename: "ghost", folder: "Ideas", cardId: "gone" }],
	unlinkedNotes: [
		{ path: "Ideas/free.md", basename: "free", folder: "Ideas", cardId: null },
		{ path: "root.md", basename: "root", folder: "", cardId: null },
	],
	checked: new Set(["https://trello.com/c/c2", "root.md"]),
});

describe("parseLinkReportGroups", () => {
	test("returns null when the note holds no link report", () => {
		expect(parseLinkReportGroups("# Something else\n- [ ] [[a.md|a]]\n")).toBeNull();
	});

	test("groups unchecked keys per Trello list and per folder, ignoring phantom notes", () => {
		const groups = parseLinkReportGroups(`My own notes\n\n${REPORT}`);
		expect(groups).toEqual([
			{ kind: "orphan-cards", name: "To do", unchecked: ["https://trello.com/c/c1"], checked: 1 },
			{ kind: "orphan-cards", name: "Done", unchecked: ["https://trello.com/c/c3"], checked: 0 },
			{ kind: "unlinked-notes", name: "Ideas", unchecked: ["Ideas/free.md"], checked: 0 },
			{ kind: "unlinked-notes", name: "Root", unchecked: [], checked: 1 },
		]);
	});

	test("reads a box the user ticked by hand with an uppercase X", () => {
		const groups = parseLinkReportGroups(REPORT.replace("- [ ] [Alpha]", "- [X] [Alpha]"));
		expect(groups?.[0]).toEqual({ kind: "orphan-cards", name: "To do", unchecked: [], checked: 2 });
	});
});

describe("selectUncheckedKeys", () => {
	const groups = parseLinkReportGroups(REPORT)!;

	test("all groups: every unchecked key of both directions", () => {
		expect(selectUncheckedKeys(groups, "all")).toEqual({
			cardKeys: ["https://trello.com/c/c1", "https://trello.com/c/c3"],
			noteKeys: ["Ideas/free.md"],
		});
	});

	test("one group: only that group's keys", () => {
		expect(selectUncheckedKeys(groups, { kind: "orphan-cards", name: "Done" })).toEqual({
			cardKeys: ["https://trello.com/c/c3"],
			noteKeys: [],
		});
		expect(selectUncheckedKeys(groups, { kind: "unlinked-notes", name: "Ideas" })).toEqual({
			cardKeys: [],
			noteKeys: ["Ideas/free.md"],
		});
	});
});

describe("matchReportKeys", () => {
	test("keeps live items in report order and lists the rest as skipped", () => {
		const live = new Map([
			["b", { id: "B" }],
			["a", { id: "A" }],
		]);
		expect(matchReportKeys(["a", "gone", "b"], live)).toEqual({
			matched: [{ id: "A" }, { id: "B" }],
			skipped: ["gone"],
		});
	});
});
