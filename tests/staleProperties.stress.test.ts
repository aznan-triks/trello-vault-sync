import { describe, expect, test } from "vitest";
import {
	ALIGN_CATEGORIES,
	detectStaleChanges,
	isTrelloUrl,
	type AlignSettings,
} from "../src/core/staleProperties";
import { DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY } from "../src/core/cardRef";

function createBaseSettings(overrides: Partial<AlignSettings> = {}): AlignSettings {
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

describe("Empirical Challenger: isTrelloUrl Stress Harness", () => {
	describe("IP Addresses (IPv4 / IPv6)", () => {
		test("rejects IPv4 addresses as non-Trello URLs", () => {
			const ips = [
				"http://127.0.0.1/cover.jpg",
				"http://192.168.1.1/trello.com",
				"https://8.8.8.8/cover.png",
				"http://0.0.0.0",
				"http://10.0.0.1:8080/image.jpg",
			];
			for (const ip of ips) {
				expect(isTrelloUrl(ip), `Expected false for ${ip}`).toBe(false);
			}
		});

		test("rejects IPv6 addresses as non-Trello URLs", () => {
			const ipv6s = [
				"http://[::1]/cover.jpg",
				"http://[2001:db8::1]/trello.com",
				"https://[::ffff:192.0.2.128]:8080/image.png",
				"http://[fe80::1]/cover.jpg",
			];
			for (const ip of ipv6s) {
				expect(isTrelloUrl(ip), `Expected false for ${ip}`).toBe(false);
			}
		});
	});

	describe("Query Parameters and Hash Fragments", () => {
		test("accepts valid Trello URLs carrying query parameters and hash fragments", () => {
			const validUrls = [
				"https://trello-attachments.s3.amazonaws.com/5a123/cover.jpg?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Signature=vjbyPxybdZaNmGa%2ByT272YEAiv4%3D#details",
				"https://trello.com/c/shortLink/card-title?filter=due:week#comment-12345",
				"https://api.trello.com/1/cards/abc/attachments/xyz?download=true",
				"https://trello-backgrounds.s3.eu-west-1.amazonaws.com/bg.png?version=2#top",
			];
			for (const url of validUrls) {
				expect(isTrelloUrl(url), `Expected true for ${url}`).toBe(true);
			}
		});

		test("rejects attacker URLs attempting query/hash deception", () => {
			const deceptiveUrls = [
				"https://attacker.com/?redirect=https://trello.com",
				"https://attacker.com/#https://trello.com",
				"https://attacker.com/path?trello.com",
				"https://example.org/download.jpg?url=https://trello-attachments.s3.amazonaws.com/5a123/cover.jpg",
				"https://attacker.com/trello.com/cover.jpg",
			];
			for (const url of deceptiveUrls) {
				expect(isTrelloUrl(url), `Expected false for ${url}`).toBe(false);
			}
		});
	});

	describe("Malformed, Invalid, and Protocol-Relative URLs", () => {
		test("rejects malformed and non-HTTP(S) URLs without throwing", () => {
			const malformed = [
				"http://",
				"https://",
				"http:///path",
				"https://trello.com:999999999/",
				"http://[invalid-ipv6]/",
				"javascript:alert('xss')",
				"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
				"blob:https://trello.com/12345",
				"file:///C:/Users/Trois/cover.jpg",
				"custom-protocol://trello.com",
			];
			for (const url of malformed) {
				expect(isTrelloUrl(url), `Expected false for ${url}`).toBe(false);
			}
		});

		test("rejects protocol-relative URLs as non-remote-HTTP(S)", () => {
			const protocolRelative = [
				"//trello.com/cover.jpg",
				"//trello-attachments.s3.amazonaws.com/cover.jpg",
				"//api.trello.com/test",
			];
			for (const url of protocolRelative) {
				expect(isTrelloUrl(url), `Expected false for ${url}`).toBe(false);
			}
		});
	});

	describe("Local Windows Paths and Obsidian Wikilinks", () => {
		test("rejects local Windows paths (absolute, drive letter, UNC, relative)", () => {
			const paths = [
				"C:\\Users\\Trois\\Pictures\\cover.jpg",
				"C:/Users/Trois/Pictures/cover.jpg",
				"D:\\banners\\cover.png",
				"\\\\server\\share\\cover.jpg",
				"..\\assets\\banner.png",
				"assets/banners/landscape.png",
				"./cover.jpg",
			];
			for (const p of paths) {
				expect(isTrelloUrl(p), `Expected false for ${p}`).toBe(false);
			}
		});

		test("rejects Obsidian wikilinks with aliases, dimensions, or paths", () => {
			const wikilinks = [
				"[[cover.jpg]]",
				"[[cover.jpg|300]]",
				"[[cover.jpg|300x200]]",
				"[[attachments/cover.jpg|My Cover Title]]",
				"[[assets/subfolder/banner.png]]",
				"![[cover.jpg]]",
				"![[cover.jpg|300]]",
				"![[attachments/landscape.png|100x50]]",
				"[[https://trello.com/cover.jpg]]",
				"![[https://trello.com/cover.jpg]]",
			];
			for (const wl of wikilinks) {
				expect(isTrelloUrl(wl), `Expected false for ${wl}`).toBe(false);
			}
		});
	});

	describe("Attacker Subdomains and Lookalike Domains", () => {
		test("rejects spoofed attacker subdomains and lookalikes", () => {
			const lookalikes = [
				"https://trello.com.attacker.com/cover.jpg",
				"https://attacker.com/fake.trello.com/test",
				"https://trello-attachments.s3.amazonaws.com.attacker.com/file.png",
				"https://fake-trello.com/cover.jpg",
				"https://trello-clone.org/cover.jpg",
				"https://not-trello.com/pic.png",
				"https://trello.org/cover.jpg",
				"https://trello.net/cover.jpg",
				"https://trello.co/cover.jpg",
			];
			for (const url of lookalikes) {
				expect(isTrelloUrl(url), `Expected false for ${url}`).toBe(false);
			}
		});
	});
});

describe("Empirical Challenger: detectStaleChanges Combinatorial & Purity Stress Harness", () => {
	test("purity and immutability: deeply frozen inputs remain unmodified across 100 consecutive calls", () => {
		const frozenSettings: AlignSettings = Object.freeze({
			syncDue: false,
			dueFrontmatterKey: "trello_due",
			syncLabels: false,
			labelsFrontmatterKey: "trello_labels",
			syncMembers: false,
			membersFrontmatterKey: "trello_members",
			syncCustomFields: false,
			customFieldsFrontmatterKey: "trello_custom_fields",
			syncAttachments: false,
			attachmentsFrontmatterKey: "trello_attachments",
			syncLinkedCards: false,
			linkedCardsFrontmatterKey: "trello_linked_cards",
			syncCardCover: false,
			coverFrontmatterKey: "banner",
			writeTrelloPluginNoteId: true,
			syncChecklists: false,
			checklistHeading: "## Checklists",
			labelPropertySync: false,
			labelPropertyMappings: Object.freeze([{ key: "status", values: Object.freeze(["done"]) }]),
			obsoleteLabelPropertyKeys: Object.freeze(["legacy_priority"]),
			keyMigrations: Object.freeze({ old_prio: "prio" }),
		});

		const frozenFrontmatter = Object.freeze({
			trello_board_card_id: "board1;card1",
			trello_due: "2026-10-31",
			trello_labels: Object.freeze(["urgent"]),
			trello_members: Object.freeze(["alice"]),
			trello_custom_fields: Object.freeze({ Prio: "1" }),
			trello_attachments: Object.freeze(["https://trello.com/a1"]),
			trello_linked_cards: Object.freeze(["card2"]),
			banner: "https://trello-attachments.s3.amazonaws.com/cover.jpg",
			status: "done",
			legacy_priority: "high",
			old_prio: "medium",
			unrelated_user_key: "preserved_val",
		});

		const baseline = detectStaleChanges({
			frontmatter: frozenFrontmatter as Record<string, unknown>,
			hasCardRef: true,
			hasChecklistSection: true,
			settings: frozenSettings,
		});

		for (let i = 0; i < 100; i++) {
			const result = detectStaleChanges({
				frontmatter: frozenFrontmatter as Record<string, unknown>,
				hasCardRef: true,
				hasChecklistSection: true,
				settings: frozenSettings,
			});
			expect(result).toEqual(baseline);
		}
	});

	test("combinatorial stress: all 1024 flag combinations with fully populated frontmatter", () => {
		// 10 boolean flags
		const flags = [
			"syncDue",
			"syncLabels",
			"syncMembers",
			"syncCustomFields",
			"syncAttachments",
			"syncLinkedCards",
			"syncCardCover",
			"writeTrelloPluginNoteId",
			"syncChecklists",
			"labelPropertySync",
		] as const;

		const fullFrontmatter: Record<string, unknown> = {
			trello_board_card_id: "b1;c1",
			trello_due: "2026-10-31",
			trello_labels: ["bug"],
			trello_members: ["alice"],
			trello_custom_fields: { Effort: 2 },
			trello_attachments: ["https://trello.com/att"],
			trello_linked_cards: ["c2"],
			banner: "https://trello-attachments.s3.amazonaws.com/cover.jpg",
			[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]: "note123",
			mapped_status: "in-progress",
			obsolete_key: "legacy",
			old_key: "val",
		};

		const numCombinations = 1 << flags.length; // 1024
		expect(numCombinations).toBe(1024);

		for (let mask = 0; mask < numCombinations; mask++) {
			const overrides: Record<string, boolean> = {};
			for (let f = 0; f < flags.length; f++) {
				overrides[flags[f]!] = (mask & (1 << f)) !== 0;
			}

			const settings = createBaseSettings({
				...overrides,
				labelPropertyMappings: [{ key: "mapped_status", values: ["in-progress"] }],
				obsoleteLabelPropertyKeys: ["obsolete_key"],
				keyMigrations: { old_key: "new_key" },
			});

			const changes = detectStaleChanges({
				frontmatter: fullFrontmatter,
				hasCardRef: true,
				hasChecklistSection: true,
				settings,
			});

			// Invariant 1: Valid categories
			for (const change of changes) {
				expect(ALIGN_CATEGORIES).toContain(change.category);
			}

			// Invariant 2: For remove mutations, all keys MUST exist in frontmatter (or checklist heading)
			for (const change of changes) {
				if (change.action === "remove") {
					for (const key of change.keys) {
						if (change.category === "checklist-section") {
							expect(key).toBe(settings.checklistHeading);
						} else {
							expect(key in fullFrontmatter, `Key ${key} in category ${change.category} must exist in frontmatter`).toBe(true);
						}
					}
				} else if (change.action === "migrate") {
					expect(change.category).toBe("key-migration");
					for (const key of change.keys) {
						expect(key in fullFrontmatter).toBe(true);
						expect(change.migrations).toBeDefined();
						expect(change.migrations![key]).toBeDefined();
					}
				} else if (change.action === "add") {
					expect(change.category).toBe("missing-plugin-note-id");
				}
			}

			// Invariant 3: Mutual exclusivity of attachments and linked-cards keys
			const attachmentsChange = changes.find((c) => c.category === "attachments");
			const linkedCardsChange = changes.find((c) => c.category === "linked-cards");
			if (attachmentsChange && linkedCardsChange) {
				const overlap = attachmentsChange.keys.filter((k) => linkedCardsChange.keys.includes(k));
				expect(overlap).toEqual([]);
			}
		}
	});

	test("combinatorial stress: all 1024 flag combinations with completely empty frontmatter ({})", () => {
		const flags = [
			"syncDue",
			"syncLabels",
			"syncMembers",
			"syncCustomFields",
			"syncAttachments",
			"syncLinkedCards",
			"syncCardCover",
			"writeTrelloPluginNoteId",
			"syncChecklists",
			"labelPropertySync",
		] as const;

		const numCombinations = 1 << flags.length; // 1024

		for (let mask = 0; mask < numCombinations; mask++) {
			const overrides: Record<string, boolean> = {};
			for (let f = 0; f < flags.length; f++) {
				overrides[flags[f]!] = (mask & (1 << f)) !== 0;
			}

			const settings = createBaseSettings({
				...overrides,
				labelPropertyMappings: [{ key: "mapped_status", values: ["in-progress"] }],
				obsoleteLabelPropertyKeys: ["obsolete_key"],
				keyMigrations: { old_key: "new_key" },
			});

			const changes = detectStaleChanges({
				frontmatter: {},
				hasCardRef: true,
				hasChecklistSection: false,
				settings,
			});

			// On empty frontmatter with hasChecklistSection=false, NO key removals should ever be emitted!
			const removals = changes.filter((c) => c.action === "remove");
			expect(removals, `Expected zero removals on empty frontmatter for mask ${mask}`).toEqual([]);

			// Migrations should be zero
			const migrations = changes.filter((c) => c.action === "migrate");
			expect(migrations).toEqual([]);

			// Only missing-plugin-note-id can be emitted if writeTrelloPluginNoteId is true and hasCardRef is true
			if (settings.writeTrelloPluginNoteId) {
				expect(changes).toEqual([
					{
						category: "missing-plugin-note-id",
						action: "add",
						keys: [DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY],
					},
				]);
			} else {
				expect(changes).toEqual([]);
			}
		}
	});

	test("verification of absent keys: frontmatter with disjoint keys produces zero removals", () => {
		const disjointFrontmatter = {
			author: "Trois",
			title: "Notes on Architecture",
			created_at: "2026-10-18",
			rating: 10,
		};

		// Turn off all sync toggles
		const allDisabledSettings = createBaseSettings({
			syncDue: false,
			syncLabels: false,
			syncMembers: false,
			syncCustomFields: false,
			syncAttachments: false,
			syncLinkedCards: false,
			syncCardCover: false,
			writeTrelloPluginNoteId: false,
			syncChecklists: false,
			labelPropertySync: false,
			labelPropertyMappings: [{ key: "mapped_key", values: ["val"] }],
			obsoleteLabelPropertyKeys: ["obsolete_key"],
			keyMigrations: { migration_source: "migration_target" },
		});

		const changes = detectStaleChanges({
			frontmatter: disjointFrontmatter,
			hasCardRef: false,
			hasChecklistSection: false,
			settings: allDisabledSettings,
		});

		// None of the standard keys exist in disjointFrontmatter, so no removals must be generated
		expect(changes).toEqual([]);
	});

	test("edge case assessment: scheme casing in isTrelloUrl", () => {
		// RFC 3986 specifies URI schemes are case-insensitive.
		// Standard lowercase URLs always return true
		expect(isTrelloUrl("https://trello.com/c/123/title")).toBe(true);
		expect(isTrelloUrl("http://trello.com/test")).toBe(true);

		// Current implementation uses trimmed.startsWith("http://") which is case-sensitive
		const upperSchemeUrl = "HTTPS://trello.com/c/123/title";
		const isRecognized = isTrelloUrl(upperSchemeUrl);
		// Document empirical behavior: returns false due to case-sensitive prefix check
		expect(isRecognized).toBe(false);
	});

	test("edge case assessment: inherited prototype properties vs own properties", () => {
		// When frontmatter is an empty object ({}) and a setting key equals an Object.prototype method name:
		const protoSettings = createBaseSettings({
			syncDue: false,
			dueFrontmatterKey: "toString",
		});
		const emptyFrontmatter: Record<string, unknown> = {};

		const changes = detectStaleChanges({
			frontmatter: emptyFrontmatter,
			hasCardRef: true,
			settings: protoSettings,
		});

		// "toString in {}" evaluates to true in JS because of Object.prototype.toString
		// Document empirical behavior: emits removal because "in" checks prototype chain
		expect(changes).toHaveLength(1);
		expect(changes[0]?.keys).toEqual(["toString"]);
	});
});

