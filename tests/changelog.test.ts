import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
	filterAndGroupChangelog,
	filterChangelogCatBody,
	formatChangelogBody,
	parseChangelogVoiceBlocks,
	parseRawChangelogMarkdown,
	renderChangelogMarkdown,
} from "../src/core/changelog";

describe("renderChangelogMarkdown", () => {
	test("escapes raw HTML to prevent injection", () => {
		const raw = '<script>alert("xss")</script> & <b>bold</b>';
		const out = renderChangelogMarkdown(raw);
		expect(out).not.toContain("<script>");
		expect(out).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
		expect(out).toContain("&amp;");
		expect(out).toContain("&lt;b&gt;bold&lt;/b&gt;");
	});

	test("does not corrupt inline code with underscores into italic or expose placeholder tokens", () => {
		const input = "- *Mode*: cached `_lastHistPageRes` allowing `toggleHistSelectMode()` via `_renderHistoryPage()_`";
		const out = renderChangelogMarkdown(input);
		expect(out).not.toContain("INLINECODE");
		expect(out).toContain("<code>_lastHistPageRes</code>");
		expect(out).toContain("<code>toggleHistSelectMode()</code>");
		expect(out).toContain("<code>_renderHistoryPage()_</code>");
		expect(out).toContain("<em>Mode</em>");
	});

	test("renders formatting: bold, italic, strike, links, lists and headers", () => {
		const md = [
			"### Header 3",
			"**bold text** and *italic text* and ~~strike text~~",
			"[Obsidian](https://obsidian.md)",
			"- item 1",
			"- item 2",
			"> quote here",
			"---",
		].join("\n");

		const out = renderChangelogMarkdown(md);
		expect(out).toContain("<h3>Header 3</h3>");
		expect(out).toContain("<strong>bold text</strong>");
		expect(out).toContain("<em>italic text</em>");
		expect(out).toContain("<del>strike text</del>");
		expect(out).toContain('<a href="https://obsidian.md" target="_blank" rel="noopener noreferrer">Obsidian</a>');
		expect(out).toContain('<ul class="tvs-cl-md-list"><li>item 1</li><li>item 2</li></ul>');
		expect(out).toContain("<blockquote>quote here</blockquote>");
		expect(out).toContain("<hr>");
	});
});

describe("parseRawChangelogMarkdown", () => {
	test("splits intro and version blocks from keep-a-changelog markdown", () => {
		const md = `# Changelog

All notable changes documented here.

## [1.16.8] — 2026-09-16

### Added
- **Plain**: Added feature A.
  **Technical**: Internal detail A.

## [1.16.7] - 2026-09-15

### Fixed
- **Plain**: Fixed bug B.
  **Technical**: Internal detail B.
`;
		const { introHtml, rawItems } = parseRawChangelogMarkdown(md);
		expect(introHtml).toContain("All notable changes documented here.");
		expect(rawItems).toHaveLength(2);
		expect(rawItems[0]?.ver).toBe("1.16.8");
		expect(rawItems[0]?.date).toBe("2026-09-16");
		expect(rawItems[1]?.ver).toBe("1.16.7");
		expect(rawItems[1]?.date).toBe("2026-09-15");
	});

	test("handles unreleased version header gracefully", () => {
		const md = `## [Unreleased]

### Added
- **Plain**: Work in progress.
`;
		const { rawItems } = parseRawChangelogMarkdown(md);
		expect(rawItems).toHaveLength(1);
		expect(rawItems[0]?.ver).toBe("Unreleased");
		expect(rawItems[0]?.date).toBe("Unreleased");
	});
});

describe("parseChangelogVoiceBlocks & filterChangelogCatBody", () => {
	const sampleCatBody = `- **Plain**: Linked cards now has its own switch.
  **Technical**: New \`syncLinkedCards: boolean\` setting added to \`SettingsTab.ts\`.

- **Plain**: Second change described in plain terms.
  **Technical**: \`features/syncNote.ts\` updated.`;

	test("isolates Plain voice strictly with no technical leakage", () => {
		const plainOut = filterChangelogCatBody(sampleCatBody, "plain");
		expect(plainOut).toContain("Linked cards now has its own switch.");
		expect(plainOut).toContain("Second change described in plain terms.");
		expect(plainOut).not.toContain("syncLinkedCards");
		expect(plainOut).not.toContain("SettingsTab.ts");
		expect(plainOut).not.toContain("features/syncNote.ts");
	});

	test("isolates Technical voice strictly with no plain text leakage", () => {
		const techOut = filterChangelogCatBody(sampleCatBody, "tech");
		expect(techOut).not.toContain("Linked cards now has its own switch.");
		expect(techOut).not.toContain("Second change described in plain terms.");
		expect(techOut).toContain("syncLinkedCards: boolean");
		expect(techOut).toContain("SettingsTab.ts");
		expect(techOut).toContain("features/syncNote.ts");
	});

	test("preserves all content in all view mode", () => {
		const allOut = filterChangelogCatBody(sampleCatBody, "all");
		expect(allOut).toBe(sampleCatBody);
	});

	test("supports Human and Humanisé / Technique voice labels for compatibility", () => {
		const frenchBody = `**Humanisé**: Description claire.
**Technique**: Détail technique en \`Code.gs\`.`;
		const plainOut = filterChangelogCatBody(frenchBody, "plain");
		expect(plainOut).toContain("Description claire.");
		expect(plainOut).not.toContain("Code.gs");

		const techOut = filterChangelogCatBody(frenchBody, "tech");
		expect(techOut).not.toContain("Description claire.");
		expect(techOut).toContain("Code.gs");
	});

	test("does not create spurious blocks on inline occurrences of voice keywords", () => {
		const catBody = `- **Plain**: Clear separation between Plain and Technical voices in the Changelog.
  **Technical**: Replaced regex with line-anchored voice block parser.`;

		const blocks = parseChangelogVoiceBlocks(catBody);
		expect(blocks).toHaveLength(2);
		expect(blocks[0]?.type).toBe("plain");
		expect(blocks[1]?.type).toBe("tech");
	});
});

describe("formatChangelogBody", () => {
	test("creates categorized sections and voice entry containers with badges", () => {
		const body = `### Added
- **Plain**: Feature description.
  **Technical**: Implementation details in \`src/main.ts\`.

### Fixed
- **Plain**: Bug fix description.
  **Technical**: Fix details.`;

		const html = formatChangelogBody(body);
		expect(html).toContain("tvs-cl-category-section");
		expect(html).toContain("tvs-cl-added");
		expect(html).toContain("tvs-cl-fixed");
		expect(html).toContain("tvs-cl-voice-plain");
		expect(html).toContain("tvs-cl-voice-tech");
		expect(html).toContain("👤 Plain");
		expect(html).toContain("💻 Technical");
		expect(html).toContain("<code>src/main.ts</code>");
	});
});

describe("filterAndGroupChangelog", () => {
	const rawMarkdown = readFileSync(join(__dirname, "..", "CHANGELOG.md"), "utf8");

	test("parses the actual project CHANGELOG.md without throwing", () => {
		const { introHtml, rawItems } = parseRawChangelogMarkdown(rawMarkdown);
		expect(introHtml).toContain("All notable changes");
		expect(rawItems.length).toBeGreaterThanOrEqual(40);
		expect(rawItems[0]?.ver).toMatch(/^\d+\.\d+\.\d+/);
		expect(rawItems[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}/);
	});

	test("filters by search query across version and content", () => {
		const { rawItems } = parseRawChangelogMarkdown(rawMarkdown);
		const filtered = filterAndGroupChangelog(rawItems, {
			searchQuery: "cover.scaled",
			viewMode: "all",
			activeCats: new Set(["Added", "Changed", "Fixed", "Removed", "Security"]),
			sortOrder: "desc",
			versionFrom: "all",
			versionTo: "all",
		});

		expect(filtered.processedItems.length).toBeGreaterThanOrEqual(1);
		expect(filtered.processedItems.some((item) => item.ver === "1.16.7")).toBe(true);
	});

	test("filters by category", () => {
		const { rawItems } = parseRawChangelogMarkdown(rawMarkdown);
		const onlyAdded = filterAndGroupChangelog(rawItems, {
			searchQuery: "",
			viewMode: "plain",
			activeCats: new Set(["Added"]),
			sortOrder: "desc",
			versionFrom: "all",
			versionTo: "all",
		});

		for (const item of onlyAdded.processedItems) {
			expect(item.bodyContent).toContain("### Added");
			expect(item.bodyContent).not.toContain("### Fixed");
		}
	});

	test("filters by version range", () => {
		const { rawItems } = parseRawChangelogMarkdown(rawMarkdown);
		const ranged = filterAndGroupChangelog(rawItems, {
			searchQuery: "",
			viewMode: "all",
			activeCats: new Set(["Added", "Changed", "Fixed", "Removed", "Security"]),
			sortOrder: "desc",
			versionFrom: "1.16.8",
			versionTo: "1.16.6",
		});

		expect(ranged.processedItems.map((i) => i.ver)).toEqual(["1.16.8", "1.16.7", "1.16.6"]);
	});

	test("reverses order when sort is asc", () => {
		const { rawItems } = parseRawChangelogMarkdown(rawMarkdown);
		const desc = filterAndGroupChangelog(rawItems, {
			searchQuery: "",
			viewMode: "all",
			activeCats: new Set(["Added", "Changed", "Fixed", "Removed", "Security"]),
			sortOrder: "desc",
			versionFrom: "all",
			versionTo: "all",
		});

		const asc = filterAndGroupChangelog(rawItems, {
			searchQuery: "",
			viewMode: "all",
			activeCats: new Set(["Added", "Changed", "Fixed", "Removed", "Security"]),
			sortOrder: "asc",
			versionFrom: "all",
			versionTo: "all",
		});

		expect(asc.processedItems[0]?.ver).toBe(desc.processedItems[desc.processedItems.length - 1]?.ver);
	});

	test("groups items into date timeline groups", () => {
		const { rawItems } = parseRawChangelogMarkdown(rawMarkdown);
		const result = filterAndGroupChangelog(rawItems, {
			searchQuery: "",
			viewMode: "all",
			activeCats: new Set(["Added", "Changed", "Fixed", "Removed", "Security"]),
			sortOrder: "desc",
			versionFrom: "all",
			versionTo: "all",
		});

		expect(result.dateGroups.length).toBeGreaterThan(0);
		expect(result.dateGroups[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}/);
		expect(result.dateGroups[0]?.versions.length).toBeGreaterThanOrEqual(1);
	});
});
