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
import { TrelloClient } from "../src/trello/client";
import {
	FakeVault,
	at,
	card,
	recordingReporter,
	routedTransport,
	FATE_OPTIONS,
} from "./fakes";

const TEST_NOTE_PATH = "Campaign/Encounters/DragonLair.md";

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

function buildFrontmatterString(fields: Record<string, unknown>, cardId = "c_dragon"): string {
	const lines = ["---", `trello_board_card_id: "b_encounter;${cardId}"`];
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
		} else if (typeof v === "number" || typeof v === "boolean") {
			lines.push(`${k}: ${v}`);
		} else {
			lines.push(`${k}: "${v}"`);
		}
	}
	lines.push("---");
	return lines.join("\n");
}

function setupNoteFixture(
	frontmatterFields: Record<string, unknown> = {},
	body = "# Dragon Lair\nAncient red dragon sanctuary with magma pools.",
	mtime = at("2026-03-01T12:00:00.000Z"),
	path = TEST_NOTE_PATH,
	cardId = "c_dragon",
) {
	const fmLines = buildFrontmatterString(frontmatterFields, cardId);
	const content = `${fmLines}\n\n${body}`;
	const vault = new FakeVault({ [path]: { content, mtime } });
	const { transport, requests } = routedTransport({});
	const client = new TrelloClient({ apiKey: "test_key", token: "test_tok" }, transport);
	return { vault, client, requests, initialContent: content, initialMtime: mtime, path, cardId };
}

describe("Empirical Challenger M5 Gen4-4: Multi-Sync Stability & Idempotency", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	// =========================================================================
	// 1. Sequential Multi-Sync Idempotency & Zero Timestamp Drift Across 30 Runs
	// =========================================================================
	describe("1. Sequential Multi-Sync Idempotency Across 30 Runs", () => {
		test("30 sequential syncs on the same note preserve exact mtime and produce 0 API calls", async () => {
			const initialMtime = at("2026-03-01T12:00:00.000Z");
			const { vault, client, requests } = setupNoteFixture(
				{
					[DEFAULT_DUE_KEY]: "2026-12-31T23:59:59.000Z",
					[DEFAULT_LABELS_KEY]: ["boss-encounter", "deadly"],
					[DEFAULT_MEMBERS_KEY]: ["dm_alice", "helper_bob"],
					[DEFAULT_CUSTOM_FIELDS_KEY]: { ThreatLevel: "Legendary" },
					[DEFAULT_COVER_KEY]: "https://trello-attachments.s3.amazonaws.com/b_encounter/c_dragon/cover.jpg",
					keeper_lore: "Sacred Draconic History",
				},
				"# Dragon Lair\nAncient red dragon sanctuary with magma pools.",
				initialMtime,
			);

			const remote = card({
				id: "c_dragon",
				name: "DragonLair",
				desc: "# Dragon Lair\nAncient red dragon sanctuary with magma pools.",
				dateLastActivity: "2026-03-01T12:00:00.000Z",
			});

			const options = createSyncOptions({
				syncDue: false,
				syncLabels: false,
				syncMembers: false,
				syncCustomFields: false,
				syncCardCover: false,
				cleanUpDuringSync: true,
			});

			let postCleanContent = "";

			for (let i = 1; i <= 30; i++) {
				const res = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);

				expect(res.direction).toBe("skip");

				if (i === 1) {
					// First run performs cleanup of stale properties
					expect(res.cleaned).toBeDefined();
					expect(res.cleaned).toEqual(
						expect.arrayContaining([
							DEFAULT_DUE_KEY,
							DEFAULT_LABELS_KEY,
							DEFAULT_MEMBERS_KEY,
							DEFAULT_CUSTOM_FIELDS_KEY,
							DEFAULT_COVER_KEY,
						]),
					);
					postCleanContent = vault.contentOf(TEST_NOTE_PATH);
				} else {
					// Subsequent runs MUST be idempotent: no further cleaning
					expect(res.cleaned).toBeUndefined();
					// Byte-identical content across runs 2 through 30
					expect(vault.contentOf(TEST_NOTE_PATH)).toBe(postCleanContent);
				}

				// Timestamp stability: mtime MUST strictly equal initialMtime on every iteration
				const currentMtime = vault.note(TEST_NOTE_PATH).mtime;
				expect(currentMtime, `Drift detected at iteration ${i}`).toBe(initialMtime);
			}

			// Invariant: exactly 0 Trello HTTP calls made across all 30 runs
			expect(requests).toHaveLength(0);

			// Verify final frontmatter: all stale properties pruned, user property preserved
			const finalFm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
			expect(finalFm?.[DEFAULT_DUE_KEY]).toBeUndefined();
			expect(finalFm?.[DEFAULT_LABELS_KEY]).toBeUndefined();
			expect(finalFm?.[DEFAULT_MEMBERS_KEY]).toBeUndefined();
			expect(finalFm?.[DEFAULT_CUSTOM_FIELDS_KEY]).toBeUndefined();
			expect(finalFm?.[DEFAULT_COVER_KEY]).toBeUndefined();
			expect(finalFm?.keeper_lore).toBe("Sacred Draconic History");
			expect(finalFm?.trello_board_card_id).toBe("b_encounter;c_dragon");
		});

		test("Key migrations are executed once on run 1 and remain stable without oscillating on runs 2..10", async () => {
			const initialMtime = at("2026-03-01T12:00:00.000Z");
			const { vault, client } = setupNoteFixture(
				{
					legacy_encounter_xp: "15000",
					deprecated_tier: "Tier-4",
				},
				"# Dragon Lair\nContent.",
				initialMtime,
			);

			const remote = card({
				id: "c_dragon",
				name: "DragonLair",
				desc: "# Dragon Lair\nContent.",
				dateLastActivity: "2026-03-01T12:00:00.000Z",
			});

			const options = createSyncOptions({
				cleanUpDuringSync: true,
				keyMigrations: {
					legacy_encounter_xp: "encounter_xp",
					deprecated_tier: "encounter_tier",
				},
			});

			for (let i = 1; i <= 10; i++) {
				const res = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);
				expect(res.direction).toBe("skip");

				if (i === 1) {
					expect(res.cleaned).toEqual(expect.arrayContaining(["legacy_encounter_xp", "deprecated_tier"]));
				} else {
					expect(res.cleaned).toBeUndefined();
				}

				expect(vault.note(TEST_NOTE_PATH).mtime).toBe(initialMtime);
			}

			const fm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
			expect(fm?.legacy_encounter_xp).toBeUndefined();
			expect(fm?.deprecated_tier).toBeUndefined();
			expect(fm?.encounter_xp).toBe("15000");
			expect(fm?.encounter_tier).toBe("Tier-4");
		});
	});

	// =========================================================================
	// 2. Sequential Multi-Sync Interleaved with Local and Remote Edits
	// =========================================================================
	describe("2. Sequential Multi-Sync with Local & Remote State Evolution", () => {
		test("Local user edit after in-stream cleanup correctly triggers push without re-introducing pruned keys", async () => {
			const t0 = at("2026-03-01T10:00:00.000Z");
			const { vault, client, requests } = setupNoteFixture(
				{ [DEFAULT_DUE_KEY]: "2026-12-31" },
				"Initial body text.",
				t0,
			);

			const remote = card({
				id: "c_dragon",
				name: "DragonLair",
				desc: "Initial body text.",
				dateLastActivity: "2026-03-01T10:00:00.000Z",
			});

			const options = createSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
			});

			// Run 1: prunes stale due key; mtime preserved
			const res1 = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);
			expect(res1.direction).toBe("skip");
			expect(res1.cleaned).toEqual([DEFAULT_DUE_KEY]);
			expect(vault.note(TEST_NOTE_PATH).mtime).toBe(t0);

			// Step 2: User locally edits note in Obsidian at t1 > t0
			const t1 = at("2026-03-01T14:00:00.000Z");
			const updatedLocalBody = "Updated body after slaying the dragon!";
			const currentContent = vault.contentOf(TEST_NOTE_PATH);
			const newContent = currentContent.replace("Initial body text.", updatedLocalBody);
			// Simulate Obsidian updating file with newer mtime
			await vault.write(vault.note(TEST_NOTE_PATH), newContent);
			// Force simulated mtime to t1
			(vault as unknown as { files: Map<string, { content: string; mtime: number }> })
				.files.get(TEST_NOTE_PATH)!.mtime = t1;

			// Run 2: sync evaluates local is newer -> triggers push
			const res2 = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);
			expect(res2.direction).toBe("push");
			expect(res2.cleaned).toBeUndefined(); // Nothing left to clean

			// Verify push PUT request sent to Trello with updated body
			const putReq = requests.find((r) => r.method === "PUT" && r.url.includes("/cards/c_dragon"));
			expect(putReq).toBeDefined();
			const decoded = decodeURIComponent((putReq?.body ?? "").replace(/\+/g, " "));
			expect(decoded).toContain(updatedLocalBody);

			// Verify due key was not resurrected
			const finalFm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
			expect(finalFm?.[DEFAULT_DUE_KEY]).toBeUndefined();
		});

		test("Remote card update after in-stream cleanup correctly triggers pull without resurrecting pruned properties", async () => {
			const t0 = at("2026-03-01T10:00:00.000Z");
			const { vault, client } = setupNoteFixture(
				{ [DEFAULT_DUE_KEY]: "2026-12-31" },
				"Initial body text.",
				t0,
			);

			const remoteV1 = card({
				id: "c_dragon",
				name: "DragonLair",
				desc: "Initial body text.",
				dateLastActivity: "2026-03-01T10:00:00.000Z",
			});

			const options = createSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
			});

			// Run 1: in-stream alignment prunes due key; mtime preserved
			const res1 = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remoteV1, options);
			expect(res1.direction).toBe("skip");
			expect(vault.note(TEST_NOTE_PATH).mtime).toBe(t0);

			// Step 2: Remote card updated on Trello at t2 > t0
			const t2 = "2026-03-01T18:00:00.000Z";
			const remoteV2 = card({
				id: "c_dragon",
				name: "DragonLair",
				desc: "Remote author added new lore from web interface.",
				dateLastActivity: t2,
			});

			// Run 2: sync evaluates remote is newer -> triggers pull
			const res2 = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remoteV2, options);
			expect(res2.direction).toBe("pull");
			expect(res2.cleaned).toBeUndefined();

			// Note body was updated with remote content
			expect(vault.contentOf(TEST_NOTE_PATH)).toContain("Remote author added new lore from web interface.");

			// Stale due key was NOT resurrected by pull
			const fm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
			expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();

			// Run 3: subsequent sync with unchanged remoteV2 strictly skips
			const res3 = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remoteV2, options);
			expect(res3.direction).toBe("skip");
		});

		test("Settings flip oscillation (disabled -> enabled -> disabled) cleans, pulls, then re-cleans safely", async () => {
			const initialMtime = at("2026-01-01T00:00:00.000Z");
			const { vault, client } = setupNoteFixture(
				{ [DEFAULT_DUE_KEY]: "2026-06-01" },
				"Same body.",
				initialMtime,
			);

			const remoteCard = card({
				id: "c_dragon",
				name: "DragonLair",
				desc: "Same body.",
				due: "2026-09-09T00:00:00.000Z",
				dateLastActivity: "2026-01-01T00:00:00.000Z",
			});

			// Phase 1: syncDue: false -> prunes trello_due
			const optsDisabled = createSyncOptions({ syncDue: false, cleanUpDuringSync: true });
			const res1 = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remoteCard, optsDisabled);
			expect(res1.direction).toBe("skip");
			expect(res1.cleaned).toEqual([DEFAULT_DUE_KEY]);
			expect(vault.readFrontmatter(vault.note(TEST_NOTE_PATH))?.[DEFAULT_DUE_KEY]).toBeUndefined();
			expect(vault.note(TEST_NOTE_PATH).mtime).toBe(initialMtime);

			// Phase 2: syncDue: true -> pulls remote due date into frontmatter
			const optsEnabled = createSyncOptions({ syncDue: true, cleanUpDuringSync: true });
			// Give remote a newer date to pull or let standard due convergence run
			const remoteCardNewer = card({
				...remoteCard,
				dateLastActivity: "2026-01-02T00:00:00.000Z",
			});
			const res2 = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remoteCardNewer, optsEnabled);
			expect(res2.direction).toBe("pull");
			expect(vault.readFrontmatter(vault.note(TEST_NOTE_PATH))?.[DEFAULT_DUE_KEY]).toBe("2026-09-09T00:00:00.000Z");

			// Phase 3: syncDue: false again -> prunes trello_due again
			const currentMtime = vault.note(TEST_NOTE_PATH).mtime;
			const res3 = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remoteCardNewer, optsDisabled);
			expect(res3.direction).toBe("skip");
			expect(res3.cleaned).toEqual([DEFAULT_DUE_KEY]);
			expect(vault.readFrontmatter(vault.note(TEST_NOTE_PATH))?.[DEFAULT_DUE_KEY]).toBeUndefined();
			// Timestamp preserved from before phase 3
			expect(vault.note(TEST_NOTE_PATH).mtime).toBe(currentMtime);

			// Phase 4: subsequent sync with optsDisabled strictly skips
			const res4 = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remoteCardNewer, optsDisabled);
			expect(res4.direction).toBe("skip");
			expect(res4.cleaned).toBeUndefined();
			expect(vault.note(TEST_NOTE_PATH).mtime).toBe(currentMtime);
		});
	});

	// =========================================================================
	// 3. Concurrent Sync Runs on the Same Note (Race Condition Stress Test)
	// =========================================================================
	describe("3. Concurrent Sync Runs with OperationGuard (Race Condition Testing)", () => {
		test("25 parallel syncs on the same card with OperationGuard serialize cleanly without corrupting frontmatter", async () => {
			const initialMtime = at("2026-03-01T12:00:00.000Z");
			const { vault, client, requests } = setupNoteFixture(
				{
					[DEFAULT_DUE_KEY]: "2026-10-31",
					[DEFAULT_LABELS_KEY]: ["stale-alpha", "stale-beta"],
					[DEFAULT_MEMBERS_KEY]: ["stale-user"],
					vital_stat: "HP: 500",
				},
				"# Dragon Lair\nDetailed body.",
				initialMtime,
			);

			const remote = card({
				id: "c_dragon",
				name: "DragonLair",
				desc: "# Dragon Lair\nDetailed body.",
				dateLastActivity: "2026-03-01T12:00:00.000Z",
			});

			const guard = new OperationGuard();
			const options = createSyncOptions({
				syncDue: false,
				syncLabels: false,
				syncMembers: false,
				cleanUpDuringSync: true,
				guard,
			});

			// Fire 25 concurrent sync calls on the exact same card
			const promises = Array.from({ length: 25 }, () =>
				syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options),
			);

			const results = await Promise.all(promises);

			// All 25 promises must fulfill successfully
			expect(results).toHaveLength(25);

			// Exactly one execution cleaned the note; the remaining 24 saw the already-cleaned note
			const cleanedRuns = results.filter((r) => r.cleaned && r.cleaned.length > 0);
			expect(cleanedRuns).toHaveLength(1);
			expect(cleanedRuns[0]!.cleaned).toEqual(
				expect.arrayContaining([DEFAULT_DUE_KEY, DEFAULT_LABELS_KEY, DEFAULT_MEMBERS_KEY]),
			);

			// Timestamp stability: mtime MUST remain unchanged
			expect(vault.note(TEST_NOTE_PATH).mtime).toBe(initialMtime);

			// Zero network requests made
			expect(requests).toHaveLength(0);

			// Frontmatter is clean and uncorrupted
			const fm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
			expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_LABELS_KEY]).toBeUndefined();
			expect(fm?.[DEFAULT_MEMBERS_KEY]).toBeUndefined();
			expect(fm?.vital_stat).toBe("HP: 500");
			expect(fm?.trello_board_card_id).toBe("b_encounter;c_dragon");

			// Body content is intact
			expect(vault.contentOf(TEST_NOTE_PATH)).toContain("# Dragon Lair\nDetailed body.");
		});

		test("Simultaneous concurrent operations across 20 distinct cards complete independently without cross-talk", async () => {
			const NOTE_COUNT = 20;
			const initialMtime = at("2026-03-01T12:00:00.000Z");
			const files: Record<string, { content: string; mtime: number }> = {};
			const cards: any[] = [];

			for (let i = 1; i <= NOTE_COUNT; i++) {
				const cardId = `c_parallel_${i}`;
				const path = `Encounters/Note_${i}.md`;
				const body = `Content for encounter ${i}`;
				const fmFields = {
					[DEFAULT_DUE_KEY]: `2026-11-${String(i).padStart(2, "0")}`,
					[DEFAULT_LABELS_KEY]: [`tag_${i}`],
					custom_index: i,
				};
				files[path] = {
					content: `${buildFrontmatterString(fmFields, cardId)}\n\n${body}`,
					mtime: initialMtime + i, // distinct mtime per note
				};
				cards.push(
					card({
						id: cardId,
						name: `Note_${i}`,
						desc: body,
						dateLastActivity: "2026-03-01T12:00:00.000Z",
					}),
				);
			}

			const vault = new FakeVault(files);
			const { transport, requests } = routedTransport({});
			const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
			const guard = new OperationGuard();

			const options = createSyncOptions({
				syncDue: false,
				syncLabels: false,
				cleanUpDuringSync: true,
				guard,
			});

			// Execute all 20 notes concurrently
			const promises = cards.map((c, idx) => {
				const path = `Encounters/Note_${idx + 1}.md`;
				return syncNoteWithCard(vault, client, vault.note(path), c, options);
			});

			const results = await Promise.all(promises);

			expect(results).toHaveLength(NOTE_COUNT);
			expect(requests).toHaveLength(0);

			// Verify every single note
			for (let i = 1; i <= NOTE_COUNT; i++) {
				const path = `Encounters/Note_${i}.md`;
				const note = vault.note(path);
				const expectedMtime = initialMtime + i;

				// mtime strictly preserved
				expect(note.mtime, `mtime drift on note ${i}`).toBe(expectedMtime);

				// Frontmatter cleaned
				const fm = vault.readFrontmatter(note);
				expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();
				expect(fm?.[DEFAULT_LABELS_KEY]).toBeUndefined();
				expect(fm?.custom_index).toBe(i);
				expect(fm?.trello_board_card_id).toBe(`b_encounter;c_parallel_${i}`);
			}
		});
	});

	// =========================================================================
	// 4. Multi-Sync History Recording and Undo Reversibility
	// =========================================================================
	describe("4. Multi-Sync History Recording & Undo Reversibility", () => {
		test("In-stream alignment in Run 1 can be cleanly reverted after multiple subsequent sync runs", async () => {
			const initialMtime = at("2026-03-01T12:00:00.000Z");
			const { vault: baseVault, client, initialContent } = setupNoteFixture(
				{
					[DEFAULT_DUE_KEY]: "2026-08-15",
					[DEFAULT_LABELS_KEY]: ["revert-target"],
					[DEFAULT_MEMBERS_KEY]: ["user_omega"],
				},
				"# Dragon Lair\nStable text.",
				initialMtime,
			);

			const actionsRun1: SyncAction[] = [];
			const recordingVault1 = wrapWithHistoryRecorder(baseVault, (action) => actionsRun1.push(action));

			const remote = card({
				id: "c_dragon",
				name: "DragonLair",
				desc: "# Dragon Lair\nStable text.",
				dateLastActivity: "2026-03-01T12:00:00.000Z",
			});

			const options = createSyncOptions({
				syncDue: false,
				syncLabels: false,
				syncMembers: false,
				cleanUpDuringSync: true,
			});

			// Run 1: clean with recording
			const res1 = await syncNoteWithCard(recordingVault1, client, baseVault.note(TEST_NOTE_PATH), remote, options);
			expect(res1.cleaned).toBeDefined();
			expect(actionsRun1.length).toBeGreaterThan(0);

			// Run 2: subsequent sync with fresh recording
			const actionsRun2: SyncAction[] = [];
			const recordingVault2 = wrapWithHistoryRecorder(baseVault, (action) => actionsRun2.push(action));
			const res2 = await syncNoteWithCard(recordingVault2, client, baseVault.note(TEST_NOTE_PATH), remote, options);
			expect(res2.direction).toBe("skip");
			expect(actionsRun2).toHaveLength(0); // Nothing modified

			// Run 3: another sync
			const actionsRun3: SyncAction[] = [];
			const recordingVault3 = wrapWithHistoryRecorder(baseVault, (action) => actionsRun3.push(action));
			await syncNoteWithCard(recordingVault3, client, baseVault.note(TEST_NOTE_PATH), remote, options);
			expect(actionsRun3).toHaveLength(0);

			// REVERSAL: Revert Run 1 via undoRun
			const run1: SyncRun = {
				timestamp: new Date().toISOString(),
				scope: TEST_NOTE_PATH,
				actions: actionsRun1,
			};

			const { stats } = await undoRun(baseVault, run1);
			expect(stats.reverted).toBe(1);

			// Verify file content restored byte-for-byte to pre-sync state
			expect(baseVault.contentOf(TEST_NOTE_PATH)).toBe(initialContent);
			const revertedFm = baseVault.readFrontmatter(baseVault.note(TEST_NOTE_PATH));
			expect(revertedFm?.[DEFAULT_DUE_KEY]).toBe("2026-08-15");
			expect(revertedFm?.[DEFAULT_LABELS_KEY]).toEqual(["revert-target"]);
			expect(revertedFm?.[DEFAULT_MEMBERS_KEY]).toEqual(["user_omega"]);

			// Run 4: Re-running sync on the restored note prunes it once again cleanly
			const res4 = await syncNoteWithCard(baseVault, client, baseVault.note(TEST_NOTE_PATH), remote, options);
			expect(res4.direction).toBe("skip");
			expect(res4.cleaned).toBeDefined();
			expect(baseVault.readFrontmatter(baseVault.note(TEST_NOTE_PATH))?.[DEFAULT_DUE_KEY]).toBeUndefined();
		});
	});

	// =========================================================================
	// 5. Boundary Edge Cases: Malformed Notes & Empty Frontmatter
	// =========================================================================
	describe("5. Boundary Edge Cases in Multi-Sync Alignment", () => {
		test("Note where all properties except trello_board_card_id are pruned remains valid frontmatter", async () => {
			const initialMtime = at("2026-03-01T12:00:00.000Z");
			// Note has ONLY trello_board_card_id and stale due date
			const { vault, client } = setupNoteFixture(
				{ [DEFAULT_DUE_KEY]: "2026-10-18" },
				"Body with minimal frontmatter.",
				initialMtime,
			);

			const remote = card({
				id: "c_dragon",
				name: "DragonLair",
				desc: "Body with minimal frontmatter.",
				dateLastActivity: "2026-03-01T12:00:00.000Z",
			});

			const options = createSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
			});

			// Run 1
			const res1 = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);
			expect(res1.cleaned).toEqual([DEFAULT_DUE_KEY]);

			// Frontmatter still contains trello_board_card_id
			const fm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
			expect(fm?.trello_board_card_id).toBe("b_encounter;c_dragon");
			expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();

			// Run 2: idempotent skip
			const res2 = await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);
			expect(res2.direction).toBe("skip");
			expect(res2.cleaned).toBeUndefined();
			expect(vault.note(TEST_NOTE_PATH).mtime).toBe(initialMtime);
		});

		test("Non-safe categories are NEVER cleaned even across 10 sequential sync runs", async () => {
			const initialMtime = at("2026-03-01T12:00:00.000Z");
			const pluginId = "abcdef0123456789abcdef0123456789";
			const checklistBody = "# Dragon Lair\n\n## Checklists\n- [ ] Slay beast\n- [x] Gather hoard";

			const { vault, client } = setupNoteFixture(
				{
					[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]: pluginId,
					[DEFAULT_DUE_KEY]: "2026-12-31",
					custom_legacy_rule: "must-stay",
				},
				checklistBody,
				initialMtime,
			);

			const remote = card({
				id: "c_dragon",
				name: "DragonLair",
				desc: "# Dragon Lair",
				dateLastActivity: "2026-03-01T12:00:00.000Z",
			});

			const options = createSyncOptions({
				syncDue: false,
				syncChecklists: false,
				writeTrelloPluginNoteId: false,
				cleanUpDuringSync: true,
				obsoleteLabelPropertyKeys: ["custom_legacy_rule"],
			});

			for (let i = 1; i <= 10; i++) {
				await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);

				const fm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
				expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();
				// Non-safe properties strictly preserved on every run
				expect(fm?.[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]).toBe(pluginId);
				expect(fm?.custom_legacy_rule).toBe("must-stay");

				// Checklist body strictly preserved on every run
				const content = vault.contentOf(TEST_NOTE_PATH);
				expect(content).toContain("## Checklists");
				expect(content).toContain("- [ ] Slay beast");
				expect(content).toContain("- [x] Gather hoard");

				expect(vault.note(TEST_NOTE_PATH).mtime).toBe(initialMtime);
			}
		});

		test("Arbitrary millisecond timestamps are preserved with exact bitwise precision across multiple syncs", async () => {
			const arbitraryMtime = 1772456789123; // specific uneven millisecond timestamp
			const { vault, client } = setupNoteFixture(
				{ [DEFAULT_DUE_KEY]: "2026-10-18" },
				"Body text.",
				arbitraryMtime,
			);

			const remote = card({
				id: "c_dragon",
				name: "DragonLair",
				desc: "Body text.",
				dateLastActivity: new Date(arbitraryMtime).toISOString(),
			});

			const options = createSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
			});

			// Run 1: clean stale due
			await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);
			expect(vault.note(TEST_NOTE_PATH).mtime).toBe(arbitraryMtime);

			// Run 2: subsequent sync
			await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);
			expect(vault.note(TEST_NOTE_PATH).mtime).toBe(arbitraryMtime);

			// Run 3: subsequent sync
			await syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remote, options);
			expect(vault.note(TEST_NOTE_PATH).mtime).toBe(arbitraryMtime);
		});

		test("Interleaved concurrent pull and in-stream cleanup under OperationGuard resolve deterministically", async () => {
			const initialMtime = at("2026-03-01T10:00:00.000Z");
			const { vault, client } = setupNoteFixture(
				{ [DEFAULT_DUE_KEY]: "2026-10-18" },
				"Old local content",
				initialMtime,
			);

			// Remote card has updated content and newer timestamp -> triggers pull
			const remoteNewer = card({
				id: "c_dragon",
				name: "DragonLair",
				desc: "Updated content from Trello cloud",
				dateLastActivity: "2026-03-01T15:00:00.000Z",
			});

			const guard = new OperationGuard();
			const options = createSyncOptions({
				syncDue: false,
				cleanUpDuringSync: true,
				guard,
			});

			// Launch two concurrent sync operations on the same card under the guard
			const [res1, res2] = await Promise.all([
				syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remoteNewer, options),
				syncNoteWithCard(vault, client, vault.note(TEST_NOTE_PATH), remoteNewer, options),
			]);

			// First operation executed pull + cleanup
			// Second operation saw the pulled + cleaned note and skipped
			const directions = [res1.direction, res2.direction];
			expect(directions).toContain("pull");
			expect(directions).toContain("skip");

			// Frontmatter is cleaned
			const fm = vault.readFrontmatter(vault.note(TEST_NOTE_PATH));
			expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();

			// Body was updated with remote content
			expect(vault.contentOf(TEST_NOTE_PATH)).toContain("Updated content from Trello cloud");
		});

		test("Folder multi-sync across 5 sequential syncFolder runs prunes in run 1, then produces 0 drifts and 0 writes", async () => {
			const FOLDER_NOTE_COUNT = 10;
			const initialMtime = at("2026-03-01T12:00:00.000Z");
			const files: Record<string, { content: string; mtime: number }> = {};
			const cards: any[] = [];

			for (let i = 1; i <= FOLDER_NOTE_COUNT; i++) {
				const cardId = `c_fld_${i}`;
				const path = `Encounters/Note_${i}.md`;
				const body = `Content for encounter ${i}`;
				const fmFields = {
					[DEFAULT_DUE_KEY]: `2026-12-${String(i).padStart(2, "0")}`,
					[DEFAULT_LABELS_KEY]: [`label_${i}`],
					user_prop: `data_${i}`,
				};
				files[path] = {
					content: `${buildFrontmatterString(fmFields, cardId)}\n\n${body}`,
					mtime: initialMtime,
				};
				cards.push(
					card({
						id: cardId,
						idBoard: "b_encounter",
						idList: "l_encounter",
						name: `Note_${i}`,
						desc: body,
						dateLastActivity: "2026-03-01T12:00:00.000Z",
					}),
				);
			}

			const vault = new FakeVault(files);
			const { transport, requests } = routedTransport({
				"/boards/b_encounter/cards": cards,
				"/lists/l_encounter/cards": cards,
				"/boards/b_encounter/lists": [{ id: "l_encounter", name: "Encounters" }],
				"/boards/b_encounter/actions": [],
			});
			const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

			const folderOptions: FolderSyncOptions = {
				...createSyncOptions({
					syncDue: false,
					syncLabels: false,
					cleanUpDuringSync: true,
				}),
				...FATE_OPTIONS,
				archiveCreateMissing: false,
				adoptUnlinkedByName: false,
				allowCreate: false,
				boardId: "b_encounter",
				cardRefFrontmatterKey: DEFAULT_CARD_REF_KEY,
			};

			// Run 5 sequential folder syncs
			for (let run = 1; run <= 5; run++) {
				const reporter = recordingReporter();
				const result = await syncFolder(
					vault,
					client,
					{ folder: "Encounters", listId: "l_encounter", templateName: "" },
					folderOptions,
					reporter,
					cards,
				);

				expect(result.pulled).toBe(0);
				expect(result.pushed).toBe(0);

				// Verify all 10 notes
				for (let i = 1; i <= FOLDER_NOTE_COUNT; i++) {
					const path = `Encounters/Note_${i}.md`;
					const note = vault.note(path);

					// ZERO mtime drift on every single run
					expect(note.mtime, `mtime drift on run ${run} note ${i}`).toBe(initialMtime);

					// Frontmatter cleaned and remains cleaned
					const fm = vault.readFrontmatter(note);
					expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();
					expect(fm?.[DEFAULT_LABELS_KEY]).toBeUndefined();
					expect(fm?.user_prop).toBe(`data_${i}`);
				}
			}

			// Invariant: 0 PUT/POST writes to Trello across all 5 folder runs
			const writeRequests = requests.filter((r) => r.method === "PUT" || r.method === "POST");
			expect(writeRequests).toHaveLength(0);
		});
	});
});


