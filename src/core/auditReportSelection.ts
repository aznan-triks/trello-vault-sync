/**
 * Reads a link report back into actionable groups — pure, so "which items did
 * the user leave unchecked, in which Trello list / folder" is a plain unit
 * test, independent of the command that acts on it.
 *
 * Phantom notes (🏚️, broken card link) are deliberately not returned: they
 * already carry a card id, and recreating their card belongs to "Create Trello
 * cards from phantom notes", which handles that existing link.
 */

import {
	LINK_REPORT_HEADING,
	ORPHAN_CARD_GROUP_PREFIX,
	PHANTOM_NOTE_GROUP_PREFIX,
	UNLINKED_NOTE_GROUP_PREFIX,
	reportItemKeys,
} from "./auditReport";

/** Orphan cards (key = card url) become notes; unlinked notes (key = note path) become cards. */
export type ReportGroupKind = "orphan-cards" | "unlinked-notes";

export interface ReportGroup {
	kind: ReportGroupKind;
	/** Trello list name for orphan cards, folder ("Root" for the vault root) for unlinked notes. */
	name: string;
	/** Keys of the items left unchecked, in report order. */
	unchecked: string[];
	/** How many items of the group the user ticked — shown so the picker explains the counts. */
	checked: number;
}

export type ReportGroupSelection = "all" | { kind: ReportGroupKind; name: string };

const ITEM_LINE = /^[-*]\s\[([ xX])\]\s(.*)$/;

/** Groups of the link report found in `markdown`, or `null` when the note holds no link report at all. */
export function parseLinkReportGroups(markdown: string): ReportGroup[] | null {
	const start = markdown.indexOf(LINK_REPORT_HEADING);
	if (start === -1) return null;

	const groups: ReportGroup[] = [];
	let current: ReportGroup | null = null;
	const open = (kind: ReportGroupKind, name: string): ReportGroup => {
		const existing = groups.find((group) => group.kind === kind && group.name === name);
		if (existing) return existing;
		const created: ReportGroup = { kind, name, unchecked: [], checked: 0 };
		groups.push(created);
		return created;
	};

	for (const rawLine of markdown.slice(start).split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		if (line.startsWith(ORPHAN_CARD_GROUP_PREFIX)) {
			current = open("orphan-cards", line.slice(ORPHAN_CARD_GROUP_PREFIX.length).trim());
		} else if (line.startsWith(UNLINKED_NOTE_GROUP_PREFIX)) {
			current = open("unlinked-notes", line.slice(UNLINKED_NOTE_GROUP_PREFIX.length).trim());
		} else if (line.startsWith(PHANTOM_NOTE_GROUP_PREFIX) || line.startsWith("#")) {
			current = null;
		} else if (current) {
			const item = line.match(ITEM_LINE);
			if (!item) continue;
			const key = reportItemKeys(item[2] ?? "")[0];
			if (key === undefined) continue;
			if (item[1] === " ") current.unchecked.push(key);
			else current.checked++;
		}
	}
	return groups;
}

/** Unchecked keys of the chosen group (or of every group), split by direction. */
export function selectUncheckedKeys(
	groups: readonly ReportGroup[],
	selection: ReportGroupSelection,
): { cardKeys: string[]; noteKeys: string[] } {
	const chosen =
		selection === "all"
			? groups
			: groups.filter((group) => group.kind === selection.kind && group.name === selection.name);
	return {
		cardKeys: chosen.filter((group) => group.kind === "orphan-cards").flatMap((group) => group.unchecked),
		noteKeys: chosen.filter((group) => group.kind === "unlinked-notes").flatMap((group) => group.unchecked),
	};
}

/**
 * Resolves report keys against live data — a key missing from `live` (card
 * since linked or deleted, note since linked, moved or deleted) is skipped,
 * never acted on from the stale report alone.
 */
export function matchReportKeys<T>(keys: readonly string[], live: ReadonlyMap<string, T>): { matched: T[]; skipped: string[] } {
	const matched: T[] = [];
	const skipped: string[] = [];
	for (const key of keys) {
		const item = live.get(key);
		if (item === undefined) skipped.push(key);
		else matched.push(item);
	}
	return { matched, skipped };
}
