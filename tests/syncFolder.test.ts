import { describe, expect, test } from "vitest";
import { DEFAULT_LINKED_CARDS_KEY } from "../src/core/attachmentRef";
import { syncAllMappings, syncFolder, type FolderMapping, type FolderSyncOptions } from "../src/features/syncFolder";
import { silentReporter } from "../src/obsidian/gateway";
import { TrelloClient } from "../src/trello/client";
import { FakeVault, at, card, recordingReporter, routedTransport } from "./fakes";

const FOLDER = "WoT/85_Idées";
const MAPPING = { listId: "l1", folder: FOLDER, templateName: "idée (script)" };

const options: FolderSyncOptions = {
	policy: "newer-wins",
	marginMs: 0,
	syncTitle: true,
	dryRun: false,
	allowCreate: true,
	allowDelete: false,
	boardId: "board",
	// Off by default in this shared fixture — attachments/checklists syncing is covered on
	// its own in syncNote.test.ts, and its extra Trello request per note would break
	// request-count assertions here that are about syncFolder's own list/board-fetch batching.
	syncAttachments: false,
	syncChecklists: false,
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
});

describe("syncFolder — deletion", () => {
	test("leaves a note whose card vanished alone by default", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Fantôme.md`]: { content: linked("gone", "x") } });
		const { client } = clientFor([]);

		const stats = await syncFolder(vault, client, MAPPING, options);

		expect(stats.deleted).toBe(0);
		expect(stats.phantoms).toBe(1);
		expect(vault.paths()).toEqual([`${FOLDER}/Fantôme.md`]);
	});

	test("trashes the note only when deletion is explicitly enabled", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Fantôme.md`]: { content: linked("gone", "x") } });
		const { client } = clientFor([]);

		const stats = await syncFolder(vault, client, MAPPING, { ...options, allowDelete: true });

		expect(stats.deleted).toBe(1);
		expect(vault.trashed).toEqual([`${FOLDER}/Fantôme.md`]);
	});

	test("deletes nothing in dry-run mode even when deletion is enabled", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Fantôme.md`]: { content: linked("gone", "x") } });
		const { client } = clientFor([]);

		await syncFolder(vault, client, MAPPING, { ...options, allowDelete: true, dryRun: true });

		expect(vault.trashed).toEqual([]);
	});

	test("a forced pull never deletes a phantom note when allowDelete stays off — force imposes a direction, not a permission", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Fantôme.md`]: { content: linked("gone", "x") } });
		const { client } = clientFor([]);

		const stats = await syncFolder(vault, client, MAPPING, { ...options, force: "pull" });

		expect(stats.deleted).toBe(0);
		expect(vault.trashed).toEqual([]);
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

	test("keeps existing phantom notes and counts an error when the board-cards protection check itself fails", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Fantôme.md`]: { content: linked("gone", "x") } });
		// No route for /boards/board/cards -> the protection fetch itself throws.
		const { transport } = routedTransport({ "/lists/l1/cards": [] });
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const stats = await syncFolder(vault, client, MAPPING, { ...options, allowDelete: true });

		expect(stats.deleted).toBe(0);
		expect(stats.errors).toBe(1);
		expect(vault.trashed).toEqual([]);
		expect(vault.paths()).toEqual([`${FOLDER}/Fantôme.md`]);
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

	test("ignores notes outside the mapped folder", async () => {
		const vault = new FakeVault({
			"WoT/90_Fins/Autre.md": { content: linked("c1", "x") },
		});
		const { client } = clientFor([card({ id: "c1", name: "Autre" })]);

		const stats = await syncFolder(vault, client, MAPPING, options);

		expect(stats.created).toBe(1);
		expect(stats.pulled + stats.pushed + stats.skipped).toBe(0);
	});
});

describe("syncFolder — deletion safety", () => {
	test("spares a note whose card merely moved to another list on the board", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Déplacée.md`]: { content: linked("c9", "x") } });
		const { transport } = routedTransport({
			"/lists/l1/cards": [],
			"/boards/board/cards": [card({ id: "c9", name: "Déplacée", idList: "autre" })],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const stats = await syncFolder(vault, client, MAPPING, { ...options, allowDelete: true });

		expect(stats.deleted).toBe(0);
		expect(stats.moved).toBe(1);
		expect(vault.trashed).toEqual([]);
	});

	test("still deletes a note whose card left the board entirely", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Disparue.md`]: { content: linked("c9", "x") } });
		const { transport } = routedTransport({ "/lists/l1/cards": [], "/boards/board/cards": [] });
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const stats = await syncFolder(vault, client, MAPPING, { ...options, allowDelete: true });

		expect(stats.deleted).toBe(1);
		expect(vault.trashed).toEqual([`${FOLDER}/Disparue.md`]);
	});

	test("does not spend a board request when deletion is off", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Fantôme.md`]: { content: linked("gone", "x") } });
		const { transport, requests } = routedTransport({ "/lists/l1/cards": [] });
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		await syncFolder(vault, client, MAPPING, options);

		expect(requests.filter((r) => r.url.includes("/boards/"))).toHaveLength(0);
	});

	test("spares a note whose card was archived rather than deleted", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Archivée.md`]: { content: linked("c9", "x") } });
		const { transport } = routedTransport({
			"/lists/l1/cards": [],
			"/boards/board/cards": [card({ id: "c9", name: "Archivée", closed: true })],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const stats = await syncFolder(vault, client, MAPPING, { ...options, allowDelete: true });

		expect(stats.deleted).toBe(0);
		expect(stats.moved).toBe(1);
		expect(vault.trashed).toEqual([]);
	});

	test("requests archived cards too so the archive check actually works", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Archivée.md`]: { content: linked("c9", "x") } });
		const { transport, requests } = routedTransport({
			"/lists/l1/cards": [],
			"/boards/board/cards": [card({ id: "c9", name: "Archivée", closed: true })],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		await syncFolder(vault, client, MAPPING, { ...options, allowDelete: true });

		const boardRequest = requests.find((r) => r.url.includes("/boards/"));
		expect(boardRequest?.url).toContain("filter=all");
	});

	test("accepts a pre-fetched board card list instead of issuing its own request", async () => {
		const vault = new FakeVault({ [`${FOLDER}/Disparue.md`]: { content: linked("c9", "x") } });
		const { transport, requests } = routedTransport({ "/lists/l1/cards": [] });
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const stats = await syncFolder(vault, client, MAPPING, { ...options, allowDelete: true }, undefined, []);

		expect(stats.deleted).toBe(1);
		expect(requests.filter((r) => r.url.includes("/boards/"))).toHaveLength(0);
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
