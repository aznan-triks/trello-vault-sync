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
	executeAlignNotes,
} from "../src/commands/alignCommand";
import type { CommandContext } from "../src/commands/context";
import {
	DEFAULT_ATTACHMENTS_KEY,
	DEFAULT_COVER_KEY,
	DEFAULT_LINKED_CARDS_KEY,
} from "../src/core/attachmentRef";
import {
	DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY,
} from "../src/core/cardRef";
import { DEFAULT_CHECKLIST_HEADING } from "../src/core/checklistRef";
import { DEFAULT_CUSTOM_FIELDS_KEY } from "../src/core/customFieldRef";
import { DEFAULT_DUE_KEY } from "../src/core/dueRef";
import { DEFAULT_LABELS_KEY } from "../src/core/labelRef";
import { DEFAULT_MEMBERS_KEY } from "../src/core/memberRef";
import { splitFrontmatter } from "../src/core/noteBody";
import { OperationGuard } from "../src/core/operationGuard";
import {
	type AlignCategory,
	type AlignSettings,
} from "../src/core/staleProperties";
import { type SyncAction } from "../src/core/syncHistory";
import {
	alignNote,
	alignNotes,
} from "../src/features/alignNotes";
import { undoRun } from "../src/features/rollback";
import { wrapWithHistoryRecorder } from "../src/features/syncHistoryRecorder";
import { syncNoteWithCard, type NoteSyncOptions } from "../src/features/syncNote";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { TrelloClient } from "../src/trello/client";
import { FakeVault, at, card, recordingReporter, routedTransport } from "./fakes";

function createAlignSettings(overrides: Partial<AlignSettings> = {}): AlignSettings {
	return {
		syncDue: true,
		dueFrontmatterKey: DEFAULT_DUE_KEY,
		syncLabels: true,
		labelsFrontmatterKey: DEFAULT_LABELS_KEY,
		syncMembers: true,
		membersFrontmatterKey: DEFAULT_MEMBERS_KEY,
		syncCustomFields: true,
		customFieldsFrontmatterKey: DEFAULT_CUSTOM_FIELDS_KEY,
		syncAttachments: true,
		attachmentsFrontmatterKey: DEFAULT_ATTACHMENTS_KEY,
		syncLinkedCards: true,
		linkedCardsFrontmatterKey: DEFAULT_LINKED_CARDS_KEY,
		syncCardCover: true,
		coverFrontmatterKey: DEFAULT_COVER_KEY,
		writeTrelloPluginNoteId: true,
		syncChecklists: true,
		checklistHeading: DEFAULT_CHECKLIST_HEADING,
		labelPropertySync: true,
		labelPropertyMappings: [],
		obsoleteLabelPropertyKeys: [],
		keyMigrations: {},
		...overrides,
	};
}

function createSyncOptions(overrides: Partial<NoteSyncOptions> = {}): NoteSyncOptions {
	return {
		policy: "newer-wins",
		marginMs: 0,
		syncTitle: true,
		syncDescription: true,
		syncDue: true,
		syncLabels: true,
		syncAttachments: false,
		syncChecklists: false,
		syncMembers: false,
		syncCustomFields: false,
		syncCardCover: false,
		dryRun: false,
		cleanUpDuringSync: true,
		dueFrontmatterKey: DEFAULT_DUE_KEY,
		labelsFrontmatterKey: DEFAULT_LABELS_KEY,
		membersFrontmatterKey: DEFAULT_MEMBERS_KEY,
		customFieldsFrontmatterKey: DEFAULT_CUSTOM_FIELDS_KEY,
		attachmentsFrontmatterKey: DEFAULT_ATTACHMENTS_KEY,
		linkedCardsFrontmatterKey: DEFAULT_LINKED_CARDS_KEY,
		coverFrontmatterKey: DEFAULT_COVER_KEY,
		checklistHeading: DEFAULT_CHECKLIST_HEADING,
		...overrides,
	};
}

function buildFakeCommandContext(vault: FakeVault, overrides: Partial<CommandContext> = {}): CommandContext {
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

describe("Tier 5 Hardening — Concurrency & OperationGuard Serialization", () => {
	beforeEach(() => {
		noticeMessages.length = 0;
	});

	test("simultaneous manual batch cleanup and in-stream sync on the same card serializes safely without race conditions", async () => {
		const guard = new OperationGuard();
		const initialMtime = at("2026-02-01T10:00:00Z");

		const vault = new FakeVault({
			"Note1.md": {
				content: [
					"---",
					'trello_board_card_id: "board1;cardShared"',
					`${DEFAULT_DUE_KEY}: "2026-12-31"`,
					`${DEFAULT_LABELS_KEY}:`,
					'  - "stale-label"',
					"---",
					"",
					"Note content body",
				].join("\n"),
				mtime: initialMtime,
			},
		});

		const { transport } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const remoteCard = card({
			id: "cardShared",
			name: "Note1",
			desc: "Note content body",
			dateLastActivity: "2026-02-01T10:00:00Z",
		});

		// Manual batch cleanup is configured to prune due dates
		const batchSettings = createAlignSettings({ syncDue: false });
		// In-stream sync is configured with cleanUpDuringSync to prune labels (syncLabels = false)
		const syncOptions = createSyncOptions({
			syncLabels: false,
			cleanUpDuringSync: true,
		});

		// Concurrency tracker: ensures peak active operations on cardShared is strictly <= 1
		let activeCardSharedOperations = 0;
		let maxConcurrency = 0;

		const originalWriteFm = vault.writeFrontmatter.bind(vault);
		vi.spyOn(vault, "writeFrontmatter").mockImplementation(async (note, mutate, options) => {
			activeCardSharedOperations++;
			maxConcurrency = Math.max(maxConcurrency, activeCardSharedOperations);
			// Artificial latency to increase collision window
			await new Promise((resolve) => setTimeout(resolve, 15));
			try {
				return await originalWriteFm(note, mutate, options);
			} finally {
				activeCardSharedOperations--;
			}
		});

		const noteHandle = vault.note("Note1.md");

		// Run both concurrently under the shared OperationGuard with keepMtime: true
		const batchPromise = alignNotes(vault, [noteHandle], ["due"], batchSettings, { guard, keepMtime: true });
		const syncPromise = guard.withKey("card:cardShared", () =>
			syncNoteWithCard(vault, client, noteHandle, remoteCard, syncOptions),
		);

		const [batchResult, syncResult] = await Promise.all([batchPromise, syncPromise]);

		// Concurrency gate verification: operations never overlapped execution on the guarded card
		expect(maxConcurrency).toBe(1);

		// Batch cleanup completed
		expect(batchResult.notesScanned).toBe(1);
		expect(batchResult.notesModified).toBe(1);
		expect(batchResult.changesByCategory.due).toBe(1);

		// In-stream sync completed
		expect(syncResult.direction).toBe("skip");

		// Final frontmatter state: BOTH due date and labels were pruned cleanly without clobbering each other
		const fm = vault.readFrontmatter(noteHandle);
		expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();
		expect(fm?.[DEFAULT_LABELS_KEY]).toBeUndefined();
		expect(fm?.trello_board_card_id).toBe("board1;cardShared");

		// Integrity: frontmatter and body format is intact
		const { frontmatter, body } = splitFrontmatter(vault.contentOf("Note1.md"));
		expect(frontmatter).not.toBeNull();
		expect(body).toContain("Note content body");

		// Timestamp preservation: mtime remains intact
		expect(vault.note("Note1.md").mtime).toBe(initialMtime);
	});

	test("multi-card overlapping concurrency: batch alignment interleaves safely with multiple individual syncs", async () => {
		const guard = new OperationGuard();
		const files: Record<string, { content: string; mtime: number }> = {};
		for (let i = 1; i <= 6; i++) {
			files[`Task${i}.md`] = {
				content: [
					"---",
					`trello_board_card_id: "b1;card${i}"`,
					`${DEFAULT_DUE_KEY}: "2026-12-31"`,
					"---",
					"",
					`Body ${i}`,
				].join("\n"),
				mtime: at("2026-01-01"),
			};
		}
		const vault = new FakeVault(files);

		const { transport } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const notes = vault.listNotes("");
		const batchSettings = createAlignSettings({ syncDue: false });

		// Spawn concurrent syncs on card2 and card5
		const syncCard2 = guard.withKey("card:card2", async () => {
			await new Promise((r) => setTimeout(r, 10));
			return syncNoteWithCard(
				vault,
				client,
				vault.note("Task2.md"),
				card({ id: "card2", name: "Task2", desc: "Body 2", dateLastActivity: "2026-01-01" }),
				createSyncOptions({ syncDue: false, cleanUpDuringSync: true }),
			);
		});

		const syncCard5 = guard.withKey("card:card5", async () => {
			await new Promise((r) => setTimeout(r, 10));
			return syncNoteWithCard(
				vault,
				client,
				vault.note("Task5.md"),
				card({ id: "card5", name: "Task5", desc: "Body 5", dateLastActivity: "2026-01-01" }),
				createSyncOptions({ syncDue: false, cleanUpDuringSync: true }),
			);
		});

		const batchRun = alignNotes(vault, notes, ["due"], batchSettings, { guard, keepMtime: true });

		const [batchRes, s2Res, s5Res] = await Promise.all([batchRun, syncCard2, syncCard5]);

		expect(batchRes.notesScanned).toBe(6);
		expect(s2Res.direction).toBe("skip");
		expect(s5Res.direction).toBe("skip");

		// All 6 notes have due property pruned
		for (let i = 1; i <= 6; i++) {
			const fm = vault.readFrontmatter(vault.note(`Task${i}.md`));
			expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();
			expect(vault.contentOf(`Task${i}.md`)).toContain(`Body ${i}`);
		}
	});

	test("failure in preceding queued operation does not stall subsequent queued alignment", async () => {
		const guard = new OperationGuard();
		const vault = new FakeVault({
			"Resilient.md": {
				content: `---\ntrello_board_card_id: "b1;cFail"\n${DEFAULT_DUE_KEY}: "2026-12-31"\n---\n\nResilient content`,
			},
		});

		// Preceding operation fails
		const failingOp = guard.withKey("card:cFail", async () => {
			throw new Error("Simulated upstream network breakdown");
		});

		// Subsequent batch alignment queued on the same card key
		const alignOp = alignNotes(
			vault,
			[vault.note("Resilient.md")],
			["due"],
			createAlignSettings({ syncDue: false }),
			{ guard, keepMtime: true },
		);

		await expect(failingOp).rejects.toThrow("Simulated upstream network breakdown");

		// alignNotes MUST execute successfully despite the earlier failure
		const result = await alignOp;
		expect(result.notesModified).toBe(1);
		expect(vault.readFrontmatter(vault.note("Resilient.md"))?.[DEFAULT_DUE_KEY]).toBeUndefined();
	});

	test("failure in batch alignment does not stall subsequent queued sync operation", async () => {
		const guard = new OperationGuard();
		const timestamp = at("2026-08-01T00:00:00.000Z");
		const vault = new FakeVault({
			"DiskFail.md": {
				content: `---\ntrello_board_card_id: "b1;cDisk"\n${DEFAULT_DUE_KEY}: "2026-12-31"\n---\n\nBody`,
				mtime: timestamp,
			},
		});

		const origWriteFm = vault.writeFrontmatter.bind(vault);
		let failedOnce = false;
		vi.spyOn(vault, "writeFrontmatter").mockImplementation(async (note, mutate, options) => {
			if (!failedOnce) {
				failedOnce = true;
				throw new Error("Simulated disk error during align");
			}
			return origWriteFm(note, mutate, options);
		});

		const { transport } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		// Batch alignment fails on this note
		const alignOp = alignNotes(
			vault,
			[vault.note("DiskFail.md")],
			["due"],
			createAlignSettings({ syncDue: false }),
			{ guard, keepMtime: true },
		);

		// Subsequent sync queued on same card key
		const syncOp = guard.withKey("card:cDisk", () =>
			syncNoteWithCard(
				vault,
				client,
				vault.note("DiskFail.md"),
				card({ id: "cDisk", name: "DiskFail", desc: "Body", dateLastActivity: "2026-08-01T00:00:00.000Z" }),
				createSyncOptions({ syncDue: false, cleanUpDuringSync: false }),
			),
		);

		const alignRes = await alignOp;
		// Error was captured gracefully by alignNotes without throwing unhandled rejection
		expect(alignRes.notesModified).toBe(0);

		// The queued sync operation executes successfully
		const syncRes = await syncOp;
		expect(syncRes.direction).toBe("skip");
	});

	test("unlinked notes in batch run safely without invalid card locks", async () => {
		const guard = new OperationGuard();
		const withKeySpy = vi.spyOn(guard, "withKey");

		const vault = new FakeVault({
			"Linked.md": {
				content: `---\ntrello_board_card_id: "b1;cValid"\n${DEFAULT_DUE_KEY}: "2026-12-31"\n---\n\n`,
			},
			"Unlinked1.md": {
				content: `---\nauthor: "Me"\n${DEFAULT_DUE_KEY}: "2026-12-31"\n---\n\n`,
			},
			"Unlinked2.md": {
				content: `---\n${DEFAULT_DUE_KEY}: "2026-12-31"\n---\n\n`,
			},
		});

		const notes = vault.listNotes("");
		const result = await alignNotes(
			vault,
			notes,
			["due"],
			createAlignSettings({ syncDue: false }),
			{ guard, keepMtime: true },
		);

		expect(result.notesScanned).toBe(3);
		expect(result.notesModified).toBe(3);

		// Only the linked note acquires a lock
		expect(withKeySpy).toHaveBeenCalledTimes(1);
		expect(withKeySpy).toHaveBeenCalledWith("card:cValid", expect.any(Function));
		expect(withKeySpy).not.toHaveBeenCalledWith("card:null", expect.any(Function));
		expect(withKeySpy).not.toHaveBeenCalledWith("card:undefined", expect.any(Function));
	});

	test("high burst concurrency: 20 simultaneous operations queued across batch alignment and sync on the same card", async () => {
		const guard = new OperationGuard();
		const initialMtime = at("2026-03-01T00:00:00Z");
		const vault = new FakeVault({
			"Burst.md": {
				content: `---\ntrello_board_card_id: "b1;cBurst"\n${DEFAULT_DUE_KEY}: "2026-12-31"\n---\n\nBurst test`,
				mtime: initialMtime,
			},
		});

		const { transport } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const remote = card({ id: "cBurst", name: "Burst", desc: "Burst test", dateLastActivity: "2026-03-01T00:00:00Z" });

		const executions: string[] = [];

		const tasks: Promise<unknown>[] = [];
		for (let i = 0; i < 20; i++) {
			if (i % 2 === 0) {
				tasks.push(
					alignNotes(
						vault,
						[vault.note("Burst.md")],
						["due"],
						createAlignSettings({ syncDue: false }),
						{ guard, keepMtime: true },
					).then(() => executions.push(`align-${i}`)),
				);
			} else {
				tasks.push(
					guard.withKey("card:cBurst", async () => {
						await syncNoteWithCard(
							vault,
							client,
							vault.note("Burst.md"),
							remote,
							createSyncOptions({ syncDue: false, cleanUpDuringSync: true }),
						);
						executions.push(`sync-${i}`);
					}),
				);
			}
		}

		await Promise.all(tasks);

		expect(executions).toHaveLength(20);
		// Note remains intact
		const fm = vault.readFrontmatter(vault.note("Burst.md"));
		expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();
		expect(fm?.trello_board_card_id).toBe("b1;cBurst");
		expect(vault.note("Burst.md").mtime).toBe(initialMtime);
	});
});

describe("Tier 5 Hardening — AbortSignal Mid-Operation Resilience", () => {
	beforeEach(() => {
		noticeMessages.length = 0;
	});

	test("pre-aborted AbortSignal immediately cancels batch alignment before any notes are touched", async () => {
		const controller = new AbortController();
		controller.abort();

		const reporter = recordingReporter();
		const finishSpy = vi.spyOn(reporter, "finish");

		const vault = new FakeVault({
			"NoteA.md": { content: `---\ntrello_board_card_id: "b;cA"\n${DEFAULT_DUE_KEY}: "2026-12-31"\n---\n\n` },
			"NoteB.md": { content: `---\ntrello_board_card_id: "b;cB"\n${DEFAULT_DUE_KEY}: "2026-12-31"\n---\n\n` },
		});

		const writeSpy = vi.spyOn(vault, "writeFrontmatter");

		const result = await alignNotes(
			vault,
			vault.listNotes(""),
			["due"],
			createAlignSettings({ syncDue: false }),
			{ signal: controller.signal, reporter, keepMtime: true },
		);

		expect(result.notesScanned).toBe(0);
		expect(result.notesModified).toBe(0);
		expect(writeSpy).not.toHaveBeenCalled();
		expect(finishSpy).toHaveBeenCalledWith("aborted", "Batch alignment cancelled.");
		expect(vault.readFrontmatter(vault.note("NoteA.md"))?.[DEFAULT_DUE_KEY]).toBe("2026-12-31");
		expect(vault.readFrontmatter(vault.note("NoteB.md"))?.[DEFAULT_DUE_KEY]).toBe("2026-12-31");
	});

	test("mid-batch AbortSignal halts processing after current note without corrupting remaining notes", async () => {
		const controller = new AbortController();
		const reporter = recordingReporter();

		const files: Record<string, { content: string; mtime: number }> = {};
		for (let i = 1; i <= 5; i++) {
			files[`Item${i}.md`] = {
				content: `---\ntrello_board_card_id: "b;c${i}"\n${DEFAULT_DUE_KEY}: "2026-12-31"\n---\n\nBody ${i}`,
				mtime: at("2026-01-01"),
			};
		}
		const vault = new FakeVault(files);

		let processedCount = 0;
		const originalWriteFm = vault.writeFrontmatter.bind(vault);
		vi.spyOn(vault, "writeFrontmatter").mockImplementation(async (note, mutate, options) => {
			await originalWriteFm(note, mutate, options);
			processedCount++;
			if (processedCount === 2) {
				// Abort mid-batch right after note 2 is written
				controller.abort();
			}
		});

		const notes = vault.listNotes("");
		const result = await alignNotes(
			vault,
			notes,
			["due"],
			createAlignSettings({ syncDue: false }),
			{ signal: controller.signal, reporter, keepMtime: true },
		);

		// Note 1 and 2 were modified
		expect(result.notesModified).toBe(2);
		expect(vault.readFrontmatter(vault.note("Item1.md"))?.[DEFAULT_DUE_KEY]).toBeUndefined();
		expect(vault.readFrontmatter(vault.note("Item2.md"))?.[DEFAULT_DUE_KEY]).toBeUndefined();

		// Notes 3, 4, 5 were strictly NOT modified
		expect(vault.readFrontmatter(vault.note("Item3.md"))?.[DEFAULT_DUE_KEY]).toBe("2026-12-31");
		expect(vault.readFrontmatter(vault.note("Item4.md"))?.[DEFAULT_DUE_KEY]).toBe("2026-12-31");
		expect(vault.readFrontmatter(vault.note("Item5.md"))?.[DEFAULT_DUE_KEY]).toBe("2026-12-31");

		// Reporter logged abortion
		expect(reporter.logs.some((l) => l.level === "warn" && l.message.includes("cancelled"))).toBe(true);
	});

	test("atomic note frontmatter integrity: aborted signal never leaves partial or malformed YAML", async () => {
		const controller = new AbortController();
		const files: Record<string, { content: string }> = {};
		for (let i = 1; i <= 6; i++) {
			files[`Doc${i}.md`] = {
				content: [
					"---",
					`trello_board_card_id: "b;doc${i}"`,
					`${DEFAULT_DUE_KEY}: "2026-12-31"`,
					`${DEFAULT_LABELS_KEY}:`,
					'  - "p1"',
					'  - "security"',
					"---",
					"",
					`Document ${i} content`,
				].join("\n"),
			};
		}
		const vault = new FakeVault(files);

		let stepCounter = 0;
		const origWriteFm = vault.writeFrontmatter.bind(vault);
		vi.spyOn(vault, "writeFrontmatter").mockImplementation(async (note, mutate, options) => {
			stepCounter++;
			if (stepCounter === 3) controller.abort();
			return origWriteFm(note, mutate, options);
		});

		await alignNotes(
			vault,
			vault.listNotes(""),
			["due", "labels"],
			createAlignSettings({ syncDue: false, syncLabels: false }),
			{ signal: controller.signal, keepMtime: true },
		);

		// Verify every single note has fully valid, parseable frontmatter and intact body
		for (let i = 1; i <= 6; i++) {
			const raw = vault.contentOf(`Doc${i}.md`);
			const { frontmatter, body } = splitFrontmatter(raw);
			expect(frontmatter).not.toBeNull();
			expect(body).toBe(`\n\nDocument ${i} content`);
			const fm = vault.readFrontmatter(vault.note(`Doc${i}.md`));
			expect(fm).toBeDefined();
			expect(fm?.trello_board_card_id).toBe(`b;doc${i}`);
		}
	});

	test("in-stream sync with cleanUpDuringSync respects AbortSignal mid-sync without corrupting note", async () => {
		const controller = new AbortController();
		const { transport } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const initialContent = [
			"---",
			'trello_board_card_id: "b;cAbortSync"',
			`${DEFAULT_DUE_KEY}: "2026-12-31"`,
			"---",
			"",
			"Prose content",
		].join("\n");

		const vault = new FakeVault({
			"AbortSync.md": { content: initialContent, mtime: at("2026-01-01") },
		});

		// Abort controller beforehand
		controller.abort();

		const remote = card({ id: "cAbortSync", name: "AbortSync", desc: "Prose content" });
		const noteHandle = vault.note("AbortSync.md");

		await syncNoteWithCard(
			vault,
			client,
			noteHandle,
			remote,
			createSyncOptions({ syncDue: false, cleanUpDuringSync: true }),
			undefined,
			undefined,
			undefined,
			controller.signal,
		);

		// Unchanged on abort
		expect(vault.contentOf("AbortSync.md")).toBe(initialContent);
	});

	test("signal abort during executeAlignNotes command runner displays warning notice", async () => {
		const controller = new AbortController();
		const vault = new FakeVault({
			"CmdNote.md": { content: `---\ntrello_board_card_id: "b;cCmd"\n${DEFAULT_DUE_KEY}: "2026-12-31"\n---\n\n` },
		});

		controller.abort();

		const ctx = buildFakeCommandContext(vault, {
			settings: {
				...DEFAULT_SETTINGS,
				syncDue: false,
			} as any,
			run: async (_title, action) => {
				const reporter = recordingReporter();
				await action(reporter, controller.signal);
			},
		});

		const result = await executeAlignNotes(ctx, vault.listNotes(""), ["due"]);
		expect(result.notesModified).toBe(0);
		expect(noticeMessages.some((msg) => msg.includes("Cleaned 0 notes"))).toBe(true);
	});
});

describe("Tier 5 Hardening — dryRun Fidelity Across All 12 Categories", () => {
	beforeEach(() => {
		noticeMessages.length = 0;
	});

	test("full 12-category dryRun fidelity: zero filesystem writes or mtime changes across all categories", async () => {
		// Construct 12 notes, each triggering one distinct alignment category
		const initialMtime = at("2026-05-01T12:00:00Z");

		const initialFiles: Record<string, string> = {
			"CatDue.md": `---\ntrello_board_card_id: "b;cDue"\n${DEFAULT_DUE_KEY}: "2026-10-31"\n---\n\nBody`,
			"CatLabels.md": `---\ntrello_board_card_id: "b;cLabels"\n${DEFAULT_LABELS_KEY}:\n  - "bug"\n---\n\nBody`,
			"CatMembers.md": `---\ntrello_board_card_id: "b;cMembers"\n${DEFAULT_MEMBERS_KEY}:\n  - "alice"\n---\n\nBody`,
			"CatCustomFields.md": `---\ntrello_board_card_id: "b;cCF"\n${DEFAULT_CUSTOM_FIELDS_KEY}:\n  Score: "95"\n---\n\nBody`,
			"CatAttachments.md": `---\ntrello_board_card_id: "b;cAtt"\n${DEFAULT_ATTACHMENTS_KEY}:\n  - "doc.pdf"\n---\n\nBody`,
			"CatLinkedCards.md": `---\ntrello_board_card_id: "b;cLinked"\n${DEFAULT_LINKED_CARDS_KEY}:\n  - "card-xyz"\n---\n\nBody`,
			"CatCover.md": `---\ntrello_board_card_id: "b;cCover"\n${DEFAULT_COVER_KEY}: "https://trello-attachments.s3.amazonaws.com/123/cover.jpg"\n---\n\nBody`,
			"CatPluginId.md": `---\ntrello_board_card_id: "b;cPlugin"\n${DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY}: "plug-id-999"\n---\n\nBody`,
			"CatMissingPluginId.md": `---\ntrello_board_card_id: "b;cMissingPlugin"\nauthor: "Bob"\n---\n\nBody`,
			"CatChecklist.md": `---\ntrello_board_card_id: "b;cChecklist"\n---\n\nBody text\n\n## Checklists\n- [ ] Task 1`,
			"CatObsoleteLabelProp.md": `---\ntrello_board_card_id: "b;cObsolete"\nlegacy_tag: "old_val"\n---\n\nBody`,
			"CatKeyMigration.md": `---\ntrello_board_card_id: "b;cMigrate"\nold_custom_due: "2026-11-15"\n---\n\nBody`,
		};

		const vaultRecord: Record<string, { content: string; mtime: number }> = {};
		for (const [p, c] of Object.entries(initialFiles)) {
			vaultRecord[p] = { content: c, mtime: initialMtime };
		}
		const vault = new FakeVault(vaultRecord);

		const settings = createAlignSettings({
			syncDue: false,
			syncLabels: false,
			syncMembers: false,
			syncCustomFields: false,
			syncAttachments: false,
			syncLinkedCards: false,
			syncCardCover: false,
			writeTrelloPluginNoteId: false, // triggers 'plugin-note-id' removal
			syncChecklists: false,
			checklistHeading: "## Checklists",
			obsoleteLabelPropertyKeys: ["legacy_tag"],
			keyMigrations: { old_custom_due: "new_custom_due" },
		});

		const allCategories: AlignCategory[] = [
			"due",
			"labels",
			"members",
			"custom-fields",
			"attachments",
			"linked-cards",
			"cover",
			"plugin-note-id",
			"missing-plugin-note-id",
			"checklist-section",
			"obsolete-label-property",
			"key-migration",
		];

		const settingsWithAdd = createAlignSettings({
			...settings,
			writeTrelloPluginNoteId: true,
		});

		const writeSpy = vi.spyOn(vault, "write");
		const writeFmSpy = vi.spyOn(vault, "writeFrontmatter");

		const notes = vault.listNotes("");
		const result = await alignNotes(vault, notes, allCategories, settingsWithAdd, { dryRun: true });

		// Zero filesystem writes
		expect(writeSpy).not.toHaveBeenCalled();
		expect(writeFmSpy).not.toHaveBeenCalled();

		// Every single file content must remain 100% byte-identical
		for (const [path, expectedContent] of Object.entries(initialFiles)) {
			expect(vault.contentOf(path)).toBe(expectedContent);
			expect(vault.note(path).mtime).toBe(initialMtime);
		}

		// Changes detected and counted across categories without mutation
		expect(result.notesScanned).toBe(12);
		expect(result.notesModified).toBeGreaterThan(0);
	});

	test("dryRun checklist-section markdown body preservation", async () => {
		const initialBody = "Introductory text\n\n## Checklists\n- [ ] Task A\n- [x] Task B\n\nFooter note";
		const content = `---\ntrello_board_card_id: "b;c1"\n---\n\n${initialBody}`;
		const vault = new FakeVault({ "Checklist.md": { content, mtime: at("2026-01-01") } });

		const settings = createAlignSettings({
			syncChecklists: false,
			checklistHeading: "## Checklists",
		});

		const changes = await alignNote(
			vault,
			vault.note("Checklist.md"),
			["checklist-section"],
			settings,
			{ dryRun: true },
		);

		expect(changes.some((c) => c.category === "checklist-section")).toBe(true);
		expect(vault.contentOf("Checklist.md")).toBe(content);
		expect(vault.contentOf("Checklist.md")).toContain("## Checklists");
	});

	test("dryRun missing-plugin-note-id backfill avoidance", async () => {
		const content = '---\ntrello_board_card_id: "b;c1"\n---\n\nNo plugin note ID';
		const vault = new FakeVault({ "MissingPlugin.md": { content, mtime: at("2026-01-01") } });

		const settings = createAlignSettings({
			writeTrelloPluginNoteId: true,
		});

		const changes = await alignNote(
			vault,
			vault.note("MissingPlugin.md"),
			["missing-plugin-note-id"],
			settings,
			{ dryRun: true },
		);

		expect(changes.some((c) => c.category === "missing-plugin-note-id")).toBe(true);
		expect(vault.readFrontmatter(vault.note("MissingPlugin.md"))?.[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]).toBeUndefined();
		expect(vault.contentOf("MissingPlugin.md")).toBe(content);
	});

	test("dryRun key migration avoidance", async () => {
		const content = '---\ntrello_board_card_id: "b;c1"\nold_deadline: "2026-12-25"\n---\n\nContent';
		const vault = new FakeVault({ "Migrate.md": { content, mtime: at("2026-01-01") } });

		const settings = createAlignSettings({
			keyMigrations: { old_deadline: "target_deadline" },
		});

		const changes = await alignNote(
			vault,
			vault.note("Migrate.md"),
			["key-migration"],
			settings,
			{ dryRun: true },
		);

		expect(changes.some((c) => c.category === "key-migration")).toBe(true);
		const fm = vault.readFrontmatter(vault.note("Migrate.md"));
		expect(fm?.old_deadline).toBe("2026-12-25");
		expect(fm?.target_deadline).toBeUndefined();
		expect(vault.contentOf("Migrate.md")).toBe(content);
	});

	test("dryRun cover image remote URL preservation", async () => {
		const remoteUrl = "https://trello-attachments.s3.amazonaws.com/abc/banner.jpg";
		const content = `---\ntrello_board_card_id: "b;c1"\n${DEFAULT_COVER_KEY}: "${remoteUrl}"\n---\n\nContent`;
		const vault = new FakeVault({ "Cover.md": { content, mtime: at("2026-01-01") } });

		const settings = createAlignSettings({
			syncCardCover: false,
		});

		const changes = await alignNote(
			vault,
			vault.note("Cover.md"),
			["cover"],
			settings,
			{ dryRun: true },
		);

		expect(changes.some((c) => c.category === "cover")).toBe(true);
		expect(vault.readFrontmatter(vault.note("Cover.md"))?.[DEFAULT_COVER_KEY]).toBe(remoteUrl);
		expect(vault.contentOf("Cover.md")).toBe(content);
	});

	test("dryRun fidelity during in-stream automatic sync (syncNoteWithCard)", async () => {
		const initialContent = [
			"---",
			'trello_board_card_id: "b;cDrySync"',
			`${DEFAULT_DUE_KEY}: "2026-12-31"`,
			`${DEFAULT_COVER_KEY}: "https://trello-attachments.s3.amazonaws.com/123/cov.png"`,
			"---",
			"",
			"Same body",
		].join("\n");

		const vault = new FakeVault({
			"DrySync.md": { content: initialContent, mtime: at("2026-01-01") },
		});

		const { transport } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const remote = card({ id: "cDrySync", name: "DrySync", desc: "Same body" });

		const updateCardSpy = vi.spyOn(client, "updateCard");
		const writeFmSpy = vi.spyOn(vault, "writeFrontmatter");
		const writeSpy = vi.spyOn(vault, "write");

		const result = await syncNoteWithCard(
			vault,
			client,
			vault.note("DrySync.md"),
			remote,
			createSyncOptions({
				syncDue: false,
				syncCardCover: false,
				cleanUpDuringSync: true,
				dryRun: true,
			}),
		);

		expect(result.direction).toBe("skip");

		expect(writeFmSpy).not.toHaveBeenCalled();
		expect(writeSpy).not.toHaveBeenCalled();
		expect(updateCardSpy).not.toHaveBeenCalled();
		expect(vault.contentOf("DrySync.md")).toBe(initialContent);
	});

	test("executeAlignNotes command runner dryRun mode prefixes summary notice with [Dry-run]", async () => {
		const vault = new FakeVault({
			"DryCmd.md": { content: `---\ntrello_board_card_id: "b;c1"\n${DEFAULT_DUE_KEY}: "2026-12-31"\n---\n\n` },
		});

		const ctx = buildFakeCommandContext(vault, {
			settings: {
				...DEFAULT_SETTINGS,
				syncDue: false,
				dryRun: true,
			} as any,
		});

		const result = await executeAlignNotes(ctx, vault.listNotes(""), ["due"]);
		expect(result.notesModified).toBe(1);

		const summaryNotice = noticeMessages.find((m) => m.includes("[Dry-run]"));
		expect(summaryNotice).toBeDefined();
		expect(summaryNotice).toBe("[Dry-run] Cleaned 1 note across 1 category.");

		// File strictly unmodified
		expect(vault.readFrontmatter(vault.note("DryCmd.md"))?.[DEFAULT_DUE_KEY]).toBe("2026-12-31");
	});
});

describe("Tier 5 Hardening — Timestamp Preservation & History Rollback Fidelity", () => {
	beforeEach(() => {
		noticeMessages.length = 0;
	});

	test("concurrent batch alignment preserves mtime across all notes even under high contention", async () => {
		const guard = new OperationGuard();
		const files: Record<string, { content: string; mtime: number }> = {};
		for (let i = 1; i <= 4; i++) {
			files[`TimestampNote${i}.md`] = {
				content: `---\ntrello_board_card_id: "b;cTime${i}"\n${DEFAULT_DUE_KEY}: "2026-12-31"\n---\n\nBody ${i}`,
				mtime: at(`2026-0${i}-15T12:00:00Z`),
			};
		}
		const vault = new FakeVault(files);

		const initialMtimes = new Map<string, number>();
		for (const note of vault.listNotes("")) {
			initialMtimes.set(note.path, note.mtime);
		}

		await alignNotes(
			vault,
			vault.listNotes(""),
			["due"],
			createAlignSettings({ syncDue: false }),
			{ guard, keepMtime: true },
		);

		for (const note of vault.listNotes("")) {
			expect(vault.readFrontmatter(note)?.[DEFAULT_DUE_KEY]).toBeUndefined();
			expect(vault.note(note.path).mtime).toBe(initialMtimes.get(note.path));
		}
	});

	test("history rollback restores exact initial state after concurrent alignment", async () => {
		const guard = new OperationGuard();
		const initial1 = '---\ntrello_board_card_id: "b;cRoll1"\n' + `${DEFAULT_DUE_KEY}: "2026-12-31"\n---\n\nBody 1`;
		const initial2 = '---\ntrello_board_card_id: "b;cRoll2"\n' + `${DEFAULT_LABELS_KEY}:\n  - "label1"\n---\n\nBody 2`;

		const vault = new FakeVault({
			"Roll1.md": { content: initial1, mtime: at("2026-01-01") },
			"Roll2.md": { content: initial2, mtime: at("2026-01-01") },
		});

		const actions: SyncAction[] = [];
		const recordedVault = wrapWithHistoryRecorder(vault, (action) => actions.push(action));

		const notes = vault.listNotes("");
		const result = await alignNotes(
			recordedVault,
			notes,
			["due", "labels"],
			createAlignSettings({ syncDue: false, syncLabels: false }),
			{ guard, keepMtime: true },
		);

		expect(result.notesModified).toBe(2);
		expect(actions.length).toBeGreaterThan(0);

		// Rollback through undo engine
		const { stats } = await undoRun(vault, {
			timestamp: new Date().toISOString(),
			scope: "",
			actions,
		});

		expect(stats.reverted).toBe(2);
		expect(vault.contentOf("Roll1.md")).toBe(initial1);
		expect(vault.contentOf("Roll2.md")).toBe(initial2);
	});
});
