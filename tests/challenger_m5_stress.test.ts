import { describe, expect, test, vi, beforeEach } from "vitest";
import {
	DEFAULT_ATTACHMENTS_KEY,
	DEFAULT_COVER_KEY,
	DEFAULT_LINKED_CARDS_KEY,
} from "../src/core/attachmentRef";
import { DEFAULT_CARD_REF_KEY, DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY } from "../src/core/cardRef";
import { DEFAULT_CHECKLIST_HEADING } from "../src/core/checklistRef";
import { DEFAULT_CUSTOM_FIELDS_KEY } from "../src/core/customFieldRef";
import { DEFAULT_DUE_KEY } from "../src/core/dueRef";
import { DEFAULT_LABELS_KEY } from "../src/core/labelRef";
import { DEFAULT_MEMBERS_KEY } from "../src/core/memberRef";
import { OperationGuard } from "../src/core/operationGuard";
import type { SyncAction, SyncRun } from "../src/core/syncHistory";
import { undoRun } from "../src/features/rollback";
import { wrapWithHistoryRecorder } from "../src/features/syncHistoryRecorder";
import { syncFolder, type FolderSyncOptions } from "../src/features/syncFolder";
import { syncNoteWithCard, type NoteSyncOptions } from "../src/features/syncNote";
import { TrelloClient, type HttpRequest } from "../src/trello/client";
import {
	FakeVault,
	at,
	card,
	recordingReporter,
	routedTransport,
	FATE_OPTIONS,
} from "./fakes";

const TEST_NOTE_PATH = "Campaign/Notes/HeroNote.md";

function createBaseSyncOptions(overrides: Partial<NoteSyncOptions> = {}): NoteSyncOptions {
	return {
		policy: "newer-wins",
		marginMs: 0,
		syncTitle: true,
		syncDescription: true,
		syncDue: true,
		syncLabels: true,
		syncAttachments: false,
		syncChecklists: false,
		syncMembers: false,
		syncCustomFields: false,
		syncCardCover: false,
		dryRun: false,
		cleanUpDuringSync: true,
		dueFrontmatterKey: DEFAULT_DUE_KEY,
		labelsFrontmatterKey: DEFAULT_LABELS_KEY,
		membersFrontmatterKey: DEFAULT_MEMBERS_KEY,
		customFieldsFrontmatterKey: DEFAULT_CUSTOM_FIELDS_KEY,
		attachmentsFrontmatterKey: DEFAULT_ATTACHMENTS_KEY,
		linkedCardsFrontmatterKey: DEFAULT_LINKED_CARDS_KEY,
		coverFrontmatterKey: DEFAULT_COVER_KEY,
		checklistHeading: DEFAULT_CHECKLIST_HEADING,
		...overrides,
	};
}

function buildFrontmatterString(fields: Record<string, unknown>, cardId = "c_hero"): string {
	const lines = ["---", `trello_board_card_id: "b_stress;${cardId}"`];
	for (const [k, v] of Object.entries(fields)) {
		if (Array.isArray(v)) {
			lines.push(`${k}:`);
			for (const item of v) {
				if (typeof item === "object" && item !== null) {
					lines.push(`  - ${JSON.stringify(item)}`);
				} else {
					lines.push(`  - "${item}"`);
				}
			}
		} else if (typeof v === "object" && v !== null) {
			lines.push(`${k}:`);
			for (const [sk, sv] of Object.entries(v)) {
				lines.push(`  ${sk}: "${sv}"`);
			}
		} else if (v === null) {
			lines.push(`${k}: null`);
		} else {
			lines.push(`${k}: "${v}"`);
		}
	}
	lines.push("---");
	return lines.join("\n");
}

function setupStressFixture(
	frontmatterFields: Record<string, unknown> = {},
	body = "# Hero Content\nDetailed lore information.",
	mtime = at("2026-02-01T00:00:00.000Z"),
) {
	const fmLines = buildFrontmatterString(frontmatterFields);
	const content = `${fmLines}\n\n${body}`;
	const vault = new FakeVault({ [TEST_NOTE_PATH]: { content, mtime } });
	const { transport, requests } = routedTransport({});
	const client = new TrelloClient({ apiKey: "key123", token: "tok456" }, transport);
	return { vault, client, requests, initialContent: content, initialMtime: mtime };
}

describe("Empirical Challenger M5: In-Stream Automatic Sync Alignment (cleanUpDuringSync)", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	// =========================================================================
	// 1. Synchronizing cards when multiple safe categories are disabled simultaneously
	// =========================================================================
	describe("1. Simultaneous Multi-Category Safe Alignment", () => {
		test("All 8 safe categories are pruned/migrated simultaneously in a single note without side-effects", async () => {
			const remoteCoverUrl = "https://trello-attachments.s3.amazonaws.com/b_stress/c_hero/cover_art.png";
			const initialFm = {
				[DEFAULT_DUE_KEY]: "2026-12-31T23:59:59.000Z",
				[DEFAULT_LABELS_KEY]: ["urgent", "lore-review"],
				[DEFAULT_MEMBERS_KEY]: ["trois_user", "editor_alpha"],
				[DEFAULT_CUSTOM_FIELDS_KEY]: { Status: "Draft", Priority: "High" },
				[DEFAULT_ATTACHMENTS_KEY]: [{ name: "map.png", url: "https://trello.com/map.png" }],
				[DEFAULT_LINKED_CARDS_KEY]: [{ id: "c_linked_42", name: "Associated Quest" }],
				[DEFAULT_COVER_KEY]: remoteCoverUrl,
				legacy_reviewer_field: "Alice Senior",
				deprecated_status_code: "ARCH-101",
				// Non-stale user properties that must remain intact
				user_tags: ["canon", "chapter-1"],
				note_importance: "critical",
			};

			const bodyText = "# Hero Lore\n\nPreserved body paragraph.";
			const { vault, client } = setupStressFixture(initialFm, bodyText);
			const remote = card({
				id: "c_hero",
				name: "HeroNote",
				desc: bodyText,
				dateLastActivity: "2026-02-01T00:00:00.000Z",
			});

			const options = createBaseSyncOptions({
				syncDue: false,
				syncLabels: false,
				syncMembers: false,
				syncCustomFields: false,
				syncAttachments: false,
				syncLinkedCards: false,
				syncCardCover: false,
				cleanUpDuringSync: true,
				keyMigrations: {
					legacy_reviewer_field: "current_reviewer",
					deprecated_status_code: "modern_status",
				},
			});

			// Spy on writeFrontmatter to ensure single-pass efficiency
			const writeFmSpy = vi.spyOn(vault, "writeFrontmatter");

			const result = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);

			// Result verification
			expect(result.direction).toBe("skip");
			expect(result.cleaned).toBeDefined();
			expect(result.cleaned).toEqual(
				expect.arrayContaining([
					DEFAULT_DUE_KEY,
					DEFAULT_LABELS_KEY,
					DEFAULT_MEMBERS_KEY,
					DEFAULT_CUSTOM_FIELDS_KEY,
					DEFAULT_ATTACHMENTS_KEY,
					DEFAULT_LINKED_CARDS_KEY,
					DEFAULT_COVER_KEY,
					"legacy_reviewer_field",
					"deprecated_status_code",
				]),
			);

			// Exactly one frontmatter mutation pass on vault
			expect(writeFmSpy).toHaveBeenCalledTimes(1);

			// Verify frontmatter state
			const fm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
			expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_LABELS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_MEMBERS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_CUSTOM_FIELDS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_ATTACHMENTS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_LINKED_CARDS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_COVER_KEY]).toBeUndefined();
			expect(fm?.legacy_reviewer_field).toBeUndefined();
			expect(fm?.deprecated_status_code).toBeUndefined();

			// Verify key migrations succeeded
			expect(fm?.current_reviewer).toBe("Alice Senior");
			expect(fm?.modern_status).toBe("ARCH-101");

			// Verify user fields and card reference were preserved
			expect(fm?.user_tags).toEqual(["canon", "chapter-1"]);
			expect(fm?.note_importance).toBe("critical");
			expect(fm?.trello_board_card_id).toBe("b_stress;c_hero");

			// Verify body content was untouched
			const finalContent = vault.contentOf(TEST_NOTE_PATH);
			expect(finalContent).toContain(bodyText);
		});

		test("Remote cover URLs are pruned while local paths and wikilinks are strictly preserved", async () => {
			const fixtures = [
				{
					name: "remote_s3",
					url: "https://trello-attachments.s3.amazonaws.com/card123/banner.jpg",
					shouldRemove: true,
				},
				{
					name: "remote_s3_regional",
					url: "https://trello-attachments.s3.eu-west-1.amazonaws.com/card123/banner.jpg",
					shouldRemove: true,
				},
				{
					name: "remote_trello_com",
					url: "https://trello.com/1/cards/c1/attachments/att1/download/banner.png",
					shouldRemove: true,
				},
				{
					name: "local_relative_path",
					url: "assets/banners/landscape_banner.png",
					shouldRemove: false,
				},
				{
					name: "obsidian_wikilink",
					url: "[[landscape_banner.png]]",
					shouldRemove: false,
				},
				{
					name: "external_non_trello_cdn",
					url: "https://images.unsplash.com/photo-1579546929518-9e396f3cc809",
					shouldRemove: false,
				},
			];

			for (const fix of fixtures) {
				const path = `Covers/${fix.name}.md`;
				const fmLines = [
					"---",
					'trello_board_card_id: "b_stress;c_cover"',
					`${DEFAULT_DUE_KEY}: "2026-10-18"`,
					`${DEFAULT_COVER_KEY}: "${fix.url}"`,
					"---",
					"",
					"Body content",
				].join("\n");

				const vault = new FakeVault({ [path]: { content: fmLines, mtime: at("2026-01-01") } });
				const { transport } = routedTransport({});
				const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
				const remote = card({ id: "c_cover", name: fix.name, desc: "Body content", dateLastActivity: "2026-01-01" });

				const options = createBaseSyncOptions({
					syncTitle: false, // Prevent rename from card name
					syncDue: false,
					syncCardCover: false,
					cleanUpDuringSync: true,
				});

				await syncNoteWithCard(vault, client, vault.note(path), remote, options);

				const updatedFm = vault.readFrontmatter(vault.note(path));
				// Due is always pruned
				expect(updatedFm?.[DEFAULT_DUE_KEY]).toBeUndefined();

				if (fix.shouldRemove) {
					expect(updatedFm?.[DEFAULT_COVER_KEY], `Failed for ${fix.name}`).toBeUndefined();
				} else {
					expect(updatedFm?.[DEFAULT_COVER_KEY], `Failed for ${fix.name}`).toBe(fix.url);
				}
			}
		});

		test("Simultaneous multi-category cleanup during 'pull' direction maintains body update", async () => {
			const initialFm = {
				[DEFAULT_DUE_KEY]: "2026-01-01",
				[DEFAULT_LABELS_KEY]: ["stale-label"],
				[DEFAULT_MEMBERS_KEY]: ["old_member"],
			};
			const localOldBody = "Old local body before pull.";
			const remoteNewBody = "Fresh content written on Trello board by another collaborator.";

			const { vault, client } = setupStressFixture(initialFm, localOldBody, at("2026-01-01T00:00:00.000Z"));
			const remote = card({
				id: "c_hero",
				name: "HeroNote",
				desc: remoteNewBody,
				dateLastActivity: "2026-02-01T00:00:00.000Z", // Newer than local -> triggers pull
			});

			const options = createBaseSyncOptions({
				syncDue: false,
				syncLabels: false,
				syncMembers: false,
				cleanUpDuringSync: true,
			});

			const result = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);

			expect(result.direction).toBe("pull");
			expect(result.cleaned).toEqual(expect.arrayContaining([DEFAULT_DUE_KEY, DEFAULT_LABELS_KEY, DEFAULT_MEMBERS_KEY]));

			// Confirm body was updated with remote content
			const finalContent = vault.contentOf(TEST_NOTE_PATH);
			expect(finalContent).toContain(remoteNewBody);
			expect(finalContent).not.toContain(localOldBody);

			// Confirm stale properties were pruned
			const fm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
			expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_LABELS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_MEMBERS_KEY]).toBeUndefined();
		});

		test("Simultaneous multi-category cleanup during 'push' direction pushes local body and cleans frontmatter", async () => {
			const initialFm = {
				[DEFAULT_DUE_KEY]: "2026-01-01",
				[DEFAULT_LABELS_KEY]: ["stale-label"],
			};
			const localNewBody = "Updated body locally that should be pushed to Trello.";
			const remoteOldBody = "Stale remote body.";

			const { vault, client, requests } = setupStressFixture(initialFm, localNewBody, at("2026-03-01T00:00:00.000Z"));
			const remote = card({
				id: "c_hero",
				name: "HeroNote",
				desc: remoteOldBody,
				dateLastActivity: "2026-01-01T00:00:00.000Z", // Local is newer -> triggers push
			});

			const options = createBaseSyncOptions({
				syncDue: false,
				syncLabels: false,
				cleanUpDuringSync: true,
			});

			const result = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);

			expect(result.direction).toBe("push");
			expect(result.cleaned).toEqual(expect.arrayContaining([DEFAULT_DUE_KEY, DEFAULT_LABELS_KEY]));

			// Confirm Trello received the updated body in PUT request (decoding url-encoded body)
			const putRequest = requests.find((r) => r.method === "PUT" && r.url.includes("/cards/c_hero"));
			expect(putRequest).toBeDefined();
			const decodedBody = decodeURIComponent((putRequest?.body ?? "").replace(/\+/g, " "));
			expect(decodedBody).toContain(localNewBody);

			// Confirm local note frontmatter was cleaned
			const fm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
			expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_LABELS_KEY]).toBeUndefined();
		});

		test("Simultaneous multi-category cleanup under dryRun reports cleaned properties without disk mutations", async () => {
			const initialFm = {
				[DEFAULT_DUE_KEY]: "2026-01-01",
				[DEFAULT_LABELS_KEY]: ["tag1"],
				[DEFAULT_MEMBERS_KEY]: ["mem1"],
			};
			const mtime = at("2026-02-01T00:00:00.000Z");
			const { vault, client, initialContent } = setupStressFixture(initialFm, "Detailed lore information.", mtime);
			const remote = card({
				id: "c_hero",
				name: "HeroNote",
				desc: "Detailed lore information.",
				dateLastActivity: "2026-02-01T00:00:00.000Z",
			});

			const options = createBaseSyncOptions({
				syncDue: false,
				syncLabels: false,
				syncMembers: false,
				cleanUpDuringSync: true,
				dryRun: true,
			});

			const result = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);

			expect(result.direction).toBe("skip");
			expect(result.cleaned).toEqual(expect.arrayContaining([DEFAULT_DUE_KEY, DEFAULT_LABELS_KEY, DEFAULT_MEMBERS_KEY]));

			// File content on disk is completely untouched
			expect(vault.contentOf(TEST_NOTE_PATH)).toBe(initialContent);
			const fm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
			expect(fm?.[DEFAULT_DUE_KEY]).toBe("2026-01-01");
			expect(fm?.[DEFAULT_LABELS_KEY]).toEqual(["tag1"]);
		});

		test("Simultaneous multi-category cleanup under dryRun during 'pull' appends (simulation) to reason", async () => {
			const initialFm = {
				[DEFAULT_DUE_KEY]: "2026-01-01",
				[DEFAULT_LABELS_KEY]: ["tag1"],
			};
			const { vault, client, initialContent } = setupStressFixture(initialFm, "Old body", at("2026-01-01T00:00:00.000Z"));
			const remote = card({
				id: "c_hero",
				name: "HeroNote",
				desc: "New remote body",
				dateLastActivity: "2026-02-01T00:00:00.000Z",
			});

			const options = createBaseSyncOptions({
				syncDue: false,
				syncLabels: false,
				cleanUpDuringSync: true,
				dryRun: true,
			});

			const result = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);

			expect(result.direction).toBe("pull");
			expect(result.reason).toContain("(simulation)");
			expect(result.cleaned).toEqual(expect.arrayContaining([DEFAULT_DUE_KEY, DEFAULT_LABELS_KEY]));

			// Disk remains completely unwritten
			expect(vault.contentOf(TEST_NOTE_PATH)).toBe(initialContent);
		});
	});

	// =========================================================================
	// 2. Network abort during sync (clean rollback / no partial corruption)
	// =========================================================================
	describe("2. Network Abort & Rollback Resilience", () => {
		test("Pre-aborted signal skips in-stream alignment and yields non-mutating aborted result", async () => {
			const initialFm = {
				[DEFAULT_DUE_KEY]: "2026-10-18",
				[DEFAULT_LABELS_KEY]: ["urgent"],
			};
			const { vault, client, initialContent } = setupStressFixture(initialFm);
			const remote = card({ id: "c_hero", name: "HeroNote", desc: "Detailed lore information.", dateLastActivity: "2026-01-01" });

			const controller = new AbortController();
			controller.abort(); // Pre-aborted

			const options = createBaseSyncOptions({
				syncDue: false,
				syncLabels: false,
				cleanUpDuringSync: true,
			});

			const result = await syncNoteWithCard(
				vault,
				client,
				vault.note(TEST_NOTE_PATH),
				remote,
				options,
				undefined,
				undefined,
				undefined,
				controller.signal,
			);

			expect(result.reason).toMatch(/aborted/i);
			expect(vault.contentOf(TEST_NOTE_PATH)).toBe(initialContent);
			const fm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
			expect(fm?.[DEFAULT_DUE_KEY]).toBe("2026-10-18");
			expect(fm?.[DEFAULT_LABELS_KEY]).toEqual(["urgent"]);
		});

		test("Mid-batch abort during folder sync terminates loop cleanly without corrupting remaining notes", async () => {
			const files: Record<string, { content: string }> = {
				"Folder/Note1.md": {
					content: buildFrontmatterString({ [DEFAULT_DUE_KEY]: "2026-01-01" }, "c1") + "\n\nBody 1",
				},
				"Folder/Note2.md": {
					content: buildFrontmatterString({ [DEFAULT_DUE_KEY]: "2026-02-02" }, "c2") + "\n\nBody 2",
				},
				"Folder/Note3.md": {
					content: buildFrontmatterString({ [DEFAULT_DUE_KEY]: "2026-03-03" }, "c3") + "\n\nBody 3",
				},
			};

			const initialNote3Content = files["Folder/Note3.md"]!.content;
			const vault = new FakeVault(files);

			const cards = [
				card({ id: "c1", idBoard: "b_stress", idList: "l1", name: "Note1", desc: "Body 1" }),
				card({ id: "c2", idBoard: "b_stress", idList: "l1", name: "Note2", desc: "Body 2" }),
				card({ id: "c3", idBoard: "b_stress", idList: "l1", name: "Note3", desc: "Body 3" }),
			];

			const controller = new AbortController();
			const { transport } = routedTransport({
				"/boards/b_stress/cards": cards,
				"/lists/l1/cards": cards,
				"/boards/b_stress/lists": [{ id: "l1", name: "Folder" }],
				"/boards/b_stress/actions": [],
			});
			const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

			// Wire reporter to abort right when Note2 is stepped
			const reporter = recordingReporter();
			const originalStep = reporter.step;
			reporter.step = (name: string) => {
				originalStep(name);
				if (name === "Note2") {
					controller.abort();
				}
			};

			const folderOptions: FolderSyncOptions = {
				...createBaseSyncOptions({
					syncDue: false,
					cleanUpDuringSync: true,
				}),
				...FATE_OPTIONS,
				archiveCreateMissing: false,
				adoptUnlinkedByName: false,
				allowCreate: false,
				boardId: "b_stress",
				cardRefFrontmatterKey: DEFAULT_CARD_REF_KEY,
			};

			await syncFolder(
				vault,
				client,
				{ folder: "Folder", listId: "l1", templateName: "" },
				folderOptions,
				reporter,
				cards,
				controller.signal,
			);

			// Note 1 was processed and cleaned
			expect(vault.readFrontmatter(vault.note("Folder/Note1.md"))?.[DEFAULT_DUE_KEY]).toBeUndefined();

			// Note 3 was never touched due to abort break
			expect(vault.contentOf("Folder/Note3.md")).toBe(initialNote3Content);
			expect(vault.readFrontmatter(vault.note("Folder/Note3.md"))?.[DEFAULT_DUE_KEY]).toBe("2026-03-03");
		});

		test("Simulated network failure with wrapWithHistoryRecorder reverts both sync and cleanup byte-identically", async () => {
			const initialFm = {
				[DEFAULT_DUE_KEY]: "2026-05-01",
				[DEFAULT_LABELS_KEY]: ["temp-label"],
			};
			const initialBody = "Stable body content.";
			const { vault: baseVault, initialContent } = setupStressFixture(initialFm, initialBody);

			const actions: SyncAction[] = [];
			const recordingVault = wrapWithHistoryRecorder(baseVault, (action) => actions.push(action));

			// Custom transport returning non-retryable 400 error during card update
			const failingTransport = async (req: HttpRequest) => {
				if (req.method === "PUT") {
					return { status: 400, text: "Bad Request: simulated sync failure" };
				}
				return { status: 200, text: "{}" };
			};
			const failingClient = new TrelloClient({ apiKey: "k", token: "t" }, failingTransport, { maxRetries: 0 });

			const remote = card({
				id: "c_hero",
				name: "HeroNote",
				desc: "Outdated remote body",
				dateLastActivity: "2026-01-01", // Triggers push from local
			});

			const options = createBaseSyncOptions({
				syncDue: false,
				syncLabels: false,
				cleanUpDuringSync: true,
			});

			// Execute sync which throws network error on push
			await expect(
				syncNoteWithCard(recordingVault, failingClient, baseVault.note(TEST_NOTE_PATH), remote, options),
			).rejects.toThrow("Bad Request");

			// Frontmatter write occurred before network push failed
			expect(actions.length).toBeGreaterThan(0);

			// INVARIANT: Execute undoRun using recorded actions to restore previous state
			const run: SyncRun = {
				timestamp: new Date().toISOString(),
				scope: TEST_NOTE_PATH,
				actions,
			};

			const { stats } = await undoRun(baseVault, run);
			expect(stats.reverted).toBeGreaterThan(0);

			// Note content MUST be restored byte-for-byte to pre-sync state
			expect(baseVault.contentOf(TEST_NOTE_PATH)).toBe(initialContent);
			const fm = baseVault.readFrontmatter(baseVault.note(TEST_NOTE_PATH));
			expect(fm?.[DEFAULT_DUE_KEY]).toBe("2026-05-01");
			expect(fm?.[DEFAULT_LABELS_KEY]).toEqual(["temp-label"]);
		});

		test("Successful sync with automatic alignment records reversible history undoable to exact baseline", async () => {
			const initialFm = {
				[DEFAULT_DUE_KEY]: "2026-07-07",
				[DEFAULT_MEMBERS_KEY]: ["user_beta"],
				[DEFAULT_CUSTOM_FIELDS_KEY]: { Priority: "Medium" },
			};
			const mtime = at("2026-02-01T00:00:00.000Z");
			const { vault: baseVault, client, initialContent } = setupStressFixture(initialFm, "Detailed lore information.", mtime);

			const actions: SyncAction[] = [];
			const recordingVault = wrapWithHistoryRecorder(baseVault, (action) => actions.push(action));

			const remote = card({
				id: "c_hero",
				name: "HeroNote",
				desc: "Detailed lore information.",
				dateLastActivity: "2026-02-01T00:00:00.000Z",
			});

			const options = createBaseSyncOptions({
				syncDue: false,
				syncMembers: false,
				syncCustomFields: false,
				cleanUpDuringSync: true,
			});

			const result = await syncNoteWithCard(recordingVault, client, baseVault.note(TEST_NOTE_PATH), remote, options);
			expect(result.cleaned).toBeDefined();

			// Frontmatter is cleaned
			expect(baseVault.readFrontmatter(baseVault.note(TEST_NOTE_PATH))?.[DEFAULT_DUE_KEY]).toBeUndefined();

			// Undo the sync run
			const run: SyncRun = {
				timestamp: new Date().toISOString(),
				scope: TEST_NOTE_PATH,
				actions,
			};
			const { stats } = await undoRun(baseVault, run);
			expect(stats.reverted).toBe(1);

			// Byte-identity restored
			expect(baseVault.contentOf(TEST_NOTE_PATH)).toBe(initialContent);
		});
	});

	// =========================================================================
	// 3. Zero Trello API calls during alignment even under heavy sync workloads
	// =========================================================================
	describe("3. Zero Network Footprint Invariant Under Heavy Load", () => {
		test("50 notes with stale properties produce EXACTLY 0 Trello API calls for alignment", async () => {
			const CARD_COUNT = 50;
			const files: Record<string, { content: string }> = {};
			const cards: any[] = [];

			for (let i = 1; i <= CARD_COUNT; i++) {
				const cardId = `c_load_${i}`;
				const path = `HeavyLoad/Note_${i}.md`;
				const body = `Content for note ${i}`;
				files[path] = {
					content: [
						"---",
						`trello_board_card_id: "b_heavy;${cardId}"`,
						`${DEFAULT_DUE_KEY}: "2026-10-${(i % 28) + 1}"`,
						`${DEFAULT_LABELS_KEY}:`,
						`  - "batch_tag_${i}"`,
						`${DEFAULT_MEMBERS_KEY}:`,
						`  - "member_${i}"`,
						"---",
						"",
						body,
					].join("\n"),
				};
				cards.push(
					card({
						id: cardId,
						idBoard: "b_heavy",
						idList: "l_heavy",
						name: `Note_${i}`,
						desc: body,
						dateLastActivity: "2026-01-01T00:00:00.000Z",
					}),
				);
			}

			// Run 1: cleanUpDuringSync = true
			const vaultClean = new FakeVault(files);
			const { transport: transportClean, requests: requestsClean } = routedTransport({});
			const clientClean = new TrelloClient({ apiKey: "k", token: "t" }, transportClean);

			const optionsClean = createBaseSyncOptions({
				syncDue: false,
				syncLabels: false,
				syncMembers: false,
				cleanUpDuringSync: true,
			});

			for (let i = 1; i <= CARD_COUNT; i++) {
				const path = `HeavyLoad/Note_${i}.md`;
				const remote = cards[i - 1];
				await syncNoteWithCard(vaultClean, clientClean, vaultClean.note(path), remote, optionsClean);
			}

			// Run 2: cleanUpDuringSync = false
			const vaultDirty = new FakeVault(files);
			const { transport: transportDirty, requests: requestsDirty } = routedTransport({});
			const clientDirty = new TrelloClient({ apiKey: "k", token: "t" }, transportDirty);

			const optionsDirty = createBaseSyncOptions({
				syncDue: false,
				syncLabels: false,
				syncMembers: false,
				cleanUpDuringSync: false,
			});

			for (let i = 1; i <= CARD_COUNT; i++) {
				const path = `HeavyLoad/Note_${i}.md`;
				const remote = cards[i - 1];
				await syncNoteWithCard(vaultDirty, clientDirty, vaultDirty.note(path), remote, optionsDirty);
			}

			// ZERO API calls made in both cases (all in sync)
			expect(requestsClean.length).toBe(0);
			expect(requestsDirty.length).toBe(0);

			// delta API calls due to cleanup is strictly 0
			expect(requestsClean.length - requestsDirty.length).toBe(0);

			// All 50 notes in vaultClean had their 3 stale keys pruned locally
			for (let i = 1; i <= CARD_COUNT; i++) {
				const fmClean = vaultClean.readFrontmatter(vaultClean.note(`HeavyLoad/Note_${i}.md`));
				expect(fmClean?.[DEFAULT_DUE_KEY]).toBeUndefined();
				expect(fmClean?.[DEFAULT_LABELS_KEY]).toBeUndefined();
				expect(fmClean?.[DEFAULT_MEMBERS_KEY]).toBeUndefined();

				// In vaultDirty, properties remain untouched
				const fmDirty = vaultDirty.readFrontmatter(vaultDirty.note(`HeavyLoad/Note_${i}.md`));
				expect(fmDirty?.[DEFAULT_DUE_KEY]).toBeDefined();
				expect(fmDirty?.[DEFAULT_LABELS_KEY]).toBeDefined();
				expect(fmDirty?.[DEFAULT_MEMBERS_KEY]).toBeDefined();
			}
		});

		test("Concurrent operations under OperationGuard serialize card writes and make 0 cleanup API calls", async () => {
			const guard = new OperationGuard();
			const mtime = at("2026-02-01T00:00:00.000Z");

			const { vault, client, requests } = setupStressFixture(
				{
					[DEFAULT_DUE_KEY]: "2026-12-31",
				},
				"Detailed lore information.",
				mtime,
			);
			const remote = card({
				id: "c_hero",
				name: "HeroNote",
				desc: "Detailed lore information.",
				dateLastActivity: "2026-02-01T00:00:00.000Z",
			});

			const options = createBaseSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
				guard,
			});

			// Execute 5 concurrent syncs on the same card
			const promises = Array.from({ length: 5 }, () =>
				syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options),
			);

			const results = await Promise.all(promises);

			// All completed successfully without throwing
			expect(results).toHaveLength(5);
			expect(requests).toHaveLength(0);

			// Final frontmatter state is clean
			expect(vault.readFrontmatter(vault.note(TEST_NOTE_PATH))?.[DEFAULT_DUE_KEY]).toBeUndefined();
		});
	});

	// =========================================================================
	// 4. Strict non-removal of non-safe categories during sync
	// =========================================================================
	describe("4. Non-Safe Categories Preservation Invariant", () => {
		test("Checklist body section is NEVER pruned automatically during sync even when syncChecklists is false", async () => {
			const bodyWithChecklists = [
				"# Quest Log",
				"",
				"Introductory lore.",
				"",
				"## Checklists",
				"- [ ] Explore ruins",
				"- [x] Find artifact",
				"- [ ] Return to guild",
				"",
				"## Epilogue",
				"Conclusion prose.",
			].join("\n");

			const { vault, client } = setupStressFixture({}, bodyWithChecklists);
			const remote = card({ id: "c_hero", name: "HeroNote", desc: "# Quest Log\n\nIntroductory lore.", dateLastActivity: "2026-01-01" });

			const options = createBaseSyncOptions({
				syncChecklists: false,
				checklistHeading: "## Checklists",
				cleanUpDuringSync: true,
			});

			await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);

			const content = vault.contentOf(TEST_NOTE_PATH);
			expect(content).toContain("## Checklists");
			expect(content).toContain("- [ ] Explore ruins");
			expect(content).toContain("- [x] Find artifact");
			expect(content).toContain("- [ ] Return to guild");
			expect(content).toContain("## Epilogue");
		});

		test("trello_plugin_note_id is strictly preserved even when writeTrelloPluginNoteId is false", async () => {
			const pluginId = "9876543210fedcba9876543210fedcba";
			const { vault, client } = setupStressFixture({
				[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]: pluginId,
				[DEFAULT_DUE_KEY]: "2026-10-18",
			});
			const remote = card({ id: "c_hero", name: "HeroNote", desc: "Detailed lore information.", dateLastActivity: "2026-01-01" });

			const options = createBaseSyncOptions({
				writeTrelloPluginNoteId: false,
				syncDue: false,
				cleanUpDuringSync: true,
			});

			await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);

			const fm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
			// Safe category (due) is pruned
			expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();

			// Non-safe category (trello_plugin_note_id) is STRICTLY PRESERVED
			expect(fm?.[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]).toBe(pluginId);
		});

		test("missing-plugin-note-id is NEVER backfilled automatically during sync", async () => {
			const { vault, client } = setupStressFixture({
				[DEFAULT_DUE_KEY]: "2026-10-18",
			});
			const remote = card({ id: "c_hero", name: "HeroNote", desc: "Detailed lore information.", dateLastActivity: "2026-01-01" });

			const options = createBaseSyncOptions({
				writeTrelloPluginNoteId: true, // Feature is active, but note lacks ID
				syncDue: false,
				cleanUpDuringSync: true,
			});

			await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);

			const fm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
			// Missing ID must NOT be backfilled automatically
			expect(fm?.[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]).toBeUndefined();
		});

		test("Obsolete label property keys are NEVER pruned automatically during sync", async () => {
			const { vault, client } = setupStressFixture({
				obsolete_status: "Pending Archive",
				deprecated_label_prop: "V1 Tag",
				[DEFAULT_DUE_KEY]: "2026-10-18",
			});
			const remote = card({ id: "c_hero", name: "HeroNote", desc: "Detailed lore information.", dateLastActivity: "2026-01-01" });

			const options = createBaseSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
				labelPropertySync: false,
				obsoleteLabelPropertyKeys: ["obsolete_status", "deprecated_label_prop"],
			});

			await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);

			const fm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
			// Safe category pruned
			expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();

			// Obsolete label property keys STRICTLY PRESERVED
			expect(fm?.obsolete_status).toBe("Pending Archive");
			expect(fm?.deprecated_label_prop).toBe("V1 Tag");
		});

		test("Combined composite note: all safe categories pruned while all non-safe categories remain untouched", async () => {
			const initialFm = {
				// SAFE (should be pruned/migrated)
				[DEFAULT_DUE_KEY]: "2026-12-31",
				[DEFAULT_LABELS_KEY]: ["tag1"],
				[DEFAULT_MEMBERS_KEY]: ["user1"],
				[DEFAULT_CUSTOM_FIELDS_KEY]: { Score: 95 },
				old_key: "Migrated Value",
				// NON-SAFE (must remain untouched)
				[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]: "community-plugin-id-12345",
				obsolete_tag: "Custom Tag Value",
			};

			const bodyContent = [
				"User introduction.",
				"",
				"## Checklists",
				"- [ ] Non-safe checklist item",
			].join("\n");

			const { vault, client } = setupStressFixture(initialFm, bodyContent);
			const remote = card({ id: "c_hero", name: "HeroNote", desc: "User introduction.", dateLastActivity: "2026-01-01" });

			const options = createBaseSyncOptions({
				syncDue: false,
				syncLabels: false,
				syncMembers: false,
				syncCustomFields: false,
				writeTrelloPluginNoteId: false,
				syncChecklists: false,
				checklistHeading: "## Checklists",
				labelPropertySync: false,
				obsoleteLabelPropertyKeys: ["obsolete_tag"],
				cleanUpDuringSync: true,
				keyMigrations: { old_key: "new_key" },
			});

			const result = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);

			// Safe pruned
			const fm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
			expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_LABELS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_MEMBERS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_CUSTOM_FIELDS_KEY]).toBeUndefined();
			expect(fm?.old_key).toBeUndefined();
			expect(fm?.new_key).toBe("Migrated Value");

			// Non-safe strictly preserved
			expect(fm?.[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]).toBe("community-plugin-id-12345");
			expect(fm?.obsolete_tag).toBe("Custom Tag Value");

			// Body checklist strictly preserved
			expect(vault.contentOf(TEST_NOTE_PATH)).toContain("## Checklists");
			expect(vault.contentOf(TEST_NOTE_PATH)).toContain("- [ ] Non-safe checklist item");

			// cleaned report only lists safe keys
			expect(result.cleaned).toEqual(
				expect.arrayContaining([
					DEFAULT_DUE_KEY,
					DEFAULT_LABELS_KEY,
					DEFAULT_MEMBERS_KEY,
					DEFAULT_CUSTOM_FIELDS_KEY,
					"old_key",
				]),
			);
			expect(result.cleaned).not.toContain(DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY);
			expect(result.cleaned).not.toContain("obsolete_tag");
			expect(result.cleaned).not.toContain("## Checklists");
		});
	});
});
