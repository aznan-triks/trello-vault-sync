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
 * Fill `{{PLACEHOLDER}}` slots in one pass, so a substituted value that happens
 * to contain braces is never expanded again. Unknown names are left in place.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
	const table = vars as unknown as Record<string, string | undefined>;
	return template.replace(PLACEHOLDER, (match, name: string) => {
		const value = table[name];
		return value === undefined ? match : value;
	});
}
