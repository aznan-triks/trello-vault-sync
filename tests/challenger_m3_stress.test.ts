import { describe, expect, test, vi } from "vitest";
import { OperationGuard } from "../src/core/operationGuard";
import { decideSync } from "../src/core/syncDecision";
import { type SyncAction } from "../src/core/syncHistory";
import {
	type AlignCategory,
	type AlignSettings,
} from "../src/core/staleProperties";
import {
	alignNote,
	alignNotes,
} from "../src/features/alignNotes";
import { undoRun, undoRunForNote } from "../src/features/rollback";
import { wrapWithHistoryRecorder } from "../src/features/syncHistoryRecorder";
import { FakeVault } from "./fakes";

/**
 * Creates full AlignSettings fixture with customizable overrides.
 */
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

describe("Empirical Challenger M3: Synchronization & History Reversibility Invariants", () => {
	describe("1. History Reversibility & Byte-Identity Invariant", () => {
		test("multi-note batch alignment with diverse mutation types restores byte-identically on undoRun", async () => {
			const settings = createSettings({
				syncDue: false,
				syncLabels: false,
				syncMembers: false,
				syncChecklists: false,
				checklistHeading: "## Checklists",
				writeTrelloPluginNoteId: true,
				obsoleteLabelPropertyKeys: ["obsolete_priority"],
				keyMigrations: { old_tag: "new_tag" },
			});

			const initialFiles: Record<string, string> = {
				// Note 1: Frontmatter removal (due, labels, members)
				"notes/note1.md": [
					"---",
					'trello_board_card_id: "b1;c1"',
					'trello_due: "2026-10-31"',
					"trello_labels:",
					'  - "bug"',
					"trello_members:",
					'  - "alice"',
					"---",
					"",
					"Note 1 Body intact.",
				].join("\n"),

				// Note 2: Frontmatter add (missing plugin note id)
				"notes/note2.md": [
					"---",
					'trello_board_card_id: "b1;c2"',
					'title: "Note 2"',
					"---",
					"",
					"Note 2 Body content.",
				].join("\n"),

				// Note 3: Frontmatter migration & obsolete label removal
				"notes/note3.md": [
					"---",
					'trello_board_card_id: "b1;c3"',
					'old_tag: "v1"',
					'obsolete_priority: "High"',
					"---",
					"",
					"Note 3 Body content.",
				].join("\n"),

				// Note 4: Body checklist removal ONLY (clean frontmatter)
				"notes/note4.md": [
					"---",
					'trello_board_card_id: "b1;c4"',
					'trello_plugin_note_id: "existing_id_4"',
					"---",
					"",
					"Pre-checklist content.",
					"",
					"## Checklists",
					"### Tasks",
					"- [ ] Task A",
					"- [x] Task B",
					"",
					"Post-checklist content.",
				].join("\n"),

				// Note 5: COMBINED frontmatter removal + body checklist removal (2 writes on same note)
				"notes/note5.md": [
					"---",
					'trello_board_card_id: "b1;c5"',
					'trello_due: "2026-11-15"',
					"trello_labels:",
					'  - "critical"',
					"---",
					"",
					"Intro notes.",
					"",
					"## Checklists",
					"- [ ] Action item 1",
					"",
					"Footer notes.",
				].join("\n"),

				// Note 6: COMBINED migration + plugin ID + body checklist + CRLF line endings
				"notes/note6.md": [
					"---",
					'trello_board_card_id: "b1;c6"',
					'old_tag: "legacy_value"',
					"---",
					"",
					"CRLF intro.",
					"",
					"## Checklists",
					"- [ ] Windows task",
					"",
					"CRLF outro.",
				].join("\r\n"),

				// Note 7: Non-Trello cover (should remain untouched)
				"notes/note7.md": [
					"---",
					'trello_board_card_id: "b1;c7"',
					'banner: "assets/local-banner.png"',
					'trello_plugin_note_id: "existing_id_7"',
					"---",
					"",
					"Untouched note.",
				].join("\n"),

				// Note 8: Unlinked note with stale trello_due (gets cleaned up even without card ref)
				"notes/note8.md": [
					"---",
					'title: "Unlinked Note With Stale Due"',
					'trello_due: "2026-10-31"',
					"---",
					"",
					"Plain markdown note with stale due date.",
				].join("\n"),

				// Note 9: Completely clean unlinked note (untouched)
				"notes/note9.md": [
					"---",
					'title: "Clean Unlinked Note"',
					'author: "Alice"',
					"---",
					"",
					"Untouched plain note.",
				].join("\n"),
			};

			const fakeFiles: Record<string, { content: string; mtime: number }> = {};
			for (const [path, content] of Object.entries(initialFiles)) {
				fakeFiles[path] = { content, mtime: 1700000000000 };
			}

			const vault = new FakeVault(fakeFiles);
			const actions: SyncAction[] = [];
			const recordedVault = wrapWithHistoryRecorder(vault, (action) => actions.push(action));

			const categories: AlignCategory[] = [
				"due",
				"labels",
				"members",
				"missing-plugin-note-id",
				"obsolete-label-property",
				"key-migration",
				"checklist-section",
				"cover",
			];

			const notes = vault.listNotes("notes");
			const result = await alignNotes(recordedVault, notes, categories, settings, { keepMtime: true });

			// Verify alignment modified the expected notes
			expect(result.notesScanned).toBe(9);
			expect(result.notesModified).toBe(7); // notes 1, 2, 3, 4, 5, 6, 8 modified; notes 7, 9 unchanged
			expect(actions.length).toBeGreaterThanOrEqual(7);

			// Verify note 5 had both frontmatter and body modified
			const note5Content = vault.contentOf("notes/note5.md");
			expect(note5Content).not.toContain("trello_due");
			expect(note5Content).not.toContain("## Checklists");
			expect(note5Content).toContain("Intro notes.");
			expect(note5Content).toContain("Footer notes.");

			// Verify note 6 preserved CRLF in its aligned state
			const note6Content = vault.contentOf("notes/note6.md");
			expect(note6Content).toContain("\r\n");
			expect(note6Content).not.toContain("old_tag");
			expect(note6Content).toContain("new_tag");
			expect(note6Content).not.toContain("## Checklists");

			// EXECUTE UNDO RUN
			const undoResult = await undoRun(vault, {
				timestamp: new Date().toISOString(),
				scope: "notes",
				actions,
			});

			// Verify undo stats
			expect(undoResult.stats.reverted).toBeGreaterThan(0);
			expect(undoResult.stats.skipped).toBe(0);

			// CRITICAL INVARIANT: 100% BYTE-IDENTICAL RESTORATION FOR ALL FILES
			for (const [path, originalContent] of Object.entries(initialFiles)) {
				const currentContent = vault.contentOf(path);
				expect(currentContent).toBe(originalContent);
			}
		});

		test("selective undo via undoRunForNote restores single note byte-identically without altering peer notes", async () => {
			const settings = createSettings({ syncDue: false });
			const initial1 = '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-31"\n---\n\nBody 1';
			const initial2 = '---\ntrello_board_card_id: "b1;c2"\ntrello_due: "2026-10-31"\n---\n\nBody 2';
			const initial3 = '---\ntrello_board_card_id: "b1;c3"\ntrello_due: "2026-10-31"\n---\n\nBody 3';

			const vault = new FakeVault({
				"note1.md": { content: initial1 },
				"note2.md": { content: initial2 },
				"note3.md": { content: initial3 },
			});

			const actions: SyncAction[] = [];
			const recordedVault = wrapWithHistoryRecorder(vault, (action) => actions.push(action));

			await alignNotes(recordedVault, vault.listNotes(""), ["due"], settings);

			// All 3 notes aligned
			expect(vault.readFrontmatter(vault.note("note1.md"))?.trello_due).toBeUndefined();
			expect(vault.readFrontmatter(vault.note("note2.md"))?.trello_due).toBeUndefined();
			expect(vault.readFrontmatter(vault.note("note3.md"))?.trello_due).toBeUndefined();

			const run = {
				timestamp: new Date().toISOString(),
				scope: "",
				actions,
			};

			// Revert note2 ONLY
			const { stats } = await undoRunForNote(vault, run, "note2.md");
			expect(stats.reverted).toBe(1);

			// Note 2 is restored byte-identically
			expect(vault.contentOf("note2.md")).toBe(initial2);

			// Note 1 and Note 3 remain in their aligned state
			expect(vault.readFrontmatter(vault.note("note1.md"))?.trello_due).toBeUndefined();
			expect(vault.readFrontmatter(vault.note("note3.md"))?.trello_due).toBeUndefined();
		});

		test("50-note high-volume batch alignment under wrapWithHistoryRecorder is 100% reversible", async () => {
			const settings = createSettings({ syncDue: false, writeTrelloPluginNoteId: true });
			const files: Record<string, { content: string }> = {};
			const originalContents: Record<string, string> = {};

			for (let i = 1; i <= 50; i++) {
				const path = `bulk/note_${i}.md`;
				const content = [
					"---",
					`trello_board_card_id: "b1;card_${i}"`,
					`trello_due: "2026-10-${(i % 28) + 1}"`,
					`title: "Task ${i}"`,
					"---",
					"",
					`Body of note ${i}`,
				].join("\n");
				files[path] = { content };
				originalContents[path] = content;
			}

			const vault = new FakeVault(files);
			const actions: SyncAction[] = [];
			const recordedVault = wrapWithHistoryRecorder(vault, (action) => actions.push(action));

			const result = await alignNotes(
				recordedVault,
				vault.listNotes("bulk"),
				["due", "missing-plugin-note-id"],
				settings,
			);

			expect(result.notesScanned).toBe(50);
			expect(result.notesModified).toBe(50);
			expect(actions.length).toBe(50);

			// Verify undo restores all 50 files byte-identically
			const { stats } = await undoRun(vault, {
				timestamp: new Date().toISOString(),
				scope: "bulk",
				actions,
			});

			expect(stats.reverted).toBe(50);
			for (let i = 1; i <= 50; i++) {
				const path = `bulk/note_${i}.md`;
				expect(vault.contentOf(path)).toBe(originalContents[path]);
			}
		});
	});

	describe("2. Timestamp Preservation & Sync Decision Invariants", () => {
		test("keepMtime: true preserves mtime across frontmatter, body, and combined mutations", async () => {
			const settings = createSettings({
				syncDue: false,
				syncChecklists: false,
				checklistHeading: "## Checklists",
			});

			const initialMtime = 1680000000000;
			const vault = new FakeVault({
				"fm_only.md": {
					content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-31"\n---\n\nBody content',
					mtime: initialMtime,
				},
				"body_only.md": {
					content: '---\ntrello_board_card_id: "b1;c2"\n---\n\nBody content\n\n## Checklists\n- [ ] Task',
					mtime: initialMtime,
				},
				"combined.md": {
					content: '---\ntrello_board_card_id: "b1;c3"\ntrello_due: "2026-10-31"\n---\n\nBody content\n\n## Checklists\n- [ ] Task',
					mtime: initialMtime,
				},
			});

			const notes = vault.listNotes("");
			await alignNotes(vault, notes, ["due", "checklist-section"], settings, { keepMtime: true });

			expect(vault.note("fm_only.md").mtime).toBe(initialMtime);
			expect(vault.note("body_only.md").mtime).toBe(initialMtime);
			expect(vault.note("combined.md").mtime).toBe(initialMtime);
		});

		test("preserved mtime strictly avoids false 'local-newer' sync push in decideSync", () => {
			const initialMtime = 1700000000000;
			const localBody = "Identical task body";

			// Scenario A: Note mtime preserved. Remote Trello activity was 10 seconds before local note creation.
			const remoteActivityOlder = initialMtime - 10000;
			const decisionOlder = decideSync({
				localTitle: "Task",
				localBody,
				localMtime: initialMtime,
				localDue: null,
				remoteTitle: "Task",
				remoteBody: localBody,
				remoteMtime: remoteActivityOlder,
				remoteDue: null,
				policy: "newer-wins",
				marginMs: 0,
			});

			// Since content is identical, it skips
			expect(decisionOlder.direction).toBe("skip");
			expect(decisionOlder.reason).toBe("identical");

			// Scenario B: Remote card had a real update at (initialMtime + 2000). Remote MUST win via pull!
			const remoteActivityNewer = initialMtime + 2000;
			const decisionNewer = decideSync({
				localTitle: "Task",
				localBody,
				localMtime: initialMtime,
				localDue: null,
				remoteTitle: "Task",
				remoteBody: "Remote has new changes",
				remoteMtime: remoteActivityNewer,
				remoteDue: null,
				policy: "newer-wins",
				marginMs: 0,
			});

			expect(decisionNewer.direction).toBe("pull");
			expect(decisionNewer.reason).toBe("remote-newer");

			// Scenario C: Contrast when keepMtime is FALSE (phantom mtime bump to Date.now())
			const bumpedMtime = initialMtime + 50000; // Simulated timestamp bump
			const decisionWithBump = decideSync({
				localTitle: "Task",
				localBody: "Locally aligned body without keepMtime",
				localMtime: bumpedMtime,
				localDue: null,
				remoteTitle: "Task",
				remoteBody: "Remote card body",
				remoteMtime: remoteActivityNewer, // older than bumpedMtime
				remoteDue: null,
				policy: "newer-wins",
				marginMs: 0,
			});

			// If mtime had been bumped, it would falsely push local changes over remote!
			expect(decisionWithBump.direction).toBe("push");
			expect(decisionWithBump.reason).toBe("local-newer");
		});
	});

	describe("3. Concurrency Guarding & Lock Invariants", () => {
		test("serializes concurrent alignment runs on the same card via OperationGuard", async () => {
			const settings = createSettings({ syncDue: false });
			const guard = new OperationGuard();

			const vault = new FakeVault({
				"task.md": {
					content: '---\ntrello_board_card_id: "b1;shared_card_123"\ntrello_due: "2026-10-31"\n---\n\nBody',
				},
			});

			const executionOrder: string[] = [];
			const origWithKey = guard.withKey.bind(guard);
			vi.spyOn(guard, "withKey").mockImplementation(async (key, fn) => {
				executionOrder.push(`lock:${key}`);
				const result = await origWithKey(key, fn);
				executionOrder.push(`unlock:${key}`);
				return result;
			});

			const note = vault.note("task.md");
			await Promise.all([
				alignNote(vault, note, ["due"], settings, { guard } as any),
				alignNotes(vault, [note], ["due"], settings, { guard }),
			]);

			expect(executionOrder).toEqual([
				"lock:card:shared_card_123",
				"unlock:card:shared_card_123",
			]);
		});
	});

	describe("4. Dry-Run Invariants", () => {
		test("dryRun: true performs 0 file mutations, emits 0 sync actions, but accurately reports changes", async () => {
			const settings = createSettings({
				syncDue: false,
				syncChecklists: false,
				checklistHeading: "## Checklists",
			});

			const initialContent = [
				"---",
				'trello_board_card_id: "b1;c1"',
				'trello_due: "2026-10-31"',
				"---",
				"",
				"Body text",
				"",
				"## Checklists",
				"- [ ] Item",
			].join("\n");

			const vault = new FakeVault({
				"test.md": { content: initialContent, mtime: 12345 },
			});

			const actions: SyncAction[] = [];
			const recordedVault = wrapWithHistoryRecorder(vault, (action) => actions.push(action));

			const result = await alignNotes(
				recordedVault,
				vault.listNotes(""),
				["due", "checklist-section"],
				settings,
				{ dryRun: true },
			);

			// Verification of counts
			expect(result.notesScanned).toBe(1);
			expect(result.notesModified).toBe(1);
			expect(result.changesByCategory.due).toBe(1);
			expect(result.changesByCategory["checklist-section"]).toBe(1);

			// Verification of zero mutations
			expect(actions).toHaveLength(0);
			expect(vault.contentOf("test.md")).toBe(initialContent);
			expect(vault.note("test.md").mtime).toBe(12345);
		});
	});

	describe("5. Markdown Body Checklist Surgery Robustness", () => {
		test("does not treat frontmatter containing '## Checklists' as a checklist section", async () => {
			const settings = createSettings({
				syncChecklists: false,
				checklistHeading: "## Checklists",
			});

			const content = [
				"---",
				'trello_board_card_id: "b1;c1"',
				'description: "Heading: ## Checklists inside quotes"',
				"---",
				"",
				"Body text without any checklist heading.",
			].join("\n");

			const vault = new FakeVault({ "doc.md": { content } });
			const changes = await alignNote(vault, vault.note("doc.md"), ["checklist-section"], settings);

			expect(changes).toHaveLength(0);
			expect(vault.contentOf("doc.md")).toBe(content);
		});

		test("preserves multiple subsequent markdown sections after checklist removal", async () => {
			const settings = createSettings({
				syncChecklists: false,
				checklistHeading: "## Checklists",
			});

			const content = [
				"---",
				'trello_board_card_id: "b1;c1"',
				"---",
				"",
				"# Main Header",
				"Introductory remarks.",
				"",
				"## Checklists",
				"### Sprint 1",
				"- [x] Feature 1",
				"- [ ] Feature 2",
				"",
				"## Next Steps",
				"Details on next milestones.",
				"",
				"## References",
				"- https://example.com",
			].join("\n");

			const vault = new FakeVault({ "roadmap.md": { content } });
			await alignNote(vault, vault.note("roadmap.md"), ["checklist-section"], settings);

			const cleaned = vault.contentOf("roadmap.md");
			expect(cleaned).not.toContain("## Checklists");
			expect(cleaned).not.toContain("Feature 1");
			expect(cleaned).toContain("# Main Header");
			expect(cleaned).toContain("Introductory remarks.");
			expect(cleaned).toContain("## Next Steps");
			expect(cleaned).toContain("Details on next milestones.");
			expect(cleaned).toContain("## References");
			expect(cleaned).toContain("- https://example.com");
		});

		test("note consisting solely of a checklist section becomes empty and restores byte-identically on undo", async () => {
			const settings = createSettings({
				syncChecklists: false,
				checklistHeading: "## Checklists",
			});

			const initialContent = "## Checklists\n- [ ] Lone task\n- [x] Done task\n";
			const vault = new FakeVault({ "solo.md": { content: initialContent } });
			const actions: SyncAction[] = [];
			const recordedVault = wrapWithHistoryRecorder(vault, (action) => actions.push(action));

			await alignNote(recordedVault, vault.note("solo.md"), ["checklist-section"], settings);

			expect(vault.contentOf("solo.md")).toBe("");
			expect(actions).toHaveLength(1);

			// Revert
			await undoRun(vault, {
				timestamp: new Date().toISOString(),
				scope: "",
				actions,
			});

			expect(vault.contentOf("solo.md")).toBe(initialContent);
		});

		test("missing reporter executes cleanly without null reference errors", async () => {
			const settings = createSettings({ syncDue: false });
			const vault = new FakeVault({
				"note.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-31"\n---\n\n' },
			});

			// No reporter passed in options
			const result = await alignNotes(vault, vault.listNotes(""), ["due"], settings, {});
			expect(result.notesScanned).toBe(1);
			expect(result.notesModified).toBe(1);
			expect(vault.readFrontmatter(vault.note("note.md"))?.trello_due).toBeUndefined();
		});

		test("non-string or empty plugin note ID is correctly backfilled and restored on undo", async () => {
			const settings = createSettings({ writeTrelloPluginNoteId: true });
			const initialContent = '---\ntrello_board_card_id: "b1;c1"\ntrello_plugin_note_id: ""\n---\n\nBody';
			const vault = new FakeVault({ "blank_id.md": { content: initialContent } });
			const actions: SyncAction[] = [];
			const recordedVault = wrapWithHistoryRecorder(vault, (action) => actions.push(action));

			await alignNotes(recordedVault, vault.listNotes(""), ["missing-plugin-note-id"], settings);

			const newId = vault.readFrontmatter(vault.note("blank_id.md"))?.trello_plugin_note_id;
			expect(typeof newId).toBe("string");
			expect((newId as string).length).toBe(32);

			await undoRun(vault, {
				timestamp: new Date().toISOString(),
				scope: "",
				actions,
			});

			expect(vault.contentOf("blank_id.md")).toBe(initialContent);
		});
	});
});
