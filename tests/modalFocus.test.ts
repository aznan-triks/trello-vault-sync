import { describe, expect, test, vi } from "vitest";

/**
 * Lightweight in-memory DOM fake, scoped to what the four button/text-driven
 * modals touched by AUDIT_2026-09-25_ux-settings-features.md §C3/§C4 actually
 * call — same spirit as `tests/sidebarView.test.ts`'s fake, kept separate
 * since these modals don't need the sidebar's search/nav surface.
 */
class FakeElement {
	children: FakeElement[] = [];
	classList = new Set<string>();
	attributes: Record<string, string> = {};
	listeners: Record<string, ((e: unknown) => void)[]> = {};
	text = "";
	value = "";
	focused = false;
	parent: FakeElement | null = null;

	constructor(public tagName: string = "div") {}

	empty(): void {
		this.children = [];
		this.text = "";
	}

	addClass(...cls: string[]): this {
		for (const c of cls) for (const part of c.split(" ")) if (part) this.classList.add(part);
		return this;
	}

	setAttribute(name: string, val: string): void {
		this.attributes[name] = val;
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
		if (options?.attr) for (const [k, v] of Object.entries(options.attr)) el.setAttribute(k, v);
		el.parent = this;
		this.children.push(el);
		return el;
	}

	createDiv(options?: { cls?: string; text?: string }): FakeElement {
		return this.createEl("div", options);
	}

	remove(): void {
		if (this.parent) {
			this.parent.children = this.parent.children.filter((c) => c !== this);
			this.parent = null;
		}
	}

	focus(): void {
		this.focused = true;
	}

	querySelectorAll(selector: string): FakeElement[] {
		const result: FakeElement[] = [];
		const isClass = selector.startsWith(".");
		const target = isClass ? selector.slice(1) : selector;
		const walk = (node: FakeElement) => {
			for (const child of node.children) {
				if (isClass ? child.classList.has(target) : child.tagName.toLowerCase() === target.toLowerCase()) result.push(child);
				walk(child);
			}
		};
		walk(this);
		return result;
	}

	querySelector(selector: string): FakeElement | null {
		return this.querySelectorAll(selector)[0] ?? null;
	}
}

vi.mock("obsidian", () => ({
	Modal: class Modal {
		contentEl = new FakeElement("div");
		constructor(public app: unknown) {}
		close(): void {}
	},
	Setting: class Setting {
		nameText = "";
		constructor(private readonly container: FakeElement) {
			container.children.push(new FakeElement("div").addClass("setting-item"));
		}
		setName(name: string): this {
			this.nameText = name;
			return this;
		}
		setDesc(): this {
			return this;
		}
		addText(cb: (text: { setValue: (v: string) => { onChange: (fn: (v: string) => void) => void }; inputEl: FakeElement }) => void): this {
			const inputEl = new FakeElement("input");
			let value = "";
			cb({
				setValue: (v: string) => {
					value = v;
					return {
						onChange: (fn: (v: string) => void) => {
							inputEl.addEventListener("input-change", () => fn(value));
						},
					};
				},
				inputEl,
			});
			this.container.children.push(inputEl);
			// Expose a way for the test to simulate typing.
			(inputEl as unknown as { typeValue: (v: string) => void }).typeValue = (v: string) => {
				value = v;
				inputEl.trigger("input-change");
			};
			return this;
		}
		addToggle(cb: (toggle: { setValue: (v: boolean) => { onChange: (fn: (v: boolean) => void) => void } }) => void): this {
			cb({
				setValue: () => ({
					onChange: () => {},
				}),
			});
			return this;
		}
	},
	AbstractInputSuggest: class AbstractInputSuggest {
		constructor(_app: unknown, _inputEl?: unknown) {}
	},
}));

import { ConfirmModal } from "../src/ui/ConfirmModal";
import { ConflictModal } from "../src/ui/ConflictModal";
import { FolderPickerModal } from "../src/ui/FolderPickerModal";
import { SyncActionPickerModal } from "../src/ui/SyncActionPickerModal";
import type { SyncRun } from "../src/core/syncHistory";

describe("modal initial focus (§C4)", () => {
	test("ConfirmModal (destructive) focuses Cancel, not the warning action", () => {
		const modal = new ConfirmModal({} as never, "Are you sure?", vi.fn());
		modal.onOpen();

		const contentEl = (modal as unknown as { contentEl: FakeElement }).contentEl;
		const buttons = contentEl.querySelectorAll("button");
		const confirmBtn = buttons.find((b) => b.classList.has("mod-warning"));
		const cancelBtn = buttons.find((b) => !b.classList.has("mod-warning"));

		expect(cancelBtn?.focused).toBe(true);
		expect(confirmBtn?.focused).toBeFalsy();
	});

	test("SyncActionPickerModal (destructive undo) focuses Cancel", () => {
		const run: SyncRun = { timestamp: "2026-09-25T00:00:00.000Z", scope: "Notes", actions: [] };
		const modal = new SyncActionPickerModal({} as never, run, vi.fn());
		modal.onOpen();

		const contentEl = (modal as unknown as { contentEl: FakeElement }).contentEl;
		const buttons = contentEl.querySelectorAll("button");
		const cancelBtn = buttons.find((b) => b.text === "Cancel");
		expect(cancelBtn?.focused).toBe(true);
	});

	test("ConflictModal focuses the safe default action (Keep this note)", () => {
		const modal = new ConflictModal({} as never, { noteTitle: "N", localBody: "a", remoteBody: "b" }, vi.fn());
		modal.onOpen();

		const contentEl = (modal as unknown as { contentEl: FakeElement }).contentEl;
		const buttons = contentEl.querySelectorAll("button");
		const keepLocal = buttons.find((b) => b.text === "Keep this note");
		const keepRemote = buttons.find((b) => b.text === "Keep the Trello card");
		expect(keepLocal?.focused).toBe(true);
		expect(keepRemote?.focused).toBeFalsy();
	});

	test("FolderPickerModal (safe action) focuses the primary Create button", () => {
		const modal = new FolderPickerModal({} as never, () => [], "", vi.fn());
		modal.onOpen();

		const contentEl = (modal as unknown as { contentEl: FakeElement }).contentEl;
		const buttons = contentEl.querySelectorAll("button");
		const createBtn = buttons.find((b) => b.classList.has("mod-cta"));
		expect(createBtn?.focused).toBe(true);
	});
});

describe("FolderPickerModal invalid folder (§C3)", () => {
	test("shows an inline error instead of silently doing nothing, and never calls onPick", () => {
		const onPick = vi.fn();
		const modal = new FolderPickerModal({} as never, () => [], "", onPick);
		modal.onOpen();

		const contentEl = (modal as unknown as { contentEl: FakeElement }).contentEl;
		const buttons = contentEl.querySelectorAll("button");
		const createBtn = buttons.find((b) => b.classList.has("mod-cta"));

		createBtn?.trigger("click");

		expect(onPick).not.toHaveBeenCalled();
		expect(contentEl.querySelector(".tvs-confirm__error")).not.toBeNull();
	});

	test("clears the error once the user edits the field again", () => {
		const onPick = vi.fn();
		const modal = new FolderPickerModal({} as never, () => [], "", onPick);
		modal.onOpen();

		const contentEl = (modal as unknown as { contentEl: FakeElement }).contentEl;
		const createBtn = contentEl.querySelectorAll("button").find((b) => b.classList.has("mod-cta"));
		createBtn?.trigger("click");
		expect(contentEl.querySelector(".tvs-confirm__error")).not.toBeNull();

		const inputEl = contentEl.querySelectorAll("input")[0] as unknown as { typeValue: (v: string) => void };
		inputEl.typeValue("Projects/Ideas");

		expect(contentEl.querySelector(".tvs-confirm__error")).toBeNull();
	});
});
