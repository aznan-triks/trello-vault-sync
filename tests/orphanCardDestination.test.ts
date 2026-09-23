import { describe, expect, test } from "vitest";
import {
	filterOrphanCardsByScope,
	isUsableDestinationFolder,
	resolveOrphanCardDestination,
} from "../src/core/orphanCardDestination";

describe("resolveOrphanCardDestination", () => {
	const mappings = [{ listId: "l1", folder: "WoT/85_Idées" }];

	test("uses the mapped folder directly when the card's list is mapped", () => {
		expect(resolveOrphanCardDestination("l1", mappings, "")).toEqual({ needsPrompt: false, folder: "WoT/85_Idées" });
	});

	test("uses the configured fallback directly when the list isn't mapped but a fallback is set", () => {
		expect(resolveOrphanCardDestination("l2", mappings, "Inbox")).toEqual({ needsPrompt: false, folder: "Inbox" });
	});

	test("needs a prompt when the list isn't mapped and the fallback is empty", () => {
		expect(resolveOrphanCardDestination("l2", mappings, "")).toEqual({ needsPrompt: true });
	});

	test("needs a prompt when the list isn't mapped and the fallback is only whitespace", () => {
		expect(resolveOrphanCardDestination("l2", mappings, "   ")).toEqual({ needsPrompt: true });
	});

	test("a card with no list at all (idList undefined) behaves like an unmapped list", () => {
		expect(resolveOrphanCardDestination(undefined, mappings, "")).toEqual({ needsPrompt: true });
	});
});

describe("isUsableDestinationFolder", () => {
	test("rejects empty and whitespace-only folders", () => {
		expect(isUsableDestinationFolder("")).toBe(false);
		expect(isUsableDestinationFolder("   ")).toBe(false);
	});

	test("accepts a real folder path", () => {
		expect(isUsableDestinationFolder("Projects")).toBe(true);
	});
});

describe("filterOrphanCardsByScope", () => {
	const mappings = [
		{ listId: "l1", folder: "Folder1" },
		{ listId: "l2", folder: "Folder2" },
		{ listId: "   ", folder: "Folder3" },
	];

	const cards = [
		{ id: "c1", idList: "l1", name: "Card 1" },
		{ id: "c2", idList: "l2", name: "Card 2" },
		{ id: "c3", idList: "l3", name: "Card 3 (unmapped list)" },
		{ id: "c4", idList: undefined, name: "Card 4 (no list)" },
	];

	test("returns all cards when scope is 'all'", () => {
		const filtered = filterOrphanCardsByScope(cards, mappings, "all");
		expect(filtered).toEqual(cards);
	});

	test("returns only cards in mapped lists when scope is 'mapped-lists-only'", () => {
		const filtered = filterOrphanCardsByScope(cards, mappings, "mapped-lists-only");
		expect(filtered).toEqual([
			{ id: "c1", idList: "l1", name: "Card 1" },
			{ id: "c2", idList: "l2", name: "Card 2" },
		]);
	});

	test("returns empty array if no cards match mapped lists", () => {
		const unmappedCards = [
			{ id: "c3", idList: "l3", name: "Card 3" },
			{ id: "c4", idList: undefined, name: "Card 4" },
		];
		const filtered = filterOrphanCardsByScope(unmappedCards, mappings, "mapped-lists-only");
		expect(filtered).toEqual([]);
	});
});

