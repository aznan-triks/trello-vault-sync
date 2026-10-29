import { describe, expect, test } from "vitest";
import { auditChanges } from "../src/features/auditChanges";
import { auditLinks } from "../src/features/auditLinks";
import { auditLocations } from "../src/features/auditLocations";
import { exportChangesHtml } from "../src/features/exportChangesHtml";
import { TrelloClient } from "../src/trello/client";
import { FakeVault, card, routedTransport } from "./fakes";

const REPORT = "Report.md";
const BOARDS = [{ id: "board2", name: "Second" }];
const linked = (boardId: string, cardId: string) => `---\ntrello_board_card_id: "${boardId};${cardId}"\n---\n\nbody`;

function twoBoards() {
	const { transport, requests } = routedTransport({
		"/boards/board/lists": [{ id: "l1", name: "Ideas" }],
		"/boards/board/cards": [card({ id: "c1", name: "Alpha", idList: "l1" }), card({ id: "c2", name: "Orphan A", idList: "l1" })],
		"/boards/board2/lists": [{ id: "l2", name: "Todo" }],
		"/boards/board2/cards": [
			card({ id: "d1", name: "Beta", idBoard: "board2", idList: "l2" }),
			card({ id: "d2", name: "Orphan B", idBoard: "board2", idList: "l2" }),
		],
		"/boards/board/actions": [{ id: "a1", type: "createCard", date: "2026-09-04T10:00:00.000Z", data: { card: { name: "Quest A" } } }],
		"/boards/board2/actions": [{ id: "b1", type: "createCard", date: "2026-09-05T10:00:00.000Z", data: { card: { name: "Quest B" } } }],
	});
	return { client: new TrelloClient({ apiKey: "k", token: "t" }, transport), requests };
}
const reads = (requests: { url: string }[], fragment: string) => requests.filter((r) => r.url.includes(fragment)).length;

describe("auditLinks — several boards", () => {
	const options = { scope: "", boardId: "board", boards: BOARDS, reportPath: REPORT, timestamp: "t" };
	const vaultWith = () =>
		new FakeVault({
			[REPORT]: { content: "" },
			"a.md": { content: linked("board", "c1") },
			"b.md": { content: linked("board2", "d1") },
			"ghost.md": { content: linked("board2", "gone") },
		});

	test("reads each board once; a note whose card is on the second board is linked, not a phantom", async () => {
		const vault = vaultWith();
		const { client, requests } = twoBoards();

		const result = await auditLinks(vault, client, options);

		expect(result.phantomNotes).toBe(1);
		expect(result.orphanCards).toBe(2);
		expect(reads(requests, "/boards/board/cards")).toBe(1);
		expect(reads(requests, "/boards/board2/cards")).toBe(1);
		expect(result.markdown).toContain("Second › Todo");
		expect(result.markdown).toContain("Default board › Ideas");
	});

	test("a single-board vault keeps plain list names", async () => {
		const vault = vaultWith();
		const { client } = twoBoards();

		const result = await auditLinks(vault, client, { ...options, boards: [] });

		expect(result.markdown).toContain("Ideas");
		expect(result.markdown).not.toContain("›");
	});

	test("the board filter keeps that board's orphan cards and its phantom notes, still judging phantoms on all boards", async () => {
		const vault = vaultWith();
		const { client, requests } = twoBoards();

		const result = await auditLinks(vault, client, { ...options, onlyBoardId: "board2" });

		expect(result.orphanCards).toBe(1);
		expect(result.markdown).toContain("Orphan B");
		expect(result.markdown).not.toContain("Orphan A");
		expect(result.phantomNotes).toBe(1);
		expect(reads(requests, "/boards/board/cards")).toBe(1);
	});

	test("a phantom note without a board prefix is attributed to the board of its folder's mapping first", async () => {
		const vault = new FakeVault({ [REPORT]: { content: "" }, "B/ghost.md": { content: '---\ntrello_board_card_id: "gone"\n---\n\nbody' } });
		const scoped = {
			...options,
			mappings: [{ listId: "l2", folder: "B", boardId: "board2" }],
		};

		const onSecond = await auditLinks(vault, twoBoards().client, { ...scoped, onlyBoardId: "board2" });
		const onDefault = await auditLinks(vault, twoBoards().client, { ...scoped, onlyBoardId: "board" });

		expect(onSecond.phantomNotes).toBe(1);
		expect(onDefault.phantomNotes).toBe(0);
	});

	test("the filter on the default board drops the other board's phantom note", async () => {
		const vault = vaultWith();
		const { client } = twoBoards();

		const result = await auditLinks(vault, client, { ...options, onlyBoardId: "board" });

		expect(result.phantomNotes).toBe(0);
		expect(result.orphanCards).toBe(1);
	});
});

describe("auditLocations — several boards", () => {
	test("rows from both boards, list names qualified, filter applied", async () => {
		const vault = new FakeVault({
			[REPORT]: { content: "" },
			"A/a.md": { content: linked("board", "c1") },
			"B/b.md": { content: linked("board2", "d1") },
		});
		const { client } = twoBoards();
		const options = { scope: "", boardId: "board", boards: BOARDS, reportPath: REPORT, timestamp: "t" };

		const all = await auditLocations(vault, client, options);
		expect(all.rows).toBe(2);
		expect(all.markdown).toContain("Second › Todo");

		const only = await auditLocations(vault, twoBoards().client, { ...options, onlyBoardId: "board2" });
		expect(only.rows).toBe(1);
		expect(only.markdown).not.toContain("Alpha");
	});
});

describe("auditChanges — several boards", () => {
	test("one read per board, each with its own cursor, entries merged newest first and named by board", async () => {
		const vault = new FakeVault({ [REPORT]: { content: "" } });
		const { client, requests } = twoBoards();

		const result = await auditChanges(vault, client, {
			boardId: "board",
			since: "old-a",
			extraBoards: [{ id: "board2", name: "Second", since: "old-b" }],
			reportPath: REPORT,
			timestamp: "t",
		});

		expect(result.entries).toBe(2);
		expect(result.cursors).toEqual({ board: "a1", board2: "b1" });
		expect(requests.find((r) => r.url.includes("/boards/board/actions"))?.url).toContain("since=old-a");
		expect(requests.find((r) => r.url.includes("/boards/board2/actions"))?.url).toContain("since=old-b");
		expect(result.markdown.indexOf("Quest B")).toBeLessThan(result.markdown.indexOf("Quest A"));
		expect(result.markdown).toContain("Second › Quest B");
		expect(result.markdown).toContain("Default board › Quest A");
	});

	test("a single board stays as before: no prefix, one cursor", async () => {
		const vault = new FakeVault({ [REPORT]: { content: "" } });
		const { client } = twoBoards();

		const result = await auditChanges(vault, client, { boardId: "board", since: "", reportPath: REPORT, timestamp: "t" });

		expect(result.markdown).toContain("Quest A");
		expect(result.markdown).not.toContain("›");
		expect(result.cursor).toBe("a1");
	});

	test("the HTML export reads every board too", async () => {
		const vault = new FakeVault({});
		const { client, requests } = twoBoards();

		const result = await exportChangesHtml(
			vault,
			client,
			{ boardId: "board", since: "", htmlPath: "out.html", timestamp: "t", extraBoards: [{ id: "board2", name: "Second", since: "" }] },
			async () => null,
		);

		expect(result.entries).toBe(2);
		expect(reads(requests, "/actions")).toBe(2);
		expect(result.html).toContain("Second › Quest B");
	});
});
