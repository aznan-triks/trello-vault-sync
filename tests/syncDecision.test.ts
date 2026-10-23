import { describe, expect, test } from "vitest";
import { decideSync, type SyncInput } from "../src/core/syncDecision";

const base: SyncInput = {
	localTitle: "Sagondo",
	localBody: "same text",
	localMtime: 1_000_000,
	localDue: null,
	remoteTitle: "Sagondo",
	remoteBody: "same text",
	remoteMtime: 1_000_000,
	remoteDue: null,
	policy: "newer-wins",
	marginMs: 60_000,
};

describe("decideSync", () => {
	test("skips when body and title already agree", () => {
		expect(decideSync(base)).toEqual({
			direction: "skip",
			bodyChanged: false,
			titleChanged: false,
			dueChanged: false,
			labelsChanged: false,
			reason: "identical",
		});
	});

	test("ignores CRLF and trailing spaces when comparing bodies", () => {
		const decision = decideSync({ ...base, localBody: "same text  \r\n", remoteMtime: 9_000_000 });
		expect(decision.direction).toBe("skip");
	});

	test("pulls when the card changed well after the note", () => {
		const decision = decideSync({ ...base, remoteBody: "new text", remoteMtime: 2_000_000 });
		expect(decision).toEqual({
			direction: "pull",
			bodyChanged: true,
			titleChanged: false,
			dueChanged: false,
			labelsChanged: false,
			reason: "remote-newer",
		});
	});

	test("pushes when the note changed well after the card", () => {
		const decision = decideSync({ ...base, localBody: "new text", localMtime: 2_000_000 });
		expect(decision.direction).toBe("push");
		expect(decision.reason).toBe("local-newer");
	});

	test("reports a title-only difference without touching the body", () => {
		const decision = decideSync({ ...base, localTitle: "Sagondo v2", localMtime: 2_000_000 });
		expect(decision).toEqual({
			direction: "push",
			bodyChanged: false,
			titleChanged: true,
			dueChanged: false,
			labelsChanged: false,
			reason: "local-newer",
		});
	});

	test("flags a conflict when both sides changed inside the clock margin", () => {
		const decision = decideSync({
			...base,
			localBody: "mine",
			remoteBody: "theirs",
			remoteMtime: 1_030_000,
		});
		expect(decision.direction).toBe("conflict");
		expect(decision.reason).toBe("within-margin");
	});

	test("never conflicts when the margin is zero", () => {
		const decision = decideSync({
			...base,
			localBody: "mine",
			remoteBody: "theirs",
			remoteMtime: 1_000_001,
			marginMs: 0,
		});
		expect(decision.direction).toBe("pull");
	});

	test("forces a push under the prefer-local policy even if the card is newer", () => {
		const decision = decideSync({
			...base,
			policy: "prefer-local",
			remoteBody: "theirs",
			remoteMtime: 9_000_000,
		});
		expect(decision).toMatchObject({ direction: "push", reason: "policy" });
	});

	test("forces a pull under the prefer-remote policy even if the note is newer", () => {
		const decision = decideSync({
			...base,
			policy: "prefer-remote",
			localBody: "mine",
			localMtime: 9_000_000,
		});
		expect(decision).toMatchObject({ direction: "pull", reason: "policy" });
	});

	test("still skips identical content under a forcing policy", () => {
		expect(decideSync({ ...base, policy: "prefer-local" }).direction).toBe("skip");
	});

	test("flags a conflict on an exact timestamp tie even when the margin is zero", () => {
		const decision = decideSync({
			...base,
			localBody: "mine",
			remoteBody: "theirs",
			marginMs: 0,
		});
		expect(decision.direction).toBe("conflict");
		expect(decision.reason).toBe("within-margin");
	});

	test("compares titles against the sanitized form of the card title, not the raw one", () => {
		const decision = decideSync({
			...base,
			localTitle: "Idea- split front-back",
			remoteTitle: "Idea: split front/back",
			localMtime: 2_000_000,
		});
		expect(decision.titleChanged).toBe(false);
		expect(decision.direction).toBe("skip");
	});

	test("still detects a genuine title edit after sanitizing the card title", () => {
		const decision = decideSync({
			...base,
			localTitle: "Old title",
			remoteTitle: "New: title",
			remoteMtime: 2_000_000,
		});
		expect(decision.titleChanged).toBe(true);
		expect(decision.direction).toBe("pull");
	});

	test("pulls on a due-date-only change when the card is newer", () => {
		const decision = decideSync({
			...base,
			remoteDue: "2026-09-10T12:00:00.000Z",
			remoteMtime: 2_000_000,
		});
		expect(decision.dueChanged).toBe(true);
		expect(decision.direction).toBe("pull");
	});

	test("pushes on a due-date-only change when the note is newer", () => {
		const decision = decideSync({
			...base,
			localDue: "2026-09-10T12:00:00.000Z",
			localMtime: 2_000_000,
		});
		expect(decision.dueChanged).toBe(true);
		expect(decision.direction).toBe("push");
	});

	test("skips when the due date, body and title all still agree", () => {
		const decision = decideSync({ ...base, localDue: "2026-09-10T12:00:00.000Z", remoteDue: "2026-09-10T12:00:00.000Z" });
		expect(decision.dueChanged).toBe(false);
		expect(decision.direction).toBe("skip");
	});

	test("treats an empty string and an absent due date as equivalent", () => {
		const decision = decideSync({ ...base, localDue: "", remoteDue: null });
		expect(decision.dueChanged).toBe(false);
		expect(decision.direction).toBe("skip");
	});

	test("flags a conflict when only the due date changed on both sides within the margin", () => {
		const decision = decideSync({
			...base,
			localDue: "mine",
			remoteDue: "theirs",
			remoteMtime: 1_030_000,
		});
		expect(decision.dueChanged).toBe(true);
		expect(decision.direction).toBe("conflict");
		expect(decision.reason).toBe("within-margin");
	});

	test("ignores a label divergence entirely in the default (merge) mode", () => {
		const decision = decideSync({
			...base,
			localLabels: ["Bug"],
			remoteLabels: ["Idée"],
		});
		expect(decision.labelsChanged).toBe(false);
		expect(decision.direction).toBe("skip");
	});

	test("ignores a label divergence in explicit merge mode even under a forcing policy", () => {
		const decision = decideSync({
			...base,
			localLabels: ["Bug"],
			remoteLabels: ["Idée"],
			labelsSyncMode: "merge",
			policy: "prefer-local",
		});
		expect(decision.labelsChanged).toBe(false);
		expect(decision.direction).toBe("skip");
	});

	test("pulls on a label-only change in overwrite mode when the card is newer", () => {
		const decision = decideSync({
			...base,
			localLabels: ["Bug"],
			remoteLabels: ["Idée"],
			labelsSyncMode: "overwrite",
			remoteMtime: 2_000_000,
		});
		expect(decision.labelsChanged).toBe(true);
		expect(decision.direction).toBe("pull");
	});

	test("pushes on a label-only change in overwrite mode when the note is newer", () => {
		const decision = decideSync({
			...base,
			localLabels: ["Bug"],
			remoteLabels: ["Idée"],
			labelsSyncMode: "overwrite",
			localMtime: 2_000_000,
		});
		expect(decision.labelsChanged).toBe(true);
		expect(decision.direction).toBe("push");
	});

	test("treats a case/order-only label difference as unchanged even in overwrite mode", () => {
		const decision = decideSync({
			...base,
			localLabels: ["Bug", "Idée"],
			remoteLabels: ["idée", "bug"],
			labelsSyncMode: "overwrite",
		});
		expect(decision.labelsChanged).toBe(false);
		expect(decision.direction).toBe("skip");
	});

	test("ignores body differences when syncDescription is false", () => {
		const decision = decideSync({
			...base,
			localBody: "local modified",
			remoteBody: "remote text",
			remoteMtime: 2_000_000,
			syncDescription: false,
		});
		expect(decision.bodyChanged).toBe(false);
		expect(decision.direction).toBe("skip");
	});

	test("ignores due date differences when syncDue is false", () => {
		const decision = decideSync({
			...base,
			localDue: "2026-09-01",
			remoteDue: "2026-09-15",
			remoteMtime: 2_000_000,
			syncDue: false,
		});
		expect(decision.dueChanged).toBe(false);
		expect(decision.direction).toBe("skip");
	});

	test("ignores label differences in overwrite mode when syncLabels is false", () => {
		const decision = decideSync({
			...base,
			localLabels: ["Bug"],
			remoteLabels: ["Idea"],
			labelsSyncMode: "overwrite",
			remoteMtime: 2_000_000,
			syncLabels: false,
		});
		expect(decision.labelsChanged).toBe(false);
		expect(decision.direction).toBe("skip");
	});
});

describe("decideSync — checklists", () => {
	test("a checklist-only change is not identical: the newer side wins", () => {
		expect(decideSync({ ...base, checklistsChanged: true, remoteMtime: 2_000_000 }).direction).toBe("pull");
		expect(decideSync({ ...base, checklistsChanged: true, localMtime: 2_000_000 }).direction).toBe("push");
	});

	test("a checklist-only change within the margin is a conflict", () => {
		expect(decideSync({ ...base, checklistsChanged: true, remoteMtime: 1_000_500 }).direction).toBe("conflict");
	});

	test("an unchanged checklist keeps the fiche identical", () => {
		expect(decideSync({ ...base, checklistsChanged: false }).direction).toBe("skip");
	});
});

describe("decideSync — spellings that are not changes", () => {
	test("F11: the same due instant in two ISO spellings is not a change", () => {
		const d = decideSync({ ...base, localDue: "2026-10-23T12:00:00Z", remoteDue: "2026-10-23T12:00:00.000Z", localMtime: 2_000_000 });
		expect(d.dueChanged).toBe(false);
		expect(d.direction).toBe("skip");
	});

	test("F11: a different instant is still a change, and so is a due that cannot be parsed", () => {
		expect(decideSync({ ...base, localDue: "2026-10-23T12:00:00Z", remoteDue: "2026-10-23T13:00:00.000Z" }).dueChanged).toBe(true);
		expect(decideSync({ ...base, localDue: "tomorrow", remoteDue: "2026-10-23T12:00:00.000Z" }).dueChanged).toBe(true);
		expect(decideSync({ ...base, localDue: null, remoteDue: "2026-10-23T12:00:00.000Z" }).dueChanged).toBe(true);
	});

	test("F9: the collision suffix added to a note name is not a title change", () => {
		expect(decideSync({ ...base, localTitle: "Busy (2)", remoteTitle: "Busy" }).titleChanged).toBe(false);
		expect(decideSync({ ...base, localTitle: "Busy (12)", remoteTitle: "Busy" }).titleChanged).toBe(false);
	});

	test("F9: only a numeric suffix from 2 on, on the same base, counts as a collision", () => {
		for (const localTitle of ["Busy (1)", "Busy (x)", "Busy (2) b", "Other (2)", "Busy(2)"]) {
			expect(decideSync({ ...base, localTitle, remoteTitle: "Busy" }).titleChanged, localTitle).toBe(true);
		}
	});
});
