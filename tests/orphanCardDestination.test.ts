import { describe, expect, test } from "vitest";
import { isUsableDestinationFolder, resolveOrphanCardDestination } from "../src/core/orphanCardDestination";

describe("resolveOrphanCardDestination", () => {
	const mappings = [{ listId: "l1", folder: "WoT/85_Idées" }];

	test("uses the mapped folder directly when the card's list is mapped", () => {
		expect(resolveOrphanCardDestination("l1", mappings, "")).toEqual({ needsPrompt: false, folder: "WoT/85_Idées" });
	});

	test("uses the configured fallback directly when the list isn't mapped but a fallback is set", () => {
		expect(resolveOrphanCardDestination("l2", mappings, "Inbox")).toEqual({ needsPrompt: false, folder: "Inbox" });
	});

	test("needs a prompt when the list isn't mapped and the fallback is empty", () => {
		expect(resolveOrphanCardDestination("l2", mappings, "")).toEqual({ needsPrompt: true });
	});

	test("needs a prompt when the list isn't mapped and the fallback is only whitespace", () => {
		expect(resolveOrphanCardDestination("l2", mappings, "   ")).toEqual({ needsPrompt: true });
	});

	test("a card with no list at all (idList undefined) behaves like an unmapped list", () => {
		expect(resolveOrphanCardDestination(undefined, mappings, "")).toEqual({ needsPrompt: true });
	});
});

describe("isUsableDestinationFolder", () => {
	test("rejects empty and whitespace-only folders", () => {
		expect(isUsableDestinationFolder("")).toBe(false);
		expect(isUsableDestinationFolder("   ")).toBe(false);
	});

	test("accepts a real folder path", () => {
		expect(isUsableDestinationFolder("Projects")).toBe(true);
	});
});
