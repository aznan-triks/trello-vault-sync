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

/** The note body with frontmatter and Templater tags removed, trimmed. */
export function extractBody(content: string): string {
	return splitFrontmatter(content).body.replace(TEMPLATER_TAG, "").trim();
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

/** Rewrite the body while leaving the YAML block byte-identical. */
export function replaceBody(content: string, body: string): string {
	const { frontmatter } = splitFrontmatter(content);
	const next = frontmatter === null ? `${body}\n` : `${frontmatter}\n\n${body}`;
	return next === content ? content : next;
}
