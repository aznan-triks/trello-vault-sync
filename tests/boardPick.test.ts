import { describe, expect, test } from "vitest";
import { boardIdsForNote, listChoices, registeredBoardIds } from "../src/commands/boardPick";
import type { CommandContext } from "../src/commands/context";
import { DEFAULT_SETTINGS } from "../src/settings/types";

const ctxWith = (settings: Partial<typeof DEFAULT_SETTINGS>) =>
	({ settings: { ...DEFAULT_SETTINGS, boardId: "b1", ...settings } }) as unknown as CommandContext;

describe("board choices", () => {
	test("a vault with one board keeps plain list names and only the default board", () => {
		const ctx = ctxWith({});
		expect(registeredBoardIds(ctx)).toEqual(["b1"]);
		expect(listChoices(ctx, new Map([["l1", "Todo"]])).lists).toEqual([{ id: "l1", name: "Todo" }]);
	});

	test("with several boards the lists are named by board and remember it", () => {
		const ctx = ctxWith({ boards: [{ id: "b2", name: "Second" }] });
		const choices = listChoices(ctx, new Map([["l1", "Todo"], ["l2", "Todo"]]), new Map([["l1", "b1"], ["l2", "b2"]]));
		expect(choices.lists.map((list) => list.name)).toEqual(["Default board › Todo", "Second › Todo"]);
		expect(choices.boardOf("l2")).toBe("b2");
	});

	test("a note in a mapped folder looks on its mapping's board only, any other note on every registered board", () => {
		const ctx = ctxWith({
			boards: [{ id: "b2", name: "Second" }],
			mappings: [{ folder: "Second", listId: "l2", templateName: "", boardId: "b2" }],
		});
		expect(boardIdsForNote(ctx, { folder: "Second" })).toEqual(["b2"]);
		expect(boardIdsForNote(ctx, { folder: "Elsewhere" })).toEqual(["b1", "b2"]);
	});
});
