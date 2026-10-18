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
	ALIGN_CATEGORY_LABELS,
} from "../src/commands/alignCommand";
import type { CommandContext } from "../src/commands/context";
import { COMMANDS } from "../src/commands/registry";
import { OperationGuard } from "../src/core/operationGuard";
import {
	type AlignCategory,
} from "../src/core/staleProperties";
import { type SyncRun } from "../src/core/syncHistory";
import { undoRun, undoRunForNote } from "../src/features/rollback";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { MultiSelectPickerModal } from "../src/ui/MultiSelectPickerModal";
import { FakeVault, recordingReporter } from "./fakes";

function buildStressContext(
	vault: FakeVault,
	historyStore: SyncRun[] = [],
	overrides: Partial<CommandContext> = {},
): CommandContext {
	const reporter = recordingReporter();
	return {
		app: {} as CommandContext["app"],
		vault: vault as unknown as CommandContext["vault"],
		settings: {
			...DEFAULT_SETTINGS,
			boardId: "board-stress",
			syncDue: false,
			syncLabels: false,
			syncMembers: false,
			syncCustomFields: false,
			syncAttachments: false,
			syncLinkedCards: false,
			syncCardCover: false,
			writeTrelloPluginNoteId: false,
			syncChecklists: false,
			checklistHeading: "## Checklists",
			labelPropertySync: false,
			labelPropertyMappings: [],
			obsoleteLabelPropertyKeys: ["stale_priority"],
			keyMigrations: { "old_author": "reviewer" },
			dryRun: false,
			historyEnabled: true,
		} as any,
		journal: [],
		history: historyStore,
		recordSyncRun: async (scope, actions) => {
			if (actions.length > 0) {
				historyStore.push({
					timestamp: new Date().toISOString(),
					scope,
					actions: [...actions],
				});
			}
		},
		setHistory: async (next) => {
			historyStore.length = 0;
			historyStore.push(...next);
		},
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

describe("Empirical Challenger M4: Registry Integration & Reversibility Invariants", () => {
	beforeEach(() => {
		noticeMessages.length = 0;
		vi.restoreAllMocks();
	});

	describe("1. Command Registry Invariants & Metadata", () => {
		test("COMMANDS registry contains clean-up-notes with exact required contract", () => {
			const cmd = COMMANDS.find((c) => c.id === "clean-up-notes");
			expect(cmd, "Command 'clean-up-notes' must exist in COMMANDS registry").toBeDefined();
			expect(cmd?.name).toBe("Clean up notes to match current settings");
			expect(cmd?.icon).toBe("eraser");
			expect(cmd?.section).toBe("Vault");
			expect(cmd?.tone).toBe("default");
			expect(cmd?.description).toBe(
				"Prune obsolete frontmatter properties and sync artifacts that are disabled in settings.",
			);
			expect(typeof cmd?.run).toBe("function");
		});

		test("Invoking command.run(ctx) on clean vault displays notice and does not open modal", async () => {
			const cmd = COMMANDS.find((c) => c.id === "clean-up-notes");
			expect(cmd).toBeDefined();

			const vault = new FakeVault({
				"clean.md": {
					content: '---\ntrello_board_card_id: "b1;c1"\ntrello_plugin_note_id: "0123456789abcdef0123456789abcdef"\n---\n\nClean body',
				},
			});
			const ctx = buildStressContext(vault);
			// Settings align with note (no stale fields)
			ctx.settings.syncDue = true;
			ctx.settings.syncLabels = true;
			ctx.settings.syncMembers = true;
			ctx.settings.syncCustomFields = true;
			ctx.settings.syncAttachments = true;
			ctx.settings.syncLinkedCards = true;
			ctx.settings.syncCardCover = true;
			ctx.settings.writeTrelloPluginNoteId = true;
			ctx.settings.syncChecklists = true;

			const modalOpenSpy = vi.spyOn(MultiSelectPickerModal.prototype, "open");

			await cmd!.run(ctx);

			expect(modalOpenSpy).not.toHaveBeenCalled();
			expect(noticeMessages).toContain("All notes are already aligned with current settings.");
		});

		test("Invoking command.run(ctx) on stale vault opens MultiSelectPickerModal with populated badges", async () => {
			const cmd = COMMANDS.find((c) => c.id === "clean-up-notes");
			expect(cmd).toBeDefined();

			let openedItems: AlignCategory[] = [];
			let labelFormatter: (item: AlignCategory) => string = () => "";
			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				openedItems = this.items;
				labelFormatter = this.labelFor;
			});

			const vault = new FakeVault({
				"stale1.md": {
					content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\n---\n\nBody',
				},
				"stale2.md": {
					content: '---\ntrello_board_card_id: "b1;c2"\ntrello_due: "2026-11-30"\ntrello_labels:\n  - "tag"\n---\n\nBody',
				},
			});
			const ctx = buildStressContext(vault);

			await cmd!.run(ctx);

			expect(openedItems).toContain("due");
			expect(openedItems).toContain("labels");
			expect(labelFormatter("due")).toBe(`${ALIGN_CATEGORY_LABELS.due} (2 notes)`);
			expect(labelFormatter("labels")).toBe(`${ALIGN_CATEGORY_LABELS.labels} (1 note)`);
		});
	});

	describe("2. Comprehensive Reversibility Invariant (undoRun Byte-Identity)", () => {
		test("All 12 alignment categories record history and restore byte-identically on undoRun", async () => {
			const initialMtime = 1710000000000;

			// Prepare notes covering ALL categories
			const initialNotes: Record<string, { content: string; mtime: number }> = {
				"note_due_labels.md": {
					content: [
						"---",
						'trello_board_card_id: "b1;c_due"',
						'trello_due: "2026-12-31T12:00:00.000Z"',
						"trello_labels:",
						'  - "urgent"',
						'  - "dev"',
						"---",
						"",
						"# Header",
						"Some note content here.",
					].join("\n"),
					mtime: initialMtime,
				},
				"note_members_custom.md": {
					content: [
						"---",
						'trello_board_card_id: "b1;c_mem"',
						"trello_members:",
						'  - "user_1"',
						"trello_custom_fields:",
						'  Priority: "High"',
						"---",
						"",
						"Member and custom field content.",
					].join("\n"),
					mtime: initialMtime,
				},
				"note_attachments_links.md": {
					content: [
						"---",
						'trello_board_card_id: "b1;c_att"',
						"trello_attachments:",
						'  - name: "spec.pdf"',
						"trello_linked_cards:",
						'  - id: "c_other"',
						"---",
						"",
						"Attachments content.",
					].join("\n"),
					mtime: initialMtime,
				},
				"note_cover.md": {
					content: [
						"---",
						'trello_board_card_id: "b1;c_cov"',
						'banner: "https://trello.com/1/cards/c_cov/attachments/att1/download/cover.jpg"',
						"---",
						"",
						"Cover note content.",
					].join("\n"),
					mtime: initialMtime,
				},
				"note_plugin_id_remove.md": {
					content: [
						"---",
						'trello_board_card_id: "b1;c_pid"',
						'trello_plugin_note_id: "0123456789abcdef0123456789abcdef"',
						"---",
						"",
						"Plugin id note.",
					].join("\n"),
					mtime: initialMtime,
				},
				"note_checklist.md": {
					content: [
						"---",
						'trello_board_card_id: "b1;c_chk"',
						"---",
						"",
						"# Project Plan",
						"Introduction prose.",
						"",
						"## Checklists",
						"- [ ] Task item 1",
						"- [x] Task item 2",
						"",
						"## Next Steps",
						"Final conclusions.",
					].join("\n"),
					mtime: initialMtime,
				},
				"note_obsolete_and_migration.md": {
					content: [
						"---",
						'trello_board_card_id: "b1;c_obs"',
						'stale_priority: "P1"',
						'old_author: "Alice"',
						"---",
						"",
						"Obsolete and migration note.",
					].join("\n"),
					mtime: initialMtime,
				},
				"note_unlinked.md": {
					content: [
						"---",
						'title: "Unlinked Note"',
						"tags:",
						'  - "docs"',
						"---",
						"",
						"This note is not linked to any Trello card and has no Trello properties.",
					].join("\n"),
					mtime: initialMtime,
				},
			};

			const vault = new FakeVault(initialNotes);
			const historyStore: SyncRun[] = [];
			const guard = new OperationGuard();
			const ctx = buildStressContext(vault, historyStore, { guard });

			// Capture exact initial byte content
			const baselineContent = new Map<string, string>();
			for (const path of Object.keys(initialNotes)) {
				baselineContent.set(path, vault.contentOf(path));
			}

			// Intercept modal and confirm ALL categories
			let capturedOnConfirm: ((selected: AlignCategory[]) => void) | undefined;
			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedOnConfirm = this.onConfirm;
			});

			await alignNotesWithSettings(ctx);

			expect(capturedOnConfirm, "Modal must be opened").toBeDefined();

			// Confirm cleanup across all active categories
			capturedOnConfirm!([
				"due",
				"labels",
				"members",
				"custom-fields",
				"attachments",
				"linked-cards",
				"cover",
				"plugin-note-id",
				"checklist-section",
				"obsolete-label-property",
				"key-migration",
			]);

			// Await asynchronous executeAlignNotes
			await new Promise((resolve) => setTimeout(resolve, 10));

			// 1. Verify alignment modifications occurred
			expect(vault.readFrontmatter(vault.note("note_due_labels.md"))?.trello_due).toBeUndefined();
			expect(vault.readFrontmatter(vault.note("note_due_labels.md"))?.trello_labels).toBeUndefined();
			expect(vault.readFrontmatter(vault.note("note_members_custom.md"))?.trello_members).toBeUndefined();
			expect(vault.readFrontmatter(vault.note("note_members_custom.md"))?.trello_custom_fields).toBeUndefined();
			expect(vault.readFrontmatter(vault.note("note_attachments_links.md"))?.trello_attachments).toBeUndefined();
			expect(vault.readFrontmatter(vault.note("note_attachments_links.md"))?.trello_linked_cards).toBeUndefined();
			expect(vault.readFrontmatter(vault.note("note_cover.md"))?.banner).toBeUndefined();
			expect(vault.readFrontmatter(vault.note("note_plugin_id_remove.md"))?.trello_plugin_note_id).toBeUndefined();
			expect(vault.contentOf("note_checklist.md")).not.toContain("## Checklists");
			expect(vault.contentOf("note_checklist.md")).toContain("## Next Steps");
			expect(vault.readFrontmatter(vault.note("note_obsolete_and_migration.md"))?.stale_priority).toBeUndefined();
			expect(vault.readFrontmatter(vault.note("note_obsolete_and_migration.md"))?.old_author).toBeUndefined();
			expect(vault.readFrontmatter(vault.note("note_obsolete_and_migration.md"))?.reviewer).toBe("Alice");

			// Unlinked note should remain untouched
			expect(vault.contentOf("note_unlinked.md")).toBe(baselineContent.get("note_unlinked.md"));

			// 2. Verify mtime was preserved across all touched notes
			for (const path of Object.keys(initialNotes)) {
				expect(vault.note(path).mtime).toBe(initialMtime);
			}

			// 3. Verify history recording captured the run
			expect(historyStore.length).toBe(1);
			const run = historyStore[0]!;
			expect(run.scope).toBe("Clean up notes");
			expect(run.actions.length).toBe(7); // 7 linked notes modified

			// 4. INVARIANT CHECK: Execute undoRun and verify 100% BYTE-IDENTICAL restoration
			const { stats } = await undoRun(vault, run);
			expect(stats.reverted).toBe(7);
			expect(stats.skipped).toBe(0);

			for (const [path, expectedContent] of baselineContent.entries()) {
				const actualContent = vault.contentOf(path);
				expect(actualContent, `Restoration failed for ${path}`).toBe(expectedContent);
			}
		});

		test("Selective undo (undoRunForNote) restores only targeted note while leaving others modified", async () => {
			const vault = new FakeVault({
				"taskA.md": {
					content: '---\ntrello_board_card_id: "b1;cA"\ntrello_due: "2026-10-18"\n---\n\nBody A',
				},
				"taskB.md": {
					content: '---\ntrello_board_card_id: "b1;cB"\ntrello_labels:\n  - "bug"\n---\n\nBody B',
				},
			});
			const initialContentA = vault.contentOf("taskA.md");
			const initialContentB = vault.contentOf("taskB.md");

			const historyStore: SyncRun[] = [];
			const ctx = buildStressContext(vault, historyStore);

			let capturedOnConfirm: ((selected: AlignCategory[]) => void) | undefined;
			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedOnConfirm = this.onConfirm;
			});

			await alignNotesWithSettings(ctx);
			capturedOnConfirm!(["due", "labels"]);
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(historyStore.length).toBe(1);
			const run = historyStore[0]!;

			// Undo ONLY taskA.md
			const { stats, remainingRun } = await undoRunForNote(vault, run, "taskA.md");
			expect(stats.reverted).toBe(1);

			// taskA.md is restored byte-identically
			expect(vault.contentOf("taskA.md")).toBe(initialContentA);

			// taskB.md is STILL modified
			expect(vault.readFrontmatter(vault.note("taskB.md"))?.trello_labels).toBeUndefined();

			// Undo remaining actions (taskB.md)
			const { stats: statsRemaining } = await undoRun(vault, remainingRun);
			expect(statsRemaining.reverted).toBe(1);
			expect(vault.contentOf("taskB.md")).toBe(initialContentB);
		});
	});

	describe("3. Stress Scenarios & Edge Cases", () => {
		test("Dry-run execution preserves files and records 0 history actions", async () => {
			const initialContent = '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\n---\n\nContent';
			const vault = new FakeVault({ "task.md": { content: initialContent } });
			const historyStore: SyncRun[] = [];
			const ctx = buildStressContext(vault, historyStore);
			ctx.settings.dryRun = true;

			let capturedOnConfirm: ((selected: AlignCategory[]) => void) | undefined;
			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedOnConfirm = this.onConfirm;
			});

			await alignNotesWithSettings(ctx);
			capturedOnConfirm!(["due"]);
			await new Promise((resolve) => setTimeout(resolve, 10));

			// File remains completely untouched
			expect(vault.contentOf("task.md")).toBe(initialContent);

			// History store remains empty (no actions committed)
			expect(historyStore.length).toBe(0);

			// Notice correctly formatted with [Dry-run]
			expect(noticeMessages.some((msg) => msg.includes("[Dry-run]"))).toBe(true);
		});

		test("Idempotency: consecutive execution detects 0 remaining changes", async () => {
			const vault = new FakeVault({
				"task.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\n---\n\nContent' },
			});
			const historyStore: SyncRun[] = [];
			const ctx = buildStressContext(vault, historyStore);

			let capturedOnConfirm: ((selected: AlignCategory[]) => void) | undefined;
			const modalOpenSpy = vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedOnConfirm = this.onConfirm;
			});

			// Pass 1: executes cleanup
			await alignNotesWithSettings(ctx);
			capturedOnConfirm!(["due"]);
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(vault.readFrontmatter(vault.note("task.md"))?.trello_due).toBeUndefined();

			// Pass 2: should exit immediately
			noticeMessages.length = 0;
			modalOpenSpy.mockClear();

			await alignNotesWithSettings(ctx);
			expect(modalOpenSpy).not.toHaveBeenCalled();
			expect(noticeMessages).toContain("All notes are already aligned with current settings.");
		});

		test("Folder scope and exclusions are respected during note discovery", async () => {
			const vault = new FakeVault({
				"included/task1.md": {
					content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\n---\n\n',
				},
				"excluded/task2.md": {
					content: '---\ntrello_board_card_id: "b1;c2"\ntrello_due: "2026-12-31"\n---\n\n',
				},
				"other/task3.md": {
					content: '---\ntrello_board_card_id: "b1;c3"\ntrello_due: "2026-12-31"\n---\n\n',
				},
			});

			const historyStore: SyncRun[] = [];
			const ctx = buildStressContext(vault, historyStore);
			ctx.settings.scope = "included";
			ctx.settings.excludedFolders = ["excluded"];

			let capturedOnConfirm: ((selected: AlignCategory[]) => void) | undefined;
			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedOnConfirm = this.onConfirm;
			});

			await alignNotesWithSettings(ctx);
			expect(capturedOnConfirm).toBeDefined();

			capturedOnConfirm!(["due"]);
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Only included/task1.md is modified
			expect(vault.readFrontmatter(vault.note("included/task1.md"))?.trello_due).toBeUndefined();
			expect(vault.readFrontmatter(vault.note("excluded/task2.md"))?.trello_due).toBe("2026-12-31");
			expect(vault.readFrontmatter(vault.note("other/task3.md"))?.trello_due).toBe("2026-12-31");
		});

		test("OperationGuard locks are acquired for every card during batch execution", async () => {
			const vault = new FakeVault({
				"task1.md": { content: '---\ntrello_board_card_id: "b1;cardAlpha"\ntrello_due: "2026-12-31"\n---\n\n' },
				"task2.md": { content: '---\ntrello_board_card_id: "b1;cardBeta"\ntrello_due: "2026-12-31"\n---\n\n' },
			});
			const guard = new OperationGuard();
			const withKeySpy = vi.spyOn(guard, "withKey");

			const ctx = buildStressContext(vault, [], { guard });

			let capturedOnConfirm: ((selected: AlignCategory[]) => void) | undefined;
			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedOnConfirm = this.onConfirm;
			});

			await alignNotesWithSettings(ctx);
			capturedOnConfirm!(["due"]);
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(withKeySpy).toHaveBeenCalledWith("card:cardAlpha", expect.any(Function));
			expect(withKeySpy).toHaveBeenCalledWith("card:cardBeta", expect.any(Function));
		});

		test("Malformed and empty notes are handled gracefully without uncaught exceptions", async () => {
			const vault = new FakeVault({
				"empty.md": { content: "" },
				"corrupt_fm.md": { content: "---\n: invalid yaml: [\n---\n\nBody" },
				"valid_stale.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\n---\n\n' },
			});
			const historyStore: SyncRun[] = [];
			const ctx = buildStressContext(vault, historyStore);

			let capturedOnConfirm: ((selected: AlignCategory[]) => void) | undefined;
			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedOnConfirm = this.onConfirm;
			});

			await expect(alignNotesWithSettings(ctx)).resolves.not.toThrow();

			expect(capturedOnConfirm).toBeDefined();
			capturedOnConfirm!(["due"]);
			await new Promise((resolve) => setTimeout(resolve, 10));

			// valid_stale.md was cleaned, empty.md and corrupt_fm.md were skipped without crashing
			expect(vault.readFrontmatter(vault.note("valid_stale.md"))?.trello_due).toBeUndefined();
			expect(vault.contentOf("empty.md")).toBe("");
		});
	});
});
