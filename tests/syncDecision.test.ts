import { describe, expect, test } from "vitest";
import { decideSync, type SyncInput } from "../src/core/syncDecision";

const base: SyncInput = {
	localTitle: "Sagondo",
	localBody: "same text",
	localMtime: 1_000_000,
	remoteTitle: "Sagondo",
	remoteBody: "same text",
	remoteMtime: 1_000_000,
	policy: "newer-wins",
	marginMs: 60_000,
};

describe("decideSync", () => {
	test("skips when body and title already agree", () => {
		expect(decideSync(base)).toEqual({
			direction: "skip",
			bodyChanged: false,
			titleChanged: false,
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
});
