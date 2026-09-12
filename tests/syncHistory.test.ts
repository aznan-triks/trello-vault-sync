import { describe, expect, test } from "vitest";
import {
	appendSyncRun,
	fingerprint,
	lastRun,
	planActionUndo,
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
