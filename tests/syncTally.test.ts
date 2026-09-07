import { describe, expect, test, vi } from "vitest";
import { addCounts, describeSyncOutcome, tallyNoteResult, type NoteTallyStats } from "../src/core/syncTally";

function emptyStats(): NoteTallyStats {
	return { pulled: 0, pushed: 0, skipped: 0, renamed: 0, conflicts: 0 };
}

describe("tallyNoteResult", () => {
	test("counts a pull and logs it", () => {
		const stats = emptyStats();
		const log = vi.fn();
		tallyNoteResult(stats, { renamed: false, direction: "pull" }, log, "Sagondo");
		expect(stats.pulled).toBe(1);
		expect(log).toHaveBeenCalledWith("pull", "Sagondo");
	});

	test("counts a push and logs it", () => {
		const stats = emptyStats();
		const log = vi.fn();
		tallyNoteResult(stats, { renamed: false, direction: "push" }, log, "Sagondo");
		expect(stats.pushed).toBe(1);
		expect(log).toHaveBeenCalledWith("push", "Sagondo");
	});

	test("counts a conflict and logs a warning", () => {
		const stats = emptyStats();
		const log = vi.fn();
		tallyNoteResult(stats, { renamed: false, direction: "conflict" }, log, "Sagondo");
		expect(stats.conflicts).toBe(1);
		expect(log).toHaveBeenCalledWith("warn", "Conflict: Sagondo");
	});

	test("counts a skip silently", () => {
		const stats = emptyStats();
		const log = vi.fn();
		tallyNoteResult(stats, { renamed: false, direction: "skip" }, log, "Sagondo");
		expect(stats.skipped).toBe(1);
		expect(log).not.toHaveBeenCalled();
	});

	test("counts a rename alongside whatever direction it came with", () => {
		const stats = emptyStats();
		tallyNoteResult(stats, { renamed: true, direction: "pull" }, vi.fn(), "Sagondo");
		expect(stats.renamed).toBe(1);
		expect(stats.pulled).toBe(1);
	});

	test("an unlinked result touches no counter", () => {
		const stats = emptyStats();
		const log = vi.fn();
		tallyNoteResult(stats, { renamed: false, direction: "unlinked" }, log, "Sagondo");
		expect(stats).toEqual(emptyStats());
		expect(log).not.toHaveBeenCalled();
	});
});

describe("describeSyncOutcome", () => {
	test("reports 'Already up to date.' for a skip", () => {
		expect(describeSyncOutcome({ renamed: false, direction: "skip" })).toBe("Already up to date.");
	});

	test("reports a pull, with rename called out", () => {
		expect(describeSyncOutcome({ renamed: false, direction: "pull" })).toBe("Pulled from Trello.");
		expect(describeSyncOutcome({ renamed: true, direction: "pull" })).toBe("Pulled from Trello and renamed.");
	});

	test("reports a push", () => {
		expect(describeSyncOutcome({ renamed: false, direction: "push" })).toBe("Pushed to Trello.");
	});

	test("reports a conflict", () => {
		expect(describeSyncOutcome({ renamed: false, direction: "conflict" })).toBe(
			"Conflict: note and card changed at the same time, nothing was written.",
		);
	});

	test("reports unlinked", () => {
		expect(describeSyncOutcome({ renamed: false, direction: "unlinked" })).toBe(
			'Note not linked — use "Link active note to a card".',
		);
	});
});

describe("addCounts", () => {
	test("sums matching fields in place and returns the target", () => {
		const target = { a: 1, b: 2 };
		const result = addCounts(target, { a: 10, b: 20 });
		expect(target).toEqual({ a: 11, b: 22 });
		expect(result).toBe(target);
	});
});
