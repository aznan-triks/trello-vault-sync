import { describe, expect, test } from "vitest";
import { resolveLabelSync } from "../src/core/labelMerge";

describe("resolveLabelSync — merge mode", () => {
	test("adds a remote label missing from local, keeping local entries", () => {
		const { nextLocal, nextRemote } = resolveLabelSync(["Perso"], ["Bug", "Idée"], "merge", "pull");
		expect(nextLocal).toEqual(["Bug", "Idée", "Perso"]);
		expect(nextRemote).toEqual(["Bug", "Idée", "Perso"]);
	});

	test("is independent of direction — pull and push give the same union", () => {
		const pull = resolveLabelSync(["Perso"], ["Bug"], "merge", "pull");
		const push = resolveLabelSync(["Perso"], ["Bug"], "merge", "push");
		expect(pull).toEqual(push);
	});

	test("reports nothing to write on either side when both already hold the union", () => {
		const { nextLocal, nextRemote } = resolveLabelSync(["Bug", "Idée"], ["idée", "bug"], "merge", "pull");
		expect(nextLocal).toBeNull();
		expect(nextRemote).toBeNull();
	});

	test("never drops a local-only name, even one absent from the board's remote labels", () => {
		const { nextLocal } = resolveLabelSync(["Zzz"], ["Bug"], "merge", "push");
		expect(nextLocal).toEqual(["Bug", "Zzz"]);
	});

	test("both sides empty stays a no-op", () => {
		const { nextLocal, nextRemote } = resolveLabelSync([], [], "merge", "pull");
		expect(nextLocal).toBeNull();
		expect(nextRemote).toBeNull();
	});
});

describe("resolveLabelSync — overwrite mode", () => {
	test("pull: remote replaces local entirely, remote itself untouched", () => {
		const { nextLocal, nextRemote } = resolveLabelSync(["Old"], ["Bug", "Idée"], "overwrite", "pull");
		expect(nextLocal).toEqual(["Bug", "Idée"]);
		expect(nextRemote).toBeNull();
	});

	test("push: local replaces remote entirely, local itself untouched", () => {
		const { nextLocal, nextRemote } = resolveLabelSync(["Bug", "Idée"], ["Old"], "overwrite", "push");
		expect(nextRemote).toEqual(["Bug", "Idée"]);
		expect(nextLocal).toBeNull();
	});

	test("push with an empty local list clears the remote side", () => {
		const { nextRemote } = resolveLabelSync([], ["Bug"], "overwrite", "push");
		expect(nextRemote).toEqual([]);
	});

	test("reports nothing to write when the winning side already matches", () => {
		const { nextLocal } = resolveLabelSync(["Bug"], ["bug"], "overwrite", "pull");
		expect(nextLocal).toBeNull();
	});
});
