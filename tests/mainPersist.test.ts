import { describe, expect, test, vi } from "vitest";

// `main.ts` pulls in every UI module; each needs only a constructible class from
// "obsidian" to load, so any export name resolves to an empty class here.
vi.mock("obsidian", () => {
	const stub = class {};
	return new Proxy({}, { get: (_target, key) => (key === "then" ? undefined : stub), has: () => true });
});

import TrelloVaultSyncPlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings/types";

function plugin() {
	const instance = new (TrelloVaultSyncPlugin as unknown as new () => TrelloVaultSyncPlugin)();
	const saveData = vi.fn(async () => {});
	Object.assign(instance, {
		saveData,
		app: { workspace: { getLeavesOfType: () => [] } },
		settings: { ...DEFAULT_SETTINGS, showPanel: false },
	});
	return { instance, saveData };
}

describe("data.json persistence", () => {
	test("a sync command that records a run writes data.json once, not twice", async () => {
		const { instance, saveData } = plugin();

		await instance.run("Sync", async () => {
			await instance.recordSyncRun("scope", [{ kind: "create", path: "a.md", fingerprint: "f" }]);
			return "done";
		});

		expect(saveData).toHaveBeenCalledTimes(1);
		expect(instance.history).toHaveLength(1);
	});
});
