import { describe, expect, test } from "vitest";
import type { TrelloAction } from "../src/core/auditAction";
import {
	extractCardNamesFromActions,
	hasMatchingCardInBoardOrHistory,
	isSameCardName,
} from "../src/core/cardHistoryMatch";

describe("isSameCardName", () => {
	test("matches exact identical names", () => {
		expect(isSameCardName("My Idea", "My Idea")).toBe(true);
	});

	test("matches case-insensitively and with trimmed whitespace", () => {
		expect(isSameCardName("  my idea  ", "MY IDEA")).toBe(true);
		expect(isSameCardName("Card Name", "card name")).toBe(true);
	});

	test("matches when card title had forbidden filename characters that got sanitized", () => {
		// forbidden: * " \ / < > : | ?
		expect(isSameCardName("Topic: Draft", "Topic- Draft")).toBe(true);
		expect(isSameCardName("What?", "What-")).toBe(true);
	});

	test("returns false for distinct names", () => {
		expect(isSameCardName("Idea A", "Idea B")).toBe(false);
		expect(isSameCardName("Totally Different", "Something Else")).toBe(false);
	});
});

describe("hasMatchingCardInBoardOrHistory", () => {
	test("returns true if any known name matches", () => {
		const known = new Set(["First Card", "Second Card", "Archived Item"]);
		expect(hasMatchingCardInBoardOrHistory("Second Card", known)).toBe(true);
		expect(hasMatchingCardInBoardOrHistory("archived item", known)).toBe(true);
	});

	test("returns false if no known name matches", () => {
		const known = new Set(["First Card", "Second Card"]);
		expect(hasMatchingCardInBoardOrHistory("Fresh Thought", known)).toBe(false);
	});
});

describe("extractCardNamesFromActions", () => {
	test("extracts card names from actions including renamed/old names", () => {
		const actions: TrelloAction[] = [
			{
				id: "a1",
				type: "createCard",
				date: "2026-10-18T10:00:00Z",
				data: { card: { name: "New Card" } },
			},
			{
				id: "a2",
				type: "deleteCard",
				date: "2026-10-18T11:00:00Z",
				data: { card: { name: "Deleted Card" } },
			},
			{
				id: "a3",
				type: "updateCard",
				date: "2026-10-18T12:00:00Z",
				data: {
					card: { name: "Renamed Card" },
					old: { name: "Original Name" },
				},
			},
			{
				id: "a4",
				type: "commentCard",
				date: "2026-10-18T13:00:00Z",
				data: {}, // no card name
			},
		];

		const names = extractCardNamesFromActions(actions);
		expect(names).toEqual(["New Card", "Deleted Card", "Renamed Card", "Original Name"]);
	});
});
