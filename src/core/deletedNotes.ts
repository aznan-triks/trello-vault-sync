/** What a sync does with a card whose note the user deleted. */
export type OnLinkedNoteDeleted = "ignore-card" | "archive-card" | "recreate";

export const ON_LINKED_NOTE_DELETED: readonly OnLinkedNoteDeleted[] = ["ignore-card", "archive-card", "recreate"];

/** Missing cards whose note the user deleted: linked at the last successful pass, with no note anywhere now. */
export function cardsWithDeletedNotes(
	missingCardIds: readonly string[],
	knownLinked: ReadonlySet<string>,
	linkedAnywhere: ReadonlySet<string>,
): string[] {
	return missingCardIds.filter((id) => knownLinked.has(id) && !linkedAnywhere.has(id));
}

/** Ids to remember after a successful pass: every card of the list that has a note in the vault. */
export function nextKnownLinks(listCardIds: readonly string[], linkedAnywhere: ReadonlySet<string>): string[] {
	return listCardIds.filter((id) => linkedAnywhere.has(id));
}

/** A card the user chose to never get a note for again. */
export interface IgnoredCard {
	name: string;
	/** ISO date it was ignored. */
	since: string;
}

export type IgnoredCards = Record<string, IgnoredCard>;
