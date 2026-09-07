import { describe, expect, test } from "vitest";
import { planFolderMatch, type PlannedCard, type PlannedNote } from "../src/core/folderPlan";

const card = (id: string, name: string): PlannedCard => ({
	id,
	idBoard: "board",
	name,
	desc: "",
	url: `https://trello.com/c/${id}`,
	dateLastActivity: "2026-08-01T00:00:00.000Z",
	due: null,
});

const note = (path: string, cardId: string | null): PlannedNote => ({
	path,
	basename: path.split("/").pop()!.replace(/\.md$/, ""),
	folder: path.split("/").slice(0, -1).join("/"),
	mtime: 0,
	cardId,
});

const FOLDER = "WoT/85_Idées";

describe("planFolderMatch", () => {
	test("pairs a note with the card its frontmatter points at", () => {
		const plan = planFolderMatch([card("c1", "Sagondo")], [note(`${FOLDER}/Sagondo.md`, "c1")], FOLDER);
		expect(plan.pairs).toHaveLength(1);
		expect(plan.pairs[0]).toMatchObject({ adopted: false });
		expect(plan.missingCards).toEqual([]);
	});

	test("keeps the pairing when the card was renamed elsewhere", () => {
		const plan = planFolderMatch([card("c1", "Sagondo v2")], [note(`${FOLDER}/Sagondo.md`, "c1")], FOLDER);
		expect(plan.pairs[0]).toMatchObject({ adopted: false, note: { path: `${FOLDER}/Sagondo.md` } });
	});

	test("adopts an unlinked note whose file name already matches the card", () => {
		const plan = planFolderMatch([card("c1", "Sagondo")], [note(`${FOLDER}/Sagondo.md`, null)], FOLDER);
		expect(plan.pairs[0]).toMatchObject({ adopted: true });
		expect(plan.unlinkedNotes).toEqual([]);
	});

	test("does not adopt a note that already belongs to another card", () => {
		const plan = planFolderMatch(
			[card("c1", "Sagondo"), card("c2", "Sagondo")],
			[note(`${FOLDER}/Sagondo.md`, "c1")],
			FOLDER,
		);
		expect(plan.pairs).toHaveLength(1);
		expect(plan.missingCards.map((c) => c.id)).toEqual(["c2"]);
	});

	test("lists a card with no counterpart as a note to create", () => {
		const plan = planFolderMatch([card("c1", "Nouvelle")], [], FOLDER);
		expect(plan.missingCards.map((c) => c.name)).toEqual(["Nouvelle"]);
	});

	test("lists a note whose card vanished from the list as a phantom", () => {
		const plan = planFolderMatch([], [note(`${FOLDER}/Gone.md`, "c9")], FOLDER);
		expect(plan.phantomNotes.map((n) => n.basename)).toEqual(["Gone"]);
		expect(plan.unlinkedNotes).toEqual([]);
	});

	test("lists a note with no card id as unlinked, never as a phantom", () => {
		const plan = planFolderMatch([], [note(`${FOLDER}/Libre.md`, null)], FOLDER);
		expect(plan.unlinkedNotes.map((n) => n.basename)).toEqual(["Libre"]);
		expect(plan.phantomNotes).toEqual([]);
	});

	test("pairs only the first of two notes claiming the same card and reports the rest", () => {
		const plan = planFolderMatch(
			[card("c1", "Sagondo")],
			[note(`${FOLDER}/b.md`, "c1"), note(`${FOLDER}/a.md`, "c1")],
			FOLDER,
		);
		expect(plan.pairs).toHaveLength(1);
		expect(plan.pairs[0]?.note.basename).toBe("a");
		expect(plan.duplicateNotes.map((n) => n.basename)).toEqual(["b"]);
	});

	test("preserves the incoming card order so runs are reproducible", () => {
		const plan = planFolderMatch([card("c2", "B"), card("c1", "A")], [], FOLDER);
		expect(plan.missingCards.map((c) => c.id)).toEqual(["c2", "c1"]);
	});

	test("returns empty buckets for an empty list and an empty folder", () => {
		const plan = planFolderMatch([], [], FOLDER);
		expect(plan).toEqual({
			pairs: [],
			missingCards: [],
			phantomNotes: [],
			unlinkedNotes: [],
			duplicateNotes: [],
		});
	});
});
