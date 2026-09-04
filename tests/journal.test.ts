import { describe, expect, test } from "vitest";
import { appendJournalEntry, type JournalEntry } from "../src/core/journal";

const entry = (message: string): JournalEntry => ({ level: "info", message });

describe("appendJournalEntry", () => {
	test("appends to an empty journal", () => {
		expect(appendJournalEntry([], entry("first"), 60)).toEqual([entry("first")]);
	});

	test("keeps insertion order, oldest first", () => {
		const withFirst = appendJournalEntry([], entry("first"), 60);
		const withSecond = appendJournalEntry(withFirst, entry("second"), 60);
		expect(withSecond).toEqual([entry("first"), entry("second")]);
	});

	test("drops the oldest entry once over the cap", () => {
		const capped = [entry("a"), entry("b")].reduce(
			(entries, next) => appendJournalEntry(entries, next, 2),
			[] as JournalEntry[],
		);
		expect(appendJournalEntry(capped, entry("c"), 2)).toEqual([entry("b"), entry("c")]);
	});

	test("never exceeds maxEntries", () => {
		let entries: JournalEntry[] = [];
		for (let i = 0; i < 10; i++) entries = appendJournalEntry(entries, entry(String(i)), 3);
		expect(entries).toHaveLength(3);
		expect(entries).toEqual([entry("7"), entry("8"), entry("9")]);
	});
});
