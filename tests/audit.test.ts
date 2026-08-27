import { describe, expect, test } from "vitest";
import { auditLinks } from "../src/features/auditLinks";
import { auditLocations } from "../src/features/auditLocations";
import { linkActiveNote } from "../src/features/linkNote";
import { TrelloClient } from "../src/trello/client";
import { FakeVault, card, routedTransport } from "./fakes";

const linked = (cardId: string) => `---\ntrello_board_card_id: "board;${cardId}"\n---\n\ncorps`;

function clientFor(cards: unknown[], lists: unknown[] = [{ id: "l1", name: "Idées" }]) {
	const { transport, requests } = routedTransport({
		"/boards/board/cards": cards,
		"/boards/board/lists": lists,
	});
	return { client: new TrelloClient({ apiKey: "k", token: "t" }, transport), requests };
}

const REPORT = "WoT/00_Metatrois/Synchro.md";

describe("auditLinks", () => {
	test("classifies cards without notes, broken links and unlinked notes", async () => {
		const vault = new FakeVault({
			[REPORT]: { content: "" },
			"WoT/lié.md": { content: linked("c1") },
			"WoT/fantôme.md": { content: linked("disparue") },
			"WoT/libre.md": { content: "rien" },
		});
		const { client } = clientFor([
			card({ id: "c1", name: "Lié", idList: "l1" }),
			card({ id: "c2", name: "Orpheline", idList: "l1" }),
		]);

		const result = await auditLinks(vault, client, {
			scope: "WoT",
			boardId: "board",
			reportPath: REPORT,
			timestamp: "27/08/2026 20:00",
		});

		expect(result.orphanCards).toBe(1);
		expect(result.phantomNotes).toBe(1);
		// The report note itself has no card id either.
		expect(result.unlinkedNotes).toBe(2);
	});

	test("writes the report into the configured note", async () => {
		const vault = new FakeVault({ [REPORT]: { content: "Mes notes" } });
		const { client } = clientFor([card({ id: "c2", name: "Orpheline", idList: "l1" })]);

		await auditLinks(vault, client, {
			scope: "WoT",
			boardId: "board",
			reportPath: REPORT,
			timestamp: "t",
		});

		expect(vault.contentOf(REPORT)).toContain("Mes notes");
		expect(vault.contentOf(REPORT)).toContain("Orpheline");
	});

	test("keeps the boxes the user had ticked in the previous report", async () => {
		const previous =
			"# 📊 Rapport de liens Trello\n> ancien\n\n- [x] [Orpheline](https://trello.com/c/c2)\n";
		const vault = new FakeVault({ [REPORT]: { content: previous } });
		const { client } = clientFor([card({ id: "c2", name: "Orpheline", idList: "l1" })]);

		await auditLinks(vault, client, {
			scope: "WoT",
			boardId: "board",
			reportPath: REPORT,
			timestamp: "t",
		});

		expect(vault.contentOf(REPORT)).toContain("- [x] [Orpheline](https://trello.com/c/c2)");
	});

	test("ignores an archived card when listing orphans", async () => {
		const vault = new FakeVault({ [REPORT]: { content: "" } });
		const { client } = clientFor([card({ id: "c2", name: "Archivée", idList: "l1", closed: true })]);

		const result = await auditLinks(vault, client, {
			scope: "WoT",
			boardId: "board",
			reportPath: REPORT,
			timestamp: "t",
		});

		expect(result.orphanCards).toBe(0);
	});

	test("fails clearly when the report note does not exist", async () => {
		const vault = new FakeVault();
		const { client } = clientFor([]);

		await expect(
			auditLinks(vault, client, {
				scope: "WoT",
				boardId: "board",
				reportPath: "absent.md",
				timestamp: "t",
			}),
		).rejects.toThrow(/absent\.md/);
	});
});

describe("auditLocations", () => {
	test("tabulates where each linked card's note actually lives", async () => {
		const vault = new FakeVault({
			[REPORT]: { content: "" },
			"WoT/85_Idées/Sagondo.md": { content: linked("c1") },
		});
		const { client } = clientFor([card({ id: "c1", name: "Sagondo", idList: "l1" })]);

		const result = await auditLocations(vault, client, {
			scope: "WoT",
			boardId: "board",
			reportPath: REPORT,
			timestamp: "t",
		});

		expect(result.rows).toBe(1);
		expect(vault.contentOf(REPORT)).toContain("| Sagondo | 📂 WoT/85_Idées |");
	});

	test("counts a note whose folder does not echo its Trello list as misplaced", async () => {
		const vault = new FakeVault({
			[REPORT]: { content: "" },
			"WoT/90_Fins/Sagondo.md": { content: linked("c1") },
		});
		const { client } = clientFor([card({ id: "c1", name: "Sagondo", idList: "l1" })]);

		const result = await auditLocations(vault, client, {
			scope: "WoT",
			boardId: "board",
			reportPath: REPORT,
			timestamp: "t",
		});

		expect(result.misplaced).toBe(1);
	});
});

describe("linkActiveNote", () => {
	const cards = [card({ id: "c1", name: "Sagondo" }), card({ id: "c2", name: "Le monde" })];

	test("writes the frontmatter id of the closest matching card", async () => {
		const vault = new FakeVault({ "WoT/Sagondo.md": { content: "---\ntype: idée\n---\n\ncorps" } });
		const { client } = clientFor(cards);

		const result = await linkActiveNote(vault, client, vault.note("WoT/Sagondo.md"), {
			boardId: "board",
			threshold: 0.45,
		});

		expect(result.linked).toBe(true);
		expect(vault.contentOf("WoT/Sagondo.md")).toContain('trello_board_card_id: "board;c1"');
	});

	test("refuses to link when no card is close enough", async () => {
		const vault = new FakeVault({ "WoT/zzzzzz.md": { content: "corps" } });
		const { client } = clientFor(cards);

		const result = await linkActiveNote(vault, client, vault.note("WoT/zzzzzz.md"), {
			boardId: "board",
			threshold: 0.9,
		});

		expect(result.linked).toBe(false);
		expect(vault.contentOf("WoT/zzzzzz.md")).toBe("corps");
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

describe("auditLinks — configuration", () => {
	test("says the report note is not configured rather than naming an empty path", async () => {
		const vault = new FakeVault();
		const { client } = clientFor([]);

		await expect(
			auditLinks(vault, client, { scope: "", boardId: "board", reportPath: "", timestamp: "t" }),
		).rejects.toThrow(/pas configurée/i);
	});
});
