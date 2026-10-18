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
import { OperationGuard } from "../src/core/operationGuard";
import type { AlignCategory } from "../src/core/staleProperties";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { MultiSelectPickerModal } from "../src/ui/MultiSelectPickerModal";
import { FakeVault, recordingReporter } from "./fakes";

function buildStressContext(vault: FakeVault, overrides: Partial<CommandContext> = {}): CommandContext {
	const reporter = recordingReporter();
	return {
		app: {} as CommandContext["app"],
		vault: vault as unknown as CommandContext["vault"],
		settings: {
			...DEFAULT_SETTINGS,
			boardId: "board-stress",
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

describe("Milestone 4 Empirical Stress Harness — alignNotesWithSettings & Command Flow", () => {
	beforeEach(() => {
		noticeMessages.length = 0;
		vi.restoreAllMocks();
	});

	// 1. Vault scale tests (0 notes, all clean notes, 100 notes with mixed stale categories)
	describe("1. Vault scale and distribution", () => {
		test("0 notes in vault: exits immediately with notice and opens no modal", async () => {
			const vault = new FakeVault({});
			const ctx = buildStressContext(vault);
			const modalOpenSpy = vi.spyOn(MultiSelectPickerModal.prototype, "open");

			await alignNotesWithSettings(ctx);

			expect(modalOpenSpy).not.toHaveBeenCalled();
			expect(noticeMessages).toContain("All notes are already aligned with current settings.");
		});

		test("All clean notes in vault: exits immediately with notice and opens no modal", async () => {
			const files: Record<string, { content: string }> = {};
			for (let i = 0; i < 20; i++) {
				files[`clean-${i}.md`] = {
					content: `---\ntrello_board_card_id: "board-1;card-${i}"\ntrello_plugin_note_id: "0123456789abcdef0123456789abcdef"\n---\n\nClean body ${i}`,
				};
			}
			const vault = new FakeVault(files);
			const ctx = buildStressContext(vault);
			const modalOpenSpy = vi.spyOn(MultiSelectPickerModal.prototype, "open");

			await alignNotesWithSettings(ctx);

			expect(modalOpenSpy).not.toHaveBeenCalled();
			expect(noticeMessages).toContain("All notes are already aligned with current settings.");
		});

		test("100 notes with mixed stale categories: accurately calculates per-category note counts", async () => {
			const files: Record<string, { content: string; mtime: number }> = {};

			// Distribution across 100 notes:
			// Note 0..19 (20 notes): stale due
			// Note 10..39 (30 notes): stale labels (overlap 10..19 with due)
			// Note 25..44 (20 notes): stale members (overlap 25..39 with labels)
			// Note 40..49 (10 notes): stale custom-fields
			// Note 50..54 (5 notes): stale attachments (syncAttachments: false)
			// Note 55..59 (5 notes): stale linked-cards (syncLinkedCards: false, syncAttachments: true)
			// Note 60..69 (10 notes): stale remote cover URL
			// Note 70..74 (5 notes): local cover path (must NOT count as stale cover!)
			// Note 75..79 (5 notes): stale trello_plugin_note_id (writeTrelloPluginNoteId: false)
			// Note 80..84 (5 notes): missing trello_plugin_note_id (linked card without plugin_note_id, writeTrelloPluginNoteId: true)
			// Note 85..89 (5 notes): stale checklist section in body
			// Note 90..94 (5 notes): obsolete label property
			// Note 95..99 (5 notes): 100% clean notes

			for (let i = 0; i < 100; i++) {
				const fm: string[] = [`trello_board_card_id: "board-1;card-${i}"`];
				let body = `Note body for ${i}`;

				if (i >= 0 && i < 20) {
					fm.push('trello_due: "2026-12-31"');
				}
				if (i >= 10 && i < 40) {
					fm.push('trello_labels:\n  - "bug"\n  - "feature"');
				}
				if (i >= 25 && i < 45) {
					fm.push('trello_members:\n  - "member1"');
				}
				if (i >= 40 && i < 50) {
					fm.push('trello_custom_fields:\n  Sprint: "24"');
				}
				if (i >= 50 && i < 55) {
					fm.push('trello_attachments:\n  - "att1"');
				}
				if (i >= 55 && i < 60) {
					fm.push('trello_linked_cards:\n  - "card-x"');
				}
				if (i >= 60 && i < 70) {
					fm.push('banner: "https://trello.com/1/cards/c1/attachments/a1/download"');
				}
				if (i >= 70 && i < 75) {
					fm.push('banner: "assets/banners/cover.png"');
				}
				if (i >= 75 && i < 80) {
					fm.push('trello_plugin_note_id: "pid-75"');
				}
				if (i >= 85 && i < 90) {
					body = `Content\n\n## Checklists\n- [ ] Task 1\n- [ ] Task 2`;
				}
				if (i >= 90 && i < 95) {
					fm.push('priority: "high"');
				}

				files[`notes/note-${i}.md`] = {
					content: `---\n${fm.join("\n")}\n---\n\n${body}`,
					mtime: 1700000000000 + i * 1000,
				};
			}

			const vault = new FakeVault(files);
			const ctx = buildStressContext(vault);

			// First run: test with syncAttachments: true and syncLinkedCards: false
			// Here, notes 50..54 (attachments) are active (clean), and notes 55..59 (linked cards) are stale under linked-cards!
			ctx.settings.syncDue = false;
			ctx.settings.syncLabels = false;
			ctx.settings.syncMembers = false;
			ctx.settings.syncCustomFields = false;
			ctx.settings.syncAttachments = true;
			ctx.settings.syncLinkedCards = false;
			ctx.settings.syncCardCover = false;
			ctx.settings.writeTrelloPluginNoteId = false; // Note 75..79 will have stale plugin note id
			ctx.settings.syncChecklists = false;
			ctx.settings.labelPropertySync = false;
			(ctx.settings as any).obsoleteLabelPropertyKeys = ["priority"];

			let capturedItems: AlignCategory[] = [];
			let capturedLabelFor: (item: AlignCategory) => string = () => "";

			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedItems = this.items;
				capturedLabelFor = this.labelFor;
			});

			await alignNotesWithSettings(ctx);

			expect(capturedItems.length).toBeGreaterThan(0);

			// Verify precise counts per category:
			expect(capturedLabelFor("due")).toBe(`${ALIGN_CATEGORY_LABELS.due} (20 notes)`);
			expect(capturedLabelFor("labels")).toBe(`${ALIGN_CATEGORY_LABELS.labels} (30 notes)`);
			expect(capturedLabelFor("members")).toBe(`${ALIGN_CATEGORY_LABELS.members} (20 notes)`);
			expect(capturedLabelFor("custom-fields")).toBe(`${ALIGN_CATEGORY_LABELS["custom-fields"]} (10 notes)`);
			expect(capturedItems).not.toContain("attachments"); // 0 notes with stale attachments since syncAttachments is true
			expect(capturedLabelFor("linked-cards")).toBe(`${ALIGN_CATEGORY_LABELS["linked-cards"]} (5 notes)`);
			expect(capturedLabelFor("cover")).toBe(`${ALIGN_CATEGORY_LABELS.cover} (10 notes)`);
			expect(capturedLabelFor("plugin-note-id")).toBe(`${ALIGN_CATEGORY_LABELS["plugin-note-id"]} (5 notes)`);
			expect(capturedLabelFor("checklist-section")).toBe(`${ALIGN_CATEGORY_LABELS["checklist-section"]} (5 notes)`);
			expect(capturedLabelFor("obsolete-label-property")).toBe(`${ALIGN_CATEGORY_LABELS["obsolete-label-property"]} (5 notes)`);

			// Local covers (70..74) were preserved, not counted under cover
		});

		test("when syncAttachments is false, prunes both attachments and linked-cards under attachments category", async () => {
			const vault = new FakeVault({
				"att.md": {
					content: '---\ntrello_board_card_id: "b1;c1"\ntrello_attachments:\n  - "att.png"\n---\n\n',
				},
				"linked.md": {
					content: '---\ntrello_board_card_id: "b1;c2"\ntrello_linked_cards:\n  - "c99"\n---\n\n',
				},
				"both.md": {
					content: '---\ntrello_board_card_id: "b1;c3"\ntrello_attachments:\n  - "att2.png"\ntrello_linked_cards:\n  - "c98"\n---\n\n',
				},
			});

			const ctx = buildStressContext(vault);
			ctx.settings.syncAttachments = false;
			ctx.settings.syncLinkedCards = false;

			let capturedItems: AlignCategory[] = [];
			let capturedLabelFor: (item: AlignCategory) => string = () => "";

			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedItems = this.items;
				capturedLabelFor = this.labelFor;
			});

			await alignNotesWithSettings(ctx);

			expect(capturedItems).toContain("attachments");
			// att.md, linked.md, and both.md all have stale attachments category (3 distinct notes)
			expect(capturedLabelFor("attachments")).toBe(`${ALIGN_CATEGORY_LABELS.attachments} (3 notes)`);
			// linked-cards is omitted because syncAttachments is false (subsumed under attachments)
			expect(capturedItems).not.toContain("linked-cards");
		});
	});

	// 2. Modal opening, option labels, and default selections
	describe("2. Modal opening, option labels and defaults", () => {
		test("count badges format accurately for singular (1 note) and plural (N notes)", async () => {
			const vault = new FakeVault({
				"single.md": {
					content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\n---\n\n',
				},
				"multi1.md": {
					content: '---\ntrello_board_card_id: "b1;c2"\ntrello_labels:\n  - "bug"\n---\n\n',
				},
				"multi2.md": {
					content: '---\ntrello_board_card_id: "b1;c3"\ntrello_labels:\n  - "feature"\n---\n\n',
				},
			});

			const ctx = buildStressContext(vault);
			ctx.settings.syncDue = false;
			ctx.settings.syncLabels = false;

			let capturedLabelFor: (item: AlignCategory) => string = () => "";

			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedLabelFor = this.labelFor;
			});

			await alignNotesWithSettings(ctx);

			expect(capturedLabelFor("due")).toBe(`${ALIGN_CATEGORY_LABELS.due} (1 note)`);
			expect(capturedLabelFor("labels")).toBe(`${ALIGN_CATEGORY_LABELS.labels} (2 notes)`);
		});

		test("strictly keeps sensitive categories unchecked by default", async () => {
			const vault = new FakeVault({
				"note1.md": {
					content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\ntrello_plugin_note_id: "pid-1"\npriority: "high"\n---\n\n## Checklists\n- [ ] Task',
				},
			});

			const ctx = buildStressContext(vault);
			ctx.settings.syncDue = false;
			ctx.settings.writeTrelloPluginNoteId = false;
			ctx.settings.syncChecklists = false;
			ctx.settings.labelPropertySync = false;
			(ctx.settings as any).obsoleteLabelPropertyKeys = ["priority"];

			let capturedItems: AlignCategory[] = [];
			let capturedSelectedIndices = new Set<number>();

			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedItems = this.items;
				capturedSelectedIndices = new Set(this.selected);
			});

			await alignNotesWithSettings(ctx);

			const isSelected = (item: AlignCategory) => {
				const idx = capturedItems.indexOf(item);
				return idx !== -1 && capturedSelectedIndices.has(idx);
			};

			// Due is safe and checked
			expect(isSelected("due")).toBe(true);

			// Sensitive are NOT checked
			expect(isSelected("plugin-note-id")).toBe(false);
			expect(isSelected("checklist-section")).toBe(false);
			expect(isSelected("obsolete-label-property")).toBe(false);
		});

		test("preselect isolates selection to only the specified category", async () => {
			const vault = new FakeVault({
				"note1.md": {
					content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\n---\n\n## Checklists\n- [ ] Task',
				},
			});

			const ctx = buildStressContext(vault);
			ctx.settings.syncDue = false;
			ctx.settings.syncChecklists = false;

			let capturedItems: AlignCategory[] = [];
			let capturedSelectedIndices = new Set<number>();

			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedItems = this.items;
				capturedSelectedIndices = new Set(this.selected);
			});

			// User opens directly targeting checklist-section
			await alignNotesWithSettings(ctx, "checklist-section");

			const isSelected = (item: AlignCategory) => {
				const idx = capturedItems.indexOf(item);
				return idx !== -1 && capturedSelectedIndices.has(idx);
			};

			expect(isSelected("checklist-section")).toBe(true);
			expect(isSelected("due")).toBe(false);
		});
	});

	// 3. Confirmation flow: alignNotes called with exact categories, keepMtime, history recording
	describe("3. Confirmation flow & execution parameters", () => {
		test("calls alignNotes with exact selected categories, keepMtime: true and records history", async () => {
			let capturedOnConfirm: ((selected: AlignCategory[]) => void) | undefined;

			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedOnConfirm = this.onConfirm;
			});

			const initialMtime = 1712345678000;
			const vault = new FakeVault({
				"note-a.md": {
					content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\ntrello_members:\n  - "alice"\ntrello_labels:\n  - "bug"\n---\n\nContent A',
					mtime: initialMtime,
				},
				"note-b.md": {
					content: '---\ntrello_board_card_id: "b1;c2"\ntrello_due: "2026-11-20"\ntrello_members:\n  - "bob"\n---\n\nContent B',
					mtime: initialMtime + 5000,
				},
			});

			const recordedScopes: string[] = [];
			const ctx = buildStressContext(vault, {
				recordSyncRun: async (scope) => {
					recordedScopes.push(scope);
				},
			});

			ctx.settings.syncDue = false;
			ctx.settings.syncMembers = false;
			ctx.settings.syncLabels = false;

			await alignNotesWithSettings(ctx);
			expect(capturedOnConfirm).toBeDefined();

			// Confirm with ONLY due and members (leaving labels untouched)
			capturedOnConfirm!(["due", "members"]);
			await new Promise((resolve) => setTimeout(resolve, 0));

			// Verify frontmatter changes:
			const fmA = vault.readFrontmatter(vault.note("note-a.md"));
			expect(fmA?.trello_due).toBeUndefined();
			expect(fmA?.trello_members).toBeUndefined();
			expect(fmA?.trello_labels).toEqual(["bug"]); // Untouched!

			const fmB = vault.readFrontmatter(vault.note("note-b.md"));
			expect(fmB?.trello_due).toBeUndefined();
			expect(fmB?.trello_members).toBeUndefined();

			// Verify timestamps preserved
			expect(vault.note("note-a.md").mtime).toBe(initialMtime);
			expect(vault.note("note-b.md").mtime).toBe(initialMtime + 5000);

			// Verify history recorded
			expect(recordedScopes).toContain("Clean up notes");

			// Verify notice formatted
			expect(noticeMessages).toContain("Cleaned 2 notes across 2 categories.");
		});

		test("supports custom ctx.withHistoryRecording returning result", async () => {
			let capturedOnConfirm: ((selected: AlignCategory[]) => void) | undefined;

			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedOnConfirm = this.onConfirm;
			});

			const vault = new FakeVault({
				"note.md": {
					content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\n---\n\n',
				},
			});

			let customHistoryScope = "";
			const customWithHistory = vi.fn(async (scope: string, fn: any) => {
				customHistoryScope = scope;
				return fn(vault);
			});

			const ctx = buildStressContext(vault, {
				withHistoryRecording: customWithHistory,
			} as any);
			ctx.settings.syncDue = false;

			await alignNotesWithSettings(ctx);
			capturedOnConfirm!(["due"]);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(customWithHistory).toHaveBeenCalled();
			expect(customHistoryScope).toBe("Clean up notes");
			expect(vault.readFrontmatter(vault.note("note.md"))?.trello_due).toBeUndefined();
		});

		test("passes reporter and signal through ctx.run to alignNotes", async () => {
			const vault = new FakeVault({
				"note.md": {
					content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\n---\n\n',
				},
			});

			let runPassedReporter: any = null;
			let runPassedSignal: any = null;

			const ctx = buildStressContext(vault, {
				run: async (_title, body) => {
					const controller = new AbortController();
					const rep = recordingReporter();
					runPassedReporter = rep;
					runPassedSignal = controller.signal;
					await body(rep, controller.signal);
				},
			});
			ctx.settings.syncDue = false;

			const result = await executeAlignNotes(ctx, [vault.note("note.md")], ["due"]);

			expect(result.notesModified).toBe(1);
			expect(runPassedReporter).toBeDefined();
			expect(runPassedSignal).toBeDefined();
			expect(runPassedReporter.logs.some((l: any) => l.message.includes("note"))).toBe(true);
		});
	});

	// 4. Cancellation flow: zero modifications made
	describe("4. Cancellation flow", () => {
		test("cancelling / closing modal without confirm leaves all notes untouched", async () => {
			const initialContent = '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\n---\n\nBody';
			const initialMtime = 1712000000000;
			const vault = new FakeVault({
				"note.md": { content: initialContent, mtime: initialMtime },
			});

			const ctx = buildStressContext(vault);
			ctx.settings.syncDue = false;

			// Modal opens, but onConfirm is NEVER called (user cancelled or pressed Esc)
			await alignNotesWithSettings(ctx);

			expect(vault.contentOf("note.md")).toBe(initialContent);
			expect(vault.note("note.md").mtime).toBe(initialMtime);
			expect(noticeMessages.length).toBe(0);
		});

		test("confirming with 0 categories selected reports notice and makes zero modifications", async () => {
			let capturedOnConfirm: ((selected: AlignCategory[]) => void) | undefined;

			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedOnConfirm = this.onConfirm;
			});

			const initialContent = '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\n---\n\nBody';
			const vault = new FakeVault({ "note.md": { content: initialContent } });

			const ctx = buildStressContext(vault);
			ctx.settings.syncDue = false;

			await alignNotesWithSettings(ctx);
			expect(capturedOnConfirm).toBeDefined();

			capturedOnConfirm!([]);

			expect(noticeMessages).toContain("No categories selected — nothing cleaned.");
			expect(vault.contentOf("note.md")).toBe(initialContent);
		});
	});

	// 5. Notice formatting across dry-run and live executions
	describe("5. Notice formatting", () => {
		test("formatAlignSummary handles all grammatical combinations and dryRun prefix", () => {
			// Zero
			expect(formatAlignSummary(0, 0)).toBe("Cleaned 0 notes across 0 categories.");
			expect(formatAlignSummary(0, 0, true)).toBe("[Dry-run] Cleaned 0 notes across 0 categories.");

			// Singular note, singular category
			expect(formatAlignSummary(1, 1)).toBe("Cleaned 1 note across 1 category.");
			expect(formatAlignSummary(1, 1, false)).toBe("Cleaned 1 note across 1 category.");
			expect(formatAlignSummary(1, 1, true)).toBe("[Dry-run] Cleaned 1 note across 1 category.");

			// Plural notes, singular category
			expect(formatAlignSummary(5, 1)).toBe("Cleaned 5 notes across 1 category.");
			expect(formatAlignSummary(5, 1, true)).toBe("[Dry-run] Cleaned 5 notes across 1 category.");

			// Singular note, plural categories
			expect(formatAlignSummary(1, 4)).toBe("Cleaned 1 note across 4 categories.");
			expect(formatAlignSummary(1, 4, true)).toBe("[Dry-run] Cleaned 1 note across 4 categories.");

			// Plural notes, plural categories
			expect(formatAlignSummary(42, 6)).toBe("Cleaned 42 notes across 6 categories.");
			expect(formatAlignSummary(42, 6, true)).toBe("[Dry-run] Cleaned 42 notes across 6 categories.");
		});

		test("live execution displays formatted notice with exact cleaned counts", async () => {
			const vault = new FakeVault({
				"note1.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\n---\n\n' },
				"note2.md": { content: '---\ntrello_board_card_id: "b1;c2"\ntrello_due: "2026-10-18"\n---\n\n' },
			});
			const ctx = buildStressContext(vault);
			ctx.settings.syncDue = false;

			await executeAlignNotes(ctx, vault.listNotes(""), ["due"]);

			expect(noticeMessages).toContain("Cleaned 2 notes across 1 category.");
		});

		test("dry-run execution displays [Dry-run] prefixed notice and touches 0 files", async () => {
			const initialContent = '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\n---\n\n';
			const vault = new FakeVault({
				"note1.md": { content: initialContent },
			});
			const ctx = buildStressContext(vault);
			ctx.settings.syncDue = false;
			ctx.settings.dryRun = true;

			await executeAlignNotes(ctx, vault.listNotes(""), ["due"]);

			expect(noticeMessages).toContain("[Dry-run] Cleaned 1 note across 1 category.");
			expect(vault.contentOf("note1.md")).toBe(initialContent);
		});
	});

	// 6. Concurrency, OperationGuard and Scope Exclusions
	describe("6. Concurrency, OperationGuard and Scope Exclusions", () => {
		test("acquires card lock per cardId during alignment", async () => {
			const vault = new FakeVault({
				"card1.md": { content: '---\ntrello_board_card_id: "b1;c100"\ntrello_due: "2026-10-18"\n---\n\n' },
				"card2.md": { content: '---\ntrello_board_card_id: "b1;c200"\ntrello_due: "2026-10-18"\n---\n\n' },
			});

			const guard = new OperationGuard();
			const withKeySpy = vi.spyOn(guard, "withKey");

			const ctx = buildStressContext(vault, { guard });
			ctx.settings.syncDue = false;

			await executeAlignNotes(ctx, vault.listNotes(""), ["due"]);

			expect(withKeySpy).toHaveBeenCalledWith("card:c100", expect.any(Function));
			expect(withKeySpy).toHaveBeenCalledWith("card:c200", expect.any(Function));
		});

		test("folder scope and exclusions filter which notes are inspected and aligned", async () => {
			const vault = new FakeVault({
				"Projects/Active/task.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\n---\n\n' },
				"Projects/Archive/old.md": { content: '---\ntrello_board_card_id: "b1;c2"\ntrello_due: "2026-10-18"\n---\n\n' },
				"Personal/note.md": { content: '---\ntrello_board_card_id: "b1;c3"\ntrello_due: "2026-10-18"\n---\n\n' },
			});

			const ctx = buildStressContext(vault);
			ctx.settings.scope = "Projects";
			ctx.settings.excludedFolders = ["Projects/Archive"];
			ctx.settings.syncDue = false;

			let capturedLabelFor: (item: AlignCategory) => string = () => "";
			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedLabelFor = this.labelFor;
			});

			await alignNotesWithSettings(ctx);

			// Only Projects/Active/task.md matches (Archive and Personal are excluded)
			expect(capturedLabelFor("due")).toBe(`${ALIGN_CATEGORY_LABELS.due} (1 note)`);
		});
	});

	// 7. Missing plugin note ID backfill & unlinked notes distinction
	describe("7. Missing plugin note ID backfill & unlinked notes distinction", () => {
		test("missing-plugin-note-id only flags linked notes lacking plugin note ID", async () => {
			const vault = new FakeVault({
				// Linked note lacking trello_plugin_note_id -> MUST be flagged
				"linked-missing.md": {
					content: '---\ntrello_board_card_id: "b1;c1"\n---\n\nLinked note',
				},
				// Linked note having valid trello_plugin_note_id -> NOT flagged
				"linked-has-id.md": {
					content: '---\ntrello_board_card_id: "b1;c2"\ntrello_plugin_note_id: "valid-123"\n---\n\nLinked with ID',
				},
				// Unlinked note lacking trello_plugin_note_id -> MUST NOT be flagged!
				"unlinked.md": {
					content: '---\ntags:\n  - idea\n---\n\nPlain unlinked note',
				},
			});

			const ctx = buildStressContext(vault);
			ctx.settings.writeTrelloPluginNoteId = true;

			let capturedItems: AlignCategory[] = [];
			let capturedLabelFor: (item: AlignCategory) => string = () => "";

			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedItems = this.items;
				capturedLabelFor = this.labelFor;
			});

			await alignNotesWithSettings(ctx);

			expect(capturedItems).toContain("missing-plugin-note-id");
			// Exactly 1 note (linked-missing.md)
			expect(capturedLabelFor("missing-plugin-note-id")).toBe(
				`${ALIGN_CATEGORY_LABELS["missing-plugin-note-id"]} (1 note)`,
			);
		});
	});

	// 8. Key migrations stress test (per-note counting and value preservation)
	describe("8. Key migrations stress test", () => {
		test("per-note counting for notes with multiple migration keys", async () => {
			const vault = new FakeVault({
				"note-multi-keys.md": {
					content: '---\ntrello_board_card_id: "b1;c1"\nold_prio: "High"\nold_status: "Done"\n---\n\n',
				},
				"note-single-key.md": {
					content: '---\ntrello_board_card_id: "b1;c2"\nold_prio: "Low"\n---\n\n',
				},
			});

			const ctx = buildStressContext(vault);
			(ctx.settings as any).keyMigrations = {
				old_prio: "priority",
				old_status: "status",
			};

			let capturedLabelFor: (item: AlignCategory) => string = () => "";
			let capturedOnConfirm: ((selected: AlignCategory[]) => void) | undefined;

			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedLabelFor = this.labelFor;
				capturedOnConfirm = this.onConfirm;
			});

			await alignNotesWithSettings(ctx);

			// Even though note-multi-keys has 2 matching keys, count is 2 notes total!
			expect(capturedLabelFor("key-migration")).toBe(`${ALIGN_CATEGORY_LABELS["key-migration"]} (2 notes)`);

			capturedOnConfirm!(["key-migration"]);
			await new Promise((resolve) => setTimeout(resolve, 0));

			const fm1 = vault.readFrontmatter(vault.note("note-multi-keys.md"));
			expect(fm1?.priority).toBe("High");
			expect(fm1?.status).toBe("Done");
			expect(fm1?.old_prio).toBeUndefined();
			expect(fm1?.old_status).toBeUndefined();

			const fm2 = vault.readFrontmatter(vault.note("note-single-key.md"));
			expect(fm2?.priority).toBe("Low");
			expect(fm2?.old_prio).toBeUndefined();
		});
	});

	// 9. Multi-stage iterative alignment
	describe("9. Multi-stage iterative alignment", () => {
		test("progressively cleans categories across multiple runs until fully aligned", async () => {
			const vault = new FakeVault({
				"note.md": {
					content: '---\ntrello_board_card_id: "b1;c1"\ntrello_plugin_note_id: "pid-1"\ntrello_due: "2026-10-18"\ntrello_labels:\n  - "bug"\ntrello_members:\n  - "user1"\n---\n\n## Checklists\n- [ ] Task 1',
				},
			});

			const ctx = buildStressContext(vault);
			ctx.settings.syncDue = false;
			ctx.settings.syncLabels = false;
			ctx.settings.syncMembers = false;
			ctx.settings.syncChecklists = false;

			let capturedItems: AlignCategory[] = [];
			let capturedOnConfirm: ((selected: AlignCategory[]) => void) | undefined;

			const openSpy = vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedItems = this.items;
				capturedOnConfirm = this.onConfirm;
			});

			// --- Pass 1: Clean due and labels ---
			await alignNotesWithSettings(ctx);
			expect(openSpy).toHaveBeenCalledTimes(1);
			expect(capturedItems).toEqual(expect.arrayContaining(["due", "labels", "members", "checklist-section"]));

			capturedOnConfirm!(["due", "labels"]);
			await new Promise((resolve) => setTimeout(resolve, 0));

			const fmPass1 = vault.readFrontmatter(vault.note("note.md"));
			expect(fmPass1?.trello_due).toBeUndefined();
			expect(fmPass1?.trello_labels).toBeUndefined();
			expect(fmPass1?.trello_members).toBeDefined();

			// --- Pass 2: Clean members ---
			await alignNotesWithSettings(ctx);
			expect(openSpy).toHaveBeenCalledTimes(2);
			expect(capturedItems).not.toContain("due");
			expect(capturedItems).not.toContain("labels");
			expect(capturedItems).toContain("members");
			expect(capturedItems).toContain("checklist-section");

			capturedOnConfirm!(["members"]);
			await new Promise((resolve) => setTimeout(resolve, 0));

			const fmPass2 = vault.readFrontmatter(vault.note("note.md"));
			expect(fmPass2?.trello_members).toBeUndefined();

			// --- Pass 3: Clean checklist-section ---
			await alignNotesWithSettings(ctx);
			expect(openSpy).toHaveBeenCalledTimes(3);
			expect(capturedItems).toEqual(["checklist-section"]);

			capturedOnConfirm!(["checklist-section"]);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(vault.contentOf("note.md")).not.toContain("## Checklists");

			// --- Pass 4: All clean -> No modal opened ---
			await alignNotesWithSettings(ctx);
			expect(openSpy).toHaveBeenCalledTimes(3); // Not opened again
			expect(noticeMessages).toContain("All notes are already aligned with current settings.");
		});
	});

	// 10. Fault tolerance and corrupted notes resilience
	describe("10. Fault tolerance & corrupted notes resilience", () => {
		test("does not throw when encountering note with empty/null frontmatter", async () => {
			const vault = new FakeVault({
				"empty.md": { content: "Just markdown text with no frontmatter" },
				"stale.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\n---\n\n' },
			});

			const ctx = buildStressContext(vault);
			ctx.settings.syncDue = false;

			let capturedLabelFor: (item: AlignCategory) => string = () => "";
			vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: any) {
				capturedLabelFor = this.labelFor;
			});

			await expect(alignNotesWithSettings(ctx)).resolves.not.toThrow();
			expect(capturedLabelFor("due")).toBe(`${ALIGN_CATEGORY_LABELS.due} (1 note)`);
		});

		test("does not halt batch when reading note throws an error", async () => {
			const vault = new FakeVault({
				"good1.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\n---\n\n' },
				"bad.md": { content: '---\ntrello_board_card_id: "b1;c2"\ntrello_due: "2026-10-18"\n---\n\n' },
				"good2.md": { content: '---\ntrello_board_card_id: "b1;c3"\ntrello_due: "2026-10-18"\n---\n\n' },
			});

			// Sabotage bad.md so writeFrontmatter throws
			const origWriteFm = vault.writeFrontmatter.bind(vault);
			vault.writeFrontmatter = async (note, mutate, options) => {
				if (note.basename === "bad") {
					throw new Error("Disk write I/O error on bad.md");
				}
				return origWriteFm(note, mutate, options);
			};

			const ctx = buildStressContext(vault);
			ctx.settings.syncDue = false;

			const result = await executeAlignNotes(ctx, vault.listNotes(""), ["due"]);

			// good1 and good2 were modified successfully despite bad.md failing
			expect(result.notesModified).toBe(2);
			expect(vault.readFrontmatter(vault.note("good1.md"))?.trello_due).toBeUndefined();
			expect(vault.readFrontmatter(vault.note("good2.md"))?.trello_due).toBeUndefined();
			expect(vault.readFrontmatter(vault.note("bad.md"))?.trello_due).toBe("2026-10-18");
		});
	});
});

