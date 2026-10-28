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
		expect(normalizePersistedData(undefined)).toEqual({ settingsRaw: undefined, journal: [], history: [], lastSyncAt: null, knownLinks: {}, ignoredCards: {}, syncBases: {} });
		expect(normalizePersistedData(null)).toEqual({ settingsRaw: null, journal: [], history: [], lastSyncAt: null, knownLinks: {}, ignoredCards: {}, syncBases: {} });
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

describe("normalizePersistedData — lastSyncAt", () => {
	test("keeps a numeric lastSyncAt and drops anything else", () => {
		expect(normalizePersistedData({ settings: {}, lastSyncAt: 123 }).lastSyncAt).toBe(123);
		expect(normalizePersistedData({ settings: {}, lastSyncAt: "x" }).lastSyncAt).toBeNull();
		expect(normalizePersistedData({ settings: {} }).lastSyncAt).toBeNull();
	});
});

describe("normalizePersistedData — deleted-note memory", () => {
	test("keeps well-formed knownLinks and ignoredCards, drops the rest", () => {
		const result = normalizePersistedData({
			settings: {},
			knownLinks: { l1: ["a", 3, "b"], l2: "nope" },
			ignoredCards: { c1: { name: "N", since: "2026-10-18" }, c2: { name: 4 } },
		});
		expect(result.knownLinks).toEqual({ l1: ["a", "b"] });
		expect(result.ignoredCards).toEqual({ c1: { name: "N", since: "2026-10-18" } });
	});
	test("defaults to empty", () => {
		expect(normalizePersistedData({ settings: {} }).knownLinks).toEqual({});
		expect(normalizePersistedData(null).ignoredCards).toEqual({});
	});
});

describe("normalizePersistedData — sync bases", () => {
	test("a 1.25.1 data.json (no syncBases) loads with the rest intact and no bases", () => {
		const result = normalizePersistedData({ settings: { policy: "newer-wins" }, journal: [], history: [], lastSyncAt: 5, knownLinks: { l1: ["a"] }, ignoredCards: {} });
		expect(result.syncBases).toEqual({});
		expect(result.knownLinks).toEqual({ l1: ["a"] });
		expect(result.lastSyncAt).toBe(5);
	});

	test("keeps well-formed bases", () => {
		const base = { title: "Busy", body: "0a1b2c3d:4", due: 1_700_000_000_000, checkItems: { i1: true, i2: false }, env: '["trello_due","## Checklists",null]', at: 7 };
		expect(normalizePersistedData({ settings: {}, syncBases: { c1: base, c2: { due: null, at: 1 } } }).syncBases).toEqual({ c1: base, c2: { due: null, at: 1 } });
	});

	test("an unreadable base is ignored, never an exception", () => {
		const result = normalizePersistedData({
			settings: {},
			syncBases: { c1: "nope", c2: null, c3: { title: 4, body: ["x"], due: {}, checkItems: { i1: "yes", i2: true }, at: "now" }, c4: [] },
		});
		expect(result.syncBases).toEqual({ c3: { checkItems: { i2: true }, at: 0 } });
		expect(normalizePersistedData({ settings: {}, syncBases: "nope" }).syncBases).toEqual({});
		expect(normalizePersistedData({ settings: {}, syncBases: [1, 2] }).syncBases).toEqual({});
	});
});
