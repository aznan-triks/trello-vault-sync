/** The subset of a `FolderMapping` this decision needs — kept local so `core/` never imports from `features/` (features depends on core, never the reverse). */
export interface MappingLookup {
	listId: string;
	folder: string;
}

export type OrphanCardDestination = { needsPrompt: false; folder: string } | { needsPrompt: true };

/**
 * Where a new note from an orphan card should go — pure, so the folder-
 * selection rule is a plain unit test, independent of `FolderPickerModal`'s
 * DOM. A mapped list wins outright; otherwise the configured fallback is used
 * directly when set, and only an empty fallback needs the user prompted.
 */
export function resolveOrphanCardDestination(
	cardListId: string | undefined,
	mappings: readonly MappingLookup[],
	fallbackFolder: string,
): OrphanCardDestination {
	const mapping = mappings.find((candidate) => candidate.listId === cardListId);
	if (mapping) return { needsPrompt: false, folder: mapping.folder };
	if (fallbackFolder.trim() !== "") return { needsPrompt: false, folder: fallbackFolder };
	return { needsPrompt: true };
}

/** Whether a folder value typed into the prompt is enough to proceed — Fail Fast: blank never creates anything. */
export function isUsableDestinationFolder(folder: string): boolean {
	return folder.trim() !== "";
}

export type OrphanCardScope = "all" | "mapped-lists-only";

/**
 * Filters orphan cards according to the configured detection scope:
 * - "all": all orphan cards are candidates.
 * - "mapped-lists-only": only cards located in a mapped list are candidates.
 */
export function filterOrphanCardsByScope<T extends { idList?: string }>(
	cards: readonly T[],
	mappings: readonly MappingLookup[],
	scope: OrphanCardScope,
): T[] {
	if (scope === "all") {
		return [...cards];
	}
	const mappedListIds = new Set(
		mappings.map((m) => m.listId.trim()).filter((id) => id !== ""),
	);
	return cards.filter((card) => card.idList !== undefined && mappedListIds.has(card.idList.trim()));
}

