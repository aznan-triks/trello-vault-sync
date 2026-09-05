import { describe, expect, test } from "vitest";
import { exportChangesHtml } from "../src/features/exportChangesHtml";
import { FakeVault, clientFor } from "./fakes";

const HTML_PATH = "WoT/Trello Changes.html";
const options = { boardId: "board", htmlPath: HTML_PATH, timestamp: "t", since: "" };

function fakeFetchBinary(calls: string[], bytes: ArrayBuffer | null = new Uint8Array([1, 2, 3]).buffer) {
	return async (url: string): Promise<ArrayBuffer | null> => {
		calls.push(url);
		return bytes;
	};
}

describe("exportChangesHtml", () => {
	test("writes the HTML page into a new file when it doesn't exist yet", async () => {
		const vault = new FakeVault();
		const { client } = clientFor(
			[],
			[],
			[
				{
					id: "a1",
					type: "createCard",
					date: "2026-09-04T10:00:00.000Z",
					data: { card: { name: "Quest" } },
					memberCreator: { fullName: "Ann", avatarUrl: "https://avatars.example/ann" },
				},
			],
		);

		const result = await exportChangesHtml(vault, client, options, fakeFetchBinary([]));

		expect(result.entries).toBe(1);
		expect(vault.contentOf(HTML_PATH)).toContain("Quest");
		expect(vault.contentOf(HTML_PATH)).toContain("Ann");
		expect(vault.contentOf(HTML_PATH)).toContain("data:image/png;base64,");
	});

	test("overwrites the page when it already exists", async () => {
		const vault = new FakeVault({ [HTML_PATH]: { content: "<html>old</html>" } });
		const { client } = clientFor([], [], []);

		await exportChangesHtml(vault, client, options, fakeFetchBinary([]));

		expect(vault.contentOf(HTML_PATH)).not.toContain("old");
	});

	test("downloads an author's avatar only once, even with several entries", async () => {
		const vault = new FakeVault();
		const { client } = clientFor(
			[],
			[],
			[
				{
					id: "a1",
					type: "createCard",
					date: "2026-09-04T10:00:00.000Z",
					data: { card: { name: "Quest" } },
					memberCreator: { fullName: "Ann", avatarUrl: "https://avatars.example/ann" },
				},
				{
					id: "a2",
					type: "createCard",
					date: "2026-09-04T11:00:00.000Z",
					data: { card: { name: "Other" } },
					memberCreator: { fullName: "Ann", avatarUrl: "https://avatars.example/ann" },
				},
			],
		);
		const calls: string[] = [];

		await exportChangesHtml(vault, client, options, fakeFetchBinary(calls));

		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain("https://avatars.example/ann");
	});

	test("keeps the entry when its avatar fails to download", async () => {
		const vault = new FakeVault();
		const { client } = clientFor(
			[],
			[],
			[
				{
					id: "a1",
					type: "createCard",
					date: "2026-09-04T10:00:00.000Z",
					data: { card: { name: "Quest" } },
					memberCreator: { fullName: "Ann", avatarUrl: "https://avatars.example/ann" },
				},
			],
		);

		const result = await exportChangesHtml(vault, client, options, fakeFetchBinary([], null));

		expect(result.entries).toBe(1);
		expect(vault.contentOf(HTML_PATH)).toContain("Quest");
		expect(vault.contentOf(HTML_PATH)).not.toContain("data:image/png;base64,");
	});

	test("never fetches an avatar for an author with none", async () => {
		const vault = new FakeVault();
		const { client } = clientFor(
			[],
			[],
			[{ id: "a1", type: "createCard", date: "2026-09-04T10:00:00.000Z", data: { card: { name: "Quest" } } }],
		);
		const calls: string[] = [];

		await exportChangesHtml(vault, client, options, fakeFetchBinary(calls));

		expect(calls).toEqual([]);
	});

	test("fails clearly when the output path is not configured", async () => {
		const vault = new FakeVault();
		const { client } = clientFor([], [], []);

		await expect(exportChangesHtml(vault, client, { ...options, htmlPath: "" }, fakeFetchBinary([]))).rejects.toThrow(
			/settings/,
		);
	});
});
