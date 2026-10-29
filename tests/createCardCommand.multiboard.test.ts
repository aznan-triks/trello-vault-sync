import { describe, expect, test, vi } from "vitest";

vi.mock("obsidian", () => ({
	Notice: class Notice {
		constructor(_message?: string) {}
	},
	Modal: class Modal {
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
		constructor(_app: unknown, _inputEl?: unknown) {}
	},
}));

import { batchCreateCardsFromNotesAction, createCardsFromPhantomNotes } from "../src/commands/createCardCommand";
import type { CommandContext } from "../src/commands/context";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { TrelloClient, type HttpRequest, type HttpResponse } from "../src/trello/client";
import { card, FakeVault, recordingReporter } from "./fakes";

const SETTINGS = {
	...DEFAULT_SETTINGS,
	boardId: "board-1",
	boards: [{ id: "board-2", name: "Second" }],
	phantomCardListId: "inbox-1",
	phantomNotePreferFolderMapping: true,
	mappings: [{ folder: "Second", listId: "list-2", templateName: "", boardId: "board-2" }],
};

function twoBoards(vault: FakeVault, summary?: { text: string }) {
	const calls: HttpRequest[] = [];
	const transport = async (req: HttpRequest): Promise<HttpResponse> => {
		calls.push(req);
		const reply = (body: unknown): HttpResponse => ({ status: 200, text: JSON.stringify(body) });
		if (req.method === "POST") {
			const onSecond = req.body?.includes("idList=list-2") ?? false;
			return reply(card({ id: onSecond ? "n2" : "n1", idBoard: onSecond ? "board-2" : "board-1", idList: onSecond ? "list-2" : "inbox-1" }));
		}
		if (req.url.includes("/boards/board-2/labels")) return reply([{ id: "lab2", name: "Hot", color: "red" }]);
		if (req.url.includes("/boards/board-1/labels")) return reply([{ id: "lab1", name: "Cold", color: "blue" }]);
		if (req.url.includes("/boards/board-1/lists")) return reply([{ id: "inbox-1", name: "Inbox" }]);
		if (req.url.includes("/boards/board-2/lists")) return reply([{ id: "list-2", name: "Todo" }]);
		if (req.url.includes("/boards/board-1/cards")) return reply([card({ id: "alive-1", idBoard: "board-1" })]);
		if (req.url.includes("/boards/board-2/cards")) return reply([card({ id: "alive-2", idBoard: "board-2" })]);
		return { status: 404, text: "no route" };
	};
	const ctx = {
		app: {},
		vault,
		settings: SETTINGS,
		journal: [],
		history: [],
		recordSyncRun: async () => {},
		client: () => new TrelloClient({ apiKey: "k", token: "t" }, transport, { sleep: async () => {} }),
		run: async (_title: string, body: (r: ReturnType<typeof recordingReporter>, s: AbortSignal) => Promise<string>) => {
			const text = await body(recordingReporter(), new AbortController().signal);
			if (summary) summary.text = text;
		},
		ready: () => true,
		saveSettings: async () => {},
	} as unknown as CommandContext;
	return { ctx, calls };
}

describe("creating cards on several boards", () => {
	test("each card takes its labels from the board of its list, and each board's labels are read once", async () => {
		const vault = new FakeVault({
			"Second/a.md": { content: "---\ntrello_labels:\n  - Hot\n---\nbody" },
			"Second/b.md": { content: "---\ntrello_labels:\n  - Hot\n---\nbody" },
			"Elsewhere/c.md": { content: "---\ntrello_labels:\n  - Cold\n---\nbody" },
		});
		const { ctx, calls } = twoBoards(vault);

		await batchCreateCardsFromNotesAction(
			ctx,
			["Second/a.md", "Second/b.md", "Elsewhere/c.md"].map((path) => ({ note: vault.note(path), kind: "unlinked" as const })),
			"inbox-1",
		);

		const posts = calls.filter((c) => c.method === "POST");
		expect(posts).toHaveLength(3);
		expect(posts[0]?.body).toContain("idList=list-2");
		expect(posts[0]?.body).toContain("idLabels=lab2");
		expect(posts[2]?.body).toContain("idList=inbox-1");
		expect(posts[2]?.body).toContain("idLabels=lab1");
		expect(calls.filter((c) => c.url.includes("/boards/board-2/labels"))).toHaveLength(1);
		expect(calls.filter((c) => c.url.includes("/boards/board-1/labels"))).toHaveLength(1);
		expect(vault.getCardRef(vault.note("Second/a.md"))).toEqual({ boardId: "board-2", cardId: "n2" });
	});

	test("a list the caller picked on another board reads that board's labels", async () => {
		const vault = new FakeVault({ "Elsewhere/c.md": { content: "---\ntrello_labels:\n  - Hot\n---\nbody" } });
		const { ctx, calls } = twoBoards(vault);

		await batchCreateCardsFromNotesAction(ctx, [{ note: vault.note("Elsewhere/c.md"), kind: "unlinked" }], "list-2", "Todo", "board-2");

		expect(calls.filter((c) => c.method === "POST")[0]?.body).toContain("idLabels=lab2");
		expect(calls.some((c) => c.url.includes("/boards/board-1/labels"))).toBe(false);
	});

	test("the phantom scan reads every registered board: a note whose card is on the second board is not a phantom", async () => {
		const vault = new FakeVault({
			"x.md": { content: '---\ntrello_board_card_id: "board-2;alive-2"\n---\nbody' },
			"y.md": { content: '---\ntrello_board_card_id: "board-1;alive-1"\n---\nbody' },
		});
		const summary = { text: "" };
		const { ctx, calls } = twoBoards(vault, summary);

		await createCardsFromPhantomNotes(ctx);

		expect(summary.text).toBe("No phantom or unlinked notes found in the vault.");
		expect(calls.filter((c) => c.url.includes("/boards/board-2/cards"))).toHaveLength(1);
	});
});
