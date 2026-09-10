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

	test("normalizes changesHtmlPath the same way as reportPath", () => {
		const settings = normalizeSettings({ changesHtmlPath: "\\WoT\\Changes.html" });
		expect(settings.changesHtmlPath).toBe("WoT/Changes.html");
	});

	test("normalizes a mapping's folder the same way", () => {
		const settings = normalizeSettings({
			mappings: [{ listId: "l1", folder: "\\WoT\\85_Idées\\", templateName: "" }],
		});
		expect(settings.mappings[0]?.folder).toBe("WoT/85_Idées");
	});

	test("defaults excludedFolders to an empty list", () => {
		expect(normalizeSettings({}).excludedFolders).toEqual([]);
	});

	test("normalizes each excluded folder and drops empty entries", () => {
		const settings = normalizeSettings({ excludedFolders: ["\\Archive\\", "", "WoT/90_Fins/"] });
		expect(settings.excludedFolders).toEqual(["Archive", "WoT/90_Fins"]);
	});

	test("falls back to an empty list when excludedFolders is not an array", () => {
		expect(normalizeSettings({ excludedFolders: "Archive" as unknown as string[] }).excludedFolders).toEqual([]);
	});

	test("defaults ribbonCommandIds to the 4 built-in ribbon buttons", () => {
		expect(normalizeSettings({}).ribbonCommandIds).toEqual(DEFAULT_SETTINGS.ribbonCommandIds);
	});

	test("keeps an empty ribbonCommandIds as is — the user unchecked every ribbon button", () => {
		expect(normalizeSettings({ ribbonCommandIds: [] }).ribbonCommandIds).toEqual([]);
	});

	test("keeps a stale ribbonCommandIds entry — filtering an id no longer in COMMANDS happens at ribbon-build time, not here", () => {
		expect(normalizeSettings({ ribbonCommandIds: ["a-removed-command"] }).ribbonCommandIds).toEqual([
			"a-removed-command",
		]);
	});

	test("falls back to the default when ribbonCommandIds is not an array", () => {
		expect(normalizeSettings({ ribbonCommandIds: "sync-vault" as unknown as string[] }).ribbonCommandIds).toEqual(
			DEFAULT_SETTINGS.ribbonCommandIds,
		);
	});

	test("drops non-string entries from a corrupted ribbonCommandIds array", () => {
		expect(normalizeSettings({ ribbonCommandIds: ["sync-vault", 42, null] as never }).ribbonCommandIds).toEqual([
			"sync-vault",
		]);
	});

	test("defaults labelsSyncMode to merge — the non-destructive choice", () => {
		expect(normalizeSettings({}).labelsSyncMode).toBe("merge");
	});

	test("keeps an explicit overwrite choice for labelsSyncMode", () => {
		expect(normalizeSettings({ labelsSyncMode: "overwrite" }).labelsSyncMode).toBe("overwrite");
	});

	test("falls back to merge when labelsSyncMode is corrupted", () => {
		expect(normalizeSettings({ labelsSyncMode: "delete-everything" as never }).labelsSyncMode).toBe("merge");
	});
});
