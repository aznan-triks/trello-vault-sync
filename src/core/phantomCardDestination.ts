import type { PlannedNote } from "./folderPlan";
import type { MappingLookup } from "./orphanCardDestination";

export type PhantomCardDestination =
	| { needsPrompt: false; listId: string }
	| { needsPrompt: true };

/**
 * Resolves the destination Trello list for a phantom or unlinked note.
 *
 * Rules:
 * - If `preferFolderMapping` is true and a mapping exists for the note's folder, that list is used.
 * - Otherwise, if `fallbackListId` is set, it is used directly (e.g. the "unorganized" list).
 * - If `fallbackListId` is not set, but a mapping exists for the folder, that list is used.
 * - If neither is available, the user needs to be prompted.
 */
export function resolvePhantomCardDestination(
	noteFolder: string | undefined,
	mappings: readonly MappingLookup[],
	fallbackListId: string,
	preferFolderMapping = false,
): PhantomCardDestination {
	const folder = noteFolder ?? "";
	if (preferFolderMapping) {
		const mapping = mappings.find((candidate) => candidate.folder === folder);
		if (mapping && mapping.listId.trim() !== "") {
			return { needsPrompt: false, listId: mapping.listId };
		}
	}
	if (fallbackListId.trim() !== "") {
		return { needsPrompt: false, listId: fallbackListId };
	}
	const mapping = mappings.find((candidate) => candidate.folder === folder);
	if (mapping && mapping.listId.trim() !== "") {
		return { needsPrompt: false, listId: mapping.listId };
	}
	return { needsPrompt: true };
}

export type PhantomNoteScope = "all-unlinked" | "mapped-folders-only" | "phantom-only";

/**
 * Whether an unlinked note (no card id at all) in `folder` is a candidate under
 * `scope` — shared by the phantom-note picker and the link audit report so both
 * count the same notes. Phantom notes (broken card id) are always candidates.
 */
export function isUnlinkedNoteInScope(
	folder: string,
	scope: PhantomNoteScope,
	mappedFolders?: ReadonlySet<string>,
): boolean {
	if (scope === "phantom-only") return false;
	if (scope === "mapped-folders-only" && mappedFolders && !mappedFolders.has(folder)) return false;
	return true;
}

export interface PhantomCandidate<T = PlannedNote> {
	note: T;
	kind: "phantom" | "unlinked";
}

/**
 * Filter notes down to phantom candidates:
 * - "phantom": has a card id in frontmatter, but the card no longer exists on the board.
 * - "unlinked": has no card id in frontmatter (subject to scope filter).
 */
export function findPhantomNoteCandidates<T extends { folder: string; cardId: string | null }>(
	notes: readonly T[],
	aliveCardIds: ReadonlySet<string>,
	scope: PhantomNoteScope = "all-unlinked",
	mappedFolders?: ReadonlySet<string>,
): PhantomCandidate<T>[] {
	const candidates: PhantomCandidate<T>[] = [];
	for (const note of notes) {
		if (note.cardId === null) {
			if (!isUnlinkedNoteInScope(note.folder, scope, mappedFolders)) continue;
			candidates.push({ note, kind: "unlinked" });
		} else if (!aliveCardIds.has(note.cardId)) {
			candidates.push({ note, kind: "phantom" });
		}
	}
	return candidates;
}
