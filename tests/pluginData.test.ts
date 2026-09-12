import { describe, expect, test } from "vitest";
import { normalizePersistedData } from "../src/core/pluginData";

describe("normalizePersistedData", () => {
	test("extracts settings and journal from the current format", () => {
		const result = normalizePersistedData({
			settings: { apiKey: "x" },
			journal: [{ level: "info", message: "hello" }],
		});
		expect(result.settingsRaw).toEqual({ apiKey: "x" });
		expect(result.journal).toEqual([{ level: "info", message: "hello" }]);
	});

	test("treats a legacy flat payload (no 'settings' key) as the settings themselves, with an empty journal", () => {
		const legacy = { apiKey: "x", token: "y", boardId: "b" };
		const result = normalizePersistedData(legacy);
		expect(result.settingsRaw).toEqual(legacy);
		expect(result.journal).toEqual([]);
	});

	test("drops a malformed journal entry instead of failing the whole array", () => {
		const result = normalizePersistedData({
			settings: {},
			journal: [
				{ level: "info", message: "kept" },
				{ level: "info" },
				{ message: "no level" },
				{ level: 42, message: "wrong type" },
				"not an object",
				null,
			],
		});
		expect(result.journal).toEqual([{ level: "info", message: "kept" }]);
	});

	test("journal defaults to an empty array when missing or not an array", () => {
		expect(normalizePersistedData({ settings: {} }).journal).toEqual([]);
		expect(normalizePersistedData({ settings: {}, journal: "nope" }).journal).toEqual([]);
	});

	test("handles a fresh install (undefined/null raw data)", () => {
		expect(normalizePersistedData(undefined)).toEqual({ settingsRaw: undefined, journal: [], history: [] });
		expect(normalizePersistedData(null)).toEqual({ settingsRaw: null, journal: [], history: [] });
	});

	test("extracts a well-formed sync history", () => {
		const run = {
			timestamp: "2026-09-12T00:00:00.000Z",
			scope: "WoT/Idées",
			actions: [{ kind: "body", path: "n.md", previousContent: "old", fingerprint: "abcd1234" }],
		};
		const result = normalizePersistedData({ settings: {}, history: [run] });
		expect(result.history).toEqual([run]);
	});

	test("drops a malformed run or action instead of failing the whole array", () => {
		const result = normalizePersistedData({
			settings: {},
			history: [
				{ timestamp: "t", scope: "", actions: [{ kind: "create", path: "ok.md", fingerprint: null }] },
				{ timestamp: "t", scope: "", actions: [{ kind: "body", path: "bad.md" }] },
				{ timestamp: 42, scope: "", actions: [] },
				"not an object",
				null,
			],
		});
		expect(result.history).toEqual([
			{ timestamp: "t", scope: "", actions: [{ kind: "create", path: "ok.md", fingerprint: null }] },
		]);
	});

	test("history defaults to an empty array when missing or not an array", () => {
		expect(normalizePersistedData({ settings: {} }).history).toEqual([]);
		expect(normalizePersistedData({ settings: {}, history: "nope" }).history).toEqual([]);
	});
});
