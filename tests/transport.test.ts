import { describe, expect, test, vi } from "vitest";

// `src/obsidian/transport.ts` imports `requestUrl` from "obsidian" (type-only
// package under vitest) — same mocking pattern as `tests/noteCommands.test.ts`.
const requestUrlMock = vi.fn();
vi.mock("obsidian", () => ({
	requestUrl: (...args: unknown[]) => requestUrlMock(...args),
}));

import { obsidianDownloadBinary } from "../src/obsidian/transport";

describe("obsidianDownloadBinary", () => {
	test("forwards headers to requestUrl when provided", async () => {
		requestUrlMock.mockResolvedValueOnce({ status: 200, arrayBuffer: new ArrayBuffer(3) });
		await obsidianDownloadBinary("https://trello.com/1/cards/c1/attachments/a1/download/x.jpg", undefined, undefined, {
			Authorization: 'OAuth oauth_consumer_key="k", oauth_token="t"',
		});
		expect(requestUrlMock).toHaveBeenCalledWith(
			expect.objectContaining({
				headers: { Authorization: 'OAuth oauth_consumer_key="k", oauth_token="t"' },
			}),
		);
	});

	test("omits the headers field entirely when none are given (unchanged public-url behavior)", async () => {
		requestUrlMock.mockResolvedValueOnce({ status: 200, arrayBuffer: new ArrayBuffer(3) });
		await obsidianDownloadBinary("https://trello-avatars.example/a.png");
		const call = requestUrlMock.mock.calls.at(-1)?.[0];
		expect(call).not.toHaveProperty("headers");
	});

	test("still resolves null on a non-2xx status, headers or not", async () => {
		requestUrlMock.mockResolvedValueOnce({ status: 401, arrayBuffer: new ArrayBuffer(0) });
		const result = await obsidianDownloadBinary("https://trello.com/x", undefined, undefined, { Authorization: "OAuth x" });
		expect(result).toBeNull();
	});
});
