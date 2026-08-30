import { describe, expect, test } from "vitest";
import { extractBody, normalizeBody, replaceBody, splitFrontmatter } from "../src/core/noteBody";

describe("splitFrontmatter", () => {
	test("separates a YAML block from the body", () => {
		const content = "---\ntype: idée\n---\n\nHello world\n";
		expect(splitFrontmatter(content)).toEqual({
			frontmatter: "---\ntype: idée\n---",
			body: "\n\nHello world\n",
		});
	});

	test("keeps a '---' that appears inside a YAML value inside the block", () => {
		const content = '---\nnote: "a --- b"\ntype: idée\n---\nBody\n';
		expect(splitFrontmatter(content).frontmatter).toBe('---\nnote: "a --- b"\ntype: idée\n---');
	});

	test("does not treat a leading horizontal rule as frontmatter", () => {
		const content = "Some text\n\n---\n\nMore text";
		expect(splitFrontmatter(content)).toEqual({ frontmatter: null, body: content });
	});

	test("tolerates a UTF-8 BOM before the opening fence", () => {
		const content = "\uFEFF---\ntype: objet\n---\nBody";
		expect(splitFrontmatter(content).frontmatter).toBe("\uFEFF---\ntype: objet\n---");
		expect(splitFrontmatter(content).body).toBe("\nBody");
	});

	test("handles CRLF line endings", () => {
		const content = "---\r\ntype: lieu\r\n---\r\nBody";
		expect(splitFrontmatter(content).frontmatter).toBe("---\r\ntype: lieu\r\n---");
	});

	test("returns the whole content as body when the block is never closed", () => {
		const content = "---\ntype: idée\nstill open";
		expect(splitFrontmatter(content)).toEqual({ frontmatter: null, body: content });
	});

	test("tolerates trailing spaces on the closing fence", () => {
		const content = "---\ntype: idée\n---  \n\nHello world\n";
		const result = splitFrontmatter(content);
		expect(result.frontmatter).toBe("---\ntype: idée\n---  ");
		expect(result.body).toBe("\n\nHello world\n");
	});

	test("tolerates a trailing tab on the closing fence", () => {
		const content = "---\ntype: idée\n---\t\nBody\n";
		const result = splitFrontmatter(content);
		expect(result.frontmatter).toBe("---\ntype: idée\n---\t");
		expect(result.body).toBe("\nBody\n");
	});

	test("tolerates a trailing space on the closing fence of a CRLF file", () => {
		const content = "---\r\ntype: idée\r\n---  \r\nBody";
		const result = splitFrontmatter(content);
		expect(result.frontmatter).toBe("---\r\ntype: idée\r\n---  ");
		expect(result.body).toBe("\r\nBody");
	});

	test("tolerates trailing spaces on the opening fence", () => {
		const content = "---  \ntype: idée\n---\nBody";
		const result = splitFrontmatter(content);
		expect(result.frontmatter).toBe("---  \ntype: idée\n---");
		expect(result.body).toBe("\nBody");
	});
});

describe("extractBody", () => {
	test("drops the frontmatter and the Templater tags", () => {
		const content = "---\ntype: idée\n---\n\n<%* tp.user.x() %>\nReal text\n";
		expect(extractBody(content)).toBe("Real text");
	});

	test("returns the trimmed content when there is no frontmatter", () => {
		expect(extractBody("  Just text  ")).toBe("Just text");
	});
});

describe("normalizeBody", () => {
	test("normalises CRLF and trailing whitespace before comparison", () => {
		expect(normalizeBody("a\r\nb  \n")).toBe("a\nb");
	});

	test("treats undefined as an empty body", () => {
		expect(normalizeBody(undefined)).toBe("");
	});
});

describe("replaceBody", () => {
	test("swaps the body and leaves the frontmatter byte-identical", () => {
		const content = '---\nid: "a;b"\n---\n\nold body';
		expect(replaceBody(content, "new body")).toBe('---\nid: "a;b"\n---\n\nnew body');
	});

	test("writes a bare body when the note has no frontmatter", () => {
		expect(replaceBody("old", "new")).toBe("new\n");
	});

	test("keeps the note unchanged when the body is already identical", () => {
		const content = "---\na: 1\n---\n\nsame";
		expect(replaceBody(content, "same")).toBe(content);
	});
});
