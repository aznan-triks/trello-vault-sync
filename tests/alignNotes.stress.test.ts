import { describe, expect, test, vi } from "vitest";
import { OperationGuard } from "../src/core/operationGuard";
import {
	ALIGN_CATEGORIES,
	type AlignCategory,
	type AlignSettings,
} from "../src/core/staleProperties";
import {
	alignNote,
	alignNotes,
	type AlignResult,
} from "../src/features/alignNotes";
import { type SyncAction } from "../src/core/syncHistory";
import { wrapWithHistoryRecorder } from "../src/features/syncHistoryRecorder";
import { FakeVault, recordingReporter } from "./fakes";

function createSettings(overrides: Partial<AlignSettings> = {}): AlignSettings {
	return {
		syncDue: true,
		dueFrontmatterKey: "trello_due",
		syncLabels: true,
		labelsFrontmatterKey: "trello_labels",
		syncMembers: true,
		membersFrontmatterKey: "trello_members",
		syncCustomFields: true,
		customFieldsFrontmatterKey: "trello_custom_fields",
		syncAttachments: true,
		attachmentsFrontmatterKey: "trello_attachments",
		syncLinkedCards: true,
		linkedCardsFrontmatterKey: "trello_linked_cards",
		syncCardCover: true,
		coverFrontmatterKey: "banner",
		writeTrelloPluginNoteId: true,
		syncChecklists: true,
		checklistHeading: "## Checklists",
		labelPropertySync: true,
		labelPropertyMappings: [],
		obsoleteLabelPropertyKeys: [],
		keyMigrations: {},
		...overrides,
	};
}

describe("Milestone 3 Empirical Stress Tests", () => {
	// =========================================================================
	// 1. Concurrency Stress
	// =========================================================================
	describe("1. Concurrency Stress", () => {
		test("serializes two concurrent alignNotes operations sharing the same card:<id>", async () => {
			const settings = createSettings({ syncDue: false, syncLabels: false });
			const guard = new OperationGuard();

			const vault = new FakeVault({
				"noteA.md": {
					content: '---\ntrello_board_card_id: "board1;card_shared"\ntrello_due: "2026-10-31"\n---\n\nBody A',
					mtime: 100,
				},
				"noteB.md": {
					content: '---\ntrello_board_card_id: "board1;card_shared"\ntrello_labels:\n  - "bug"\n---\n\nBody B',
					mtime: 100,
				},
			});

			let activeCount = 0;
			let maxConcurrent = 0;
			const executionLog: string[] = [];

			const origWriteFm = vault.writeFrontmatter.bind(vault);
			vi.spyOn(vault, "writeFrontmatter").mockImplementation(async (note, mutate, options) => {
				activeCount++;
				maxConcurrent = Math.max(maxConcurrent, activeCount);
				executionLog.push(`start:${note.basename}`);

				// Artificial async delay to expose race condition if not serialized
				await new Promise((resolve) => setTimeout(resolve, 25));

				await origWriteFm(note, mutate, options);
				executionLog.push(`end:${note.basename}`);
				activeCount--;
			});

			const noteA = vault.note("noteA.md");
			const noteB = vault.note("noteB.md");

			// Launch both alignNotes concurrently with the same guard
			const [resA, resB] = await Promise.all([
				alignNotes(vault, [noteA], ["due"], settings, { guard }),
				alignNotes(vault, [noteB], ["labels"], settings, { guard }),
			]);

			// Guard must ensure strictly non-overlapping execution (max concurrency = 1)
			expect(maxConcurrent).toBe(1);
			expect(activeCount).toBe(0);

			// Both notes modified cleanly
			expect(resA.notesModified).toBe(1);
			expect(resB.notesModified).toBe(1);

			// Execution log shows non-overlapping start/end
			expect(executionLog).toHaveLength(4);
			const firstStart = executionLog[0];
			const firstEnd = executionLog[1];
			const secondStart = executionLog[2];
			const secondEnd = executionLog[3];

			expect(firstStart?.replace("start:", "")).toBe(firstEnd?.replace("end:", ""));
			expect(secondStart?.replace("start:", "")).toBe(secondEnd?.replace("end:", ""));

			// Verify frontmatter changes applied
			expect(vault.readFrontmatter(noteA)?.trello_due).toBeUndefined();
			expect(vault.readFrontmatter(noteB)?.trello_labels).toBeUndefined();
		});

		test("high-concurrency storm: 9 concurrent operations across 3 cards serialize per-card without deadlock", async () => {
			const settings = createSettings({ syncDue: false });
			const guard = new OperationGuard();

			const files: Record<string, { content: string }> = {};
			for (let i = 0; i < 9; i++) {
				const cardId = `card_${i % 3}`;
				files[`task_${i}.md`] = {
					content: `---\ntrello_board_card_id: "board1;${cardId}"\ntrello_due: "2026-10-31"\n---\n\nTask ${i}`,
				};
			}

			const vault = new FakeVault(files);

			const activePerCard = new Map<string, number>();
			const maxPerCard = new Map<string, number>();

			const origWriteFm = vault.writeFrontmatter.bind(vault);
			vi.spyOn(vault, "writeFrontmatter").mockImplementation(async (note, mutate, options) => {
				const cardRef = vault.getCardRef(note);
				const cardKey = cardRef ? cardRef.cardId : "none";

				const current = (activePerCard.get(cardKey) ?? 0) + 1;
				activePerCard.set(cardKey, current);
				maxPerCard.set(cardKey, Math.max(maxPerCard.get(cardKey) ?? 0, current));

				await new Promise((resolve) => setTimeout(resolve, 10));

				await origWriteFm(note, mutate, options);
				activePerCard.set(cardKey, (activePerCard.get(cardKey) ?? 1) - 1);
			});

			const promises = Object.keys(files).map((path) => {
				const note = vault.note(path);
				return alignNotes(vault, [note], ["due"], settings, { guard });
			});

			const results = await Promise.all(promises);

			// All 9 finished successfully
			expect(results).toHaveLength(9);
			for (const r of results) {
				expect(r.notesModified).toBe(1);
			}

			// For each of the 3 cards, max concurrent operations was strictly 1
			expect(maxPerCard.get("card_0")).toBe(1);
			expect(maxPerCard.get("card_1")).toBe(1);
			expect(maxPerCard.get("card_2")).toBe(1);

			// Every task has trello_due removed
			for (let i = 0; i < 9; i++) {
				expect(vault.readFrontmatter(vault.note(`task_${i}.md`))?.trello_due).toBeUndefined();
			}
		});

		test("guard resilience: error in first operation does not deadlock subsequent operations on same key", async () => {
			const settings = createSettings({ syncDue: false });
			const guard = new OperationGuard();

			const vault = new FakeVault({
				"note1_faulty.md": {
					content: '---\ntrello_board_card_id: "b1;card_err"\ntrello_due: "2026-10-31"\n---\n\n',
				},
				"note2_healthy.md": {
					content: '---\ntrello_board_card_id: "b1;card_err"\ntrello_due: "2026-10-31"\n---\n\n',
				},
			});

			let firstCall = true;
			const origWriteFm = vault.writeFrontmatter.bind(vault);
			vi.spyOn(vault, "writeFrontmatter").mockImplementation(async (note, mutate, options) => {
				if (firstCall) {
					firstCall = false;
					throw new Error("Simulated disk fault");
				}
				return origWriteFm(note, mutate, options);
			});

			const note1 = vault.note("note1_faulty.md");
			const note2 = vault.note("note2_healthy.md");

			const [res1, res2] = await Promise.all([
				alignNotes(vault, [note1], ["due"], settings, { guard }),
				alignNotes(vault, [note2], ["due"], settings, { guard }),
			]);

			expect(res1.notesModified).toBe(0); // Failed
			expect(res2.notesModified).toBe(1); // Succeeded despite previous failure on same card key
			expect(vault.readFrontmatter(note2)?.trello_due).toBeUndefined();
		});

		test("serializes concurrent operations when cardId is only in frontmatter and getCardRef returns null", async () => {
			const settings = createSettings({ syncDue: false });
			const guard = new OperationGuard();

			const vault = new FakeVault({
				"fmOnlyA.md": {
					content: '---\ntrello_board_card_id: "board1;card_fm_only"\ntrello_due: "2026-10-31"\n---\n\n',
				},
				"fmOnlyB.md": {
					content: '---\ntrello_board_card_id: "board1;card_fm_only"\ntrello_due: "2026-10-31"\n---\n\n',
				},
			});

			// Force getCardRef to return null to test frontmatter fallback
			vi.spyOn(vault, "getCardRef").mockReturnValue(null);

			let active = 0;
			let maxActive = 0;
			const origWriteFm = vault.writeFrontmatter.bind(vault);
			vi.spyOn(vault, "writeFrontmatter").mockImplementation(async (note, mutate, options) => {
				active++;
				maxActive = Math.max(maxActive, active);
				await new Promise((resolve) => setTimeout(resolve, 20));
				await origWriteFm(note, mutate, options);
				active--;
			});

			const noteA = vault.note("fmOnlyA.md");
			const noteB = vault.note("fmOnlyB.md");

			await Promise.all([
				alignNotes(vault, [noteA], ["due"], settings, { guard }),
				alignNotes(vault, [noteB], ["due"], settings, { guard }),
			]);

			expect(maxActive).toBe(1);
			expect(vault.readFrontmatter(noteA)?.trello_due).toBeUndefined();
			expect(vault.readFrontmatter(noteB)?.trello_due).toBeUndefined();
		});
	});

	// =========================================================================
	// 2. Dry-Run Stress across 50 notes
	// =========================================================================
	describe("2. Dry-Run Stress", () => {
		test("empirically across 50 notes, dryRun: true results in exactly 0 calls to writeFrontmatter and 0 calls to write", async () => {
			const settings = createSettings({
				syncDue: false,
				syncLabels: false,
				syncMembers: false,
				syncCustomFields: false,
				syncAttachments: false,
				syncLinkedCards: false,
				syncCardCover: false,
				writeTrelloPluginNoteId: false,
				syncChecklists: false,
				labelPropertyMappings: [],
				obsoleteLabelPropertyKeys: ["obsolete_status"],
				keyMigrations: { legacy_due: "trello_due" },
			});

			const trelloCover = "https://trello-attachments.s3.amazonaws.com/xyz/cover.jpg";
			const files: Record<string, { content: string; mtime: number }> = {};

			// Generate 50 distinct notes covering all categories
			for (let i = 0; i < 50; i++) {
				const cardId = `c_${i}`;
				let fmBlock = `trello_board_card_id: "b1;${cardId}"\n`;
				let body = `\nBody content for note ${i}\n`;

				const categoryIndex = i % 11;
				switch (categoryIndex) {
					case 0:
						fmBlock += 'trello_due: "2026-12-31"\n';
						break;
					case 1:
						fmBlock += 'trello_labels:\n  - "p1"\n';
						break;
					case 2:
						fmBlock += 'trello_members:\n  - "bob"\n';
						break;
					case 3:
						fmBlock += "trello_custom_fields:\n  Score: 100\n";
						break;
					case 4:
						fmBlock += 'trello_attachments:\n  - "report.pdf"\n';
						break;
					case 5:
						fmBlock += 'trello_linked_cards:\n  - "linked_c1"\n';
						break;
					case 6:
						fmBlock += `banner: "${trelloCover}"\n`;
						break;
					case 7:
						fmBlock += 'trello_plugin_note_id: "uuid-1234"\n';
						break;
					case 8:
						body += "\n## Checklists\n- [ ] Stale item\n";
						break;
					case 9:
						fmBlock += 'obsolete_status: "in-progress"\n';
						break;
					case 10:
						fmBlock += 'legacy_due: "2026-11-15"\n';
						break;
				}

				files[`note_${i}.md`] = {
					content: `---\n${fmBlock}---\n${body}`,
					mtime: 1000 + i,
				};
			}

			const vault = new FakeVault(files);

			// Snapshot initial content and mtime of every note
			const initialContents: Record<string, string> = {};
			const initialMtimes: Record<string, number> = {};
			for (let i = 0; i < 50; i++) {
				const path = `note_${i}.md`;
				initialContents[path] = vault.contentOf(path);
				initialMtimes[path] = vault.note(path).mtime;
			}

			const writeFmSpy = vi.spyOn(vault, "writeFrontmatter");
			const writeSpy = vi.spyOn(vault, "write");

			const notes = vault.listNotes("");
			expect(notes).toHaveLength(50);

			const result: AlignResult = await alignNotes(
				vault,
				notes,
				ALIGN_CATEGORIES,
				settings,
				{ dryRun: true },
			);

			// STRICT REQUIREMENT: exactly 0 calls to writeFrontmatter and 0 calls to write
			expect(writeFmSpy).toHaveBeenCalledTimes(0);
			expect(writeSpy).toHaveBeenCalledTimes(0);

			// Scanned and modified counts reflect dry-run projections accurately
			expect(result.notesScanned).toBe(50);
			expect(result.notesModified).toBe(50);

			// Every single note is byte-for-byte identical to its initial state
			for (let i = 0; i < 50; i++) {
				const path = `note_${i}.md`;
				expect(vault.contentOf(path)).toBe(initialContents[path]);
				expect(vault.note(path).mtime).toBe(initialMtimes[path]);
			}
		});

		test("dry-run across 50 notes under wrapWithHistoryRecorder produces exactly 0 recorded history actions", async () => {
			const settings = createSettings({ syncDue: false });
			const files: Record<string, { content: string }> = {};
			for (let i = 0; i < 50; i++) {
				files[`task_${i}.md`] = {
					content: `---\ntrello_board_card_id: "b1;c${i}"\ntrello_due: "2026-10-31"\n---\n\n`,
				};
			}

			const vault = new FakeVault(files);
			const recordedActions: SyncAction[] = [];
			const recordedVault = wrapWithHistoryRecorder(vault, (action) => recordedActions.push(action));

			const notes = recordedVault.listNotes("");
			const result = await alignNotes(recordedVault, notes, ["due"], settings, { dryRun: true });

			expect(result.notesScanned).toBe(50);
			expect(result.notesModified).toBe(50);
			// Exactly zero actions recorded during dry-run
			expect(recordedActions).toHaveLength(0);
		});

		test("dry-run across 50 notes for missing-plugin-note-id performs 0 writes and reports 50 planned additions", async () => {
			const settings = createSettings({ writeTrelloPluginNoteId: true });
			const files: Record<string, { content: string }> = {};
			for (let i = 0; i < 50; i++) {
				files[`item_${i}.md`] = {
					content: `---\ntrello_board_card_id: "b1;c${i}"\n---\n\n`,
				};
			}

			const vault = new FakeVault(files);
			const writeFmSpy = vi.spyOn(vault, "writeFrontmatter");
			const notes = vault.listNotes("");

			const result = await alignNotes(vault, notes, ["missing-plugin-note-id"], settings, { dryRun: true });

			expect(result.notesScanned).toBe(50);
			expect(result.notesModified).toBe(50);
			expect(result.changesByCategory["missing-plugin-note-id"]).toBe(50);
			expect(writeFmSpy).toHaveBeenCalledTimes(0);

			for (let i = 0; i < 50; i++) {
				const fm = vault.readFrontmatter(vault.note(`item_${i}.md`));
				expect(fm?.trello_plugin_note_id).toBeUndefined();
			}
		});
	});

	// =========================================================================
	// 3. Timestamp Stress across all 12 categories
	// =========================================================================
	describe("3. Timestamp Stress", () => {
		const trelloCover = "https://trello-attachments.s3.amazonaws.com/board/cover.jpg";

		interface CategoryCase {
			category: AlignCategory;
			settingsOverride: Partial<AlignSettings>;
			noteContent: string;
		}

		const cases: CategoryCase[] = [
			{
				category: "due",
				settingsOverride: { syncDue: false },
				noteContent: '---\ntrello_board_card_id: "b;c"\ntrello_due: "2026-10-31"\n---\n\n',
			},
			{
				category: "labels",
				settingsOverride: { syncLabels: false },
				noteContent: '---\ntrello_board_card_id: "b;c"\ntrello_labels:\n  - "tag"\n---\n\n',
			},
			{
				category: "members",
				settingsOverride: { syncMembers: false },
				noteContent: '---\ntrello_board_card_id: "b;c"\ntrello_members:\n  - "u1"\n---\n\n',
			},
			{
				category: "custom-fields",
				settingsOverride: { syncCustomFields: false },
				noteContent: '---\ntrello_board_card_id: "b;c"\ntrello_custom_fields:\n  F: "V"\n---\n\n',
			},
			{
				category: "attachments",
				settingsOverride: { syncAttachments: false },
				noteContent: '---\ntrello_board_card_id: "b;c"\ntrello_attachments:\n  - "att"\n---\n\n',
			},
			{
				category: "linked-cards",
				settingsOverride: { syncAttachments: true, syncLinkedCards: false },
				noteContent: '---\ntrello_board_card_id: "b;c"\ntrello_linked_cards:\n  - "lc"\n---\n\n',
			},
			{
				category: "cover",
				settingsOverride: { syncCardCover: false },
				noteContent: `---\ntrello_board_card_id: "b;c"\nbanner: "${trelloCover}"\n---\n\n`,
			},
			{
				category: "plugin-note-id",
				settingsOverride: { writeTrelloPluginNoteId: false },
				noteContent: '---\ntrello_board_card_id: "b;c"\ntrello_plugin_note_id: "pid"\n---\n\n',
			},
			{
				category: "missing-plugin-note-id",
				settingsOverride: { writeTrelloPluginNoteId: true },
				noteContent: '---\ntrello_board_card_id: "b;c"\n---\n\n',
			},
			{
				category: "checklist-section",
				settingsOverride: { syncChecklists: false },
				noteContent: '---\ntrello_board_card_id: "b;c"\n---\n\n## Checklists\n- [ ] Task\n',
			},
			{
				category: "obsolete-label-property",
				settingsOverride: { obsoleteLabelPropertyKeys: ["obsolete_prop"] },
				noteContent: '---\ntrello_board_card_id: "b;c"\nobsolete_prop: "val"\n---\n\n',
			},
			{
				category: "key-migration",
				settingsOverride: { keyMigrations: { old_key: "new_key" } },
				noteContent: '---\ntrello_board_card_id: "b;c"\nold_key: "migrated"\n---\n\n',
			},
		];

		test.each(cases)(
			"category $category: keepMtime: true preserves mtime, keepMtime: false increments mtime",
			async ({ category, settingsOverride, noteContent }) => {
				const settings = createSettings(settingsOverride);
				const INITIAL_MTIME = 5000;

				// 1. Test with keepMtime: true
				const vaultKeep = new FakeVault({
					"note.md": { content: noteContent, mtime: INITIAL_MTIME },
				});
				const noteKeep = vaultKeep.note("note.md");

				const changesKeep = await alignNote(vaultKeep, noteKeep, [category], settings, {
					keepMtime: true,
				});
				expect(changesKeep.length).toBeGreaterThan(0);
				expect(vaultKeep.note("note.md").mtime).toBe(INITIAL_MTIME);

				// 2. Test with keepMtime: false
				const vaultInc = new FakeVault({
					"note.md": { content: noteContent, mtime: INITIAL_MTIME },
				});
				const noteInc = vaultInc.note("note.md");

				const changesInc = await alignNote(vaultInc, noteInc, [category], settings, {
					keepMtime: false,
				});
				expect(changesInc.length).toBeGreaterThan(0);
				expect(vaultInc.note("note.md").mtime).toBeGreaterThan(INITIAL_MTIME);
			},
		);

		test("multi-category composite note: keepMtime: true preserves mtime across frontmatter and body surgery", async () => {
			const settings = createSettings({
				syncDue: false,
				syncLabels: false,
				syncChecklists: false,
			});

			const INITIAL_MTIME = 7777;
			const compositeContent = `---
trello_board_card_id: "b;c"
trello_due: "2026-10-31"
trello_labels:
  - "bug"
---

Intro prose

## Checklists
- [ ] Task 1

Outro prose`;

			// keepMtime: true -> mtime remains exactly 7777 despite both frontmatter and write occurring
			const vaultTrue = new FakeVault({
				"composite.md": { content: compositeContent, mtime: INITIAL_MTIME },
			});
			const noteTrue = vaultTrue.note("composite.md");
			await alignNote(vaultTrue, noteTrue, ["due", "labels", "checklist-section"], settings, {
				keepMtime: true,
			});
			expect(vaultTrue.note("composite.md").mtime).toBe(INITIAL_MTIME);

			// keepMtime: false -> mtime increments
			const vaultFalse = new FakeVault({
				"composite.md": { content: compositeContent, mtime: INITIAL_MTIME },
			});
			const noteFalse = vaultFalse.note("composite.md");
			await alignNote(vaultFalse, noteFalse, ["due", "labels", "checklist-section"], settings, {
				keepMtime: false,
			});
			expect(vaultFalse.note("composite.md").mtime).toBeGreaterThan(INITIAL_MTIME);
		});

		test("batch timestamp stress: 24 notes processed in batch respect their respective keepMtime settings", async () => {
			const settings = createSettings({ syncDue: false });
			const files: Record<string, { content: string; mtime: number }> = {};

			for (let i = 0; i < 24; i++) {
				files[`task_${i}.md`] = {
					content: `---\ntrello_board_card_id: "b;c${i}"\ntrello_due: "2026-10-31"\n---\n\n`,
					mtime: 3000 + i,
				};
			}

			const vault = new FakeVault(files);

			// Half with keepMtime: true
			const batchKeep = Array.from({ length: 12 }, (_, i) => vault.note(`task_${i}.md`));
			await alignNotes(vault, batchKeep, ["due"], settings, { keepMtime: true });

			for (let i = 0; i < 12; i++) {
				expect(vault.note(`task_${i}.md`).mtime).toBe(3000 + i);
			}

			// Half with keepMtime: false
			const batchInc = Array.from({ length: 12 }, (_, i) => vault.note(`task_${i + 12}.md`));
			await alignNotes(vault, batchInc, ["due"], settings, { keepMtime: false });

			for (let i = 12; i < 24; i++) {
				expect(vault.note(`task_${i}.md`).mtime).toBe(3000 + i + 1);
			}
		});
	});

	// =========================================================================
	// 4. Cancellation Stress
	// =========================================================================
	describe("4. Cancellation Stress", () => {
		test("pre-aborted AbortSignal immediately aborts without processing or modifying any notes", async () => {
			const settings = createSettings({ syncDue: false });
			const controller = new AbortController();
			controller.abort(); // Pre-aborted

			const files: Record<string, { content: string }> = {};
			for (let i = 0; i < 10; i++) {
				files[`note_${i}.md`] = {
					content: `---\ntrello_board_card_id: "b;c${i}"\ntrello_due: "2026-10-31"\n---\n\n`,
				};
			}

			const vault = new FakeVault(files);
			const reporter = recordingReporter();
			const notes = vault.listNotes("");

			const writeFmSpy = vi.spyOn(vault, "writeFrontmatter");
			const result = await alignNotes(vault, notes, ["due"], settings, {
				signal: controller.signal,
				reporter,
			});

			// No notes scanned or modified
			expect(result.notesScanned).toBe(0);
			expect(result.notesModified).toBe(0);
			expect(writeFmSpy).toHaveBeenCalledTimes(0);

			// Reporter finished with aborted
			expect(reporter.logs.some((l) => l.level === "warn" && l.message.includes("cancelled"))).toBe(true);

			// All notes retain original frontmatter
			for (let i = 0; i < 10; i++) {
				expect(vault.readFrontmatter(vault.note(`note_${i}.md`))?.trello_due).toBe("2026-10-31");
			}
		});

		test("dynamic mid-batch cancellation: aborting after note 5 halts batch immediately leaving subsequent notes untouched", async () => {
			const settings = createSettings({ syncDue: false });
			const controller = new AbortController();
			const reporter = recordingReporter();

			const files: Record<string, { content: string }> = {};
			for (let i = 0; i < 15; i++) {
				files[`note_${String(i).padStart(2, "0")}.md`] = {
					content: `---\ntrello_board_card_id: "b;c${i}"\ntrello_due: "2026-10-31"\n---\n\n`,
				};
			}

			const vault = new FakeVault(files);
			const notes = vault.listNotes("");

			// Abort controller when note 5 is processed
			const origWriteFm = vault.writeFrontmatter.bind(vault);
			vi.spyOn(vault, "writeFrontmatter").mockImplementation(async (note, mutate, options) => {
				await origWriteFm(note, mutate, options);
				if (note.basename === "note_04") {
					// 5th note processed (index 4)
					controller.abort();
				}
			});

			const result = await alignNotes(vault, notes, ["due"], settings, {
				signal: controller.signal,
				reporter,
			});

			// Exactly 5 notes scanned and modified
			expect(result.notesScanned).toBe(5);
			expect(result.notesModified).toBe(5);

			// Notes 00 to 04 were modified
			for (let i = 0; i < 5; i++) {
				const path = `note_${String(i).padStart(2, "0")}.md`;
				expect(vault.readFrontmatter(vault.note(path))?.trello_due).toBeUndefined();
			}

			// Notes 05 to 14 were NEVER modified and retain their stale property
			for (let i = 5; i < 15; i++) {
				const path = `note_${String(i).padStart(2, "0")}.md`;
				expect(vault.readFrontmatter(vault.note(path))?.trello_due).toBe("2026-10-31");
			}

			expect(reporter.logs.some((l) => l.level === "warn" && l.message.includes("cancelled"))).toBe(true);
		});
	});
});
