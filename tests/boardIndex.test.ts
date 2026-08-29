import { describe, expect, test } from "vitest";
import { fetchBoardIndex } from "../src/features/boardIndex";
import { TrelloClient } from "../src/trello/client";
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
});
