import { describe, expect, test } from "vitest";
import { boardForFolder, boardForList, boardForMapping, boardForRef, registeredBoards, setMappingBoard } from "../src/core/boardResolve";

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

describe("boardForList / boardForFolder", () => {
	const withMappings = {
		...settings,
		mappings: [
			{ listId: "l1", folder: "A" },
			{ listId: "l2", folder: "B", boardId: "b2" },
			{ listId: "l3", folder: "C", boardId: "gone" },
		],
	};

	test("a list takes the board of its mapping, the default board when it has none", () => {
		expect(boardForList("l1", withMappings)).toBe("default");
		expect(boardForList("l2", withMappings)).toBe("b2");
		expect(boardForList("l3", withMappings)).toBe("default");
		expect(boardForList("unmapped", withMappings)).toBe("default");
	});

	test("a folder takes the board of its mapping, or null when it is not mapped", () => {
		expect(boardForFolder("B", withMappings)).toBe("b2");
		expect(boardForFolder("A", withMappings)).toBe("default");
		expect(boardForFolder("Elsewhere", withMappings)).toBeNull();
	});
});

describe("setMappingBoard", () => {
	test("changing the board empties the list, which belonged to the old board", () => {
		const mapping: { listId: string; boardId?: string } = { listId: "l1" };
		expect(setMappingBoard(mapping, "b2", "b1")).toBe(true);
		expect(mapping).toEqual({ listId: "", boardId: "b2" });
	});

	test("choosing the default board removes the key and empties the list when the board changes", () => {
		const mapping: { listId: string; boardId?: string } = { listId: "l2", boardId: "b2" };
		expect(setMappingBoard(mapping, "b1", "b1")).toBe(true);
		expect(mapping).toEqual({ listId: "" });
	});

	test("the same board, spelled the same or as the default, keeps the list", () => {
		const own = { listId: "l2", boardId: "b2" };
		expect(setMappingBoard(own, " b2 ", "b1")).toBe(false);
		const dflt: { listId: string; boardId?: string } = { listId: "l1" };
		expect(setMappingBoard(dflt, "", "b1")).toBe(false);
		expect(setMappingBoard(dflt, "b1", "b1")).toBe(false);
		expect(own.listId + dflt.listId).toBe("l2l1");
	});
});
