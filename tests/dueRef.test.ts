import { describe, expect, test } from "vitest";
import { DEFAULT_DUE_KEY, formatDueRef, parseDueRef } from "../src/core/dueRef";

describe("parseDueRef", () => {
	test("keeps the ISO date string as-is, no reformatting", () => {
		expect(parseDueRef("2026-09-10T12:00:00.000Z")).toBe("2026-09-10T12:00:00.000Z");
	});

	test("trims surrounding whitespace", () => {
		expect(parseDueRef("  2026-09-10T12:00:00.000Z  ")).toBe("2026-09-10T12:00:00.000Z");
	});

	test("returns null for empty, blank, or non-string values", () => {
		expect(parseDueRef("")).toBeNull();
		expect(parseDueRef("   ")).toBeNull();
		expect(parseDueRef(undefined)).toBeNull();
		expect(parseDueRef(null)).toBeNull();
		expect(parseDueRef(42)).toBeNull();
	});
});

describe("formatDueRef", () => {
	test("passes a due date string through unchanged", () => {
		expect(formatDueRef("2026-09-10T12:00:00.000Z")).toBe("2026-09-10T12:00:00.000Z");
	});

	test("keeps null as null, meaning the caller should clear the field", () => {
		expect(formatDueRef(null)).toBeNull();
	});
});

describe("DEFAULT_DUE_KEY", () => {
	test("is the frontmatter key used for the due date", () => {
		expect(DEFAULT_DUE_KEY).toBe("trello_due");
	});
});
