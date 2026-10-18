/** What happened to a note's card on Trello since the last sync. */
export type CardChange = "moved" | "archived" | "deleted";
export type OnCardMoved = "move-note" | "keep" | "trash";
export type OnCardArchived = "unlink" | "keep" | "archive-folder" | "trash";
export type OnCardDeleted = "unlink" | "keep" | "trash";

export interface CardFateRules {
	onCardMoved: OnCardMoved;
	onCardArchived: OnCardArchived;
	onCardDeleted: OnCardDeleted;
	/** Destination of `onCardArchived: "archive-folder"`; "" behaves as `keep`. */
	archiveFolder: string;
}

export const DEFAULT_CARD_FATE_RULES: CardFateRules = {
	onCardMoved: "move-note",
	onCardArchived: "unlink",
	onCardDeleted: "unlink",
	archiveFolder: "",
};

export type NoteFate =
	| { action: "keep"; reason?: string }
	| { action: "unlink" }
	| { action: "trash" }
	| { action: "move"; folder: string };

/** The single decision every engine applies to a note whose card changed — pure, no IO. */
export function decideNoteFate(
	change: CardChange,
	rules: CardFateRules,
	context: { mappedFolderOfNewList: string | null; trashAllowed: boolean },
): NoteFate {
	const choice = change === "moved" ? rules.onCardMoved : change === "archived" ? rules.onCardArchived : rules.onCardDeleted;
	if (choice === "trash") {
		return context.trashAllowed ? { action: "trash" } : { action: "keep", reason: "trash disabled for this folder" };
	}
	if (choice === "unlink") return { action: "unlink" };
	if (choice === "move-note") {
		return context.mappedFolderOfNewList === null
			? { action: "keep", reason: "new list not mapped" }
			: { action: "move", folder: context.mappedFolderOfNewList };
	}
	if (choice === "archive-folder") {
		return rules.archiveFolder === ""
			? { action: "keep", reason: "no archive folder set" }
			: { action: "move", folder: rules.archiveFolder };
	}
	return { action: "keep" };
}

const MOVED: readonly string[] = ["move-note", "keep", "trash"];
const ARCHIVED: readonly string[] = ["unlink", "keep", "archive-folder", "trash"];
const DELETED: readonly string[] = ["unlink", "keep", "trash"];

/** An enumeration value from raw `data.json`, or `fallback` when unknown. */
function pick<T extends string>(value: unknown, allowed: readonly string[], fallback: T): T {
	return typeof value === "string" && allowed.includes(value) ? (value as T) : fallback;
}

/** Normalizes the three choices out of untrusted persisted data — unknown values fall back to the defaults. */
export function normalizeCardFateRules(input: Record<string, unknown>): Omit<CardFateRules, "archiveFolder"> {
	return {
		onCardMoved: pick<OnCardMoved>(input.onCardMoved, MOVED, DEFAULT_CARD_FATE_RULES.onCardMoved),
		onCardArchived: pick<OnCardArchived>(input.onCardArchived, ARCHIVED, DEFAULT_CARD_FATE_RULES.onCardArchived),
		onCardDeleted: pick<OnCardDeleted>(input.onCardDeleted, DELETED, DEFAULT_CARD_FATE_RULES.onCardDeleted),
	};
}

/**
 * Settings saved before the three choices existed carried `allowDelete` and
 * `protectMovedOrArchivedCards`; this maps them to the equivalent behavior.
 * Returns `{}` for data that is already migrated or has neither old field.
 */
export function migrateCardFateSettings(input: Record<string, unknown>): Partial<CardFateRules> {
	if ("onCardMoved" in input || !("allowDelete" in input)) return {};
	if (input.allowDelete !== true) return { onCardMoved: "move-note", onCardArchived: "unlink", onCardDeleted: "unlink" };
	return input.protectMovedOrArchivedCards === true
		? { onCardMoved: "move-note", onCardArchived: "keep", onCardDeleted: "trash" }
		: { onCardMoved: "trash", onCardArchived: "trash", onCardDeleted: "trash" };
}
