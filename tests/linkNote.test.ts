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
			boardId: "board",
			threshold: 0.45,
		});

		expect(result.linked).toBe(true);
		expect(vault.contentOf("WoT/Sagondo.md")).toContain('trello_board_card_id: "board;c1"');
	});

	test("refuses to link when no card is close enough", async () => {
		const vault = new FakeVault({ "WoT/zzzzzz.md": { content: "body" } });
		const { client } = clientFor(cards);

		const result = await linkActiveNote(vault, client, vault.note("WoT/zzzzzz.md"), {
			boardId: "board",
			threshold: 0.9,
		});

		expect(result.linked).toBe(false);
		expect(vault.contentOf("WoT/zzzzzz.md")).toBe("body");
	});

	test("refuses to relink a note that already carries a card id", async () => {
		const vault = new FakeVault({ "WoT/Sagondo.md": { content: linked("existant") } });
		const { client } = clientFor(cards);

		const result = await linkActiveNote(vault, client, vault.note("WoT/Sagondo.md"), {
			boardId: "board",
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
