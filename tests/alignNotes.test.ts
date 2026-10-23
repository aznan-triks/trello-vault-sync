import { describe, expect, test, vi } from "vitest";
import { hasChecklistSection, removeChecklistSection } from "../src/core/noteBody";
import { OperationGuard } from "../src/core/operationGuard";
import {
	type AlignCategory,
	type AlignSettings,
} from "../src/core/staleProperties";
import { type SyncAction } from "../src/core/syncHistory";
import {
	alignNote,
	alignNotes,
	type AlignResult,
} from "../src/features/alignNotes";
import { undoRun } from "../src/features/rollback";
import { wrapWithHistoryRecorder } from "../src/features/syncHistoryRecorder";
import { FakeVault, recordingReporter } from "./fakes";

/**
 * Factory helper creating an AlignSettings object with safe defaults.
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

describe("noteBody: checklist section helpers", () => {
	test("hasChecklistSection: detects heading while ignoring frontmatter", () => {
		const withFm = `---
trello_board_card_id: "b1;c1"
description: "## Checklists in frontmatter should be ignored"
---

Intro prose

## Checklists
- [ ] Task 1`;
		expect(hasChecklistSection(withFm, "## Checklists")).toBe(true);

		const withoutHeading = `---
trello_board_card_id: "b1;c1"
---

Intro prose only`;
		expect(hasChecklistSection(withoutHeading, "## Checklists")).toBe(false);
		expect(hasChecklistSection("", "## Checklists")).toBe(false);
		expect(hasChecklistSection("No heading", "")).toBe(false);
	});

	test("removeChecklistSection: strips checklist and preserves prose and line endings", () => {
		const content = `---
trello_board_card_id: "b1;c1"
---

Introductory overview.

## Checklists
### Sublist
- [ ] Item A
- [x] Item B

Subsequent footer notes.`;

		const result = removeChecklistSection(content, "## Checklists");
		expect(result).not.toContain("## Checklists");
		expect(result).not.toContain("Sublist");
		expect(result).not.toContain("Item A");
		expect(result).toContain("Introductory overview.");
		expect(result).toContain("Subsequent footer notes.");
	});

	test("removeChecklistSection: handles CRLF line endings", () => {
		const crlf = "---\r\ntrello_board_card_id: \"b1;c1\"\r\n---\r\n\r\nIntro\r\n\r\n## Checklists\r\n- [ ] Task\r\n\r\nFooter";
		const cleaned = removeChecklistSection(crlf, "## Checklists");
		expect(cleaned).toContain("\r\n");
		expect(cleaned).not.toContain("## Checklists");
		expect(cleaned).toContain("Intro");
		expect(cleaned).toContain("Footer");
	});
});

describe("alignNote: isolated note alignment", () => {
	test("single frontmatter pass: removes multiple categories in one writeFrontmatter operation", async () => {
		const trelloCover = "https://trello-attachments.s3.amazonaws.com/abc/cover.jpg";
		const settings = createSettings({
			syncDue: false,
			syncLabels: false,
			syncMembers: false,
			syncCustomFields: false,
			syncCardCover: false,
		});

		const vault = new FakeVault({
			"task.md": {
				content: `---
trello_board_card_id: "b1;c1"
trello_due: "2026-12-31"
trello_labels:
  - "bug"
  - "urgent"
trello_members:
  - "alice"
trello_custom_fields:
  Priority: "High"
banner: "${trelloCover}"
author: "Trois"
rating: 5
---

Body content`,
			},
		});

		const note = vault.note("task.md");
		const writeSpy = vi.spyOn(vault, "writeFrontmatter");

		const categories: AlignCategory[] = ["due", "labels", "members", "custom-fields", "cover"];
		const changes = await alignNote(vault, note, categories, settings);

		// Verified: Exactly ONE writeFrontmatter call executed for all 5 categories
		expect(writeSpy).toHaveBeenCalledTimes(1);
		expect(changes).toHaveLength(5);

		const updated = vault.readFrontmatter(note);
		expect(updated?.trello_due).toBeUndefined();
		expect(updated?.trello_labels).toBeUndefined();
		expect(updated?.trello_members).toBeUndefined();
		expect(updated?.trello_custom_fields).toBeUndefined();
		expect(updated?.banner).toBeUndefined();

		// User frontmatter and card ref strictly preserved
		expect(updated?.author).toBe("Trois");
		expect(updated?.rating).toBe(5);
		expect(updated?.trello_board_card_id).toBe("b1;c1");
	});

	test("single frontmatter pass: executes key migration and missing-plugin-note-id in the same pass", async () => {
		const settings = createSettings({
			syncDue: false,
			writeTrelloPluginNoteId: true,
			keyMigrations: { old_priority: "prio_target" },
		});

		const vault = new FakeVault({
			"task.md": {
				content: `---
trello_board_card_id: "b1;c1"
trello_due: "2026-10-31"
old_priority: "High"
---

Body text`,
			},
		});

		const note = vault.note("task.md");
		const writeSpy = vi.spyOn(vault, "writeFrontmatter");

		const categories: AlignCategory[] = ["due", "missing-plugin-note-id", "key-migration"];
		const changes = await alignNote(vault, note, categories, settings);

		expect(writeSpy).toHaveBeenCalledTimes(1);
		expect(changes).toHaveLength(3);

		const updated = vault.readFrontmatter(note);
		expect(updated?.trello_due).toBeUndefined();
		expect(updated?.old_priority).toBeUndefined();
		expect(updated?.prio_target).toBe("High");
		expect(updated?.trello_plugin_note_id).toMatch(/^[0-9a-f]{32}$/i);
	});

	test("Grok #5: a migration whose target already holds a different value keeps both keys and says so in the report", async () => {
		const settings = createSettings({ keyMigrations: { old_priority: "prio_target" } });
		const content = `---\ntrello_board_card_id: "b1;c1"\nold_priority: "High"\nprio_target: "Low"\n---\n\nBody text`;
		const vault = new FakeVault({ "task.md": { content } });
		const reporter = recordingReporter();

		const result = await alignNotes(vault, [vault.note("task.md")], ["key-migration"], settings, { reporter });

		expect(result.notesModified).toBe(0);
		expect(vault.contentOf("task.md")).toBe(content);
		expect(reporter.logs.some((l) => l.level === "warn" && l.message.includes("old_priority") && l.message.includes("prio_target"))).toBe(true);
	});

	test("dryRun: true reports planned changes but verifies note content is completely unchanged", async () => {
		const initialContent = `---
trello_board_card_id: "b1;c1"
trello_due: "2026-12-31"
trello_labels:
  - "v1"
---

Body text here`;

		const settings = createSettings({
			syncDue: false,
			syncLabels: false,
		});

		const vault = new FakeVault({ "task.md": { content: initialContent } });
		const note = vault.note("task.md");
		const writeSpy = vi.spyOn(vault, "writeFrontmatter");
		const writeRawSpy = vi.spyOn(vault, "write");

		const changes = await alignNote(vault, note, ["due", "labels"], settings, { dryRun: true });

		// Reported planned changes accurately
		expect(changes).toHaveLength(2);
		expect(changes.map((c) => c.category).sort()).toEqual(["due", "labels"]);

		// Verified: Zero write operations on the vault
		expect(writeSpy).not.toHaveBeenCalled();
		expect(writeRawSpy).not.toHaveBeenCalled();

		// Content strictly byte-identical
		expect(vault.contentOf("task.md")).toBe(initialContent);
	});

	test("keepMtime: true preserves original note mtime, while keepMtime: false bumps mtime", async () => {
		const initialMtime = 1700000000000;
		const settings = createSettings({ syncDue: false });

		const vault = new FakeVault({
			"task_keep.md": {
				content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-31"\n---\n\nBody',
				mtime: initialMtime,
			},
			"task_bump.md": {
				content: '---\ntrello_board_card_id: "b1;c2"\ntrello_due: "2026-10-31"\n---\n\nBody',
				mtime: initialMtime,
			},
		});

		// 1. Alignment with keepMtime: true
		await alignNote(vault, vault.note("task_keep.md"), ["due"], settings, { keepMtime: true });
		const noteKeep = vault.note("task_keep.md");
		expect(noteKeep.mtime).toBe(initialMtime);

		// 2. Alignment with keepMtime: false (or default)
		await alignNote(vault, vault.note("task_bump.md"), ["due"], settings, { keepMtime: false });
		const noteBump = vault.note("task_bump.md");
		expect(noteBump.mtime).not.toBe(initialMtime);
		expect(noteBump.mtime).toBe(initialMtime + 1);
	});

	test("checklist-section: strips markdown body checklist section while preserving frontmatter and other body content", async () => {
		const settings = createSettings({
			syncChecklists: false,
			checklistHeading: "## Checklists",
		});

		const initialContent = `---
trello_board_card_id: "b1;c1"
author: "Alice"
---

Introductory overview of the task.

## Checklists
### Phase 1
- [ ] Task A
- [x] Task B

Important follow-up notes that must be preserved.`;

		const vault = new FakeVault({ "task.md": { content: initialContent } });
		const note = vault.note("task.md");

		const changes = await alignNote(vault, note, ["checklist-section"], settings);
		expect(changes).toHaveLength(1);
		expect(changes[0]?.category).toBe("checklist-section");

		const updatedContent = vault.contentOf("task.md");
		expect(updatedContent).not.toContain("## Checklists");
		expect(updatedContent).not.toContain("Task A");
		expect(updatedContent).not.toContain("Task B");
		expect(updatedContent).toContain("Introductory overview of the task.");
		expect(updatedContent).toContain("Important follow-up notes that must be preserved.");

		const updatedFm = vault.readFrontmatter(note);
		expect(updatedFm?.author).toBe("Alice");
		expect(updatedFm?.trello_board_card_id).toBe("b1;c1");
	});

	test("combined frontmatter and body alignment: updates frontmatter and strips checklist section cleanly", async () => {
		const settings = createSettings({
			syncDue: false,
			syncChecklists: false,
			checklistHeading: "## Checklists",
		});

		const initialContent = `---
trello_board_card_id: "b1;c1"
trello_due: "2026-10-31"
---

Overview text.

## Checklists
- [ ] Check item 1

Conclusion.`;

		const vault = new FakeVault({ "task.md": { content: initialContent } });
		const note = vault.note("task.md");

		const changes = await alignNote(vault, note, ["due", "checklist-section"], settings);
		expect(changes).toHaveLength(2);

		const updatedFm = vault.readFrontmatter(note);
		expect(updatedFm?.trello_due).toBeUndefined();
		expect(updatedFm?.trello_board_card_id).toBe("b1;c1");

		const updatedContent = vault.contentOf("task.md");
		expect(updatedContent).not.toContain("## Checklists");
		expect(updatedContent).not.toContain("Check item 1");
		expect(updatedContent).toContain("Overview text.");
		expect(updatedContent).toContain("Conclusion.");
	});

	test("selective categories: only cleans categories explicitly passed in parameter", async () => {
		const settings = createSettings({
			syncDue: false,
			syncLabels: false,
			syncMembers: false,
		});

		const vault = new FakeVault({
			"task.md": {
				content: `---
trello_board_card_id: "b1;c1"
trello_due: "2026-10-31"
trello_labels:
  - "bug"
  - "urgent"
trello_members:
  - "alice"
---

Body`,
			},
		});

		const note = vault.note("task.md");
		// Pass only "due"
		const changes = await alignNote(vault, note, ["due"], settings);
		expect(changes).toHaveLength(1);
		expect(changes[0]?.category).toBe("due");

		const updated = vault.readFrontmatter(note);
		expect(updated?.trello_due).toBeUndefined();
		expect(updated?.trello_labels).toEqual(["bug", "urgent"]);
		expect(updated?.trello_members).toEqual(["alice"]);
	});

	test("clean note: returns empty changes array and performs zero writes when note has no stale data", async () => {
		const settings = createSettings({ syncDue: false });
		const initialContent = '---\ntrello_board_card_id: "b1;c1"\nauthor: "Bob"\n---\n\nBody content';
		const vault = new FakeVault({ "clean.md": { content: initialContent } });
		const note = vault.note("clean.md");
		const writeSpy = vi.spyOn(vault, "writeFrontmatter");

		const changes = await alignNote(vault, note, ["due"], settings);
		expect(changes).toEqual([]);
		expect(writeSpy).not.toHaveBeenCalled();
		expect(vault.contentOf("clean.md")).toBe(initialContent);
	});

	test("corner case: empty note (0 bytes) returns empty changes array without throwing", async () => {
		const settings = createSettings({ syncDue: false });
		const vault = new FakeVault({ "empty.md": { content: "" } });
		const note = vault.note("empty.md");

		const changes = await alignNote(vault, note, ["due", "labels"], settings);
		expect(changes).toEqual([]);
		expect(vault.contentOf("empty.md")).toBe("");
	});

	test("corner case: unlinked note never receives missing-plugin-note-id", async () => {
		const settings = createSettings({ writeTrelloPluginNoteId: true });
		const vault = new FakeVault({ "unlinked.md": { content: '---\nauthor: "Charlie"\n---\n\nBody' } });
		const note = vault.note("unlinked.md");

		const changes = await alignNote(vault, note, ["missing-plugin-note-id"], settings);
		expect(changes).toEqual([]);
		expect(vault.readFrontmatter(note)?.trello_plugin_note_id).toBeUndefined();
	});

	test("corner case: non-Trello cover URL is preserved untouched", async () => {
		const externalCover = "https://images.unsplash.com/photo-123456";
		const settings = createSettings({ syncCardCover: false, coverFrontmatterKey: "banner" });
		const vault = new FakeVault({
			"cover.md": { content: `---\ntrello_board_card_id: "b1;c1"\nbanner: "${externalCover}"\n---\n\nBody` },
		});
		const note = vault.note("cover.md");

		const changes = await alignNote(vault, note, ["cover"], settings);
		expect(changes).toEqual([]);
		expect(vault.readFrontmatter(note)?.banner).toBe(externalCover);
	});

	test("corner case: CRLF line endings preserved during frontmatter mutations", async () => {
		const settings = createSettings({ syncDue: false });
		const initialContent =
			'---\r\ntrello_board_card_id: "b1;c1"\r\ntrello_due: "2026-10-31"\r\nauthor: "Dave"\r\n---\r\n\r\nLine 1\r\nLine 2';
		const vault = new FakeVault({ "crlf.md": { content: initialContent } });
		const note = vault.note("crlf.md");

		await alignNote(vault, note, ["due"], settings);

		const updated = vault.contentOf("crlf.md");
		expect(updated).not.toContain("trello_due");
		expect(updated).toContain("author: \"Dave\"");
		expect(updated).toContain("Line 1\r\nLine 2");
	});
});

describe("alignNotes: batch execution & lifecycle", () => {
	test("batch execution: scans multiple notes, counts modified notes correctly, accumulates changesByCategory", async () => {
		const settings = createSettings({
			syncDue: false,
			syncMembers: false,
			writeTrelloPluginNoteId: true,
		});

		const vault = new FakeVault({
			"FolderA/note1.md": {
				content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-31"\n---\n\n',
			},
			"FolderA/note2.md": {
				content:
					'---\ntrello_board_card_id: "b1;c2"\ntrello_plugin_note_id: "0123456789abcdef0123456789abcdef"\n---\n\n',
			},
			"FolderB/Sub/note3.md": {
				content: '---\ntrello_board_card_id: "b1;c3"\ntrello_members:\n  - "alice"\n---\n\n',
			},
			"unlinked.md": {
				content: '---\nauthor: "Zack"\n---\n\n',
			},
		});

		const notes = vault.listNotes("");
		const categories: AlignCategory[] = ["due", "members", "missing-plugin-note-id"];

		const result: AlignResult = await alignNotes(vault, notes, categories, settings);

		expect(result.notesScanned).toBe(4);
		// note1 modified (due removed, plugin id added), note3 modified (members removed, plugin id added)
		expect(result.notesModified).toBe(2);
		expect(result.changesByCategory.due).toBe(1);
		expect(result.changesByCategory.members).toBe(1);
		expect(result.changesByCategory["missing-plugin-note-id"]).toBe(2);
		expect(result.changesByCategory.labels).toBe(0);
		expect(result.changesByCategory["checklist-section"]).toBe(0);
	});

	test("batch dryRun: true calculates planned changes without modifying any files", async () => {
		const initialNote1 = '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-31"\n---\n\nBody 1';
		const initialNote2 = '---\ntrello_board_card_id: "b1;c2"\ntrello_labels:\n  - "bug"\n---\n\nBody 2';

		const settings = createSettings({ syncDue: false, syncLabels: false });
		const vault = new FakeVault({
			"note1.md": { content: initialNote1 },
			"note2.md": { content: initialNote2 },
		});

		const notes = vault.listNotes("");
		const result = await alignNotes(vault, notes, ["due", "labels"], settings, { dryRun: true });

		expect(result.notesScanned).toBe(2);
		expect(result.notesModified).toBe(2);
		expect(result.changesByCategory.due).toBe(1);
		expect(result.changesByCategory.labels).toBe(1);

		// Zero files modified
		expect(vault.contentOf("note1.md")).toBe(initialNote1);
		expect(vault.contentOf("note2.md")).toBe(initialNote2);
	});

	test("concurrency serialization: verifies guard.withKey('card:<id>') is acquired for each card during alignment", async () => {
		const settings = createSettings({ syncDue: false });
		const guard = new OperationGuard();
		const withKeySpy = vi.spyOn(guard, "withKey");

		const vault = new FakeVault({
			"cardA.md": {
				content: '---\ntrello_board_card_id: "board1;cardAAA"\ntrello_due: "2026-10-31"\n---\n\n',
			},
			"cardB.md": {
				content: '---\ntrello_board_card_id: "board1;cardBBB"\ntrello_due: "2026-10-31"\n---\n\n',
			},
			"unlinked.md": {
				content: '---\nauthor: "Plain"\n---\n\n',
			},
		});

		const notes = vault.listNotes("");
		await alignNotes(vault, notes, ["due"], settings, { guard });

		expect(withKeySpy).toHaveBeenCalledWith("card:cardAAA", expect.any(Function));
		expect(withKeySpy).toHaveBeenCalledWith("card:cardBBB", expect.any(Function));
	});

	test("cancellation via AbortSignal: stops processing subsequent notes when aborted", async () => {
		const settings = createSettings({ syncDue: false });
		const controller = new AbortController();

		const vault = new FakeVault({
			"note1.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-31"\n---\n\n' },
			"note2.md": { content: '---\ntrello_board_card_id: "b1;c2"\ntrello_due: "2026-10-31"\n---\n\n' },
			"note3.md": { content: '---\ntrello_board_card_id: "b1;c3"\ntrello_due: "2026-10-31"\n---\n\n' },
		});

		// Abort immediately before running
		controller.abort();

		const notes = vault.listNotes("");
		const result = await alignNotes(vault, notes, ["due"], settings, { signal: controller.signal });

		// Did not modify notes after cancellation
		expect(result.notesModified).toBe(0);
		expect(vault.readFrontmatter(vault.note("note1.md"))?.trello_due).toBe("2026-10-31");
		expect(vault.readFrontmatter(vault.note("note2.md"))?.trello_due).toBe("2026-10-31");
		expect(vault.readFrontmatter(vault.note("note3.md"))?.trello_due).toBe("2026-10-31");
	});

	test("history rollback: running under wrapWithHistoryRecorder allows full undo restoration via undoRun", async () => {
		const settings = createSettings({ syncDue: false, syncLabels: false });

		const initial1 = '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-31"\n---\n\nBody 1';
		const initial2 = '---\ntrello_board_card_id: "b1;c2"\ntrello_labels:\n  - "bug"\n---\n\nBody 2';

		const vault = new FakeVault({
			"note1.md": { content: initial1 },
			"note2.md": { content: initial2 },
		});

		const actions: SyncAction[] = [];
		const recordedVault = wrapWithHistoryRecorder(vault, (action) => actions.push(action));

		const notes = vault.listNotes("");
		const result = await alignNotes(recordedVault, notes, ["due", "labels"], settings);

		expect(result.notesModified).toBe(2);
		expect(actions.length).toBeGreaterThan(0);
		expect(vault.readFrontmatter(vault.note("note1.md"))?.trello_due).toBeUndefined();
		expect(vault.readFrontmatter(vault.note("note2.md"))?.trello_labels).toBeUndefined();

		// Revert using rollback engine
		const { stats } = await undoRun(vault, {
			timestamp: new Date().toISOString(),
			scope: "",
			actions,
		});

		expect(stats.reverted).toBe(2);
		expect(vault.contentOf("note1.md")).toBe(initial1);
		expect(vault.contentOf("note2.md")).toBe(initial2);
	});

	test("progress reporting: calls reporter setTotal, step, and finish with proper log output", async () => {
		const settings = createSettings({ syncDue: false });
		const reporter = recordingReporter();
		const setTotalSpy = vi.spyOn(reporter, "setTotal");
		const stepSpy = vi.spyOn(reporter, "step");
		const finishSpy = vi.spyOn(reporter, "finish");

		const vault = new FakeVault({
			"task1.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-31"\n---\n\n' },
			"task2.md": { content: '---\ntrello_board_card_id: "b1;c2"\ntrello_due: "2026-10-31"\n---\n\n' },
		});

		const notes = vault.listNotes("");
		await alignNotes(vault, notes, ["due"], settings, { reporter });

		expect(setTotalSpy).toHaveBeenCalledWith(2);
		expect(stepSpy).toHaveBeenCalledTimes(2);
		expect(finishSpy).toHaveBeenCalledTimes(1);
		expect(reporter.logs.length).toBeGreaterThan(0);
	});

	test("error resilience: continues processing batch even if a single note fails to write", async () => {
		const settings = createSettings({ syncDue: false });
		const reporter = recordingReporter();

		const vault = new FakeVault({
			"note1.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-31"\n---\n\n' },
			"note2_bad.md": { content: '---\ntrello_board_card_id: "b1;c2"\ntrello_due: "2026-10-31"\n---\n\n' },
			"note3.md": { content: '---\ntrello_board_card_id: "b1;c3"\ntrello_due: "2026-10-31"\n---\n\n' },
		});

		const origWriteFm = vault.writeFrontmatter.bind(vault);
		vi.spyOn(vault, "writeFrontmatter").mockImplementation(async (note, mutate, options) => {
			if (note.path === "note2_bad.md") {
				throw new Error("Disk I/O error on bad note");
			}
			return origWriteFm(note, mutate, options);
		});

		const notes = vault.listNotes("");
		const result = await alignNotes(vault, notes, ["due"], settings, { reporter });

		// note1 and note3 modified successfully despite note2 failing
		expect(result.notesScanned).toBe(3);
		expect(result.notesModified).toBe(2);
		expect(vault.readFrontmatter(vault.note("note1.md"))?.trello_due).toBeUndefined();
		expect(vault.readFrontmatter(vault.note("note3.md"))?.trello_due).toBeUndefined();

		// Error was captured in logs without halting execution
		expect(reporter.logs.some((l) => l.level === "error" && l.message.includes("Disk I/O error"))).toBe(true);
	});

	test("deleted note in flight: skips note safely if note was removed from vault before lock acquisition", async () => {
		const settings = createSettings({ syncDue: false });
		const vault = new FakeVault({
			"deleted_soon.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-31"\n---\n\n' },
		});

		const noteHandle = vault.note("deleted_soon.md");
		// Delete note from vault before alignNotes executes
		await vault.trash(noteHandle);

		const result = await alignNotes(vault, [noteHandle], ["due"], settings);
		expect(result.notesScanned).toBe(1);
		expect(result.notesModified).toBe(0);
	});
});
