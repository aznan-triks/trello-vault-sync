/**
 * Frontmatter-aware text surgery.
 *
 * The legacy scripts located the closing fence with `indexOf("---", 3)`, which
 * matches a `---` sitting inside a YAML value and mangles the note. Everything
 * here works on whole lines instead, and preserves the original bytes of the
 * YAML block (BOM and CRLF included) when rewriting a body.
 */

const BOM = "\uFEFF";
const TEMPLATER_TAG = /<%[\s\S]*?%>/g;

export interface SplitNote {
	/** The YAML block including both fences, or `null` when there is none. */
	frontmatter: string | null;
	/** Everything after the closing fence, or the whole content when there is none. */
	body: string;
}

/** Split a note into its YAML block and its body without altering either. */
export function splitFrontmatter(content: string): SplitNote {
	const offset = content.startsWith(BOM) ? BOM.length : 0;
	const rest = content.slice(offset);
	if (!/^---[ \t]*\r?\n/.test(rest)) return { frontmatter: null, body: content };

	const lines = rest.split("\n");
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (line.replace(/[ \t]*\r?$/, "") !== "---") continue;
		// The fence text itself, stripped of the CR that a CRLF file leaves behind.
		const consumed = lines.slice(0, i + 1).join("\n").replace(/\r$/, "");
		return {
			frontmatter: content.slice(0, offset + consumed.length),
			body: content.slice(offset + consumed.length),
		};
	}
	return { frontmatter: null, body: content };
}

/**
 * Index of the first line after the checklist section whose heading is at `headingIndex`. The section runs
 * through its sub-headings, checkbox items, indented lines and blank lines, and ends at the next heading
 * of its level or higher, or at any other prose — what follows belongs to the user, not to the checklist.
 */
function checklistSectionEnd(lines: string[], headingIndex: number, trimmedHeading: string): number {
	const headingMatch = trimmedHeading.match(/^(#+)/);
	const headingLevel = headingMatch && headingMatch[1] ? headingMatch[1].length : 0;

	for (let i = headingIndex + 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const trimmed = line.trim();

		if (trimmed === "") continue;

		const subMatch = trimmed.match(/^(#+)\s+/);
		if (subMatch && subMatch[1]) {
			// A deeper heading (e.g. ### under ##) is part of the section; the same or a higher level ends it.
			if (headingLevel > 0 && subMatch[1].length > headingLevel) continue;
			return i;
		}

		if (/^[-*]\s*\[[ xX]\]/.test(trimmed)) continue;
		if (/^(\s{2,}|\t)/.test(line)) continue;

		return i;
	}
	return lines.length;
}

/**
 * Splits `body` at the LAST line matching `heading` exactly (trimmed). `checklistBlock` is the
 * section from that line to where it ends (see `checklistSectionEnd`), verbatim, heading included;
 * `rest` is what comes before it and `after`, present only when there is some, what comes after.
 * Matching the last occurrence (not the first) protects prose that happens to
 * mention the heading text earlier in the note from being swallowed into the
 * checklist block.
 */
export function splitChecklistSection(
	body: string,
	heading: string,
): { rest: string; checklistBlock: string | null; after?: string } {
	const lines = body.split("\n");
	const trimmedHeading = heading.trim();
	const index = lines.findLastIndex((line) => line.trim() === trimmedHeading);
	if (index === -1) return { rest: body, checklistBlock: null };
	const end = checklistSectionEnd(lines, index, trimmedHeading);
	const blockLines = lines.slice(index, end);
	while ((blockLines[blockLines.length - 1] ?? "").trim() === "") blockLines.pop();
	const after = lines.slice(end).join("\n").trim();
	return {
		rest: lines.slice(0, index).join("\n"),
		checklistBlock: blockLines.join("\n"),
		...(after === "" ? {} : { after }),
	};
}

/** Rebuilds a body from `rest`, `checklistBlock` (`null` omits the section) and what followed it. */
export function insertChecklistSection(rest: string, checklistBlock: string | null, after?: string): string {
	const join = (head: string, tail: string) => (head === "" ? tail : `${head}\n\n${tail}`);
	const withBlock = checklistBlock === null ? rest.trim() : join(rest.replace(/\s+$/, ""), checklistBlock);
	return after ? join(withBlock, after) : withBlock;
}

/** The note body as written, frontmatter off and trimmed: Templater tags kept, for code that rewrites the note rather than reads its description. */
export function rawBody(content: string): string {
	return splitFrontmatter(content).body.trim();
}

/**
 * The note body with frontmatter and Templater tags removed, trimmed.
 * `checklistHeading`, when given, also strips a trailing checklist section —
 * omit it (the default) to keep today's exact behavior, since that section is
 * never part of the Trello-synced description.
 */
export function extractBody(content: string, checklistHeading?: string | null): string {
	const rawBody = splitFrontmatter(content).body.replace(TEMPLATER_TAG, "");
	if (!checklistHeading) return rawBody.trim();
	return splitChecklistSection(rawBody.trim(), checklistHeading).rest.trim();
}

/** Canonical form used to compare a local body with a remote description. */
export function normalizeBody(value: string | null | undefined): string {
	if (!value) return "";
	return value
		.replace(/\r\n/g, "\n")
		.split("\n")
		.map((line) => line.replace(/[ \t]+$/, ""))
		.join("\n")
		.trim();
}

/**
 * Rewrite the body while leaving the YAML block byte-identical.
 * `checklistHeading`, when given, preserves the note's existing checklist
 * section (read from `content`) instead of letting `body` (the pulled
 * description) overwrite it — omit it (the default) to keep today's exact
 * behavior.
 */
export function replaceBody(content: string, body: string, checklistHeading?: string | null): string {
	const { frontmatter, body: currentBody } = splitFrontmatter(content);
	let finalBody = body;
	if (checklistHeading) {
		const { checklistBlock, after } = splitChecklistSection(currentBody.trim(), checklistHeading);
		finalBody = insertChecklistSection(body, checklistBlock, after);
	}
	const next = frontmatter === null ? `${finalBody}\n` : `${frontmatter}\n\n${finalBody}`;
	return next === content ? content : next;
}

/**
 * Checks whether a note body contains the specified checklist heading.
 * Ignores frontmatter fences and matches trimmed whole lines in the body.
 */
export function hasChecklistSection(content: string, heading: string): boolean {
	const trimmedHeading = heading.trim();
	if (!trimmedHeading) return false;
	const { body } = splitFrontmatter(content);
	const lines = body.split("\n");
	return lines.some((line) => line.trim() === trimmedHeading);
}

/**
 * Removes the checklist section under `heading` from note `content`.
 * Preserves frontmatter, preceding body prose, and any trailing user content
 * below the checklist block, while maintaining original CRLF/LF line endings.
 */
export function removeChecklistSection(content: string, heading: string): string {
	const trimmedHeading = heading.trim();
	if (!trimmedHeading) return content;

	const isCrlf = content.includes("\r\n");
	const normalizedContent = isCrlf ? content.replace(/\r\n/g, "\n") : content;
	const { frontmatter, body } = splitFrontmatter(normalizedContent);

	const lines = body.split("\n");
	const headingIndex = lines.findLastIndex((line) => line.trim() === trimmedHeading);
	if (headingIndex === -1) return content;

	const endIndex = checklistSectionEnd(lines, headingIndex, trimmedHeading);

	const beforeLines = lines.slice(0, headingIndex);
	const afterLines = lines.slice(endIndex);

	while (beforeLines.length > 0 && (beforeLines[beforeLines.length - 1] ?? "").trim() === "") {
		beforeLines.pop();
	}
	while (afterLines.length > 0 && (afterLines[0] ?? "").trim() === "") {
		afterLines.shift();
	}

	const beforeText = beforeLines.join("\n").trim();
	const afterText = afterLines.join("\n").trim();

	let newBody = "";
	if (beforeText && afterText) {
		newBody = `${beforeText}\n\n${afterText}`;
	} else if (beforeText) {
		newBody = beforeText;
	} else if (afterText) {
		newBody = afterText;
	}

	let next = "";
	if (frontmatter === null) {
		next = newBody === "" ? "" : `${newBody}\n`;
	} else {
		next = newBody === "" ? `${frontmatter}\n` : `${frontmatter}\n\n${newBody}\n`;
	}

	return isCrlf ? next.replace(/\n/g, "\r\n") : next;
}

