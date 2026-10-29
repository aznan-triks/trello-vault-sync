import { describe, expect, test } from "vitest";
import { fetchBoardIndex, fetchBoardIndexes } from "../src/features/boardIndex";
import { TrelloClient, type HttpRequest, type HttpResponse } from "../src/trello/client";
import { card, routedTransport } from "./fakes";

describe("fetchBoardIndex", () => {
	test("fetches lists and cards together and indexes list names by id", async () => {
		const { transport, requests } = routedTransport({
			"/boards/board/lists": [{ id: "l1", name: "Idées" }],
			"/boards/board/cards": [card({ id: "c1", name: "Sagondo", idList: "l1" })],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const index = await fetchBoardIndex(client, "board");

		expect(index.cards.map((c) => c.id)).toEqual(["c1"]);
		expect(index.listNames.get("l1")).toBe("Idées");
		expect(requests.filter((r) => r.method === "GET")).toHaveLength(2);
	});

	test("makes no request and rejects when the signal is already aborted", async () => {
		// `routedTransport` ignores its signal argument entirely, so it cannot tell an
		// aborted run apart from a normal one — this fake mirrors `TrelloClient.send()`'s
		// real contract instead: the transport itself is what honours the signal (see
		// `src/obsidian/transport.ts`'s `racedAgainst`), rejecting before doing any work.
		const requests: HttpRequest[] = [];
		const transport = async (request: HttpRequest, signal?: AbortSignal): Promise<HttpResponse> => {
			if (signal?.aborted) throw new Error("aborted");
			requests.push(request);
			return { status: 200, text: "[]" };
		};
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const controller = new AbortController();
		controller.abort();

		await expect(fetchBoardIndex(client, "board", controller.signal)).rejects.toThrow();

		expect(requests).toHaveLength(0);
	});
});

describe("fetchBoardIndexes", () => {
	test("merges the boards, one series of reads per board, and remembers each list's board", async () => {
		const { transport, requests } = routedTransport({
			"/boards/b1/lists": [{ id: "l1", name: "Idées" }],
			"/boards/b1/cards": [card({ id: "c1", idBoard: "b1", idList: "l1" })],
			"/boards/b2/lists": [{ id: "l2", name: "Todo" }],
			"/boards/b2/cards": [card({ id: "c2", idBoard: "b2", idList: "l2" })],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const index = await fetchBoardIndexes(client, ["b1", "b2"]);

		expect(index.cards.map((c) => c.id)).toEqual(["c1", "c2"]);
		expect([...index.listNames]).toEqual([["l1", "Idées"], ["l2", "Todo"]]);
		expect(index.listBoards?.get("l2")).toBe("b2");
		expect(requests).toHaveLength(4);
	});
});
