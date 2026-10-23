import { describe, expect, test } from "vitest";
import { baseFromState, bodyKey, decideWithBase, dueKey, type SyncBase } from "../src/core/syncBase";
import { decideSync, type SyncInput } from "../src/core/syncDecision";

const T = 10_000_000;
const same: SyncInput = {
	localTitle: "Busy",
	localBody: "text",
	localMtime: T,
	localDue: null,
	remoteTitle: "Busy",
	remoteBody: "text",
	remoteMtime: T,
	remoteDue: null,
	policy: "newer-wins",
	marginMs: 60_000,
};
const base: SyncBase = { title: "Busy", body: bodyKey("text"), due: null, at: 0 };
/** Clocks that would say "the card is newer" / "the note is newer" — to prove they do not matter. */
const cardNewer = { remoteMtime: T + 3_600_000 };
const noteNewer = { localMtime: T + 3_600_000 };

describe("decideWithBase — one side changed", () => {
	test("a body edited only in the note is pushed even when the card shows more recent activity (F2a)", () => {
		const d = decideWithBase({ ...same, localBody: "edited", ...cardNewer }, base);
		expect(d.direction).toBe("push");
		expect(d.fields).toEqual({ title: "none", body: "push", due: "none", labels: "none" });
		expect(d.reason).toBe("local-changed");
	});

	test("a body edited only on the card is pulled even when the note is the more recently written (F2a, mirrored)", () => {
		const d = decideWithBase({ ...same, remoteBody: "edited", ...noteNewer }, base);
		expect(d.direction).toBe("pull");
		expect(d.fields.body).toBe("pull");
	});

	test("disjoint changes merge: body goes out, due date comes in (F2b)", () => {
		const d = decideWithBase({ ...same, localBody: "edited", remoteDue: "2026-11-01T00:00:00.000Z", ...cardNewer }, base);
		expect(d.direction).toBe("merge");
		expect(d.fields).toEqual({ title: "none", body: "push", due: "pull", labels: "none" });
		expect(d.reason).toBe("both-changed");
	});

	test("a title renamed on the card is pulled while the body edited in the note is pushed", () => {
		const d = decideWithBase({ ...same, remoteTitle: "Renamed", localBody: "edited" }, base);
		expect(d.fields).toMatchObject({ title: "pull", body: "push" });
	});

	test("a ' (2)' collision suffix on the note is not a local rename", () => {
		const d = decideWithBase({ ...same, localTitle: "Busy (2)", remoteBody: "edited" }, base);
		expect(d.fields).toMatchObject({ title: "none", body: "pull" });
	});

	test("a due date spelled differently is the same instant", () => {
		const withDue = { ...base, due: dueKey("2026-11-01T00:00:00Z") };
		const d = decideWithBase({ ...same, localDue: "2026-11-01T00:00:00Z", remoteDue: "2026-11-01T00:00:00.000Z" }, withDue);
		expect(d.direction).toBe("skip");
	});

	test("identical pair stays a skip", () => {
		expect(decideWithBase(same, base).direction).toBe("skip");
	});
});

describe("decideWithBase — both sides changed", () => {
	test("changed to the same value: nothing to do", () => {
		const d = decideWithBase({ ...same, localBody: "new", remoteBody: "new" }, base);
		expect(d.direction).toBe("skip");
		expect(d.fields.body).toBe("none");
	});

	test("changed differently, newer-wins: the clocks settle that field", () => {
		const pull = decideWithBase({ ...same, localBody: "mine", remoteBody: "theirs", ...cardNewer }, base);
		expect(pull).toMatchObject({ direction: "pull", reason: "remote-newer", fields: { body: "pull" } });
		const push = decideWithBase({ ...same, localBody: "mine", remoteBody: "theirs", ...noteNewer }, base);
		expect(push).toMatchObject({ direction: "push", reason: "local-newer", fields: { body: "push" } });
	});

	test("changed differently within the margin: a conflict of the whole pair, nothing assigned", () => {
		const d = decideWithBase({ ...same, localBody: "mine", remoteBody: "theirs", remoteDue: "2026-11-01T00:00:00Z", localMtime: T, remoteMtime: T + 10_000 }, base);
		expect(d.direction).toBe("conflict");
		expect(d.reason).toBe("within-margin");
		expect(d.fields).toEqual({ title: "none", body: "none", due: "none", labels: "none" });
	});

	test("prefer-local / prefer-remote settle the conflicting field", () => {
		const input = { ...same, localBody: "mine", remoteBody: "theirs" };
		expect(decideWithBase({ ...input, policy: "prefer-local" }, base)).toMatchObject({ direction: "push", reason: "policy" });
		expect(decideWithBase({ ...input, policy: "prefer-remote" }, base)).toMatchObject({ direction: "pull", reason: "policy" });
	});

	test("a one-sided field still travels beside a field the policy settled", () => {
		const d = decideWithBase({ ...same, localBody: "mine", remoteBody: "theirs", remoteDue: "2026-11-01T00:00:00Z", policy: "prefer-local" }, base);
		expect(d.direction).toBe("merge");
		expect(d.fields).toMatchObject({ body: "push", due: "pull" });
	});
});

describe("decideWithBase — fallbacks", () => {
	const cases: Array<[string, Partial<SyncInput>]> = [
		["identical", {}],
		["body edited locally, card newer", { localBody: "x", ...cardNewer }],
		["body edited on the card, note newer", { remoteBody: "x", ...noteNewer }],
		["both bodies changed within the margin", { localBody: "a", remoteBody: "b", remoteMtime: T + 1_000 }],
		["due date differs", { remoteDue: "2026-11-01T00:00:00Z", ...noteNewer }],
		["title differs, prefer-remote", { remoteTitle: "Other", policy: "prefer-remote" }],
		["only a checklist differs", { checklistsChanged: true, ...cardNewer }],
		["labels differ in overwrite mode", { labelsSyncMode: "overwrite", localLabels: ["a"], remoteLabels: ["b"], ...noteNewer }],
	];

	test.each(cases)("no base: same answer as decideSync — %s", (_name, patch) => {
		const input = { ...same, ...patch };
		expect(decideWithBase(input, undefined)).toEqual(decideSync(input));
	});

	test("a base that does not know a synced field falls back to decideSync", () => {
		const input = { ...same, localBody: "edited", ...cardNewer };
		expect(decideWithBase(input, { at: 0 })).toEqual(decideSync(input));
		expect(decideWithBase(input, { title: "Busy", due: null, at: 0 })).toEqual(decideSync(input));
	});

	test("a field the sync does not cover does not need a base value", () => {
		const input = { ...same, syncTitle: false, syncDue: false, localBody: "edited", ...cardNewer };
		expect(decideWithBase(input, { body: bodyKey("text"), at: 0 }).direction).toBe("push");
	});

	test("only a checklist differs: the clock-based direction of decideSync is kept", () => {
		const input = { ...same, checklistsChanged: true, ...cardNewer };
		expect(decideWithBase(input, base)).toEqual(decideSync(input));
	});

	test("labels in overwrite mode stay on the clocks, beside a one-sided body", () => {
		const input = { ...same, labelsSyncMode: "overwrite" as const, localLabels: ["a"], remoteLabels: ["b"], remoteBody: "edited", ...noteNewer };
		const d = decideWithBase(input, base);
		expect(d.fields).toMatchObject({ body: "pull", labels: "push" });
		expect(d.direction).toBe("merge");
	});
});

describe("baseFromState", () => {
	const state = { localTitle: "Busy", remoteTitle: "Busy", localBody: "text\r\n", remoteBody: "text", localDue: null, remoteDue: null };

	test("records every field both sides agree on, with the body as a fingerprint and the due date as an instant", () => {
		const recorded = baseFromState({ ...state, localDue: "2026-11-01T00:00:00Z", remoteDue: "2026-11-01T00:00:00.000Z", checkItems: { i1: true } }, 42);
		expect(recorded).toEqual({ title: "Busy", body: bodyKey("text"), due: Date.parse("2026-11-01T00:00:00Z"), checkItems: { i1: true }, at: 42 });
		expect(recorded.body).toMatch(/^[0-9a-f]{8}:4$/);
	});

	test("leaves out a field the sides still disagree on, and one the sync does not cover", () => {
		const recorded = baseFromState({ ...state, remoteBody: "other", syncDue: false }, 1);
		expect(recorded).toEqual({ title: "Busy", at: 1 });
	});

	test("a ' (2)' note title still counts as the card's title", () => {
		expect(baseFromState({ ...state, localTitle: "Busy (2)" }, 1).title).toBe("Busy");
	});

	test("the title is recorded in its file-name form", () => {
		expect(baseFromState({ ...state, localTitle: "a-b", remoteTitle: "a/b" }, 1).title).toBe("a-b");
	});

	test("round trip: a recorded pair is a skip until one side moves", () => {
		const recorded = baseFromState({ ...state, localBody: "text" }, 1);
		expect(decideWithBase({ ...same }, recorded).direction).toBe("skip");
		expect(decideWithBase({ ...same, localBody: "more" }, recorded).direction).toBe("push");
	});
});
