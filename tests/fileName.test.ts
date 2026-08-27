import { describe, expect, test } from "vitest";
import { joinPath, sanitizeFileName, uniqueNotePath } from "../src/core/fileName";

describe("sanitizeFileName", () => {
	test("replaces every character Obsidian forbids in a file name", () => {
		expect(sanitizeFileName(String.raw`a*b"c\d/e<f>g:h|i?j`)).toBe("a-b-c-d-e-f-g-h-i-j");
	});

	test("keeps accents and emoji, which are legal in note titles", () => {
		expect(sanitizeFileName("🎺La Trompe du Mammouth")).toBe("🎺La Trompe du Mammouth");
	});

	test("strips control characters and trims the result", () => {
		expect(sanitizeFileName("  bad\u0000name  ")).toBe("badname");
	});

	test("falls back to a placeholder when nothing printable is left", () => {
		expect(sanitizeFileName("///")).toBe("---");
		expect(sanitizeFileName("   ")).toBe("Untitled");
	});

	test("caps very long names so the path stays writable", () => {
		expect(sanitizeFileName("x".repeat(300)).length).toBe(120);
	});

	test("drops a trailing dot, which Windows refuses", () => {
		expect(sanitizeFileName("name.")).toBe("name");
	});
});

describe("joinPath", () => {
	test("joins a folder and a file name", () => {
		expect(joinPath("WoT/85_Idées", "a.md")).toBe("WoT/85_Idées/a.md");
	});

	test("treats the vault root as no prefix at all", () => {
		expect(joinPath("/", "a.md")).toBe("a.md");
		expect(joinPath("", "a.md")).toBe("a.md");
	});

	test("does not double a separator the folder already ends with", () => {
		expect(joinPath("WoT/", "a.md")).toBe("WoT/a.md");
	});
});

describe("uniqueNotePath", () => {
	test("returns the plain path when nothing occupies it", () => {
		expect(uniqueNotePath("WoT", "Sagondo", () => false)).toBe("WoT/Sagondo.md");
	});

	test("suffixes with a counter until the path is free", () => {
		const taken = new Set(["WoT/Sagondo.md", "WoT/Sagondo (2).md"]);
		expect(uniqueNotePath("WoT", "Sagondo", (p) => taken.has(p))).toBe("WoT/Sagondo (3).md");
	});

	test("ignores a path the caller declares as its own", () => {
		const taken = new Set(["WoT/Sagondo.md"]);
		const path = uniqueNotePath("WoT", "Sagondo", (p) => taken.has(p), "WoT/Sagondo.md");
		expect(path).toBe("WoT/Sagondo.md");
	});
});
