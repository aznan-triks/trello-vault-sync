import { describe, expect, test } from "vitest";
import { auditChanges } from "../src/features/auditChanges";
import { FakeVault, clientFor } from "./fakes";

const REPORT = "WoT/00_Metatrois/Synchro.md";

const options = { boardId: "board", reportPath: REPORT, timestamp: "t", since: "" };

describe("auditChanges", () => {
	test("writes mapped entries into the report note", async () => {
		const vault = new FakeVault({ [REPORT]: { content: "My notes" } });
		const { client } = clientFor(
			[],
			[],
			[
				{ id: "a2", type: "createCard", date: "2026-09-04T10:00:00.000Z", data: { card: { name: "Quest" } } },
			],
		);

		const result = await auditChanges(vault, client, options);

		expect(result.entries).toBe(1);
		expect(vault.contentOf(REPORT)).toContain("My notes");
		expect(vault.contentOf(REPORT)).toContain("Card created");
		expect(vault.contentOf(REPORT)).toContain("Quest");
	});

	test("skips an unmapped action type and does not count it", async () => {
		const vault = new FakeVault({ [REPORT]: { content: "" } });
		const { client } = clientFor([], [], [{ id: "a1", type: "voteOnCard", date: "t" }]);

		const result = await auditChanges(vault, client, options);

		expect(result.entries).toBe(0);
		expect(vault.contentOf(REPORT)).toContain("No change since the last run.");
	});

	test("passes a non-empty cursor as since", async () => {
		const vault = new FakeVault({ [REPORT]: { content: "" } });
		const { client, requests } = clientFor([], [], []);

		await auditChanges(vault, client, { ...options, since: "prev-action-id" });

		expect(requests[0]?.url).toContain("since=prev-action-id");
	});

	test("omits since on a first run", async () => {
		const vault = new FakeVault({ [REPORT]: { content: "" } });
		const { client, requests } = clientFor([], [], []);

		await auditChanges(vault, client, options);

		expect(requests[0]?.url).not.toContain("since=");
	});

	test("returns the most recent action id as the next cursor", async () => {
		const vault = new FakeVault({ [REPORT]: { content: "" } });
		const { client } = clientFor(
			[],
			[],
			[
				{ id: "newest", type: "createCard", date: "t2", data: { card: { name: "B" } } },
				{ id: "oldest", type: "createCard", date: "t1", data: { card: { name: "A" } } },
			],
		);

		const result = await auditChanges(vault, client, options);

		expect(result.cursor).toBe("newest");
	});

	test("returns a null cursor when there is nothing to fetch", async () => {
		const vault = new FakeVault({ [REPORT]: { content: "" } });
		const { client } = clientFor([], [], []);

		const result = await auditChanges(vault, client, options);

		expect(result.cursor).toBeNull();
	});

	test("fails clearly when the report note does not exist", async () => {
		const vault = new FakeVault();
		const { client } = clientFor([], [], []);

		await expect(auditChanges(vault, client, { ...options, reportPath: "absent.md" })).rejects.toThrow(
			/absent\.md/,
		);
	});

	test("stops collecting once the signal is already aborted", async () => {
		const vault = new FakeVault({ [REPORT]: { content: "" } });
		const { client } = clientFor(
			[],
			[],
			[{ id: "a1", type: "createCard", date: "t", data: { card: { name: "Quest" } } }],
		);
		const controller = new AbortController();
		controller.abort();

		const result = await auditChanges(vault, client, options, undefined, controller.signal);

		expect(result.entries).toBe(0);
	});
});
