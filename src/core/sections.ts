import { isSameCardName } from "./cardHistoryMatch";
import { notesInFolder } from "./fileName";
import { normalizeLabelName } from "./labelRef";

/**
 * Sections of a Trello list. A "separator" card (one carrying the configured label) heads a section;
 * the cards after it, up to the next separator, belong to it. Pure: no network, no vault.
 */

/** Default frontmatter key naming the section a note's card goes in — configurable via `sectionFrontmatterKey`. */
export const DEFAULT_SECTION_KEY = "trello_section";

export type SectionPlacement = "first" | "last";
export const SECTION_PLACEMENTS: readonly SectionPlacement[] = ["first", "last"];
export const DEFAULT_SECTION_PLACEMENT: SectionPlacement = "last";

/** Where a note names its section: its property, its first-level subfolder under the mapped folder, or the property first and the subfolder otherwise. */
export type SectionSource = "auto" | "frontmatter" | "subfolder";
export const SECTION_SOURCES: readonly SectionSource[] = ["auto", "frontmatter", "subfolder"];
export const DEFAULT_SECTION_SOURCE: SectionSource = "auto";

export interface SectionRules {
	labelName: string;
	placement: SectionPlacement;
	source: SectionSource;
	frontmatterKey: string;
}

/** The rules the settings describe, or `null` while the separator label is empty: the feature is off. */
export function sectionRulesFrom(settings: {
	separatorLabelName: string;
	separatorPlacement: SectionPlacement;
	sectionSource: SectionSource;
	sectionFrontmatterKey: string;
}): SectionRules | null {
	const labelName = settings.separatorLabelName.trim();
	return labelName === ""
		? null
		: {
				labelName,
				placement: settings.separatorPlacement,
				source: settings.sectionSource,
				frontmatterKey: settings.sectionFrontmatterKey,
			};
}

/** The part of a card this module reads — `TrelloCard` satisfies it. */
export interface SectionCard {
	name: string;
	/** Trello's ordering key; absent sorts last. */
	pos?: number;
	labels?: readonly { name: string }[];
}

export interface Section<T extends SectionCard = SectionCard> {
	/** `null` only for the cards that sit before the first separator: that section is never targeted. */
	separator: T | null;
	/** In list order. */
	cards: T[];
}

export function isSeparatorCard(card: SectionCard, labelName: string): boolean {
	const wanted = normalizeLabelName(labelName);
	return wanted !== "" && (card.labels ?? []).some((label) => normalizeLabelName(label.name) === wanted);
}

function byPos(a: SectionCard, b: SectionCard): number {
	const left = a.pos ?? Number.POSITIVE_INFINITY;
	const right = b.pos ?? Number.POSITIVE_INFINITY;
	return left < right ? -1 : left > right ? 1 : 0;
}

/** Cuts a list into sections, in list order. No cards at all gives no sections. */
export function splitSections<T extends SectionCard>(cards: readonly T[], isSeparator: (card: T) => boolean): Section<T>[] {
	const sections: Section<T>[] = [];
	for (const card of [...cards].sort(byPos)) {
		if (isSeparator(card)) {
			sections.push({ separator: card, cards: [] });
			continue;
		}
		let current = sections.at(-1);
		if (!current) {
			current = { separator: null, cards: [] };
			sections.push(current);
		}
		current.cards.push(card);
	}
	return sections;
}

function propertySection(value: unknown): string | null {
	// A section named "2024" is read by YAML as a number.
	const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
	return text.trim() === "" ? null : text.trim();
}

/** The deepest of `folders` that holds the note, or `undefined` when none does: the folder a note's subfolder section is read under. */
export function mappingFolderFor(path: string, folders: readonly string[]): string | undefined {
	return folders.filter((folder) => notesInFolder([{ path }], folder).length > 0).sort((a, b) => b.length - a.length)[0];
}

/** First folder under the mapped folder when the note sits deeper than the mapped folder itself; `undefined` mapped folder = unknown, so none. */
function subfolderSection(path: string, mappingFolder: string | undefined): string | null {
	if (mappingFolder === undefined) return null;
	const root = mappingFolder.replace(/^\/+|\/+$/g, "");
	const prefix = root === "" ? "" : `${root}/`;
	if (!path.startsWith(prefix)) return null;
	const segments = path.slice(prefix.length).split("/");
	return segments.length > 1 ? (segments[0] ?? null) : null;
}

/** The section name a note asks for, or `null` when it names none (the card then goes to the end of the list, as it always did). */
export function sectionOfNote(
	path: string,
	mappingFolder: string | undefined,
	frontmatter: Record<string, unknown> | null,
	rules: Pick<SectionRules, "source" | "frontmatterKey">,
): string | null {
	const property = rules.source === "subfolder" ? null : propertySection(frontmatter?.[rules.frontmatterKey]);
	return property !== null || rules.source === "frontmatter" ? property : subfolderSection(path, mappingFolder);
}

/** Halfway between two positions; `"bottom"` when either is unknown, so a card never gets a NaN position. */
function middle(left: number | undefined, right: number | undefined): number | "bottom" {
	return left !== undefined && right !== undefined && Number.isFinite(left) && Number.isFinite(right) ? (left + right) / 2 : "bottom";
}

/**
 * The `pos` that puts a card first or last in the section headed by a separator named `sectionName`
 * (compared like a note name, see `isSameCardName`). `"bottom"` when that section is the last one and
 * the card goes last (or it is empty and goes first); `null` when no separator carries that name.
 */
export function positionInSection(
	sections: readonly Section[],
	sectionName: string,
	placement: SectionPlacement,
	maxNameLength?: number,
): number | "bottom" | null {
	const index = sections.findIndex(
		(section) => section.separator !== null && isSameCardName(section.separator.name, sectionName, maxNameLength),
	);
	const section = sections[index];
	if (!section?.separator) return null;
	const next = sections[index + 1]?.separator ?? undefined;
	if (placement === "first") {
		const after = section.cards[0] ?? next;
		return after ? middle(section.separator.pos, after.pos) : "bottom";
	}
	const before = section.cards.at(-1) ?? section.separator;
	return next ? middle(before.pos, next.pos) : "bottom";
}

export interface SectionTarget {
	pos: number | "bottom";
	/** The section the card goes in; `null` when the note names none, or none exists. */
	section: string | null;
	/** The section the note names although no separator carries that name: the card goes to the end of the list. */
	missing: string | null;
}

/** Where the card of one note goes: its section if it names one that exists, the end of the list otherwise. */
export function sectionTarget(
	sections: readonly Section[],
	path: string,
	mappingFolder: string | undefined,
	frontmatter: Record<string, unknown> | null,
	rules: SectionRules,
	maxNameLength?: number,
): SectionTarget {
	const name = sectionOfNote(path, mappingFolder, frontmatter, rules);
	if (name === null) return { pos: "bottom", section: null, missing: null };
	const pos = positionInSection(sections, name, rules.placement, maxNameLength);
	return pos === null ? { pos: "bottom", section: null, missing: name } : { pos, section: name, missing: null };
}

/** The journal line (after the note's name) for a note whose section no separator carries. */
export function missingSectionMessage(section: string): string {
	return `no separator named "${section}" in the list, the card goes to the end of the list`;
}

/** Files a created card into the section its returned `pos` falls in, so the next placement of the same pass counts it. */
export function insertCard<T extends SectionCard>(sections: Section<T>[], card: T): void {
	let target = sections.at(-1);
	if (!target) {
		sections.push({ separator: null, cards: [card] });
		return;
	}
	const { pos } = card;
	if (pos !== undefined) {
		target =
			sections.filter((section) => section.separator === null || (section.separator.pos ?? Number.POSITIVE_INFINITY) < pos).at(-1) ??
			sections[0];
	}
	target?.cards.push(card);
	target?.cards.sort(byPos);
}
