import type { TrelloAction } from "./auditAction";
import { sanitizeFileName } from "./fileName";

/**
 * Checks if a card title matches a note basename.
 * Handles:
 * - Trimming and case-insensitivity.
 * - Sanitized file name matching (e.g. invalid filename characters in Trello card replaced by "-").
 */
export function isSameCardName(cardName: string, noteBasename: string, maxNameLength?: number): boolean {
	const normNote = noteBasename.trim().toLowerCase();
	const normCard = cardName.trim().toLowerCase();
	if (normNote === normCard) return true;
	const sanitized = sanitizeFileName(cardName, maxNameLength).trim().toLowerCase();
	return normNote === sanitized;
}

/**
 * Checks whether any known card name matches `noteBasename`.
 */
export function hasMatchingCardInBoardOrHistory(
	noteBasename: string,
	knownNames: Iterable<string>,
	maxNameLength?: number,
): boolean {
	for (const candidate of knownNames) {
		if (isSameCardName(candidate, noteBasename, maxNameLength)) return true;
	}
	return false;
}

/**
 * Extracts card names from a list of Trello board actions (creates, deletes, updates, renames).
 */
export function extractCardNamesFromActions(actions: readonly TrelloAction[]): string[] {
	const names: string[] = [];
	for (const action of actions) {
		const cardName = action.data?.card?.name;
		if (typeof cardName === "string" && cardName.trim() !== "") {
			names.push(cardName);
		}
		const oldName = action.data?.old?.name;
		if (typeof oldName === "string" && oldName.trim() !== "") {
			names.push(oldName);
		}
	}
	return names;
}
