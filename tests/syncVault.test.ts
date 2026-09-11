import { describe, expect, test } from "vitest";
import { DEFAULT_LINKED_CARDS_KEY } from "../src/core/attachmentRef";
import { syncVault } from "../src/features/syncVault";
import { silentReporter } from "../src/obsidian/gateway";
import { TrelloClient } from "../src/trello/client";
import { FakeVault, at, card, routedTransport } from "./fakes";

const linked = (cardId: string, body: string) =>
	`---\ntrello_board_card_id: "board;${cardId}"\n---\n\n${body}`;

const options = {
	policy: "newer-wins" as const,
	marginMs: 0,
	syncTitle: true,
	dryRun: false,
	// Off by default in this shared fixture — attachments/checklists syncing is covered on
	// its own in syncNote.test.ts, and its extra Trello request per note would break the
	// request-count assertions here that are about syncVault's own board-fetch batching.
	syncAttachments: false,
	syncChecklists: false,
};

function clientFor(cards: unknown[]) {
	const { transport, requests } = routedTransport({ "/boards/board/cards": cards });
	return { client: new TrelloClient({ apiKey: "k", token: "t" }, transport), requests };
}

describe("syncVault", () => {
	test("fetches the whole board once instead of one call per note", async () => {
		const vault = new FakeVault({
			"WoT/a.md": { content: linked("c1", "same"), mtime: at("2026-01-01") },
			"WoT/b.md": { content: linked("c2", "same"), mtime: at("2026-01-01") },
			"WoT/c.md": { content: linked("c3", "same"), mtime: at("2026-01-01") },
		});
		const { client, requests } = clientFor([
			card({ id: "c1", name: "a", desc: "same" }),
			card({ id: "c2", name: "b", desc: "same" }),
			card({ id: "c3", name: "c", desc: "same" }),
		]);

		const stats = await syncVault(vault, client, { scope: "WoT", boardId: "board" }, options);

		expect(requests.filter((r) => r.method === "GET")).toHaveLength(1);
		expect(stats.skipped).toBe(3);
	});

	test("pulls the notes whose card moved ahead", async () => {
		const vault = new FakeVault({
			"WoT/a.md": { content: linked("c1", "old"), mtime: at("2026-01-01") },
		});
		const { client } = clientFor([
			card({ id: "c1", name: "a", desc: "new", dateLastActivity: "2026-02-01" }),
		]);

		const stats = await syncVault(vault, client, { scope: "WoT", boardId: "board" }, options);

		expect(stats.pulled).toBe(1);
		expect(vault.contentOf("WoT/a.md")).toContain("new");
	});

	test("counts a note pointing at a missing card as a phantom, and changes nothing", async () => {
		const vault = new FakeVault({ "WoT/a.md": { content: linked("gone", "x") } });
		const { client } = clientFor([]);

		const stats = await syncVault(vault, client, { scope: "WoT", boardId: "board" }, options);

		expect(stats.phantoms).toBe(1);
		expect(vault.contentOf("WoT/a.md")).toContain("x");
	});

	test("ignores notes with no card id and notes with an unfilled placeholder", async () => {
		const vault = new FakeVault({
			"WoT/plain.md": { content: "no frontmatter" },
			"WoT/tpl.md": { content: '---\ntrello_board_card_id: "{{BOARD_ID}};{{CARD_ID}}"\n---\n' },
		});
		const { client } = clientFor([]);

		const stats = await syncVault(vault, client, { scope: "WoT", boardId: "board" }, options);

		expect(stats).toMatchObject({ phantoms: 0, pulled: 0, pushed: 0, skipped: 0 });
		expect(stats.unlinked).toBe(2);
	});

	test("restricts itself to the requested folder", async () => {
		const vault = new FakeVault({
			"WoT/in.md": { content: linked("c1", "same"), mtime: at("2026-01-01") },
			"Autre/out.md": { content: linked("c2", "same"), mtime: at("2026-01-01") },
		});
		const { client } = clientFor([
			card({ id: "c1", name: "in", desc: "same" }),
			card({ id: "c2", name: "out", desc: "same" }),
		]);

		const stats = await syncVault(vault, client, { scope: "WoT", boardId: "board" }, options);

		expect(stats.skipped).toBe(1);
	});

	test("ignores a linked note under an excluded folder", async () => {
		const vault = new FakeVault({
			"WoT/in.md": { content: linked("c1", "same"), mtime: at("2026-01-01") },
			"WoT/Archive/out.md": { content: linked("c2", "same"), mtime: at("2026-01-01") },
		});
		const { client } = clientFor([
			card({ id: "c1", name: "in", desc: "same" }),
			card({ id: "c2", name: "out", desc: "same" }),
		]);

		const stats = await syncVault(
			vault,
			client,
			{ scope: "WoT", boardId: "board", excludedFolders: ["WoT/Archive"] },
			options,
		);

		expect(stats.skipped).toBe(1);
		expect(stats.unlinked).toBe(0);
	});

	test("keeps going after a failing note and reports the error count", async () => {
		const vault = new FakeVault({
			"WoT/a.md": { content: linked("c1", "local"), mtime: at("2026-03-01") },
			"WoT/b.md": { content: linked("c2", "local"), mtime: at("2026-03-01") },
		});
		const { transport } = routedTransport({
			"/boards/board/cards": [
				card({ id: "c1", name: "a", desc: "r", dateLastActivity: "2026-01-01" }),
				card({ id: "c2", name: "b", desc: "r", dateLastActivity: "2026-01-01" }),
			],
		});
		const failing = async (request: Parameters<typeof transport>[0]) =>
			request.method === "PUT" && request.url.includes("c1")
				? { status: 400, text: "nope" }
				: transport(request);
		const client = new TrelloClient({ apiKey: "k", token: "t" }, failing);

		const stats = await syncVault(vault, client, { scope: "WoT", boardId: "board" }, options);

		expect(stats.errors).toBe(1);
		expect(stats.pushed).toBe(1);
	});

	test("stops before touching any note once the signal is aborted", async () => {
		const vault = new FakeVault({
			"WoT/a.md": { content: linked("c1", "old"), mtime: at("2026-01-01") },
		});
		const { client } = clientFor([card({ id: "c1", name: "a", desc: "new", dateLastActivity: "2026-02-01" })]);
		const controller = new AbortController();
		controller.abort();

		const stats = await syncVault(
			vault,
			client,
			{ scope: "WoT", boardId: "board" },
			options,
			silentReporter,
			controller.signal,
		);

		expect(stats.pulled).toBe(0);
		expect(vault.contentOf("WoT/a.md")).toContain("old");
	});
});

describe("syncVault — attachments", () => {
	test("resolves a card-link attachment to a note outside the synced scope", async () => {
		// The note's basename ("Sortie") deliberately differs from the Trello card's own
		// name ("out", used by the attachment/placeholder) — if the card index were built
		// only from the synced scope ("WoT"), this note (under "Autre") would be missing
		// from it, and the placeholder fallback ("[[out]]") would be indistinguishable
		// from a correctly resolved wikilink of the same name.
		const vault = new FakeVault({
			"WoT/in.md": { content: linked("c1", "same"), mtime: at("2026-01-01") },
			"Autre/Sortie.md": { content: linked("c2", "same"), mtime: at("2026-01-01") },
		});
		const { transport } = routedTransport({
			"/boards/board/cards": [card({ id: "c1", name: "in", desc: "same" })],
			"/cards/c1/attachments": [
				{ id: "a1", name: "out", url: "https://trello.com/c/AbC1/2-out", isUpload: false },
			],
			"/cards/AbC1": { id: "c2", idBoard: "board", name: "out" },
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		await syncVault(vault, client, { scope: "WoT", boardId: "board" }, { ...options, syncAttachments: true });

		expect(vault.readFrontmatter(vault.note("WoT/in.md"))?.[DEFAULT_LINKED_CARDS_KEY]).toEqual(["[[Sortie]]"]);
	});
});
