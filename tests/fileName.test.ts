import { describe, expect, test } from "vitest";
import { excludeFolders, joinPath, notesInFolder, sanitizeFileName, uniqueNotePath } from "../src/core/fileName";

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

	test("strips ASCII control characters by code point", () => {
		expect(sanitizeFileName("a\u0000b\u001Fc\u007Fd")).toBe("abcd");
	});

	test("falls back to a placeholder when nothing printable is left", () => {
		expect(sanitizeFileName("///")).toBe("---");
		expect(sanitizeFileName("   ")).toBe("Untitled");
	});

	test("caps very long names so the path stays writable", () => {
		expect(sanitizeFileName("x".repeat(300)).length).toBe(120);
	});

	test("truncates on a code-point boundary instead of splitting an emoji's surrogate pair", () => {
		const title = "x".repeat(119) + "🎺".repeat(5);
		const result = sanitizeFileName(title);
		const lastUnit = result.charCodeAt(result.length - 1);
		const endsInLoneHighSurrogate = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
		expect(endsInLoneHighSurrogate).toBe(false);
	});

	test("drops a trailing dot, which Windows refuses", () => {
		expect(sanitizeFileName("name.")).toBe("name");
	});

	test("prefixes a Windows-reserved device name so the file system does not choke on it", () => {
		expect(sanitizeFileName("CON")).toBe("_CON");
		expect(sanitizeFileName("com1")).toBe("_com1");
		expect(sanitizeFileName("Lpt9")).toBe("_Lpt9");
	});

	test("leaves a name that merely contains a reserved word alone", () => {
		expect(sanitizeFileName("Console")).toBe("Console");
		expect(sanitizeFileName("Comfort")).toBe("Comfort");
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

describe("notesInFolder", () => {
	const handles = [{ path: "WoT/85_Idées/a.md" }, { path: "WoT/85_Idées/b.md" }, { path: "WoT/90_Fins/c.md" }];

	test("keeps only handles under the given folder", () => {
		expect(notesInFolder(handles, "WoT/85_Idées")).toEqual([handles[0], handles[1]]);
	});

	test("treats the vault root (\"\" or \"/\") as every handle", () => {
		expect(notesInFolder(handles, "")).toEqual(handles);
		expect(notesInFolder(handles, "/")).toEqual(handles);
	});

	test("does not match a folder name that is merely a prefix of another folder's name", () => {
		expect(notesInFolder([{ path: "WoT/85_IdéesBis/a.md" }], "WoT/85_Idées")).toEqual([]);
	});
});

describe("excludeFolders", () => {
	const handles = [{ path: "WoT/85_Idées/a.md" }, { path: "WoT/90_Fins/b.md" }, { path: "Archive/c.md" }];

	test("drops every handle under an excluded folder", () => {
		expect(excludeFolders(handles, ["Archive"])).toEqual([handles[0], handles[1]]);
	});

	test("returns every handle unchanged when nothing is excluded", () => {
		expect(excludeFolders(handles, [])).toEqual(handles);
	});

	test("has no effect when an excluded folder matches nothing", () => {
		expect(excludeFolders(handles, ["Nowhere"])).toEqual(handles);
	});

	test("does not match a folder name that is merely a prefix of another folder's name", () => {
		expect(excludeFolders([{ path: "Archived/a.md" }], ["Archive"])).toEqual([{ path: "Archived/a.md" }]);
	});

	test("combines with several excluded folders", () => {
		expect(excludeFolders(handles, ["Archive", "WoT/90_Fins"])).toEqual([handles[0]]);
	});
});
