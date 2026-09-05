/**
 * Markdown builders for the three audit reports.
 *
 * Everything here is pure: the timestamp arrives as a string so a report is
 * reproducible, and the previously ticked checkboxes arrive as a set so the
 * user's manual triage survives a regeneration.
 */

import type { AuditEntry } from "./auditAction";

/** Stable heading used to locate and replace a previous link report. */
export const LINK_REPORT_HEADING = "# 📊 Trello Link Report";
/** Stable heading used to locate and replace a previous location report. */
export const LOCATION_REPORT_HEADING = "# 📍 Location Comparison";
/** Stable heading used to locate and replace a previous change log report. */
export const CHANGES_REPORT_HEADING = "# 🕘 Change Log";

const CHECKED_LINE = /^[-*]\s\[x\]\s(.*)$/gim;
const TRELLO_URL = /\((https:\/\/trello\.com\/[^)]+)\)/;
const WIKILINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/;

/** Keys (card urls, note paths) the user had already ticked in a previous report. */
export function extractCheckedKeys(markdown: string): Set<string> {
	const keys = new Set<string>();
	for (const match of markdown.matchAll(CHECKED_LINE)) {
		const line = match[1] ?? "";
		const url = line.match(TRELLO_URL);
		if (url?.[1]) keys.add(url[1]);
		const link = line.match(WIKILINK);
		if (link?.[1]) keys.add(link[1]);
	}
	return keys;
}

export interface ReportNote {
	path: string;
	basename: string;
	folder: string;
	cardId: string | null;
}

export interface ReportCard {
	id: string;
	name: string;
	url: string;
	idList: string;
}

export interface LinkReportInput {
	/** Folder the audit covered, or "" for the whole vault. */
	scope: string;
	timestamp: string;
	listNames: Map<string, string>;
	orphanCards: readonly ReportCard[];
	phantomNotes: readonly ReportNote[];
	unlinkedNotes: readonly ReportNote[];
	checked: ReadonlySet<string>;
}

/** Escape characters that would let an untrusted Trello card name break out of markdown link/table syntax. */
export function escapeMarkdown(text: string): string {
	return text.replace(/[\\[\]()]/g, "\\$&");
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const bucket = groups.get(key(item));
		if (bucket) bucket.push(item);
		else groups.set(key(item), [item]);
	}
	return groups;
}

/** Report of cards without notes, notes with broken links, and notes without cards. */
export function buildLinkReport(input: LinkReportInput): string {
	const tick = (key: string) => (input.checked.has(key) ? "x" : " ");
	const scope = input.scope === "" ? "the whole vault" : `\`${input.scope}\``;

	const out: string[] = [
		LINK_REPORT_HEADING,
		`> ${input.timestamp} · Scope: ${scope}`,
		"",
		`## 🚨 Orphan Trello cards (${input.orphanCards.length})`,
		"",
	];

	if (input.orphanCards.length === 0) {
		out.push("✅ No orphan card.", "");
	} else {
		for (const [listId, cards] of groupBy(input.orphanCards, (c) => c.idList)) {
			out.push(`### 📋 ${input.listNames.get(listId) ?? "Unknown list"}`);
			for (const card of cards) out.push(`- [${tick(card.url)}] [${escapeMarkdown(card.name)}](${card.url})`);
			out.push("");
		}
	}

	out.push("---", `## 👻 Phantom notes (${input.phantomNotes.length})`, "");
	if (input.phantomNotes.length === 0) {
		out.push("✅ No broken link.", "");
	} else {
		for (const [folder, notes] of groupBy(input.phantomNotes, (n) => n.folder || "Root")) {
			out.push(`### 🏚️ ${folder}`);
			for (const note of notes) {
				out.push(`- [${tick(note.path)}] [[${note.path}|${note.basename}]] — card \`${note.cardId}\` not found`);
			}
			out.push("");
		}
	}

	out.push("---", `## 📝 Unlinked notes (${input.unlinkedNotes.length})`, "");
	if (input.unlinkedNotes.length === 0) {
		out.push("✅ Every note is linked.", "");
	} else {
		for (const [folder, notes] of groupBy(input.unlinkedNotes, (n) => n.folder || "Root")) {
			out.push(`### 📁 ${folder}`);
			for (const note of notes) out.push(`- [${tick(note.path)}] [[${note.path}|${note.basename}]]`);
			out.push("");
		}
	}

	return out.join("\n").trimEnd() + "\n";
}

export interface LocationRow {
	listName: string;
	cardName: string;
	folder: string;
	notePath: string;
}

export interface LocationReportInput {
	scope: string;
	timestamp: string;
	rows: readonly LocationRow[];
}

/** Table of where each linked card's note actually lives, grouped by Trello list. */
export function buildLocationReport(input: LocationReportInput): string {
	const scope = input.scope === "" ? "the whole vault" : `\`${input.scope}\``;
	const out: string[] = [LOCATION_REPORT_HEADING, `> ${input.timestamp} · Scope: ${scope}`, ""];

	if (input.rows.length === 0) {
		out.push("✅ No linked note to compare.", "");
	}

	for (const [listName, rows] of groupBy(input.rows, (r) => r.listName)) {
		out.push(`### 📋 ${listName}`, "", "| Trello card | Current folder |", "| :--- | :--- |");
		for (const row of rows) {
			out.push(`| ${escapeMarkdown(row.cardName.replace(/\|/g, "-"))} | 📂 ${row.folder} |`);
		}
		out.push("");
	}

	return out.join("\n").trimEnd() + "\n";
}

export interface ChangesReportInput {
	timestamp: string;
	entries: readonly AuditEntry[];
}

/**
 * Groups entries by UTC calendar day (most recent first), then by raw card
 * name within each day (insertion order — entries arrive newest-first from
 * the Trello API, so the first event seen for a card is already its most
 * recent one that day). Format-agnostic on purpose: the card key is the raw
 * `cardName` ("" when missing — Trello never allows a blank card name, so
 * "" can never collide with a real one), left unescaped here. Each renderer
 * (Markdown, HTML) decides its own display label and escaping at render time.
 */
export function groupChangesByDayThenCard<T extends AuditEntry>(entries: readonly T[]): Map<string, Map<string, T[]>> {
	const byDay = groupBy(entries, (entry) => entry.date.slice(0, 10));
	const sortedDays = [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a));
	return new Map(sortedDays.map(([day, dayEntries]) => [day, groupBy(dayEntries, (entry) => entry.cardName)]));
}

/** Display label for a `groupChangesByDayThenCard` card key — shared by the Markdown and HTML renderers so the "(no card)" fallback and the escaping rule live in one place. */
export function cardDisplayLabel(cardName: string, escape: (text: string) => string): string {
	return cardName === "" ? "(no card)" : escape(cardName);
}

/** `HH:mm` portion of a Trello action's ISO 8601 date (always UTC) — shared by the Markdown and HTML renderers. */
export function entryTime(entry: AuditEntry): string {
	return entry.date.slice(11, 16);
}

/** Trello board activity since the last run, grouped by day (most recent first) then by card. */
export function buildChangesReport(input: ChangesReportInput): string {
	const out: string[] = [CHANGES_REPORT_HEADING, `> ${input.timestamp} · times in UTC`, ""];

	if (input.entries.length === 0) {
		out.push("✅ No change since the last run.", "");
	} else {
		for (const [day, byCard] of groupChangesByDayThenCard(input.entries)) {
			out.push(`### 📅 ${day}`, "");
			for (const [cardName, entries] of byCard) {
				out.push(`#### 🗂️ ${cardDisplayLabel(cardName, escapeMarkdown)}`);
				for (const entry of entries) {
					out.push(`- **${entryTime(entry)}** · ${escapeMarkdown(entry.detail)} — _${escapeMarkdown(entry.author)}_`);
				}
				out.push("");
			}
		}
	}

	return out.join("\n").trimEnd() + "\n";
}

/** Replace a previous report in a note, or append it when there is none. */
export function mergeReport(existing: string, report: string, heading: string): string {
	const index = existing.indexOf(heading);
	if (index !== -1) return existing.slice(0, index) + report;
	if (existing.trim() === "") return report;
	return `${existing.trimEnd()}\n\n${report}`;
}
