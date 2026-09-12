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
