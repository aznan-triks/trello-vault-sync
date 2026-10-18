import { describe, expect, test } from "vitest";
import { classifyGoneCards } from "../src/features/goneCards";
import { TrelloClient } from "../src/trello/client";
import { recordingReporter, routedTransport } from "./fakes";

describe("classifyGoneCards", () => {
	test("archived, deleted and alive cards are told apart", async () => {
		const { transport } = routedTransport({
			"/cards/a": { id: "a", closed: true, idList: "l1", idBoard: "board" },
			"/cards/m": { id: "m", closed: false, idList: "l9", idBoard: "other" },
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport, { maxRetries: 0 });

		const states = await classifyGoneCards(client, ["a", "d", "m"]);

		expect(states.get("a")?.state).toBe("archived");
		expect(states.get("d")?.state).toBe("deleted");
		expect(states.get("m")).toEqual({ state: "alive", idList: "l9", idBoard: "other" });
	});

	test("an unexpected error leaves the card out and is logged, not swallowed", async () => {
		const client = new TrelloClient(
			{ apiKey: "k", token: "t" },
			async () => ({ status: 401, text: "nope" }),
			{ maxRetries: 0 },
		);
		const reporter = recordingReporter();

		const states = await classifyGoneCards(client, ["x"], undefined, reporter);

		expect(states.has("x")).toBe(false);
		expect(reporter.logs.some((entry) => entry.level === "warn" && entry.message.includes("left untouched"))).toBe(true);
	});

	test("cards a board fetch already returned cost no request", async () => {
		const { transport, requests } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport, { maxRetries: 0 });

		const states = await classifyGoneCards(client, ["a"], undefined, undefined, new Map([["a", { closed: true, idList: "l1" }]]));

		expect(states.get("a")?.state).toBe("archived");
		expect(requests).toHaveLength(0);
	});
});
