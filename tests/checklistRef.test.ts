import { describe, expect, test } from "vitest";
import {
	DEFAULT_CHECKLIST_HEADING,
	parseChecklistMarkdown,
	renderChecklistMarkdown,
	type ChecklistGroup,
} from "../src/core/checklistRef";

describe("DEFAULT_CHECKLIST_HEADING", () => {
	test("is the heading marking the checklist section", () => {
		expect(DEFAULT_CHECKLIST_HEADING).toBe("## Checklist");
	});
});

describe("renderChecklistMarkdown", () => {
	test("renders one checklist as a sub-heading with checkbox lines", () => {
		const checklists: ChecklistGroup[] = [
			{ name: "Préparation", items: [{ name: "Réserver la salle", complete: true }, { name: "Inviter", complete: false }] },
		];
		expect(renderChecklistMarkdown(checklists)).toBe(
			"## Checklist\n### Préparation\n- [x] Réserver la salle\n- [ ] Inviter",
		);
	});

	test("renders every checklist under its own sub-heading, in order", () => {
		const checklists: ChecklistGroup[] = [
			{ name: "A", items: [{ name: "a1", complete: false }] },
			{ name: "B", items: [{ name: "b1", complete: true }] },
		];
		expect(renderChecklistMarkdown(checklists)).toBe(
			"## Checklist\n### A\n- [ ] a1\n### B\n- [x] b1",
		);
	});

	test("returns null when there are no checklists at all", () => {
		expect(renderChecklistMarkdown([])).toBeNull();
	});

	test("renders a checklist with zero items as a bare sub-heading", () => {
		const checklists: ChecklistGroup[] = [{ name: "Empty", items: [] }];
		expect(renderChecklistMarkdown(checklists)).toBe("## Checklist\n### Empty");
	});
});

describe("parseChecklistMarkdown", () => {
	test("parses sub-headings and checkbox lines back into groups", () => {
		const block = "## Checklist\n### Préparation\n- [x] Réserver la salle\n- [ ] Inviter";
		expect(parseChecklistMarkdown(block)).toEqual([
			{ name: "Préparation", items: [{ name: "Réserver la salle", complete: true }, { name: "Inviter", complete: false }] },
		]);
	});

	test("parses multiple checklists in order", () => {
		const block = "## Checklist\n### A\n- [ ] a1\n### B\n- [x] b1";
		expect(parseChecklistMarkdown(block)).toEqual([
			{ name: "A", items: [{ name: "a1", complete: false }] },
			{ name: "B", items: [{ name: "b1", complete: true }] },
		]);
	});

	test("returns an empty list for a null block", () => {
		expect(parseChecklistMarkdown(null)).toEqual([]);
	});

	test("ignores stray lines that aren't a sub-heading or a checkbox item", () => {
		const block = "## Checklist\nSome free text\n### A\n- [ ] a1\nAnother note";
		expect(parseChecklistMarkdown(block)).toEqual([{ name: "A", items: [{ name: "a1", complete: false }] }]);
	});

	test("is case-insensitive on the 'x' marking an item complete", () => {
		const block = "## Checklist\n### A\n- [X] a1";
		expect(parseChecklistMarkdown(block)).toEqual([{ name: "A", items: [{ name: "a1", complete: true }] }]);
	});
});
