import { splitFrontmatter } from "./noteBody";

/** Placeholders a new-note template may use, matching the legacy `(script)` templates. */
export interface TemplateVars {
	TITLE: string;
	DESCRIPTION: string;
	URL: string;
	CARD_ID: string;
	BOARD_ID: string;
}

const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;

/**
 * Vars carrying arbitrary Trello-user-editable text (card title/description).
 * CARD_ID/BOARD_ID/URL are Trello's own fixed-format ids and are never the
 * injection vector — and the shipped default template hand-quotes them
 * together as `"{{BOARD_ID}};{{CARD_ID}}"`, which escaping would double-quote.
 */
const FREE_TEXT_VARS = new Set<keyof TemplateVars>(["TITLE", "DESCRIPTION"]);

/**
 * Fill `{{PLACEHOLDER}}` slots in one pass, so a substituted value that happens
 * to contain braces is never expanded again. Unknown names are left in place.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
	const table = vars as unknown as Record<string, string | undefined>;
	// A placeholder landing inside the frontmatter fence must come out as a
	// YAML-safe quoted scalar — a raw card title/description containing ": ",
	// a leading "#", a quote, or a newline would otherwise silently corrupt or
	// inject into the YAML block instead of failing fast (principle #3).
	const frontmatterEnd = splitFrontmatter(template).frontmatter?.length ?? 0;
	return template.replace(PLACEHOLDER, (match, name: string, offset: number) => {
		const value = table[name];
		if (value === undefined) return match;
		const insideFrontmatter = offset < frontmatterEnd;
		const isFreeText = FREE_TEXT_VARS.has(name as keyof TemplateVars);
		return insideFrontmatter && isFreeText ? JSON.stringify(value) : value;
	});
}
