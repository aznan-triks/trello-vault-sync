import { describe, expect, test } from "vitest";
import { renderTemplate } from "../src/core/template";

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
});
