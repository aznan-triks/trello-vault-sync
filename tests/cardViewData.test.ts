import { describe, expect, test } from "vitest";
import { CardViewData } from "../src/features/cardViewData";
import { TrelloClient } from "../src/trello/client";
import { routedTransport } from "./fakes";

function setup(rules = { cardMs: 60_000, boardMs: 600_000, commentsLimit: 20 }) {
	const { transport, requests } = routedTransport({
		"/cards/c1": { id: "c1", name: "A", actions: [] },
		"/boards/b/lists": [{ id: "l1", name: "Todo" }],
		"/members/me": { id: "m1", fullName: "Me", username: "me" },
	});
	const client = new TrelloClient({ apiKey: "k", token: "t" }, transport, { maxRetries: 0 });
	let now = 1_000;
	const data = new CardViewData(() => client, () => rules, () => now);
	return { data, requests, advance: (ms: number) => (now += ms) };
}

describe("CardViewData", () => {
	test("two displays of a card inside the cache duration make one request", async () => {
		const { data, requests } = setup();
		await data.card("c1", false);
		await data.card("c1", false);
		expect(requests).toHaveLength(1);
	});

	test("refresh, an expired cache and an invalidated card ask Trello again", async () => {
		const { data, requests, advance } = setup();
		await data.card("c1", false);
		await data.card("c1", true);
		expect(requests).toHaveLength(2);
		advance(60_001);
		await data.card("c1", false);
		expect(requests).toHaveLength(3);
		data.invalidate("c1");
		await data.card("c1", false);
		expect(requests).toHaveLength(4);
	});

	test("a cache duration of 0 always reloads", async () => {
		const { data, requests } = setup({ cardMs: 0, boardMs: 0, commentsLimit: 20 });
		await data.card("c1", false);
		await data.card("c1", false);
		expect(requests).toHaveLength(2);
	});

	test("the comments limit is the setting's", async () => {
		const { data, requests } = setup({ cardMs: 0, boardMs: 0, commentsLimit: 7 });
		await data.card("c1", false);
		expect(new URL(requests[0]!.url).searchParams.get("actions_limit")).toBe("7");
	});

	test("board data is fetched on first use only, then reused", async () => {
		const { data, requests } = setup();
		expect(requests).toHaveLength(0);
		await data.lists("b");
		await data.lists("b");
		expect(requests).toHaveLength(1);
	});

	test("a failed board request is not cached", async () => {
		const { data, requests } = setup();
		await expect(data.labels("b")).rejects.toThrow();
		await expect(data.labels("b")).rejects.toThrow();
		expect(requests).toHaveLength(2);
	});

	test("the token's owner is asked once", async () => {
		const { data, requests } = setup();
		expect((await data.whoAmI()).id).toBe("m1");
		await data.whoAmI();
		expect(requests).toHaveLength(1);
	});
});
