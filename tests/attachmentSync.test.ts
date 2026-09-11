import { describe, expect, test } from "vitest";
import { buildCardIndex, resolveAttachments } from "../src/features/attachmentSync";
import { TrelloClient } from "../src/trello/client";
import { FakeVault, routedTransport } from "./fakes";

describe("buildCardIndex", () => {
	test("maps a card id to the note that links to it", () => {
		const vault = new FakeVault({
			"A.md": { content: '---\ntrello_board_card_id: "board;c1"\n---\n\nA' },
			"B.md": { content: '---\ntrello_board_card_id: "board;c2"\n---\n\nB' },
		});
		const index = buildCardIndex(vault, vault.listNotes(""));
		expect(index.get("c1")?.basename).toBe("A");
		expect(index.get("c2")?.basename).toBe("B");
	});

	test("skips a note with no usable card id", () => {
		const vault = new FakeVault({ "A.md": { content: "no frontmatter" } });
		const index = buildCardIndex(vault, vault.listNotes(""));
		expect(index.size).toBe(0);
	});
});

describe("resolveAttachments", () => {
	function clientWithAttachments(attachments: unknown[], extraRoutes: Record<string, unknown> = {}) {
		const { transport } = routedTransport({
			"/cards/c1/attachments": attachments,
			...extraRoutes,
		});
		return new TrelloClient({ apiKey: "k", token: "t" }, transport);
	}

	test("puts a plain url attachment into urls, untouched", async () => {
		const client = clientWithAttachments([
			{ id: "a1", name: "Cahier des charges.pdf", url: "https://example.com/f.pdf", isUpload: true },
		]);
		const result = await resolveAttachments(client, "c1", new Map());
		expect(result).toEqual({ urls: ["https://example.com/f.pdf"], linkedCards: [] });
	});

	test("resolves a card-link attachment to the matching note's wikilink", async () => {
		const client = clientWithAttachments(
			[{ id: "a1", name: "Idée business X", url: "https://trello.com/c/AbC123/9-idee", isUpload: false }],
			{ "/cards/AbC123": { id: "realId", idBoard: "b1", name: "Idée business X" } },
		);
		const cardIndex = new Map([["realId", { path: "Idées/X.md", basename: "X", folder: "Idées", mtime: 0 }]]);
		const result = await resolveAttachments(client, "c1", cardIndex);
		expect(result).toEqual({ urls: [], linkedCards: ["[[X]]"] });
	});

	test("falls back to the card's own name when no note matches", async () => {
		const client = clientWithAttachments(
			[{ id: "a1", name: "Idée business X", url: "https://trello.com/c/AbC123/9-idee", isUpload: false }],
			{ "/cards/AbC123": { id: "realId", idBoard: "b1", name: "Idée business X" } },
		);
		const result = await resolveAttachments(client, "c1", new Map());
		expect(result).toEqual({ urls: [], linkedCards: ["[[Idée business X]]"] });
	});

	test("dedups an exact-duplicate plain url, keeping the first occurrence's order", async () => {
		const client = clientWithAttachments([
			{ id: "a1", name: "spec.pdf", url: "https://example.com/spec.pdf", isUpload: true },
			{ id: "a2", name: "spec (copy).pdf", url: "https://example.com/spec.pdf", isUpload: true },
		]);
		const result = await resolveAttachments(client, "c1", new Map());
		expect(result.urls).toEqual(["https://example.com/spec.pdf"]);
	});

	test("dedups an exact-duplicate resolved wikilink", async () => {
		const client = clientWithAttachments(
			[
				{ id: "a1", name: "Idée business X", url: "https://trello.com/c/AbC123/9-idee", isUpload: false },
				{ id: "a2", name: "Idée business X", url: "https://trello.com/c/AbC123/9-again", isUpload: false },
			],
			{ "/cards/AbC123": { id: "realId", idBoard: "b1", name: "Idée business X" } },
		);
		const result = await resolveAttachments(client, "c1", new Map());
		expect(result.linkedCards).toEqual(["[[Idée business X]]"]);
	});

	test("splits a mix of plain and card-link attachments correctly", async () => {
		const client = clientWithAttachments(
			[
				{ id: "a1", name: "spec.pdf", url: "https://example.com/spec.pdf", isUpload: true },
				{ id: "a2", name: "Idée business X", url: "https://trello.com/c/AbC123/9-idee", isUpload: false },
			],
			{ "/cards/AbC123": { id: "realId", idBoard: "b1", name: "Idée business X" } },
		);
		const result = await resolveAttachments(client, "c1", new Map());
		expect(result.urls).toEqual(["https://example.com/spec.pdf"]);
		expect(result.linkedCards).toEqual(["[[Idée business X]]"]);
	});
});
