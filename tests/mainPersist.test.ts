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

describe("rebuildRibbon", () => {
	test("creates ribbon icons for configured commands, applies custom colors, and removes previous icons on rebuild", () => {
		const { instance } = plugin();
		const addedIcons: Array<{ icon: string; title: string; el: { style: { color: string; setProperty: ReturnType<typeof vi.fn> }; remove: ReturnType<typeof vi.fn> } }> = [];
		(instance as unknown as { addRibbonIcon: unknown }).addRibbonIcon = vi.fn(
			(icon: string, title: string, _cb: () => void) => {
				const el = {
					style: {
						color: "",
						setProperty: vi.fn(),
					},
					remove: vi.fn(),
				};
				addedIcons.push({ icon, title, el });
				return el;
			},
		);

		instance.settings.ribbonCommandIds = ["open-sidebar", "sync-active-note"];
		instance.settings.ribbonIconColors = { "open-sidebar": "#ff0000" };

		(instance as unknown as { rebuildRibbon: () => void }).rebuildRibbon();

		expect(addedIcons).toHaveLength(2);
		expect(addedIcons[0]?.title).toBe("Open Trello Vault Sync");
		expect(addedIcons[0]?.el.style.color).toBe("#ff0000");
		expect(addedIcons[0]?.el.style.setProperty).toHaveBeenCalledWith("--icon-color", "#ff0000");
		expect(addedIcons[0]?.el.style.setProperty).toHaveBeenCalledWith("--ribbon-icon-color", "#ff0000");
		expect(addedIcons[1]?.title).toBe("Sync active note");
		expect(addedIcons[1]?.el.style.color).toBe("");

		(instance as unknown as { rebuildRibbon: () => void }).rebuildRibbon();
		expect(addedIcons[0]?.el.remove).toHaveBeenCalledTimes(1);
		expect(addedIcons[1]?.el.remove).toHaveBeenCalledTimes(1);
	});

	test("styles child svg element when present", () => {
		const { instance } = plugin();
		const svgEl = {
			style: {
				color: "",
				setProperty: vi.fn(),
			},
		};
		(instance as unknown as { addRibbonIcon: unknown }).addRibbonIcon = vi.fn(
			() => ({
				style: { color: "", setProperty: vi.fn() },
				querySelector: vi.fn((selector: string) => (selector === "svg" ? svgEl : null)),
				remove: vi.fn(),
			}),
		);

		instance.settings.ribbonCommandIds = ["open-sidebar"];
		instance.settings.ribbonIconColors = { "open-sidebar": "#00ff00" };

		(instance as unknown as { rebuildRibbon: () => void }).rebuildRibbon();

		expect(svgEl.style.color).toBe("#00ff00");
		expect(svgEl.style.setProperty).toHaveBeenCalledWith("stroke", "#00ff00");
	});
});

describe("ensureSidebarViewsLoaded", () => {
	test("wakes up deferred leaves, re-sets view state for unrecognized views, and refreshes SidebarView instances", async () => {
		const { instance } = plugin();
		const mockDeferredLeaf = {
			loadIfDeferred: vi.fn().mockResolvedValue(undefined),
			view: { refresh: vi.fn() },
			getViewState: vi.fn().mockReturnValue({ type: "trello-vault-sync-sidebar" }),
			setViewState: vi.fn().mockResolvedValue(undefined),
		};
		const mockForeignLeaf = {
			view: {},
			getViewState: vi.fn().mockReturnValue({ type: "trello-vault-sync-sidebar" }),
			setViewState: vi.fn().mockResolvedValue(undefined),
		};

		// Mock SidebarView import
		const { SidebarView } = await import("../src/ui/SidebarView");
		const mockSidebarView = Object.create(SidebarView.prototype);
		mockSidebarView.refresh = vi.fn();
		const mockSidebarLeaf = {
			view: mockSidebarView,
			getViewState: vi.fn(),
			setViewState: vi.fn(),
		};

		(instance as unknown as { app: { workspace: { getLeavesOfType: unknown } } }).app.workspace.getLeavesOfType = vi.fn(
			() => [mockDeferredLeaf, mockForeignLeaf, mockSidebarLeaf],
		);

		await instance.ensureSidebarViewsLoaded();

		expect(mockDeferredLeaf.loadIfDeferred).toHaveBeenCalledTimes(1);
		expect(mockForeignLeaf.setViewState).toHaveBeenCalledWith({ type: "trello-vault-sync-sidebar" });
		expect(mockSidebarView.refresh).toHaveBeenCalledTimes(1);
	});
});

describe("onload synchronous view registration", () => {
	test("registers VIEW_TYPE_TVS_SIDEBAR synchronously before loadData completes", async () => {
		const { instance } = plugin();
		const registeredViews: string[] = [];
		(instance as unknown as { registerView: unknown }).registerView = vi.fn((type: string) => {
			registeredViews.push(type);
		});

		let resolveLoadData: (val: unknown) => void;
		const loadDataPromise = new Promise((resolve) => {
			resolveLoadData = resolve;
		});
		(instance as unknown as { loadData: unknown }).loadData = vi.fn(() => loadDataPromise);
		(instance as unknown as { addSettingTab: unknown }).addSettingTab = vi.fn();
		(instance as unknown as { registerCommands: unknown }).registerCommands = vi.fn();
		(instance as unknown as { registerRibbon: unknown }).registerRibbon = vi.fn();
		(instance as unknown as { registerAutoSync: unknown }).registerAutoSync = vi.fn();

		const onloadPromise = instance.onload();

		// Check immediately before loadData completes
		expect(registeredViews).toContain("trello-vault-sync-sidebar");

		// Complete loadData
		resolveLoadData!({});
		await onloadPromise;
	});
});
