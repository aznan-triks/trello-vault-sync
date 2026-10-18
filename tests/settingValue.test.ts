import { describe, expect, test } from "vitest";
import { sameSettingValue, setSettingAt, settingAt } from "../src/core/settingValue";

describe("sameSettingValue", () => {
	test("scalars", () => {
		expect(sameSettingValue(1, 1)).toBe(true);
		expect(sameSettingValue("a", "b")).toBe(false);
		expect(sameSettingValue(0, false)).toBe(false);
		expect(sameSettingValue(null, undefined)).toBe(false);
		expect(sameSettingValue(NaN, NaN)).toBe(true);
	});
	test("arrays are ordered", () => {
		expect(sameSettingValue([1, 2], [1, 2])).toBe(true);
		expect(sameSettingValue([1, 2], [2, 1])).toBe(false);
		expect(sameSettingValue([1], [1, 2])).toBe(false);
	});
	test("nested objects ignore key order", () => {
		expect(sameSettingValue({ a: 1, b: { c: [1] } }, { b: { c: [1] }, a: 1 })).toBe(true);
		expect(sameSettingValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
		expect(sameSettingValue({ a: undefined }, { b: undefined })).toBe(false);
	});
	test("array versus object", () => {
		expect(sameSettingValue([], {})).toBe(false);
		expect(sameSettingValue({ 0: "a" }, ["a"])).toBe(false);
	});
});

describe("settingAt / setSettingAt", () => {
	test("dotted paths", () => {
		const settings = { a: 1, view: { side: "right" } };
		expect(settingAt(settings, "a")).toBe(1);
		expect(settingAt(settings, "view.side")).toBe("right");
		expect(settingAt(settings, "view.nope.deep")).toBeUndefined();
		setSettingAt(settings, "view.side", "left");
		expect(settings.view.side).toBe("left");
	});
});
