import { describe, expect, test } from "vitest";
import { createNoteFromCard, newNoteContentFromCard, unlinkedCards } from "../src/features/createNoteFromCard";
import { card } from "./fakes";
import { FakeVault } from "./fakes";

describe("newNoteContentFromCard", () => {
	test("renders the mapping's template when one is given", () => {
		const template = "---\ntrello_board_card_id: \"{{BOARD_ID}};{{CARD_ID}}\"\n---\n\n# {{TITLE}}\n\n{{DESCRIPTION}}";
		const content = newNoteContentFromCard(
			card({ id: "c1", idBoard: "b1", name: "Sagondo", desc: "a description", url: "https://trello.com/c/c1" }),
			template,
			"trello_board_card_id",
		);
		expect(content).toContain("# Sagondo");
		expect(content).toContain("a description");
		expect(content).toContain('"b1;c1"');
	});

	test("falls back to a bare frontmatter + description when there is no template", () => {
		const content = newNoteContentFromCard(card({ id: "c1", idBoard: "b1", name: "Sagondo", desc: "text" }), null, "card_link");
		expect(content).toBe('---\ncard_link: "b1;c1"\n---\n\ntext');
	});
});

describe("unlinkedCards", () => {
	test("excludes a card already claimed by a note in the vault", () => {
		const cards = [card({ id: "c1", name: "a" }), card({ id: "c2", name: "b" }), card({ id: "c3", name: "c" })];
		const linked = new Set(["c2"]);
		expect(unlinkedCards(cards, linked).map((c) => c.id)).toEqual(["c1", "c3"]);
	});

	test("keeps every card when none are linked", () => {
		const cards = [card({ id: "c1", name: "a" })];
		expect(unlinkedCards(cards, new Set())).toEqual(cards);
	});
});

describe("createNoteFromCard", () => {
	test("creates the note under the given folder, linked via the configured (not default) frontmatter key", async () => {
		const vault = new FakeVault();
		const note = await createNoteFromCard(vault, card({ id: "c1", idBoard: "b1", name: "Sagondo" }), "WoT/85_Idées", null, "ma_carte");

		expect(note.path).toBe("WoT/85_Idées/Sagondo.md");
		expect(vault.readFrontmatter(note)?.ma_carte).toBe("b1;c1");
	});

	test("never overwrites an existing note — adds a numbered suffix instead", async () => {
		const vault = new FakeVault({ "WoT/85_Idées/Sagondo.md": { content: "already here" } });
		const note = await createNoteFromCard(vault, card({ id: "c1", idBoard: "b1", name: "Sagondo" }), "WoT/85_Idées", null, "trello_board_card_id");

		expect(note.path).toBe("WoT/85_Idées/Sagondo (2).md");
		expect(vault.contentOf("WoT/85_Idées/Sagondo.md")).toBe("already here");
	});

	test("sanitizes a card title with forbidden characters, staying inside the target folder", async () => {
		const vault = new FakeVault();
		const note = await createNoteFromCard(
			vault,
			card({ id: "c1", idBoard: "b1", name: "Idée: Sagondo/Origines" }),
			"WoT/85_Idées",
			null,
			"trello_board_card_id",
		);

		expect(note.folder).toBe("WoT/85_Idées");
		expect(note.path.startsWith("WoT/85_Idées/")).toBe(true);
		expect(note.path).not.toContain("//");
	});
});
