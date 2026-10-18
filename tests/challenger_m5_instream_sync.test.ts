import { describe, expect, test, vi, beforeEach } from "vitest";
import {
	DEFAULT_ATTACHMENTS_KEY,
	DEFAULT_COVER_KEY,
	DEFAULT_LINKED_CARDS_KEY,
} from "../src/core/attachmentRef";
import { DEFAULT_CARD_REF_KEY } from "../src/core/cardRef";
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
import { TrelloClient } from "../src/trello/client";
import {
	FakeVault,
	at,
	card,
	recordingReporter,
	routedTransport,
	FATE_OPTIONS,
} from "./fakes";

const TEST_PATH = "Campaign/Arcs/ShadowKeep.md";

function createSyncOptions(overrides: Partial<NoteSyncOptions> = {}): NoteSyncOptions {
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

function buildFrontmatterNote(
	fields: Record<string, unknown>,
	body: string,
	cardId = "card_1",
	boardId = "board_1",
): string {
	const lines = ["---", `trello_board_card_id: "${boardId};${cardId}"`];
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
	lines.push("---", "", body);
	return lines.join("\n");
}

function setupHarness(
	frontmatterFields: Record<string, unknown> = {},
	body = "Detailed quest narrative and lore entries.",
	initialMtime = at("2026-03-01T12:00:00.000Z"),
	path = TEST_PATH,
	cardId = "c_shadow",
) {
	const content = buildFrontmatterNote(frontmatterFields, body, cardId);
	const vault = new FakeVault({ [path]: { content, mtime: initialMtime } });
	const { transport, requests } = routedTransport({
		"/attachments": [],
		"/customFields": [],
		"/customFieldItems": [],
		"/members": [],
		"/labels": [],
	});
	const client = new TrelloClient({ apiKey: "key_challenger", token: "token_challenger" }, transport);
	return { vault, client, requests, initialContent: content, initialMtime, path, cardId };
}

describe("Empirical Challenger M5 Gen4-3: In-Stream Sync Timestamp Preservation & Stability", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	// =========================================================================
	// 1. MTIME PRESERVATION ACROSS ALL SAFE PRUNING CATEGORIES
	// =========================================================================
	describe("1. Note mtime preservation across all individual and combined safe categories", () => {
		test("Pruning due date preserves exact note mtime", async () => {
			const { vault, client, path, cardId, initialMtime } = setupHarness({
				[DEFAULT_DUE_KEY]: "2026-12-31T23:59:59.000Z",
			});
			const remote = card({ id: cardId, name: "ShadowKeep", desc: "Detailed quest narrative and lore entries.", dateLastActivity: "2026-03-01T12:00:00.000Z" });

			const res = await syncNoteWithCard(vault, client, vault.note(path), remote, createSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
			}));

			expect(res.direction).toBe("skip");
			expect(res.cleaned).toEqual([DEFAULT_DUE_KEY]);
			expect(vault.readFrontmatter(vault.note(path))?.[DEFAULT_DUE_KEY]).toBeUndefined();
			expect(vault.note(path).mtime).toBe(initialMtime);
		});

		test("Pruning labels preserves exact note mtime", async () => {
			const { vault, client, path, cardId, initialMtime } = setupHarness({
				[DEFAULT_LABELS_KEY]: ["boss", "dungeon"],
			});
			const remote = card({ id: cardId, name: "ShadowKeep", desc: "Detailed quest narrative and lore entries.", dateLastActivity: "2026-03-01T12:00:00.000Z" });

			const res = await syncNoteWithCard(vault, client, vault.note(path), remote, createSyncOptions({
				syncLabels: false,
				cleanUpDuringSync: true,
			}));

			expect(res.direction).toBe("skip");
			expect(res.cleaned).toEqual([DEFAULT_LABELS_KEY]);
			expect(vault.readFrontmatter(vault.note(path))?.[DEFAULT_LABELS_KEY]).toBeUndefined();
			expect(vault.note(path).mtime).toBe(initialMtime);
		});

		test("Pruning members preserves exact note mtime", async () => {
			const { vault, client, path, cardId, initialMtime } = setupHarness({
				[DEFAULT_MEMBERS_KEY]: ["gm_trois", "player_one"],
			});
			const remote = card({ id: cardId, name: "ShadowKeep", desc: "Detailed quest narrative and lore entries.", dateLastActivity: "2026-03-01T12:00:00.000Z" });

			const res = await syncNoteWithCard(vault, client, vault.note(path), remote, createSyncOptions({
				syncMembers: false,
				cleanUpDuringSync: true,
			}));

			expect(res.direction).toBe("skip");
			expect(res.cleaned).toEqual([DEFAULT_MEMBERS_KEY]);
			expect(vault.readFrontmatter(vault.note(path))?.[DEFAULT_MEMBERS_KEY]).toBeUndefined();
			expect(vault.note(path).mtime).toBe(initialMtime);
		});

		test("Pruning custom fields preserves exact note mtime", async () => {
			const { vault, client, path, cardId, initialMtime } = setupHarness({
				[DEFAULT_CUSTOM_FIELDS_KEY]: { Level: 15, Region: "Grimwood" },
			});
			const remote = card({ id: cardId, name: "ShadowKeep", desc: "Detailed quest narrative and lore entries.", dateLastActivity: "2026-03-01T12:00:00.000Z" });

			const res = await syncNoteWithCard(vault, client, vault.note(path), remote, createSyncOptions({
				syncCustomFields: false,
				cleanUpDuringSync: true,
			}));

			expect(res.direction).toBe("skip");
			expect(res.cleaned).toEqual([DEFAULT_CUSTOM_FIELDS_KEY]);
			expect(vault.readFrontmatter(vault.note(path))?.[DEFAULT_CUSTOM_FIELDS_KEY]).toBeUndefined();
			expect(vault.note(path).mtime).toBe(initialMtime);
		});

		test("Pruning attachments preserves exact note mtime", async () => {
			const { vault, client, path, cardId, initialMtime } = setupHarness({
				[DEFAULT_ATTACHMENTS_KEY]: [{ name: "floor1.png", url: "https://trello.com/att1" }],
			});
			const remote = card({ id: cardId, name: "ShadowKeep", desc: "Detailed quest narrative and lore entries.", dateLastActivity: "2026-03-01T12:00:00.000Z" });

			const res = await syncNoteWithCard(vault, client, vault.note(path), remote, createSyncOptions({
				syncAttachments: false,
				cleanUpDuringSync: true,
			}));

			expect(res.direction).toBe("skip");
			expect(res.cleaned).toEqual([DEFAULT_ATTACHMENTS_KEY]);
			expect(vault.readFrontmatter(vault.note(path))?.[DEFAULT_ATTACHMENTS_KEY]).toBeUndefined();
			expect(vault.note(path).mtime).toBe(initialMtime);
		});

		test("Pruning linked cards preserves exact note mtime", async () => {
			const { vault, client, path, cardId, initialMtime } = setupHarness({
				[DEFAULT_LINKED_CARDS_KEY]: [{ id: "c_linked_1", name: "Sidequest" }],
			});
			const remote = card({ id: cardId, name: "ShadowKeep", desc: "Detailed quest narrative and lore entries.", dateLastActivity: "2026-03-01T12:00:00.000Z" });

			const res = await syncNoteWithCard(vault, client, vault.note(path), remote, createSyncOptions({
				syncLinkedCards: false,
				cleanUpDuringSync: true,
			}));

			expect(res.direction).toBe("skip");
			expect(res.cleaned).toEqual([DEFAULT_LINKED_CARDS_KEY]);
			expect(vault.readFrontmatter(vault.note(path))?.[DEFAULT_LINKED_CARDS_KEY]).toBeUndefined();
			expect(vault.note(path).mtime).toBe(initialMtime);
		});

		test("Pruning remote cover URL preserves exact note mtime", async () => {
			const remoteCoverUrl = "https://trello-attachments.s3.amazonaws.com/b/c/cover.png";
			const { vault, client, path, cardId, initialMtime } = setupHarness({
				[DEFAULT_COVER_KEY]: remoteCoverUrl,
			});
			const remote = card({ id: cardId, name: "ShadowKeep", desc: "Detailed quest narrative and lore entries.", dateLastActivity: "2026-03-01T12:00:00.000Z" });

			const res = await syncNoteWithCard(vault, client, vault.note(path), remote, createSyncOptions({
				syncCardCover: false,
				cleanUpDuringSync: true,
			}));

			expect(res.direction).toBe("skip");
			expect(res.cleaned).toEqual([DEFAULT_COVER_KEY]);
			expect(vault.readFrontmatter(vault.note(path))?.[DEFAULT_COVER_KEY]).toBeUndefined();
			expect(vault.note(path).mtime).toBe(initialMtime);
		});

		test("Applying key migration preserves exact note mtime", async () => {
			const { vault, client, path, cardId, initialMtime } = setupHarness({
				old_quest_rating: "Epic",
			});
			const remote = card({ id: cardId, name: "ShadowKeep", desc: "Detailed quest narrative and lore entries.", dateLastActivity: "2026-03-01T12:00:00.000Z" });

			const res = await syncNoteWithCard(vault, client, vault.note(path), remote, createSyncOptions({
				cleanUpDuringSync: true,
				keyMigrations: { old_quest_rating: "new_quest_tier" },
			}));

			expect(res.direction).toBe("skip");
			expect(res.cleaned).toEqual(["old_quest_rating"]);
			const fm = vault.readFrontmatter(vault.note(path));
			expect(fm?.old_quest_rating).toBeUndefined();
			expect(fm?.new_quest_tier).toBe("Epic");
			expect(vault.note(path).mtime).toBe(initialMtime);
		});

		test("Composite multi-category simultaneous prune preserves exact note mtime", async () => {
			const { vault, client, path, cardId, initialMtime } = setupHarness({
				[DEFAULT_DUE_KEY]: "2026-10-18T10:00:00.000Z",
				[DEFAULT_LABELS_KEY]: ["elite", "raid"],
				[DEFAULT_MEMBERS_KEY]: ["guildmaster"],
				[DEFAULT_CUSTOM_FIELDS_KEY]: { Diff: "Nightmare" },
				[DEFAULT_ATTACHMENTS_KEY]: [{ name: "map.jpg", url: "https://trello.com/map.jpg" }],
				[DEFAULT_LINKED_CARDS_KEY]: [{ id: "c_loot", name: "Loot Table" }],
				[DEFAULT_COVER_KEY]: "https://trello-attachments.s3.amazonaws.com/b/c/cover.png",
				legacy_phase: "Phase 1",
			});
			const remote = card({ id: cardId, name: "ShadowKeep", desc: "Detailed quest narrative and lore entries.", dateLastActivity: "2026-03-01T12:00:00.000Z" });

			const res = await syncNoteWithCard(vault, client, vault.note(path), remote, createSyncOptions({
				syncDue: false,
				syncLabels: false,
				syncMembers: false,
				syncCustomFields: false,
				syncAttachments: false,
				syncLinkedCards: false,
				syncCardCover: false,
				cleanUpDuringSync: true,
				keyMigrations: { legacy_phase: "modern_phase" },
			}));

			expect(res.direction).toBe("skip");
			expect(res.cleaned).toHaveLength(8);
			expect(vault.note(path).mtime).toBe(initialMtime);

			const fm = vault.readFrontmatter(vault.note(path));
			expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_LABELS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_MEMBERS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_CUSTOM_FIELDS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_ATTACHMENTS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_LINKED_CARDS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_COVER_KEY]).toBeUndefined();
			expect(fm?.legacy_phase).toBeUndefined();
			expect(fm?.modern_phase).toBe("Phase 1");
		});

		test("Sequential repeated in-stream prunes across multiple sync cycles keep mtime exact throughout", async () => {
			const { vault, client, path, cardId, initialMtime } = setupHarness({
				[DEFAULT_DUE_KEY]: "2026-10-18T10:00:00.000Z",
				phase_old: "Alpha",
				status_old: "Pending",
			});
			const remote = card({ id: cardId, name: "ShadowKeep", desc: "Detailed quest narrative and lore entries.", dateLastActivity: "2026-03-01T12:00:00.000Z" });

			// Cycle 1: Prune due date
			const res1 = await syncNoteWithCard(vault, client, vault.note(path), remote, createSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
			}));
			expect(res1.cleaned).toEqual([DEFAULT_DUE_KEY]);
			expect(vault.note(path).mtime).toBe(initialMtime);

			// Cycle 2: Migrate phase_old -> phase_new
			const res2 = await syncNoteWithCard(vault, client, vault.note(path), remote, createSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
				keyMigrations: { phase_old: "phase_new" },
			}));
			expect(res2.cleaned).toEqual(["phase_old"]);
			expect(vault.note(path).mtime).toBe(initialMtime);
			expect(vault.readFrontmatter(vault.note(path))?.phase_new).toBe("Alpha");

			// Cycle 3: Migrate status_old -> status_new
			const res3 = await syncNoteWithCard(vault, client, vault.note(path), remote, createSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
				keyMigrations: { status_old: "status_new" },
			}));
			expect(res3.cleaned).toEqual(["status_old"]);
			expect(vault.note(path).mtime).toBe(initialMtime);
			expect(vault.readFrontmatter(vault.note(path))?.status_new).toBe("Pending");

			// Cycle 4: All already pruned -> no-op
			const res4 = await syncNoteWithCard(vault, client, vault.note(path), remote, createSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
			}));
			expect(res4.cleaned).toBeUndefined();
			expect(vault.note(path).mtime).toBe(initialMtime);
		});
	});

	// =========================================================================
	// 2. SUBSEQUENT SYNC WITH UNCHANGED CARD: STRICT "SKIP" & 0 NETWORK CALLS
	// =========================================================================
	describe("2. Subsequent sync with unchanged card results in direction 'skip' and 0 network requests", () => {
		test("Subsequent sync immediately after in-stream prune results in 'skip', 0 network requests, and untouched mtime", async () => {
			const { vault, client, requests, path, cardId, initialMtime } = setupHarness({
				[DEFAULT_DUE_KEY]: "2026-12-31",
			});
			const remote = card({ id: cardId, name: "ShadowKeep", desc: "Detailed quest narrative and lore entries.", dateLastActivity: "2026-03-01T12:00:00.000Z" });

			const options = createSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
			});

			// Pass 1: Prunes stale due date
			const res1 = await syncNoteWithCard(vault, client, vault.note(path), remote, options);
			expect(res1.direction).toBe("skip");
			expect(res1.cleaned).toEqual([DEFAULT_DUE_KEY]);
			expect(requests).toHaveLength(0);
			expect(vault.note(path).mtime).toBe(initialMtime);

			// Pass 2: Unchanged remote card -> strictly "skip", 0 network requests, cleaned is undefined
			const res2 = await syncNoteWithCard(vault, client, vault.note(path), remote, options);
			expect(res2.direction).toBe("skip");
			expect(res2.cleaned).toBeUndefined();
			expect(requests).toHaveLength(0);
			expect(vault.note(path).mtime).toBe(initialMtime);

			// Passes 3 to 10 in a stress loop
			for (let i = 3; i <= 10; i++) {
				const loopRes = await syncNoteWithCard(vault, client, vault.note(path), remote, options);
				expect(loopRes.direction).toBe("skip");
				expect(loopRes.cleaned).toBeUndefined();
				expect(requests).toHaveLength(0);
				expect(vault.note(path).mtime).toBe(initialMtime);
			}
		});

		test("Policy variants (prefer-local, prefer-remote) also strictly yield 'skip' and 0 network requests when unchanged", async () => {
			for (const policy of ["newer-wins", "prefer-local", "prefer-remote"] as const) {
				const { vault, client, requests, path, cardId, initialMtime } = setupHarness({
					[DEFAULT_DUE_KEY]: "2026-12-31",
					[DEFAULT_LABELS_KEY]: ["tag1"],
				});
				const remote = card({ id: cardId, name: "ShadowKeep", desc: "Detailed quest narrative and lore entries.", dateLastActivity: "2026-03-01T12:00:00.000Z" });

				const options = createSyncOptions({
					policy,
					syncDue: false,
					syncLabels: false,
					cleanUpDuringSync: true,
				});

				// Sync 1: Prunes stale fields
				const res1 = await syncNoteWithCard(vault, client, vault.note(path), remote, options);
				expect(res1.direction).toBe("skip");
				expect(vault.note(path).mtime).toBe(initialMtime);

				// Sync 2: Subsequent run under same policy
				const res2 = await syncNoteWithCard(vault, client, vault.note(path), remote, options);
				expect(res2.direction).toBe("skip");
				expect(requests).toHaveLength(0);
				expect(vault.note(path).mtime).toBe(initialMtime);
			}
		});

		test("Margin window (marginMs > 0) does NOT produce false conflict on subsequent syncs", async () => {
			const { vault, client, requests, path, cardId, initialMtime } = setupHarness({
				[DEFAULT_DUE_KEY]: "2026-12-31",
			});
			const remote = card({ id: cardId, name: "ShadowKeep", desc: "Detailed quest narrative and lore entries.", dateLastActivity: "2026-03-01T12:00:00.000Z" });

			const options = createSyncOptions({
				marginMs: 10000, // 10s margin window
				syncDue: false,
				cleanUpDuringSync: true,
			});

			const res1 = await syncNoteWithCard(vault, client, vault.note(path), remote, options);
			expect(res1.direction).toBe("skip");
			expect(vault.note(path).mtime).toBe(initialMtime);

			const res2 = await syncNoteWithCard(vault, client, vault.note(path), remote, options);
			expect(res2.direction).toBe("skip");
			expect(res2.cleaned).toBeUndefined();
			expect(requests).toHaveLength(0);
			expect(vault.note(path).mtime).toBe(initialMtime);
		});
	});

	// =========================================================================
	// 3. SUBSEQUENT SYNC WITH NEWER REMOTE CARD: STRICT "PULL"
	// =========================================================================
	describe("3. Subsequent sync with newer remote card results in direction 'pull'", () => {
		test("Subsequent sync with newer remote card pulls remote changes cleanly without false conflict", async () => {
			const { vault, client, path, cardId, initialMtime } = setupHarness({
				[DEFAULT_DUE_KEY]: "2026-12-31",
			});
			const remoteInitial = card({
				id: cardId,
				name: "ShadowKeep",
				desc: "Detailed quest narrative and lore entries.",
				dateLastActivity: "2026-03-01T12:00:00.000Z",
			});

			const options = createSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
			});

			// Pass 1: Prunes stale due date in-stream, preserving mtime
			const res1 = await syncNoteWithCard(vault, client, vault.note(path), remoteInitial, options);
			expect(res1.direction).toBe("skip");
			expect(vault.note(path).mtime).toBe(initialMtime);

			// Trello collaborator updates the card remotely later
			const updatedRemote = card({
				id: cardId,
				name: "ShadowKeep",
				desc: "Updated quest narrative after collaborator review on Trello.",
				dateLastActivity: "2026-03-10T15:30:00.000Z", // Newer than initial mtime
			});

			// Pass 2: Sync evaluates strictly to "pull"
			const res2 = await syncNoteWithCard(vault, client, vault.note(path), updatedRemote, options);
			expect(res2.direction).toBe("pull");
			expect(vault.contentOf(path)).toContain("Updated quest narrative after collaborator review on Trello.");

			// Stale due date remains pruned even after pull
			const fm = vault.readFrontmatter(vault.note(path));
			expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();

			// Pass 3: Immediate follow-up sync is in sync -> evaluates strictly to "skip"
			const res3 = await syncNoteWithCard(vault, client, vault.note(path), updatedRemote, options);
			expect(res3.direction).toBe("skip");
			expect(res3.cleaned).toBeUndefined();
		});

		test("Simultaneous remote pull + local stale property prune executes cleanly", async () => {
			const { vault, client, path, cardId } = setupHarness(
				{ [DEFAULT_DUE_KEY]: "2026-12-31" },
				"Old local text",
				at("2026-01-01T00:00:00.000Z"),
			);
			const newerRemote = card({
				id: cardId,
				name: "ShadowKeep",
				desc: "New remote text from Trello",
				dateLastActivity: "2026-02-01T00:00:00.000Z",
			});

			const options = createSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
			});

			const res = await syncNoteWithCard(vault, client, vault.note(path), newerRemote, options);
			expect(res.direction).toBe("pull");
			expect(res.cleaned).toEqual([DEFAULT_DUE_KEY]);
			expect(vault.contentOf(path)).toContain("New remote text from Trello");
			expect(vault.readFrontmatter(vault.note(path))?.[DEFAULT_DUE_KEY]).toBeUndefined();
		});
	});

	// =========================================================================
	// 4. SUBSEQUENT SYNC WITH NEWER LOCAL NOTE: STRICT "PUSH"
	// =========================================================================
	describe("4. Subsequent sync with newer local card results in direction 'push'", () => {
		test("Subsequent genuine local edit pushes to Trello without conflict", async () => {
			const { vault, client, requests, path, cardId, initialMtime } = setupHarness({
				[DEFAULT_DUE_KEY]: "2026-12-31",
			});
			const remote = card({
				id: cardId,
				name: "ShadowKeep",
				desc: "Detailed quest narrative and lore entries.",
				dateLastActivity: "2026-03-01T12:00:00.000Z",
			});

			const options = createSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
			});

			// Pass 1: Prunes due date, preserving mtime
			const res1 = await syncNoteWithCard(vault, client, vault.note(path), remote, options);
			expect(res1.direction).toBe("skip");
			expect(vault.note(path).mtime).toBe(initialMtime);

			// User locally edits the note body and saves it (bumping mtime)
			const localEditedBody = "Local user lore additions written in Obsidian.";
			const newMtime = at("2026-03-20T10:00:00.000Z");
			const currentFmBlock = vault.contentOf(path).split("\n\n")[0];
			await vault.write(vault.note(path), `${currentFmBlock}\n\n${localEditedBody}`);
			// Manually simulate file system timestamp update for user edit
			(vault as any).files.set(path, {
				content: `${currentFmBlock}\n\n${localEditedBody}`,
				mtime: newMtime,
			});

			// Pass 2: Sync evaluates strictly to "push"
			const res2 = await syncNoteWithCard(vault, client, vault.note(path), remote, options);
			expect(res2.direction).toBe("push");

			// Verify Trello received the PUT request with local content
			const putReq = requests.find((r) => r.method === "PUT" && r.url.includes(`/cards/${cardId}`));
			expect(putReq).toBeDefined();
			const decoded = decodeURIComponent((putReq?.body ?? "").replace(/\+/g, " "));
			expect(decoded).toContain(localEditedBody);
		});
	});

	// =========================================================================
	// 5. LARGE BATCH & FOLDER SYNC STRESS TEST (60 NOTES)
	// =========================================================================
	describe("5. Large batch / folder multi-sync stress test", () => {
		test("60 notes with heterogeneous stale properties: mtime preserved, 0 extra requests, followed by clean subsequent syncs", async () => {
			const NOTE_COUNT = 60;
			const initialMtime = at("2026-01-15T00:00:00.000Z");
			const files: Record<string, { content: string; mtime: number }> = {};
			const remoteCards: any[] = [];

			for (let i = 1; i <= NOTE_COUNT; i++) {
				const cardId = `card_batch_${i}`;
				const path = `World/Note_${i}.md`;
				const body = `Original body content for note ${i}`;
				const fmFields: Record<string, unknown> = {};

				if (i % 2 === 0) fmFields[DEFAULT_DUE_KEY] = `2026-11-${(i % 28) + 1}`;
				if (i % 3 === 0) fmFields[DEFAULT_LABELS_KEY] = [`tag_${i}`];
				if (i % 5 === 0) fmFields[DEFAULT_MEMBERS_KEY] = [`user_${i}`];
				if (i % 7 === 0) fmFields[DEFAULT_CUSTOM_FIELDS_KEY] = { Val: i };

				const noteContent = buildFrontmatterNote(fmFields, body, cardId, "board_batch");
				files[path] = { content: noteContent, mtime: initialMtime };

				remoteCards.push(
					card({
						id: cardId,
						idBoard: "board_batch",
						idList: "list_batch",
						name: `Note_${i}`,
						desc: body,
						dateLastActivity: "2026-01-15T00:00:00.000Z",
					}),
				);
			}

			const vault = new FakeVault(files);
			const { transport, requests } = routedTransport({
				"/boards/board_batch/cards": remoteCards,
				"/lists/list_batch/cards": remoteCards,
				"/boards/board_batch/lists": [{ id: "list_batch", name: "World" }],
				"/boards/board_batch/actions": [],
			});
			const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

			const folderOptions: FolderSyncOptions = {
				...createSyncOptions({
					syncDue: false,
					syncLabels: false,
					syncMembers: false,
					syncCustomFields: false,
					cleanUpDuringSync: true,
				}),
				...FATE_OPTIONS,
				archiveCreateMissing: false,
				adoptUnlinkedByName: false,
				allowCreate: false,
				boardId: "board_batch",
				cardRefFrontmatterKey: DEFAULT_CARD_REF_KEY,
			};

			// Pass 1: Initial folder sync prunes stale properties across all 60 notes
			const reporter1 = recordingReporter();
			await syncFolder(
				vault,
				client,
				{ folder: "World", listId: "list_batch", templateName: "" },
				folderOptions,
				reporter1,
				remoteCards,
			);

			// Invariant 1: Exactly 0 network write calls made
			const writeRequests = requests.filter((r) => r.method === "POST" || r.method === "PUT");
			expect(writeRequests).toHaveLength(0);

			// Invariant 2: ALL 60 notes have their exact initial mtime preserved!
			for (let i = 1; i <= NOTE_COUNT; i++) {
				const path = `World/Note_${i}.md`;
				const note = vault.note(path);
				expect(note.mtime, `mtime drifted on ${path}`).toBe(initialMtime);

				const fm = vault.readFrontmatter(note);
				expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();
				expect(fm?.[DEFAULT_LABELS_KEY]).toBeUndefined();
				expect(fm?.[DEFAULT_MEMBERS_KEY]).toBeUndefined();
				expect(fm?.[DEFAULT_CUSTOM_FIELDS_KEY]).toBeUndefined();
			}

			// Pass 2: Subsequent full folder sync on unchanged cards
			requests.length = 0; // Clear read request log
			const reporter2 = recordingReporter();
			await syncFolder(
				vault,
				client,
				{ folder: "World", listId: "list_batch", templateName: "" },
				folderOptions,
				reporter2,
				remoteCards,
			);

			// Invariant 3: 0 write requests on subsequent sync, all notes evaluate to "skip"
			const writeRequests2 = requests.filter((r) => r.method === "POST" || r.method === "PUT");
			expect(writeRequests2).toHaveLength(0);

			// Pass 3: Half the cards (30 cards) updated remotely on Trello
			for (let i = 1; i <= 30; i++) {
				remoteCards[i - 1].desc = `Updated remote body on Trello for note ${i}`;
				remoteCards[i - 1].dateLastActivity = "2026-02-01T00:00:00.000Z";
			}

			requests.length = 0;
			const reporter3 = recordingReporter();
			await syncFolder(
				vault,
				client,
				{ folder: "World", listId: "list_batch", templateName: "" },
				folderOptions,
				reporter3,
				remoteCards,
			);

			// Invariant 4: Exactly 30 notes pulled, 30 notes skipped
			for (let i = 1; i <= 30; i++) {
				expect(vault.contentOf(`World/Note_${i}.md`)).toContain(`Updated remote body on Trello for note ${i}`);
			}
			for (let i = 31; i <= NOTE_COUNT; i++) {
				expect(vault.contentOf(`World/Note_${i}.md`)).toContain(`Original body content for note ${i}`);
				expect(vault.note(`World/Note_${i}.md`).mtime).toBe(initialMtime);
			}

			// Pass 4: Subsequent sync after pulls -> all notes in sync -> 0 write requests
			requests.length = 0;
			const reporter4 = recordingReporter();
			await syncFolder(
				vault,
				client,
				{ folder: "World", listId: "list_batch", templateName: "" },
				folderOptions,
				reporter4,
				remoteCards,
			);
			const writeRequests4 = requests.filter((r) => r.method === "POST" || r.method === "PUT");
			expect(writeRequests4).toHaveLength(0);
		});
	});

	// =========================================================================
	// 6. CONCURRENT SYNCS UNDER OPERATIONGUARD
	// =========================================================================
	describe("6. Concurrent Operations Under OperationGuard", () => {
		test("Concurrent sync calls on same note with stale properties preserve mtime and do not corrupt data", async () => {
			const guard = new OperationGuard();
			const { vault, client, requests, path, cardId, initialMtime } = setupHarness({
				[DEFAULT_DUE_KEY]: "2026-12-31",
			});
			const remote = card({
				id: cardId,
				name: "ShadowKeep",
				desc: "Detailed quest narrative and lore entries.",
				dateLastActivity: "2026-03-01T12:00:00.000Z",
			});

			const options = createSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
				guard,
			});

			// Fire 8 concurrent sync calls
			const results = await Promise.all(
				Array.from({ length: 8 }, () =>
					syncNoteWithCard(vault, client, vault.note(path), remote, options),
				),
			);

			expect(results).toHaveLength(8);
			expect(requests).toHaveLength(0);
			expect(vault.note(path).mtime).toBe(initialMtime);
			expect(vault.readFrontmatter(vault.note(path))?.[DEFAULT_DUE_KEY]).toBeUndefined();
		});
	});

	// =========================================================================
	// 7. HISTORY RECORDING & ROLLBACK OF IN-STREAM PRUNE
	// =========================================================================
	describe("7. History recording and rollback integrity", () => {
		test("In-stream prune recorded via wrapWithHistoryRecorder is accurately undone to pre-sync state", async () => {
			const { vault: baseVault, client, path, cardId, initialContent } = setupHarness({
				[DEFAULT_DUE_KEY]: "2026-12-31",
			});
			const remote = card({
				id: cardId,
				name: "ShadowKeep",
				desc: "Detailed quest narrative and lore entries.",
				dateLastActivity: "2026-03-01T12:00:00.000Z",
			});

			const actions: SyncAction[] = [];
			const recordingVault = wrapWithHistoryRecorder(baseVault, (action) => actions.push(action));

			const options = createSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
			});

			const result = await syncNoteWithCard(recordingVault, client, baseVault.note(path), remote, options);
			expect(result.direction).toBe("skip");
			expect(result.cleaned).toEqual([DEFAULT_DUE_KEY]);
			expect(actions.length).toBeGreaterThan(0);

			// Frontmatter is pruned
			expect(baseVault.readFrontmatter(baseVault.note(path))?.[DEFAULT_DUE_KEY]).toBeUndefined();

			// Undo the sync run
			const run: SyncRun = {
				timestamp: new Date().toISOString(),
				scope: path,
				actions,
			};
			const { stats } = await undoRun(baseVault, run);
			expect(stats.reverted).toBe(1);

			// Note content is restored byte-identically
			expect(baseVault.contentOf(path)).toBe(initialContent);
			expect(baseVault.readFrontmatter(baseVault.note(path))?.[DEFAULT_DUE_KEY]).toBe("2026-12-31");
		});
	});
});
