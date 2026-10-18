import { describe, expect, test, vi } from "vitest";
import { DEFAULT_ATTACHMENTS_KEY, DEFAULT_LINKED_CARDS_KEY, DEFAULT_COVER_KEY } from "../src/core/attachmentRef";
import { DEFAULT_CHECKLIST_HEADING } from "../src/core/checklistRef";
import { DEFAULT_DUE_KEY } from "../src/core/dueRef";
import { DEFAULT_LABELS_KEY } from "../src/core/labelRef";
import { DEFAULT_MEMBERS_KEY } from "../src/core/memberRef";
import { DEFAULT_CUSTOM_FIELDS_KEY } from "../src/core/customFieldRef";
import { DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY } from "../src/core/cardRef";
import { syncNoteWithCard, type NoteSyncOptions } from "../src/features/syncNote";
import { TrelloClient } from "../src/trello/client";
import { FakeVault, at, card, routedTransport } from "./fakes";

const PATH = "WoT/85_Idées/Sagondo.md";

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

function setupNote(
	frontmatterFields: Record<string, unknown> = {},
	body = "Standard body text",
	mtime = at("2026-01-01"),
) {
	const fmLines = ["---", "type: idée", 'trello_board_card_id: "board;c1"'];
	for (const [k, v] of Object.entries(frontmatterFields)) {
		if (Array.isArray(v)) {
			fmLines.push(`${k}:`);
			for (const item of v) fmLines.push(`  - "${item}"`);
		} else if (typeof v === "object" && v !== null) {
			fmLines.push(`${k}:`);
			for (const [sk, sv] of Object.entries(v)) fmLines.push(`  ${sk}: "${sv}"`);
		} else {
			fmLines.push(`${k}: "${v}"`);
		}
	}
	fmLines.push("---", "", body);

	const vault = new FakeVault({ [PATH]: { content: fmLines.join("\n"), mtime } });
	const { transport, requests } = routedTransport({});
	const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
	return { vault, client, requests };
}

describe("syncNoteWithCard: in-stream settings alignment (cleanUpDuringSync)", () => {
	test("cleanUpDuringSync: true prunes stale due date frontmatter when syncDue is false", async () => {
		const { vault, client } = setupNote({ [DEFAULT_DUE_KEY]: "2026-12-31" }, "Same body", at("2026-01-01"));
		const remote = card({ id: "c1", name: "Sagondo", desc: "Same body", dateLastActivity: "2026-01-01" });

		const options = createSyncOptions({
			syncDue: false,
			cleanUpDuringSync: true,
		});

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		// Frontmatter due property should be pruned cleanly
		const fm = vault.readFrontmatter(vault.note(PATH));
		expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();
		expect(vault.contentOf(PATH)).not.toContain(DEFAULT_DUE_KEY);

		// Core note identity and content preserved
		expect(vault.contentOf(PATH)).toContain("Same body");
		expect(vault.contentOf(PATH)).toContain('trello_board_card_id: "board;c1"');

		// Timestamp preservation: in-stream alignment preserves note mtime
		expect(vault.note(PATH).mtime).toBe(at("2026-01-01"));
	});

	test("cleanUpDuringSync: false leaves stale properties untouched", async () => {
		const { vault, client } = setupNote({ [DEFAULT_DUE_KEY]: "2026-12-31" }, "Same body", at("2026-01-01"));
		const remote = card({ id: "c1", name: "Sagondo", desc: "Same body", dateLastActivity: "2026-01-01" });

		const options = createSyncOptions({
			syncDue: false,
			cleanUpDuringSync: false,
		});

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		const fm = vault.readFrontmatter(vault.note(PATH));
		expect(fm?.[DEFAULT_DUE_KEY]).toBe("2026-12-31");
		expect(vault.contentOf(PATH)).toContain(DEFAULT_DUE_KEY);
	});

	test("cleanUpDuringSync performs 0 extra Trello HTTP requests", async () => {
		const { vault, client, requests } = setupNote(
			{
				[DEFAULT_DUE_KEY]: "2026-12-31",
				[DEFAULT_LABELS_KEY]: ["stale-label"],
			},
			"Same body",
			at("2026-01-01"),
		);
		const remote = card({ id: "c1", name: "Sagondo", desc: "Same body", dateLastActivity: "2026-01-01" });

		const updateCardSpy = vi.spyOn(client, "updateCard");
		const getCardSpy = vi.spyOn(client, "getCard");

		const options = createSyncOptions({
			syncDue: false,
			syncLabels: false,
			cleanUpDuringSync: true,
		});

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		// Synchronized sides agreed on content -> no push/pull network calls
		expect(result.direction).toBe("skip");
		expect(requests).toHaveLength(0);
		expect(updateCardSpy).not.toHaveBeenCalled();
		expect(getCardSpy).not.toHaveBeenCalled();

		// Local frontmatter properties were pruned without network activity
		const fm = vault.readFrontmatter(vault.note(PATH));
		expect(fm?.[DEFAULT_DUE_KEY]).toBeUndefined();
		expect(fm?.[DEFAULT_LABELS_KEY]).toBeUndefined();
	});

	test("unsafe categories are NOT touched during automatic in-stream sync", async () => {
		const bodyWithChecklist = "Intro prose\n\n## Checklist\n- [ ] Unfinished task\n- [x] Finished task";
		const { vault, client } = setupNote(
			{
				[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]: "0123456789abcdef0123456789abcdef",
				obsolete_field: "must-stay",
			},
			bodyWithChecklist,
			at("2026-01-01"),
		);

		const remote = card({ id: "c1", name: "Sagondo", desc: "Intro prose", dateLastActivity: "2026-01-01" });

		const options = createSyncOptions({
			syncChecklists: false,
			cleanUpDuringSync: true,
			obsoleteLabelPropertyKeys: ["obsolete_field"],
		});

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		const content = vault.contentOf(PATH);
		const fm = vault.readFrontmatter(vault.note(PATH));

		// 1. Checklist body section strictly preserved
		expect(content).toContain("## Checklist");
		expect(content).toContain("- [ ] Unfinished task");

		// 2. Third-party trello_plugin_note_id preserved
		expect(fm?.[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]).toBe("0123456789abcdef0123456789abcdef");

		// 3. Obsolete custom properties preserved from automated background deletion
		expect(fm?.obsolete_field).toBe("must-stay");
	});

	test("missing plugin note ID is NOT backfilled automatically during sync", async () => {
		const { vault, client } = setupNote({}, "Same body", at("2026-01-01"));
		const remote = card({ id: "c1", name: "Sagondo", desc: "Same body", dateLastActivity: "2026-01-01" });

		const options = createSyncOptions({
			cleanUpDuringSync: true,
		});

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		const fm = vault.readFrontmatter(vault.note(PATH));
		expect(fm?.[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY]).toBeUndefined();
	});

	test("safe key migration executes in-stream during sync", async () => {
		const { vault, client } = setupNote(
			{
				legacy_due_date: "2026-11-20",
			},
			"Same body",
			at("2026-01-01"),
		);
		const remote = card({ id: "c1", name: "Sagondo", desc: "Same body", dateLastActivity: "2026-01-01" });

		const options = createSyncOptions({
			syncDue: true,
			cleanUpDuringSync: true,
			keyMigrations: {
				legacy_due_date: DEFAULT_DUE_KEY,
			},
		});

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		const fm = vault.readFrontmatter(vault.note(PATH));
		expect(fm?.legacy_due_date).toBeUndefined();
		expect(fm?.[DEFAULT_DUE_KEY]).toBe("2026-11-20");
	});

	test("cover pruning preserves local attachment paths and removes remote Trello URLs", async () => {
		const remoteCoverUrl = "https://trello-attachments.s3.amazonaws.com/abc/cover.jpg";
		const { vault: remoteVault, client: client1 } = setupNote(
			{ [DEFAULT_COVER_KEY]: remoteCoverUrl },
			"Same body",
			at("2026-01-01"),
		);
		const remote1 = card({ id: "c1", name: "Sagondo", desc: "Same body", dateLastActivity: "2026-01-01" });

		const options = createSyncOptions({
			syncCardCover: false,
			cleanUpDuringSync: true,
		});

		await syncNoteWithCard(remoteVault, client1, remoteVault.note(PATH), remote1, options);
		expect(remoteVault.readFrontmatter(remoteVault.note(PATH))?.[DEFAULT_COVER_KEY]).toBeUndefined();

		// Local cover path: must be preserved even with syncCardCover off
		const localCoverPath = "Attachments/banners/cover.png";
		const { vault: localVault, client: client2 } = setupNote(
			{ [DEFAULT_COVER_KEY]: localCoverPath },
			"Same body",
			at("2026-01-01"),
		);
		const remote2 = card({ id: "c1", name: "Sagondo", desc: "Same body", dateLastActivity: "2026-01-01" });

		await syncNoteWithCard(localVault, client2, localVault.note(PATH), remote2, options);
		expect(localVault.readFrontmatter(localVault.note(PATH))?.[DEFAULT_COVER_KEY]).toBe(localCoverPath);
	});

	test("dryRun: true reports changes without modifying files", async () => {
		const initialContent =
			`---\ntype: idée\ntrello_board_card_id: "board;c1"\n${DEFAULT_DUE_KEY}: "2026-12-31"\n---\n\nSame body`;
		const vault = new FakeVault({ [PATH]: { content: initialContent, mtime: at("2026-01-01") } });
		const { transport } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const remote = card({ id: "c1", name: "Sagondo", desc: "Same body", dateLastActivity: "2026-01-01" });

		const options = createSyncOptions({
			syncDue: false,
			cleanUpDuringSync: true,
			dryRun: true,
		});

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		// Content remains 100% unchanged on disk
		expect(vault.contentOf(PATH)).toBe(initialContent);
		expect(vault.readFrontmatter(vault.note(PATH))?.[DEFAULT_DUE_KEY]).toBe("2026-12-31");
	});

	test("in-stream alignment preserves mtime and prevents false local-newer pushes on subsequent syncs", async () => {
		const initialMtime = at("2026-01-01");
		const { vault, client, requests } = setupNote(
			{ [DEFAULT_DUE_KEY]: "2026-12-31" },
			"Same body",
			initialMtime,
		);
		const remote = card({ id: "c1", name: "Sagondo", desc: "Same body", dateLastActivity: "2026-01-01" });

		const options = createSyncOptions({
			syncDue: false,
			cleanUpDuringSync: true,
		});

		// 1. Initial sync prunes stale property in-stream; mtime MUST remain unchanged
		const res1 = await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);
		expect(res1.direction).toBe("skip");
		expect(res1.cleaned).toEqual([DEFAULT_DUE_KEY]);
		expect(vault.note(PATH).mtime).toBe(initialMtime);

		// 2. Subsequent sync with unchanged remote activity -> strictly "skip", 0 network calls
		const res2 = await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);
		expect(res2.direction).toBe("skip");
		expect(res2.cleaned).toBeUndefined();
		expect(requests).toHaveLength(0);
		expect(vault.note(PATH).mtime).toBe(initialMtime);

		// 3. Subsequent sync where remote card was updated later on Trello -> strictly "pull" (not false push/conflict)
		const updatedRemote = card({ id: "c1", name: "Sagondo", desc: "Updated on Trello", dateLastActivity: "2026-01-15" });
		const res3 = await syncNoteWithCard(vault, client, vault.note(PATH), updatedRemote, options);
		expect(res3.direction).toBe("pull");
	});
});
