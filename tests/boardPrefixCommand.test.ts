import { describe, expect, test, vi } from "vitest";

vi.mock("obsidian", () => ({
	Notice: class Notice {
		constructor(_message?: string) {}
	},
}));

import { addBoardToReferences } from "../src/commands/boardPrefixCommand";
import type { CommandContext } from "../src/commands/context";
import type { SyncAction } from "../src/core/syncHistory";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { TrelloClient } from "../src/trello/client";
import { card, FakeVault, recordingReporter, routedTransport } from "./fakes";

const RICH =
	'---\ntype: idée\ntrello_board_card_id: "c1"\ntrello_due: 2026-03-01\ntags:\n  - lore\n  - city\naliases: [Sagondo]\n---\n\nBody **kept** as is.\n';

function setup(files: Record<string, { content: string }>, settings: Partial<typeof DEFAULT_SETTINGS> = {}) {
	const vault = new FakeVault(files);
	const { transport, requests } = routedTransport({
		"/boards/b1/lists": [{ id: "l1", name: "A" }],
		"/boards/b1/cards": [card({ id: "c1", idBoard: "b1", idList: "l1" })],
		"/boards/b2/lists": [{ id: "l2", name: "B" }],
		"/boards/b2/cards": [card({ id: "c2", idBoard: "b2", idList: "l2" })],
	});
	const recorded: SyncAction[][] = [];
	let summary = "";
	const ctx = {
		vault,
		settings: { ...DEFAULT_SETTINGS, boardId: "b1", boards: [{ id: "b2", name: "Second" }], ...settings },
		client: () => new TrelloClient({ apiKey: "k", token: "t" }, transport),
		ready: () => true,
		run: async (_title: string, body: (r: ReturnType<typeof recordingReporter>, s: AbortSignal) => Promise<string>) => {
			summary = await body(recordingReporter(), new AbortController().signal);
		},
		recordSyncRun: async (_scope: string, actions: SyncAction[]) => void recorded.push(actions),
	} as unknown as CommandContext;
	return { vault, ctx, requests, recorded, summary: () => summary };
}

describe("addBoardToReferences", () => {
	test("writes the board in front of the card id and changes nothing else of the note", async () => {
		const { vault, ctx } = setup({ "Notes/Sagondo.md": { content: RICH } });
		const note = vault.note("Notes/Sagondo.md");
		const before = vault.readFrontmatter(note);

		await addBoardToReferences(ctx);

		const after = vault.readFrontmatter(vault.note("Notes/Sagondo.md"));
		expect(after).toEqual({ ...before, trello_board_card_id: "b1;c1" });
		expect(vault.contentOf("Notes/Sagondo.md")).toContain("Body **kept** as is.");
	});

	test("finds the board of a card on another registered board; a note that already has a board is untouched", async () => {
		const { vault, ctx, summary } = setup({
			"a.md": { content: '---\ntrello_board_card_id: "c2"\n---\nx' },
			"b.md": { content: '---\ntrello_board_card_id: "b1;c1"\n---\nx' },
		});

		await addBoardToReferences(ctx);

		expect(vault.contentOf("a.md")).toContain('"b2;c2"');
		expect(vault.contentOf("b.md")).toContain('"b1;c1"');
		expect(summary()).toBe("Added the board id to 1 note(s).");
	});

	test("a card on no registered board leaves its note alone and is counted", async () => {
		const { vault, ctx, summary } = setup({ "a.md": { content: '---\ntrello_board_card_id: "ghost"\n---\nx' } });

		await addBoardToReferences(ctx);

		expect(vault.contentOf("a.md")).toContain('"ghost"');
		expect(summary()).toContain("1 on no registered board");
	});

	test("a dry run writes nothing", async () => {
		const { vault, ctx, summary, recorded } = setup({ "Notes/Sagondo.md": { content: RICH } }, { dryRun: true });

		await addBoardToReferences(ctx);

		expect(vault.contentOf("Notes/Sagondo.md")).toBe(RICH);
		expect(summary()).toBe("[Dry-run] Would add the board id to 1 note(s).");
		expect(recorded).toEqual([]);
	});

	test("is recorded in the history so the run can be undone", async () => {
		const { ctx, recorded } = setup({ "Notes/Sagondo.md": { content: RICH } }, { historyEnabled: true });

		await addBoardToReferences(ctx);

		expect(recorded[0]).toHaveLength(1);
		expect(recorded[0]?.[0]).toMatchObject({ kind: "frontmatter", path: "Notes/Sagondo.md", previousContent: RICH });
	});
});
