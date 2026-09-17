export type ChangelogViewMode = "all" | "plain" | "tech";

export interface ChangelogVoiceBlock {
	type: "plain" | "tech" | "legacy";
	marker: string;
	content: string;
}

export interface RawChangelogItem {
	ver: string;
	date: string;
	bodyContent: string;
}

export interface ChangelogDateGroup {
	date: string;
	versions: RawChangelogItem[];
}

export interface ChangelogFilterOptions {
	searchQuery: string;
	viewMode: ChangelogViewMode;
	activeCats: Set<string>;
	sortOrder: "desc" | "asc";
	versionFrom: string;
	versionTo: string;
}

export interface FilteredChangelogResult {
	processedItems: RawChangelogItem[];
	dateGroups: ChangelogDateGroup[];
	uniqueVersions: string[];
}

export const KNOWN_CATEGORIES = ["Added", "Changed", "Fixed", "Removed", "Security"] as const;

export const CATEGORY_ICON_MAP: Record<string, string> = {
	Added: "✨",
	Changed: "⚡",
	Fixed: "🐛",
	Removed: "🗑️",
	Security: "🛡️",
	Internal: "🔧",
	// Fallback mappings
	"Ajout\u00e9": "✨",
	"Modifi\u00e9": "⚡",
	"Corrig\u00e9": "🐛",
	"Supprim\u00e9": "🗑️",
	"S\u00e9curit\u00e9": "🛡️",
	Interne: "🔧",
};

export const CATEGORY_CLASS_MAP: Record<string, string> = {
	Added: "tvs-cl-added",
	Changed: "tvs-cl-modified",
	Fixed: "tvs-cl-fixed",
	Removed: "tvs-cl-removed",
	Security: "tvs-cl-security",
	Internal: "tvs-cl-internal",
	// Fallback mappings
	"Ajout\u00e9": "tvs-cl-added",
	"Modifi\u00e9": "tvs-cl-modified",
	"Corrig\u00e9": "tvs-cl-fixed",
	"Supprim\u00e9": "tvs-cl-removed",
	"S\u00e9curit\u00e9": "tvs-cl-security",
	Interne: "tvs-cl-internal",
};

export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function renderChangelogMarkdown(text: string): string {
	if (!text) return "";
	let src = String(text).replace(/\r\n/g, "\n");

	// 1) Code blocks
	const codeBlocks: string[] = [];
	src = src.replace(/```([\s\S]*?)```/g, (_m, code: string) => {
		codeBlocks.push('<pre class="tvs-cl-md-code-block"><code>' + escapeHtml(code.trim()) + "</code></pre>");
		return "%%CODEBLOCK" + (codeBlocks.length - 1) + "%%";
	});

	// 2) Inline code with safe delimiters (no underscores) avoiding italic conflicts
	const inlineCodes: string[] = [];
	src = src.replace(/`([^`]+)`/g, (_m, code: string) => {
		inlineCodes.push("<code>" + escapeHtml(code) + "</code>");
		return "%%INLINECODE" + (inlineCodes.length - 1) + "%%";
	});

	// 3) Escape raw HTML outside code
	src = escapeHtml(src);

	// 4) Headers (#, ##, ###, ####)
	src = src
		.replace(/^#### (.*)$/gm, "<h4>$1</h4>")
		.replace(/^### (.*)$/gm, "<h3>$1</h3>")
		.replace(/^## (.*)$/gm, "<h2>$1</h2>")
		.replace(/^# (.*)$/gm, "<h1>$1</h1>");

	// 5) Horizontal rules
	src = src.replace(/^(---|[*]{3}|___)$/gm, "<hr>");

	// 6) Blockquotes
	src = src.replace(/^&gt;\s?(.*)$/gm, "<blockquote>$1</blockquote>");
	src = src.replace(/<\/blockquote>\n<blockquote>/g, "<br>");

	// 7) Text styles: bold, italic, strike
	src = src
		.replace(/~~(.*?)~~/g, "<del>$1</del>")
		.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
		.replace(/__(.*?)__/g, "<strong>$1</strong>")
		.replace(/\*(.*?)\*/g, "<em>$1</em>")
		.replace(/_(.*?)_/g, "<em>$1</em>");

	// 8) Links [text](https://...)
	src = src.replace(
		/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
		'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
	);

	// 9) Lists (- or * or numbered)
	const lines = src.split("\n");
	const grouped: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		const ulMatch = /^[-*]\s+(.*)$/.exec(line);
		const olMatch = /^\d+\.\s+(.*)$/.exec(line);
		if (ulMatch) {
			const items: string[] = [];
			while (i < lines.length) {
				const current = lines[i] ?? "";
				const m = /^[-*]\s+(.*)$/.exec(current);
				if (!m) break;
				items.push("<li>" + (m[1] ?? "") + "</li>");
				i++;
			}
			grouped.push('<ul class="tvs-cl-md-list">' + items.join("") + "</ul>");
		} else if (olMatch) {
			const items: string[] = [];
			while (i < lines.length) {
				const current = lines[i] ?? "";
				const m = /^\d+\.\s+(.*)$/.exec(current);
				if (!m) break;
				items.push("<li>" + (m[1] ?? "") + "</li>");
				i++;
			}
			grouped.push('<ol class="tvs-cl-md-list">' + items.join("") + "</ol>");
		} else {
			grouped.push(line);
			i++;
		}
	}
	src = grouped.join("\n");

	// 10) Line breaks
	src = src.replace(/\n/g, "<br>");

	// 11) Restore inline codes and code blocks
	src = src.replace(/%%INLINECODE(\d+)%%/g, (_m, idx: string) => inlineCodes[parseInt(idx, 10)] ?? "");
	src = src.replace(/%%CODEBLOCK(\d+)%%/g, (_m, idx: string) => codeBlocks[parseInt(idx, 10)] ?? "");

	return src;
}

export function parseRawChangelogMarkdown(markdownText: string): {
	introHtml: string;
	rawItems: RawChangelogItem[];
} {
	if (!markdownText) return { introHtml: "", rawItems: [] };
	const rawSections = markdownText.split(/^##\s+/m);
	let introHtml = "";
	const rawItems: RawChangelogItem[] = [];

	rawSections.forEach((sec, idx) => {
		if (idx === 0) {
			const cleanIntro = sec.replace(/^#\s+Changelog\s*/i, "").trim();
			if (cleanIntro) {
				introHtml =
					'<div class="tvs-cl-intro">' +
					renderChangelogMarkdown(cleanIntro) +
					"</div>";
			}
			return;
		}

		const firstLineEnd = sec.indexOf("\n");
		const headerLine = (firstLineEnd !== -1 ? sec.substring(0, firstLineEnd) : sec).trim();
		const bodyContent = (firstLineEnd !== -1 ? sec.substring(firstLineEnd + 1) : "").trim();

		// Match [1.16.8] - 2026-09-16 or [1.16.8] — 2026-09-16 or [Unreleased]
		const match = headerLine.match(/\[(.*?)\](?:\s*[-—]\s*(.*))?/);
		const ver = match && match[1] ? match[1] : headerLine;
		const date = match && match[2] ? match[2] : (ver.toLowerCase().includes("unreleased") ? "Unreleased" : "History");

		rawItems.push({ ver, date, bodyContent });
	});

	return { introHtml, rawItems };
}

export function parseChangelogVoiceBlocks(catBody: string): ChangelogVoiceBlock[] {
	if (!catBody) return [];
	// Anchored to line start (with optional leading bullet/spaces) to prevent inline false-positives
	const markerRegex = /(?:^|\r?\n)[ \t]*(?:[-*]\s*)?(\*\*(?:Plain|Humanis[\u00e9e]d?|Human|Technical|Technique)\*\*\s*:?\s*)/gi;
	const parts = catBody.split(markerRegex);
	if (parts.length <= 1) {
		return [{ type: "legacy", marker: "", content: catBody.trim() }];
	}
	const blocks: ChangelogVoiceBlock[] = [];
	if ((parts[0] ?? "").trim()) {
		blocks.push({ type: "legacy", marker: "", content: (parts[0] ?? "").trim() });
	}
	for (let i = 1; i < parts.length; i += 2) {
		const marker = (parts[i] ?? "").trim();
		const content = (parts[i + 1] ?? "").trim();
		if (!content) continue;
		const isPlain = /Plain|Human/i.test(marker);
		const isTech = /Tech/i.test(marker);
		const type: "plain" | "tech" | "legacy" = isPlain ? "plain" : (isTech ? "tech" : "legacy");
		blocks.push({ type, marker, content });
	}
	return blocks;
}

export function filterChangelogCatBody(catBody: string, viewMode: ChangelogViewMode): string {
	if (viewMode === "all") return catBody;
	const blocks = parseChangelogVoiceBlocks(catBody);
	if (blocks.length === 1 && blocks[0]?.type === "legacy") return catBody;

	let out = "";
	blocks.forEach((b) => {
		if (b.type === "legacy") {
			out += b.content + "\n\n";
		} else if (viewMode === "plain" && b.type === "plain") {
			const marker = b.marker.includes(":") ? b.marker : b.marker + " :";
			out += marker + " " + b.content + "\n\n";
		} else if (viewMode === "tech" && b.type === "tech") {
			const marker = b.marker.includes(":") ? b.marker : b.marker + " :";
			out += marker + " " + b.content + "\n\n";
		}
	});
	return out.trim();
}

export function formatChangelogBody(bodyContent: string): string {
	const catBlocks = bodyContent.split(/^###\s+/m);
	let html = "";

	catBlocks.forEach((block, bIdx) => {
		if (bIdx === 0) {
			if (block.trim()) {
				html += '<div class="tvs-cl-preamble">' + renderChangelogMarkdown(block.trim()) + "</div>";
			}
			return;
		}

		const bFirstLineEnd = block.indexOf("\n");
		const catName = (bFirstLineEnd !== -1 ? block.substring(0, bFirstLineEnd) : block).trim();
		const catBody = (bFirstLineEnd !== -1 ? block.substring(bFirstLineEnd + 1) : "").trim();

		const icon = CATEGORY_ICON_MAP[catName] ?? "📌";
		const headerClass = CATEGORY_CLASS_MAP[catName] ?? "tvs-cl-added";

		html += '<div class="tvs-cl-category-section">';
		html += '<div class="tvs-cl-sec-header ' + headerClass + '">' + icon + " " + escapeHtml(catName) + "</div>";

		const blocks = parseChangelogVoiceBlocks(catBody);
		blocks.forEach((b) => {
			if (b.type === "plain") {
				html +=
					'<div class="tvs-cl-voice-entry tvs-cl-voice-plain">' +
					'<div class="tvs-cl-voice-label"><span class="tvs-cl-tag tvs-cl-tag-plain">👤 Plain</span></div>' +
					'<div class="tvs-cl-voice-content">' +
					renderChangelogMarkdown(b.content) +
					"</div>" +
					"</div>";
			} else if (b.type === "tech") {
				html +=
					'<div class="tvs-cl-voice-entry tvs-cl-voice-tech">' +
					'<div class="tvs-cl-voice-label"><span class="tvs-cl-tag tvs-cl-tag-tech">💻 Technical</span></div>' +
					'<div class="tvs-cl-voice-content">' +
					renderChangelogMarkdown(b.content) +
					"</div>" +
					"</div>";
			} else {
				html += '<div class="tvs-cl-voice-entry tvs-cl-voice-legacy">' + renderChangelogMarkdown(b.content) + "</div>";
			}
		});
		html += "</div>";
	});

	return html;
}

export function buildChangelogVersionCard(item: RawChangelogItem): string {
	const isUnreleased =
		item.ver.toLowerCase().includes("unreleased") || item.ver.toLowerCase().includes("non publi\u00e9");
	const badgeClass = isUnreleased ? "tvs-cl-badge-unreleased" : "tvs-cl-badge-release";
	const labelVer = isUnreleased ? "⚠️ " + escapeHtml(item.ver) : "🏷️ " + escapeHtml(item.ver);
	const formattedBody = formatChangelogBody(item.bodyContent);

	return (
		'<div class="tvs-cl-version-card">' +
		'<div class="tvs-cl-version-card__header">' +
		'<span class="' +
		badgeClass +
		'">' +
		labelVer +
		"</span>" +
		'<span class="tvs-cl-version-card__date">📅 ' +
		escapeHtml(item.date) +
		"</span>" +
		"</div>" +
		'<div class="tvs-cl-body">' +
		formattedBody +
		"</div>" +
		"</div>"
	);
}

export function filterAndGroupChangelog(
	rawItems: RawChangelogItem[],
	options: ChangelogFilterOptions,
): FilteredChangelogResult {
	const uniqueVersions = rawItems.map((i) => i.ver).filter((v, idx, a) => v && a.indexOf(v) === idx);

	// 1) Filter items by version range
	let filteredItems = rawItems;
	if (options.versionFrom !== "all" || options.versionTo !== "all") {
		const allVers = rawItems.map((i) => i.ver);
		const fromIdx = options.versionFrom !== "all" ? allVers.indexOf(options.versionFrom) : 0;
		const toIdx = options.versionTo !== "all" ? allVers.indexOf(options.versionTo) : allVers.length - 1;
		if (fromIdx !== -1 && toIdx !== -1) {
			const start = Math.min(fromIdx, toIdx);
			const end = Math.max(fromIdx, toIdx);
			filteredItems = rawItems.slice(start, end + 1);
		}
	}

	// 2) Filter by category & search query & voice
	const processedItems: RawChangelogItem[] = [];

	filteredItems.forEach((item) => {
		const catBlocks = item.bodyContent.split(/^###\s+/m);
		let catContent = "";
		let hasMatchingCat = false;

		catBlocks.forEach((block, bIdx) => {
			if (bIdx === 0) return;

			const bFirstLineEnd = block.indexOf("\n");
			const catName = (bFirstLineEnd !== -1 ? block.substring(0, bFirstLineEnd) : block).trim();
			const catBody = (bFirstLineEnd !== -1 ? block.substring(bFirstLineEnd + 1) : "").trim();

			// Normalizing category match (e.g. Added / fallback mappings)
			const isCatActive =
				options.activeCats.has(catName) ||
				(catName === "Ajout\u00e9" && options.activeCats.has("Added")) ||
				(catName === "Modifi\u00e9" && options.activeCats.has("Changed")) ||
				(catName === "Corrig\u00e9" && options.activeCats.has("Fixed")) ||
				(catName === "Supprim\u00e9" && options.activeCats.has("Removed")) ||
				(catName === "S\u00e9curit\u00e9" && options.activeCats.has("Security"));

			if (!isCatActive) return;

			const filteredCatBody = filterChangelogCatBody(catBody, options.viewMode);
			if (filteredCatBody.trim()) {
				hasMatchingCat = true;
				catContent += "### " + catName + "\n" + filteredCatBody + "\n\n";
			}
		});

		if (!hasMatchingCat) return;

		const preamble = (catBlocks[0] ?? "").trim();
		const newBodyContent = (preamble ? preamble + "\n\n" : "") + catContent;

		if (options.searchQuery) {
			const fullText = (item.ver + " " + item.date + " " + newBodyContent).toLowerCase();
			if (!fullText.includes(options.searchQuery.toLowerCase())) return;
		}

		processedItems.push({
			ver: item.ver,
			date: item.date,
			bodyContent: newBodyContent.trim(),
		});
	});

	if (options.sortOrder === "asc") {
		processedItems.reverse();
	}

	// 3) Group by date
	const dateGroups: ChangelogDateGroup[] = [];
	const dateMap = new Map<string, ChangelogDateGroup>();

	processedItems.forEach((item) => {
		let group = dateMap.get(item.date);
		if (!group) {
			group = { date: item.date, versions: [] };
			dateMap.set(item.date, group);
			dateGroups.push(group);
		}
		group.versions.push(item);
	});

	return { processedItems, dateGroups, uniqueVersions };
}
