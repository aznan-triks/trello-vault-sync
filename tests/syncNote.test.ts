import { describe, expect, test } from "vitest";
import { DEFAULT_DUE_KEY as DUE_KEY } from "../src/core/dueRef";
import { DEFAULT_LABELS_KEY as LABELS_KEY } from "../src/core/labelRef";
import { syncNoteWithCard, type NoteSyncOptions } from "../src/features/syncNote";
import { TrelloClient } from "../src/trello/client";
import { FakeVault, at, card, routedTransport } from "./fakes";

const PATH = "WoT/85_Idées/Sagondo.md";
const FRONTMATTER = '---\ntype: idée\ntrello_board_card_id: "board;c1"\n---\n\n';

const options: NoteSyncOptions = {
	policy: "newer-wins",
	marginMs: 0,
	syncTitle: true,
	dryRun: false,
};

function setup(noteBody: string, noteMtime: number) {
	const vault = new FakeVault({ [PATH]: { content: FRONTMATTER + noteBody, mtime: noteMtime } });
	const { transport, requests } = routedTransport({});
	const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
	return { vault, client, requests };
}

describe("syncNoteWithCard", () => {
	test("pulls the card description into the body, leaving the frontmatter intact", async () => {
		const { vault, client } = setup("old", at("2026-01-01"));
		const remote = card({ id: "c1", name: "Sagondo", desc: "new text", dateLastActivity: "2026-02-01" });

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		expect(result.direction).toBe("pull");
		expect(vault.contentOf(PATH)).toBe(FRONTMATTER + "new text");
	});

	test("renames the note when the card title changed", async () => {
		const { vault, client } = setup("same", at("2026-01-01"));
		const remote = card({ id: "c1", name: "Sagondo v2", desc: "same", dateLastActivity: "2026-02-01" });

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		expect(result.renamed).toBe(true);
		expect(vault.paths()).toContain("WoT/85_Idées/Sagondo v2.md");
	});

	test("sanitises an illegal character in the card title before renaming", async () => {
		const { vault, client } = setup("same", at("2026-01-01"));
		const remote = card({ id: "c1", name: "A/B", desc: "same", dateLastActivity: "2026-02-01" });

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		expect(vault.paths()).toContain("WoT/85_Idées/A-B.md");
	});

	test("suffixes the rename when another note already holds the target name", async () => {
		const { vault, client } = setup("same", at("2026-01-01"));
		await vault.create("WoT/85_Idées/Occupé.md", "autre");
		const remote = card({ id: "c1", name: "Occupé", desc: "same", dateLastActivity: "2026-02-01" });

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		expect(vault.paths()).toContain("WoT/85_Idées/Occupé (2).md");
	});

	test("leaves the file name alone when title syncing is off", async () => {
		const { vault, client } = setup("old", at("2026-01-01"));
		const remote = card({ id: "c1", name: "Sagondo v2", desc: "new", dateLastActivity: "2026-02-01" });

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, {
			...options,
			syncTitle: false,
		});

		expect(result.renamed).toBe(false);
		expect(vault.paths()).toEqual([PATH]);
	});

	test("pushes the local body and title when the note is newer", async () => {
		const { vault, client, requests } = setup("local text", at("2026-03-01"));
		const remote = card({ id: "c1", name: "Ancien titre", desc: "remote", dateLastActivity: "2026-01-01" });

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		expect(result.direction).toBe("push");
		expect(requests[0]?.method).toBe("PUT");
		expect(requests[0]?.body).toContain("desc=local+text");
		expect(requests[0]?.body).toContain("name=Sagondo");
	});

	test("strips Templater tags out of the body it pushes", async () => {
		const { vault, client, requests } = setup("<%* tp.user.x() %>\nreal", at("2026-03-01"));
		const remote = card({ id: "c1", name: "Sagondo", desc: "remote", dateLastActivity: "2026-01-01" });

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		expect(requests[0]?.body).not.toContain("tp.user");
		expect(requests[0]?.body).toContain("desc=real");
	});

	test("does nothing at all when both sides already agree", async () => {
		const { vault, client, requests } = setup("same", at("2026-01-01"));
		const remote = card({ id: "c1", name: "Sagondo", desc: "same", dateLastActivity: "2026-02-01" });

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		expect(result.direction).toBe("skip");
		expect(requests).toHaveLength(0);
		expect(vault.contentOf(PATH)).toBe(FRONTMATTER + "same");
	});

	test("obeys a forced pull even though the note is the newer side", async () => {
		const { vault, client } = setup("local", at("2026-03-01"));
		const remote = card({ id: "c1", name: "Sagondo", desc: "remote", dateLastActivity: "2026-01-01" });

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, {
			...options,
			force: "pull",
		});

		expect(result.direction).toBe("pull");
		expect(vault.contentOf(PATH)).toBe(FRONTMATTER + "remote");
	});

	test("obeys a forced push even though the card is the newer side", async () => {
		const { vault, client, requests } = setup("local", at("2026-01-01"));
		const remote = card({ id: "c1", name: "Sagondo", desc: "remote", dateLastActivity: "2026-03-01" });

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, {
			...options,
			force: "push",
		});

		expect(result.direction).toBe("push");
		expect(requests[0]?.method).toBe("PUT");
	});

	test("reports a conflict and touches nothing when both sides moved together", async () => {
		const { vault, client, requests } = setup("local", at("2026-01-01T00:00:00"));
		const remote = card({ id: "c1", name: "Sagondo", desc: "remote", dateLastActivity: "2026-01-01T00:00:30" });

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, {
			...options,
			marginMs: 60_000,
		});

		expect(result.direction).toBe("conflict");
		expect(requests).toHaveLength(0);
		expect(vault.contentOf(PATH)).toBe(FRONTMATTER + "local");
	});

	test("fails loudly instead of guessing when the card has no readable timestamp", async () => {
		const { vault, client } = setup("old", at("2026-01-01"));
		const remote = card({ id: "c1", name: "Sagondo", desc: "new", dateLastActivity: "" });

		await expect(syncNoteWithCard(vault, client, vault.note(PATH), remote, options)).rejects.toThrow(
			/dateLastActivity/,
		);
		expect(vault.contentOf(PATH)).toBe(FRONTMATTER + "old");
	});

	test("reports the direction but writes nothing in dry-run mode", async () => {
		const { vault, client, requests } = setup("old", at("2026-01-01"));
		const remote = card({ id: "c1", name: "Sagondo v2", desc: "new", dateLastActivity: "2026-02-01" });

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, {
			...options,
			dryRun: true,
		});

		expect(result.direction).toBe("pull");
		expect(requests).toHaveLength(0);
		expect(vault.contentOf(PATH)).toBe(FRONTMATTER + "old");
		expect(vault.paths()).toEqual([PATH]);
	});
});

describe("syncNoteWithCard — due date", () => {
	test("pulls the card's due date into the frontmatter", async () => {
		const { vault, client } = setup("same", at("2026-01-01"));
		const remote = card({
			id: "c1",
			name: "Sagondo",
			desc: "same",
			dateLastActivity: "2026-02-01",
			due: "2026-09-10T12:00:00.000Z",
		});

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		expect(result.direction).toBe("pull");
		expect(vault.readFrontmatter(vault.note(PATH))?.[DUE_KEY]).toBe("2026-09-10T12:00:00.000Z");
	});

	test("reads and writes the due date under a configured key instead of the default", async () => {
		const vault = new FakeVault({ [PATH]: { content: FRONTMATTER, mtime: at("2026-01-01") } });
		const { transport } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const remote = card({
			id: "c1",
			name: "Sagondo",
			desc: "same",
			dateLastActivity: "2026-02-01",
			due: "2026-09-10T12:00:00.000Z",
		});

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, {
			...options,
			dueFrontmatterKey: "deadline",
		});

		expect(vault.readFrontmatter(vault.note(PATH))?.deadline).toBe("2026-09-10T12:00:00.000Z");
		expect(vault.readFrontmatter(vault.note(PATH))).not.toHaveProperty(DUE_KEY);
	});

	test("clears a stale due date when the card no longer has one", async () => {
		const withDue = FRONTMATTER.replace("---\n\n", `${DUE_KEY}: "2026-01-01T00:00:00.000Z"\n---\n\n`);
		const vault = new FakeVault({ [PATH]: { content: withDue, mtime: at("2026-01-01") } });
		const { transport } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const remote = card({ id: "c1", name: "Sagondo", desc: "same", dateLastActivity: "2026-02-01", due: null });

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		expect(result.direction).toBe("pull");
		expect(vault.readFrontmatter(vault.note(PATH))).not.toHaveProperty(DUE_KEY);
	});

	test("leaves the frontmatter untouched on pull when the due date already agrees", async () => {
		const { vault, client } = setup("old", at("2026-01-01"));
		const remote = card({ id: "c1", name: "Sagondo", desc: "new text", dateLastActivity: "2026-02-01", due: null });

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		expect(vault.contentOf(PATH)).toBe(FRONTMATTER + "new text");
	});

	test("pushes the local due date when it changed and the note is newer", async () => {
		const withDue = FRONTMATTER.replace("---\n\n", `${DUE_KEY}: "2026-09-10T12:00:00.000Z"\n---\n\n`);
		const vault = new FakeVault({ [PATH]: { content: withDue, mtime: at("2026-03-01") } });
		const { transport, requests } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const remote = card({ id: "c1", name: "Sagondo", desc: "same", dateLastActivity: "2026-01-01", due: null });

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		expect(result.direction).toBe("push");
		expect(requests[0]?.body).toContain("due=2026-09-10T12%3A00%3A00.000Z");
	});

	test("does not send a due field when it did not change", async () => {
		const { vault, client, requests } = setup("local text", at("2026-03-01"));
		const remote = card({ id: "c1", name: "Ancien titre", desc: "remote", dateLastActivity: "2026-01-01" });

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		expect(requests[0]?.body).not.toContain("due=");
	});

	test("reports a conflict when only the due date diverged on both sides within the margin", async () => {
		const withDue = FRONTMATTER.replace("---\n\n", `${DUE_KEY}: "2026-01-01T00:00:00.000Z"\n---\n\n`);
		const vault = new FakeVault({ [PATH]: { content: withDue, mtime: at("2026-01-01T00:00:00") } });
		const { transport, requests } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const remote = card({
			id: "c1",
			name: "Sagondo",
			desc: "same",
			dateLastActivity: "2026-01-01T00:00:30",
			due: "2026-09-11T00:00:00.000Z",
		});

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, { ...options, marginMs: 60_000 });

		expect(result.direction).toBe("conflict");
		expect(requests).toHaveLength(0);
		expect(vault.readFrontmatter(vault.note(PATH))?.[DUE_KEY]).toBe("2026-01-01T00:00:00.000Z");
	});
});

describe("syncNoteWithCard — labels, merge mode (default)", () => {
	test("adds a remote label missing from the frontmatter, even when nothing else changed", async () => {
		const { vault, client } = setup("same", at("2026-01-01"));
		const remote = card({
			id: "c1",
			name: "Sagondo",
			desc: "same",
			dateLastActivity: "2026-02-01",
			labels: [{ id: "b1", name: "Bug", color: "red" }],
		});

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		expect(result.direction).toBe("skip");
		expect(vault.readFrontmatter(vault.note(PATH))?.[LABELS_KEY]).toEqual(["Bug"]);
	});

	test("reads and writes labels under a configured key instead of the default", async () => {
		const { vault, client } = setup("same", at("2026-01-01"));
		const remote = card({
			id: "c1",
			name: "Sagondo",
			desc: "same",
			dateLastActivity: "2026-02-01",
			labels: [{ id: "b1", name: "Bug", color: "red" }],
		});

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, {
			...options,
			labelsFrontmatterKey: "tags_trello",
		});

		expect(vault.readFrontmatter(vault.note(PATH))?.tags_trello).toEqual(["Bug"]);
		expect(vault.readFrontmatter(vault.note(PATH))).not.toHaveProperty(LABELS_KEY);
	});

	test("keeps an existing local-only label when pulling a new remote one", async () => {
		const withLabels = FRONTMATTER.replace("---\n\n", `${LABELS_KEY}:\n  - "Perso"\n---\n\n`);
		const vault = new FakeVault({ [PATH]: { content: withLabels, mtime: at("2026-01-01") } });
		const { transport } = routedTransport({
			"/boards/board/labels": [
				{ id: "b1", name: "Bug", color: "red" },
				{ id: "p1", name: "Perso", color: "purple" },
			],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const remote = card({
			id: "c1",
			name: "Sagondo",
			desc: "same",
			dateLastActivity: "2026-02-01",
			labels: [{ id: "b1", name: "Bug", color: "red" }],
		});

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		expect(vault.readFrontmatter(vault.note(PATH))?.[LABELS_KEY]).toEqual(["Bug", "Perso"]);
	});

	test("pushes a local-only name that matches a board label, without dropping the card's existing labels", async () => {
		const withLabels = FRONTMATTER.replace("---\n\n", `${LABELS_KEY}:\n  - "Idée"\n---\n\n`);
		const vault = new FakeVault({ [PATH]: { content: withLabels, mtime: at("2026-01-01") } });
		const { transport, requests } = routedTransport({ "/boards/board/labels": [
			{ id: "b1", name: "Bug", color: "red" },
			{ id: "i1", name: "Idée", color: "green" },
		] });
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const remote = card({
			id: "c1",
			name: "Sagondo",
			desc: "same",
			dateLastActivity: "2026-02-01",
			labels: [{ id: "b1", name: "Bug", color: "red" }],
		});

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		const update = requests.find((r) => r.method === "PUT");
		expect(update?.body).toBe("idLabels=b1%2Ci1");
	});

	test("ignores a local name with no match on the board, without throwing, and leaves it in the frontmatter", async () => {
		const withLabels = FRONTMATTER.replace("---\n\n", `${LABELS_KEY}:\n  - "Zzz"\n---\n\n`);
		const vault = new FakeVault({ [PATH]: { content: withLabels, mtime: at("2026-01-01") } });
		const { transport, requests } = routedTransport({ "/boards/board/labels": [] });
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const remote = card({ id: "c1", name: "Sagondo", desc: "same", dateLastActivity: "2026-02-01" });

		await expect(syncNoteWithCard(vault, client, vault.note(PATH), remote, options)).resolves.toBeDefined();

		expect(vault.readFrontmatter(vault.note(PATH))?.[LABELS_KEY]).toEqual(["Zzz"]);
		const update = requests.find((r) => r.method === "PUT");
		expect(update?.body).toBe("idLabels=");
	});

	test("drops only the unmatched name when pushing a mix of a valid and an invalid local label", async () => {
		const withLabels = FRONTMATTER.replace("---\n\n", `${LABELS_KEY}:\n  - "Bug"\n  - "Zzz"\n---\n\n`);
		const vault = new FakeVault({ [PATH]: { content: withLabels, mtime: at("2026-01-01") } });
		const { transport, requests } = routedTransport({
			"/boards/board/labels": [{ id: "b1", name: "Bug", color: "red" }],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const remote = card({ id: "c1", name: "Sagondo", desc: "same", dateLastActivity: "2026-02-01" });

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		const update = requests.find((r) => r.method === "PUT");
		expect(update?.body).toBe("idLabels=b1");
		expect(vault.readFrontmatter(vault.note(PATH))?.[LABELS_KEY]).toEqual(["Bug", "Zzz"]);
	});

	test("never turns a color-only (nameless) Trello label into a frontmatter entry", async () => {
		const { vault, client } = setup("same", at("2026-01-01"));
		const remote = card({
			id: "c1",
			name: "Sagondo",
			desc: "same",
			dateLastActivity: "2026-02-01",
			labels: [{ id: "x1", name: "", color: "green" }],
		});

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, options);

		expect(vault.readFrontmatter(vault.note(PATH))).not.toHaveProperty(LABELS_KEY);
	});

	test("writes nothing and calls nothing in dry-run mode, even when labels diverge", async () => {
		const { vault, client, requests } = setup("same", at("2026-01-01"));
		const remote = card({
			id: "c1",
			name: "Sagondo",
			desc: "same",
			dateLastActivity: "2026-02-01",
			labels: [{ id: "b1", name: "Bug", color: "red" }],
		});

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, { ...options, dryRun: true });

		expect(requests).toHaveLength(0);
		expect(vault.readFrontmatter(vault.note(PATH))).not.toHaveProperty(LABELS_KEY);
	});
});

describe("syncNoteWithCard — labels, overwrite mode", () => {
	test("pull: the card's labels replace the local list entirely when the card is newer", async () => {
		const withLabels = FRONTMATTER.replace("---\n\n", `${LABELS_KEY}:\n  - "Old"\n---\n\n`);
		const vault = new FakeVault({ [PATH]: { content: withLabels, mtime: at("2026-01-01") } });
		const { transport, requests } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const remote = card({
			id: "c1",
			name: "Sagondo",
			desc: "same",
			dateLastActivity: "2026-02-01",
			labels: [
				{ id: "b1", name: "Bug", color: "red" },
				{ id: "i1", name: "Idée", color: "green" },
			],
		});

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, {
			...options,
			labelsSyncMode: "overwrite",
		});

		expect(result.direction).toBe("pull");
		expect(vault.readFrontmatter(vault.note(PATH))?.[LABELS_KEY]).toEqual(["Bug", "Idée"]);
		expect(requests.filter((r) => r.method === "PUT")).toHaveLength(0);
	});

	test("push: the local list replaces the card's labels entirely when the note is newer", async () => {
		const withLabels = FRONTMATTER.replace("---\n\n", `${LABELS_KEY}:\n  - "Bug"\n  - "Idée"\n---\n\n`);
		const vault = new FakeVault({ [PATH]: { content: withLabels, mtime: at("2026-03-01") } });
		const { transport, requests } = routedTransport({
			"/boards/board/labels": [
				{ id: "b1", name: "Bug", color: "red" },
				{ id: "i1", name: "Idée", color: "green" },
				{ id: "o1", name: "Old", color: "blue" },
			],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const remote = card({
			id: "c1",
			name: "Sagondo",
			desc: "same",
			dateLastActivity: "2026-01-01",
			labels: [{ id: "o1", name: "Old", color: "blue" }],
		});

		const result = await syncNoteWithCard(vault, client, vault.note(PATH), remote, {
			...options,
			labelsSyncMode: "overwrite",
		});

		expect(result.direction).toBe("push");
		const update = requests.find((r) => r.method === "PUT");
		expect(update?.body).toContain("idLabels=b1%2Ci1");
	});
});

describe("syncNoteWithCard — forced push", () => {
	test("sends the note title too, since the user asked for the note to win", async () => {
		const { vault, client, requests } = setup("same", at("2026-01-01"));
		const remote = card({ id: "c1", name: "Ancien titre", desc: "same", dateLastActivity: "2026-03-01" });

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, { ...options, force: "push" });

		expect(requests[0]?.body).toContain("name=Sagondo");
	});
});
