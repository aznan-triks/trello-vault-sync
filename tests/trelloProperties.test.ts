import { describe, expect, test } from "vitest";
import { stripTrelloProperties, trelloPropertyKeys } from "../src/core/trelloProperties";

const keys = {
	cardRefFrontmatterKey: "trello_board_card_id",
	dueFrontmatterKey: "trello_due",
	labelsFrontmatterKey: "trello_labels",
	membersFrontmatterKey: "trello_members",
	customFieldsFrontmatterKey: "trello_custom_fields",
	attachmentsFrontmatterKey: "trello_attachments",
	linkedCardsFrontmatterKey: "trello_linked_cards",
};

describe("trelloPropertyKeys", () => {
	test("lists every configured key, the Trello plugin's note id and extra keys, without duplicates", () => {
		const list = trelloPropertyKeys({ ...keys, dueFrontmatterKey: "trello_board_card_id" }, ["type"]);
		expect(list).toContain("trello_plugin_note_id");
		expect(list).toContain("type");
		expect(new Set(list).size).toBe(list.length);
	});

	test("follows renamed keys", () => {
		expect(trelloPropertyKeys({ ...keys, cardRefFrontmatterKey: "card" })).toContain("card");
	});
});

describe("stripTrelloProperties", () => {
	test("removes only the listed keys and reports which ones were present", () => {
		const fm: Record<string, unknown> = { trello_board_card_id: "b;c", trello_due: "2026-01-01", tags: ["x"], banner: "img.png" };
		expect(stripTrelloProperties(fm, trelloPropertyKeys(keys)).sort()).toEqual(["trello_board_card_id", "trello_due"]);
		expect(fm).toEqual({ tags: ["x"], banner: "img.png" });
	});

	test("returns [] and leaves the object untouched when nothing matches", () => {
		const fm = { tags: [] };
		expect(stripTrelloProperties(fm, trelloPropertyKeys(keys))).toEqual([]);
		expect(fm).toEqual({ tags: [] });
	});
});
