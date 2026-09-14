import { describe, expect, test } from "vitest";
import {
	appendSyncRun,
	describeSyncAction,
	fingerprint,
	lastRun,
	planActionUndo,
	planTrelloUndo,
	replaceRunAt,
	type SyncAction,
	type SyncRun,
} from "../src/core/syncHistory";

describe("fingerprint", () => {
	test("is stable for the same content", () => {
		expect(fingerprint("hello")).toBe(fingerprint("hello"));
	});

	test("differs for different content", () => {
		expect(fingerprint("hello")).not.toBe(fingerprint("hello!"));
	});
});

describe("appendSyncRun", () => {
	const run = (scope: string): SyncRun => ({ timestamp: "2026-09-12T00:00:00.000Z", scope, actions: [] });

	test("keeps every run under the cap", () => {
		const runs = appendSyncRun([run("a")], run("b"), 5);
		expect(runs.map((r) => r.scope)).toEqual(["a", "b"]);
	});

	test("drops the oldest run once maxRuns is exceeded", () => {
		let runs: SyncRun[] = [];
		for (const scope of ["a", "b", "c"]) runs = appendSyncRun(runs, run(scope), 2);
		expect(runs.map((r) => r.scope)).toEqual(["b", "c"]);
	});
});

describe("lastRun", () => {
	test("returns the most recently appended run", () => {
		expect(lastRun([{ timestamp: "t", scope: "a", actions: [] }, { timestamp: "t", scope: "b", actions: [] }])?.scope).toBe(
			"b",
		);
	});

	test("returns undefined for an empty history", () => {
		expect(lastRun([])).toBeUndefined();
	});
});

describe("replaceRunAt", () => {
	const action = (path: string): SyncAction => ({ kind: "create", path, fingerprint: "x" });
	const run = (scope: string, actions: SyncAction[] = [action("a.md")]): SyncRun => ({
		timestamp: "t",
		scope,
		actions,
	});

	test("replaces the run at the given index, leaving the others in place", () => {
		const runs = [run("a"), run("b"), run("c")];
		const replaced = run("b", [action("x.md")]);
		expect(replaceRunAt(runs, 1, replaced)).toEqual([run("a"), replaced, run("c")]);
	});

	test("drops the run entirely when it has no actions left", () => {
		const runs = [run("a"), run("b"), run("c")];
		expect(replaceRunAt(runs, 1, run("b", []))).toEqual([run("a"), run("c")]);
	});

	test("does not mutate the input array", () => {
		const runs = [run("a"), run("b")];
		const copy = [...runs];
		replaceRunAt(runs, 0, run("a", []));
		expect(runs).toEqual(copy);
	});
});

describe("describeSyncAction", () => {
	test("body: kind and path, no content", () => {
		expect(describeSyncAction({ kind: "body", path: "a.md", fingerprint: "x", previousContent: "secret" })).toBe(
			"Body — a.md",
		);
	});

	test("frontmatter: kind and path", () => {
		expect(
			describeSyncAction({ kind: "frontmatter", path: "a.md", fingerprint: "x", previousContent: "secret" }),
		).toBe("Frontmatter — a.md");
	});

	test("create: kind and path", () => {
		expect(describeSyncAction({ kind: "create", path: "a.md", fingerprint: "x" })).toBe("Created — a.md");
	});

	test("rename: shows both paths", () => {
		expect(describeSyncAction({ kind: "rename", path: "b.md", previousPath: "a.md", fingerprint: "x" })).toBe(
			"Renamed — a.md → b.md",
		);
	});

	test("trash: kind and path", () => {
		expect(describeSyncAction({ kind: "trash", path: "a.md", fingerprint: null, previousContent: "secret" })).toBe(
			"Trashed — a.md",
		);
	});

	test("trello-card: kind, path and card id, no field values", () => {
		expect(
			describeSyncAction({
				kind: "trello-card",
				path: "a.md",
				cardId: "c1",
				previous: { name: "Old" },
				written: { name: "New" },
			}),
		).toBe("Trello card update — a.md (card c1)");
	});

	test("trello-checkitem: kind, path and card id, no state values", () => {
		expect(
			describeSyncAction({
				kind: "trello-checkitem",
				path: "a.md",
				cardId: "c1",
				checkItemId: "i1",
				previousState: "incomplete",
				writtenState: "complete",
			}),
		).toBe("Trello checklist item — a.md (card c1)");
	});
});

describe("planActionUndo", () => {
	test("body: reverts when the note is unchanged since the run", () => {
		const plan = planActionUndo(
			{ kind: "body", path: "n.md", previousContent: "old", fingerprint: fingerprint("new") },
			{ exists: true, content: "new" },
		);
		expect(plan).toEqual({ op: "write", path: "n.md", content: "old" });
	});

	test("body: skips when the note changed since the run", () => {
		const plan = planActionUndo(
			{ kind: "body", path: "n.md", previousContent: "old", fingerprint: fingerprint("new") },
			{ exists: true, content: "edited-by-user" },
		);
		expect(plan).toEqual({ op: "skip", reason: "changed since the run" });
	});

	test("body: skips when the note no longer exists", () => {
		const plan = planActionUndo(
			{ kind: "body", path: "n.md", previousContent: "old", fingerprint: fingerprint("new") },
			{ exists: false, content: null },
		);
		expect(plan).toEqual({ op: "skip", reason: "note no longer exists" });
	});

	test("frontmatter: same rules as body", () => {
		const plan = planActionUndo(
			{ kind: "frontmatter", path: "n.md", previousContent: "old-fm", fingerprint: fingerprint("new-fm") },
			{ exists: true, content: "new-fm" },
		);
		expect(plan).toEqual({ op: "write", path: "n.md", content: "old-fm" });
	});

	test("create: undoes by trashing when untouched since creation", () => {
		const plan = planActionUndo(
			{ kind: "create", path: "n.md", fingerprint: fingerprint("initial") },
			{ exists: true, content: "initial" },
		);
		expect(plan).toEqual({ op: "trash", path: "n.md" });
	});

	test("create: skips (never deletes) when the note changed since creation", () => {
		const plan = planActionUndo(
			{ kind: "create", path: "n.md", fingerprint: fingerprint("initial") },
			{ exists: true, content: "edited" },
		);
		expect(plan).toEqual({ op: "skip", reason: "changed since the run" });
	});

	test("rename: renames back when untouched since the run", () => {
		const plan = planActionUndo(
			{ kind: "rename", path: "b.md", previousPath: "a.md", fingerprint: fingerprint("body") },
			{ exists: true, content: "body" },
		);
		expect(plan).toEqual({ op: "rename", from: "b.md", to: "a.md" });
	});

	test("trash: recreates when nothing occupies the path", () => {
		const plan = planActionUndo(
			{ kind: "trash", path: "n.md", previousContent: "gone", fingerprint: null },
			{ exists: false, content: null },
		);
		expect(plan).toEqual({ op: "create", path: "n.md", content: "gone" });
	});

	test("trash: skips instead of overwriting a note that now occupies the path", () => {
		const plan = planActionUndo(
			{ kind: "trash", path: "n.md", previousContent: "gone", fingerprint: null },
			{ exists: true, content: "something-new" },
		);
		expect(plan).toEqual({ op: "skip", reason: "a note already exists at that path" });
	});
});

describe("planTrelloUndo", () => {
	test("trello-card: reverts every field when nothing changed remotely since the run", () => {
		const plan = planTrelloUndo(
			{
				kind: "trello-card",
				path: "n.md",
				cardId: "c1",
				previous: { name: "Old name", desc: "Old desc" },
				written: { name: "New name", desc: "New desc" },
			},
			{ kind: "card", fields: { name: "New name", desc: "New desc" } },
		);
		expect(plan).toEqual({ op: "update-card", cardId: "c1", fields: { name: "Old name", desc: "Old desc" } });
	});

	test("trello-card: reverts only the fields still equal to what the run wrote", () => {
		const plan = planTrelloUndo(
			{
				kind: "trello-card",
				path: "n.md",
				cardId: "c1",
				previous: { name: "Old name", desc: "Old desc" },
				written: { name: "New name", desc: "New desc" },
			},
			{ kind: "card", fields: { name: "New name", desc: "Someone else's desc" } },
		);
		expect(plan).toEqual({ op: "update-card", cardId: "c1", fields: { name: "Old name" } });
	});

	test("trello-card: skips when every written field changed remotely since the run", () => {
		const plan = planTrelloUndo(
			{
				kind: "trello-card",
				path: "n.md",
				cardId: "c1",
				previous: { name: "Old name" },
				written: { name: "New name" },
			},
			{ kind: "card", fields: { name: "Someone else's name" } },
		);
		expect(plan).toEqual({ op: "skip", reason: "changed since the run" });
	});

	test("trello-card: skips when the card no longer exists", () => {
		const plan = planTrelloUndo(
			{
				kind: "trello-card",
				path: "n.md",
				cardId: "c1",
				previous: { name: "Old name" },
				written: { name: "New name" },
			},
			null,
		);
		expect(plan).toEqual({ op: "skip", reason: "card no longer exists" });
	});

	test("trello-card: skips as a no-op when previous equals written for every surviving field", () => {
		const plan = planTrelloUndo(
			{
				kind: "trello-card",
				path: "n.md",
				cardId: "c1",
				previous: { name: "Same name", due: null },
				written: { name: "Same name", due: null },
			},
			{ kind: "card", fields: { name: "Same name", due: null } },
		);
		expect(plan).toEqual({ op: "skip", reason: "nothing to revert" });
	});

	test("trello-card: compares idLabels by ordered array equality", () => {
		const plan = planTrelloUndo(
			{
				kind: "trello-card",
				path: "n.md",
				cardId: "c1",
				previous: { idLabels: ["a", "b"] },
				written: { idLabels: ["b", "a"] },
			},
			{ kind: "card", fields: { idLabels: ["a", "b"] } },
		);
		expect(plan).toEqual({ op: "skip", reason: "changed since the run" });
	});

	test("trello-checkitem: reverts when the state is unchanged since the run", () => {
		const plan = planTrelloUndo(
			{
				kind: "trello-checkitem",
				path: "n.md",
				cardId: "c1",
				checkItemId: "ci1",
				previousState: "incomplete",
				writtenState: "complete",
			},
			{ kind: "checkitem", state: "complete" },
		);
		expect(plan).toEqual({ op: "set-check-item", cardId: "c1", checkItemId: "ci1", state: "incomplete" });
	});

	test("trello-checkitem: skips when re-toggled by someone else since the run", () => {
		const plan = planTrelloUndo(
			{
				kind: "trello-checkitem",
				path: "n.md",
				cardId: "c1",
				checkItemId: "ci1",
				previousState: "incomplete",
				writtenState: "complete",
			},
			{ kind: "checkitem", state: "incomplete" },
		);
		expect(plan).toEqual({ op: "skip", reason: "changed since the run" });
	});

	test("trello-checkitem: skips when the card no longer exists", () => {
		const plan = planTrelloUndo(
			{
				kind: "trello-checkitem",
				path: "n.md",
				cardId: "c1",
				checkItemId: "ci1",
				previousState: "incomplete",
				writtenState: "complete",
			},
			null,
		);
		expect(plan).toEqual({ op: "skip", reason: "card no longer exists" });
	});
});
