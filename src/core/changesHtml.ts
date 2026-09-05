import type { AuditEntry } from "./auditAction";
import { cardDisplayLabel, entryTime, groupChangesByDayThenCard } from "./auditReport";

/** An `AuditEntry` with its author's avatar already resolved — `null` when there is none or it failed to download. */
export interface ChangesHtmlEntry extends AuditEntry {
	avatarDataUri: string | null;
}

export interface ChangesHtmlInput {
	timestamp: string;
	entries: readonly ChangesHtmlEntry[];
}

/** Escapes text for safe use inside HTML content and double-quoted attributes — card names/details/author names are untrusted Trello data. */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function renderAvatar(entry: ChangesHtmlEntry): string {
	if (entry.avatarDataUri) {
		return `<img class="tvs-avatar" src="${escapeHtml(entry.avatarDataUri)}" alt="${escapeHtml(entry.author)}">`;
	}
	const initial = entry.author.trim().charAt(0).toUpperCase() || "?";
	return `<span class="tvs-avatar tvs-avatar--fallback">${escapeHtml(initial)}</span>`;
}

const STYLE = `
	body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; background: #fff; }
	h1 { font-size: 1.4rem; }
	h2 { font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: .25rem; }
	h3 { font-size: 1rem; margin-top: 1.25rem; color: #444; }
	.tvs-meta { color: #666; }
	.tvs-entry { display: flex; align-items: center; gap: .6rem; padding: .35rem 0; }
	.tvs-avatar { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
	.tvs-avatar--fallback { display: inline-flex; align-items: center; justify-content: center; background: #6c6cf0; color: #fff; font-weight: 600; }
	.tvs-time { color: #888; font-variant-numeric: tabular-nums; margin-right: .4rem; }
	.tvs-author { color: #666; font-style: italic; margin-left: .4rem; }
	@media (prefers-color-scheme: dark) {
		body { color: #e8e8e8; background: #1e1e1e; }
		h2 { border-bottom-color: #3a3a3a; }
		h3 { color: #bbb; }
		.tvs-meta, .tvs-time, .tvs-author { color: #999; }
	}
`.trim();

/** Self-contained HTML page of the Trello change log, avatars embedded as data urls — works offline, one file. */
export function buildChangesHtml(input: ChangesHtmlInput): string {
	const body: string[] = [`<h1>🕘 Trello Change Log</h1>`, `<p class="tvs-meta">${escapeHtml(input.timestamp)} · times in UTC</p>`];

	if (input.entries.length === 0) {
		body.push("<p>✅ No change since the last run.</p>");
	} else {
		for (const [day, byCard] of groupChangesByDayThenCard(input.entries)) {
			body.push(`<h2>📅 ${escapeHtml(day)}</h2>`);
			for (const [cardName, entries] of byCard) {
				body.push(`<h3>🗂️ ${cardDisplayLabel(cardName, escapeHtml)}</h3>`, "<ul>");
				for (const entry of entries) {
					body.push(
						`<li class="tvs-entry">${renderAvatar(entry)}` +
							`<span><span class="tvs-time">${escapeHtml(entryTime(entry))}</span>${escapeHtml(entry.detail)}` +
							`<span class="tvs-author">${escapeHtml(entry.author)}</span></span></li>`,
					);
				}
				body.push("</ul>");
			}
		}
	}

	return [
		"<!doctype html>",
		'<html lang="en">',
		"<head>",
		'<meta charset="utf-8">',
		"<title>Trello Change Log</title>",
		`<style>${STYLE}</style>`,
		"</head>",
		"<body>",
		...body,
		"</body>",
		"</html>",
		"",
	].join("\n");
}
