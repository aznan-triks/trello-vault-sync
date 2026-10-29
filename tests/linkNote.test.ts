import { describe, expect, test } from "vitest";
import { linkActiveNote, linkNoteToCard } from "../src/features/linkNote";
import { FakeVault, card, clientFor } from "./fakes";

const linked = (cardId: string) => `---\ntrello_board_card_id: "board;${cardId}"\n---\n\nbody`;

describe("linkActiveNote", () => {
	const cards = [card({ id: "c1", name: "Sagondo" }), card({ id: "c2", name: "Le monde" })];

	test("writes the frontmatter id of the closest matching card", async () => {
		const vault = new FakeVault({ "WoT/Sagondo.md": { content: "---\ntype: idée\n---\n\nbody" } });
		const { client } = clientFor(cards);

		const result = await linkActiveNote(vault, client, vault.note("WoT/Sagondo.md"), {
			boardIds: ["board"],
			threshold: 0.45,
		});

		expect(result.linked).toBe(true);
		expect(vault.contentOf("WoT/Sagondo.md")).toContain('trello_board_card_id: "board;c1"');
	});

	test("refuses to link when no card is close enough", async () => {
		const vault = new FakeVault({ "WoT/zzzzzz.md": { content: "body" } });
		const { client } = clientFor(cards);

		const result = await linkActiveNote(vault, client, vault.note("WoT/zzzzzz.md"), {
			boardIds: ["board"],
			threshold: 0.9,
		});

		expect(result.linked).toBe(false);
		expect(vault.contentOf("WoT/zzzzzz.md")).toBe("body");
	});

	test("refuses to relink a note that already carries a card id", async () => {
		const vault = new FakeVault({ "WoT/Sagondo.md": { content: linked("existant") } });
		const { client } = clientFor(cards);

		const result = await linkActiveNote(vault, client, vault.note("WoT/Sagondo.md"), {
			boardIds: ["board"],
			threshold: 0.45,
		});

		expect(result).toMatchObject({ linked: false, reason: "already-linked" });
		expect(vault.contentOf("WoT/Sagondo.md")).toContain("existant");
	});
});

describe("linkNoteToCard", () => {
	test("writes the frontmatter id of the picked card", async () => {
		const vault = new FakeVault({ "WoT/Sagondo.md": { content: "---\ntype: idée\n---\n\nbody" } });
		const picked = card({ id: "c9", idBoard: "board9", name: "Sagondo" });

		await linkNoteToCard(vault, vault.note("WoT/Sagondo.md"), picked);

		expect(vault.contentOf("WoT/Sagondo.md")).toContain('trello_board_card_id: "board9;c9"');
	});

	test("adds the key cleanly to a note with no frontmatter at all", async () => {
		const vault = new FakeVault({ "WoT/Sagondo.md": { content: "just a body, no frontmatter" } });
		const picked = card({ id: "c9", idBoard: "board9", name: "Sagondo" });

		await linkNoteToCard(vault, vault.note("WoT/Sagondo.md"), picked);

		expect(vault.contentOf("WoT/Sagondo.md")).toBe(
			'---\ntrello_board_card_id: "board9;c9"\n---\n\njust a body, no frontmatter',
		);
	});

	test("overwrites an existing link — a manual pick always wins", async () => {
		const vault = new FakeVault({ "WoT/Sagondo.md": { content: linked("old") } });
		const picked = card({ id: "c9", idBoard: "board9", name: "Sagondo" });

		await linkNoteToCard(vault, vault.note("WoT/Sagondo.md"), picked);

		expect(vault.contentOf("WoT/Sagondo.md")).toContain('trello_board_card_id: "board9;c9"');
	});
});

describe("linkActiveNote — several boards", () => {
	test("looks for the closest card on every board it is given, and writes the board of the card it found", async () => {
		const { routedTransport } = await import("./fakes");
		const { TrelloClient } = await import("../src/trello/client");
		const { transport, requests } = routedTransport({
			"/boards/b1/cards": [card({ id: "c1", idBoard: "b1", name: "Other thing" })],
			"/boards/b2/cards": [card({ id: "c2", idBoard: "b2", name: "Sagondo" })],
		});
		const vault = new FakeVault({ "WoT/Sagondo.md": { content: "body" } });

		const result = await linkActiveNote(vault, new TrelloClient({ apiKey: "k", token: "t" }, transport), vault.note("WoT/Sagondo.md"), {
			boardIds: ["b1", "b2"],
			threshold: 0.45,
		});

		expect(result.linked).toBe(true);
		expect(vault.getCardRef(vault.note("WoT/Sagondo.md"))).toEqual({ boardId: "b2", cardId: "c2" });
		expect(requests).toHaveLength(2);
	});
});
