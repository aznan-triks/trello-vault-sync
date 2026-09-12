import { describe, expect, test } from "vitest";
import {
	DEFAULT_MEMBERS_KEY,
	DEFAULT_SYNC_MEMBERS,
	formatMembersRef,
	parseMembersRef,
	resolveMemberNames,
} from "../src/core/memberRef";

describe("DEFAULT_MEMBERS_KEY", () => {
	test("is trello_members", () => {
		expect(DEFAULT_MEMBERS_KEY).toBe("trello_members");
	});
});

describe("DEFAULT_SYNC_MEMBERS", () => {
	test("is on by default", () => {
		expect(DEFAULT_SYNC_MEMBERS).toBe(true);
	});
});

describe("parseMembersRef", () => {
	test("keeps a well-formed string array as is", () => {
		expect(parseMembersRef(["Alice", "Bob"])).toEqual(["Alice", "Bob"]);
	});

	test("drops non-string entries and trims/removes blanks", () => {
		expect(parseMembersRef(["Alice", 42, "  ", " Bob "])).toEqual(["Alice", "Bob"]);
	});

	test("defaults to an empty list for anything but an array", () => {
		expect(parseMembersRef(undefined)).toEqual([]);
		expect(parseMembersRef("Alice")).toEqual([]);
	});
});

describe("formatMembersRef", () => {
	test("returns the list as is when non-empty", () => {
		expect(formatMembersRef(["Alice"])).toEqual(["Alice"]);
	});

	test("returns null (clears the key) for an empty list", () => {
		expect(formatMembersRef([])).toBeNull();
	});
});

describe("resolveMemberNames", () => {
	const directory = new Map([
		["u1", "Alice"],
		["u2", "Bob"],
	]);

	test("resolves ids to names in the card's own order", () => {
		expect(resolveMemberNames(["u2", "u1"], directory)).toEqual(["Bob", "Alice"]);
	});

	test("omits an id no longer on the board, never writing it raw, and reports it", () => {
		const unresolved: string[] = [];
		expect(resolveMemberNames(["u1", "gone"], directory, (id) => unresolved.push(id))).toEqual(["Alice"]);
		expect(unresolved).toEqual(["gone"]);
	});

	test("returns an empty list for a card with no members", () => {
		expect(resolveMemberNames([], directory)).toEqual([]);
	});
});
