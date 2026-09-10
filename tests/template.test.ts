import { describe, expect, test } from "vitest";
import { DEFAULT_CARD_REF_KEY } from "../src/core/cardRef";
import { renderTemplate, templateMissingCardRefKey } from "../src/core/template";

const vars = {
	TITLE: "Sagondo",
	DESCRIPTION: "A drifting city.",
	URL: "https://trello.com/c/knDzf43r",
	CARD_ID: "knDzf43r",
	BOARD_ID: "67c33f69b3caccd3817745b4",
};

describe("renderTemplate", () => {
	test("substitutes every known placeholder, repeated occurrences included", () => {
		const out = renderTemplate("{{TITLE}} — {{TITLE}} ({{CARD_ID}})", vars);
		expect(out).toBe("Sagondo — Sagondo (knDzf43r)");
	});

	test("fills the frontmatter shape the legacy note templates use", () => {
		const out = renderTemplate('id: "{{BOARD_ID}};{{CARD_ID}}"\n---\n{{DESCRIPTION}}', vars);
		expect(out).toBe('id: "67c33f69b3caccd3817745b4;knDzf43r"\n---\nA drifting city.');
	});

	test("leaves an unknown placeholder untouched rather than blanking it", () => {
		expect(renderTemplate("{{UNKNOWN}}", vars)).toBe("{{UNKNOWN}}");
	});

	test("treats a missing value as an empty string", () => {
		expect(renderTemplate("[{{DESCRIPTION}}]", { ...vars, DESCRIPTION: "" })).toBe("[]");
	});

	test("does not re-expand a placeholder coming from a substituted value", () => {
		const out = renderTemplate("{{TITLE}}", { ...vars, TITLE: "{{DESCRIPTION}}" });
		expect(out).toBe("{{DESCRIPTION}}");
	});

	test("returns an empty string for an empty template", () => {
		expect(renderTemplate("", vars)).toBe("");
	});

	test("YAML-escapes a placeholder value landing inside a real frontmatter fence", () => {
		const out = renderTemplate("---\ntitle: {{TITLE}}\n---\n{{DESCRIPTION}}", {
			...vars,
			TITLE: 'Idea: "quoted", tricky',
			DESCRIPTION: "Body text: still raw, unescaped",
		});
		expect(out).toBe('---\ntitle: "Idea: \\"quoted\\", tricky"\n---\nBody text: still raw, unescaped');
	});
});

describe("templateMissingCardRefKey", () => {
	test("flags a template with no trello_board_card_id key at all", () => {
		expect(
			templateMissingCardRefKey("---\ntitle: {{TITLE}}\n---\n{{DESCRIPTION}}", DEFAULT_CARD_REF_KEY),
		).toBe(true);
	});

	test("does not flag a template that declares the key", () => {
		const template = '---\ntrello_board_card_id: "{{BOARD_ID}};{{CARD_ID}}"\n---\n{{DESCRIPTION}}';
		expect(templateMissingCardRefKey(template, DEFAULT_CARD_REF_KEY)).toBe(false);
	});

	test("still flags it when the key only appears in the body, not the frontmatter", () => {
		const template = "---\ntype: idée\n---\nSee trello_board_card_id in the legacy script.";
		expect(templateMissingCardRefKey(template, DEFAULT_CARD_REF_KEY)).toBe(true);
	});

	test("checks against a configured key, not just the default", () => {
		const template = '---\ncard_link: "{{BOARD_ID}};{{CARD_ID}}"\n---\n{{DESCRIPTION}}';
		expect(templateMissingCardRefKey(template, "card_link")).toBe(false);
		expect(templateMissingCardRefKey(template, DEFAULT_CARD_REF_KEY)).toBe(true);
	});
});
