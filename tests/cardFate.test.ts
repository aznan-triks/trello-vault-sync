import { describe, expect, test } from "vitest";
import {
	decideNoteFate,
	migrateCardFateSettings,
	normalizeCardFateRules,
	type CardChange,
	type CardFateRules,
} from "../src/core/cardFate";

const rules: CardFateRules = { onCardMoved: "move-note", onCardArchived: "unlink", onCardDeleted: "unlink", archiveFolder: "Archive" };

describe("decideNoteFate", () => {
	test.each([
		["moved", rules, { mappedFolderOfNewList: "B", trashAllowed: true }, { action: "move", folder: "B" }],
		["moved", rules, { mappedFolderOfNewList: null, trashAllowed: true }, { action: "keep", reason: "new list not mapped" }],
		["moved", { ...rules, onCardMoved: "keep" }, { mappedFolderOfNewList: "B", trashAllowed: true }, { action: "keep" }],
		["moved", { ...rules, onCardMoved: "trash" }, { mappedFolderOfNewList: "B", trashAllowed: false }, { action: "keep", reason: "trash disabled for this folder" }],
		["archived", rules, { mappedFolderOfNewList: null, trashAllowed: true }, { action: "unlink" }],
		["archived", { ...rules, onCardArchived: "archive-folder" }, { mappedFolderOfNewList: null, trashAllowed: true }, { action: "move", folder: "Archive" }],
		["archived", { ...rules, onCardArchived: "archive-folder", archiveFolder: "" }, { mappedFolderOfNewList: null, trashAllowed: true }, { action: "keep", reason: "no archive folder set" }],
		["archived", { ...rules, onCardArchived: "trash" }, { mappedFolderOfNewList: null, trashAllowed: true }, { action: "trash" }],
		["deleted", { ...rules, onCardDeleted: "trash" }, { mappedFolderOfNewList: null, trashAllowed: true }, { action: "trash" }],
		["deleted", { ...rules, onCardDeleted: "keep" }, { mappedFolderOfNewList: null, trashAllowed: true }, { action: "keep" }],
		["deleted", rules, { mappedFolderOfNewList: null, trashAllowed: true }, { action: "unlink" }],
	])("%s → %j", (change, r, ctx, expected) => {
		expect(decideNoteFate(change as CardChange, r as CardFateRules, ctx)).toEqual(expected);
	});
});

describe("migrateCardFateSettings", () => {
	test("keeps the old behavior", () => {
		expect(migrateCardFateSettings({ allowDelete: true, protectMovedOrArchivedCards: false })).toEqual({ onCardMoved: "trash", onCardArchived: "trash", onCardDeleted: "trash" });
		expect(migrateCardFateSettings({ allowDelete: true, protectMovedOrArchivedCards: true })).toEqual({ onCardMoved: "move-note", onCardArchived: "keep", onCardDeleted: "trash" });
		expect(migrateCardFateSettings({ allowDelete: false })).toEqual({ onCardMoved: "move-note", onCardArchived: "unlink", onCardDeleted: "unlink" });
	});

	test("does nothing for already-migrated or brand-new data", () => {
		expect(migrateCardFateSettings({ onCardMoved: "keep", allowDelete: true })).toEqual({});
		expect(migrateCardFateSettings({})).toEqual({});
	});
});

describe("normalizeCardFateRules", () => {
	test("falls back to the defaults on unknown values", () => {
		expect(normalizeCardFateRules({ onCardMoved: "explode", onCardArchived: 3, onCardDeleted: "archive-folder" })).toEqual({
			onCardMoved: "move-note",
			onCardArchived: "unlink",
			onCardDeleted: "unlink",
		});
	});

	test("keeps valid values", () => {
		expect(normalizeCardFateRules({ onCardMoved: "trash", onCardArchived: "archive-folder", onCardDeleted: "keep" })).toEqual({
			onCardMoved: "trash",
			onCardArchived: "archive-folder",
			onCardDeleted: "keep",
		});
	});
});
