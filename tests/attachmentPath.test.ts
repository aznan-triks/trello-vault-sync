import { describe, expect, test } from "vitest";
import { resolveAttachmentPath } from "../src/core/attachmentPath";

describe("resolveAttachmentPath", () => {
	test("note-folder mode: joins the note's own folder", () => {
		const result = resolveAttachmentPath("photo.jpg", {
			destination: "note-folder",
			noteFolder: "WoT/85_Idées",
			globalFolder: "",
		});
		expect(result).toEqual({ ok: true, path: "WoT/85_Idées/photo.jpg" });
	});

	test("note-folder mode: a root-level note has no folder prefix", () => {
		const result = resolveAttachmentPath("photo.jpg", { destination: "note-folder", noteFolder: "", globalFolder: "" });
		expect(result).toEqual({ ok: true, path: "photo.jpg" });
	});

	test("global-folder mode: joins the configured global folder", () => {
		const result = resolveAttachmentPath("photo.jpg", {
			destination: "global-folder",
			noteFolder: "WoT/85_Idées",
			globalFolder: "Attachments",
		});
		expect(result).toEqual({ ok: true, path: "Attachments/photo.jpg" });
	});

	test("global-folder mode with an empty folder refuses instead of writing to the vault root", () => {
		const result = resolveAttachmentPath("photo.jpg", { destination: "global-folder", noteFolder: "x", globalFolder: "" });
		expect(result).toEqual({ ok: false, reason: "Attachment download folder is not set." });
	});

	test("global-folder mode with a blank (whitespace-only) folder also refuses", () => {
		const result = resolveAttachmentPath("photo.jpg", { destination: "global-folder", noteFolder: "x", globalFolder: "   " });
		expect(result.ok).toBe(false);
	});

	test("sanitizes a name containing forbidden characters, never escaping the target folder", () => {
		const result = resolveAttachmentPath("../../etc/passwd:1.jpg", {
			destination: "note-folder",
			noteFolder: "Attachments",
			globalFolder: "",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			// Exactly one "/" — the folder join itself — proves the sanitized name
			// carries no path separator of its own, so it can't escape the folder.
			expect(result.path.split("/")).toHaveLength(2);
			expect(result.path.startsWith("Attachments/")).toBe(true);
			expect(result.path).not.toContain(":");
		}
	});

	test("sanitizes a reserved Windows device base name", () => {
		const result = resolveAttachmentPath("CON", { destination: "note-folder", noteFolder: "Attachments", globalFolder: "" });
		expect(result).toEqual({ ok: true, path: "Attachments/_CON" });
	});
});
