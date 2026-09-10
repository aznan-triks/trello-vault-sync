import { describe, expect, test } from "vitest";
import {
	LABELS_KEY,
	formatLabelsRef,
	normalizeLabelName,
	normalizeLabelSet,
	parseLabelsRef,
	sameLabelSet,
} from "../src/core/labelRef";

describe("LABELS_KEY", () => {
	test("is the frontmatter key used for labels", () => {
		expect(LABELS_KEY).toBe("trello_labels");
	});
});

describe("parseLabelsRef", () => {
	test("keeps a well-formed string array as is", () => {
		expect(parseLabelsRef(["Bug", "Idée"])).toEqual(["Bug", "Idée"]);
	});

	test("trims each entry", () => {
		expect(parseLabelsRef(["  Bug  ", " Idée"])).toEqual(["Bug", "Idée"]);
	});

	test("drops non-string entries instead of throwing", () => {
		expect(parseLabelsRef(["Bug", 42, null, "Idée"] as unknown[])).toEqual(["Bug", "Idée"]);
	});

	test("drops empty/blank entries", () => {
		expect(parseLabelsRef(["Bug", "", "   "])).toEqual(["Bug"]);
	});

	test("returns an empty list for anything that isn't an array", () => {
		expect(parseLabelsRef(undefined)).toEqual([]);
		expect(parseLabelsRef(null)).toEqual([]);
		expect(parseLabelsRef("Bug")).toEqual([]);
	});
});

describe("formatLabelsRef", () => {
	test("passes a non-empty list through unchanged", () => {
		expect(formatLabelsRef(["Bug", "Idée"])).toEqual(["Bug", "Idée"]);
	});

	test("returns null for an empty list, meaning the caller should clear the key", () => {
		expect(formatLabelsRef([])).toBeNull();
	});
});

describe("normalizeLabelName", () => {
	test("is a case-insensitive comparison key", () => {
		expect(normalizeLabelName("Bug")).toBe(normalizeLabelName("bug"));
		expect(normalizeLabelName("  Bug  ")).toBe(normalizeLabelName("Bug"));
	});
});

describe("normalizeLabelSet", () => {
	test("trims, dedups case-insensitively, and sorts", () => {
		expect(normalizeLabelSet(["Idée", "bug", "Bug", " idée "])).toEqual(["bug", "Idée"]);
	});

	test("keeps the first-seen casing of a duplicate", () => {
		expect(normalizeLabelSet(["Bug", "BUG"])).toEqual(["Bug"]);
	});

	test("drops blank entries", () => {
		expect(normalizeLabelSet(["Bug", "", "  "])).toEqual(["Bug"]);
	});

	test("returns an empty array for an empty input", () => {
		expect(normalizeLabelSet([])).toEqual([]);
	});
});

describe("sameLabelSet", () => {
	test("is true for sets equal up to case, order and duplicates", () => {
		expect(sameLabelSet(["Bug", "Idée"], ["idée", "bug", "Bug"])).toBe(true);
	});

	test("is false when a name is missing from one side", () => {
		expect(sameLabelSet(["Bug", "Idée"], ["Bug"])).toBe(false);
	});

	test("is true for two empty sets", () => {
		expect(sameLabelSet([], [])).toBe(true);
	});
});
