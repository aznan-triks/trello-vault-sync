import { describe, expect, test } from "vitest";
import { requireReportNote } from "../src/features/auditShared";
import { FakeVault } from "./fakes";

describe("requireReportNote", () => {
	test("returns the existing note untouched", async () => {
		const vault = new FakeVault({ "Report.md": { content: "existing" } });

		const note = await requireReportNote(vault, "Report.md", false);

		expect(note.path).toBe("Report.md");
		expect(vault.contentOf("Report.md")).toBe("existing");
	});

	test("throws when the note is missing and auto-create is off", async () => {
		const vault = new FakeVault();

		await expect(requireReportNote(vault, "Report.md", false)).rejects.toThrow(/Report note not found/);
	});

	test("creates an empty note when the note is missing and auto-create is on", async () => {
		const vault = new FakeVault();

		const note = await requireReportNote(vault, "Report.md", true);

		expect(note.path).toBe("Report.md");
		expect(vault.contentOf("Report.md")).toBe("");
	});

	test("still rejects an unconfigured path regardless of auto-create", async () => {
		const vault = new FakeVault();

		await expect(requireReportNote(vault, "", true)).rejects.toThrow(/not configured/);
	});
});
