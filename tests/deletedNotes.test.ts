import { describe, expect, test } from "vitest";
import { cardsWithDeletedNotes, nextKnownLinks } from "../src/core/deletedNotes";

describe("deleted notes", () => {
	test("a card known as linked, now missing and with no note anywhere, had its note deleted", () => {
		expect(cardsWithDeletedNotes(["a", "b", "c"], new Set(["a", "b"]), new Set(["b"]))).toEqual(["a"]);
	});
	test("never-seen cards are plain new cards", () => {
		expect(cardsWithDeletedNotes(["n"], new Set(), new Set())).toEqual([]);
	});
	test("next known links = list cards that have a note", () => {
		expect(nextKnownLinks(["a", "b"], new Set(["b", "z"]))).toEqual(["b"]);
	});
});
