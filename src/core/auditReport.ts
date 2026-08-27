/**
 * Markdown builders for the two audit reports.
 *
 * Everything here is pure: the timestamp arrives as a string so a report is
 * reproducible, and the previously ticked checkboxes arrive as a set so the
 * user's manual triage survives a regeneration.
 */

/** Stable heading used to locate and replace a previous link report. */
export const LINK_REPORT_HEADING = "# 📊 Rapport de liens Trello";
/** Stable heading used to locate and replace a previous location report. */
export const LOCATION_REPORT_HEADING = "# 📍 Comparatif des emplacements";

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
	const scope = input.scope === "" ? "tout le coffre" : `\`${input.scope}\``;

	const out: string[] = [
		LINK_REPORT_HEADING,
		`> ${input.timestamp} · Périmètre : ${scope}`,
		"",
		`## 🚨 Cartes Trello non liées (${input.orphanCards.length})`,
		"",
	];

	if (input.orphanCards.length === 0) {
		out.push("✅ Aucune carte orpheline.", "");
	} else {
		for (const [listId, cards] of groupBy(input.orphanCards, (c) => c.idList)) {
			out.push(`### 📋 ${input.listNames.get(listId) ?? "Liste inconnue"}`);
			for (const card of cards) out.push(`- [${tick(card.url)}] [${card.name}](${card.url})`);
			out.push("");
		}
	}

	out.push("---", `## 👻 Notes fantômes (${input.phantomNotes.length})`, "");
	if (input.phantomNotes.length === 0) {
		out.push("✅ Aucun lien brisé.", "");
	} else {
		for (const [folder, notes] of groupBy(input.phantomNotes, (n) => n.folder || "Racine")) {
			out.push(`### 🏚️ ${folder}`);
			for (const note of notes) {
				out.push(`- [${tick(note.path)}] [[${note.path}|${note.basename}]] — carte \`${note.cardId}\` introuvable`);
			}
			out.push("");
		}
	}

	out.push("---", `## 📝 Notes non liées (${input.unlinkedNotes.length})`, "");
	if (input.unlinkedNotes.length === 0) {
		out.push("✅ Toutes les notes sont liées.", "");
	} else {
		for (const [folder, notes] of groupBy(input.unlinkedNotes, (n) => n.folder || "Racine")) {
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
	const scope = input.scope === "" ? "tout le coffre" : `\`${input.scope}\``;
	const out: string[] = [LOCATION_REPORT_HEADING, `> ${input.timestamp} · Périmètre : ${scope}`, ""];

	if (input.rows.length === 0) {
		out.push("✅ Aucune note liée à comparer.", "");
	}

	for (const [listName, rows] of groupBy(input.rows, (r) => r.listName)) {
		out.push(`### 📋 ${listName}`, "", "| Carte Trello | Dossier actuel |", "| :--- | :--- |");
		for (const row of rows) {
			out.push(`| ${row.cardName.replace(/\|/g, "-")} | 📂 ${row.folder} |`);
		}
		out.push("");
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
