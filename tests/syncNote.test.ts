import { describe, expect, test } from "vitest";
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

describe("syncNoteWithCard — forced push", () => {
	test("sends the note title too, since the user asked for the note to win", async () => {
		const { vault, client, requests } = setup("same", at("2026-01-01"));
		const remote = card({ id: "c1", name: "Ancien titre", desc: "same", dateLastActivity: "2026-03-01" });

		await syncNoteWithCard(vault, client, vault.note(PATH), remote, { ...options, force: "push" });

		expect(requests[0]?.body).toContain("name=Sagondo");
	});
});
