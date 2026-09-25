import { afterEach, describe, expect, test, vi } from "vitest";

// Same obsidian stub as tests/createNoteCommand.test.ts — the command pulls in
// modals that only need to satisfy `extends` under vitest.
vi.mock("obsidian", () => ({
	Notice: class Notice {
		static messages: string[] = [];
		constructor(message?: string) {
			Notice.messages.push(message ?? "");
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
	},
	AbstractInputSuggest: class AbstractInputSuggest {
		constructor(_app: unknown, _inputEl: unknown) {}
	},
}));

import { Notice } from "obsidian";
import { createFromAuditReport } from "../src/commands/auditReportCreateCommand";
import type { CommandContext } from "../src/commands/context";
import { buildLinkReport } from "../src/core/auditReport";
import { DEFAULT_SETTINGS, type TrelloVaultSyncSettings } from "../src/settings/types";
import { TrelloClient } from "../src/trello/client";
import { AuditReportGroupPickerModal, type AuditReportGroupChoice } from "../src/ui/AuditReportGroupPickerModal";
import { ConfirmModal } from "../src/ui/ConfirmModal";
import { card, FakeVault, recordingReporter, routedTransport } from "./fakes";

const REPORT_PATH = "Reports/Links.md";
const linked = (cardId: string) => `---\ntrello_board_card_id: "board;${cardId}"\n---\n\nbody`;

const report = buildLinkReport({
	scope: "",
	timestamp: "t",
	listNames: new Map([
		["l1", "To do"],
		["l2", "Done"],
	]),
	orphanCards: [
		{ id: "c1", name: "Card One", url: "https://trello.com/c/c1", idList: "l1" },
		{ id: "c2", name: "Card Two", url: "https://trello.com/c/c2", idList: "l1" },
		{ id: "c3", name: "Card Three", url: "https://trello.com/c/c3", idList: "l2" },
		{ id: "c4", name: "Since linked", url: "https://trello.com/c/c4", idList: "l1" },
	],
	phantomNotes: [{ path: "Ideas/ghost.md", basename: "ghost", folder: "Ideas", cardId: "gone" }],
	unlinkedNotes: [
		{ path: "Ideas/free.md", basename: "free", folder: "Ideas", cardId: null },
		{ path: "Ideas/ticked.md", basename: "ticked", folder: "Ideas", cardId: null },
	],
	checked: new Set(["https://trello.com/c/c2", "Ideas/ticked.md"]),
});

function setup(settings: Partial<TrelloVaultSyncSettings> = {}, reportContent: string | null = report) {
	const vault = new FakeVault({
		"Ideas/free.md": { content: "free body" },
		"Ideas/ticked.md": { content: "ticked body" },
		"Ideas/ghost.md": { content: linked("gone") },
		"Done/linked.md": { content: linked("c4") },
		...(reportContent === null ? {} : { [REPORT_PATH]: { content: reportContent } }),
	});
	const routed = routedTransport({
		"/boards/board/cards": [
			card({ id: "c1", idList: "l1", name: "Card One" }),
			card({ id: "c2", idList: "l1", name: "Card Two" }),
			card({ id: "c3", idList: "l2", name: "Card Three" }),
			card({ id: "c4", idList: "l1", name: "Since linked" }),
		],
		"/boards/board/lists": [
			{ id: "l1", name: "To do" },
			{ id: "l2", name: "Done" },
		],
		"/boards/board/labels": [],
	});
	const reporter = recordingReporter();
	const ctx: CommandContext = {
		app: {} as CommandContext["app"],
		vault,
		settings: {
			...DEFAULT_SETTINGS,
			boardId: "board",
			mappings: [
				{ listId: "l1", folder: "Projects", templateName: "" },
				{ listId: "l2", folder: "Archive", templateName: "" },
			],
			phantomCardListId: "l1",
			confirmBatchCreate: false,
			...settings,
		},
		journal: [],
		history: [],
		recordSyncRun: async () => {},
		setHistory: async () => {},
		client: () => new TrelloClient({ apiKey: "k", token: "t" }, routed.transport),
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
			boardId: "board",
		}),
		auditOptions: () => ({ scope: "", boardId: "board", reportPath: REPORT_PATH, timestamp: "t", excludedFolders: [] }),
		activateSidebarView: async () => {},
		saveSettings: async () => {},
	};
	const cardPosts = () => routed.requests.filter((r) => r.method === "POST" && r.url.includes("/cards"));
	return { vault, ctx, reporter, cardPosts };
}

function capturePicker() {
	const captured: { choices?: AuditReportGroupChoice[]; onPick?: (choice: AuditReportGroupChoice) => void } = {};
	vi.spyOn(AuditReportGroupPickerModal.prototype, "open").mockImplementation(function (this: AuditReportGroupPickerModal) {
		const self = this as unknown as { choices: AuditReportGroupChoice[]; onPick: (choice: AuditReportGroupChoice) => void };
		captured.choices = self.choices;
		captured.onPick = self.onPick;
	});
	return captured;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const pick = (captured: ReturnType<typeof capturePicker>, label: string) => {
	const choice = captured.choices?.find((c) => c.label.startsWith(label));
	if (!choice) throw new Error(`no choice ${label} in ${captured.choices?.map((c) => c.label).join(" / ")}`);
	captured.onPick!(choice);
};

afterEach(() => {
	vi.restoreAllMocks();
	(Notice as unknown as { messages: string[] }).messages.length = 0;
});

describe("createFromAuditReport", () => {
	test("offers 'All groups' first, then each group with unchecked items and its counts", async () => {
		const captured = capturePicker();
		const { ctx } = setup();
		await createFromAuditReport(ctx);
		expect(captured.choices?.map((c) => c.label)).toEqual([
			"All groups — 3 card(s) → notes · 1 note(s) → cards",
			"📋 To do — 2 unchecked card(s) (1 checked)",
			"📋 Done — 1 unchecked card(s)",
			"📁 Ideas — 1 unchecked note(s) (1 checked)",
		]);
	});

	test("all groups: creates notes for unchecked cards and cards for unchecked notes, skipping stale items", async () => {
		const captured = capturePicker();
		const { ctx, vault, reporter, cardPosts } = setup();
		await createFromAuditReport(ctx);
		pick(captured, "All groups");
		await flush();
		await flush();

		expect(vault.exists("Projects/Card One.md")).toBe(true);
		expect(vault.exists("Projects/Card Two.md")).toBe(false); // checked
		expect(vault.exists("Archive/Card Three.md")).toBe(true);
		expect(vault.exists("Projects/Since linked.md")).toBe(false); // no longer orphan
		expect(cardPosts()).toHaveLength(1); // Ideas/free.md only — ticked and phantom notes excluded
		expect(reporter.logs.some((l) => l.level === "skip" && l.message.includes("https://trello.com/c/c4"))).toBe(true);
	});

	test("one group: only that Trello list's unchecked cards", async () => {
		const captured = capturePicker();
		const { ctx, vault, cardPosts } = setup();
		await createFromAuditReport(ctx);
		pick(captured, "📋 Done");
		await flush();
		await flush();

		expect(vault.exists("Archive/Card Three.md")).toBe(true);
		expect(vault.exists("Projects/Card One.md")).toBe(false);
		expect(cardPosts()).toHaveLength(0);
	});

	test("waits for confirmation when confirmBatchCreate is on", async () => {
		const captured = capturePicker();
		let message = "";
		let confirm: (() => void) | undefined;
		vi.spyOn(ConfirmModal.prototype, "open").mockImplementation(function (this: ConfirmModal) {
			const self = this as unknown as { message: string; onConfirm: () => void };
			message = self.message;
			confirm = self.onConfirm;
		});
		const { ctx, vault } = setup({ confirmBatchCreate: true });
		await createFromAuditReport(ctx);
		pick(captured, "All groups");
		await flush();

		expect(message).toContain("2 note(s)");
		expect(message).toContain("1 card(s)");
		expect(message).toContain("1 item(s) skipped");
		expect(vault.exists("Projects/Card One.md")).toBe(false);

		confirm!();
		await flush();
		await flush();
		expect(vault.exists("Projects/Card One.md")).toBe(true);
	});

	test("a disabled direction hides its groups and creates nothing for it", async () => {
		const captured = capturePicker();
		const { ctx, cardPosts } = setup({ auditReportCreateCards: false });
		await createFromAuditReport(ctx);
		expect(captured.choices?.some((c) => c.label.includes("📁"))).toBe(false);
		pick(captured, "All groups");
		await flush();
		await flush();
		expect(cardPosts()).toHaveLength(0);
	});

	test("both directions disabled: says so, opens nothing", async () => {
		const captured = capturePicker();
		const { ctx } = setup({ auditReportCreateNotes: false, auditReportCreateCards: false });
		await createFromAuditReport(ctx);
		expect(captured.choices).toBeUndefined();
		expect((Notice as unknown as { messages: string[] }).messages.join(" ")).toContain("disabled");
	});

	test("no link report in the note: asks to run the link audit first", async () => {
		const captured = capturePicker();
		const { ctx } = setup({}, "just notes");
		await createFromAuditReport(ctx);
		expect(captured.choices).toBeUndefined();
		expect((Notice as unknown as { messages: string[] }).messages.join(" ")).toMatch(/Run "Audit links/);
	});

	test("dry-run creates nothing", async () => {
		const captured = capturePicker();
		const { ctx, vault, cardPosts } = setup({ dryRun: true });
		await createFromAuditReport(ctx);
		pick(captured, "All groups");
		await flush();
		await flush();
		expect(vault.exists("Projects/Card One.md")).toBe(false);
		expect(cardPosts()).toHaveLength(0);
	});
});
