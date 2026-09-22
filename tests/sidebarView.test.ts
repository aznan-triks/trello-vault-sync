import { describe, expect, test, vi } from "vitest";

// Lightweight in-memory DOM fake to exercise SidebarView in Node environment
class FakeElement {
	children: FakeElement[] = [];
	classList = new Set<string>();
	attributes: Record<string, string> = {};
	listeners: Record<string, ((e: unknown) => void)[]> = {};
	text = "";
	value = "";
	style: Record<string, string> = {};

	constructor(public tagName: string = "div") {}

	empty(): void {
		this.children = [];
		this.text = "";
	}

	addClass(...cls: string[]): this {
		for (const c of cls) for (const part of c.split(" ")) if (part) this.classList.add(part);
		return this;
	}

	removeClass(...cls: string[]): this {
		for (const c of cls) for (const part of c.split(" ")) if (part) this.classList.delete(part);
		return this;
	}

	toggleClass(cls: string, val: boolean): this {
		if (val) this.addClass(cls);
		else this.removeClass(cls);
		return this;
	}

	setAttribute(name: string, val: string): void {
		this.attributes[name] = val;
	}

	getAttribute(name: string): string | undefined {
		return this.attributes[name];
	}

	addEventListener(event: string, handler: (e: unknown) => void): void {
		this.listeners[event] = this.listeners[event] ?? [];
		this.listeners[event].push(handler);
	}

	trigger(event: string, payload: unknown = {}): void {
		for (const h of this.listeners[event] ?? []) h(payload);
	}

	createEl(tag: string, options?: { cls?: string; text?: string; type?: string; attr?: Record<string, string> }): FakeElement {
		const el = new FakeElement(tag);
		if (options?.cls) el.addClass(options.cls);
		if (options?.text) el.text = options.text;
		if (options?.attr) {
			for (const [k, v] of Object.entries(options.attr)) el.setAttribute(k, v);
		}
		this.children.push(el);
		return el;
	}

	createDiv(options?: { cls?: string; text?: string }): FakeElement {
		return this.createEl("div", options);
	}

	createSpan(options?: { cls?: string; text?: string }): FakeElement {
		return this.createEl("span", options);
	}

	setText(t: string): void {
		this.text = t;
	}

	querySelectorAll(selector: string): FakeElement[] {
		const result: FakeElement[] = [];
		const isClass = selector.startsWith(".");
		const target = isClass ? selector.slice(1) : selector;

		function walk(node: FakeElement) {
			for (const child of node.children) {
				if (isClass && child.classList.has(target)) result.push(child);
				else if (!isClass && child.tagName.toLowerCase() === target.toLowerCase()) result.push(child);
				walk(child);
			}
		}

		walk(this);
		return result;
	}

	querySelector(selector: string): FakeElement | null {
		return this.querySelectorAll(selector)[0] ?? null;
	}

	remove(): void {
		// detached
	}

	focus(): void {}

	prepend(child: FakeElement): void {
		this.children.unshift(child);
	}

	get lastElementChild(): FakeElement | null {
		return this.children[this.children.length - 1] ?? null;
	}
}

// Global factory mock for createDiv
(globalThis as unknown as { createDiv: (opts?: { cls?: string }) => FakeElement }).createDiv = (opts) => {
	const el = new FakeElement("div");
	if (opts?.cls) el.addClass(opts.cls);
	return el;
};

vi.mock("obsidian", () => ({
	ItemView: class ItemView {
		contentEl = new FakeElement("div");
		registerEvent = vi.fn();
		onResize(): void {}
		constructor(public leaf: unknown) {}
	},
	Setting: class Setting {
		settingEl = new FakeElement("div");
		constructor(container: FakeElement) {
			this.settingEl.addClass("setting-item");
			container.children.push(this.settingEl);
		}
		setName(_name: string): this {
			return this;
		}
		setDesc(_desc: string): this {
			return this;
		}
		setHeading(): this {
			return this;
		}
		addToggle(cb: (toggle: { setValue: (v: boolean) => { onChange: (cb: (v: boolean) => void) => void } }) => void): this {
			let changeHandler: (v: boolean) => void = () => {};
			cb({
				setValue: () => {
					return {
						onChange: (fn: (v: boolean) => void) => {
							changeHandler = fn;
						},
					};
				},
			});
			// Expose toggle control on settingEl for testing
			(this.settingEl as unknown as { triggerToggle: (v: boolean) => void }).triggerToggle = (v: boolean) => {
				changeHandler(v);
			};
			return this;
		}
		addButton(cb: (button: { setIcon: (icon: string) => void; setButtonText: (t: string) => { onClick: (fn: () => void) => void }; buttonEl: FakeElement }) => void): this {
			const btnEl = new FakeElement("button");
			cb({
				setIcon: () => {},
				setButtonText: (t: string) => {
					btnEl.text = t;
					return {
						onClick: (fn: () => void) => {
							btnEl.addEventListener("click", fn);
						},
					};
				},
				buttonEl: btnEl,
			});
			return this;
		}
	},
	setIcon: (_el: FakeElement, _icon: string) => {},
	Notice: class Notice {
		constructor(_message?: string) {}
	},
	Modal: class Modal {
		constructor(_app: unknown) {}
	},
	FuzzySuggestModal: class FuzzySuggestModal {
		constructor(_app: unknown) {}
		setPlaceholder(_text: string): void {}
	},
	AbstractInputSuggest: class AbstractInputSuggest {
		constructor(_app: unknown, _inputEl?: unknown) {}
	},
	SuggestModal: class SuggestModal {
		constructor(_app: unknown) {}
	},
}));

import type { CommandContext } from "../src/commands/context";
import { COMMANDS } from "../src/commands/registry";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { SidebarView, VIEW_TYPE_TVS_SIDEBAR } from "../src/ui/SidebarView";
import { FakeVault, clientFor } from "./fakes";

function fakeContext(overrides: Partial<CommandContext> = {}): CommandContext {
	const { client } = clientFor([], [], []);
	return {
		app: {
			setting: {
				open: vi.fn(),
				openTabById: vi.fn(),
			},
		} as unknown as CommandContext["app"],
		vault: new FakeVault(),
		settings: {
			...DEFAULT_SETTINGS,
			apiKey: "key",
			token: "token",
			boardId: "board",
			mappings: [{ folder: "Notes", listId: "l1", templateName: "" }],
		},
		journal: [],
		history: [],
		recordSyncRun: async () => {},
		setHistory: async () => {},
		client: () => client,
		fetchBinary: async () => null,
		run: async (_title, body) => {
			await body({ log: vi.fn() } as never, new AbortController().signal);
		},
		activeNote: () => null,
		isSyncing: () => false,
		ready: () => true,
		noteOptions: () => ({ policy: "newer-wins", marginMs: 0, syncTitle: true, dryRun: false }),
		folderOptions: () => ({
			policy: "newer-wins",
			marginMs: 0,
			syncTitle: true,
			dryRun: false,
			allowCreate: true,
			allowDelete: false,
			protectMovedOrArchivedCards: false,
			boardId: "board",
		}),
		auditOptions: () => ({ scope: "", boardId: "board", reportPath: "", timestamp: "t", excludedFolders: [] }),
		activateSidebarView: vi.fn().mockResolvedValue(undefined),
		saveSettings: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

describe("SidebarView", () => {
	test("defines the correct view type, text and icon", () => {
		const ctx = fakeContext();
		const view = new SidebarView({} as never, ctx);

		expect(VIEW_TYPE_TVS_SIDEBAR).toBe("trello-vault-sync-sidebar");
		expect(view.getViewType()).toBe("trello-vault-sync-sidebar");
		expect(view.getDisplayText()).toBe("Trello Vault Sync");
		expect(view.getIcon()).toBe("panel-right");
	});

	test("renders not-ready state when credentials are missing", async () => {
		const ctx = fakeContext({ settings: { ...DEFAULT_SETTINGS, apiKey: "", token: "" } });
		const view = new SidebarView({} as never, ctx);

		await view.onOpen();

		const notReady = (view as unknown as { contentEl: FakeElement }).contentEl.querySelector(".tvs-sidebar__not-ready");
		expect(notReady).not.toBeNull();
		expect(notReady?.querySelector(".tvs-sidebar__not-ready-title")?.text).toBe("Trello Credentials Required");
	});

	test("renders all commands and allows search filtering with dynamic counter", async () => {
		const ctx = fakeContext();
		const view = new SidebarView({} as never, ctx);

		await view.onOpen();

		const content = (view as unknown as { contentEl: FakeElement }).contentEl;
		const actions = content.querySelectorAll(".tvs-sidebar__action");
		expect(actions.length).toBe(COMMANDS.length);

		// Verify header and controls are present
		expect(content.querySelector(".tvs-sidebar__title")?.text).toBe("Trello Vault Sync");
		expect(content.querySelector(".tvs-sidebar__dryrun-label")?.text).toBe("Dry run mode");

		// Test search filtering and results counter
		const searchInput = content.querySelector(".tvs-sidebar__search-input");
		expect(searchInput).not.toBeNull();
		if (searchInput) {
			searchInput.value = "vault";
			searchInput.trigger("input");

			const resultsBar = content.querySelector(".tvs-sidebar__search-results-bar");
			expect(resultsBar).not.toBeNull();
			expect(resultsBar?.querySelector(".tvs-sidebar__search-results-text")?.text).toContain("Found");

			const filteredActions = content.querySelectorAll(".tvs-sidebar__action");
			expect(filteredActions.length).toBeGreaterThan(0);
			expect(filteredActions.length).toBeLessThan(COMMANDS.length);

			// Test clear search button
			const clearBtn = content.querySelector(".tvs-sidebar__search-clear");
			clearBtn?.trigger("click");
			expect(content.querySelectorAll(".tvs-sidebar__action").length).toBe(COMMANDS.length);
		}
	});

	test("updates dry-run mode and saves settings when toggled", async () => {
		const ctx = fakeContext();
		const view = new SidebarView({} as never, ctx);

		await view.onOpen();

		const content = (view as unknown as { contentEl: FakeElement }).contentEl;
		const dryRunRow = content.querySelector(".tvs-sidebar__dryrun-row");
		const toggleHolder = dryRunRow?.querySelector(".setting-item") as unknown as { triggerToggle: (v: boolean) => void };

		toggleHolder.triggerToggle(true);
		expect(ctx.settings.dryRun).toBe(true);
		expect(ctx.saveSettings).toHaveBeenCalled();
	});

	test("appends journal entries dynamically and updates badge", async () => {
		const ctx = fakeContext();
		const view = new SidebarView({} as never, ctx);

		await view.onOpen();

		view.appendJournalEntry("info", "Sync completed successfully");
		view.appendJournalEntry("warn", "Warning occurred");

		const content = (view as unknown as { contentEl: FakeElement }).contentEl;
		const rows = content.querySelectorAll(".tvs-panel__row");
		expect(rows.length).toBe(2);

		const badge = content.querySelector(".tvs-sidebar__journal-count-badge");
		expect(badge?.text).toBe("2");
	});

	test("triggers command execution on action click and keyboard", async () => {
		const ctx = fakeContext();
		const view = new SidebarView({} as never, ctx);

		await view.onOpen();

		const content = (view as unknown as { contentEl: FakeElement }).contentEl;
		const firstAction = content.querySelector(".tvs-sidebar__action");

		const firstCmd = COMMANDS[0];
		expect(firstCmd).toBeDefined();
		if (!firstCmd) return;

		const spyRun = vi.spyOn(firstCmd, "run").mockReturnValue(undefined);
		firstAction?.trigger("click");
		expect(spyRun).toHaveBeenCalledTimes(1);

		firstAction?.trigger("keydown", { key: "Enter", preventDefault: () => {} });
		expect(spyRun).toHaveBeenCalledTimes(2);
	});

	test("re-renders on onResize when contentEl has been emptied or unrendered", async () => {
		const ctx = fakeContext();
		const view = new SidebarView({} as never, ctx);

		await view.onOpen();
		const content = (view as unknown as { contentEl: FakeElement }).contentEl;
		expect(content.children.length).toBeGreaterThan(0);

		// Simulate empty state (e.g. initial detached state before layout settled)
		content.empty();
		expect(content.children.length).toBe(0);

		// onResize triggers auto-render
		view.onResize();
		expect(content.children.length).toBeGreaterThan(0);
	});

	test("open-sidebar command triggers activateSidebarView", async () => {
		const ctx = fakeContext();
		const openCmd = COMMANDS.find((c) => c.id === "open-sidebar");
		expect(openCmd).toBeDefined();
		expect(openCmd?.icon).toBe("panel-right");
		expect(openCmd?.section).toBe("Vault");

		await openCmd?.run(ctx);
		expect(ctx.activateSidebarView).toHaveBeenCalledTimes(1);
	});

	test("registers layout-change and active-leaf-change events and re-renders if empty", async () => {
		const listeners: Record<string, (arg?: unknown) => void> = {};
		const mockWorkspace = {
			on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
				listeners[event] = cb;
				return {};
			}),
		};
		const leaf = { id: "my-leaf" };
		const ctx = fakeContext({ app: { workspace: mockWorkspace } as never });
		const view = new SidebarView(leaf as never, ctx);

		await view.onOpen();
		expect(mockWorkspace.on).toHaveBeenCalledWith("layout-change", expect.any(Function));
		expect(mockWorkspace.on).toHaveBeenCalledWith("active-leaf-change", expect.any(Function));

		const content = (view as unknown as { contentEl: FakeElement }).contentEl;
		content.empty();
		expect(content.children.length).toBe(0);

		listeners["active-leaf-change"]?.(leaf);
		expect(content.children.length).toBeGreaterThan(0);
	});
});
