import { describe, expect, test, vi, beforeEach } from "vitest";

// --- Hoisted Mocks for Obsidian Components ---
const { FakeHtmlElement, MockSetting, mockSettingsCreated, alignModalCalls } = vi.hoisted(() => {
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
	const alignModalCalls: Array<{ plugin: unknown; category?: string }> = [];

	class MockSetting {
		cls = "";
		name = "";
		desc = "";
		buttonText = "";
		buttonTooltip = "";
		buttonClickHandler: (() => void) | null = null;
		controlEl = new FakeHtmlElement("div");

		constructor(public containerEl: any) {
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

		setHeading(): this {
			return this;
		}

		addToggle(cb: (t: any) => void): this {
			cb({
				setValue: () => ({ onChange: () => {} }),
				onChange: () => {},
			});
			return this;
		}

		addButton(cb: (b: any) => void): this {
			const btn = {
				setButtonText: (t: string) => {
					this.buttonText = t;
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
	}

	return { FakeHtmlElement, MockSetting, mockSettingsCreated, alignModalCalls };
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
			static lastNotice: string | null = null;
			constructor(public message: string) {
				Notice.lastNotice = message;
			}
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
		alignNotesWithSettings: vi.fn(async (plugin: unknown, category?: string) => {
			alignModalCalls.push({ plugin, category });
		}),
	};
});

import {
	DEFAULT_ATTACHMENTS_KEY,
	DEFAULT_COVER_KEY,
	DEFAULT_LINKED_CARDS_KEY,
} from "../src/core/attachmentRef";
import {
	DEFAULT_CARD_REF_KEY,
	DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY,
} from "../src/core/cardRef";
import { DEFAULT_CHECKLIST_HEADING } from "../src/core/checklistRef";
import { DEFAULT_CUSTOM_FIELDS_KEY } from "../src/core/customFieldRef";
import { DEFAULT_DUE_KEY } from "../src/core/dueRef";
import { DEFAULT_LABELS_KEY } from "../src/core/labelRef";
import { DEFAULT_MEMBERS_KEY } from "../src/core/memberRef";
import { OperationGuard } from "../src/core/operationGuard";
import {
	detectStaleChanges,
	isTrelloUrl,
	type AlignSettings,
} from "../src/core/staleProperties";
import { alignNote, alignNotes } from "../src/features/alignNotes";
import { syncNote, syncNoteWithCard, type NoteSyncOptions } from "../src/features/syncNote";
import { TrelloVaultSyncSettingsTab } from "../src/settings/SettingsTab";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { TrelloClient, TrelloError } from "../src/trello/client";
import { FakeVault, at, card, recordingReporter, routedTransport } from "./fakes";

// --- Extended FakeVault with KeepMtime Tracking ---

class TrackingFakeVault extends FakeVault {
	private readonly mtimes = new Map<string, number>();
	public writeCalls: Array<{ path: string; keepMtime?: boolean }> = [];
	public writeFrontmatterCalls: Array<{ path: string; keepMtime?: boolean }> = [];

	constructor(files: Record<string, { content: string; mtime?: number }> = {}, cardRefKey?: string) {
		super(files, cardRefKey);
		for (const [path, f] of Object.entries(files)) {
			this.mtimes.set(path, f.mtime ?? 0);
		}
	}

	override async write(note: any, content: string, options?: { keepMtime?: boolean }): Promise<void> {
		this.writeCalls.push({ path: note.path, keepMtime: options?.keepMtime });
		const prevMtime = this.mtimes.get(note.path) ?? note.mtime ?? 0;
		const nextMtime = options?.keepMtime ? prevMtime : prevMtime + 1000;
		this.mtimes.set(note.path, nextMtime);
		await super.write(note, content);
		(this as any).files.set(note.path, { content, mtime: nextMtime });
	}

	override async writeFrontmatter(
		note: any,
		mutate: (frontmatter: Record<string, unknown>) => void,
		options?: { keepMtime?: boolean },
	): Promise<void> {
		this.writeFrontmatterCalls.push({ path: note.path, keepMtime: options?.keepMtime });
		await super.writeFrontmatter(note, mutate, options);
	}
}

// --- Default Settings Helper ---

function createTestSettings(overrides: Partial<AlignSettings> = {}): AlignSettings {
	return {
		syncDue: true,
		dueFrontmatterKey: DEFAULT_DUE_KEY,
		syncLabels: true,
		labelsFrontmatterKey: DEFAULT_LABELS_KEY,
		syncMembers: true,
		membersFrontmatterKey: DEFAULT_MEMBERS_KEY,
		syncCustomFields: true,
		customFieldsFrontmatterKey: DEFAULT_CUSTOM_FIELDS_KEY,
		syncAttachments: true,
		attachmentsFrontmatterKey: DEFAULT_ATTACHMENTS_KEY,
		syncLinkedCards: true,
		linkedCardsFrontmatterKey: DEFAULT_LINKED_CARDS_KEY,
		syncCardCover: true,
		coverFrontmatterKey: DEFAULT_COVER_KEY,
		writeTrelloPluginNoteId: true,
		syncChecklists: true,
		checklistHeading: DEFAULT_CHECKLIST_HEADING,
		labelPropertySync: true,
		labelPropertyMappings: [],
		obsoleteLabelPropertyKeys: [],
		keyMigrations: {},
		...overrides,
	};
}

describe("Milestone 6: Tier 5 Adversarial Coverage Hardening", () => {
	beforeEach(() => {
		mockSettingsCreated.length = 0;
		alignModalCalls.length = 0;
	});

	// =========================================================================
	// 1. Extreme & Exotic Frontmatter Structures & Boundary Values
	// =========================================================================
	describe("1. Extreme & Exotic Frontmatter Structures & Boundary Values", () => {
		test("handles non-string / primitive / object values for due, labels, members without throwing", () => {
			const settings = createTestSettings({
				syncDue: false,
				syncLabels: false,
				syncMembers: false,
				syncCustomFields: false,
				writeTrelloPluginNoteId: false,
			});

			const frontmatter: Record<string, unknown> = {
				[DEFAULT_DUE_KEY]: 1729238400000, // Number instead of ISO date string
				[DEFAULT_LABELS_KEY]: { bug: true, priority: 1 }, // Object instead of string array
				[DEFAULT_MEMBERS_KEY]: true, // Boolean instead of string array
				[DEFAULT_CUSTOM_FIELDS_KEY]: "invalid-custom-field-string", // String instead of record
			};

			const changes = detectStaleChanges({
				frontmatter,
				hasCardRef: true,
				settings,
			});

			// All 4 categories must detect the stale keys regardless of their non-standard internal types
			expect(changes.map((c) => c.category).sort()).toEqual([
				"custom-fields",
				"due",
				"labels",
				"members",
			]);
		});

		test("handles frontmatter keys matching Object.prototype properties (__proto__, constructor, valueOf)", async () => {
			const settings = createTestSettings({
				syncDue: false,
				dueFrontmatterKey: "constructor", // Adversarial key matching prototype
				keyMigrations: {
					valueOf: "migrated_valueOf",
				},
			});

			const vault = new TrackingFakeVault({
				"protoTest.md": {
					content: '---\nconstructor: "dangerous"\nvalueOf: 42\ntrello_board_card_id: "b1;c1"\n---\n\nBody content',
					mtime: at("2026-05-01"),
				},
			});

			const note = vault.note("protoTest.md");
			const changes = await alignNote(vault, note, ["due", "key-migration"], settings, { keepMtime: true });

			expect(changes).toHaveLength(2);
			const fm = vault.readFrontmatter(note);
			expect(fm?.["migrated_valueOf"]).toBe(42);
			expect(typeof Object.prototype.valueOf).toBe("function");
		});

		test("handles pure markdown note without frontmatter block when checklist section needs stripping", async () => {
			const settings = createTestSettings({
				syncChecklists: false,
				checklistHeading: "## Checklists",
			});

			const rawBody = "# Title\n\nIntroduction paragraph.\n\n## Checklists\n- [ ] Task 1\n- [x] Task 2\n\n## Conclusion\nEnd paragraph.";
			const vault = new TrackingFakeVault({
				"noFrontmatter.md": {
					content: rawBody,
					mtime: at("2026-06-01"),
				},
			});

			const note = vault.note("noFrontmatter.md");
			const changes = await alignNote(vault, note, ["checklist-section"], settings, { keepMtime: true });

			expect(changes).toHaveLength(1);
			expect(changes[0]!.category).toBe("checklist-section");

			const updated = vault.contentOf("noFrontmatter.md");
			expect(updated).not.toContain("## Checklists");
			expect(updated).not.toContain("- [ ] Task 1");
			expect(updated).toContain("# Title");
			expect(updated).toContain("Introduction paragraph.");
			expect(updated).toContain("## Conclusion");
			expect(updated).toContain("End paragraph.");

			// Must not artificially prepend empty frontmatter block
			expect(updated.startsWith("---")).toBe(false);

			// Mtime preserved
			expect(vault.note("noFrontmatter.md").mtime).toBe(at("2026-06-01"));
		});

		test("preserves sections following checklist section even with extreme whitespace / lack of trailing newlines", async () => {
			const settings = createTestSettings({
				syncChecklists: false,
				checklistHeading: "### My Tasks",
			});

			const rawContent = "---\ntitle: Note\n---\nBody before\n\n### My Tasks\n- [ ] Item 1\n### Following Section\nContent preserved";
			const vault = new TrackingFakeVault({
				"trailing.md": {
					content: rawContent,
					mtime: 500,
				},
			});

			const note = vault.note("trailing.md");
			await alignNote(vault, note, ["checklist-section"], settings, { keepMtime: true });

			const result = vault.contentOf("trailing.md");
			expect(result).not.toContain("### My Tasks");
			expect(result).not.toContain("- [ ] Item 1");
			expect(result).toContain("### Following Section");
			expect(result).toContain("Content preserved");
		});
	});

	// =========================================================================
	// 2. Hostile & Obfuscated URL Detection in isTrelloUrl
	// =========================================================================
	describe("2. Hostile & Obfuscated URL Detection in isTrelloUrl", () => {
		test("rejects credentials in userinfo attempting to mask evil domains", () => {
			const hostileUrls = [
				"https://trello.com@evil-site.com/image.png",
				"https://trello.com:secret@evil-site.com/image.png",
				"http://trello-attachments.s3.amazonaws.com@attacker.org/file.jpg",
			];
			for (const url of hostileUrls) {
				expect(isTrelloUrl(url), `Failed for ${url}`).toBe(false);
			}
		});

		test("rejects path, query, and anchor deception masking evil domains", () => {
			const hostileUrls = [
				"https://evil-site.com/trello.com/image.png",
				"https://evil-site.com/c/shortLink/card",
				"https://evil-site.com?redirect=trello.com",
				"https://evil-site.com#trello.com",
				"https://trello-attachments.s3.evil.com/image.png",
				"https://trello-attachments.s3.evil.amazonaws.com/image.png",
				"https://trello-attachments.s3.evil.s3.amazonaws.com/image.png",
				"https://trello-backgrounds.s3.evil.amazonaws.com/bg.png",
				"https://attacker.trello-attachments.s3.amazonaws.com/fake.png",
				"https://not-trello-attachments.s3.amazonaws.com/image.png",
				"https://trello.com.attacker.org/image.png",
			];
			for (const url of hostileUrls) {
				expect(isTrelloUrl(url), `Failed for ${url}`).toBe(false);
			}
		});

		test("accurately accepts valid AWS regional and dualstack Trello bucket patterns", () => {
			const validBucketUrls = [
				"https://trello-attachments.s3.amazonaws.com/5a1/cover.jpg",
				"https://trello-attachments.s3.us-west-2.amazonaws.com/5a1/cover.jpg",
				"https://trello-attachments.s3-eu-west-1.amazonaws.com/5a1/cover.png",
				"https://trello-backgrounds.s3.amazonaws.com/bg.png",
				"https://trello-backgrounds.s3.eu-central-1.amazonaws.com/bg.png",
				"https://trello.com/c/12345/card-name",
				"https://sub.trello.com/file.png",
			];
			for (const url of validBucketUrls) {
				expect(isTrelloUrl(url), `Expected true for ${url}`).toBe(true);
			}
		});

		test("safely returns false for non-string, blob, data, and protocol-relative URLs", () => {
			expect(isTrelloUrl(null)).toBe(false);
			expect(isTrelloUrl(undefined)).toBe(false);
			expect(isTrelloUrl(12345)).toBe(false);
			expect(isTrelloUrl(["https://trello.com"])).toBe(false);
			expect(isTrelloUrl({ url: "https://trello.com" })).toBe(false);
			expect(isTrelloUrl("//trello.com/image.png")).toBe(false);
			expect(isTrelloUrl("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==")).toBe(false);
			expect(isTrelloUrl("blob:https://trello.com/uuid-here")).toBe(false);
			expect(isTrelloUrl("javascript:alert(1)")).toBe(false);
			expect(isTrelloUrl("")).toBe(false);
			expect(isTrelloUrl("   ")).toBe(false);
		});
	});

	// =========================================================================
	// 3. Key Migration Stress: Collisions, Cycles, Chains, and Overwrites
	// =========================================================================
	describe("3. Key Migration Stress: Collisions, Cycles, Chains, and Overwrites", () => {
		test("handles migration collisions where two old keys target the same destination key", async () => {
			const settings = createTestSettings({
				keyMigrations: {
					old_due_1: "migrated_due",
					old_due_2: "migrated_due",
				},
			});

			const vault = new TrackingFakeVault({
				"collision.md": {
					content: '---\nold_due_1: "2026-01-01"\nold_due_2: "2026-12-31"\ntrello_board_card_id: "b1;c1"\n---\n\nCollision note',
					mtime: at("2026-01-01"),
				},
			});

			const note = vault.note("collision.md");
			const changes = await alignNote(vault, note, ["key-migration"], settings, { keepMtime: true });

			expect(changes).toHaveLength(1);
			expect(changes[0]!.keys).toContain("old_due_1");
			expect(changes[0]!.keys).toContain("old_due_2");

			const fm = vault.readFrontmatter(note);
			expect(fm?.["old_due_1"]).toBeUndefined();
			expect(fm?.["old_due_2"]).toBeUndefined();
			expect(fm?.["migrated_due"]).toBeDefined();
			// One of the values migrated safely without throwing
			expect(["2026-01-01", "2026-12-31"]).toContain(fm?.["migrated_due"]);
		});

		test("handles cyclic key migration definitions gracefully without infinite loops", async () => {
			const settings = createTestSettings({
				keyMigrations: {
					keyA: "keyB",
					keyB: "keyA",
				},
			});

			const vault = new TrackingFakeVault({
				"cycle.md": {
					content: '---\nkeyA: "valueA"\nkeyB: "valueB"\ntrello_board_card_id: "b1;c1"\n---\n\nCycle note',
					mtime: 100,
				},
			});

			const note = vault.note("cycle.md");
			const changes = await alignNote(vault, note, ["key-migration"], settings, { keepMtime: true });

			expect(changes).toHaveLength(1);
			const fm = vault.readFrontmatter(note);
			// Keys swapped or resolved deterministically without hanging or corrupting frontmatter
			expect(fm).toBeDefined();
			expect(vault.note("cycle.md").mtime).toBe(100);
		});

		test("ignores self-migration mappings where oldKey === targetKey", () => {
			const settings = createTestSettings({
				keyMigrations: {
					same_key: "same_key",
					"  spaced_same  ": "spaced_same",
					"": "target",
					old_valid: "",
				},
			});

			const frontmatter = {
				same_key: "value1",
				spaced_same: "value2",
			};

			const changes = detectStaleChanges({
				frontmatter,
				hasCardRef: true,
				settings,
			});

			const migrationChanges = changes.filter((c) => c.category === "key-migration");
			expect(migrationChanges).toHaveLength(0);
		});

		test("migrates complex structured values (nested objects, arrays) cleanly", async () => {
			const settings = createTestSettings({
				keyMigrations: {
					old_tags: "new_tags",
					old_meta: "new_meta",
				},
			});

			const vault = new TrackingFakeVault({
				"complex.md": {
					content: '---\nold_tags:\n  - "lore"\n  - "fantasy"\nold_meta:\n  author: "Arthur"\n  rank: 1\n---\n\nBody',
					mtime: 200,
				},
			});

			const note = vault.note("complex.md");
			await alignNote(vault, note, ["key-migration"], settings, { keepMtime: true });

			const fm = vault.readFrontmatter(note);
			expect(fm?.["old_tags"]).toBeUndefined();
			expect(fm?.["old_meta"]).toBeUndefined();
			expect(fm?.["new_tags"]).toEqual(["lore", "fantasy"]);
			expect(fm?.["new_meta"]).toEqual({
				author: "Arthur",
				rank: 1,
			});
		});
	});

	// =========================================================================
	// 4. Obsolete Label Properties & Mapping Cleanup
	// =========================================================================
	describe("4. Obsolete Label Properties & Mapping Cleanup", () => {
		test("removes obsolete label properties when labelPropertySync is false", async () => {
			const settings = createTestSettings({
				labelPropertySync: false,
				labelPropertyMappings: [
					{ key: "status", values: ["Done", "In Progress"] },
					{ key: "priority", values: ["High", "Low"] },
				],
				obsoleteLabelPropertyKeys: ["legacy_status", "deprecated_tag"],
			});

			const vault = new TrackingFakeVault({
				"labelProps.md": {
					content: '---\nstatus: "Done"\npriority: "High"\nlegacy_status: "Old"\nkept_prop: "Keep"\ntrello_board_card_id: "b1;c1"\n---\n\nBody',
					mtime: at("2026-03-01"),
				},
			});

			const note = vault.note("labelProps.md");
			const changes = await alignNote(vault, note, ["obsolete-label-property"], settings, { keepMtime: true });

			expect(changes).toHaveLength(1);
			expect(changes[0]!.keys.sort()).toEqual(["legacy_status", "priority", "status"]);

			const fm = vault.readFrontmatter(note);
			expect(fm?.["status"]).toBeUndefined();
			expect(fm?.["priority"]).toBeUndefined();
			expect(fm?.["legacy_status"]).toBeUndefined();
			expect(fm?.["kept_prop"]).toBe("Keep");
			expect(fm?.["trello_board_card_id"]).toBe("b1;c1");

			// Timestamp preservation verified
			expect(vault.note("labelProps.md").mtime).toBe(at("2026-03-01"));
		});

		test("safely ignores non-existent candidate obsolete keys without error", () => {
			const settings = createTestSettings({
				labelPropertySync: true,
				obsoleteLabelPropertyKeys: ["non_existent_1", "non_existent_2"],
			});

			const frontmatter = {
				other_prop: "value",
			};

			const changes = detectStaleChanges({
				frontmatter,
				hasCardRef: true,
				settings,
			});

			expect(changes.filter((c) => c.category === "obsolete-label-property")).toHaveLength(0);
		});
	});

	// =========================================================================
	// 5. Missing & Stale Plugin Note ID Invariants
	// =========================================================================
	describe("5. Missing & Stale Plugin Note ID Invariants", () => {
		test("never backfills trello_plugin_note_id onto unlinked notes", async () => {
			const settings = createTestSettings({
				writeTrelloPluginNoteId: true,
			});

			const vault = new TrackingFakeVault({
				"unlinkedNote.md": {
					content: "---\ntitle: Unlinked\n---\n\nNo card reference here.",
					mtime: at("2026-04-01"),
				},
			});

			const note = vault.note("unlinkedNote.md");
			const changes = await alignNote(vault, note, ["missing-plugin-note-id"], settings, { keepMtime: true });

			expect(changes).toHaveLength(0);
			const fm = vault.readFrontmatter(note);
			expect(fm?.[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]).toBeUndefined();
		});

		test("backfills unique UUIDs across multiple linked notes lacking plugin note IDs", async () => {
			const settings = createTestSettings({
				writeTrelloPluginNoteId: true,
			});

			const noteCount = 10;
			const files: Record<string, { content: string; mtime: number }> = {};
			for (let i = 0; i < noteCount; i++) {
				files[`note_${i}.md`] = {
					content: `---\ntrello_board_card_id: "b1;card_${i}"\n---\n\nNote ${i}`,
					mtime: at("2026-01-01"),
				};
			}

			const vault = new TrackingFakeVault(files);
			const notes = Array.from({ length: noteCount }, (_, i) => vault.note(`note_${i}.md`));

			const result = await alignNotes(vault, notes, ["missing-plugin-note-id"], settings, { keepMtime: true });

			expect(result.notesModified).toBe(noteCount);

			const generatedIds = new Set<string>();
			for (let i = 0; i < noteCount; i++) {
				const fm = vault.readFrontmatter(vault.note(`note_${i}.md`));
				const id = fm?.[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY] as string;
				expect(id).toBeDefined();
				expect(typeof id).toBe("string");
				expect(id.trim()).not.toBe("");
				generatedIds.add(id);
			}

			// All generated UUIDs must be strictly unique
			expect(generatedIds.size).toBe(noteCount);
		});

		test("replaces corrupt or non-string trello_plugin_note_id (numbers, empty string) when backfilling", async () => {
			const settings = createTestSettings({
				writeTrelloPluginNoteId: true,
			});

			const vault = new TrackingFakeVault({
				"corruptId.md": {
					content: '---\ntrello_board_card_id: "b1;c1"\ntrello_plugin_note_id: 12345\n---\n\nBody',
					mtime: at("2026-01-01"),
				},
			});

			const note = vault.note("corruptId.md");
			const changes = await alignNote(vault, note, ["missing-plugin-note-id"], settings, { keepMtime: true });

			expect(changes).toHaveLength(1);
			expect(changes[0]!.category).toBe("missing-plugin-note-id");

			const fm = vault.readFrontmatter(note);
			expect(typeof fm?.[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]).toBe("string");
			expect(fm?.[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]).not.toBe(12345);
		});
	});

	// =========================================================================
	// 6. Concurrency, Guarding, Deletion & Abort Signals in Batch alignNotes
	// =========================================================================
	describe("6. Concurrency, Guarding, Deletion & Abort Signals in Batch alignNotes", () => {
		test("gracefully skips notes deleted from vault during batch execution without crashing", async () => {
			const settings = createTestSettings({ syncDue: false });
			const vault = new TrackingFakeVault({
				"survivor.md": {
					content: '---\ntrello_due: "2026-01-01"\ntrello_board_card_id: "b;c1"\n---\n\nSurvivor',
					mtime: 100,
				},
				"deleted.md": {
					content: '---\ntrello_due: "2026-01-01"\ntrello_board_card_id: "b;c2"\n---\n\nWill be deleted',
					mtime: 100,
				},
			});

			const survivorNote = vault.note("survivor.md");
			const deletedNote = vault.note("deleted.md");

			// Simulate deletion of deleted.md right before alignNotes processes it
			const origExists = vault.exists.bind(vault);
			vi.spyOn(vault, "exists").mockImplementation((path) => {
				if (path === "deleted.md") return false;
				return origExists(path);
			});

			const reporter = recordingReporter();
			const result = await alignNotes(vault, [deletedNote, survivorNote], ["due"], settings, {
				reporter,
			});

			expect(result.notesModified).toBe(1);
			expect(result.changesByCategory["due"]).toBe(1);
			const fmSurvivor = vault.readFrontmatter(survivorNote);
			expect(fmSurvivor?.["trello_due"]).toBeUndefined();
		});

		test("aborts immediately without modifications when signal is pre-aborted", async () => {
			const settings = createTestSettings({ syncDue: false });
			const vault = new TrackingFakeVault({
				"note.md": {
					content: '---\ntrello_due: "2026-01-01"\n---\n\nBody',
					mtime: 100,
				},
			});

			const controller = new AbortController();
			controller.abort();

			let finishStatus: string | null = null;
			let finishMessage: string | null = null;
			const reporter = {
				...recordingReporter(),
				finish: (status: string, message: string) => {
					finishStatus = status;
					finishMessage = message;
				},
			};
			const result = await alignNotes(vault, [vault.note("note.md")], ["due"], settings, {
				signal: controller.signal,
				reporter,
			});

			expect(result.notesScanned).toBe(0);
			expect(result.notesModified).toBe(0);
			expect(vault.readFrontmatter(vault.note("note.md"))?.["trello_due"]).toBe("2026-01-01");
			expect(finishStatus).toBe("aborted");
			expect(finishMessage).toBe("Batch alignment cancelled.");
		});

		test("serializes multi-note batch operations sharing the same card:<id> under OperationGuard", async () => {
			const settings = createTestSettings({ syncDue: false });
			const guard = new OperationGuard();

			const vault = new TrackingFakeVault({
				"shared1.md": {
					content: '---\ntrello_board_card_id: "b1;shared_card"\ntrello_due: "2026-01-01"\n---\n\nBody 1',
					mtime: 100,
				},
				"shared2.md": {
					content: '---\ntrello_board_card_id: "b1;shared_card"\ntrello_due: "2026-02-02"\n---\n\nBody 2',
					mtime: 100,
				},
			});

			let concurrentLocks = 0;
			let maxLocks = 0;

			const origWriteFm = vault.writeFrontmatter.bind(vault);
			vi.spyOn(vault, "writeFrontmatter").mockImplementation(async (note, mutate, options) => {
				concurrentLocks++;
				maxLocks = Math.max(maxLocks, concurrentLocks);
				await new Promise((r) => setTimeout(r, 15));
				await origWriteFm(note, mutate, options);
				concurrentLocks--;
			});

			const note1 = vault.note("shared1.md");
			const note2 = vault.note("shared2.md");

			await Promise.all([
				alignNotes(vault, [note1], ["due"], settings, { guard, keepMtime: true }),
				alignNotes(vault, [note2], ["due"], settings, { guard, keepMtime: true }),
			]);

			expect(maxLocks).toBe(1);
			expect(concurrentLocks).toBe(0);
			expect(vault.readFrontmatter(note1)?.["trello_due"]).toBeUndefined();
			expect(vault.readFrontmatter(note2)?.["trello_due"]).toBeUndefined();
		});
	});

	// =========================================================================
	// 7. In-Stream cleanUpDuringSync Integration Under Adversarial Conditions
	// =========================================================================
	describe("7. In-Stream cleanUpDuringSync Integration Under Adversarial Conditions", () => {
		test("in-stream alignment cleans stale properties in dryRun mode with ZERO file writes", async () => {
			const path = "Notes/DryRunSync.md";
			const initialContent = '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\ntrello_members:\n  - "Alice"\n---\n\nInitial Body';
			const vault = new TrackingFakeVault({
				[path]: { content: initialContent, mtime: at("2026-01-01") },
			});

			const { transport } = routedTransport({});
			const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
			const remoteCard = card({ id: "c1", name: "DryRunSync", desc: "Initial Body", dateLastActivity: "2026-01-01" });

			const options: NoteSyncOptions = {
				policy: "newer-wins",
				marginMs: 0,
				syncTitle: true,
				syncDescription: true,
				syncDue: false, // stale due
				syncMembers: false, // stale members
				syncLabels: true,
				dryRun: true, // Dry run simulation
				cleanUpDuringSync: true,
				dueFrontmatterKey: DEFAULT_DUE_KEY,
				membersFrontmatterKey: DEFAULT_MEMBERS_KEY,
			};

			const result = await syncNoteWithCard(vault, client, vault.note(path), remoteCard, options);

			expect(result.direction).toBe("skip");
			// Cleaned properties detected and reported
			expect(result.cleaned).toBeDefined();
			expect(result.cleaned).toContain(DEFAULT_DUE_KEY);
			expect(result.cleaned).toContain(DEFAULT_MEMBERS_KEY);

			// ZERO writes executed on vault
			expect(vault.writeCalls).toHaveLength(0);
			expect(vault.writeFrontmatterCalls).toHaveLength(0);
			expect(vault.contentOf(path)).toBe(initialContent);
			expect(vault.note(path).mtime).toBe(at("2026-01-01"));
		});

		test("in-stream alignment performs single-pass frontmatter write and preserves mtime when pull updates description", async () => {
			const path = "Notes/PullSync.md";
			const initialContent = '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\n---\n\nOld Body';
			const vault = new TrackingFakeVault({
				[path]: { content: initialContent, mtime: at("2026-01-01") },
			});

			const { transport } = routedTransport({});
			const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
			// Remote card is newer and has updated description
			const remoteCard = card({ id: "c1", name: "PullSync", desc: "New Remote Body", dateLastActivity: "2026-06-01" });

			const options: NoteSyncOptions = {
				policy: "newer-wins",
				marginMs: 0,
				syncTitle: true,
				syncDescription: true,
				syncDue: false, // disabled -> due is stale
				syncLabels: true,
				dryRun: false,
				cleanUpDuringSync: true,
				dueFrontmatterKey: DEFAULT_DUE_KEY,
			};

			const result = await syncNoteWithCard(vault, client, vault.note(path), remoteCard, options);

			expect(result.direction).toBe("pull");
			expect(result.cleaned).toContain(DEFAULT_DUE_KEY);

			const finalContent = vault.contentOf(path);
			expect(finalContent).toContain("New Remote Body");
			expect(finalContent).not.toContain(DEFAULT_DUE_KEY);
			expect(finalContent).toContain('trello_board_card_id: "b1;c1"');

			// Alignment cleanup write explicitly passed keepMtime: true
			const alignFmCall = vault.writeFrontmatterCalls.find((c) => c.keepMtime === true);
			expect(alignFmCall).toBeDefined();
		});

		test("in-stream alignment handles deleted card (404) gracefully through cardFate", async () => {
			const path = "Notes/DeletedCard.md";
			const initialContent = '---\ntrello_board_card_id: "b1;c_deleted"\ntrello_due: "2026-12-31"\n---\n\nNote with deleted card';
			const vault = new TrackingFakeVault({
				[path]: { content: initialContent, mtime: at("2026-01-01") },
			});

			const { transport } = routedTransport({
				"GET /1/cards/c_deleted": () => {
					throw new TrelloError("Card not found", 404, false);
				},
			});
			const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

			const options: NoteSyncOptions = {
				policy: "newer-wins",
				marginMs: 0,
				syncTitle: true,
				syncDescription: true,
				dryRun: false,
				cleanUpDuringSync: true,
				cardFate: {
					onCardMoved: "move-note",
					onCardArchived: "unlink",
					onCardDeleted: "unlink",
					archiveFolder: "",
				},
				trelloPropertyKeys: ["trello_board_card_id", "trello_due"],
			};

			const result = await syncNote(vault, client, vault.note(path), options);
			expect(result.direction).toBe("unlinked");
		});
	});

	// =========================================================================
	// 8. SettingsTab Banner Counts, Grammar, and Dynamic Visibility
	// =========================================================================
	describe("8. SettingsTab Banner Counts, Grammar, and Dynamic Visibility", () => {
		test("generates singular vs plural grammar correctly for count=1 vs count>1", () => {
			const mockPlugin: any = {
				settings: {
					...DEFAULT_SETTINGS,
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
					linkedCardsFrontmatterKey: "trello_linked_cards",
					syncLinkedCards: false,
					syncCardCover: false,
					coverFrontmatterKey: "banner",
					syncChecklists: false,
					checklistHeading: "## Checklists",
					writeTrelloPluginNoteId: false,
				},
			};

			const tab = new TrelloVaultSyncSettingsTab({} as any, mockPlugin);

			// Singular: 1 note
			const infoSingular = (tab as any).getCleanupBannerInfo("due", 1);
			expect(infoSingular?.name).toBe("1 note still has trello_due");

			// Plural: 5 notes
			const infoPlural = (tab as any).getCleanupBannerInfo("due", 5);
			expect(infoPlural?.name).toBe("5 notes still have trello_due");

			// Attachments banner
			const attachSingular = (tab as any).getCleanupBannerInfo("attachments", 1);
			expect(attachSingular?.name).toBe("1 note still has attachment properties");
			const attachPlural = (tab as any).getCleanupBannerInfo("attachments", 3);
			expect(attachPlural?.name).toBe("3 notes still have attachment properties");

			// Plugin note ID banner
			const pluginIdPlural = (tab as any).getCleanupBannerInfo("plugin-note-id", 4);
			expect(pluginIdPlural?.name).toBe("4 notes still have trello_plugin_note_id");
		});

		test("returns null and suppresses banner when corresponding sync toggle is enabled", () => {
			const mockPlugin: any = {
				settings: {
					...DEFAULT_SETTINGS,
					syncDue: true, // ENABLED
					syncLabels: true, // ENABLED
					syncCardCover: true, // ENABLED
				},
			};

			const tab = new TrelloVaultSyncSettingsTab({} as any, mockPlugin);

			expect((tab as any).getCleanupBannerInfo("due", 10)).toBeNull();
			expect((tab as any).getCleanupBannerInfo("labels", 10)).toBeNull();
			expect((tab as any).getCleanupBannerInfo("cover", 10)).toBeNull();
		});

		test("returns null and suppresses banner when count is 0", () => {
			const mockPlugin: any = {
				settings: {
					...DEFAULT_SETTINGS,
					syncDue: false,
				},
			};

			const tab = new TrelloVaultSyncSettingsTab({} as any, mockPlugin);
			// Stub stale counts
			(tab as any).staleCounts = { due: 0 };

			const container = new FakeHtmlElement("div");
			(tab as any).renderCleanupHelper(container, "due");

			// No setting banner should be created
			expect(mockSettingsCreated).toHaveLength(0);
		});

		test("clicking banner button invokes alignNotesWithSettings with specific category preselected", () => {
			const mockPlugin: any = {
				settings: {
					...DEFAULT_SETTINGS,
					syncDue: false,
					dueFrontmatterKey: "trello_due",
				},
			};

			const tab = new TrelloVaultSyncSettingsTab({} as any, mockPlugin);
			(tab as any).staleCounts = { due: 3 };

			const container = new FakeHtmlElement("div");
			(tab as any).renderCleanupHelper(container, "due");

			expect(mockSettingsCreated).toHaveLength(1);
			const bannerSetting = mockSettingsCreated[0];
			expect(bannerSetting.buttonText).toBe("Clean up...");
			expect(bannerSetting.buttonClickHandler).toBeDefined();

			// Click the button
			bannerSetting.buttonClickHandler!();

			// Modal invoker called with "due"
			expect(alignModalCalls).toHaveLength(1);
			expect(alignModalCalls[0]!.category).toBe("due");
			expect(alignModalCalls[0]!.plugin).toBe(mockPlugin);
		});
	});

	// =========================================================================
	// 9. Combinatorial Edge Cases & Invariant Verification
	// =========================================================================
	describe("9. Combinatorial Edge Cases & Invariant Verification", () => {
		test("cleanUpDuringSync handles all 8 safe categories simultaneously in a single pass", async () => {
			const path = "Notes/MegaAllSafe.md";
			const initialContent = [
				"---",
				'trello_board_card_id: "b1;c1"',
				'trello_due: "2026-12-31"',
				"trello_labels:",
				'  - "bug"',
				"trello_members:",
				'  - "Alice"',
				"trello_custom_fields:",
				'  Estimate: "5"',
				"trello_attachments:",
				'  - "https://trello.com/att1.png"',
				"trello_linked_cards:",
				'  - "[[Card2]]"',
				'banner: "https://trello-attachments.s3.amazonaws.com/5a1/cover.jpg"',
				'old_rename: "to_be_migrated"',
				"---",
				"",
				"Note body",
			].join("\n");

			const vault = new TrackingFakeVault({
				[path]: { content: initialContent, mtime: at("2026-01-01") },
			});

			const { transport } = routedTransport({});
			const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
			const remoteCard = card({ id: "c1", name: "MegaAllSafe", desc: "Note body", dateLastActivity: "2026-01-01" });

			const options: NoteSyncOptions = {
				policy: "newer-wins",
				marginMs: 0,
				syncTitle: true,
				syncDescription: true,
				syncDue: false,
				syncLabels: false,
				syncMembers: false,
				syncCustomFields: false,
				syncAttachments: false,
				syncLinkedCards: false,
				syncCardCover: false,
				dryRun: false,
				cleanUpDuringSync: true,
				keyMigrations: { old_rename: "new_migrated" },
				dueFrontmatterKey: DEFAULT_DUE_KEY,
				labelsFrontmatterKey: DEFAULT_LABELS_KEY,
				membersFrontmatterKey: DEFAULT_MEMBERS_KEY,
				customFieldsFrontmatterKey: DEFAULT_CUSTOM_FIELDS_KEY,
				attachmentsFrontmatterKey: DEFAULT_ATTACHMENTS_KEY,
				linkedCardsFrontmatterKey: DEFAULT_LINKED_CARDS_KEY,
				coverFrontmatterKey: DEFAULT_COVER_KEY,
			};

			const result = await syncNoteWithCard(vault, client, vault.note(path), remoteCard, options);

			expect(result.direction).toBe("skip");
			expect(result.cleaned).toBeDefined();

			const fm = vault.readFrontmatter(vault.note(path));
			expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_LABELS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_MEMBERS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_CUSTOM_FIELDS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_ATTACHMENTS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_LINKED_CARDS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_COVER_KEY]).toBeUndefined();
			expect(fm?.["old_rename"]).toBeUndefined();
			expect(fm?.["new_migrated"]).toBe("to_be_migrated");
			expect(fm?.[DEFAULT_CARD_REF_KEY]).toBe("b1;c1");

			// Timestamp preservation: note mtime is untouched
			expect(vault.note(path).mtime).toBe(at("2026-01-01"));
		});

		test("subsequent sync does NOT trigger false conflict after cleanUpDuringSync runs", async () => {
			const path = "Notes/SubsequentSync.md";
			const initialContent = '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\n---\n\nBody content';
			const initialMtime = at("2026-01-01");
			const vault = new TrackingFakeVault({
				[path]: { content: initialContent, mtime: initialMtime },
			});

			const { transport } = routedTransport({});
			const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
			const remoteCard = card({ id: "c1", name: "SubsequentSync", desc: "Body content", dateLastActivity: "2026-01-01" });

			const options: NoteSyncOptions = {
				policy: "newer-wins",
				marginMs: 0,
				syncTitle: true,
				syncDescription: true,
				syncDue: false,
				dryRun: false,
				cleanUpDuringSync: true,
			};

			// Run 1: cleans up due date
			const run1 = await syncNoteWithCard(vault, client, vault.note(path), remoteCard, options);
			expect(run1.direction).toBe("skip");
			expect(vault.note(path).mtime).toBe(initialMtime);

			// Run 2: immediately run sync again with no changes on either side
			const run2 = await syncNoteWithCard(vault, client, vault.note(path), remoteCard, options);
			// Must stay "skip" (identical) and NOT become "conflict" or "push"
			expect(run2.direction).toBe("skip");
			expect(vault.note(path).mtime).toBe(initialMtime);
		});

		test("checklist section is NOT considered stale when syncChecklists is enabled (true)", () => {
			const settings = createTestSettings({
				syncChecklists: true, // ENABLED
				checklistHeading: "## Checklists",
			});

			const changes = detectStaleChanges({
				frontmatter: { trello_board_card_id: "b1;c1" },
				hasCardRef: true,
				hasChecklistSection: true,
				settings,
			});

			expect(changes.filter((c) => c.category === "checklist-section")).toHaveLength(0);
		});

		test("key migration replaces existing target key if targetKey already exists in frontmatter", async () => {
			const settings = createTestSettings({
				keyMigrations: {
					old_key: "target_key",
				},
			});

			const vault = new TrackingFakeVault({
				"overwriteKey.md": {
					content: '---\nold_key: "fresh_value"\ntarget_key: "obsolete_value"\n---\n\nBody',
					mtime: at("2026-02-01"),
				},
			});

			const note = vault.note("overwriteKey.md");
			await alignNote(vault, note, ["key-migration"], settings, { keepMtime: true });

			const fm = vault.readFrontmatter(note);
			expect(fm?.["old_key"]).toBeUndefined();
			expect(fm?.["target_key"]).toBe("fresh_value");
		});

		test("preserves non-HTTP, file, and wikilink cover values from being pruned", () => {
			const settings = createTestSettings({
				syncCardCover: false,
				coverFrontmatterKey: "banner",
			});

			const localCovers = [
				"[[my-local-banner.png]]",
				"assets/banners/hero.jpg",
				"./attachments/cover.png",
				"https://images.unsplash.com/photo-12345",
				"http://my-personal-cdn.org/image.png",
			];

			for (const localCover of localCovers) {
				const changes = detectStaleChanges({
					frontmatter: { banner: localCover },
					hasCardRef: true,
					settings,
				});

				const coverChanges = changes.filter((c) => c.category === "cover");
				expect(coverChanges, `Expected no cover removal for ${localCover}`).toHaveLength(0);
			}
		});
	});
});
