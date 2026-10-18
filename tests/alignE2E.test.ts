import { describe, expect, test, vi } from "vitest";
import { OperationGuard } from "../src/core/operationGuard";
import { decideSync } from "../src/core/syncDecision";
import { type SyncAction } from "../src/core/syncHistory";
import { splitFrontmatter } from "../src/core/noteBody";
import { undoRun } from "../src/features/rollback";
import { wrapWithHistoryRecorder } from "../src/features/syncHistoryRecorder";
import type { CardRefStore, NoteHandle, Reporter, VaultGateway } from "../src/obsidian/gateway";
import { FakeVault } from "./fakes";

// --- Contract Definitions (PROJECT.md § Interface Contracts) ---

export type AlignCategory =
	| "due"
	| "labels"
	| "members"
	| "custom-fields"
	| "attachments"
	| "linked-cards"
	| "cover"
	| "plugin-note-id"
	| "missing-plugin-note-id"
	| "checklist-section"
	| "obsolete-label-property"
	| "key-migration";

export interface AlignChange {
	category: AlignCategory;
	action: "remove" | "add" | "migrate";
	keys: string[];
	migrations?: Record<string, string>;
}

export interface AlignSettings {
	syncDue: boolean;
	dueFrontmatterKey: string;
	syncLabels: boolean;
	labelsFrontmatterKey: string;
	syncMembers: boolean;
	membersFrontmatterKey: string;
	syncCustomFields: boolean;
	customFieldsFrontmatterKey: string;
	syncAttachments: boolean;
	attachmentsFrontmatterKey: string;
	syncLinkedCards: boolean;
	linkedCardsFrontmatterKey: string;
	syncCardCover: boolean;
	coverFrontmatterKey: string;
	writeTrelloPluginNoteId: boolean;
	syncChecklists: boolean;
	checklistHeading: string;
	labelPropertySync: boolean;
	labelPropertyMappings: readonly { key: string; values: readonly string[] }[];
	obsoleteLabelPropertyKeys?: readonly string[];
	keyMigrations?: Record<string, string>;
}

export interface AlignNoteOptions {
	dryRun?: boolean;
	keepMtime?: boolean;
}

export interface AlignNotesOptions extends AlignNoteOptions {
	guard?: OperationGuard;
	reporter?: Reporter;
	signal?: AbortSignal;
}

export interface AlignResult {
	notesScanned: number;
	notesModified: number;
	changesByCategory: Record<AlignCategory, number>;
}

// --- Dynamic Module Resolution (Requirement-Driven Contract Hook) ---

let staleModuleCache: any = null;
let alignModuleCache: any = null;

async function loadStaleModule() {
	if (!staleModuleCache) {
		try {
			// @ts-ignore dynamic contract resolution before worker implementation
			staleModuleCache = await import("../src/core/staleProperties");
		} catch {
			return null;
		}
	}
	return staleModuleCache;
}

async function loadAlignModule() {
	if (!alignModuleCache) {
		try {
			// @ts-ignore dynamic contract resolution before worker implementation
			alignModuleCache = await import("../src/features/alignNotes");
		} catch {
			return null;
		}
	}
	return alignModuleCache;
}

async function getDetectStaleChanges() {
	const mod = await loadStaleModule();
	if (!mod?.detectStaleChanges) {
		throw new Error(
			"Contract function 'detectStaleChanges' is not yet implemented (Milestone M2: src/core/staleProperties.ts).",
		);
	}
	return mod.detectStaleChanges as (params: {
		frontmatter: Record<string, unknown> | null;
		hasCardRef: boolean;
		hasChecklistSection?: boolean;
		settings: AlignSettings;
	}) => AlignChange[];
}

async function getIsTrelloUrl() {
	const mod = await loadStaleModule();
	if (!mod?.isTrelloUrl) {
		throw new Error(
			"Contract function 'isTrelloUrl' is not yet implemented (Milestone M2: src/core/staleProperties.ts).",
		);
	}
	return mod.isTrelloUrl as (value: unknown) => boolean;
}

async function getAlignNote() {
	const mod = await loadAlignModule();
	if (!mod?.alignNote) {
		throw new Error(
			"Contract function 'alignNote' is not yet implemented (Milestone M3: src/features/alignNotes.ts).",
		);
	}
	return mod.alignNote as (
		vault: VaultGateway,
		note: NoteHandle,
		categories: readonly AlignCategory[],
		settings: AlignSettings,
		options?: AlignNoteOptions,
	) => Promise<AlignChange[]>;
}

async function getAlignNotes() {
	const mod = await loadAlignModule();
	if (!mod?.alignNotes) {
		throw new Error(
			"Contract function 'alignNotes' is not yet implemented (Milestone M3: src/features/alignNotes.ts).",
		);
	}
	return mod.alignNotes as (
		vault: VaultGateway & CardRefStore,
		notes: readonly NoteHandle[],
		categories: readonly AlignCategory[],
		settings: AlignSettings,
		options?: AlignNotesOptions,
	) => Promise<AlignResult>;
}

// --- Extended FakeVault with KeepMtime Contract (Forward-Compatible with M1) ---

export class E2EFakeVault extends FakeVault {
	private readonly mtimes = new Map<string, number>();

	constructor(files: Record<string, { content: string; mtime?: number }> = {}, cardRefKey?: string) {
		super(files, cardRefKey);
		for (const [path, f] of Object.entries(files)) {
			this.mtimes.set(path, f.mtime ?? 0);
		}
	}

	override async write(note: NoteHandle, content: string, options?: { keepMtime?: boolean }): Promise<void> {
		const prevMtime = this.mtimes.get(note.path) ?? note.mtime ?? 0;
		const nextMtime = options?.keepMtime ? prevMtime : prevMtime + 1;
		this.mtimes.set(note.path, nextMtime);
		await super.write(note, content);
		// Update handle mtime
		(this as any).files.set(note.path, { content, mtime: nextMtime });
	}

	override async writeFrontmatter(
		note: NoteHandle,
		mutate: (frontmatter: Record<string, unknown>) => void,
		options?: { keepMtime?: boolean },
	): Promise<void> {
		const content = this.contentOf(note.path);
		const { frontmatter, body } = splitFrontmatter(content);
		const parsed = frontmatter === null ? {} : (this as any).parseFrontmatterBlock(frontmatter);
		mutate(parsed);
		const block = (this as any).serializeFrontmatterBlock(parsed);
		const next = frontmatter === null ? `${block}\n\n${content}` : `${block}${body}`;
		await this.write(note, next, options);
	}
}

// --- Default Settings Factory ---

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
		writeTrelloPluginNoteId: true,
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
// TIER 1: Feature Coverage (Single Feature Verification across all 12 categories)
// ============================================================================

describe("Tier 1: Feature Coverage", () => {
	test("due: detects and prunes due frontmatter key when syncDue is disabled", async () => {
		const detectStaleChanges = await getDetectStaleChanges();
		const alignNote = await getAlignNote();

		const settings = createSettings({ syncDue: false });
		const frontmatter = { trello_board_card_id: "b1;c1", trello_due: "2026-12-31" };

		const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
		expect(changes).toContainEqual({ category: "due", action: "remove", keys: ["trello_due"] });

		const vault = new E2EFakeVault({
			"task.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-12-31"\n---\n\nBody' },
		});
		await alignNote(vault, vault.note("task.md"), ["due"], settings);

		const updated = vault.readFrontmatter(vault.note("task.md"));
		expect(updated?.trello_due).toBeUndefined();
		expect(updated?.trello_board_card_id).toBe("b1;c1");
	});

	test("due: preserves due date when syncDue is enabled", async () => {
		const detectStaleChanges = await getDetectStaleChanges();
		const settings = createSettings({ syncDue: true });
		const frontmatter = { trello_board_card_id: "b1;c1", trello_due: "2026-12-31" };

		const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
		expect(changes.find((c) => c.category === "due")).toBeUndefined();
	});

	test("labels: detects and prunes labels frontmatter key when syncLabels is disabled", async () => {
		const detectStaleChanges = await getDetectStaleChanges();
		const alignNote = await getAlignNote();

		const settings = createSettings({ syncLabels: false });
		const frontmatter = { trello_board_card_id: "b1;c1", trello_labels: ["Urgent", "Bug"] };

		const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
		expect(changes).toContainEqual({ category: "labels", action: "remove", keys: ["trello_labels"] });

		const vault = new E2EFakeVault({
			"task.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_labels:\n  - "Urgent"\n---\n\nBody' },
		});
		await alignNote(vault, vault.note("task.md"), ["labels"], settings);

		const updated = vault.readFrontmatter(vault.note("task.md"));
		expect(updated?.trello_labels).toBeUndefined();
	});

	test("members: detects and prunes members frontmatter key when syncMembers is disabled", async () => {
		const detectStaleChanges = await getDetectStaleChanges();
		const alignNote = await getAlignNote();

		const settings = createSettings({ syncMembers: false });
		const frontmatter = { trello_board_card_id: "b1;c1", trello_members: ["alice", "bob"] };

		const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
		expect(changes).toContainEqual({ category: "members", action: "remove", keys: ["trello_members"] });

		const vault = new E2EFakeVault({
			"task.md": { content: '---\ntrello_board_card_id: "b1;c1"\ntrello_members:\n  - "alice"\n---\n\nBody' },
		});
		await alignNote(vault, vault.note("task.md"), ["members"], settings);

		expect(vault.readFrontmatter(vault.note("task.md"))?.trello_members).toBeUndefined();
	});

	test("custom-fields: detects and prunes custom fields when syncCustomFields is disabled", async () => {
		const detectStaleChanges = await getDetectStaleChanges();
		const alignNote = await getAlignNote();

		const settings = createSettings({ syncCustomFields: false });
		const frontmatter = { trello_board_card_id: "b1;c1", trello_custom_fields: { Priority: "High" } };

		const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
		expect(changes).toContainEqual({ category: "custom-fields", action: "remove", keys: ["trello_custom_fields"] });

		const vault = new E2EFakeVault({
			"task.md": {
				content: '---\ntrello_board_card_id: "b1;c1"\ntrello_custom_fields:\n  Priority: "High"\n---\n\nBody',
			},
		});
		await alignNote(vault, vault.note("task.md"), ["custom-fields"], settings);

		expect(vault.readFrontmatter(vault.note("task.md"))?.trello_custom_fields).toBeUndefined();
	});

	test("attachments: prunes both attachments and linked-cards keys when syncAttachments is disabled", async () => {
		const detectStaleChanges = await getDetectStaleChanges();
		const alignNote = await getAlignNote();

		const settings = createSettings({ syncAttachments: false });
		const frontmatter = {
			trello_board_card_id: "b1;c1",
			trello_attachments: ["https://trello.com/att1"],
			trello_linked_cards: ["c2"],
		};

		const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
		expect(changes).toContainEqual({
			category: "attachments",
			action: "remove",
			keys: expect.arrayContaining(["trello_attachments", "trello_linked_cards"]),
		});

		const vault = new E2EFakeVault({
			"task.md": {
				content:
					'---\ntrello_board_card_id: "b1;c1"\ntrello_attachments:\n  - "att"\ntrello_linked_cards:\n  - "c2"\n---\n\nBody',
			},
		});
		await alignNote(vault, vault.note("task.md"), ["attachments"], settings);

		const updated = vault.readFrontmatter(vault.note("task.md"));
		expect(updated?.trello_attachments).toBeUndefined();
		expect(updated?.trello_linked_cards).toBeUndefined();
	});

	test("linked-cards: prunes only linked cards when syncLinkedCards is false and syncAttachments is true", async () => {
		const detectStaleChanges = await getDetectStaleChanges();
		const alignNote = await getAlignNote();

		const settings = createSettings({ syncAttachments: true, syncLinkedCards: false });
		const frontmatter = {
			trello_board_card_id: "b1;c1",
			trello_attachments: ["https://trello.com/att1"],
			trello_linked_cards: ["c2"],
		};

		const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
		expect(changes).toContainEqual({
			category: "linked-cards",
			action: "remove",
			keys: ["trello_linked_cards"],
		});

		const vault = new E2EFakeVault({
			"task.md": {
				content:
					'---\ntrello_board_card_id: "b1;c1"\ntrello_attachments:\n  - "att"\ntrello_linked_cards:\n  - "c2"\n---\n\nBody',
			},
		});
		await alignNote(vault, vault.note("task.md"), ["linked-cards"], settings);

		const updated = vault.readFrontmatter(vault.note("task.md"));
		expect(updated?.trello_attachments).toBeDefined();
		expect(updated?.trello_linked_cards).toBeUndefined();
	});

	test("cover: prunes remote Trello cover URL when syncCardCover is disabled", async () => {
		const detectStaleChanges = await getDetectStaleChanges();
		const isTrelloUrl = await getIsTrelloUrl();
		const alignNote = await getAlignNote();

		const trelloCover = "https://trello-attachments.s3.amazonaws.com/abc/cover.jpg";
		expect(isTrelloUrl(trelloCover)).toBe(true);

		const settings = createSettings({ syncCardCover: false, coverFrontmatterKey: "banner" });
		const frontmatter = { trello_board_card_id: "b1;c1", banner: trelloCover };

		const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
		expect(changes).toContainEqual({ category: "cover", action: "remove", keys: ["banner"] });

		const vault = new E2EFakeVault({
			"task.md": { content: `---\ntrello_board_card_id: "b1;c1"\nbanner: "${trelloCover}"\n---\n\nBody` },
		});
		await alignNote(vault, vault.note("task.md"), ["cover"], settings);

		expect(vault.readFrontmatter(vault.note("task.md"))?.banner).toBeUndefined();
	});

	test("plugin-note-id: prunes trello_plugin_note_id when writeTrelloPluginNoteId is disabled", async () => {
		const detectStaleChanges = await getDetectStaleChanges();
		const alignNote = await getAlignNote();

		const settings = createSettings({ writeTrelloPluginNoteId: false });
		const frontmatter = { trello_board_card_id: "b1;c1", trello_plugin_note_id: "1234567890abcdef1234567890abcdef" };

		const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
		expect(changes).toContainEqual({
			category: "plugin-note-id",
			action: "remove",
			keys: ["trello_plugin_note_id"],
		});

		const vault = new E2EFakeVault({
			"task.md": {
				content:
					'---\ntrello_board_card_id: "b1;c1"\ntrello_plugin_note_id: "1234567890abcdef1234567890abcdef"\n---\n\nBody',
			},
		});
		await alignNote(vault, vault.note("task.md"), ["plugin-note-id"], settings);

		expect(vault.readFrontmatter(vault.note("task.md"))?.trello_plugin_note_id).toBeUndefined();
	});

	test("missing-plugin-note-id: backfills 32-char hex plugin ID on linked note when enabled", async () => {
		const detectStaleChanges = await getDetectStaleChanges();
		const alignNote = await getAlignNote();

		const settings = createSettings({ writeTrelloPluginNoteId: true });
		const frontmatter = { trello_board_card_id: "b1;c1" };

		const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
		expect(changes).toContainEqual({
			category: "missing-plugin-note-id",
			action: "add",
			keys: ["trello_plugin_note_id"],
		});

		const vault = new E2EFakeVault({
			"task.md": { content: '---\ntrello_board_card_id: "b1;c1"\n---\n\nBody' },
		});
		await alignNote(vault, vault.note("task.md"), ["missing-plugin-note-id"], settings);

		const updated = vault.readFrontmatter(vault.note("task.md"));
		expect(updated?.trello_plugin_note_id).toBeDefined();
		expect(typeof updated?.trello_plugin_note_id).toBe("string");
		expect(updated?.trello_plugin_note_id as string).toMatch(/^[0-9a-f]{32}$/i);
	});

	test("checklist-section: strips markdown body checklist section when syncChecklists is disabled", async () => {
		const detectStaleChanges = await getDetectStaleChanges();
		const alignNote = await getAlignNote();

		const settings = createSettings({ syncChecklists: false, checklistHeading: "## Checklists" });
		const frontmatter = { trello_board_card_id: "b1;c1" };

		const changes = detectStaleChanges({
			frontmatter,
			hasCardRef: true,
			hasChecklistSection: true,
			settings,
		});
		expect(changes).toContainEqual({
			category: "checklist-section",
			action: "remove",
			keys: ["## Checklists"],
		});

		const initialContent =
			'---\ntrello_board_card_id: "b1;c1"\n---\n\nIntro paragraph.\n\n## Checklists\n- [ ] Task A\n- [x] Task B\n\nFooter content.';
		const vault = new E2EFakeVault({ "task.md": { content: initialContent } });

		await alignNote(vault, vault.note("task.md"), ["checklist-section"], settings);

		const updatedContent = vault.contentOf("task.md");
		expect(updatedContent).not.toContain("## Checklists");
		expect(updatedContent).not.toContain("Task A");
		expect(updatedContent).toContain("Intro paragraph.");
		expect(updatedContent).toContain("Footer content.");
	});

	test("obsolete-label-property: prunes properties from removed labelPropertyMappings", async () => {
		const detectStaleChanges = await getDetectStaleChanges();
		const alignNote = await getAlignNote();

		const settings = createSettings({
			obsoleteLabelPropertyKeys: ["legacy_status", "old_category"],
		});
		const frontmatter = {
			trello_board_card_id: "b1;c1",
			legacy_status: "Done",
			old_category: "Dev",
			author: "Alice",
		};

		const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
		expect(changes).toContainEqual({
			category: "obsolete-label-property",
			action: "remove",
			keys: expect.arrayContaining(["legacy_status", "old_category"]),
		});

		const vault = new E2EFakeVault({
			"task.md": {
				content:
					'---\ntrello_board_card_id: "b1;c1"\nlegacy_status: "Done"\nold_category: "Dev"\nauthor: "Alice"\n---\n\nBody',
			},
		});
		await alignNote(vault, vault.note("task.md"), ["obsolete-label-property"], settings);

		const updated = vault.readFrontmatter(vault.note("task.md"));
		expect(updated?.legacy_status).toBeUndefined();
		expect(updated?.old_category).toBeUndefined();
		expect(updated?.author).toBe("Alice");
	});

	test("key-migration: migrates old frontmatter keys to configured new targets", async () => {
		const detectStaleChanges = await getDetectStaleChanges();
		const alignNote = await getAlignNote();

		const settings = createSettings({
			keyMigrations: { old_due: "trello_due", tags: "trello_labels" },
		});
		const frontmatter = {
			trello_board_card_id: "b1;c1",
			old_due: "2026-11-15",
			tags: ["v1", "release"],
		};

		const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
		expect(changes).toContainEqual({
			category: "key-migration",
			action: "migrate",
			keys: ["old_due", "tags"],
			migrations: { old_due: "trello_due", tags: "trello_labels" },
		});

		const vault = new E2EFakeVault({
			"task.md": {
				content:
					'---\ntrello_board_card_id: "b1;c1"\nold_due: "2026-11-15"\ntags:\n  - "v1"\n  - "release"\n---\n\nBody',
			},
		});
		await alignNote(vault, vault.note("task.md"), ["key-migration"], settings);

		const updated = vault.readFrontmatter(vault.note("task.md"));
		expect(updated?.old_due).toBeUndefined();
		expect(updated?.tags).toBeUndefined();
		expect(updated?.trello_due).toBe("2026-11-15");
		expect(updated?.trello_labels).toEqual(["v1", "release"]);
	});
});

// ============================================================================
// TIER 2: Boundary & Corner Cases
// ============================================================================

describe("Tier 2: Boundary & Corner Cases", () => {
	test("empty notes: alignment gracefully handles 0-byte or blank note without throwing", async () => {
		const alignNote = await getAlignNote();
		const settings = createSettings({ syncDue: false });
		const vault = new E2EFakeVault({ "empty.md": { content: "" } });

		const changes = await alignNote(vault, vault.note("empty.md"), ["due"], settings);
		expect(changes).toEqual([]);
		expect(vault.contentOf("empty.md")).toBe("");
	});

	test("non-Trello remote covers: strictly preserved when syncCardCover is disabled", async () => {
		const detectStaleChanges = await getDetectStaleChanges();
		const isTrelloUrl = await getIsTrelloUrl();
		const alignNote = await getAlignNote();

		const unsplashCover = "https://images.unsplash.com/photo-1579546929518-9e396f3cc809";
		expect(isTrelloUrl(unsplashCover)).toBe(false);

		const settings = createSettings({ syncCardCover: false, coverFrontmatterKey: "banner" });
		const frontmatter = { trello_board_card_id: "b1;c1", banner: unsplashCover };

		const changes = detectStaleChanges({ frontmatter, hasCardRef: true, settings });
		expect(changes.find((c) => c.category === "cover")).toBeUndefined();

		const vault = new E2EFakeVault({
			"task.md": { content: `---\ntrello_board_card_id: "b1;c1"\nbanner: "${unsplashCover}"\n---\n\nBody` },
		});
		await alignNote(vault, vault.note("task.md"), ["cover"], settings);

		expect(vault.readFrontmatter(vault.note("task.md"))?.banner).toBe(unsplashCover);
	});

	test("local covers: strictly preserved (relative path or wiki-link) when syncCardCover is disabled", async () => {
		const detectStaleChanges = await getDetectStaleChanges();
		const isTrelloUrl = await getIsTrelloUrl();
		const alignNote = await getAlignNote();

		const localPathCover = "assets/banners/landscape.png";
		const wikiLinkCover = "[[landscape.png]]";

		expect(isTrelloUrl(localPathCover)).toBe(false);
		expect(isTrelloUrl(wikiLinkCover)).toBe(false);

		const settings = createSettings({ syncCardCover: false, coverFrontmatterKey: "banner" });

		const changes1 = detectStaleChanges({ frontmatter: { banner: localPathCover }, hasCardRef: true, settings });
		expect(changes1.find((c) => c.category === "cover")).toBeUndefined();

		const changes2 = detectStaleChanges({ frontmatter: { banner: wikiLinkCover }, hasCardRef: true, settings });
		expect(changes2.find((c) => c.category === "cover")).toBeUndefined();

		const vault = new E2EFakeVault({
			"note1.md": { content: `---\ntrello_board_card_id: "b1;c1"\nbanner: "${localPathCover}"\n---\n\n` },
			"note2.md": { content: `---\ntrello_board_card_id: "b1;c2"\nbanner: "${wikiLinkCover}"\n---\n\n` },
		});

		await alignNote(vault, vault.note("note1.md"), ["cover"], settings);
		await alignNote(vault, vault.note("note2.md"), ["cover"], settings);

		expect(vault.readFrontmatter(vault.note("note1.md"))?.banner).toBe(localPathCover);
		expect(vault.readFrontmatter(vault.note("note2.md"))?.banner).toBe(wikiLinkCover);
	});

	test("unlinked notes: NEVER receive trello_plugin_note_id even if category is active", async () => {
		const detectStaleChanges = await getDetectStaleChanges();
		const alignNote = await getAlignNote();

		const settings = createSettings({ writeTrelloPluginNoteId: true });

		// Test with completely unlinked note (no trello_board_card_id)
		const unlinkedFm = { author: "Alice" };
		const changesUnlinked = detectStaleChanges({ frontmatter: unlinkedFm, hasCardRef: false, settings });
		expect(changesUnlinked.find((c) => c.category === "missing-plugin-note-id")).toBeUndefined();

		// Test with placeholder template
		const placeholderFm = { trello_board_card_id: "{{boardId}};{{cardId}}" };
		const changesPlaceholder = detectStaleChanges({ frontmatter: placeholderFm, hasCardRef: false, settings });
		expect(changesPlaceholder.find((c) => c.category === "missing-plugin-note-id")).toBeUndefined();

		const vault = new E2EFakeVault({
			"plain.md": { content: '---\nauthor: "Alice"\n---\n\nPlain unlinked note' },
		});
		await alignNote(vault, vault.note("plain.md"), ["missing-plugin-note-id"], settings);

		expect(vault.readFrontmatter(vault.note("plain.md"))?.trello_plugin_note_id).toBeUndefined();
	});

	test("notes without frontmatter: plain body remains unmodified when no stale changes apply", async () => {
		const alignNote = await getAlignNote();
		const settings = createSettings({ syncDue: false });
		const vault = new E2EFakeVault({ "plain.md": { content: "# Pure Markdown Body\n\nNo frontmatter here." } });

		await alignNote(vault, vault.note("plain.md"), ["due", "labels"], settings);
		expect(vault.contentOf("plain.md")).toBe("# Pure Markdown Body\n\nNo frontmatter here.");
	});

	test("preservation of user frontmatter: custom properties are never pruned or altered", async () => {
		const alignNote = await getAlignNote();
		const settings = createSettings({ syncDue: false });
		const vault = new E2EFakeVault({
			"task.md": {
				content:
					'---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-31"\nauthor: "Trois"\nrating: 5\npinned: true\ntags:\n  - "personal"\n---\n\nBody text',
			},
		});

		await alignNote(vault, vault.note("task.md"), ["due"], settings);

		const updated = vault.readFrontmatter(vault.note("task.md"));
		expect(updated?.trello_due).toBeUndefined();
		expect(updated?.author).toBe("Trois");
		expect(updated?.rating).toBe(5);
		expect(updated?.pinned).toBe(true);
		expect(updated?.tags).toEqual(["personal"]);
	});

	test("line endings: CRLF line endings in notes are parsed and preserved without mangling", async () => {
		const alignNote = await getAlignNote();
		const settings = createSettings({ syncDue: false });
		const initialContent =
			'---\r\ntrello_board_card_id: "b1;c1"\r\ntrello_due: "2026-10-31"\r\n---\r\n\r\nCRLF body content\r\nSecond line';
		const vault = new E2EFakeVault({ "crlf.md": { content: initialContent } });

		await alignNote(vault, vault.note("crlf.md"), ["due"], settings);

		const updated = vault.contentOf("crlf.md");
		expect(updated).not.toContain("trello_due");
		expect(updated).toContain("CRLF body content");
	});
});

// ============================================================================
// TIER 3: Cross-Feature Combinations
// ============================================================================

describe("Tier 3: Cross-Feature Combinations", () => {
	test("multi-toggle disabled: removes due, labels, members, and cover in a single-pass write", async () => {
		const alignNote = await getAlignNote();
		const trelloCover = "https://trello-attachments.s3.amazonaws.com/board/c1/cover.jpg";

		const settings = createSettings({
			syncDue: false,
			syncLabels: false,
			syncMembers: false,
			syncCardCover: false,
			coverFrontmatterKey: "banner",
		});

		const vault = new E2EFakeVault({
			"multi.md": {
				content: `---
trello_board_card_id: "b1;c1"
trello_due: "2026-10-18"
trello_labels:
  - "bug"
trello_members:
  - "alice"
banner: "${trelloCover}"
author: "Preserved Author"
---

Body content`,
			},
		});

		const categories: AlignCategory[] = ["due", "labels", "members", "cover"];
		const writeSpy = vi.spyOn(vault, "writeFrontmatter");

		const changes = await alignNote(vault, vault.note("multi.md"), categories, settings);

		// Single-pass frontmatter write
		expect(writeSpy).toHaveBeenCalledTimes(1);
		expect(changes.length).toBe(4);

		const updated = vault.readFrontmatter(vault.note("multi.md"));
		expect(updated?.trello_due).toBeUndefined();
		expect(updated?.trello_labels).toBeUndefined();
		expect(updated?.trello_members).toBeUndefined();
		expect(updated?.banner).toBeUndefined();
		expect(updated?.author).toBe("Preserved Author");
		expect(updated?.trello_board_card_id).toBe("b1;c1");
	});

	test("selective categories: only cleans categories explicitly passed in selection", async () => {
		const alignNote = await getAlignNote();

		// All toggles are off in settings
		const settings = createSettings({
			syncDue: false,
			syncLabels: false,
			syncMembers: false,
		});

		const vault = new E2EFakeVault({
			"task.md": {
				content: `---
trello_board_card_id: "b1;c1"
trello_due: "2026-10-18"
trello_labels:
  - "todo"
trello_members:
  - "bob"
---

Body`,
			},
		});

		// Pass only ["due"]
		await alignNote(vault, vault.note("task.md"), ["due"], settings);

		const updated = vault.readFrontmatter(vault.note("task.md"));
		expect(updated?.trello_due).toBeUndefined();
		// labels and members MUST remain because their categories were not in selection
		expect(updated?.trello_labels).toEqual(["todo"]);
		expect(updated?.trello_members).toEqual(["bob"]);
	});

	test("combined frontmatter & body: removes frontmatter due and body checklist cleanly", async () => {
		const alignNote = await getAlignNote();
		const settings = createSettings({
			syncDue: false,
			syncChecklists: false,
			checklistHeading: "## Checklists",
		});

		const vault = new E2EFakeVault({
			"combined.md": {
				content: `---
trello_board_card_id: "b1;c1"
trello_due: "2026-10-18"
---

Main overview.

## Checklists
- [ ] Item 1

Summary note.`,
			},
		});

		await alignNote(vault, vault.note("combined.md"), ["due", "checklist-section"], settings);

		const updatedFm = vault.readFrontmatter(vault.note("combined.md"));
		expect(updatedFm?.trello_due).toBeUndefined();

		const updatedContent = vault.contentOf("combined.md");
		expect(updatedContent).not.toContain("## Checklists");
		expect(updatedContent).toContain("Main overview.");
		expect(updatedContent).toContain("Summary note.");
	});

	test("key migration + obsolete label removal + due date cleanup simultaneously", async () => {
		const alignNote = await getAlignNote();
		const settings = createSettings({
			syncDue: false,
			obsoleteLabelPropertyKeys: ["old_prio"],
			keyMigrations: { legacy_tags: "trello_labels" },
		});

		const vault = new E2EFakeVault({
			"note.md": {
				content: `---
trello_board_card_id: "b1;c1"
trello_due: "2026-10-18"
old_prio: "Critical"
legacy_tags:
  - "frontend"
---

Body`,
			},
		});

		await alignNote(
			vault,
			vault.note("note.md"),
			["due", "obsolete-label-property", "key-migration"],
			settings,
		);

		const updated = vault.readFrontmatter(vault.note("note.md"));
		expect(updated?.trello_due).toBeUndefined();
		expect(updated?.old_prio).toBeUndefined();
		expect(updated?.legacy_tags).toBeUndefined();
		expect(updated?.trello_labels).toEqual(["frontend"]);
	});

	test("SAFE_ALIGN_CATEGORIES excludes checklist-section preventing accidental body mutation", async () => {
		const staleModule = await loadStaleModule();
		const safeCategories: readonly AlignCategory[] = staleModule?.SAFE_ALIGN_CATEGORIES ?? [
			"due",
			"labels",
			"members",
			"custom-fields",
			"attachments",
			"linked-cards",
			"cover",
			"plugin-note-id",
			"missing-plugin-note-id",
			"obsolete-label-property",
			"key-migration",
		];

		expect(safeCategories).not.toContain("checklist-section");

		const alignNote = await getAlignNote();
		const settings = createSettings({ syncDue: false, syncChecklists: false });

		const vault = new E2EFakeVault({
			"note.md": {
				content: `---
trello_board_card_id: "b1;c1"
trello_due: "2026-10-18"
---

Body text.

## Checklists
- [ ] Must keep during auto-sync`,
			},
		});

		// Automatic sync uses SAFE_ALIGN_CATEGORIES
		await alignNote(vault, vault.note("note.md"), safeCategories, settings);

		const content = vault.contentOf("note.md");
		expect(content).toContain("## Checklists");
		expect(content).toContain("Must keep during auto-sync");
		expect(vault.readFrontmatter(vault.note("note.md"))?.trello_due).toBeUndefined();
	});
});

// ============================================================================
// TIER 4: Real-World Application Scenarios
// ============================================================================

describe("Tier 4: Real-World Application Scenarios", () => {
	test("batch vault alignment: scans multiple folders and tallies metrics accurately", async () => {
		const alignNotes = await getAlignNotes();
		const settings = createSettings({
			syncDue: false,
			syncMembers: false,
			writeTrelloPluginNoteId: true,
		});

		const vault = new E2EFakeVault({
			"FolderA/note1.md": {
				content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\n---\n\n',
			},
			"FolderA/note2.md": {
				content: '---\ntrello_board_card_id: "b1;c2"\ntrello_plugin_note_id: "0123456789abcdef0123456789abcdef"\n---\n\n',
			},
			"FolderB/Sub/note3.md": {
				content: '---\ntrello_board_card_id: "b1;c3"\ntrello_members:\n  - "alice"\n---\n\n',
			},
			"unlinked.md": {
				content: '---\nauthor: "Bob"\n---\n\nUnlinked note content',
			},
		});

		const notes = vault.listNotes("");
		const categories: AlignCategory[] = ["due", "members", "missing-plugin-note-id"];

		const result = await alignNotes(vault, notes, categories, settings);

		expect(result.notesScanned).toBe(4);
		// note1 (due removed + plugin id added), note2 (clean), note3 (members removed + plugin id added), unlinked (untouched)
		expect(result.notesModified).toBe(2);
		expect(result.changesByCategory.due).toBe(1);
		expect(result.changesByCategory.members).toBe(1);
		expect(result.changesByCategory["missing-plugin-note-id"]).toBe(2);
	});

	test("operation guarding: acquires card:<id> lock for linked notes during batch run", async () => {
		const alignNotes = await getAlignNotes();
		const settings = createSettings({ syncDue: false });
		const guard = new OperationGuard();
		const withKeySpy = vi.spyOn(guard, "withKey");

		const vault = new E2EFakeVault({
			"task.md": {
				content: '---\ntrello_board_card_id: "b1;card999"\ntrello_due: "2026-10-18"\n---\n\nBody',
			},
		});

		await alignNotes(vault, vault.listNotes(""), ["due"], settings, { guard });

		expect(withKeySpy).toHaveBeenCalledWith("card:card999", expect.any(Function));
	});

	test("dry-run reporting: reports planned changes with zero file modifications", async () => {
		const alignNotes = await getAlignNotes();
		const settings = createSettings({ syncDue: false, syncLabels: false });

		const initialContent =
			'---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\ntrello_labels:\n  - "bug"\n---\n\nUntouched body';
		const vault = new E2EFakeVault({ "task.md": { content: initialContent } });

		const result = await alignNotes(vault, vault.listNotes(""), ["due", "labels"], settings, {
			dryRun: true,
		});

		expect(result.notesScanned).toBe(1);
		expect(result.notesModified).toBe(1);
		expect(result.changesByCategory.due).toBe(1);
		expect(result.changesByCategory.labels).toBe(1);

		// Zero modification verified
		expect(vault.contentOf("task.md")).toBe(initialContent);
	});

	test("history recording & undo rollback: all mutations reversible via undoRun", async () => {
		const alignNotes = await getAlignNotes();
		const settings = createSettings({ syncDue: false, syncLabels: false });

		const initialNote1 = '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\n---\n\nBody 1';
		const initialNote2 =
			'---\ntrello_board_card_id: "b1;c2"\ntrello_labels:\n  - "v1"\n---\n\nBody 2';

		const vault = new E2EFakeVault({
			"note1.md": { content: initialNote1 },
			"note2.md": { content: initialNote2 },
		});

		const actions: SyncAction[] = [];
		const recordedVault = wrapWithHistoryRecorder(vault, (action) => actions.push(action));

		await alignNotes(recordedVault, vault.listNotes(""), ["due", "labels"], settings);

		// Verified changes applied
		expect(vault.readFrontmatter(vault.note("note1.md"))?.trello_due).toBeUndefined();
		expect(vault.readFrontmatter(vault.note("note2.md"))?.trello_labels).toBeUndefined();
		expect(actions.length).toBeGreaterThan(0);

		// Revert using rollback engine
		const { stats } = await undoRun(vault, {
			timestamp: new Date().toISOString(),
			scope: "",
			actions,
		});

		expect(stats.reverted).toBe(2);
		expect(vault.contentOf("note1.md")).toBe(initialNote1);
		expect(vault.contentOf("note2.md")).toBe(initialNote2);
	});

	test("timestamp preservation: keepMtime leaves mtime intact and avoids phantom push in sync", async () => {
		const alignNote = await getAlignNote();
		const settings = createSettings({ syncDue: false });

		const initialMtime = 1700000000000;
		const vault = new E2EFakeVault({
			"task.md": {
				content: '---\ntrello_board_card_id: "b1;c1"\ntrello_due: "2026-10-18"\n---\n\nShared body content',
				mtime: initialMtime,
			},
		});

		// Run manual alignment with keepMtime: true
		await alignNote(vault, vault.note("task.md"), ["due"], settings, { keepMtime: true });

		const cleanedNote = vault.note("task.md");
		// Verify filesystem mtime is strictly preserved
		expect(cleanedNote.mtime).toBe(initialMtime);

		// Simulate subsequent sync decision against Trello card whose activity is older than initialMtime
		// If keepMtime was NOT preserved, mtime would have bumped, falsely turning into a local-newer push!
		const remoteActivityMs = initialMtime - 2000;

		const decision = decideSync({
			localTitle: "task",
			localBody: "Shared body content",
			localMtime: cleanedNote.mtime,
			localDue: null,
			remoteTitle: "task",
			remoteBody: "Shared body content",
			remoteMtime: remoteActivityMs,
			remoteDue: null,
			policy: "newer-wins",
			marginMs: 0,
		});

		// Direction is "skip" (identical) because content matches and local mtime was not falsely bumped
		expect(decision.direction).toBe("skip");
		expect(decision.reason).toBe("identical");

		// If remote had an actual edit that happened between initialMtime and now, remote wins
		const remoteNewerDecision = decideSync({
			localTitle: "task",
			localBody: "Shared body content",
			localMtime: cleanedNote.mtime,
			localDue: null,
			remoteTitle: "task",
			remoteBody: "Remote updated body",
			remoteMtime: initialMtime + 5000,
			remoteDue: null,
			policy: "newer-wins",
			marginMs: 0,
		});

		expect(remoteNewerDecision.direction).toBe("pull");
		expect(remoteNewerDecision.reason).toBe("remote-newer");
	});
});
