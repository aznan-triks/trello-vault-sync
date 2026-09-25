import { describe, expect, test, vi } from "vitest";

// registry.ts pulls in every command module, several of which import "obsidian"
// (Notice, Modal, FuzzySuggestModal) — the npm package has no runtime (§9 of
// CONTEXT.md), so any test that imports commands/ must stub it first.
vi.mock("obsidian", () => ({
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
		setPlaceholder(_text: string): void {}
	},
	Setting: class Setting {
		constructor(_container: unknown) {}
		setName(): this {
			return this;
		}
		setDesc(): this {
			return this;
		}
		addText(): this {
			return this;
		}
		addToggle(): this {
			return this;
		}
	},
}));

import { ALL_SECTIONS, COMMANDS, type CommandTone } from "../src/commands/registry";

const VALID_TONES: CommandTone[] = ["sync", "pull", "push", "link", "audit", "history", "default"];

describe("registry", () => {
	test("every command has a non-empty one-sentence description", () => {
		for (const command of COMMANDS) {
			expect(command.description.length, `${command.id} description`).toBeGreaterThan(0);
			expect(command.description.trim()).toBe(command.description);
		}
	});

	test("every command has an explicit, valid tone (never guessed from its id)", () => {
		for (const command of COMMANDS) {
			expect(VALID_TONES, `${command.id} tone`).toContain(command.tone);
		}
	});

	test("a command id that no longer matches any id-guessing pattern still gets a real tone", () => {
		const phantom = COMMANDS.find((c) => c.id === "create-cards-from-phantom-notes");
		expect(phantom).toBeDefined();
		expect(phantom?.tone).not.toBe("default");
	});

	test("every command belongs to a declared section", () => {
		for (const command of COMMANDS) {
			expect(ALL_SECTIONS, `${command.id} section`).toContain(command.section);
		}
	});
});
