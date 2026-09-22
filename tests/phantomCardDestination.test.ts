import { describe, expect, test } from "vitest";
import {
	findPhantomNoteCandidates,
	resolvePhantomCardDestination,
} from "../src/core/phantomCardDestination";
import type { PlannedNote } from "../src/core/folderPlan";

describe("resolvePhantomCardDestination", () => {
	const mappings = [
		{ folder: "Projects/Work", listId: "list-work" },
		{ folder: "Ideas", listId: "list-ideas" },
	];

	test("returns fallback list when configured and preferFolderMapping is false", () => {
		const dest = resolvePhantomCardDestination("Projects/Work", mappings, "list-inbox", false);
		expect(dest).toEqual({ needsPrompt: false, listId: "list-inbox" });
	});

	test("prefers mapped folder list when preferFolderMapping is true and mapping exists", () => {
		const dest = resolvePhantomCardDestination("Projects/Work", mappings, "list-inbox", true);
		expect(dest).toEqual({ needsPrompt: false, listId: "list-work" });
	});

	test("falls back to fallbackListId when preferFolderMapping is true but folder is unmapped", () => {
		const dest = resolvePhantomCardDestination("Unmapped/Folder", mappings, "list-inbox", true);
		expect(dest).toEqual({ needsPrompt: false, listId: "list-inbox" });
	});

	test("uses mapped folder list when fallbackListId is empty", () => {
		const dest = resolvePhantomCardDestination("Ideas", mappings, "", false);
		expect(dest).toEqual({ needsPrompt: false, listId: "list-ideas" });
	});

	test("returns needsPrompt: true when neither fallbackListId nor folder mapping is available", () => {
		const dest = resolvePhantomCardDestination("Unmapped", mappings, "", false);
		expect(dest).toEqual({ needsPrompt: true });
	});

	test("handles undefined folder gracefully", () => {
		const dest = resolvePhantomCardDestination(undefined, mappings, "list-inbox", false);
		expect(dest).toEqual({ needsPrompt: false, listId: "list-inbox" });

		const destNoFallback = resolvePhantomCardDestination(undefined, mappings, "", false);
		expect(destNoFallback).toEqual({ needsPrompt: true });
	});
});

describe("findPhantomNoteCandidates", () => {
	const aliveCardIds = new Set(["c1", "c2"]);
	const mappedFolders = new Set(["Projects/Work"]);

	const notes: PlannedNote[] = [
		{ path: "note1.md", basename: "note1", folder: "", mtime: 0, cardId: "c1" }, // active linked
		{ path: "note2.md", basename: "note2", folder: "", mtime: 0, cardId: "c-dead" }, // phantom (broken link)
		{ path: "note3.md", basename: "note3", folder: "", mtime: 0, cardId: null }, // unlinked in root
		{ path: "Projects/Work/note4.md", basename: "note4", folder: "Projects/Work", mtime: 0, cardId: null }, // unlinked in mapped
	];

	test("with scope 'all-unlinked', includes broken links (phantom) and all unlinked notes", () => {
		const candidates = findPhantomNoteCandidates(notes, aliveCardIds, "all-unlinked", mappedFolders);
		expect(candidates).toEqual([
			{ note: notes[1], kind: "phantom" },
			{ note: notes[2], kind: "unlinked" },
			{ note: notes[3], kind: "unlinked" },
		]);
	});

	test("with scope 'mapped-folders-only', includes broken links and unlinked notes in mapped folders", () => {
		const candidates = findPhantomNoteCandidates(notes, aliveCardIds, "mapped-folders-only", mappedFolders);
		expect(candidates).toEqual([
			{ note: notes[1], kind: "phantom" },
			{ note: notes[3], kind: "unlinked" },
		]);
	});

	test("with scope 'phantom-only', includes only broken links", () => {
		const candidates = findPhantomNoteCandidates(notes, aliveCardIds, "phantom-only", mappedFolders);
		expect(candidates).toEqual([
			{ note: notes[1], kind: "phantom" },
		]);
	});

	test("handles empty notes or empty aliveCardIds correctly", () => {
		expect(findPhantomNoteCandidates([], aliveCardIds)).toEqual([]);
		expect(findPhantomNoteCandidates(notes, new Set())).toEqual([
			{ note: notes[0], kind: "phantom" }, // c1 is now dead
			{ note: notes[1], kind: "phantom" },
			{ note: notes[2], kind: "unlinked" },
			{ note: notes[3], kind: "unlinked" },
		]);
	});

	test("handles mapped-folders-only when mappedFolders is undefined", () => {
		const candidates = findPhantomNoteCandidates(notes, aliveCardIds, "mapped-folders-only", undefined);
		expect(candidates).toEqual([
			{ note: notes[1], kind: "phantom" },
			{ note: notes[2], kind: "unlinked" },
			{ note: notes[3], kind: "unlinked" },
		]);
	});
});
