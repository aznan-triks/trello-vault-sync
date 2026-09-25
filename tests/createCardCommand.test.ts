import { describe, expect, test, vi } from "vitest";

const noticeMessages: string[] = [];

vi.mock("obsidian", () => ({
	Notice: class Notice {
		constructor(message: string) {
			noticeMessages.push(message);
		}
	},
	Modal: class Modal {
		contentEl = { empty: () => {}, addClass: () => {}, createEl: () => ({}), createDiv: () => ({}) };
		constructor(_app: unknown) {}
		open(): void {}
		close(): void {}
	},
	FuzzySuggestModal: class FuzzySuggestModal {
		constructor(_app: unknown) {}
		setPlaceholder(_text: string): void {}
		open(): void {}
		close(): void {}
	},
	AbstractInputSuggest: class AbstractInputSuggest {
		constructor(_app: unknown, _inputEl: unknown) {}
	},
}));

import {
	batchCreateCardsFromNotesAction,
	createCardFromActiveNote,
	createCardFromNoteAction,
	createCardsFromPhantomNotes,
} from "../src/commands/createCardCommand";
import type { CommandContext } from "../src/commands/context";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { TrelloClient, type HttpRequest, type HttpResponse } from "../src/trello/client";
import { ConfirmModal } from "../src/ui/ConfirmModal";
import { ListPickerModal } from "../src/ui/ListPickerModal";
import { MultiSelectPickerModal } from "../src/ui/MultiSelectPickerModal";
import { PhantomNotePickerModal, type PhantomNoteChoice } from "../src/ui/PhantomNotePickerModal";
import { card, FakeVault, recordingReporter } from "./fakes";

function stubTransport(responses: HttpResponse[]) {
	const calls: HttpRequest[] = [];
	const queue = [...responses];
	const transport = async (req: HttpRequest): Promise<HttpResponse> => {
		calls.push(req);
		return queue.shift() ?? { status: 200, text: "{}" };
	};
	return { transport, calls };
}

const ok = (body: unknown): HttpResponse => ({ status: 200, text: JSON.stringify(body) });

function fakeContext(
	vault: FakeVault,
	transportResponses: HttpResponse[] = [],
	overrides: Partial<CommandContext> = {},
): { ctx: CommandContext; calls: HttpRequest[]; logs: { level: string; message: string }[] } {
	const { transport, calls } = stubTransport(transportResponses);
	const reporter = recordingReporter();
	const ctx: CommandContext = {
		app: {} as CommandContext["app"],
		vault,
		settings: { ...DEFAULT_SETTINGS, boardId: "board-1", phantomCardListId: "inbox-list" },
		journal: [],
		history: [],
		recordSyncRun: async () => {},
		setHistory: async () => {},
		client: () => new TrelloClient({ apiKey: "k", token: "t" }, transport, { sleep: async () => {} }),
		fetchBinary: async () => null,
		run: async (_title, body) => {
			await body(reporter, new AbortController().signal);
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
			boardId: "board-1",
		}),
		auditOptions: () => ({ scope: "", boardId: "board-1", reportPath: "", timestamp: "t", excludedFolders: [] }),
		activateSidebarView: async () => {},
		saveSettings: async () => {},
		...overrides,
	};
	return { ctx, calls, logs: reporter.logs };
}

describe("createCardFromNoteAction", () => {
	const mockCard = card({
		id: "card-created",
		idBoard: "board-1",
		idList: "inbox-list",
		name: "My Task",
		desc: "My note content",
	});

	test("creates a card and links the note", async () => {
		const vault = new FakeVault({
			"Notes/My Task.md": { content: "My note content" },
		});
		const note = vault.note("Notes/My Task.md");
		const { ctx, calls } = fakeContext(vault, [
			ok([]), // getBoardLabels
			ok(mockCard), // createCard
		]);

		await createCardFromNoteAction(ctx, note, "inbox-list", "Inbox");

		expect(calls.some((c) => c.method === "POST")).toBe(true);
		expect(vault.getCardRef(note)).toEqual({ boardId: "board-1", cardId: "card-created" });
	});

	test("respects dryRun in context settings", async () => {
		const vault = new FakeVault({
			"Notes/Task.md": { content: "Draft" },
		});
		const note = vault.note("Notes/Task.md");
		const { ctx, calls } = fakeContext(vault, [ok([])], {
			settings: { ...DEFAULT_SETTINGS, boardId: "board-1", dryRun: true },
		});

		await createCardFromNoteAction(ctx, note, "inbox-list");

		expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
		expect(vault.getCardRef(note)).toBeNull();
	});
});

describe("batchCreateCardsFromNotesAction", () => {
	test("creates cards for multiple notes and links them", async () => {
		const vault = new FakeVault({
			"note1.md": { content: "body1" },
			"Projects/note2.md": { content: "body2" },
		});
		const n1 = vault.note("note1.md");
		const n2 = vault.note("Projects/note2.md");

		const { ctx, calls, logs } = fakeContext(
			vault,
			[
				ok([]), // getBoardLabels
				ok(card({ id: "c1", idBoard: "board-1", idList: "inbox-list", name: "note1" })),
				ok(card({ id: "c2", idBoard: "board-1", idList: "list-projects", name: "note2" })),
			],
			{
				settings: {
					...DEFAULT_SETTINGS,
					boardId: "board-1",
					phantomCardListId: "inbox-list",
					phantomNotePreferFolderMapping: true,
					mappings: [{ folder: "Projects", listId: "list-projects", templateName: "" }],
				},
			},
		);

		await batchCreateCardsFromNotesAction(
			ctx,
			[
				{ note: n1, kind: "unlinked" },
				{ note: n2, kind: "phantom" },
			],
			"inbox-list",
			"Inbox",
		);

		const postCalls = calls.filter((c) => c.method === "POST");
		expect(postCalls).toHaveLength(2);
		expect(postCalls[0]?.body).toContain("idList=inbox-list");
		expect(postCalls[1]?.body).toContain("idList=list-projects");

		expect(vault.getCardRef(n1)).toEqual({ boardId: "board-1", cardId: "c1" });
		expect(vault.getCardRef(n2)).toEqual({ boardId: "board-1", cardId: "c2" });
		expect(logs.filter((l) => l.level === "create")).toHaveLength(2);
	});

	test("records every created card in sync history so the batch can be undone (archived, not deleted)", async () => {
		const vault = new FakeVault({ "note1.md": { content: "body1" } });
		const n1 = vault.note("note1.md");
		const recorded: { scope: string; actions: unknown[] }[] = [];

		const { ctx } = fakeContext(
			vault,
			[
				ok([]), // getBoardLabels
				ok(card({ id: "c1", idBoard: "board-1", idList: "inbox-list", name: "note1" })),
			],
			{
				settings: { ...DEFAULT_SETTINGS, boardId: "board-1", phantomCardListId: "inbox-list" },
				recordSyncRun: async (scope, actions) => {
					recorded.push({ scope, actions });
				},
			},
		);

		await batchCreateCardsFromNotesAction(ctx, [{ note: n1, kind: "unlinked" }], "inbox-list", "Inbox");

		expect(recorded).toHaveLength(1);
		// The card-create action, plus the frontmatter write that links the note (setCardRef).
		expect(recorded[0]?.actions).toEqual(
			expect.arrayContaining([expect.objectContaining({ kind: "trello-card-create", path: "note1.md", cardId: "c1" })]),
		);
	});
});

describe("createCardFromActiveNote", () => {
	test("does nothing when no active note is open", async () => {
		const vault = new FakeVault();
		const { ctx, calls } = fakeContext(vault, [], { activeNote: () => null });

		await createCardFromActiveNote(ctx);

		expect(calls).toHaveLength(0);
	});

	test("alerts user when active note is already linked to a card on the board", async () => {
		noticeMessages.length = 0;
		const vault = new FakeVault({
			"Task.md": { content: '---\ntrello_board_card_id: "board-1;c1"\n---\nTask body' },
		});
		const note = vault.note("Task.md");

		const { ctx } = fakeContext(vault, [
			ok({ id: "c1", name: "Task" }), // getCard
		], {
			activeNote: () => note,
		});

		await createCardFromActiveNote(ctx);

		expect(noticeMessages).toContain("Active note is already linked to a card on Trello.");
	});

	test("recreates card when active note has a dead/phantom card link (404 on Trello)", async () => {
		noticeMessages.length = 0;
		const vault = new FakeVault({
			"PhantomTask.md": { content: '---\ntrello_board_card_id: "board-1;c-dead"\n---\nPhantom body' },
		});
		const note = vault.note("PhantomTask.md");

		const { ctx, calls } = fakeContext(
			vault,
			[
				{ status: 404, text: "card not found" }, // getCard returns 404
				ok([]), // getBoardLabels
				ok(card({ id: "c-reborn", idBoard: "board-1", idList: "inbox-list", name: "PhantomTask" })), // createCard
			],
			{
				activeNote: () => note,
			},
		);

		await createCardFromActiveNote(ctx);

		expect(calls.some((c) => c.method === "POST")).toBe(true);
		expect(vault.getCardRef(note)).toEqual({ boardId: "board-1", cardId: "c-reborn" });
	});

	test("fails fast with notice when getCard throws a network or server error", async () => {
		noticeMessages.length = 0;
		const vault = new FakeVault({
			"Task.md": { content: '---\ntrello_board_card_id: "board-1;c1"\n---\nTask body' },
		});
		const note = vault.note("Task.md");

		const { ctx, calls } = fakeContext(
			vault,
			[{ status: 401, text: "unauthorized" }],
			{
				activeNote: () => note,
			},
		);

		await createCardFromActiveNote(ctx);

		expect(noticeMessages.some((msg) => msg.includes("500") || msg.includes("❌"))).toBe(true);
		expect(calls.some((c) => c.method === "POST")).toBe(false);
	});
});

describe("batchCreateCardsFromNotesAction edge cases", () => {
	test("stops batch on abort without counting aborted cards as errors", async () => {
		const vault = new FakeVault({
			"n1.md": { content: "body1" },
			"n2.md": { content: "body2" },
		});
		const n1 = vault.note("n1.md");
		const n2 = vault.note("n2.md");

		const controller = new AbortController();
		const logs: { level: string; message: string }[] = [];
		const { ctx } = fakeContext(
			vault,
			[
				ok([]),
				ok(card({ id: "c1", idBoard: "board-1", idList: "inbox-list", name: "n1" })),
			],
			{
				run: async (_title, body) => {
					await body({
						setTotal: () => {},
						step: () => {},
						count: () => {},
						log: (lvl, msg) => logs.push({ level: lvl, message: msg }),
						finish: () => {},
					}, controller.signal);
				},
			},
		);

		controller.abort();

		await batchCreateCardsFromNotesAction(
			ctx,
			[{ note: n1, kind: "unlinked" }, { note: n2, kind: "unlinked" }],
			"inbox-list",
		);

		expect(logs.filter((l) => l.level === "error")).toHaveLength(0);
	});

	test("skips notes and logs error when no destination list is available", async () => {
		const vault = new FakeVault({
			"Unmapped/note.md": { content: "body" },
		});
		const note = vault.note("Unmapped/note.md");

		const { ctx, calls, logs } = fakeContext(
			vault,
			[ok([])],
			{
				settings: {
					...DEFAULT_SETTINGS,
					boardId: "board-1",
					phantomCardListId: "",
					mappings: [],
				},
			},
		);

		await batchCreateCardsFromNotesAction(
			ctx,
			[{ note, kind: "unlinked" }],
			"",
		);

		expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
		expect(logs.some((l) => l.level === "error" && l.message.includes("No destination list"))).toBe(true);
	});

	test("does not fetch board labels when syncLabels is false", async () => {
		const vault = new FakeVault({
			"Notes/Task.md": { content: "Body" },
		});
		const note = vault.note("Notes/Task.md");

		const { ctx, calls } = fakeContext(
			vault,
			[ok(card({ id: "c-new", idBoard: "board-1", idList: "inbox-list", name: "Task" }))],
			{
				settings: { ...DEFAULT_SETTINGS, boardId: "board-1", syncLabels: false },
			},
		);

		await createCardFromNoteAction(ctx, note, "inbox-list");

		expect(calls.some((c) => c.url.includes("/labels"))).toBe(false);
		expect(calls.some((c) => c.method === "POST")).toBe(true);
	});
});

describe("createCardsFromPhantomNotes", () => {
	test("returns early when no phantom or unlinked notes exist", async () => {
		const vault = new FakeVault({
			"n1.md": { content: '---\ntrello_board_card_id: "board-1;c1"\n---\nbody' },
		});
		const { ctx } = fakeContext(
			vault,
			[
				ok([{ id: "list-1", name: "List 1" }]), // getBoardLists
				ok([card({ id: "c1", name: "n1" })]), // getBoardCards
			],
		);

		await createCardsFromPhantomNotes(ctx);

		expect(vault.paths()).toEqual(["n1.md"]);
	});

	test("scans and detects phantom notes, opening picker modal", async () => {
		const vault = new FakeVault({
			"dead.md": { content: '---\ntrello_board_card_id: "board-1;c-dead"\n---\nbody' },
		});
		const { ctx } = fakeContext(
			vault,
			[
				ok([{ id: "list-1", name: "List 1" }]), // getBoardLists
				ok([]), // getBoardCards: no cards on board, so dead.md is phantom
			],
		);

		await createCardsFromPhantomNotes(ctx);

		expect(vault.paths()).toEqual(["dead.md"]);
	});

	test("'ALL' choice creates directly when confirmBatchCreate is off", async () => {
		let capturedOnPick: ((choice: PhantomNoteChoice) => void) | undefined;
		vi.spyOn(PhantomNotePickerModal.prototype, "open").mockImplementation(function (this: PhantomNotePickerModal) {
			capturedOnPick = (this as unknown as { onPick: (choice: PhantomNoteChoice) => void }).onPick;
		});

		const vault = new FakeVault({
			"n1.md": { content: "body" },
			"n2.md": { content: "body" },
		});
		const { ctx } = fakeContext(
			vault,
			[
				ok([{ id: "inbox-list", name: "Inbox" }]), // getBoardLists
				ok([]), // getBoardCards
				ok([]), // getBoardLabels (batch)
				ok(card({ id: "created-1", idList: "inbox-list", name: "n1" })), // createCard n1
				ok(card({ id: "created-2", idList: "inbox-list", name: "n2" })), // createCard n2
			],
			{ settings: { ...DEFAULT_SETTINGS, boardId: "board-1", phantomCardListId: "inbox-list", confirmBatchCreate: false } },
		);

		await createCardsFromPhantomNotes(ctx);
		expect(capturedOnPick).toBeDefined();
		capturedOnPick!({ type: "all", count: 2 });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(vault.contentOf("n1.md")).toContain("created-1");
		expect(vault.contentOf("n2.md")).toContain("created-2");
	});

	test("'ALL' choice waits for confirmation when confirmBatchCreate is on", async () => {
		let capturedOnPick: ((choice: PhantomNoteChoice) => void) | undefined;
		vi.spyOn(PhantomNotePickerModal.prototype, "open").mockImplementation(function (this: PhantomNotePickerModal) {
			capturedOnPick = (this as unknown as { onPick: (choice: PhantomNoteChoice) => void }).onPick;
		});
		let capturedConfirm: (() => void) | undefined;
		vi.spyOn(ConfirmModal.prototype, "open").mockImplementation(function (this: ConfirmModal) {
			capturedConfirm = (this as unknown as { onConfirm: () => void }).onConfirm;
		});

		const vault = new FakeVault({ "n1.md": { content: "body" } });
		const { ctx } = fakeContext(
			vault,
			[
				ok([{ id: "inbox-list", name: "Inbox" }]), // getBoardLists
				ok([]), // getBoardCards
				ok([]), // getBoardLabels (batch)
				ok(card({ id: "created-1", idList: "inbox-list", name: "n1" })), // createCard n1
			],
			{ settings: { ...DEFAULT_SETTINGS, boardId: "board-1", phantomCardListId: "inbox-list", confirmBatchCreate: true } },
		);

		await createCardsFromPhantomNotes(ctx);
		capturedOnPick!({ type: "all", count: 1 });

		expect(capturedConfirm).toBeDefined();
		expect(vault.contentOf("n1.md")).not.toContain("created-1");

		capturedConfirm!();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(vault.contentOf("n1.md")).toContain("created-1");
	});

	test("'select' choice opens a checkbox picker and creates only the chosen subset", async () => {
		let capturedOnPick: ((choice: PhantomNoteChoice) => void) | undefined;
		vi.spyOn(PhantomNotePickerModal.prototype, "open").mockImplementation(function (this: PhantomNotePickerModal) {
			capturedOnPick = (this as unknown as { onPick: (choice: PhantomNoteChoice) => void }).onPick;
		});
		let capturedOnConfirm: ((selected: unknown[]) => void) | undefined;
		vi.spyOn(MultiSelectPickerModal.prototype, "open").mockImplementation(function (this: MultiSelectPickerModal<unknown>) {
			const self = this as unknown as { items: readonly unknown[]; onConfirm: (selected: unknown[]) => void };
			capturedOnConfirm = self.onConfirm;
		});

		const vault = new FakeVault({
			"n1.md": { content: "body" },
			"n2.md": { content: "body" },
		});
		const { ctx } = fakeContext(
			vault,
			[
				ok([{ id: "inbox-list", name: "Inbox" }]), // getBoardLists
				ok([]), // getBoardCards
				ok([]), // getBoardLabels (batch, only for the selected subset)
				ok(card({ id: "created-2", idList: "inbox-list", name: "n2" })), // createCard n2 only
			],
			{ settings: { ...DEFAULT_SETTINGS, boardId: "board-1", phantomCardListId: "inbox-list" } },
		);

		await createCardsFromPhantomNotes(ctx);
		capturedOnPick!({ type: "select", count: 2 });
		expect(capturedOnConfirm).toBeDefined();

		const n2 = vault.note("n2.md");
		capturedOnConfirm!([{ note: n2, kind: "unlinked" }]);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(vault.contentOf("n1.md")).not.toContain("created");
		expect(vault.contentOf("n2.md")).toContain("created-2");
	});
});

describe("PhantomNotePickerModal and ListPickerModal", () => {
	test("PhantomNotePickerModal builds items and formats text correctly", () => {
		const vault = new FakeVault({
			"n1.md": { content: "body" },
			"Folder/n2.md": { content: "body" },
		});
		const n1 = vault.note("n1.md");
		const n2 = vault.note("Folder/n2.md");

		const candidates = [
			{ note: n1, kind: "unlinked" as const },
			{ note: n2, kind: "phantom" as const },
		];

		let picked: unknown = null;
		const modal = new PhantomNotePickerModal({} as never, candidates, (c) => {
			picked = c;
		});

		const items = modal.getItems();
		expect(items).toHaveLength(4); // "all" + "select" + 2 singles
		expect(items[0]?.type).toBe("all");
		expect(modal.getItemText(items[0]!)).toContain("Create Trello cards for ALL 2 phantom notes");
		expect(items[1]?.type).toBe("select");
		expect(modal.getItemText(items[1]!)).toBe("→ ☑ Select several…");
		expect(modal.getItemText(items[2]!)).toContain("n1 (root) [unlinked]");
		expect(modal.getItemText(items[3]!)).toContain("n2 (Folder/) [phantom]");

		modal.onChooseItem(items[0]!);
		expect(picked).toEqual({ type: "all", count: 2 });
	});

	test("ListPickerModal builds items and triggers onPick", () => {
		const lists = [
			{ id: "l1", name: "Inbox" },
			{ id: "l2", name: "Done" },
		];
		let picked: unknown = null;
		const modal = new ListPickerModal({} as never, lists, (l) => {
			picked = l;
		});

		expect(modal.getItems()).toEqual(lists);
		expect(modal.getItemText(lists[0]!)).toBe("Inbox");

		modal.onChooseItem(lists[1]!);
		expect(picked).toEqual(lists[1]);
	});
});
