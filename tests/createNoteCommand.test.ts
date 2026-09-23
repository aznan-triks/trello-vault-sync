import { describe, expect, test, vi } from "vitest";

// `createNoteCommand.ts` pulls in `CardPickerModal`/`FolderPickerModal`, which
// extend obsidian's `FuzzySuggestModal`/`Modal` — neither resolves under vitest
// (the "obsidian" package ships type declarations only). `createInFolder` never
// instantiates either modal, so a bare stub that only needs to satisfy `extends`
// is enough (same pattern as tests/noteCommands.test.ts).
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
		open(): void {}
	},
	AbstractInputSuggest: class AbstractInputSuggest {
		constructor(_app: unknown, _inputEl: unknown) {}
	},
}));

import { createInFolder, createNoteFromOrphanCard } from "../src/commands/createNoteCommand";
import type { CommandContext } from "../src/commands/context";
import { card, FakeVault, recordingReporter, routedTransport } from "./fakes";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { TrelloClient } from "../src/trello/client";

function fakeContext(overrides: Partial<CommandContext> = {}): CommandContext {
	const vault = new FakeVault();
	return {
		app: {} as CommandContext["app"],
		vault,
		settings: { ...DEFAULT_SETTINGS, boardId: "board" },
		journal: [],
		history: [],
		recordSyncRun: async () => {},
		setHistory: async () => {},
		client: () => new TrelloClient({ apiKey: "k", token: "t" }, routedTransport({}).transport),
		fetchBinary: async () => null,
		run: async (_title, body) => {
			await body(recordingReporter(), new AbortController().signal);
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
			boardId: "board",
		}),
		auditOptions: () => ({ scope: "", boardId: "board", reportPath: "", timestamp: "t", excludedFolders: [] }),
		activateSidebarView: async () => {},
		saveSettings: async () => {},
		...overrides,
	};
}

describe("createInFolder", () => {
	test("warns when the configured template has no card-ref key", async () => {
		const vault = new FakeVault();
		vault.templates.set("idée (script)", "---\ntype: idée\n---\n{{DESCRIPTION}}");
		const reporter = recordingReporter();
		const ctx = fakeContext({
			vault,
			settings: {
				...DEFAULT_SETTINGS,
				boardId: "board",
				mappings: [{ listId: "l1", folder: "WoT/85_Idées", templateName: "idée (script)" }],
			},
			run: async (_title, body) => {
				await body(reporter, new AbortController().signal);
			},
		});

		await createInFolder(ctx, card({ id: "c1", idList: "l1", name: "Sagondo" }), "WoT/85_Idées");

		const warnings = reporter.logs.filter((entry) => entry.message.includes("trello_board_card_id"));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.level).toBe("warn");
	});

	test("does not warn when the configured template has the card-ref key", async () => {
		const vault = new FakeVault();
		vault.templates.set(
			"idée (script)",
			'---\ntrello_board_card_id: "{{BOARD_ID}};{{CARD_ID}}"\n---\n{{DESCRIPTION}}',
		);
		const reporter = recordingReporter();
		const ctx = fakeContext({
			vault,
			settings: {
				...DEFAULT_SETTINGS,
				boardId: "board",
				mappings: [{ listId: "l1", folder: "WoT/85_Idées", templateName: "idée (script)" }],
			},
			run: async (_title, body) => {
				await body(reporter, new AbortController().signal);
			},
		});

		await createInFolder(ctx, card({ id: "c1", idList: "l1", name: "Sagondo" }), "WoT/85_Idées");

		expect(reporter.logs.filter((entry) => entry.level === "warn")).toHaveLength(0);
	});
});

import { OrphanCardPickerModal } from "../src/ui/OrphanCardPickerModal";
import { batchCreateNotesFromCardsAction } from "../src/commands/createNoteCommand";

describe("OrphanCardPickerModal", () => {
	const c1 = card({ id: "c1", name: "Card Alpha" });
	const c2 = card({ id: "c2", name: "Card Beta" });
	const c3 = card({ id: "c3", name: "Card Gamma" });

	test("displays 'ALL' entry when cards > 1 and allowBatch is true", () => {
		const modal = new OrphanCardPickerModal({} as never, [c1, c2, c3], true, () => {});
		const items = modal.getItems();
		expect(items).toHaveLength(4);
		expect(items[0]).toEqual({ type: "all", count: 3 });
		expect(modal.getItemText(items[0]!)).toBe("→ ✨ Create notes for ALL 3 orphan cards");
		expect(items[1]).toEqual({ type: "single", card: c1 });
		expect(modal.getItemText(items[1]!)).toBe("Card Alpha");
	});

	test("omits 'ALL' entry when allowBatch is false", () => {
		const modal = new OrphanCardPickerModal({} as never, [c1, c2, c3], false, () => {});
		const items = modal.getItems();
		expect(items).toHaveLength(3);
		expect(items.every((i) => i.type === "single")).toBe(true);
	});

	test("omits 'ALL' entry when there is only 1 card, even if allowBatch is true", () => {
		const modal = new OrphanCardPickerModal({} as never, [c1], true, () => {});
		const items = modal.getItems();
		expect(items).toHaveLength(1);
		expect(items[0]).toEqual({ type: "single", card: c1 });
	});

	test("returns empty list when cards is empty", () => {
		const modal = new OrphanCardPickerModal({} as never, [], true, () => {});
		expect(modal.getItems()).toEqual([]);
	});
});

describe("batchCreateNotesFromCardsAction", () => {
	test("happy path: creates notes in mapped folders and fallback folder, returns summary", async () => {
		const vault = new FakeVault();
		let summaryResult = "";
		const ctx = fakeContext({
			vault,
			settings: {
				...DEFAULT_SETTINGS,
				boardId: "board",
				mappings: [
					{ listId: "l1", folder: "Mapped/Folder1", templateName: "" },
					{ listId: "l2", folder: "Mapped/Folder2", templateName: "" },
				],
				orphanCardFolder: "Fallback/Inbox",
			},
			run: async (_title, body) => {
				summaryResult = (await body(recordingReporter(), new AbortController().signal)) ?? "";
			},
		});

		const cards = [
			card({ id: "c1", idList: "l1", name: "Card 1" }),
			card({ id: "c2", idList: "l2", name: "Card 2" }),
			card({ id: "c3", idList: "l_unmapped", name: "Card 3" }),
		];

		await batchCreateNotesFromCardsAction(ctx, cards);

		expect(vault.exists("Mapped/Folder1/Card 1.md")).toBe(true);
		expect(vault.exists("Mapped/Folder2/Card 2.md")).toBe(true);
		expect(vault.exists("Fallback/Inbox/Card 3.md")).toBe(true);
		expect(summaryResult).toBe("3 created · 0 error(s)");
	});

	test("applies promptedFolder only to cards without mapped list or fallback", async () => {
		const vault = new FakeVault();
		let summaryResult = "";
		const ctx = fakeContext({
			vault,
			settings: {
				...DEFAULT_SETTINGS,
				boardId: "board",
				mappings: [{ listId: "l1", folder: "Mapped/Folder1", templateName: "" }],
				orphanCardFolder: "", // no fallback
			},
			run: async (_title, body) => {
				summaryResult = (await body(recordingReporter(), new AbortController().signal)) ?? "";
			},
		});

		const cards = [
			card({ id: "c1", idList: "l1", name: "Mapped Card" }),
			card({ id: "c2", idList: "l_other", name: "Unmapped Card" }),
		];

		await batchCreateNotesFromCardsAction(ctx, cards, "Prompted/Target");

		expect(vault.exists("Mapped/Folder1/Mapped Card.md")).toBe(true);
		expect(vault.exists("Prompted/Target/Unmapped Card.md")).toBe(true);
		expect(summaryResult).toBe("2 created · 0 error(s)");
	});

	test("failure on one card does not abort other cards, reports error count", async () => {
		const vault = new FakeVault();
		// Make create fail on Card 2
		const origCreate = vault.create.bind(vault);
		vi.spyOn(vault, "create").mockImplementation(async (path, content) => {
			if (path.includes("Card 2")) {
				throw new Error("Disk full or invalid filename");
			}
			return origCreate(path, content);
		});

		let summaryResult = "";
		const reporter = recordingReporter();
		const ctx = fakeContext({
			vault,
			settings: {
				...DEFAULT_SETTINGS,
				boardId: "board",
				orphanCardFolder: "Inbox",
			},
			run: async (_title, body) => {
				summaryResult = (await body(reporter, new AbortController().signal)) ?? "";
			},
		});

		const cards = [
			card({ id: "c1", idList: "l1", name: "Card 1" }),
			card({ id: "c2", idList: "l1", name: "Card 2" }),
			card({ id: "c3", idList: "l1", name: "Card 3" }),
		];

		await batchCreateNotesFromCardsAction(ctx, cards);

		expect(vault.exists("Inbox/Card 1.md")).toBe(true);
		expect(vault.exists("Inbox/Card 2.md")).toBe(false);
		expect(vault.exists("Inbox/Card 3.md")).toBe(true);
		expect(summaryResult).toBe("2 created · 1 error(s)");
		expect(reporter.logs.some((l) => l.level === "error" && l.message.includes("Card 2"))).toBe(true);
	});

	test("cancel button terminates the loop between cards", async () => {
		const vault = new FakeVault();
		const controller = new AbortController();
		let summaryResult = "";
		const origCreate = vault.create.bind(vault);
		vi.spyOn(vault, "create").mockImplementation(async (path, content) => {
			// abort after first card is created
			controller.abort();
			return origCreate(path, content);
		});

		const ctx = fakeContext({
			vault,
			settings: {
				...DEFAULT_SETTINGS,
				boardId: "board",
				orphanCardFolder: "Inbox",
			},
			run: async (_title, body) => {
				summaryResult = (await body(recordingReporter(), controller.signal)) ?? "";
			},
		});

		const cards = [
			card({ id: "c1", idList: "l1", name: "Card 1" }),
			card({ id: "c2", idList: "l1", name: "Card 2" }),
			card({ id: "c3", idList: "l1", name: "Card 3" }),
		];

		await batchCreateNotesFromCardsAction(ctx, cards);

		expect(vault.exists("Inbox/Card 1.md")).toBe(true);
		expect(vault.exists("Inbox/Card 2.md")).toBe(false);
		expect(vault.exists("Inbox/Card 3.md")).toBe(false);
		expect(summaryResult).toBe("1 created · 0 error(s)");
	});

	test("dryRun=true never calls vault.create and returns dry-run summary", async () => {
		const vault = new FakeVault();
		const createSpy = vi.spyOn(vault, "create");
		let summaryResult = "";

		const ctx = fakeContext({
			vault,
			settings: {
				...DEFAULT_SETTINGS,
				boardId: "board",
				dryRun: true,
				orphanCardFolder: "Inbox",
			},
			run: async (_title, body) => {
				summaryResult = (await body(recordingReporter(), new AbortController().signal)) ?? "";
			},
		});

		const cards = [
			card({ id: "c1", idList: "l1", name: "Card 1" }),
			card({ id: "c2", idList: "l1", name: "Card 2" }),
		];

		await batchCreateNotesFromCardsAction(ctx, cards);

		expect(createSpy).not.toHaveBeenCalled();
		expect(summaryResult).toContain("[Dry-run] Would create 2 note(s)");
	});

	test("template missing card-ref key warns at most once per template across the batch", async () => {
		const vault = new FakeVault();
		vault.templates.set("no-key-tmpl", "---\ntype: test\n---\n{{DESCRIPTION}}");
		const readTemplateSpy = vi.spyOn(vault, "readTemplate");
		const reporter = recordingReporter();

		const ctx = fakeContext({
			vault,
			settings: {
				...DEFAULT_SETTINGS,
				boardId: "board",
				defaultTemplateName: "no-key-tmpl",
				orphanCardFolder: "Inbox",
			},
			run: async (_title, body) => {
				await body(reporter, new AbortController().signal);
			},
		});

		const cards = [
			card({ id: "c1", idList: "l1", name: "Card 1" }),
			card({ id: "c2", idList: "l1", name: "Card 2" }),
			card({ id: "c3", idList: "l1", name: "Card 3" }),
		];

		await batchCreateNotesFromCardsAction(ctx, cards);

		// Warning emitted exactly once
		const warnings = reporter.logs.filter((l) => l.level === "warn" && l.message.includes("no-key-tmpl"));
		expect(warnings).toHaveLength(1);

		// Template read only once (cached)
		expect(readTemplateSpy).toHaveBeenCalledTimes(1);
	});
});

describe("createNoteFromOrphanCard", () => {
	test("returns message when no cards are on the board", async () => {
		let result = "";
		const ctx = fakeContext({
			client: () =>
				new TrelloClient(
					{ apiKey: "k", token: "t" },
					routedTransport({
						"/boards/board/cards": [],
					}).transport,
				),
			run: async (_title, body) => {
				result = (await body(recordingReporter(), new AbortController().signal)) ?? "";
			},
		});

		await createNoteFromOrphanCard(ctx);
		expect(result).toBe("Every card on the board is already linked to a note.");
	});

	test("returns message when orphan cards exist but none match mapped-lists-only scope", async () => {
		let result = "";
		const ctx = fakeContext({
			settings: {
				...DEFAULT_SETTINGS,
				boardId: "board",
				mappings: [{ listId: "l_mapped", folder: "Folder1", templateName: "" }],
				orphanCardScope: "mapped-lists-only",
			},
			client: () =>
				new TrelloClient(
					{ apiKey: "k", token: "t" },
					routedTransport({
						"/boards/board/cards": [card({ id: "c1", idList: "l_other", name: "Other" })],
					}).transport,
				),
			run: async (_title, body) => {
				result = (await body(recordingReporter(), new AbortController().signal)) ?? "";
			},
		});

		await createNoteFromOrphanCard(ctx);
		expect(result).toBe("No orphan cards match the configured detection scope.");
	});

	test("opens modal with only mapped list cards when scope is mapped-lists-only", async () => {
		let openedItems: unknown[] = [];
		vi.spyOn(OrphanCardPickerModal.prototype, "open").mockImplementation(function (this: OrphanCardPickerModal) {
			openedItems = this.getItems();
		});

		const ctx = fakeContext({
			settings: {
				...DEFAULT_SETTINGS,
				boardId: "board",
				mappings: [{ listId: "l1", folder: "Folder1", templateName: "" }],
				orphanCardScope: "mapped-lists-only",
				orphanCardBatchCreate: true,
			},
			client: () =>
				new TrelloClient(
					{ apiKey: "k", token: "t" },
					routedTransport({
						"/boards/board/cards": [
							card({ id: "c1", idList: "l1", name: "Mapped Card" }),
							card({ id: "c2", idList: "l2", name: "Unmapped Card" }),
						],
					}).transport,
				),
			run: async (_title, body) => {
				await body(recordingReporter(), new AbortController().signal);
			},
		});

		await createNoteFromOrphanCard(ctx);
		// Only 1 card matches, so no "ALL" option and only c1 is present
		expect(openedItems).toHaveLength(1);
		expect(openedItems[0]).toEqual({
			type: "single",
			card: expect.objectContaining({ id: "c1", name: "Mapped Card" }),
		});
	});
});


