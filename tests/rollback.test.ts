import { describe, expect, test } from "vitest";
import type { SyncAction, SyncRun } from "../src/core/syncHistory";
import { undoRun, undoRunForNote } from "../src/features/rollback";
import { wrapWithHistoryRecorder } from "../src/features/syncHistoryRecorder";
import { FakeVault } from "./fakes";

function record(vault: FakeVault) {
	const actions: SyncAction[] = [];
	const wrapped = wrapWithHistoryRecorder(vault, (a) => actions.push(a));
	return { wrapped, actions };
}

describe("undoRun", () => {
	test("happy path: body + frontmatter + create → undo restores the initial vault", async () => {
		const vault = new FakeVault({
			"a.md": { content: '---\ndue: "old"\n---\n\noriginal body' },
		});
		const before = vault.contentOf("a.md");
		const { wrapped, actions } = record(vault);

		await wrapped.writeFrontmatter(vault.note("a.md"), (fm) => {
			fm.due = "new";
		});
		await wrapped.write(vault.note("a.md"), '---\ndue: "new"\n---\n\nupdated body');
		await wrapped.create("b.md", "brand new note");

		expect(vault.exists("b.md")).toBe(true);

		const run: SyncRun = { timestamp: "2026-09-12T00:00:00.000Z", scope: "", actions };
		const stats = await undoRun(vault, run);

		expect(stats).toEqual({ reverted: 3, skipped: 0 });
		expect(vault.contentOf("a.md")).toBe(before);
		expect(vault.exists("b.md")).toBe(false);
	});

	test("skips an action whose note was modified after the run, without touching it", async () => {
		const vault = new FakeVault({ "a.md": { content: "original" } });
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "synced");

		// The user edits the note after the sync ran.
		await vault.write(vault.note("a.md"), "user's own edit");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const stats = await undoRun(vault, run);

		expect(stats).toEqual({ reverted: 0, skipped: 1 });
		expect(vault.contentOf("a.md")).toBe("user's own edit");
	});

	test("skips a write action whose note was since deleted, without recreating it", async () => {
		const vault = new FakeVault({ "a.md": { content: "original" } });
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "synced");

		await vault.trash(vault.note("a.md"));

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const stats = await undoRun(vault, run);

		expect(stats).toEqual({ reverted: 0, skipped: 1 });
		expect(vault.exists("a.md")).toBe(false);
	});

	test("undoes a rename by moving the note back to its previous path", async () => {
		const vault = new FakeVault({ "a.md": { content: "body" } });
		const { wrapped, actions } = record(vault);
		await wrapped.rename(vault.note("a.md"), "b.md");
		expect(vault.exists("a.md")).toBe(false);
		expect(vault.exists("b.md")).toBe(true);

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const stats = await undoRun(vault, run);

		expect(stats).toEqual({ reverted: 1, skipped: 0 });
		expect(vault.exists("a.md")).toBe(true);
		expect(vault.exists("b.md")).toBe(false);
		expect(vault.contentOf("a.md")).toBe("body");
	});

	test("undoes a trash by recreating the note when nothing has taken its path since", async () => {
		const vault = new FakeVault({ "a.md": { content: "will be trashed" } });
		const { wrapped, actions } = record(vault);
		await wrapped.trash(vault.note("a.md"));
		expect(vault.exists("a.md")).toBe(false);

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const stats = await undoRun(vault, run);

		expect(stats).toEqual({ reverted: 1, skipped: 0 });
		expect(vault.contentOf("a.md")).toBe("will be trashed");
	});

	test("mixed run: unaffected actions still revert while the divergent one is reported skipped", async () => {
		const vault = new FakeVault({
			"a.md": { content: "a-original" },
			"c.md": { content: "c-original" },
		});
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "a-synced");
		await wrapped.write(vault.note("c.md"), "c-synced");
		await vault.write(vault.note("c.md"), "c edited by user after sync");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const stats = await undoRun(vault, run);

		expect(stats).toEqual({ reverted: 1, skipped: 1 });
		expect(vault.contentOf("a.md")).toBe("a-original");
		expect(vault.contentOf("c.md")).toBe("c edited by user after sync");
	});
});

describe("undoRunForNote", () => {
	test("only undoes actions for the given note, leaving the rest of the run intact", async () => {
		const vault = new FakeVault({
			"a.md": { content: "a-original" },
			"c.md": { content: "c-original" },
		});
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "a-synced");
		await wrapped.write(vault.note("c.md"), "c-synced");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const { stats, remainingRun } = await undoRunForNote(vault, run, "a.md");

		expect(stats).toEqual({ reverted: 1, skipped: 0 });
		expect(vault.contentOf("a.md")).toBe("a-original");
		expect(vault.contentOf("c.md")).toBe("c-synced");
		expect(remainingRun.actions).toHaveLength(1);
		expect(remainingRun.actions[0]?.path).toBe("c.md");
	});
});
