import { describe, expect, test } from "vitest";
import { formatCardRef, isPlaceholder, parseCardRef } from "../src/core/cardRef";

describe("parseCardRef", () => {
	test("splits the legacy 'boardId;cardId' pair", () => {
		expect(parseCardRef("67c33f69b3caccd3817745b4;5f2b1c")).toEqual({
			boardId: "67c33f69b3caccd3817745b4",
			cardId: "5f2b1c",
		});
	});

	test("accepts a bare card id with no board part", () => {
		expect(parseCardRef("5f2b1c")).toEqual({ boardId: null, cardId: "5f2b1c" });
	});

	test("trims surrounding whitespace around both parts", () => {
		expect(parseCardRef("  board ; card  ")).toEqual({ boardId: "board", cardId: "card" });
	});

	test("returns null for an unfilled template placeholder", () => {
		expect(parseCardRef("{{BOARD_ID}};{{CARD_ID}}")).toBeNull();
	});

	test("returns null for empty, blank or non-string values", () => {
		expect(parseCardRef("")).toBeNull();
		expect(parseCardRef("   ")).toBeNull();
		expect(parseCardRef(undefined)).toBeNull();
		expect(parseCardRef(42)).toBeNull();
	});

	test("returns null when the board part is present but the card part is empty", () => {
		expect(parseCardRef("board;")).toBeNull();
	});
});

describe("formatCardRef", () => {
	test("joins board and card with a semicolon", () => {
		expect(formatCardRef("b1", "c1")).toBe("b1;c1");
	});

	test("emits the card id alone when the board is unknown", () => {
		expect(formatCardRef(null, "c1")).toBe("c1");
	});
});

describe("isPlaceholder", () => {
	test("detects moustache placeholders left by a template", () => {
		expect(isPlaceholder("{{CARD_ID}}")).toBe(true);
		expect(isPlaceholder("abc")).toBe(false);
	});
});
