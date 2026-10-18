import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	ALIGN_CATEGORIES,
	DEFAULT_MANUAL_ALIGN_CATEGORIES,
	detectStaleChanges,
	isTrelloUrl,
	SAFE_ALIGN_CATEGORIES,
	type AlignCategory,
	type AlignSettings,
} from "../src/core/staleProperties";
import { DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY } from "../src/core/cardRef";

// --- Settings Test Factory ---

function createSettings(overrides: Partial<AlignSettings> = {}): AlignSettings {
	return {
		syncDue: true,
		dueFrontmatterKey: "trello_due",
		syncLabels: true,
		labelsFrontmatterKey: "trello_labels",
		syncMembers: true,
		membersFrontmatterKey: "trello_members",
		syncCustomFields: true,
		customFieldsFrontmatterKey: "trello_custom_fields",
		syncAttachments: true,
		attachmentsFrontmatterKey: "trello_attachments",
		syncLinkedCards: true,
		linkedCardsFrontmatterKey: "trello_linked_cards",
		syncCardCover: true,
		coverFrontmatterKey: "banner",
		writeTrelloPluginNoteId: false,
		syncChecklists: true,
		checklistHeading: "## Checklists",
		labelPropertySync: true,
		labelPropertyMappings: [],
		obsoleteLabelPropertyKeys: [],
		keyMigrations: {},
		...overrides,
	};
}

// ============================================================================
// 1. isTrelloUrl Validation
// ============================================================================

describe("isTrelloUrl", () => {
	test("identifies official remote Trello attachment, card, and background URLs as true", () => {
		expect(isTrelloUrl("https://trello-attachments.s3.amazonaws.com/5a123/cover.jpg")).toBe(true);
		expect(isTrelloUrl("https://trello-attachments.s3.us-west-2.amazonaws.com/board/c1/cover.jpg")).toBe(true);
		expect(isTrelloUrl("https://trello-backgrounds.s3.amazonaws.com/bg.png")).toBe(true);
		expect(isTrelloUrl("https://trello-backgrounds.s3.eu-west-1.amazonaws.com/bg.png")).toBe(true);
		expect(isTrelloUrl("https://trello.com/1/cards/abc/attachments/123/download/cover.png")).toBe(true);
		expect(isTrelloUrl("https://trello.com/c/shortLink/card-title")).toBe(true);
		expect(isTrelloUrl("http://trello.com/test")).toBe(true);
		expect(isTrelloUrl("https://api.trello.com/1/cards/test")).toBe(true);
		expect(isTrelloUrl("https://attachments.trello.com/file.png")).toBe(true);
	});

	test("identifies external non-Trello web URLs as false", () => {
		expect(isTrelloUrl("https://images.unsplash.com/photo-1579546929518-9e396f3cc809")).toBe(false);
		expect(isTrelloUrl("https://i.imgur.com/example.png")).toBe(false);
		expect(isTrelloUrl("https://example.com/banner.jpg")).toBe(false);
		expect(isTrelloUrl("https://github.com/aznan-triks")).toBe(false);
	});

	test("prevents security bypass via spoofed attacker domains", () => {
		expect(isTrelloUrl("https://trello.com.attacker.com/evil.jpg")).toBe(false);
		expect(isTrelloUrl("https://fake-trello.com/cover.jpg")).toBe(false);
		expect(isTrelloUrl("https://not-trello-attachments.s3.amazonaws.com/test.jpg")).toBe(false);
		expect(isTrelloUrl("https://trello-attachments.s3.amazonaws.com.evil.com/fake.png")).toBe(false);
		expect(isTrelloUrl("https://trello-attachments.s3.evil.amazonaws.com/cover.jpg")).toBe(false);
		expect(isTrelloUrl("https://trello-attachments.s3.evil.s3.amazonaws.com/cover.jpg")).toBe(false);
		expect(isTrelloUrl("https://trello-backgrounds.s3.evil.amazonaws.com/bg.png")).toBe(false);
		expect(isTrelloUrl("https://attacker.trello-attachments.s3.amazonaws.com/fake.png")).toBe(false);
	});

	test("identifies local Obsidian covers and wikilinks as false", () => {
		expect(isTrelloUrl("assets/banners/landscape.png")).toBe(false);
		expect(isTrelloUrl("covers/cover.jpg")).toBe(false);
		expect(isTrelloUrl("banner.png")).toBe(false);
		expect(isTrelloUrl("[[landscape.png]]")).toBe(false);
		expect(isTrelloUrl("[[attachments/cover.jpg|100]]")).toBe(false);
		expect(isTrelloUrl("![[landscape.png]]")).toBe(false);
	});

	test("returns false for non-string, empty, or malformed inputs without throwing", () => {
		expect(isTrelloUrl("")).toBe(false);
		expect(isTrelloUrl("   ")).toBe(false);
		expect(isTrelloUrl(null)).toBe(false);
		expect(isTrelloUrl(undefined)).toBe(false);
		expect(isTrelloUrl(42)).toBe(false);
		expect(isTrelloUrl(true)).toBe(false);
		expect(isTrelloUrl({ url: "https://trello.com" })).toBe(false);
		expect(isTrelloUrl(["https://trello.com"])).toBe(false);
		expect(isTrelloUrl("not a url")).toBe(false);
		expect(isTrelloUrl("http://")).toBe(false);
	});
});

// ============================================================================
// 2. Category Constants & Sets
// ============================================================================

describe("Category Constants & Sets", () => {
	test("ALIGN_CATEGORIES contains all 12 categories with zero duplicates", () => {
		expect(ALIGN_CATEGORIES).toHaveLength(12);
		expect(new Set(ALIGN_CATEGORIES).size).toBe(12);

		const expected: AlignCategory[] = [
			"due",
			"labels",
			"members",
			"custom-fields",
			"attachments",
			"linked-cards",
			"cover",
			"plugin-note-id",
			"missing-plugin-note-id",
			"checklist-section",
			"obsolete-label-property",
			"key-migration",
		];
		expect([...ALIGN_CATEGORIES].sort()).toEqual(expected.sort());
	});

	test("SAFE_ALIGN_CATEGORIES contains exactly 8 safe categories, strictly excluding unsafe ones", () => {
		expect(SAFE_ALIGN_CATEGORIES).toHaveLength(8);

		// Strictly excluded unsafe categories:
		expect(SAFE_ALIGN_CATEGORIES).not.toContain("checklist-section");
		expect(SAFE_ALIGN_CATEGORIES).not.toContain("plugin-note-id");
		expect(SAFE_ALIGN_CATEGORIES).not.toContain("missing-plugin-note-id");
		expect(SAFE_ALIGN_CATEGORIES).not.toContain("obsolete-label-property");

		// Included safe categories:
		expect(SAFE_ALIGN_CATEGORIES).toContain("due");
		expect(SAFE_ALIGN_CATEGORIES).toContain("labels");
		expect(SAFE_ALIGN_CATEGORIES).toContain("members");
		expect(SAFE_ALIGN_CATEGORIES).toContain("custom-fields");
		expect(SAFE_ALIGN_CATEGORIES).toContain("attachments");
		expect(SAFE_ALIGN_CATEGORIES).toContain("linked-cards");
		expect(SAFE_ALIGN_CATEGORIES).toContain("cover");
		expect(SAFE_ALIGN_CATEGORIES).toContain("key-migration");
	});

	test("DEFAULT_MANUAL_ALIGN_CATEGORIES matches SAFE_ALIGN_CATEGORIES for initial modal checkboxes", () => {
		expect(DEFAULT_MANUAL_ALIGN_CATEGORIES).toHaveLength(8);
		expect([...DEFAULT_MANUAL_ALIGN_CATEGORIES].sort()).toEqual([...SAFE_ALIGN_CATEGORIES].sort());
	});
});

// ============================================================================
// 3. Isolated Category Unit Tests for detectStaleChanges
// ============================================================================

describe("detectStaleChanges - 12 Categories Unit Tests", () => {
	// Category 1: due
	describe("Category: due", () => {
		test("detects stale due date when syncDue is disabled", () => {
			const settings = createSettings({ syncDue: false, dueFrontmatterKey: "trello_due" });
			const frontmatter = { trello_board_card_id: "b1;c1", trello_due: "2026-10-31" };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([{ category: "due", action: "remove", keys: ["trello_due"] }]);
		});

		test("preserves due date when syncDue is enabled", () => {
			const settings = createSettings({ syncDue: true, dueFrontmatterKey: "trello_due" });
			const frontmatter = { trello_board_card_id: "b1;c1", trello_due: "2026-10-31" };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes.find((c) => c.category === "due")).toBeUndefined();
		});

		test("respects configurable dueFrontmatterKey", () => {
			const settings = createSettings({ syncDue: false, dueFrontmatterKey: "custom_deadline" });
			const frontmatter = { trello_board_card_id: "b1;c1", custom_deadline: "2026-10-31", trello_due: "ignore" };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([{ category: "due", action: "remove", keys: ["custom_deadline"] }]);
		});
	});

	// Category 2: labels
	describe("Category: labels", () => {
		test("detects stale labels when syncLabels is disabled", () => {
			const settings = createSettings({ syncLabels: false, labelsFrontmatterKey: "trello_labels" });
			const frontmatter = { trello_board_card_id: "b1;c1", trello_labels: ["bug", "urgent"] };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([{ category: "labels", action: "remove", keys: ["trello_labels"] }]);
		});

		test("preserves labels when syncLabels is enabled", () => {
			const settings = createSettings({ syncLabels: true, labelsFrontmatterKey: "trello_labels" });
			const frontmatter = { trello_board_card_id: "b1;c1", trello_labels: ["bug"] };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes.find((c) => c.category === "labels")).toBeUndefined();
		});

		test("respects configurable labelsFrontmatterKey", () => {
			const settings = createSettings({ syncLabels: false, labelsFrontmatterKey: "tags" });
			const frontmatter = { trello_board_card_id: "b1;c1", tags: ["v1", "release"] };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([{ category: "labels", action: "remove", keys: ["tags"] }]);
		});
	});

	// Category 3: members
	describe("Category: members", () => {
		test("detects stale members when syncMembers is disabled", () => {
			const settings = createSettings({ syncMembers: false, membersFrontmatterKey: "trello_members" });
			const frontmatter = { trello_board_card_id: "b1;c1", trello_members: ["alice", "bob"] };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([{ category: "members", action: "remove", keys: ["trello_members"] }]);
		});

		test("preserves members when syncMembers is enabled", () => {
			const settings = createSettings({ syncMembers: true });
			const frontmatter = { trello_board_card_id: "b1;c1", trello_members: ["alice"] };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes.find((c) => c.category === "members")).toBeUndefined();
		});

		test("respects configurable membersFrontmatterKey", () => {
			const settings = createSettings({ syncMembers: false, membersFrontmatterKey: "assignees" });
			const frontmatter = { trello_board_card_id: "b1;c1", assignees: ["alice"] };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([{ category: "members", action: "remove", keys: ["assignees"] }]);
		});
	});

	// Category 4: custom-fields
	describe("Category: custom-fields", () => {
		test("detects stale custom fields when syncCustomFields is disabled", () => {
			const settings = createSettings({ syncCustomFields: false, customFieldsFrontmatterKey: "trello_custom_fields" });
			const frontmatter = { trello_board_card_id: "b1;c1", trello_custom_fields: { Priority: "High" } };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([{ category: "custom-fields", action: "remove", keys: ["trello_custom_fields"] }]);
		});

		test("preserves custom fields when syncCustomFields is enabled", () => {
			const settings = createSettings({ syncCustomFields: true });
			const frontmatter = { trello_board_card_id: "b1;c1", trello_custom_fields: { Priority: "High" } };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes.find((c) => c.category === "custom-fields")).toBeUndefined();
		});

		test("respects configurable customFieldsFrontmatterKey", () => {
			const settings = createSettings({ syncCustomFields: false, customFieldsFrontmatterKey: "my_cf" });
			const frontmatter = { trello_board_card_id: "b1;c1", my_cf: { Effort: 3 } };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([{ category: "custom-fields", action: "remove", keys: ["my_cf"] }]);
		});
	});

	// Category 5: attachments
	describe("Category: attachments", () => {
		test("detects both attachments and linked-cards keys when syncAttachments is disabled", () => {
			const settings = createSettings({
				syncAttachments: false,
				attachmentsFrontmatterKey: "trello_attachments",
				linkedCardsFrontmatterKey: "trello_linked_cards",
			});
			const frontmatter = {
				trello_board_card_id: "b1;c1",
				trello_attachments: ["https://trello.com/att1"],
				trello_linked_cards: ["card2"],
			};

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([
				{
					category: "attachments",
					action: "remove",
					keys: ["trello_attachments", "trello_linked_cards"],
				},
			]);
		});

		test("detects only the present key when one of attachments or linked-cards is absent", () => {
			const settings = createSettings({ syncAttachments: false });
			const frontmatter = { trello_board_card_id: "b1;c1", trello_attachments: ["https://trello.com/att1"] };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([{ category: "attachments", action: "remove", keys: ["trello_attachments"] }]);
		});

		test("preserves attachments when syncAttachments is enabled", () => {
			const settings = createSettings({ syncAttachments: true });
			const frontmatter = { trello_board_card_id: "b1;c1", trello_attachments: ["https://trello.com/att1"] };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes.find((c) => c.category === "attachments")).toBeUndefined();
		});

		test("respects configurable attachment and linked card keys", () => {
			const settings = createSettings({
				syncAttachments: false,
				attachmentsFrontmatterKey: "files",
				linkedCardsFrontmatterKey: "related",
			});
			const frontmatter = { trello_board_card_id: "b1;c1", files: ["f1"], related: ["r1"] };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([{ category: "attachments", action: "remove", keys: ["files", "related"] }]);
		});
	});

	// Category 6: linked-cards
	describe("Category: linked-cards", () => {
		test("detects linked cards when syncAttachments is true but syncLinkedCards is false", () => {
			const settings = createSettings({
				syncAttachments: true,
				syncLinkedCards: false,
				attachmentsFrontmatterKey: "trello_attachments",
				linkedCardsFrontmatterKey: "trello_linked_cards",
			});
			const frontmatter = {
				trello_board_card_id: "b1;c1",
				trello_attachments: ["https://trello.com/att1"],
				trello_linked_cards: ["card2"],
			};

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([{ category: "linked-cards", action: "remove", keys: ["trello_linked_cards"] }]);
		});

		test("preserves linked cards when both syncAttachments and syncLinkedCards are true", () => {
			const settings = createSettings({ syncAttachments: true, syncLinkedCards: true });
			const frontmatter = { trello_board_card_id: "b1;c1", trello_linked_cards: ["card2"] };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes.find((c) => c.category === "linked-cards")).toBeUndefined();
		});

		test("does not emit duplicate linked-cards change if syncAttachments is false", () => {
			const settings = createSettings({ syncAttachments: false, syncLinkedCards: false });
			const frontmatter = { trello_board_card_id: "b1;c1", trello_linked_cards: ["card2"] };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			// Category is attachments (which covers linked cards when attachments are disabled)
			expect(changes.find((c) => c.category === "linked-cards")).toBeUndefined();
			expect(changes.find((c) => c.category === "attachments")).toBeDefined();
		});
	});

	// Category 7: cover
	describe("Category: cover", () => {
		test("detects remote Trello cover URL when syncCardCover is disabled", () => {
			const trelloCover = "https://trello-attachments.s3.amazonaws.com/5a/cover.jpg";
			const settings = createSettings({ syncCardCover: false, coverFrontmatterKey: "banner" });
			const frontmatter = { trello_board_card_id: "b1;c1", banner: trelloCover };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([{ category: "cover", action: "remove", keys: ["banner"] }]);
		});

		test("strictly preserves local cover paths and wikilinks when syncCardCover is disabled", () => {
			const settings = createSettings({ syncCardCover: false, coverFrontmatterKey: "banner" });

			const localPathChanges = detectStaleChanges({
				frontmatter: { trello_board_card_id: "b1;c1", banner: "assets/banners/landscape.png" },
				hasCardRef: true,
				settings,
			});
			expect(localPathChanges.find((c) => c.category === "cover")).toBeUndefined();

			const wikilinkChanges = detectStaleChanges({
				frontmatter: { trello_board_card_id: "b1;c1", banner: "[[landscape.png]]" },
				hasCardRef: true,
				settings,
			});
			expect(wikilinkChanges.find((c) => c.category === "cover")).toBeUndefined();
		});

		test("strictly preserves non-Trello remote covers (e.g. Unsplash) when syncCardCover is disabled", () => {
			const unsplashCover = "https://images.unsplash.com/photo-1579546929518-9e396f3cc809";
			const settings = createSettings({ syncCardCover: false, coverFrontmatterKey: "banner" });
			const frontmatter = { trello_board_card_id: "b1;c1", banner: unsplashCover };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes.find((c) => c.category === "cover")).toBeUndefined();
		});

		test("preserves remote Trello cover URL when syncCardCover is enabled", () => {
			const settings = createSettings({ syncCardCover: true, coverFrontmatterKey: "banner" });
			const frontmatter = {
				trello_board_card_id: "b1;c1",
				banner: "https://trello-attachments.s3.amazonaws.com/cover.jpg",
			};

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes.find((c) => c.category === "cover")).toBeUndefined();
		});

		test("respects configurable coverFrontmatterKey", () => {
			const settings = createSettings({ syncCardCover: false, coverFrontmatterKey: "header_image" });
			const frontmatter = {
				trello_board_card_id: "b1;c1",
				header_image: "https://trello.com/cover.jpg",
			};

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([{ category: "cover", action: "remove", keys: ["header_image"] }]);
		});
	});

	// Category 8: plugin-note-id
	describe("Category: plugin-note-id", () => {
		test("detects trello_plugin_note_id when writeTrelloPluginNoteId is disabled", () => {
			const settings = createSettings({ writeTrelloPluginNoteId: false });
			const frontmatter = {
				trello_board_card_id: "b1;c1",
				[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]: "0123456789abcdef0123456789abcdef",
			};

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([
				{
					category: "plugin-note-id",
					action: "remove",
					keys: [DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY],
				},
			]);
		});

		test("preserves trello_plugin_note_id when writeTrelloPluginNoteId is enabled", () => {
			const settings = createSettings({ writeTrelloPluginNoteId: true });
			const frontmatter = {
				trello_board_card_id: "b1;c1",
				[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]: "0123456789abcdef0123456789abcdef",
			};

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes.find((c) => c.category === "plugin-note-id")).toBeUndefined();
		});
	});

	// Category 9: missing-plugin-note-id
	describe("Category: missing-plugin-note-id", () => {
		test("detects missing plugin note ID on linked notes when enabled", () => {
			const settings = createSettings({ writeTrelloPluginNoteId: true });
			const frontmatter = { trello_board_card_id: "b1;c1" };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([
				{
					category: "missing-plugin-note-id",
					action: "add",
					keys: [DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY],
				},
			]);
		});

		test("does not report missing if linked note already has trello_plugin_note_id", () => {
			const settings = createSettings({ writeTrelloPluginNoteId: true });
			const frontmatter = {
				trello_board_card_id: "b1;c1",
				[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]: "0123456789abcdef0123456789abcdef",
			};

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes.find((c) => c.category === "missing-plugin-note-id")).toBeUndefined();
		});

		test("CRITICAL: never reports missing-plugin-note-id for unlinked notes (hasCardRef = false)", () => {
			const settings = createSettings({ writeTrelloPluginNoteId: true });
			const frontmatter = { author: "Alice", title: "Unlinked Task" };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: false, settings });
			expect(changes.find((c) => c.category === "missing-plugin-note-id")).toBeUndefined();
		});

		test("does not report missing if writeTrelloPluginNoteId is disabled", () => {
			const settings = createSettings({ writeTrelloPluginNoteId: false });
			const frontmatter = { trello_board_card_id: "b1;c1" };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes.find((c) => c.category === "missing-plugin-note-id")).toBeUndefined();
		});
	});

	// Category 10: checklist-section
	describe("Category: checklist-section", () => {
		test("detects checklist section for removal when syncChecklists is disabled", () => {
			const settings = createSettings({ syncChecklists: false, checklistHeading: "## Checklists" });
			const frontmatter = { trello_board_card_id: "b1;c1" };

			const changes = detectStaleChanges({
				frontmatter,
				hasCardRef: true,
				hasChecklistSection: true,
				settings,
			});
			expect(changes).toEqual([
				{
					category: "checklist-section",
					action: "remove",
					keys: ["## Checklists"],
				},
			]);
		});

		test("does not detect checklist section if note has no checklist section", () => {
			const settings = createSettings({ syncChecklists: false, checklistHeading: "## Checklists" });
			const frontmatter = { trello_board_card_id: "b1;c1" };

			const changes = detectStaleChanges({
				frontmatter,
				hasCardRef: true,
				hasChecklistSection: false,
				settings,
			});
			expect(changes.find((c) => c.category === "checklist-section")).toBeUndefined();
		});

		test("preserves checklist section when syncChecklists is enabled", () => {
			const settings = createSettings({ syncChecklists: true, checklistHeading: "## Checklists" });
			const frontmatter = { trello_board_card_id: "b1;c1" };

			const changes = detectStaleChanges({
				frontmatter,
				hasCardRef: true,
				hasChecklistSection: true,
				settings,
			});
			expect(changes.find((c) => c.category === "checklist-section")).toBeUndefined();
		});

		test("respects configurable checklistHeading", () => {
			const settings = createSettings({ syncChecklists: false, checklistHeading: "### Checklist Section" });
			const frontmatter = { trello_board_card_id: "b1;c1" };

			const changes = detectStaleChanges({
				frontmatter,
				hasCardRef: true,
				hasChecklistSection: true,
				settings,
			});
			expect(changes).toEqual([
				{
					category: "checklist-section",
					action: "remove",
					keys: ["### Checklist Section"],
				},
			]);
		});
	});

	// Category 11: obsolete-label-property
	describe("Category: obsolete-label-property", () => {
		test("detects properties specified in obsoleteLabelPropertyKeys", () => {
			const settings = createSettings({
				obsoleteLabelPropertyKeys: ["legacy_status", "old_prio"],
			});
			const frontmatter = {
				trello_board_card_id: "b1;c1",
				legacy_status: "Done",
				old_prio: "High",
				author: "Alice",
			};

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([
				{
					category: "obsolete-label-property",
					action: "remove",
					keys: ["legacy_status", "old_prio"],
				},
			]);
		});

		test("detects mapped keys when labelPropertySync is disabled", () => {
			const settings = createSettings({
				labelPropertySync: false,
				labelPropertyMappings: [
					{ key: "status", values: ["done"] },
					{ key: "team", values: ["core"] },
				],
			});
			const frontmatter = { trello_board_card_id: "b1;c1", status: "done", team: "core" };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([
				{
					category: "obsolete-label-property",
					action: "remove",
					keys: ["status", "team"],
				},
			]);
		});

		test("reports nothing when no obsolete keys are present in frontmatter", () => {
			const settings = createSettings({
				obsoleteLabelPropertyKeys: ["old_status"],
			});
			const frontmatter = { trello_board_card_id: "b1;c1", author: "Alice" };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes.find((c) => c.category === "obsolete-label-property")).toBeUndefined();
		});
	});

	// Category 12: key-migration
	describe("Category: key-migration", () => {
		test("detects old keys and prepares migration to target keys", () => {
			const settings = createSettings({
				keyMigrations: { old_due: "trello_due", legacy_tags: "trello_labels" },
			});
			const frontmatter = {
				trello_board_card_id: "b1;c1",
				old_due: "2026-10-31",
				legacy_tags: ["v1"],
			};

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([
				{
					category: "key-migration",
					action: "migrate",
					keys: ["old_due", "legacy_tags"],
					migrations: { old_due: "trello_due", legacy_tags: "trello_labels" },
				},
			]);
		});

		test("only migrates keys that actually exist in the note frontmatter", () => {
			const settings = createSettings({
				keyMigrations: { old_due: "trello_due", missing_old_key: "new_target" },
			});
			const frontmatter = { trello_board_card_id: "b1;c1", old_due: "2026-10-31" };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes).toEqual([
				{
					category: "key-migration",
					action: "migrate",
					keys: ["old_due"],
					migrations: { old_due: "trello_due" },
				},
			]);
		});

		test("reports nothing when keyMigrations is empty", () => {
			const settings = createSettings({ keyMigrations: {} });
			const frontmatter = { trello_board_card_id: "b1;c1", old_due: "2026-10-31" };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes.find((c) => c.category === "key-migration")).toBeUndefined();
		});

		test("ignores identity migration when oldKey equals targetKey", () => {
			const settings = createSettings({ keyMigrations: { trello_due: "trello_due" } });
			const frontmatter = { trello_board_card_id: "b1;c1", trello_due: "2026-10-31" };

			const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
			expect(changes.find((c) => c.category === "key-migration")).toBeUndefined();
		});
	});
});

// ============================================================================
// 4. Boundary & Corner Cases
// ============================================================================

describe("detectStaleChanges - Boundary & Corner Cases", () => {
	test("empty frontmatter ({}) does not throw and detects no changes for unlinked notes", () => {
		const settings = createSettings({ syncDue: false, syncLabels: false });
		const changes = detectStaleChanges({ frontmatter: {}, hasCardRef: false, settings });
		expect(changes).toEqual([]);
	});

	test("empty frontmatter ({}) on linked note detects only missing-plugin-note-id if enabled", () => {
		const settings = createSettings({ syncDue: false, writeTrelloPluginNoteId: true });
		const changes = detectStaleChanges({ frontmatter: {}, hasCardRef: true, settings });
		expect(changes).toEqual([
			{
				category: "missing-plugin-note-id",
				action: "add",
				keys: [DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY],
			},
		]);
	});

	test("null frontmatter (notes with no YAML) handles body checklist section if present", () => {
		const settings = createSettings({ syncChecklists: false });
		const changes = detectStaleChanges({
			frontmatter: null,
			hasCardRef: true,
			hasChecklistSection: true,
			settings,
		});
		expect(changes).toEqual([
			{
				category: "checklist-section",
				action: "remove",
				keys: ["## Checklists"],
			},
		]);
	});

	test("null frontmatter on linked note detects missing-plugin-note-id when enabled", () => {
		const settings = createSettings({ writeTrelloPluginNoteId: true });
		const changes = detectStaleChanges({
			frontmatter: null,
			hasCardRef: true,
			settings,
		});
		expect(changes).toEqual([
			{
				category: "missing-plugin-note-id",
				action: "add",
				keys: [DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY],
			},
		]);
	});

	test("unrelated custom frontmatter properties are strictly preserved and never reported as keys", () => {
		const settings = createSettings({ syncDue: false });
		const frontmatter = {
			trello_board_card_id: "b1;c1",
			trello_due: "2026-10-31",
			author: "Trois",
			rating: 5,
			pinned: true,
			tags: ["personal"],
		};

		const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
		const affectedKeys = changes.flatMap((c) => c.keys);

		expect(affectedKeys).toEqual(["trello_due"]);
		expect(affectedKeys).not.toContain("author");
		expect(affectedKeys).not.toContain("rating");
		expect(affectedKeys).not.toContain("pinned");
		expect(affectedKeys).not.toContain("tags");
	});

	test("multiple disabled toggles return distinct change objects in a single pass", () => {
		const trelloCover = "https://trello-attachments.s3.amazonaws.com/abc/cover.jpg";
		const settings = createSettings({
			syncDue: false,
			syncLabels: false,
			syncMembers: false,
			syncCardCover: false,
		});
		const frontmatter = {
			trello_board_card_id: "b1;c1",
			trello_due: "2026-10-31",
			trello_labels: ["bug"],
			trello_members: ["alice"],
			banner: trelloCover,
		};

		const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
		expect(changes).toHaveLength(4);
		expect(changes.map((c) => c.category)).toEqual(["due", "labels", "members", "cover"]);
	});
});

// ============================================================================
// 5. Layer Isolation & Repository Standards
// ============================================================================

describe("Layer Isolation & Repository Standards", () => {
	const staleSourcePath = join(__dirname, "../src/core/staleProperties.ts");

	test("src/core/staleProperties.ts strictly has ZERO imports from 'obsidian'", () => {
		const content = readFileSync(staleSourcePath, "utf8");
		expect(content).not.toMatch(/from\s+["']obsidian["']/);
	});

	test("src/core/staleProperties.ts strictly has ZERO imports from '@trello' or 'src/trello'", () => {
		const content = readFileSync(staleSourcePath, "utf8");
		expect(content).not.toMatch(/from\s+["'].*trello.*["']/);
	});

	test("src/core/staleProperties.ts strictly has ZERO references to TFile, app.vault, or app.workspace", () => {
		const content = readFileSync(staleSourcePath, "utf8");
		expect(content).not.toMatch(/\bTFile\b|\bapp\.vault\b|\bapp\.workspace\b/);
	});

	test("src/core/staleProperties.ts has no hardcoded 'trello_xxx' string literals outside DEFAULT_... constants", () => {
		const content = readFileSync(staleSourcePath, "utf8");
		const lines = content.split("\n");
		const trelloKeyPattern = /"trello_[a-z_]+"/;
		const allowedConstLine = /^export const DEFAULT_[A-Z_]+ = "trello_[a-z_]+";$/;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]?.trim() ?? "";
			if (trelloKeyPattern.test(line)) {
				expect(allowedConstLine.test(line)).toBe(true);
			}
		}
	});

	test("src/core/staleProperties.ts is 100% English (zero accented characters)", () => {
		const content = readFileSync(staleSourcePath, "utf8");
		expect(content).not.toMatch(/[àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]/);
	});
});
