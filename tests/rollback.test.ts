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
		const { stats } = await undoRun(vault, run);

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
		const { stats } = await undoRun(vault, run);

		expect(stats).toEqual({ reverted: 0, skipped: 1 });
		expect(vault.contentOf("a.md")).toBe("user's own edit");
	});

	test("skips a write action whose note was since deleted, without recreating it", async () => {
		const vault = new FakeVault({ "a.md": { content: "original" } });
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "synced");

		await vault.trash(vault.note("a.md"));

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const { stats } = await undoRun(vault, run);

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
		const { stats } = await undoRun(vault, run);

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
		const { stats } = await undoRun(vault, run);

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
		const { stats } = await undoRun(vault, run);

		expect(stats).toEqual({ reverted: 1, skipped: 1 });
		expect(vault.contentOf("a.md")).toBe("a-original");
		expect(vault.contentOf("c.md")).toBe("c edited by user after sync");
	});

	test("regression: without a signal, behaviour is unchanged (everything reverted, remainingRun empty)", async () => {
		const vault = new FakeVault({
			"a.md": { content: "a-original" },
			"b.md": { content: "b-original" },
		});
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "a-synced");
		await wrapped.write(vault.note("b.md"), "b-synced");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const { stats, remainingRun } = await undoRun(vault, run);

		expect(stats).toEqual({ reverted: 2, skipped: 0 });
		expect(remainingRun.actions).toHaveLength(0);
	});

	test("stops when the signal is aborted after the first action, leaving the unreached actions in remainingRun in original order", async () => {
		const vault = new FakeVault({
			"a.md": { content: "a-original" },
			"b.md": { content: "b-original" },
			"c.md": { content: "c-original" },
		});
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "a-synced");
		await wrapped.write(vault.note("b.md"), "b-synced");
		await wrapped.write(vault.note("c.md"), "c-synced");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const controller = new AbortController();
		const { stats, remainingRun } = await undoRun(
			vault,
			run,
			() => controller.abort(),
			controller.signal,
		);

		// Reverse processing order is c, b, a — only c gets processed before the abort is observed.
		expect(stats).toEqual({ reverted: 1, skipped: 0 });
		expect(vault.contentOf("c.md")).toBe("c-original");
		expect(vault.contentOf("a.md")).toBe("a-synced");
		expect(vault.contentOf("b.md")).toBe("b-synced");
		expect(remainingRun.actions.map((a) => a.path)).toEqual(["a.md", "b.md"]);
	});

	test("an already-aborted signal reverts nothing and returns the whole run as remaining", async () => {
		const vault = new FakeVault({
			"a.md": { content: "a-original" },
			"b.md": { content: "b-original" },
		});
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "a-synced");
		await wrapped.write(vault.note("b.md"), "b-synced");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const controller = new AbortController();
		controller.abort();
		const { stats, remainingRun } = await undoRun(vault, run, () => {}, controller.signal);

		expect(stats).toEqual({ reverted: 0, skipped: 0 });
		expect(vault.contentOf("a.md")).toBe("a-synced");
		expect(vault.contentOf("b.md")).toBe("b-synced");
		expect(remainingRun.actions.map((a) => a.path)).toEqual(["a.md", "b.md"]);
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

	test("aborting mid-way keeps both the other-note actions and the unreached target-note actions, in original order", async () => {
		const vault = new FakeVault({
			"x.md": { content: "x-original" },
			"a.md": { content: "a-original" },
			"y.md": { content: "y-original" },
		});
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("x.md"), "x-synced"); // other note, action 1
		await wrapped.write(vault.note("a.md"), "a-synced-1"); // target note, action 2
		await wrapped.write(vault.note("a.md"), "a-synced-2"); // target note, action 3
		await wrapped.write(vault.note("y.md"), "y-synced"); // other note, action 4

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const controller = new AbortController();
		// Reverse order visits y (other, no log), then a's 2nd action (target, logs) — abort there.
		const { stats, remainingRun } = await undoRunForNote(vault, run, "a.md", () => controller.abort(), controller.signal);

		expect(stats).toEqual({ reverted: 1, skipped: 0 });
		expect(vault.contentOf("x.md")).toBe("x-synced");
		expect(vault.contentOf("y.md")).toBe("y-synced");
		expect(remainingRun.actions.map((a) => a.path)).toEqual(["x.md", "a.md", "y.md"]);
	});
});
