import { describe, expect, test, vi, beforeEach } from "vitest";

const { FakeHtmlElement, MockSetting, mockSettingsCreated, alignCalls } = vi.hoisted(() => {
	class FakeHtmlElement {
		children: FakeHtmlElement[] = [];
		classList = new Set<string>();
		attributes: Record<string, string> = {};
		text = "";
		value = "";
		scrollTop = 0;

		constructor(public tagName: string = "div") {}

		empty(): void {
			this.children = [];
			this.text = "";
		}

		addClass(...cls: string[]): this {
			for (const c of cls) for (const part of c.split(" ")) if (part) this.classList.add(part);
			return this;
		}

		removeClass(...cls: string[]): this {
			for (const c of cls) for (const part of c.split(" ")) if (part) this.classList.delete(part);
			return this;
		}

		setAttribute(name: string, val: string): void {
			this.attributes[name] = val;
		}

		getAttribute(name: string): string | undefined {
			return this.attributes[name];
		}

		createEl(tag: string, options?: { cls?: string; text?: string }): FakeHtmlElement {
			const el = new FakeHtmlElement(tag);
			if (options?.cls) el.addClass(options.cls);
			if (options?.text) el.text = options.text;
			this.children.push(el);
			return el;
		}

		createDiv(options?: { cls?: string }): FakeHtmlElement {
			return this.createEl("div", options);
		}

		createSpan(options?: { cls?: string; text?: string }): FakeHtmlElement {
			return this.createEl("span", options);
		}

		querySelectorAll(_selector: string): FakeHtmlElement[] {
			return [];
		}

		addEventListener(_event: string, _handler: (e: unknown) => void): void {}
	}

	const mockSettingsCreated: any[] = [];
	const alignCalls: Array<{ plugin: unknown; category: string }> = [];

	class MockSetting {
		cls = "";
		name = "";
		desc = "";
		buttonText = "";
		buttonTooltip = "";
		buttonClickHandler: (() => void) | null = null;
		controlEl = new FakeHtmlElement("div");

		constructor(public container: unknown) {
			mockSettingsCreated.push(this);
		}

		setClass(cls: string): this {
			this.cls = cls;
			return this;
		}

		setName(name: string): this {
			this.name = name;
			return this;
		}

		setDesc(desc: string): this {
			this.desc = desc;
			return this;
		}

		addButton(cb: (btn: any) => void): this {
			const btn = {
				setButtonText: (text: string) => {
					this.buttonText = text;
					return btn;
				},
				setTooltip: (tooltip: string) => {
					this.buttonTooltip = tooltip;
					return btn;
				},
				onClick: (handler: () => void) => {
					this.buttonClickHandler = handler;
					return btn;
				},
			};
			cb(btn);
			return this;
		}

		addToggle(cb: (t: any) => void): this {
			cb({
				setValue: () => ({ onChange: () => {} }),
				onChange: () => {},
			});
			return this;
		}

		addSearch(cb: (s: any) => void): this {
			cb({
				setPlaceholder: () => ({ setValue: () => ({ onChange: () => {} }) }),
				setValue: () => ({ onChange: () => {} }),
				onChange: () => {},
			});
			return this;
		}
	}

	return { FakeHtmlElement, MockSetting, mockSettingsCreated, alignCalls };
});

vi.mock("obsidian", () => {
	const createDummyEl = () => ({
		empty: () => {},
		addClass: () => {},
		createEl: () => createDummyEl(),
		createDiv: () => createDummyEl(),
		addEventListener: () => {},
		focus: () => {},
	});

	return {
		Notice: class Notice {
			constructor(public message: string) {}
		},
		Modal: class Modal {
			contentEl = createDummyEl();
			constructor(public _app: unknown) {}
			open(): void {}
			close(): void {}
		},
		FuzzySuggestModal: class FuzzySuggestModal {
			constructor(public _app: unknown) {}
			setPlaceholder(_text: string): void {}
		},
		SuggestModal: class SuggestModal {
			constructor(public _app: unknown) {}
			setPlaceholder(_text: string): void {}
		},
		PluginSettingTab: class PluginSettingTab {
			containerEl = new FakeHtmlElement("div");
			constructor(public app: unknown, public plugin: unknown) {}
			display(): void {}
			hide(): void {}
		},
		Setting: MockSetting,
		TFile: class TFile {
			constructor(public path: string = "") {}
		},
		AbstractInputSuggest: class AbstractInputSuggest {
			constructor(public app: unknown, public inputEl?: unknown) {}
		},
		requestUrl: async () => ({ status: 200, text: "" }),
	};
});

vi.mock("../src/commands/alignCommand", async () => {
	const actual = await vi.importActual<any>("../src/commands/alignCommand");
	return {
		...actual,
		alignNotesWithSettings: vi.fn(async (plugin: unknown, category: string) => {
			alignCalls.push({ plugin, category });
		}),
	};
});

import { normalizeSettings, type TrelloVaultSyncSettings } from "../src/settings/types";
import { TrelloVaultSyncSettingsTab } from "../src/settings/SettingsTab";
import { ALIGN_CATEGORIES, type AlignCategory } from "../src/core/staleProperties";
import { FakeVault } from "./fakes";
import { TFile } from "obsidian";

describe("Milestone 5 Empirical Challenger — Settings & Reversibility Fuzzing", () => {
	beforeEach(() => {
		mockSettingsCreated.length = 0;
		alignCalls.length = 0;
	});

	describe("1. Fuzz & Boundary Testing on normalizeSettings", () => {
		test("cleanUpDuringSync handles corrupted primitives and defaults", () => {
			// Defaults to true when omitted, undefined, or null
			expect(normalizeSettings({}).cleanUpDuringSync).toBe(true);
			expect(normalizeSettings({ cleanUpDuringSync: undefined }).cleanUpDuringSync).toBe(true);
			expect(normalizeSettings({ cleanUpDuringSync: null as unknown as boolean }).cleanUpDuringSync).toBe(true);

			// Explicit booleans preserved
			expect(normalizeSettings({ cleanUpDuringSync: false }).cleanUpDuringSync).toBe(false);
			expect(normalizeSettings({ cleanUpDuringSync: true }).cleanUpDuringSync).toBe(true);

			// Falsy non-boolean values evaluate to !== false => true (matching codebase idiom)
			expect(normalizeSettings({ cleanUpDuringSync: 0 as unknown as boolean }).cleanUpDuringSync).toBe(true);
			expect(normalizeSettings({ cleanUpDuringSync: "" as unknown as boolean }).cleanUpDuringSync).toBe(true);
			expect(normalizeSettings({ cleanUpDuringSync: NaN as unknown as boolean }).cleanUpDuringSync).toBe(true);

			// Truthy non-booleans evaluate to !== false => true
			expect(normalizeSettings({ cleanUpDuringSync: "false" as unknown as boolean }).cleanUpDuringSync).toBe(true);
			expect(normalizeSettings({ cleanUpDuringSync: 1 as unknown as boolean }).cleanUpDuringSync).toBe(true);
			expect(normalizeSettings({ cleanUpDuringSync: {} as unknown as boolean }).cleanUpDuringSync).toBe(true);
			expect(normalizeSettings({ cleanUpDuringSync: [] as unknown as boolean }).cleanUpDuringSync).toBe(true);
			expect(normalizeSettings({ cleanUpDuringSync: (() => {}) as unknown as boolean }).cleanUpDuringSync).toBe(true);
		});

		test("keyMigrations rejects all non-plain-object types", () => {
			const badTypes: unknown[] = [
				null,
				undefined,
				123,
				-45.67,
				"",
				"simple string",
				true,
				false,
				[],
				["a", "b"],
				() => {},
				Symbol("sym"),
				new Date(),
				/regex/,
				new Set([1, 2]),
				new Map([["a", "b"]]),
			];

			for (const bad of badTypes) {
				const normalized = normalizeSettings({ keyMigrations: bad as Record<string, string> });
				expect(normalized.keyMigrations).toEqual({});
			}
		});

		test("keyMigrations filters non-string values and empty/whitespace keys/values", () => {
			const dirty = {
				valid: "target",
				"  spaced_key  ": "  spaced_target  ",
				"": "target_for_empty",
				"   ": "target_for_spaces",
				"\t\n": "target_for_newlines",
				empty_val: "",
				spaces_val: "   ",
				newlines_val: "\r\n\t",
				num_val: 12345 as unknown as string,
				bool_val: true as unknown as string,
				null_val: null as unknown as string,
				undef_val: undefined as unknown as string,
				obj_val: { nested: "val" } as unknown as string,
				arr_val: ["arr"] as unknown as string,
			};

			const normalized = normalizeSettings({ keyMigrations: dirty });
			expect(normalized.keyMigrations).toEqual({
				valid: "target",
				spaced_key: "spaced_target",
			});
		});

		test("keyMigrations handles prototype pollution attempts and reserved property names safely", () => {
			// 1. __proto__ in JSON parse
			const parsedPayload = JSON.parse('{"keyMigrations": {"__proto__": "polluted", "old_due": "new_due"}}');
			const normalized = normalizeSettings(parsedPayload);
			expect(normalized.keyMigrations.old_due).toBe("new_due");
			expect((Object.prototype as any).polluted).toBeUndefined();

			// 2. constructor / toString / valueOf as migration keys
			const reservedKeys = {
				constructor: "my_constructor",
				toString: "my_toString",
				valueOf: "my_valueOf",
			};
			const res = normalizeSettings({ keyMigrations: reservedKeys });
			expect(res.keyMigrations.constructor).toBe("my_constructor");
			expect(res.keyMigrations.toString).toBe("my_toString");
			expect(res.keyMigrations.valueOf).toBe("my_valueOf");

			// Ensure global Object.prototype is unpolluted
			expect(({} as any).my_constructor).toBeUndefined();
			expect({}.toString()).toBe("[object Object]");

			// 3. Object with null prototype
			const nullProto = Object.create(null);
			nullProto["source"] = "dest";
			const fromNullProto = normalizeSettings({ keyMigrations: nullProto });
			expect(fromNullProto.keyMigrations).toEqual({ source: "dest" });
		});

		test("keyMigrations handles extreme strings (length, unicode, emojis, control chars)", () => {
			const hugeKey = "k".repeat(10_000);
			const hugeVal = "v".repeat(10_000);
			const emojiKey = "🏷️_trello_card_due_date_🗓️";
			const emojiVal = "📅_obsidian_due_📌";
			const yamlTrickyKey = "trello:due.key[0]";
			const yamlTrickyVal = "obsidian.due::clean";

			const extreme = {
				[hugeKey]: hugeVal,
				[emojiKey]: emojiVal,
				[yamlTrickyKey]: yamlTrickyVal,
				" \u200BzeroWidthSpace\u200B ": " \u200BtargetVal\u200B ",
			};

			const normalized = normalizeSettings({ keyMigrations: extreme });
			expect(normalized.keyMigrations[hugeKey]).toBe(hugeVal);
			expect(normalized.keyMigrations[emojiKey]).toBe(emojiVal);
			expect(normalized.keyMigrations[yamlTrickyKey]).toBe(yamlTrickyVal);
			expect(normalized.keyMigrations["\u200BzeroWidthSpace\u200B"]).toBe("\u200BtargetVal\u200B");
		});

		test("keyMigrations handles circular references without stack overflow", () => {
			const circular: any = {};
			circular.self = circular;
			circular.valid = "valid_target";

			// Circular reference must not throw or recurse infinitely
			expect(() => normalizeSettings({ keyMigrations: circular })).not.toThrow();
			const res = normalizeSettings({ keyMigrations: circular });
			expect(res.keyMigrations).toEqual({ valid: "valid_target" });
		});

		test("obsoleteLabelPropertyKeys rejects non-array inputs", () => {
			const badInputs: unknown[] = [
				null,
				undefined,
				"single_string",
				123,
				true,
				false,
				{ 0: "fake_arr" },
				() => {},
				Symbol("sym"),
				new Set(["a"]),
			];

			for (const bad of badInputs) {
				const res = normalizeSettings({ obsoleteLabelPropertyKeys: bad as string[] });
				expect(res.obsoleteLabelPropertyKeys).toEqual([]);
			}
		});

		test("obsoleteLabelPropertyKeys filters corrupted elements and trims whitespace", () => {
			const dirty = [
				null,
				undefined,
				123,
				true,
				false,
				{},
				[],
				Symbol("x"),
				"",
				"   ",
				"\t\r\n",
				"  valid_key_1  ",
				"valid_key_2",
				"  🏷️_legacy_label_prop  ",
			];

			const res = normalizeSettings({ obsoleteLabelPropertyKeys: dirty as string[] });
			expect(res.obsoleteLabelPropertyKeys).toEqual([
				"valid_key_1",
				"valid_key_2",
				"🏷️_legacy_label_prop",
			]);
		});

		test("obsoleteLabelPropertyKeys handles sparse and circular arrays", () => {
			// Sparse array: holes should be ignored
			const sparse = new Array(5);
			sparse[1] = "  sparse_item  ";
			sparse[3] = 42;
			expect(normalizeSettings({ obsoleteLabelPropertyKeys: sparse }).obsoleteLabelPropertyKeys).toEqual([
				"sparse_item",
			]);

			// Circular array
			const circArr: any[] = ["item1"];
			circArr.push(circArr);
			circArr.push("item2");
			expect(() => normalizeSettings({ obsoleteLabelPropertyKeys: circArr })).not.toThrow();
			const res = normalizeSettings({ obsoleteLabelPropertyKeys: circArr });
			expect(res.obsoleteLabelPropertyKeys).toEqual(["item1", "item2"]);
		});

		test("normalizeSettings survives full circular root settings object", () => {
			const circularRoot: any = {
				cleanUpDuringSync: false,
			};
			circularRoot.self = circularRoot;

			expect(() => normalizeSettings(circularRoot)).not.toThrow();
			const res = normalizeSettings(circularRoot);
			expect(res.cleanUpDuringSync).toBe(false);
			expect(res.obsoleteLabelPropertyKeys).toEqual([]);
			expect(res.keyMigrations).toEqual({});
		});
	});

	describe("2. Banner Note-Count Scanner & Category Mapping in SettingsTab", () => {
		function createMockAppAndPlugin(
			settingsPatch: Partial<TrelloVaultSyncSettings>,
			notesData: Record<string, { content: string }>,
			cachedHeadings: Record<string, string[]> = {},
		) {
			const settings = normalizeSettings(settingsPatch);
			const fakeVault = new FakeVault(notesData, settings.cardRefFrontmatterKey);

			const fileMap = new Map<string, TFile>();
			for (const path of Object.keys(notesData)) {
				const file = Object.assign(new (TFile as any)(), { path }) as TFile;
				fileMap.set(path, file);
			}

			const mockApp: any = {
				vault: {
					getAbstractFileByPath: (path: string) => fileMap.get(path) ?? null,
				},
				metadataCache: {
					getFileCache: (file: TFile) => {
						const headings = cachedHeadings[file.path];
						if (!headings) return null;
						return {
							headings: headings.map((h) => ({ heading: h, level: 2 })),
						};
					},
				},
			};

			const mockPlugin: any = {
				app: mockApp,
				settings,
				vault: fakeVault,
				saveSettings: vi.fn(),
			};

			const tab = new TrelloVaultSyncSettingsTab(mockApp, mockPlugin);
			return { mockApp, mockPlugin, tab, fakeVault };
		}

		test("clean vault with no stale properties produces 0 counts across all categories", () => {
			const notes = {
				"note1.md": { content: "---\ntrello_plugin_note_id: card123\n---\nClean note 1" },
				"note2.md": { content: "---\ntrello_plugin_note_id: card456\n---\nClean note 2" },
			};

			const { tab } = createMockAppAndPlugin(
				{
					syncDue: false,
					syncLabels: false,
					syncMembers: false,
					syncCustomFields: false,
					syncAttachments: false,
					syncCardCover: false,
					syncChecklists: false,
					writeTrelloPluginNoteId: true, // note ID is on, so existing ID is not stale
				},
				notes,
			);

			const counts = (tab as any).getStaleCategoryCounts();
			for (const cat of ALIGN_CATEGORIES) {
				expect(counts[cat]).toBe(0);
			}
		});

		test("scans notes and counts stale properties according to disabled toggle states", () => {
			const notes = {
				// Note 1: has due, labels, members, custom-fields, attachments + linked-cards, remote cover
				"note1.md": {
					content: [
						"---",
						"trello_plugin_note_id: c1",
						'trello_due: "2026-10-18"',
						'trello_labels: ["urgent"]',
						'trello_members: ["alice"]',
						"trello_custom_fields:",
						'  Priority: "High"',
						'trello_attachments: ["doc.pdf"]',
						'trello_linked_cards: ["c2"]',
						'banner: "https://trello-attachments.s3.amazonaws.com/img.png"',
						"---",
						"Body content",
					].join("\n"),
				},
				// Note 2: has due, local cover (must NOT count as cover!), and checklist heading
				"note2.md": {
					content: [
						"---",
						"trello_plugin_note_id: c2",
						'trello_due: "2026-10-19"',
						'banner: "assets/banners/landscape.png"',
						"---",
						"## Checklists\n- [ ] Task",
					].join("\n"),
				},
				// Note 3: third-party note ID stale when writeTrelloPluginNoteId is false
				"note3.md": {
					content: [
						"---",
						"trello_plugin_note_id: c3",
						"---",
						"Clean body",
					].join("\n"),
				},
			};

			const headings = {
				"note2.md": ["Checklists"],
			};

			const { tab } = createMockAppAndPlugin(
				{
					syncDue: false,
					syncLabels: false,
					syncMembers: false,
					syncCustomFields: false,
					syncAttachments: false,
					syncLinkedCards: false,
					syncCardCover: false,
					syncChecklists: false,
					checklistHeading: "## Checklists",
					writeTrelloPluginNoteId: false, // disabled -> note ID is stale!
				},
				notes,
				headings,
			);

			const counts = (tab as any).getStaleCategoryCounts();
			expect(counts.due).toBe(2); // note1 and note2
			expect(counts.labels).toBe(1); // note1
			expect(counts.members).toBe(1); // note1
			expect(counts["custom-fields"]).toBe(1); // note1
			// Note 1 has both trello_attachments and trello_linked_cards, but counts are per-note:
			expect(counts.attachments).toBe(1); // note1
			expect(counts["linked-cards"]).toBe(0); // subsumed under attachments when syncAttachments is false
			// Remote Trello cover in note1 counted; local cover in note2 ignored:
			expect(counts.cover).toBe(1);
			expect(counts["checklist-section"]).toBe(1); // note2
			expect(counts["plugin-note-id"]).toBe(3); // note1, note2, note3
		});

		test("resiliently handles notes with missing frontmatter or prose-only content", () => {
			const notes = {
				"prose.md": { content: "Just plain text without any YAML frontmatter." },
				"empty.md": { content: "" },
			};

			const { tab } = createMockAppAndPlugin(
				{
					syncDue: false,
					syncLabels: false,
				},
				notes,
			);

			expect(() => (tab as any).getStaleCategoryCounts()).not.toThrow();
			const counts = (tab as any).getStaleCategoryCounts();
			for (const cat of ALIGN_CATEGORIES) {
				expect(counts[cat]).toBe(0);
			}
		});

		test("strictly excludes notes residing in excludedFolders from banner count scan", () => {
			const notes = {
				"Included/note1.md": { content: "---\ntrello_plugin_note_id: c1\ntrello_due: '2026-10-18'\n---\n" },
				"Archive/stale.md": { content: "---\ntrello_plugin_note_id: c2\ntrello_due: '2026-10-18'\n---\n" },
			};

			const { tab } = createMockAppAndPlugin(
				{
					syncDue: false,
					scope: "",
					excludedFolders: ["Archive"],
				},
				notes,
			);

			const counts = (tab as any).getStaleCategoryCounts();
			// Only Included/note1.md should be counted, Archive/stale.md is excluded
			expect(counts.due).toBe(1);
		});

		test("recovers gracefully if getCardRef throws an unexpected error", () => {
			const notes = {
				"note1.md": { content: "---\ntrello_plugin_note_id: c1\ntrello_due: '2026-10-18'\n---\n" },
			};

			const { tab, fakeVault } = createMockAppAndPlugin({ syncDue: false }, notes);

			// Sabotage getCardRef to throw
			(fakeVault as any).getCardRef = () => {
				throw new Error("Disk corruption in card ref store");
			};

			expect(() => (tab as any).getStaleCategoryCounts()).not.toThrow();
			const counts = (tab as any).getStaleCategoryCounts();
			expect(counts.due).toBe(1);
		});

		test("skips checklist scanning when checklistHeading is empty or syncChecklists is enabled", () => {
			const notes = {
				"note1.md": { content: "---\ntrello_plugin_note_id: c1\n---\nBody" },
			};
			const headings = { "note1.md": ["Checklists"] };

			// Case 1: syncChecklists: true -> no scan
			const { tab: tab1 } = createMockAppAndPlugin(
				{ syncChecklists: true, checklistHeading: "## Checklists" },
				notes,
				headings,
			);
			expect((tab1 as any).getStaleCategoryCounts()["checklist-section"]).toBe(0);

			// Case 2: checklistHeading: "" -> no scan
			const { tab: tab2 } = createMockAppAndPlugin(
				{ syncChecklists: false, checklistHeading: "" },
				notes,
				headings,
			);
			expect((tab2 as any).getStaleCategoryCounts()["checklist-section"]).toBe(0);
		});

		test("linked-cards category is scanned when attachments is enabled but linked-cards is disabled", () => {
			const notes = {
				"note1.md": {
					content: [
						"---",
						"trello_plugin_note_id: c1",
						'trello_attachments: ["file.png"]',
						'trello_linked_cards: ["c2"]',
						"---",
						"Body",
					].join("\n"),
				},
			};

			const { tab } = createMockAppAndPlugin(
				{
					syncAttachments: true,
					syncLinkedCards: false,
				},
				notes,
			);

			const counts = (tab as any).getStaleCategoryCounts();
			expect(counts.attachments).toBe(0); // syncAttachments is ON -> attachments not stale
			expect(counts["linked-cards"]).toBe(1); // syncLinkedCards is OFF -> linked cards stale!
		});

		test("checklist-section detection handles heading prefix and casing variations", () => {
			const notes = {
				"note1.md": { content: "---\ntrello_plugin_note_id: c1\n---\nBody" },
				"note2.md": { content: "---\ntrello_plugin_note_id: c2\n---\nBody" },
				"note3.md": { content: "---\ntrello_plugin_note_id: c3\n---\nBody" },
			};

			const headings = {
				"note1.md": ["Checklists"], // exact match
				"note2.md": ["checklists"], // lower case
				"note3.md": ["Other Section"], // different heading
			};

			const { tab } = createMockAppAndPlugin(
				{
					syncChecklists: false,
					checklistHeading: "## Checklists",
				},
				notes,
				headings,
			);

			const counts = (tab as any).getStaleCategoryCounts();
			expect(counts["checklist-section"]).toBe(2); // note1 and note2 match, note3 does not
		});

		test("getStaleCategoryCounts caches results and invalidates on display()", () => {
			const notes = {
				"note1.md": { content: "---\ntrello_plugin_note_id: c1\ntrello_due: '2026-10-18'\n---\n" },
			};

			const { tab } = createMockAppAndPlugin({ syncDue: false }, notes);

			const counts1 = (tab as any).getStaleCategoryCounts();
			const counts2 = (tab as any).getStaleCategoryCounts();
			expect(counts1).toBe(counts2); // exact same cached object reference

			// Simulate display() resetting cache
			(tab as any).staleCounts = null;
			const counts3 = (tab as any).getStaleCategoryCounts();
			expect(counts3).not.toBe(counts1); // fresh object reference
			expect(counts3).toEqual(counts1);
		});
	});

	describe("3. Banner Info & Rendering Logic in SettingsTab", () => {
		function createTab(settingsPatch: Partial<TrelloVaultSyncSettings>) {
			const settings = normalizeSettings(settingsPatch);
			const mockPlugin: any = {
				settings,
				vault: new FakeVault({}, settings.cardRefFrontmatterKey),
			};
			return new TrelloVaultSyncSettingsTab({} as any, mockPlugin);
		}

		test("getCleanupBannerInfo returns null when the respective sync toggle is enabled", () => {
			const tab = createTab({
				syncDue: true,
				syncLabels: true,
				syncMembers: true,
				syncCustomFields: true,
				syncAttachments: true,
				syncLinkedCards: true,
				syncCardCover: true,
				syncChecklists: true,
				writeTrelloPluginNoteId: true,
			});

			const categories: AlignCategory[] = [
				"due",
				"labels",
				"members",
				"custom-fields",
				"attachments",
				"linked-cards",
				"cover",
				"checklist-section",
				"plugin-note-id",
			];

			for (const cat of categories) {
				expect((tab as any).getCleanupBannerInfo(cat, 5)).toBeNull();
			}
		});

		test("getCleanupBannerInfo returns null for categories that do not have helper banners", () => {
			const tab = createTab({});
			const nonBannerCategories: AlignCategory[] = [
				"missing-plugin-note-id",
				"obsolete-label-property",
				"key-migration",
			];

			for (const cat of nonBannerCategories) {
				expect((tab as any).getCleanupBannerInfo(cat, 5)).toBeNull();
			}
		});

		test("getCleanupBannerInfo formats singular vs plural note counts properly", () => {
			const tab = createTab({
				syncDue: false,
				syncLabels: false,
				syncMembers: false,
				syncCustomFields: false,
				syncAttachments: false,
				syncCardCover: false,
				syncChecklists: false,
				writeTrelloPluginNoteId: false,
			});

			// Singular: 1 note
			const dueSingular = (tab as any).getCleanupBannerInfo("due", 1);
			expect(dueSingular.name).toBe("1 note still has trello_due");
			expect(dueSingular.desc).toContain("Due date sync is disabled");

			// Plural: 5 notes
			const duePlural = (tab as any).getCleanupBannerInfo("due", 5);
			expect(duePlural.name).toBe("5 notes still have trello_due");

			const coverPlural = (tab as any).getCleanupBannerInfo("cover", 3);
			expect(coverPlural.name).toBe("3 notes still have remote Trello cover URLs");
			expect(coverPlural.desc).toContain("preserving local banners");

			const checklistSingular = (tab as any).getCleanupBannerInfo("checklist-section", 1);
			expect(checklistSingular.name).toBe("1 note still has checklist sections");
		});

		test("getCleanupBannerInfo reflects custom configured frontmatter keys", () => {
			const tab = createTab({
				syncDue: false,
				dueFrontmatterKey: "custom_deadline",
				syncMembers: false,
				membersFrontmatterKey: "card_assignees",
				syncCustomFields: false,
				customFieldsFrontmatterKey: "custom_meta",
				syncCardCover: false,
				coverFrontmatterKey: "header_image",
			});

			const dueInfo = (tab as any).getCleanupBannerInfo("due", 2);
			expect(dueInfo.name).toBe("2 notes still have custom_deadline");

			const memberInfo = (tab as any).getCleanupBannerInfo("members", 1);
			expect(memberInfo.name).toBe("1 note still has card_assignees");

			const cfInfo = (tab as any).getCleanupBannerInfo("custom-fields", 4);
			expect(cfInfo.name).toBe("4 notes still have custom_meta");

			const coverInfo = (tab as any).getCleanupBannerInfo("cover", 2);
			expect(coverInfo.desc).toContain("in header_image while preserving local banners");
		});

		test("renderCleanupHelper creates Setting with banner class and wires button click", () => {
			const notes = {
				"note1.md": { content: "---\ntrello_plugin_note_id: c1\ntrello_due: '2026-10-18'\n---\n" },
				"note2.md": { content: "---\ntrello_plugin_note_id: c2\ntrello_due: '2026-10-19'\n---\n" },
			};
			const settings = normalizeSettings({ syncDue: false });
			const mockPlugin: any = {
				settings,
				vault: new FakeVault(notes, settings.cardRefFrontmatterKey),
			};
			const mockApp: any = {
				vault: { getAbstractFileByPath: () => null },
				metadataCache: { getFileCache: () => null },
			};
			const tab = new TrelloVaultSyncSettingsTab(mockApp, mockPlugin);

			const root = new FakeHtmlElement("div");
			(tab as any).renderCleanupHelper(root, "due");

			expect(mockSettingsCreated.length).toBe(1);
			const setting = mockSettingsCreated[0]!;
			expect(setting.cls).toBe("tvs-settings__cleanup-banner");
			expect(setting.name).toBe("2 notes still have trello_due");
			expect(setting.buttonText).toBe("Clean up...");
			expect(setting.buttonTooltip).toBe("Clean up Due date across 2 notes");

			// Trigger button click
			expect(setting.buttonClickHandler).toBeTypeOf("function");
			setting.buttonClickHandler!();

			// Verify alignNotesWithSettings was invoked with plugin and category
			expect(alignCalls.length).toBe(1);
			expect(alignCalls[0]!.plugin).toBe(mockPlugin);
			expect(alignCalls[0]!.category).toBe("due");
		});

		test("renderCleanupHelper does not create Setting when count is 0 or toggle is on", () => {
			const notes = {
				"note1.md": { content: "---\ntrello_plugin_note_id: c1\n---\nClean" },
			};
			const settings = normalizeSettings({ syncDue: false, syncLabels: true });
			const mockPlugin: any = {
				settings,
				vault: new FakeVault(notes, settings.cardRefFrontmatterKey),
			};
			const mockApp: any = {
				vault: { getAbstractFileByPath: () => null },
				metadataCache: { getFileCache: () => null },
			};
			const tab = new TrelloVaultSyncSettingsTab(mockApp, mockPlugin);

			const root = new FakeHtmlElement("div");

			// 1. Due date has count 0 -> no banner
			(tab as any).renderCleanupHelper(root, "due");
			expect(mockSettingsCreated.length).toBe(0);

			// 2. Labels sync is on -> getCleanupBannerInfo returns null -> no banner
			(tab as any).renderCleanupHelper(root, "labels");
			expect(mockSettingsCreated.length).toBe(0);
		});
	});
});
