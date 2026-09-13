import { describe, expect, test } from "vitest";
import { fetchBoardIndex } from "../src/features/boardIndex";
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
