import { describe, expect, test } from "vitest";
import { bestMatch, similarity } from "../src/core/similarity";

describe("similarity", () => {
	test("scores identical strings as a perfect match", () => {
		expect(similarity("Sagondo", "Sagondo")).toBe(1);
	});

	test("ignores case and surrounding whitespace", () => {
		expect(similarity("  SAGONDO ", "sagondo")).toBe(1);
	});

	test("scores two unrelated strings low", () => {
		expect(similarity("Sagondo", "Chèvre")).toBeLessThan(0.4);
	});

	test("scores a one-letter typo high", () => {
		expect(similarity("Sagondo", "Sagundo")).toBeGreaterThan(0.8);
	});

	test("treats two empty strings as equal", () => {
		expect(similarity("", "")).toBe(1);
	});

	test("scores anything against an empty string as zero", () => {
		expect(similarity("Sagondo", "")).toBe(0);
	});
});

describe("bestMatch", () => {
	const cards = [
		{ id: "1", name: "Le monde" },
		{ id: "2", name: "Sagondo" },
		{ id: "3", name: "Lignée des Triks" },
	];
	const byName = (c: { name: string }) => c.name;

	test("returns the closest candidate above the threshold", () => {
		const hit = bestMatch("sagondo", cards, byName, 0.45);
		expect(hit?.item.id).toBe("2");
		expect(hit?.score).toBe(1);
	});

	test("boosts a candidate whose name is contained in the query", () => {
		const hit = bestMatch("Sagondo (brouillon)", cards, byName, 0.45);
		expect(hit?.item.id).toBe("2");
		expect(hit?.score).toBeGreaterThanOrEqual(0.9);
	});

	test("returns null when nothing reaches the threshold", () => {
		expect(bestMatch("zzzzzzzz", cards, byName, 0.45)).toBeNull();
	});

	test("returns null for an empty candidate list", () => {
		expect(bestMatch("anything", [], byName, 0.45)).toBeNull();
	});
});
