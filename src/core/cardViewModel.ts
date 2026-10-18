/** Pure model of the card view: which sections show, in which order, the view's settings, and the small derived values it displays. */

export type CardViewSection =
	| "title"
	| "list"
	| "description"
	| "due"
	| "labels"
	| "members"
	| "checklists"
	| "comments"
	| "customFields"
	| "attachments"
	| "cover";

/** Default order, close to Trello's own card layout. */
export const ALL_CARD_VIEW_SECTIONS: readonly CardViewSection[] = [
	"cover",
	"title",
	"list",
	"due",
	"labels",
	"members",
	"description",
	"checklists",
	"attachments",
	"customFields",
	"comments",
];

export type CardViewSections = Record<CardViewSection, boolean>;

/** Section names as the settings and the per-card dialog show them. */
export const CARD_VIEW_SECTION_LABELS: Record<CardViewSection, string> = {
	cover: "Cover image",
	title: "Title",
	list: "List",
	due: "Due date",
	labels: "Labels",
	members: "Members",
	description: "Description",
	checklists: "Checklists",
	attachments: "Attachments",
	customFields: "Custom fields",
	comments: "Comments",
};


/** What the view can change on the card. `archive` is the header button. */
export type CardViewEditableField =
	| "title"
	| "description"
	| "due"
	| "labels"
	| "members"
	| "list"
	| "checklists"
	| "comments"
	| "customFields"
	| "attachments"
	| "archive";

export const ALL_CARD_VIEW_EDITABLE_FIELDS: readonly CardViewEditableField[] = [
	"title",
	"description",
	"due",
	"labels",
	"members",
	"list",
	"checklists",
	"comments",
	"customFields",
	"attachments",
	"archive",
];

export interface CardViewSettings {
	/** Off: the view is not registered at the next start and makes no request. */
	enabled: boolean;
	openOnStartup: boolean;
	side: "left" | "right";
	/** Sections shown for every card. The cover is off by default (a heavy image). */
	sections: CardViewSections;
	sectionOrder: CardViewSection[];
	/** Per-card overrides of `sections`, by card id. */
	perCard: Record<string, Partial<CardViewSections>>;
	/** Master switch: off makes the view read-only. */
	allowEditing: boolean;
	editable: Record<CardViewEditableField, boolean>;
	/** How long a loaded card is reused before the next request. 0 = always reload. */
	cacheSeconds: number;
	/** How long the board's lists, labels, members and field definitions are reused. */
	boardCacheSeconds: number;
	/** Comments loaded with the card. 0 = none (and none requested). Trello allows at most 1000. */
	commentsLimit: number;
	/** Wait after a change of active note before the view follows it. */
	followDelayMs: number;
	/** Off: nothing is requested while the view is not visible. */
	refreshWhenHidden: boolean;
	/** Where a card lands in its new list. */
	movedCardPosition: "top" | "bottom";
	openLinksIn: "browser" | "desktop-app";
	renderMarkdown: boolean;
	confirmArchive: boolean;
	/** After an edit, update the note from its card. */
	pullAfterEdit: boolean;
	/** Show a section with nothing in it ("No labels") instead of hiding it. */
	showEmptySections: boolean;
	/** moment.js format of dates; empty = the local format. */
	dateFormat: string;
	/** A due date closer than this many hours is "soon". */
	dueSoonHours: number;
}

export const COMMENTS_LIMIT_CEILING = 1000;

export const DEFAULT_CARD_VIEW_SETTINGS: CardViewSettings = {
	enabled: true,
	openOnStartup: false,
	side: "right",
	sections: Object.fromEntries(ALL_CARD_VIEW_SECTIONS.map((s) => [s, s !== "cover"])) as CardViewSections,
	sectionOrder: [...ALL_CARD_VIEW_SECTIONS],
	perCard: {},
	allowEditing: true,
	editable: Object.fromEntries(ALL_CARD_VIEW_EDITABLE_FIELDS.map((f) => [f, true])) as Record<CardViewEditableField, boolean>,
	cacheSeconds: 60,
	boardCacheSeconds: 600,
	commentsLimit: 20,
	followDelayMs: 250,
	refreshWhenHidden: false,
	movedCardPosition: "top",
	openLinksIn: "browser",
	renderMarkdown: true,
	confirmArchive: true,
	pullAfterEdit: false,
	showEmptySections: false,
	dateFormat: "",
	dueSoonHours: 24,
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function booleans<K extends string>(raw: unknown, keys: readonly K[], fallback: Record<K, boolean>): Record<K, boolean> {
	const input = isRecord(raw) ? raw : {};
	return Object.fromEntries(keys.map((key) => [key, typeof input[key] === "boolean" ? input[key] : fallback[key]])) as Record<K, boolean>;
}

const number = (value: unknown, fallback: number, min: number, max = Number.POSITIVE_INFINITY): number =>
	typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** The order kept as saved - unknown or repeated sections dropped, missing ones added at the end. */
export function normalizeSectionOrder(raw: unknown): CardViewSection[] {
	const seen = new Set<CardViewSection>();
	for (const value of Array.isArray(raw) ? raw : []) {
		if (ALL_CARD_VIEW_SECTIONS.includes(value as CardViewSection)) seen.add(value as CardViewSection);
	}
	for (const section of ALL_CARD_VIEW_SECTIONS) seen.add(section);
	return [...seen];
}

/** Card view settings out of untrusted persisted data: a missing or wrong value falls back to its default. */
export function normalizeCardViewSettings(raw: unknown): CardViewSettings {
	const d = DEFAULT_CARD_VIEW_SETTINGS;
	const input = isRecord(raw) ? raw : {};
	const perCard: Record<string, Partial<CardViewSections>> = {};
	if (isRecord(input.perCard)) {
		for (const [cardId, override] of Object.entries(input.perCard)) {
			if (!isRecord(override)) continue;
			const clean = Object.fromEntries(
				ALL_CARD_VIEW_SECTIONS.filter((s) => typeof override[s] === "boolean").map((s) => [s, override[s]]),
			) as Partial<CardViewSections>;
			if (Object.keys(clean).length > 0) perCard[cardId] = clean;
		}
	}
	return {
		enabled: input.enabled !== false,
		openOnStartup: input.openOnStartup === true,
		side: input.side === "left" ? "left" : d.side,
		sections: booleans(input.sections, ALL_CARD_VIEW_SECTIONS, d.sections),
		sectionOrder: normalizeSectionOrder(input.sectionOrder),
		perCard,
		allowEditing: input.allowEditing !== false,
		editable: booleans(input.editable, ALL_CARD_VIEW_EDITABLE_FIELDS, d.editable),
		cacheSeconds: number(input.cacheSeconds, d.cacheSeconds, 0),
		boardCacheSeconds: number(input.boardCacheSeconds, d.boardCacheSeconds, 0),
		commentsLimit: Math.round(number(input.commentsLimit, d.commentsLimit, 0, COMMENTS_LIMIT_CEILING)),
		followDelayMs: number(input.followDelayMs, d.followDelayMs, 0),
		refreshWhenHidden: input.refreshWhenHidden === true,
		movedCardPosition: input.movedCardPosition === "bottom" ? "bottom" : d.movedCardPosition,
		openLinksIn: input.openLinksIn === "desktop-app" ? "desktop-app" : d.openLinksIn,
		renderMarkdown: input.renderMarkdown !== false,
		confirmArchive: input.confirmArchive !== false,
		pullAfterEdit: input.pullAfterEdit === true,
		showEmptySections: input.showEmptySections === true,
		dateFormat: typeof input.dateFormat === "string" ? input.dateFormat : d.dateFormat,
		dueSoonHours: number(input.dueSoonHours, d.dueSoonHours, 0),
	};
}

/** Sections to draw, in order: the global choice, overridden card by card. */
export function visibleSections(
	order: readonly CardViewSection[],
	global: CardViewSections,
	perCard: Partial<CardViewSections> | undefined,
): CardViewSection[] {
	return order.filter((section) => perCard?.[section] ?? global[section]);
}

export type SectionOverride = "default" | "show" | "hide";

/** The card's override for one section: absent from `perCard` means "default". */
export function sectionOverride(perCard: Record<string, Partial<CardViewSections>>, cardId: string, section: CardViewSection): SectionOverride {
	const value = perCard[cardId]?.[section];
	return value === undefined ? "default" : value ? "show" : "hide";
}

/** Sets one section's override for a card in place; a card left with no override loses its entry. */
export function setSectionOverride(
	perCard: Record<string, Partial<CardViewSections>>,
	cardId: string,
	section: CardViewSection,
	state: SectionOverride,
): void {
	const entry = { ...perCard[cardId] };
	if (state === "default") delete entry[section];
	else entry[section] = state === "show";
	if (Object.keys(entry).length === 0) Reflect.deleteProperty(perCard, cardId);
	else perCard[cardId] = entry;
}

export function checklistProgress(checklist: { checkItems: { state: string }[] }): { done: number; total: number } {
	return { done: checklist.checkItems.filter((item) => item.state === "complete").length, total: checklist.checkItems.length };
}

export type DueState = "none" | "complete" | "overdue" | "soon" | "later";

export function dueState(due: string | null | undefined, dueComplete: boolean | undefined, now: number, soonHours: number): DueState {
	if (!due) return "none";
	if (dueComplete) return "complete";
	const at = new Date(due).getTime();
	if (Number.isNaN(at)) return "none";
	if (at < now) return "overdue";
	return at - now <= soonHours * 3_600_000 ? "soon" : "later";
}

/** A due date as a `datetime-local` input holds it (local time, minutes); "" when there is none. */
export function dueToInputValue(due: string | null | undefined): string {
	const at = due ? new Date(due) : null;
	if (!at || Number.isNaN(at.getTime())) return "";
	const p = (n: number) => String(n).padStart(2, "0");
	return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}T${p(at.getHours())}:${p(at.getMinutes())}`;
}

/** The reverse: an input value to the ISO date Trello wants; `null` for an empty or unreadable one. */
export function inputValueToDue(value: string): string | null {
	const at = value === "" ? null : new Date(value);
	return at && !Number.isNaN(at.getTime()) ? at.toISOString() : null;
}

/** A card's url, as a Trello desktop-app link (`trello://`) when asked for. */
export function cardLink(url: string, target: "browser" | "desktop-app"): string {
	return target === "desktop-app" ? url.replace(/^https:\/\//, "trello://") : url;
}
