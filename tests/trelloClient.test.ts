import { describe, expect, test, vi } from "vitest";
import {
	TrelloClient,
	TrelloError,
	type HttpRequest,
	type HttpResponse,
} from "../src/trello/client";

const CREDENTIALS = { apiKey: "KEY123", token: "TOKEN456" };

function stubTransport(responses: HttpResponse[]) {
	const calls: HttpRequest[] = [];
	const queue = [...responses];
	const transport = async (req: HttpRequest): Promise<HttpResponse> => {
		calls.push(req);
		return queue.shift() ?? { status: 200, text: "{}" };
	};
	return { transport, calls };
}

function client(responses: HttpResponse[], maxRetries = 2) {
	const { transport, calls } = stubTransport(responses);
	const sleep = vi.fn(async () => {});
	return {
		calls,
		sleep,
		api: new TrelloClient(CREDENTIALS, transport, { maxRetries, baseDelayMs: 10, sleep }),
	};
}

const ok = (body: unknown): HttpResponse => ({ status: 200, text: JSON.stringify(body) });

describe("TrelloClient credentials", () => {
	test("sends the key and token of the single configured account", async () => {
		const { api, calls } = client([ok({ id: "c1", name: "A", desc: "" })]);
		await api.getCard("c1");
		expect(calls[0]?.url).toContain("key=KEY123");
		expect(calls[0]?.url).toContain("token=TOKEN456");
	});

	test("refuses to call the API when the key or token is blank", async () => {
		const { transport } = stubTransport([]);
		const api = new TrelloClient({ apiKey: "", token: "T" }, transport);
		await expect(api.getCard("c1")).rejects.toThrow(/credentials/i);
	});

	test("keeps the token out of the error message on failure", async () => {
		const { api } = client([{ status: 401, text: "invalid token TOKEN456 for key KEY123" }]);
		await expect(api.getCard("c1")).rejects.toThrow(
			expect.objectContaining({ message: expect.not.stringContaining("TOKEN456") }) as Error,
		);
	});
});

describe("TrelloClient requests", () => {
	test("parses a card into the shape the sync layer expects", async () => {
		const { api } = client([
			ok({ id: "c1", idBoard: "b1", name: "Sagondo", desc: "d", url: "u", dateLastActivity: "t" }),
		]);
		await expect(api.getCard("c1")).resolves.toEqual({
			id: "c1",
			idBoard: "b1",
			name: "Sagondo",
			desc: "d",
			url: "u",
			dateLastActivity: "t",
		});
	});

	test("sends a card update as a url-encoded PUT", async () => {
		const { api, calls } = client([ok({})]);
		await api.updateCard("c1", { name: "Titre", desc: "Corps & suite" });
		expect(calls[0]?.method).toBe("PUT");
		expect(calls[0]?.contentType).toBe("application/x-www-form-urlencoded");
		expect(calls[0]?.body).toBe("name=Titre&desc=Corps+%26+suite");
	});

	test("skips the request entirely when there is no field to update", async () => {
		const { api, calls } = client([]);
		await api.updateCard("c1", {});
		expect(calls).toHaveLength(0);
	});

	test("asks the board endpoint for every card in one call", async () => {
		const { api, calls } = client([ok([{ id: "c1", name: "A" }, { id: "c2", name: "B" }])]);
		const cards = await api.getBoardCards("b1");
		expect(cards).toHaveLength(2);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toContain("/boards/b1/cards");
	});

	test("defaults the board endpoint to visible (non-archived) cards only", async () => {
		const { api, calls } = client([ok([])]);
		await api.getBoardCards("b1");
		expect(calls[0]?.url).toContain("filter=visible");
	});

	test("can ask the board endpoint to include archived cards", async () => {
		const { api, calls } = client([ok([])]);
		await api.getBoardCards("b1", "all");
		expect(calls[0]?.url).toContain("filter=all");
	});

	test("reads a list's cards from the list endpoint", async () => {
		const { api, calls } = client([ok([])]);
		await api.getListCards("l1");
		expect(calls[0]?.url).toContain("/lists/l1/cards");
	});
});

describe("TrelloClient rate limiting", () => {
	test("retries a 429 and returns the eventual success", async () => {
		const { api, calls, sleep } = client([
			{ status: 429, text: "rate limit" },
			ok({ id: "c1", name: "A" }),
		]);
		await expect(api.getCard("c1")).resolves.toMatchObject({ id: "c1" });
		expect(calls).toHaveLength(2);
		expect(sleep).toHaveBeenCalledTimes(1);
	});

	test("backs off for longer on each successive retry", async () => {
		const { api, sleep } = client([
			{ status: 429, text: "" },
			{ status: 429, text: "" },
			ok({ id: "c1" }),
		]);
		await api.getCard("c1");
		const delays = (sleep.mock.calls as unknown as number[][]).map((call) => call[0] as number);
		expect(delays).toHaveLength(2);
		expect(delays[1]).toBeGreaterThan(delays[0] as number);
	});

	test("gives up after the retry budget and reports the status", async () => {
		const { api, calls } = client([
			{ status: 429, text: "" },
			{ status: 429, text: "" },
			{ status: 429, text: "" },
		]);
		await expect(api.getCard("c1")).rejects.toMatchObject({ status: 429, retryable: true });
		expect(calls).toHaveLength(3);
	});

	test("retries a 503 the same way as a 429", async () => {
		const { api, calls } = client([{ status: 503, text: "" }, ok({ id: "c1" })]);
		await api.getCard("c1");
		expect(calls).toHaveLength(2);
	});

	test("does not retry a 404, which will never succeed", async () => {
		const { api, calls } = client([{ status: 404, text: "not found" }]);
		await expect(api.getCard("c1")).rejects.toMatchObject({ status: 404, retryable: false });
		expect(calls).toHaveLength(1);
	});

	test("raises a TrelloError when the payload is not valid JSON", async () => {
		const { api } = client([{ status: 200, text: "<html>nope</html>" }]);
		await expect(api.getCard("c1")).rejects.toBeInstanceOf(TrelloError);
	});
});

describe("TrelloClient backoff correctness", () => {
	test("caps the computed delay instead of growing unbounded", async () => {
		const { transport } = stubTransport([{ status: 429, text: "" }, ok({ id: "c1" })]);
		const sleep = vi.fn(async () => {});
		const api = new TrelloClient(CREDENTIALS, transport, {
			maxRetries: 1,
			baseDelayMs: 60_000,
			sleep,
		});
		await api.getCard("c1");
		expect(sleep).toHaveBeenCalledTimes(1);
		const delays = (sleep.mock.calls as unknown as number[][]).map((call) => call[0] as number);
		expect(delays[0]).toBeLessThanOrEqual(30_000);
	});

	test("retries a transport-level failure instead of throwing on the first attempt", async () => {
		let calls = 0;
		const flaky = async (): Promise<HttpResponse> => {
			calls++;
			if (calls < 2) throw new Error("network blip");
			return ok({ id: "c1" });
		};
		const sleep = vi.fn(async () => {});
		const api = new TrelloClient(CREDENTIALS, flaky, { maxRetries: 2, baseDelayMs: 10, sleep });
		await expect(api.getCard("c1")).resolves.toMatchObject({ id: "c1" });
		expect(calls).toBe(2);
		expect(sleep).toHaveBeenCalledTimes(1);
	});

	test("still throws when a transport failure never recovers", async () => {
		const dead = async (): Promise<HttpResponse> => {
			throw new Error("offline");
		};
		const api = new TrelloClient(CREDENTIALS, dead, { maxRetries: 1, baseDelayMs: 10 });
		await expect(api.getCard("c1")).rejects.toMatchObject({ status: 0 });
	});

	test("honors a Retry-After header instead of the exponential formula", async () => {
		const { transport } = stubTransport([
			{ status: 429, text: "", headers: { "retry-after": "2" } },
			ok({ id: "c1" }),
		]);
		const sleep = vi.fn(async () => {});
		const api = new TrelloClient(CREDENTIALS, transport, { maxRetries: 1, baseDelayMs: 10, sleep });
		await api.getCard("c1");
		expect(sleep).toHaveBeenCalledWith(2000);
	});

	test("reports each retry through onRetry before sleeping", async () => {
		const { transport } = stubTransport([{ status: 429, text: "" }, ok({ id: "c1" })]);
		const order: string[] = [];
		const sleep = vi.fn(async () => {
			order.push("sleep");
		});
		const onRetry = vi.fn(() => {
			order.push("onRetry");
		});
		const api = new TrelloClient(CREDENTIALS, transport, {
			maxRetries: 1,
			baseDelayMs: 10,
			sleep,
			onRetry,
		});
		await api.getCard("c1");
		expect(onRetry).toHaveBeenCalledWith({ attempt: 2, maxAttempts: 2, delayMs: 10, status: 429 });
		expect(order).toEqual(["onRetry", "sleep"]);
	});
});

describe("TrelloClient secret leaks", () => {
	test("keeps the credentials out of an error thrown by the transport itself", async () => {
		const leaking = async (request: { url: string }) => {
			throw new Error(`network failure calling ${request.url}`);
		};
		const api = new TrelloClient(CREDENTIALS, leaking as never, { maxRetries: 0 });

		const error = (await api.getCard("c1").catch((e: unknown) => e)) as Error;

		expect(error.message).not.toContain("TOKEN456");
		expect(error.message).not.toContain("KEY123");
		expect(error.message).toContain("«masked»");
	});
});
