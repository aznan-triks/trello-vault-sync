import { describe, expect, test, vi, beforeEach } from "vitest";

const noticeMessages: string[] = [];

vi.mock("obsidian", () => {
	const createDummyEl = () => ({
		empty: () => {},
		addClass: () => {},
		createEl: () => createDummyEl(),
		createDiv: () => createDummyEl(),
		addEventListener: () => {},
		focus: () => {},
	});

	return {
		Notice: class Notice {
			constructor(message: string) {
				noticeMessages.push(message);
			}
		},
		Modal: class Modal {
			contentEl = createDummyEl();
			constructor(_app: unknown) {}
			open(): void {}
			close(): void {}
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
			addToggle(cb: (t: any) => void): this {
				cb({
					setValue: () => ({ onChange: () => {} }),
					onChange: () => {},
				});
				return this;
			}
		},
	};
});

import {
	alignNotesWithSettings,
	executeAlignNotes,
	formatAlignSummary,
	ALIGN_CATEGORY_LABELS,
} from "../src/commands/alignCommand";
import type { CommandContext } from "../src/commands/context";
import { COMMANDS } from "../src/commands/registry";
import { OperationGuard } from "../src/core/operationGuard";
import type { AlignCategory } from "../src/core/staleProperties";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { MultiSelectPickerModal } from "../src/ui/MultiSelectPickerModal";
import { FakeVault, recordingReporter } from "./fakes";

function buildFakeContext(vault: FakeVault, overrides: Partial<CommandContext> = {}): CommandContext {
	const reporter = recordingReporter();
	return {
		app: {} as CommandContext["app"],
		vault: vault as unknown as CommandContext["vault"],
		settings: {
			...DEFAULT_SETTINGS,
			boardId: "board-1",
			syncDue: true,
			syncLabels: true,
			syncMembers: true,
			syncCustomFields: true,
			syncAttachments: true,
			syncLinkedCards: true,
			syncCardCover: true,
			writeTrelloPluginNoteId: true,
			syncChecklists: true,
			checklistHeading: "## Checklists",
			labelPropertySync: false,
			labelPropertyMappings: [],
			obsoleteLabelPropertyKeys: [],
			keyMigrations: {},
			dryRun: false,
			historyEnabled: true,
		} as any,
		journal: [],
		history: [],
		recordSyncRun: async () => {},
		setHistory: async () => {},
		client: () => ({} as any),
		fetchBinary: async () => null,
		run: async (_title, body) => {
			await body(reporter, new AbortController().signal);
		},
		activeNote: () => null,
		isSyncing: () => false,
		ready: () => true,
		noteOptions: () => ({} as any),
		folderOptions: () => ({} as any),
		auditOptions: () => ({} as any),
		activateSidebarView: async () => {},
		saveSettings: async () => {},
		...overrides,
	};
}

describe("alignCommand unit & integration", () => {
	beforeEach(() => {
		noticeMessages.length = 0;
		vi.restoreAllMocks();
	});

	test("registry contains clean-up-notes with required properties", () => {
		const cmd = COMMANDS.find((c) => c.id === "clean-up-notes");
		expect(cmd).toBeDefined();
		expect(cmd?.name).toBe("Clean up notes to match current settings");
		expect(cmd?.icon).toBe("eraser");
		expect(cmd?.section).toBe("Vault");
		expect(cmd?.tone).toBe("default");
		expect(cmd?.description).toBe("Prune obsolete frontmatter properties and sync artifacts that are disabled in settings.");
	});

	test("registry command run calls alignNotesWithSettings", async () => {
		const cmd = COMMANDS.find((c) => c.id === "clean-up-notes");
		expect(cmd).toBeDefined();

		const vault = new FakeVault({});
		const ctx = buildFakeContext(vault);

		await cmd?.run(ctx);

		expect(noticeMessages).toContain("All notes are already aligned with current settings.");
	});

	test("formatAlignSummary correctly handles singular, plural, and dry-run", () => {
		expect(formatAlignSummary(1, 1)).toBe("Cleaned 1 note across 1 category.");
		expect(formatAlignSummary(2, 3)).toBe("Cleaned 2 notes across 3 categories.");
		expect(formatAlignSummary(0, 0)).toBe("Cleaned 0 notes across 0 categories.");
		expect(formatAlignSummary(2, 1, true)).toBe("[Dry-run] Cleaned 2 notes across 1 category.");
	});

	test("early exit with notice when all notes already match settings", async () => {
		const vault = new FakeVault({
			"clean.md": {
				content: '---\ntrello_board_card_id: "b1;c1"\ntrello_plugin_note_id: "0123456789abcdef0123456789abcdef"\n---\n\nBody',
			},
		});
		const ctx = buildFakeContext(vault);

		const modalOpenSpy = vi.spyOn(MultiSelectPickerModal.prototype, "open");

		await alignNotesWithSettings(ctx);

		expect(modalOpenSpy).not.toHaveBeenCalled();
		expect(noticeMessages).toContain("All notes are already aligned with current settings.");
	});

	test("early exit when vault has zero notes", async () => {
		const vault = new FakeVault({});
		const ctx = buildFakeContext(vault);

		const modalOpenSpy = vi.spyOn(MultiSelectPickerModal.prototype, "open");

		await alignNotesWithSettings(ctx);

		expect(modalOpenSpy).not.toHaveBeenCalled();
		expect(noticeMessages).toContain("All notes are already aligned with current settings.");
	});

	test("presents MultiSelectPickerModal with counts, confirmation label and correct default selections", async () => {
		let capturedItems: AlignCategory[] = [];
		let capturedLabelFor: (item: AlignCategory) => string = () => "";
		let capturedSelectedIndices = new Set<number>();
		let capturedConfirmLabel = "";

		vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
			capturedItems = this.items;
			capturedLabelFor = this.labelFor;
			capturedSelectedIndices = new Set(this.selected);
			capturedConfirmLabel = this.confirmLabel;
		});

		const vault = new FakeVault({
			"task1.md": {
				content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\ntrello_labels:\n  - "bug"\n---\n\n',
			},
			"task2.md": {
				content: '---\ntrello_board_card_id: "b1;c2"\ntrello_plugin_note_id: "pid-123"\n---\n\n## Checklists\n- [ ] Todo item',
			},
		});

		const ctx = buildFakeContext(vault);
		// Disable options so properties are flagged as stale
		ctx.settings.syncDue = false;
		ctx.settings.syncLabels = false;
		ctx.settings.writeTrelloPluginNoteId = false;
		ctx.settings.syncChecklists = false;

		await alignNotesWithSettings(ctx);

		expect(capturedConfirmLabel).toBe("Clean selected properties");
		expect(capturedItems).toContain("due");
		expect(capturedItems).toContain("labels");
		expect(capturedItems).toContain("plugin-note-id");
		expect(capturedItems).toContain("checklist-section");

		// Check labels with counts
		expect(capturedLabelFor("due")).toBe(`${ALIGN_CATEGORY_LABELS.due} (1 note)`);
		expect(capturedLabelFor("labels")).toBe(`${ALIGN_CATEGORY_LABELS.labels} (1 note)`);
		expect(capturedLabelFor("plugin-note-id")).toBe(`${ALIGN_CATEGORY_LABELS["plugin-note-id"]} (1 note)`);
		expect(capturedLabelFor("checklist-section")).toBe(`${ALIGN_CATEGORY_LABELS["checklist-section"]} (1 note)`);

		const isSelected = (item: AlignCategory) => {
			const idx = capturedItems.indexOf(item);
			return idx !== -1 && capturedSelectedIndices.has(idx);
		};

		// Standard categories in DEFAULT_MANUAL_ALIGN_CATEGORIES are checked
		expect(isSelected("due")).toBe(true);
		expect(isSelected("labels")).toBe(true);

		// Sensitive categories are strictly UNCHECKED by default
		expect(isSelected("plugin-note-id")).toBe(false);
		expect(isSelected("checklist-section")).toBe(false);
		expect(isSelected("missing-plugin-note-id")).toBe(false);
		expect(isSelected("obsolete-label-property")).toBe(false);
	});

	test("preselect overrides default selection to check only the target category", async () => {
		let capturedItems: AlignCategory[] = [];
		let capturedSelectedIndices = new Set<number>();

		vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
			capturedItems = this.items;
			capturedSelectedIndices = new Set(this.selected);
		});

		const vault = new FakeVault({
			"task.md": {
				content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\n---\n\n## Checklists\n- [ ] Todo',
			},
		});

		const ctx = buildFakeContext(vault);
		ctx.settings.syncDue = false;
		ctx.settings.syncChecklists = false;

		await alignNotesWithSettings(ctx, "checklist-section");

		const isSelected = (item: AlignCategory) => {
			const idx = capturedItems.indexOf(item);
			return idx !== -1 && capturedSelectedIndices.has(idx);
		};

		expect(isSelected("checklist-section")).toBe(true);
		expect(isSelected("due")).toBe(false);
	});

	test("modal empty selection reports notice and modifies nothing", async () => {
		let capturedOnConfirm: ((selected: AlignCategory[]) => void) | undefined;

		vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
			capturedOnConfirm = this.onConfirm;
		});

		const vault = new FakeVault({
			"task.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\n---\n\n' },
		});

		const ctx = buildFakeContext(vault);
		ctx.settings.syncDue = false;

		await alignNotesWithSettings(ctx);
		expect(capturedOnConfirm).toBeDefined();

		capturedOnConfirm!([]);
		expect(noticeMessages).toContain("No categories selected — nothing cleaned.");
		expect(vault.readFrontmatter(vault.note("task.md"))?.trello_due).toBe("2026-12-31");
	});

	test("cancel/esc handling: closing modal without confirm leaves vault untouched", async () => {
		const vault = new FakeVault({
			"task.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\n---\n\n' },
		});

		const ctx = buildFakeContext(vault);
		ctx.settings.syncDue = false;

		await alignNotesWithSettings(ctx);

		// Modal was opened, but user cancelled or dismissed via Esc (onConfirm never called)
		expect(vault.readFrontmatter(vault.note("task.md"))?.trello_due).toBe("2026-12-31");
	});

	test("modal confirmation cleans selected categories, preserves mtime and records history", async () => {
		let capturedOnConfirm: ((selected: AlignCategory[]) => void) | undefined;

		vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
			capturedOnConfirm = this.onConfirm;
		});

		const initialMtime = 1700000000000;
		const vault = new FakeVault({
			"task.md": {
				content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\ntrello_labels:\n  - "tag"\n---\n\nContent',
				mtime: initialMtime,
			},
		});

		const recordedRuns: string[] = [];
		const ctx = buildFakeContext(vault, {
			recordSyncRun: async (scope) => {
				recordedRuns.push(scope);
			},
		});
		ctx.settings.syncDue = false;
		ctx.settings.syncLabels = false;

		await alignNotesWithSettings(ctx);
		expect(capturedOnConfirm).toBeDefined();

		capturedOnConfirm!(["due", "labels"]);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const updatedFm = vault.readFrontmatter(vault.note("task.md"));
		expect(updatedFm?.trello_due).toBeUndefined();
		expect(updatedFm?.trello_labels).toBeUndefined();
		expect(updatedFm?.trello_board_card_id).toBe("b1;c1");

		// Verify mtime is preserved
		expect(vault.note("task.md").mtime).toBe(initialMtime);

		// Verify history recording
		expect(recordedRuns).toContain("Clean up notes");

		// Verify user notice
		expect(noticeMessages.some((msg) => msg.includes("Cleaned 1 note across 2 categories."))).toBe(true);
	});

	test("dry-run mode does not modify notes and prefixes notice with [Dry-run]", async () => {
		let capturedOnConfirm: ((selected: AlignCategory[]) => void) | undefined;

		vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
			capturedOnConfirm = this.onConfirm;
		});

		const initialContent = '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\n---\n\nContent';
		const vault = new FakeVault({ "task.md": { content: initialContent } });

		const ctx = buildFakeContext(vault);
		ctx.settings.syncDue = false;
		ctx.settings.dryRun = true;

		await alignNotesWithSettings(ctx);
		expect(capturedOnConfirm).toBeDefined();

		capturedOnConfirm!(["due"]);
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Verified file untouched
		expect(vault.contentOf("task.md")).toBe(initialContent);

		// Notice prefixed with [Dry-run]
		expect(noticeMessages.some((msg) => msg.startsWith("[Dry-run]"))).toBe(true);
	});

	test("operation guarding: acquires card:<id> lock during batch clean-up", async () => {
		const vault = new FakeVault({
			"task.md": { content: '---\ntrello_board_card_id: "b1;cardABC"\ntrello_due: "2026-12-31"\n---\n\n' },
		});
		const guard = new OperationGuard();
		const withKeySpy = vi.spyOn(guard, "withKey");

		const ctx = buildFakeContext(vault, { guard });
		ctx.settings.syncDue = false;

		await executeAlignNotes(ctx, [vault.note("task.md")], ["due"]);

		expect(withKeySpy).toHaveBeenCalledWith("card:cardABC", expect.any(Function));
	});

	test("custom ctx.withHistoryRecording is honored when supplied", async () => {
		const vault = new FakeVault({
			"task.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\n---\n\n' },
		});
		let customHistoryCalled = false;
		const customWithHistory = vi.fn(async (_scope: string, fn: any) => {
			customHistoryCalled = true;
			return fn(vault);
		});

		const ctx = buildFakeContext(vault, {
			withHistoryRecording: customWithHistory,
		} as any);
		ctx.settings.syncDue = false;

		await executeAlignNotes(ctx, [vault.note("task.md")], ["due"]);

		expect(customHistoryCalled).toBe(true);
	});

	test("defensively supports ctx.vault.list() if provided", async () => {
		const vault = new FakeVault({
			"task.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\n---\n\n' },
		});
		const listSpy = vi.fn(() => [vault.note("task.md")]);
		(vault as any).list = listSpy;

		const ctx = buildFakeContext(vault);
		ctx.settings.syncDue = false;

		await alignNotesWithSettings(ctx);

		expect(listSpy).toHaveBeenCalled();
	});

	test("abort signal stops batch alignment gracefully", async () => {
		const vault = new FakeVault({
			"task1.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\n---\n\n' },
			"task2.md": { content: '---\ntrello_board_card_id: "b1;c2"\ntrello_due: "2026-12-31"\n---\n\n' },
		});

		const controller = new AbortController();
		controller.abort();

		const ctx = buildFakeContext(vault, {
			run: async (_title, body) => {
				await body(recordingReporter(), controller.signal);
			},
		});
		ctx.settings.syncDue = false;

		const result = await executeAlignNotes(ctx, vault.listNotes(""), ["due"]);

		expect(result.notesModified).toBe(0);
	});
});
