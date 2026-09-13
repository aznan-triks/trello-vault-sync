import { describe, expect, test } from "vitest";
import { resolveOverride, safeOverrideMode } from "../src/core/mappingOverride";

describe("resolveOverride", () => {
	test("inherit follows the global value", () => {
		expect(resolveOverride("inherit", true)).toBe(true);
		expect(resolveOverride("inherit", false)).toBe(false);
	});

	test("undefined (mapping created before this setting existed) behaves as inherit", () => {
		expect(resolveOverride(undefined, true)).toBe(true);
		expect(resolveOverride(undefined, false)).toBe(false);
	});

	test("on always wins over the global value", () => {
		expect(resolveOverride("on", false)).toBe(true);
		expect(resolveOverride("on", true)).toBe(true);
	});

	test("off always wins over the global value", () => {
		expect(resolveOverride("off", true)).toBe(false);
		expect(resolveOverride("off", false)).toBe(false);
	});
});

describe("safeOverrideMode", () => {
	test("passes through a valid mode", () => {
		expect(safeOverrideMode("on")).toBe("on");
		expect(safeOverrideMode("off")).toBe("off");
		expect(safeOverrideMode("inherit")).toBe("inherit");
	});

	test("falls back to inherit for anything else — missing field, corrupted data.json, stray value", () => {
		expect(safeOverrideMode(undefined)).toBe("inherit");
		expect(safeOverrideMode(null)).toBe("inherit");
		expect(safeOverrideMode("maybe")).toBe("inherit");
		expect(safeOverrideMode(42)).toBe("inherit");
	});
});
