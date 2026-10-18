import { describe, expect, test } from "vitest";
import { applyLabelsToProperties, labelsFromProperties, mappedPropertyKeys, mergeScannedLabels } from "../src/core/labelProperty";

const pnj = { labelId: "L1", labelName: "PNJ", labelColor: "green", key: "type", values: ["pnj"] };
const pj = { labelId: "L2", labelName: "PJ", labelColor: "blue", key: "type", values: ["pj"] };
const lore = { labelId: "L3", labelName: "Lore", labelColor: null, key: "tags", values: ["lore", "wiki"] };

describe("labelProperty", () => {
	test("single value on an absent key is written as a scalar", () => {
		const fm: Record<string, unknown> = {};
		expect(applyLabelsToProperties(fm, new Set(["L1"]), [pnj], true)).toBe(true);
		expect(fm).toEqual({ type: "pnj" });
	});
	test("two labels on the same key become a list", () => {
		const fm: Record<string, unknown> = {};
		applyLabelsToProperties(fm, new Set(["L1", "L2"]), [pnj, pj], true);
		expect(fm).toEqual({ type: ["pnj", "pj"] });
	});
	test("values are appended to an existing list without touching foreign values", () => {
		const fm: Record<string, unknown> = { tags: ["perso"] };
		applyLabelsToProperties(fm, new Set(["L3"]), [lore], true);
		expect(fm).toEqual({ tags: ["perso", "lore", "wiki"] });
	});
	test("a removed label removes only its values, and the key when empty", () => {
		const fm: Record<string, unknown> = { tags: ["perso", "lore", "wiki"], type: "pnj" };
		applyLabelsToProperties(fm, new Set(), [lore, pnj], true);
		expect(fm).toEqual({ tags: ["perso"] });
	});
	test("removeValues off keeps values when the label is gone", () => {
		const fm: Record<string, unknown> = { type: "pnj" };
		expect(applyLabelsToProperties(fm, new Set(), [pnj], false)).toBe(false);
		expect(fm).toEqual({ type: "pnj" });
	});
	test("already in sync: nothing changes", () => {
		const fm: Record<string, unknown> = { type: "PNJ" };
		expect(applyLabelsToProperties(fm, new Set(["L1"]), [pnj], true)).toBe(false);
	});
	test("a label is requested only when all its values are present, case-insensitively", () => {
		expect(labelsFromProperties({ tags: ["Lore"] }, [lore])).toEqual(new Set());
		expect(labelsFromProperties({ tags: ["LORE", " wiki "] }, [lore])).toEqual(new Set(["L3"]));
	});
	test("inactive rows (empty key or values) are ignored", () => {
		expect(mappedPropertyKeys([{ ...pnj, key: "" }, { ...pj, values: [] }, lore])).toEqual(["tags"]);
	});
});

describe("mergeScannedLabels", () => {
	test("adds new labels as inactive rows, refreshes names, and reports deleted ones", () => {
		const { mappings, gone } = mergeScannedLabels(
			[{ ...pnj, labelName: "old" }, { ...pj, labelId: "L9" }],
			[{ id: "L1", name: "PNJ", color: "green" }, { id: "L5", name: "New", color: null }],
		);
		expect(mappings.map((m) => [m.labelId, m.labelName, m.key])).toEqual([["L1", "PNJ", "type"], ["L9", "PJ", "type"], ["L5", "New", ""]]);
		expect([...gone]).toEqual(["L9"]);
	});
});
