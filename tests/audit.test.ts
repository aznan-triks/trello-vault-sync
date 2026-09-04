import { describe, expect, test } from "vitest";
import { auditLinks } from "../src/features/auditLinks";
import { auditLocations } from "../src/features/auditLocations";
import { FakeVault, card, clientFor } from "./fakes";

const linked = (cardId: string) => `---\ntrello_board_card_id: "board;${cardId}"\n---\n\nbody`;

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
		const vault = new FakeVault({ [REPORT]: { content: "My notes" } });
		const { client } = clientFor([card({ id: "c2", name: "Orpheline", idList: "l1" })]);

		await auditLinks(vault, client, {
			scope: "WoT",
			boardId: "board",
			reportPath: REPORT,
			timestamp: "t",
		});

		expect(vault.contentOf(REPORT)).toContain("My notes");
		expect(vault.contentOf(REPORT)).toContain("Orpheline");
	});

	test("keeps the boxes the user had ticked in the previous report", async () => {
		const previous =
			"# 📊 Trello Link Report\n> old\n\n- [x] [Orpheline](https://trello.com/c/c2)\n";
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

	test("does not count a linked note under an excluded folder", async () => {
		const vault = new FakeVault({
			[REPORT]: { content: "" },
			"WoT/lié.md": { content: linked("c1") },
			"WoT/Archive/ancien.md": { content: linked("c2") },
		});
		const { client } = clientFor([
			card({ id: "c1", name: "Lié", idList: "l1" }),
			card({ id: "c2", name: "Ancien", idList: "l1" }),
		]);

		const result = await auditLinks(vault, client, {
			scope: "WoT",
			boardId: "board",
			reportPath: REPORT,
			timestamp: "t",
			excludedFolders: ["WoT/Archive"],
		});

		expect(result.orphanCards).toBe(1);
		expect(result.unlinkedNotes).toBe(1);
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

	test("skips a linked note under an excluded folder", async () => {
		const vault = new FakeVault({
			[REPORT]: { content: "" },
			"WoT/85_Idées/Sagondo.md": { content: linked("c1") },
			"WoT/Archive/Vieux.md": { content: linked("c2") },
		});
		const { client } = clientFor([
			card({ id: "c1", name: "Sagondo", idList: "l1" }),
			card({ id: "c2", name: "Vieux", idList: "l1" }),
		]);

		const result = await auditLocations(vault, client, {
			scope: "WoT",
			boardId: "board",
			reportPath: REPORT,
			timestamp: "t",
			excludedFolders: ["WoT/Archive"],
		});

		expect(result.rows).toBe(1);
	});
});

describe("auditLinks — configuration", () => {
	test("says the report note is not configured rather than naming an empty path", async () => {
		const vault = new FakeVault();
		const { client } = clientFor([]);

		await expect(
			auditLinks(vault, client, { scope: "", boardId: "board", reportPath: "", timestamp: "t" }),
		).rejects.toThrow(/not configured/i);
	});
});

describe("cancellation", () => {
	const options = { scope: "WoT", boardId: "board", reportPath: REPORT, timestamp: "t" };

	test("auditLinks stops classifying notes once the signal is aborted", async () => {
		const vault = new FakeVault({ [REPORT]: { content: "" }, "WoT/a.md": { content: "rien" } });
		const { client } = clientFor([card({ id: "c1", name: "A", idList: "l1" })]);
		const controller = new AbortController();
		controller.abort();

		const result = await auditLinks(vault, client, options, undefined, controller.signal);

		expect(result.unlinkedNotes).toBe(0);
		expect(result.orphanCards).toBe(1); // board-side classification is unaffected, only the note scan is skipped
	});

	test("auditLocations stops comparing folders once the signal is aborted", async () => {
		const vault = new FakeVault({
			[REPORT]: { content: "" },
			"WoT/90_Fins/Sagondo.md": { content: linked("c1") },
		});
		const { client } = clientFor([card({ id: "c1", name: "Sagondo", idList: "l1" })]);
		const controller = new AbortController();
		controller.abort();

		const result = await auditLocations(vault, client, options, undefined, controller.signal);

		expect(result.rows).toBe(0);
		expect(result.misplaced).toBe(0);
	});
});
