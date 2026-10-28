import { describe, expect, test } from "vitest";
import { boardForMapping, boardForRef, registeredBoards } from "../src/core/boardResolve";

const settings = {
	boardId: "default",
	boards: [
		{ id: "b2", name: "Second" },
		{ id: "default", name: "Main" },
		{ id: "b2", name: "Second again" },
	],
};

describe("boardForMapping", () => {
	test("a mapping without a board uses the default board", () => {
		expect(boardForMapping({}, settings)).toEqual({ boardId: "default", fellBack: false });
		expect(boardForMapping({ boardId: "  " }, settings)).toEqual({ boardId: "default", fellBack: false });
	});

	test("a mapping on a registered board uses it", () => {
		expect(boardForMapping({ boardId: "b2" }, settings)).toEqual({ boardId: "b2", fellBack: false });
	});

	test("a mapping naming the default board is not a fallback even when it is not registered", () => {
		expect(boardForMapping({ boardId: "default" }, { boardId: "default", boards: [] })).toEqual({
			boardId: "default",
			fellBack: false,
		});
	});

	test("a board removed from the settings falls back to the default and says so", () => {
		expect(boardForMapping({ boardId: "gone" }, settings)).toEqual({ boardId: "default", fellBack: true });
	});
});

describe("boardForRef", () => {
	test("a reference without a board prefix uses the default board", () => {
		expect(boardForRef({ boardId: null, cardId: "c" }, settings)).toBe("default");
	});

	test("a prefixed reference keeps its own board when it is registered", () => {
		expect(boardForRef({ boardId: "b2", cardId: "c" }, settings)).toBe("b2");
		expect(boardForRef({ boardId: "default", cardId: "c" }, settings)).toBe("default");
	});

	test("a prefix naming a board that is not registered uses the default board (1.25 behaviour)", () => {
		expect(boardForRef({ boardId: "elsewhere", cardId: "c" }, settings)).toBe("default");
	});
});

describe("registeredBoards", () => {
	test("lists the default board first, then the others, without duplicates", () => {
		expect(registeredBoards(settings)).toEqual([
			{ id: "default", name: "Main" },
			{ id: "b2", name: "Second" },
		]);
	});

	test("keeps the default board even when it is not in the list, and skips an empty default", () => {
		expect(registeredBoards({ boardId: "d", boards: [] })).toEqual([{ id: "d", name: "" }]);
		expect(registeredBoards({ boardId: "", boards: [{ id: "b2", name: "S" }] })).toEqual([{ id: "b2", name: "S" }]);
	});
});
