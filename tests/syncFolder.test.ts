import { describe, expect, test } from "vitest";
import { DEFAULT_LINKED_CARDS_KEY } from "../src/core/attachmentRef";
import { syncAllMappings, syncFolder, type FolderMapping, type FolderSyncOptions } from "../src/features/syncFolder";
import { silentReporter } from "../src/obsidian/gateway";
import { TrelloClient } from "../src/trello/client";
import { FATE_OPTIONS, FakeVault, at, card, recordingReporter, routedTransport } from "./fakes";
import type { CardFateRules } from "../src/core/cardFate";

const FOLDER = "WoT/85_Idées";
const MAPPING = { listId: "l1", folder: FOLDER, templateName: "idée (script)" };

const options: FolderSyncOptions = {
	policy: "newer-wins",
	marginMs: 0,
	syncTitle: true,
	dryRun: false,
	allowCreate: true,
	...FATE_OPTIONS,
	boardId: "board",
	// Off by default in this shared fixture — attachments/checklists/members syncing is
	// covered on its own in syncNote.test.ts (and the dedicated "syncFolder — members"
	// block below), and its extra Trello request would break request-count assertions
	// here that are about syncFolder's own list/board-fetch batching.
	syncAttachments: false,
	syncChecklists: false,
	syncMembers: false,
	syncCustomFields: false,
};

/** List cards, plus a board that holds exactly the same cards by default. */
function clientFor(cards: unknown[], boardCards: unknown[] = cards) {
	const { transport, requests } = routedTransport({
		"/lists/l1/cards": cards,
		"/boards/board/cards": boardCards,
	});
	return { client: new TrelloClient({ apiKey: "k", token: "t" }, transport), requests };
}

const linked = (cardId: string, body: string) =>
	`---\ntype: idée\ntrello_board_card_id: "board;${cardId}"\n---\n\n${body}`;

describe("syncFolder — creation", () => {
	test("creates a missing note from the template, placeholders filled", async () => {
		const vault = new FakeVault();
		vault.templates.set(
			"idée (script)",
			'---\ntype: idée\ntrello_board_card_id: "{{BOARD_ID}};{{CARD_ID}}"\n---\n{{DESCRIPTION}}',
		);
		const { client } = clientFor([card({ id: "c1", name: "Sagondo", desc: "Une cité." })]);

		const stats = await syncFolder(vault, client, MAPPING, options);

		expect(stats.created).toBe(1);
		expect(vault.contentOf(`${FOLDER}/Sagondo.md`)).toBe(
			'---\ntype: idée\ntrello_board_card_id: "board;c1"\n---\nUne cité.',
		);
	});

	test("uses defaultTemplateName when the mapping does not specify a template", async () => {
		const vault = new FakeVault();
		vault.templates.set(
			"global-fallback",
			'---\ntype: default\ntrello_board_card_id: "{{BOARD_ID}};{{CARD_ID}}"\n---\n{{DESCRIPTION}}',
		);
		const { client } = clientFor([card({ id: "c1", name: "Sagondo", desc: "Global content." })]);
		const mappingWithoutTemplate = { ...MAPPING, templateName: "" };

		await syncFolder(vault, client, mappingWithoutTemplate, { ...options, defaultTemplateName: "global-fallback" });

		expect(vault.contentOf(`${FOLDER}/Sagondo.md`)).toBe(
			'---\ntype: default\ntrello_board_card_id: "board;c1"\n---\nGlobal content.',
		);
	});

	test("a mapping override can force creation on even though the global setting is off", async () => {
		const vault = new FakeVault();
		const { client } = clientFor([card({ id: "c1", name: "Sagondo" })]);
		const mapping: FolderMapping = { ...MAPPING, allowCreateOverride: "on" };

		const stats = await syncFolder(vault, client, mapping, { ...options, allowCreate: false });

		expect(stats.created).toBe(1);
	});

	test("a mapping override can force creation off even though the global setting is on", async () => {
		const vault = new FakeVault();
		const { client } = clientFor([card({ id: "c1", name: "Sagondo" })]);
		const mapping: FolderMapping = { ...MAPPING, allowCreateOverride: "off" };

		const stats = await syncFolder(vault, client, mapping, { ...options, allowCreate: true });

		expect(stats.created).toBe(0);
	});

	test("warns once when the configured template has no card-ref key", async () => {
		const vault = new FakeVault();
		vault.templates.set("idée (script)", "---\ntype: idée\n---\n{{DESCRIPTION}}");
		const { client } = clientFor([
			card({ id: "c1", name: "Sagondo" }),
			card({ id: "c2", name: "Le monde" }),
		]);
		const reporter = recordingReporter();

		await syncFolder(vault, client, MAPPING, options, reporter);

		const warnings = reporter.logs.filter((entry) => entry.message.includes("trello_board_card_id"));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.level).toBe("warn");
	});

	test("stops creating notes once the signal is aborted", async () => {
		const vault = new FakeVault();
		const { client } = clientFor([
			card({ id: "c1", name: "Sagondo" }),
			card({ id: "c2", name: "Le monde" }),
		]);
		const controller = new AbortController();
		controller.abort();

		const stats = await syncFolder(vault, client, MAPPING, options, undefined, undefined, controller.signal);

		expect(stats.created).toBe(0);
	});

	test("falls back to the bare description when the template is missing", async () => {
		const vault = new FakeVault();
		const { client } = clientFor([card({ id: "c1", name: "Sagondo", desc: "Une cité." })]);

		await syncFolder(vault, client, MAPPING, options);

		expect(vault.contentOf(`${FOLDER}/Sagondo.md`)).toContain("Une cité.");
		expect(vault.contentOf(`${FOLDER}/Sagondo.md`)).toContain("board;c1");
	});

	test("writes a new note's card link under a configured key instead of the default", async () => {
		const vault = new FakeVault();
		const { client } = clientFor([card({ id: "c1", name: "Sagondo", desc: "Une cité." })]);

		await syncFolder(vault, client, MAPPING, { ...options, cardRefFrontmatterKey: "card_link" });

		expect(vault.contentOf(`${FOLDER}/Sagondo.md`)).toContain("card_link:");
		expect(vault.contentOf(`${FOLDER}/Sagondo.md`)).not.toContain("trello_board_card_id");
	});

	test("warns using the configured key, not the hardcoded default, when a template omits it", async () => {
		const vault = new FakeVault();
		vault.templates.set("idée (script)", "---\ntype: idée\n---\n{{DESCRIPTION}}");
		const { client } = clientFor([card({ id: "c1", name: "Sagondo" })]);
		const reporter = recordingReporter();

		await syncFolder(vault, client, MAPPING, { ...options, cardRefFrontmatterKey: "card_link" }, reporter);

		const warnings = reporter.logs.filter((entry) => entry.message.includes("card_link"));
		expect(warnings).toHaveLength(1);
	});

	test("does not create anything when creation is disabled", async () => {
		const vault = new FakeVault();
		const { client } = clientFor([card({ id: "c1", name: "Sagondo" })]);

		const stats = await syncFolder(vault, client, MAPPING, { ...options, allowCreate: false });

		expect(stats.created).toBe(0);
		expect(vault.paths()).toEqual([]);
	});

	test("creates nothing in dry-run mode but still counts the work", async () => {
		const vault = new FakeVault();
		const { client } = clientFor([card({ id: "c1", name: "Sagondo" })]);

		const stats = await syncFolder(vault, client, MAPPING, { ...options, dryRun: true });

		expect(stats.created).toBe(1);
		expect(vault.paths()).toEqual([]);
	});
});

describe("syncFolder — adoption", () => {
	test("adopts a name-matching note and writes the card id into its frontmatter", async () => {
		const vault = new FakeVault({
			[`${FOLDER}/Sagondo.md`]: { content: "---\ntype: idée\n---\n\nlocal" },
		});
		const { client } = clientFor([card({ id: "c1", name: "Sagondo", desc: "remote" })]);

		const stats = await syncFolder(vault, client, MAPPING, options);

		expect(stats.adopted).toBe(1);
		expect(vault.contentOf(`${FOLDER}/Sagondo.md`)).toContain('trello_board_card_id: "board;c1"');
		expect(vault.contentOf(`${FOLDER}/Sagondo.md`)).toContain("remote");
	});

	test("never adopts a note that another card already owns", async () => {
		const vault = new FakeVault({
			[`${FOLDER}/Sagondo.md`]: { content: linked("c1", "local") },
		});
		const { client } = clientFor([card({ id: "c2", name: "Sagondo", desc: "remote" })]);

		const stats = await syncFolder(vault, client, MAPPING, options);

		expect(stats.adopted).toBe(0);
		expect(stats.created).toBe(1);
	});
});

describe("syncFolder — existing pairs", () => {
	test("pulls a pair whose card is the newer side", async () => {
		const vault = new FakeVault({
			[`${FOLDER}/Sagondo.md`]: { content: linked("c1", "old"), mtime: at("2026-01-01") },
		});
		const { client } = clientFor([
			card({ id: "c1", name: "Sagondo", desc: "new", dateLastActivity: "2026-02-01" }),
		]);

		const stats = await syncFolder(vault, client, MAPPING, options);

		expect(stats.pulled).toBe(1);
		expect(vault.contentOf(`${FOLDER}/Sagondo.md`)).toContain("new");
	});

	test("pushes a pair whose note is the newer side", async () => {
		const vault = new FakeVault({
			[`${FOLDER}/Sagondo.md`]: { content: linked("c1", "local"), mtime: at("2026-03-01") },
		});
		const { client, requests } = clientFor([
			card({ id: "c1", name: "Sagondo", desc: "remote", dateLastActivity: "2026-01-01" }),
		]);

		const stats = await syncFolder(vault, client, MAPPING, options);

		expect(stats.pushed).toBe(1);
		expect(requests.some((r) => r.method === "PUT")).toBe(true);
	});

	test("counts an untouched pair as skipped", async () => {
		const vault = new FakeVault({
			[`${FOLDER}/Sagondo.md`]: { content: linked("c1", "same"), mtime: at("2026-01-01") },
		});
		const { client } = clientFor([
			card({ id: "c1", name: "Sagondo", desc: "same", dateLastActivity: "2026-02-01" }),
		]);

		expect((await syncFolder(vault, client, MAPPING, options)).skipped).toBe(1);
	});

	test("force propagates end to end: a forced pull overwrites the note even though it is the newer side", async () => {
		const vault = new FakeVault({
			[`${FOLDER}/Sagondo.md`]: { content: linked("c1", "local"), mtime: at("2026-03-01") },
		});
		const { client } = clientFor([
			card({ id: "c1", name: "Sagondo", desc: "remote", dateLastActivity: "2026-01-01" }),
		]);

		const stats = await syncFolder(vault, client, MAPPING, { ...options, force: "pull" });

		expect(stats.pulled).toBe(1);
		expect(vault.contentOf(`${FOLDER}/Sagondo.md`)).toContain("remote");
	});

	test("counts a simultaneous divergence as a conflict instead of guessing", async () => {
		const vault = new FakeVault({
			[`${FOLDER}/Sagondo.md`]: { content: linked("c1", "mine"), mtime: at("2026-01-01T00:00:00") },
		});
		const { client } = clientFor([
			card({ id: "c1", name: "Sagondo", desc: "theirs", dateLastActivity: "2026-01-01T00:00:10" }),
		]);

		const stats = await syncFolder(vault, client, MAPPING, { ...options, marginMs: 60_000 });

		expect(stats.conflicts).toBe(1);
		expect(vault.contentOf(`${FOLDER}/Sagondo.md`)).toContain("mine");
	});

	test("does not push a pair once the signal is aborted mid-note", async () => {
		const vault = new FakeVault({
			[`${FOLDER}/Sagondo.md`]: { content: linked("c1", "local"), mtime: at("2026-03-01") },
		});
		const controller = new AbortController();
		const requests: { method: string; url: string }[] = [];
		// The checklist fetch is the per-note request syncNoteWithCard makes before
		// pushing — aborting from inside it proves the signal reaches syncNoteWithCard
		// itself (not just the outer per-pair loop, which never sees this abort in time).
		const transport = async (request: { method: string; url: string }) => {
			requests.push(request);
			if (request.url.includes("/checklists")) {
				controller.abort();
				return { status: 200, text: "[]" };
			}
			if (request.url.includes("/lists/l1/cards")) {
				return {
					status: 200,
					text: JSON.stringify([
						card({ id: "c1", name: "Sagondo", desc: "remote", dateLastActivity: "2026-01-01" }),
					]),
				};
			}
			return { status: 200, text: "{}" };
		};
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		await syncFolder(
			vault,
			client,
			MAPPING,
			{ ...options, syncChecklists: true },
			undefined,
			undefined,
			controller.signal,
		);

		expect(requests.filter((r) => r.method === "PUT")).toHaveLength(0);
	});
});

const FATE: CardFateRules = { onCardMoved: "move-note", onCardArchived: "unlink", onCardDeleted: "unlink", archiveFolder: "" };
const withFate = (fate: Partial<CardFateRules>): FolderSyncOptions => ({
	...options,
	cardFate: { ...FATE, ...fate },
	trelloPropertyKeys: ["trello_board_card_id", "trello_due"],
});

/** A list holding no card, plus per-card lookups (`GET /cards/<id>`) for the cards that left it. */
function clientWithCards(lookups: Record<string, unknown>, extra: Record<string, unknown> = {}) {
	const { transport, requests } = routedTransport({ "/lists/l1/cards": [], ...lookups, ...extra });
	return { client: new TrelloClient({ apiKey: "k", token: "t" }, transport, { maxRetries: 0 }), requests };
}

describe("syncFolder — a card that left the list", () => {
	test("keeps a note whose card is gone when the rule says keep", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Fantôme.md`]: { content: linked("gone", "x") } });
		const { client } = clientWithCards({ "/cards/gone": card({ id: "gone", closed: true }) });

		const stats = await syncFolder(vault, client, MAPPING, withFate({ onCardArchived: "keep" }));

		expect(stats.phantoms).toBe(1);
		expect(stats.detached + stats.deleted + stats.relocated).toBe(0);
		expect(vault.contentOf(`${FOLDER}/Fantôme.md`)).toBe(linked("gone", "x"));
	});

	test("an archived card: Trello properties are removed, the body is untouched (default)", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Archivée.md`]: { content: linked("c9", "corps") } });
		const { client } = clientWithCards({ "/cards/c9": card({ id: "c9", closed: true }) });

		const stats = await syncFolder(vault, client, MAPPING, withFate({}));

		expect(stats.detached).toBe(1);
		const note = vault.note(`${FOLDER}/Archivée.md`);
		expect(vault.readFrontmatter(note)?.trello_board_card_id).toBeUndefined();
		expect(vault.readFrontmatter(note)?.type).toBe("idée");
		expect(vault.contentOf(note.path)).toContain("corps");
		expect(vault.trashed).toEqual([]);
	});

	test("an archived card with the archive-folder rule: note filed in the archive, still linked", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Archivée.md`]: { content: linked("c9", "x") } });
		const { client } = clientWithCards({ "/cards/c9": card({ id: "c9", closed: true }) });

		const stats = await syncFolder(vault, client, MAPPING, withFate({ onCardArchived: "archive-folder", archiveFolder: "Archive" }));

		expect(stats.relocated).toBe(1);
		expect(vault.paths()).toEqual(["Archive/Archivée.md"]);
		expect(vault.getCardRef(vault.note("Archive/Archivée.md"))?.cardId).toBe("c9");
	});

	test("archive-folder never overwrites: an existing note at the destination keeps the original in place", async () => {
		const vault = new FakeVault({
			[`${FOLDER}/Archivée.md`]: { content: linked("c9", "x") },
			"Archive/Archivée.md": { content: "autre" },
		});
		const { client } = clientWithCards({ "/cards/c9": card({ id: "c9", closed: true }) });
		const reporter = recordingReporter();

		const stats = await syncFolder(vault, client, MAPPING, withFate({ onCardArchived: "archive-folder", archiveFolder: "Archive" }), reporter);

		expect(stats.relocated).toBe(0);
		expect(vault.paths()).toContain(`${FOLDER}/Archivée.md`);
		expect(vault.contentOf("Archive/Archivée.md")).toBe("autre");
		expect(reporter.logs.some((entry) => entry.level === "warn" && entry.message.includes("already exists"))).toBe(true);
	});

	test("archive-folder with no folder set behaves as keep", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Archivée.md`]: { content: linked("c9", "x") } });
		const { client } = clientWithCards({ "/cards/c9": card({ id: "c9", closed: true }) });

		const stats = await syncFolder(vault, client, MAPPING, withFate({ onCardArchived: "archive-folder" }));

		expect(stats.relocated + stats.detached).toBe(0);
		expect(vault.paths()).toEqual([`${FOLDER}/Archivée.md`]);
	});

	test("a deleted card (404): unlinks by default, trashes only when asked", async () => {
		const unlinkVault = new FakeVault({ [`${FOLDER}/Disparue.md`]: { content: linked("c9", "x") } });
		const stats = await syncFolder(unlinkVault, clientWithCards({}).client, MAPPING, withFate({}));
		expect(stats.detached).toBe(1);
		expect(unlinkVault.trashed).toEqual([]);

		const trashVault = new FakeVault({ [`${FOLDER}/Disparue.md`]: { content: linked("c9", "x") } });
		const trashed = await syncFolder(trashVault, clientWithCards({}).client, MAPPING, withFate({ onCardDeleted: "trash" }));
		expect(trashed.deleted).toBe(1);
		expect(trashVault.trashed).toEqual([`${FOLDER}/Disparue.md`]);
	});

	test('"Never trash notes in this folder" turns a trash choice into keep', async () => {
		const vault = new FakeVault({ [`${FOLDER}/Disparue.md`]: { content: linked("c9", "x") } });
		const mapping: FolderMapping = { ...MAPPING, allowDeleteOverride: "off" };

		const stats = await syncFolder(vault, clientWithCards({}).client, mapping, withFate({ onCardDeleted: "trash" }));

		expect(stats.deleted).toBe(0);
		expect(vault.trashed).toEqual([]);
	});

	test("a card moved to a list that is not mapped: the note stays", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Déplacée.md`]: { content: linked("c9", "x") } });
		const { client } = clientWithCards({ "/cards/c9": card({ id: "c9", idList: "autre" }) });

		const stats = await syncFolder(vault, client, MAPPING, withFate({}));

		expect(stats.moved).toBe(1);
		expect(vault.paths()).toEqual([`${FOLDER}/Déplacée.md`]);
	});

	test("a card moved to a mapped list: the note follows it into that folder", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Déplacée.md`]: { content: linked("c9", "x") } });
		const { client } = clientWithCards({ "/cards/c9": card({ id: "c9", idList: "l2" }) });

		const stats = await syncFolder(vault, client, MAPPING, {
			...withFate({}),
			mappedFolderByListId: new Map([["l2", "WoT/B"]]),
		});

		expect(stats.relocated).toBe(1);
		expect(vault.paths()).toEqual(["WoT/B/Déplacée.md"]);
	});

	test("a moved card with the trash rule trashes the note", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Déplacée.md`]: { content: linked("c9", "x") } });
		const { client } = clientWithCards({ "/cards/c9": card({ id: "c9", idList: "autre" }) });

		const stats = await syncFolder(vault, client, MAPPING, withFate({ onCardMoved: "trash" }));

		expect(stats.deleted).toBe(1);
		expect(vault.trashed).toEqual([`${FOLDER}/Déplacée.md`]);
	});

	test("dry-run writes nothing but still reports", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Archivée.md`]: { content: linked("c9", "x") } });
		const { client } = clientWithCards({ "/cards/c9": card({ id: "c9", closed: true }) });
		const reporter = recordingReporter();

		const stats = await syncFolder(vault, client, MAPPING, { ...withFate({}), dryRun: true }, reporter);

		expect(stats.detached).toBe(1);
		expect(vault.contentOf(`${FOLDER}/Archivée.md`)).toBe(linked("c9", "x"));
		expect(reporter.logs.some((entry) => entry.message.includes("Trello properties removed"))).toBe(true);
	});

	test("a card whose state cannot be checked is left untouched and logged", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Inconnue.md`]: { content: linked("c9", "x") } });
		const { transport } = routedTransport({ "/lists/l1/cards": [] });
		const failing = async (request: Parameters<typeof transport>[0]) =>
			request.url.includes("/cards/c9") ? { status: 401, text: "unauthorized" } : transport(request);
		const client = new TrelloClient({ apiKey: "k", token: "t" }, failing, { maxRetries: 0 });
		const reporter = recordingReporter();

		const stats = await syncFolder(vault, client, MAPPING, withFate({}), reporter);

		expect(stats.detached + stats.deleted + stats.relocated).toBe(0);
		expect(vault.contentOf(`${FOLDER}/Inconnue.md`)).toBe(linked("c9", "x"));
		expect(reporter.logs.some((entry) => entry.level === "warn" && entry.message.includes("left untouched"))).toBe(true);
	});

	test("uses a pre-fetched board card list instead of one request per gone card", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Archivée.md`]: { content: linked("c9", "x") } });
		const { client, requests } = clientWithCards({});

		const stats = await syncFolder(vault, client, MAPPING, withFate({}), undefined, [card({ id: "c9", closed: true })]);

		expect(stats.detached).toBe(1);
		expect(requests.filter((request) => request.url.includes("/cards/c9"))).toHaveLength(0);
	});

	test("does not spend any extra request when no note lost its card", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Ok.md`]: { content: linked("c1", "x"), mtime: at("2026-03-01") } });
		const { client, requests } = clientWithCards({}, { "/lists/l1/cards": [card({ id: "c1", name: "Ok", desc: "x", dateLastActivity: "2026-01-01" })] });

		await syncFolder(vault, client, MAPPING, withFate({}));

		expect(requests.filter((request) => request.url.includes("/boards/") || /\/cards\/c1/.test(request.url))).toHaveLength(0);
	});
});

describe("syncFolder — a note that already exists elsewhere", () => {
	const MAP_A: FolderMapping = { listId: "l1", folder: "WoT/A", templateName: "" };
	const MAP_B: FolderMapping = { listId: "l2", folder: "WoT/B", templateName: "" };
	const mapped = new Map([["l1", "WoT/A"], ["l2", "WoT/B"]]);
	const moved = (order: FolderMapping[]) => ({
		vault: new FakeVault({ "WoT/A/Pj.md": { content: linked("c9", "x"), mtime: at("2026-03-01") } }),
		order,
	});

	test("a card moved from A to B is not duplicated whichever folder syncs first", async () => {
		for (const order of [[MAP_A, MAP_B], [MAP_B, MAP_A]]) {
			const { vault } = moved(order);
			const { transport } = routedTransport({
				"/lists/l1/cards": [],
				"/lists/l2/cards": [card({ id: "c9", name: "Pj", desc: "x", dateLastActivity: "2026-01-01", idList: "l2" })],
				"/cards/c9": card({ id: "c9", idList: "l2" }),
			});
			const client = new TrelloClient({ apiKey: "k", token: "t" }, transport, { maxRetries: 0 });

			const total = await syncAllMappings(vault, client, order, { ...withFate({}), mappedFolderByListId: mapped }, silentReporter);

			expect(vault.paths()).toEqual(["WoT/B/Pj.md"]);
			expect(total.created).toBe(0);
		}
	});

	test("a note in an unmapped place is left there and no second note is created", async () => {
		const vault = new FakeVault({ "Perso/Pj.md": { content: linked("c9", "x") } });
		const { transport } = routedTransport({
			"/lists/l1/cards": [card({ id: "c9", name: "Pj", desc: "x" })],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport, { maxRetries: 0 });

		const stats = await syncFolder(vault, client, MAP_A, { ...withFate({}), mappedFolderByListId: mapped });

		expect(stats.created).toBe(0);
		expect(vault.paths()).toEqual(["Perso/Pj.md"]);
	});

	test("a card taken out of the archive brings its note back, unless restoring is off", async () => {
		for (const [restore, expected] of [[true, ["WoT/A/Pj.md"]], [false, ["Archive/Pj.md"]]] as const) {
			const vault = new FakeVault({ "Archive/Pj.md": { content: linked("c9", "x"), mtime: at("2026-03-01") } });
			const { transport } = routedTransport({
				"/lists/l1/cards": [card({ id: "c9", name: "Pj", desc: "x", dateLastActivity: "2026-01-01" })],
			});
			const client = new TrelloClient({ apiKey: "k", token: "t" }, transport, { maxRetries: 0 });

			await syncFolder(vault, client, MAP_A, {
				...withFate({ onCardArchived: "archive-folder", archiveFolder: "Archive" }),
				mappedFolderByListId: mapped,
				archiveRestoreOnUnarchive: restore,
			});

			expect(vault.paths()).toEqual(expected);
		}
	});

	test("archived cards of mapped lists get a note in the archive folder when asked to", async () => {
		const vault = new FakeVault();
		const { transport } = routedTransport({
			"/lists/l1/cards": [],
			"/boards/board/cards": [card({ id: "z1", name: "Vieille", idList: "l1", closed: true })],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport, { maxRetries: 0 });

		const total = await syncAllMappings(
			vault,
			client,
			[MAP_A],
			{ ...withFate({ onCardArchived: "archive-folder", archiveFolder: "Archive" }), mappedFolderByListId: mapped, archiveCreateMissing: true },
			silentReporter,
		);

		expect(total.created).toBe(1);
		expect(vault.paths()).toEqual(["Archive/Vieille.md"]);
	});
});

describe("syncFolder — resilience", () => {
	test("keeps going and counts the error when one card fails", async () => {
		const vault = new FakeVault({
			[`${FOLDER}/Bad.md`]: { content: linked("c1", "x"), mtime: at("2026-03-01") },
			[`${FOLDER}/Good.md`]: { content: linked("c2", "y"), mtime: at("2026-03-01") },
		});
		const { transport } = routedTransport({
			"/lists/l1/cards": [
				card({ id: "c1", name: "Bad", desc: "z", dateLastActivity: "2026-01-01" }),
				card({ id: "c2", name: "Good", desc: "z", dateLastActivity: "2026-01-01" }),
			],
		});
		const failing = async (request: Parameters<typeof transport>[0]) =>
			request.method === "PUT" && request.url.includes("c1")
				? { status: 400, text: "bad request" }
				: transport(request);
		const client = new TrelloClient({ apiKey: "k", token: "t" }, failing);

		const stats = await syncFolder(vault, client, MAPPING, options);

		expect(stats.errors).toBe(1);
		expect(stats.pushed).toBe(1);
	});

	test("logs the sanitized file name actually written when it differs from the card title", async () => {
		const vault = new FakeVault();
		const { client } = clientFor([card({ id: "c1", name: "CON" })]);
		const creates: string[] = [];
		const reporter = {
			setTotal: () => {},
			step: () => {},
			count: () => {},
			log: (level: string, message: string) => {
				if (level === "create") creates.push(message);
			},
			finish: () => {},
		};

		await syncFolder(vault, client, MAPPING, options, reporter);

		expect(creates).toEqual(['CON → saved as "_CON"']);
	});

	test("a note outside the mapped folder is left alone and no second note is created for its card", async () => {
		const vault = new FakeVault({
			"WoT/90_Fins/Autre.md": { content: linked("c1", "x") },
		});
		const { client } = clientFor([card({ id: "c1", name: "Autre" })]);

		const stats = await syncFolder(vault, client, MAPPING, options);

		expect(stats.created).toBe(0);
		expect(stats.skipped).toBe(1);
		expect(vault.paths()).toEqual(["WoT/90_Fins/Autre.md"]);
	});
});

describe("syncFolder — duplicates & unlinked notes", () => {
	test("counts and warns about a duplicate note claiming an already-linked card", async () => {
		const vault = new FakeVault({
			[`${FOLDER}/a.md`]: { content: linked("c1", "x") },
			[`${FOLDER}/b.md`]: { content: linked("c1", "y") },
		});
		const { client } = clientFor([card({ id: "c1", name: "a" })]);
		const warnings: string[] = [];
		const reporter = {
			setTotal: () => {},
			step: () => {},
			count: () => {},
			log: (level: string, message: string) => {
				if (level === "warn") warnings.push(message);
			},
			finish: () => {},
		};

		const stats = await syncFolder(vault, client, MAPPING, options, reporter);

		expect(stats.duplicates).toBe(1);
		expect(warnings.some((message) => message.includes("Duplicate note"))).toBe(true);
	});

	test("counts a note with no card id without touching it", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Libre.md`]: { content: "no frontmatter" } });
		const { client } = clientFor([]);

		const stats = await syncFolder(vault, client, MAPPING, options);

		expect(stats.unlinked).toBe(1);
		expect(vault.contentOf(`${FOLDER}/Libre.md`)).toBe("no frontmatter");
	});

	test("a forced resync still ignores an unlinked note instead of creating a link for it", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Libre.md`]: { content: "no frontmatter" } });
		const { client } = clientFor([]);

		const stats = await syncFolder(vault, client, MAPPING, { ...options, force: "pull" });

		expect(stats.unlinked).toBe(1);
		expect(vault.contentOf(`${FOLDER}/Libre.md`)).toBe("no frontmatter");
	});
});

describe("syncFolder — members", () => {
	test("fetches the board's member directory once per run, not once per note", async () => {
		const vault = new FakeVault({
			[`${FOLDER}/a.md`]: { content: linked("c1", "same"), mtime: at("2026-01-01") },
			[`${FOLDER}/b.md`]: { content: linked("c2", "same"), mtime: at("2026-01-01") },
			[`${FOLDER}/c.md`]: { content: linked("c3", "same"), mtime: at("2026-01-01") },
		});
		const { transport, requests } = routedTransport({
			"/lists/l1/cards": [
				card({ id: "c1", name: "a", desc: "same" }),
				card({ id: "c2", name: "b", desc: "same" }),
				card({ id: "c3", name: "c", desc: "same" }),
			],
			"/boards/board/members": [{ id: "u1", fullName: "Alice", username: "alice" }],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		await syncFolder(vault, client, MAPPING, { ...options, syncMembers: true });

		expect(requests.filter((r) => r.url.includes("/members"))).toHaveLength(1);
	});

	test("makes zero member-directory requests when syncMembers is off", async () => {
		const vault = new FakeVault({ [`${FOLDER}/a.md`]: { content: linked("c1", "same"), mtime: at("2026-01-01") } });
		const { transport, requests } = routedTransport({
			"/lists/l1/cards": [card({ id: "c1", name: "a", desc: "same" })],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		await syncFolder(vault, client, MAPPING, { ...options, syncMembers: false });

		expect(requests.filter((r) => r.url.includes("/members"))).toHaveLength(0);
	});
});

describe("syncFolder — custom fields", () => {
	test("fetches the board's custom-field definitions once per run, not once per note", async () => {
		const vault = new FakeVault({
			[`${FOLDER}/a.md`]: { content: linked("c1", "same"), mtime: at("2026-01-01") },
			[`${FOLDER}/b.md`]: { content: linked("c2", "same"), mtime: at("2026-01-01") },
			[`${FOLDER}/c.md`]: { content: linked("c3", "same"), mtime: at("2026-01-01") },
		});
		const { transport, requests } = routedTransport({
			"/lists/l1/cards": [
				card({ id: "c1", name: "a", desc: "same" }),
				card({ id: "c2", name: "b", desc: "same" }),
				card({ id: "c3", name: "c", desc: "same" }),
			],
			"/boards/board/customFields": [{ id: "f1", name: "Notes", type: "text" }],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		await syncFolder(vault, client, MAPPING, { ...options, syncCustomFields: true });

		expect(requests.filter((r) => r.url.includes("/customFields"))).toHaveLength(1);
	});

	test("makes zero custom-field requests when syncCustomFields is off", async () => {
		const vault = new FakeVault({ [`${FOLDER}/a.md`]: { content: linked("c1", "same"), mtime: at("2026-01-01") } });
		const { transport, requests } = routedTransport({
			"/lists/l1/cards": [card({ id: "c1", name: "a", desc: "same" })],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		await syncFolder(vault, client, MAPPING, { ...options, syncCustomFields: false });

		expect(requests.filter((r) => r.url.includes("/customFields"))).toHaveLength(0);
	});
});

describe("syncFolder — progress", () => {
	test("does not count creations it will not perform in the progress total", async () => {
		const vault = new FakeVault();
		const { client } = clientFor([card({ id: "c1", name: "A" }), card({ id: "c2", name: "B" })]);
		const totals: number[] = [];
		const reporter = {
			setTotal: (n: number) => totals.push(n),
			step: () => {},
			count: () => {},
			log: () => {},
			finish: () => {},
		};

		await syncFolder(vault, client, MAPPING, { ...options, allowCreate: false }, reporter);

		expect(totals).toEqual([0]);
	});
});

describe("syncAllMappings", () => {
	const MAPPING_A: FolderMapping = { listId: "l1", folder: "Folder/A", templateName: "" };
	const MAPPING_B: FolderMapping = { listId: "l2", folder: "Folder/B", templateName: "" };

	test("one mapping failing doesn't stop the others, and its error is counted in the total", async () => {
		const vault = new FakeVault();
		// No route for /lists/l1/cards -> mapping A's list fetch throws.
		const { transport } = routedTransport({ "/lists/l2/cards": [card({ id: "c2", name: "Good" })] });
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const total = await syncAllMappings(vault, client, [MAPPING_A, MAPPING_B], options, silentReporter);

		expect(total.errors).toBe(1);
		expect(total.created).toBe(1);
	});

	test("scans the vault once and reuses it across every mapping instead of one scan per folder", async () => {
		class CountingVault extends FakeVault {
			listCalls = 0;
			override listNotes(folder: string) {
				this.listCalls++;
				return super.listNotes(folder);
			}
		}
		const vault = new CountingVault();
		const { transport } = routedTransport({ "/lists/l1/cards": [], "/lists/l2/cards": [] });
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		await syncAllMappings(vault, client, [MAPPING_A, MAPPING_B], options, silentReporter);

		expect(vault.listCalls).toBe(1);
	});
});

describe("syncFolder — attachments", () => {
	test("resolves a card-link attachment to a note living outside the synced folder", async () => {
		const vault = new FakeVault({
			[`${FOLDER}/Sagondo.md`]: { content: linked("c1", "same"), mtime: at("2026-01-01") },
			"Autre/Cible.md": { content: linked("c2", "cible"), mtime: at("2026-01-01") },
		});
		const { transport } = routedTransport({
			"/lists/l1/cards": [card({ id: "c1", name: "Sagondo", desc: "same", dateLastActivity: "2026-01-01" })],
			"/cards/c1/attachments": [
				{ id: "a1", name: "Cible", url: "https://trello.com/c/AbC1/2-cible", isUpload: false },
			],
			"/cards/AbC1": { id: "c2", idBoard: "board", name: "Cible" },
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		await syncFolder(vault, client, MAPPING, { ...options, syncAttachments: true });

		expect(vault.readFrontmatter(vault.note(`${FOLDER}/Sagondo.md`))?.[DEFAULT_LINKED_CARDS_KEY]).toEqual([
			"[[Cible]]",
		]);
	});

	test("scans the vault only once for the card index, shared across every mapping", async () => {
		const mappingA: FolderMapping = { listId: "l1", folder: "Folder/A", templateName: "" };
		const mappingB: FolderMapping = { listId: "l2", folder: "Folder/B", templateName: "" };
		class CountingVault extends FakeVault {
			listCalls = 0;
			override listNotes(folder: string, excludedFolders?: string[]) {
				this.listCalls++;
				return super.listNotes(folder, excludedFolders);
			}
		}
		const vault = new CountingVault();
		const { transport } = routedTransport({ "/lists/l1/cards": [], "/lists/l2/cards": [] });
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		await syncAllMappings(vault, client, [mappingA, mappingB], { ...options, syncAttachments: true }, silentReporter);

		// 1 scan for `allNotes` (folder-narrowing + card index), reused by both mappings —
		// not 2 (one extra full scan per mapping if the card index were rebuilt each time).
		expect(vault.listCalls).toBe(1);
	});
});

describe("syncFolder — embedded card details", () => {
	const stable = () =>
		new FakeVault({ [`${FOLDER}/Sagondo.md`]: { content: linked("c1", "same"), mtime: at("2026-01-01") } });

	test("gets attachments and checklists with the list's cards — no request per note", async () => {
		const vault = stable();
		const { transport, requests } = routedTransport({
			"/lists/l1/cards": [
				card({ id: "c1", name: "Sagondo", desc: "same", dateLastActivity: "2026-01-01", attachments: [], checklists: [] }),
			],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		await syncFolder(vault, client, MAPPING, { ...options, syncAttachments: true, syncChecklists: true });

		expect(requests).toHaveLength(1);
		expect(decodeURIComponent(requests[0]?.url ?? "")).toContain("attachments=true");
		expect(decodeURIComponent(requests[0]?.url ?? "")).toContain("checklists=all");
	});

	test("with members and custom fields on too, only the run-level requests remain", async () => {
		const vault = stable();
		const { transport, requests } = routedTransport({
			"/lists/l1/cards": [
				card({ id: "c1", name: "Sagondo", desc: "same", dateLastActivity: "2026-01-01", attachments: [], checklists: [] }),
			],
			"/boards/board/members": [],
			"/boards/board/customFields": [],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		await syncFolder(vault, client, MAPPING, {
			...options,
			syncAttachments: true,
			syncChecklists: true,
			syncMembers: true,
			syncCustomFields: true,
		});

		expect(requests).toHaveLength(3);
		expect(requests.filter((r) => r.url.includes("/cards/c1"))).toHaveLength(0);
		expect(decodeURIComponent(requests[0]?.url ?? "")).toContain("attachments=true");
		expect(decodeURIComponent(requests[0]?.url ?? "")).toContain("checklists=all");
	});

	test("off: one attachments and one checklists request per note, as before", async () => {
		const vault = stable();
		const { transport, requests } = routedTransport({
			"/lists/l1/cards": [card({ id: "c1", name: "Sagondo", desc: "same", dateLastActivity: "2026-01-01" })],
			"/cards/c1/attachments": [],
			"/cards/c1/checklists": [],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		await syncFolder(vault, client, MAPPING, {
			...options,
			syncAttachments: true,
			syncChecklists: true,
			fetchCardDetailsWithCards: false,
		});

		expect(requests[0]?.url).not.toContain("attachments=");
		expect(requests.filter((r) => r.url.includes("/cards/c1/"))).toHaveLength(2);
	});
});
