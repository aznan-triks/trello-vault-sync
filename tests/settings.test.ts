import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/settings/types";

describe("normalizeSettings", () => {
	test("keeps a well-formed payload as is", () => {
		const settings = normalizeSettings({ ...DEFAULT_SETTINGS, marginSeconds: 30, maxRetries: 5 });
		expect(settings.marginSeconds).toBe(30);
		expect(settings.maxRetries).toBe(5);
	});

	test("falls back to the default when a numeric field is corrupted", () => {
		const settings = normalizeSettings({ marginSeconds: "soon" as unknown as number });
		expect(settings.marginSeconds).toBe(DEFAULT_SETTINGS.marginSeconds);
	});

	test("falls back to the default when a numeric field is NaN or non-finite", () => {
		expect(normalizeSettings({ marginSeconds: Number.NaN }).marginSeconds).toBe(
			DEFAULT_SETTINGS.marginSeconds,
		);
		expect(normalizeSettings({ baseDelayMs: Number.POSITIVE_INFINITY }).baseDelayMs).toBe(
			DEFAULT_SETTINGS.baseDelayMs,
		);
	});

	test("clamps a negative numeric field to zero instead of disabling the feature it guards", () => {
		expect(normalizeSettings({ marginSeconds: -30 }).marginSeconds).toBe(0);
	});

	test("clamps maxRetries so a corrupted value cannot hammer the Trello API", () => {
		expect(normalizeSettings({ maxRetries: 9999 }).maxRetries).toBe(10);
	});

	test("clamps baseDelayMs to a sane ceiling", () => {
		expect(normalizeSettings({ baseDelayMs: 10_000_000 }).baseDelayMs).toBe(60_000);
	});

	test("falls back to the default when a string field is not a string", () => {
		const settings = normalizeSettings({ apiKey: 12345 as unknown as string });
		expect(settings.apiKey).toBe(DEFAULT_SETTINGS.apiKey);
	});

	test("falls back a mapping's non-string fields individually", () => {
		const settings = normalizeSettings({
			mappings: [{ listId: 42, folder: null, templateName: {} } as never],
		});
		expect(settings.mappings[0]).toEqual({ listId: "", folder: "", templateName: "" });
	});

	test("strips a leading slash from scope/reportPath so a folder match is never silently empty", () => {
		const settings = normalizeSettings({ scope: "/WoT", reportPath: "/WoT/Report.md" });
		expect(settings.scope).toBe("WoT");
		expect(settings.reportPath).toBe("WoT/Report.md");
	});

	test("normalizes a mapping's folder the same way", () => {
		const settings = normalizeSettings({
			mappings: [{ listId: "l1", folder: "\\WoT\\85_Idées\\", templateName: "" }],
		});
		expect(settings.mappings[0]?.folder).toBe("WoT/85_Idées");
	});
});
