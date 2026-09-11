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
 * Splits `body` at the line matching `heading` exactly (trimmed) — everything
 * from that line to the end is the checklist block, verbatim, including the
 * heading line itself. The checklist section is always the LAST thing in a
 * note's body: nothing after it is preserved separately.
 */
export function splitChecklistSection(body: string, heading: string): { rest: string; checklistBlock: string | null } {
	const lines = body.split("\n");
	const index = lines.findIndex((line) => line.trim() === heading.trim());
	if (index === -1) return { rest: body, checklistBlock: null };
	return { rest: lines.slice(0, index).join("\n"), checklistBlock: lines.slice(index).join("\n") };
}

/** Rebuilds a body from `rest` plus `checklistBlock` — `null` omits the section entirely. */
export function insertChecklistSection(rest: string, checklistBlock: string | null): string {
	if (checklistBlock === null) return rest.trim();
	const trimmedRest = rest.replace(/\s+$/, "");
	return trimmedRest === "" ? checklistBlock : `${trimmedRest}\n\n${checklistBlock}`;
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
		const currentRawBody = currentBody.replace(TEMPLATER_TAG, "").trim();
		const { checklistBlock } = splitChecklistSection(currentRawBody, checklistHeading);
		finalBody = insertChecklistSection(body, checklistBlock);
	}
	const next = frontmatter === null ? `${finalBody}\n` : `${frontmatter}\n\n${finalBody}`;
	return next === content ? content : next;
}
