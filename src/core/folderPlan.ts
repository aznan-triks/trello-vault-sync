import { joinPath, sanitizeFileName } from "./fileName";

/** The card fields the planner needs — a subset of the Trello card shape. */
export interface PlannedCard {
	id: string;
	idBoard: string;
	name: string;
	desc: string;
	url: string;
	dateLastActivity: string;
}

/** The note fields the planner needs — a subset of Obsidian's `TFile`. */
export interface PlannedNote {
	path: string;
	basename: string;
	folder: string;
	mtime: number;
	/** Card id read from frontmatter, already parsed; `null` when absent or unusable. */
	cardId: string | null;
}

export interface FolderPair {
	note: PlannedNote;
	card: PlannedCard;
	/** True when the note was matched by file name rather than by frontmatter id. */
	adopted: boolean;
	/** Where the note should live once the card title is applied. */
	targetPath: string;
	needsLocalRename: boolean;
}

export interface FolderPlan {
	pairs: FolderPair[];
	/** Cards with no note yet — creation candidates. */
	missingCards: PlannedCard[];
	/** Notes pointing at a card that is no longer in the list — deletion candidates. */
	phantomNotes: PlannedNote[];
	/** Notes carrying no card id at all. */
	unlinkedNotes: PlannedNote[];
	/** Extra notes claiming a card already taken by another note. */
	duplicateNotes: PlannedNote[];
}

/**
 * Match a Trello list against a vault folder, purely in memory.
 *
 * Nothing is read or written here: the caller turns the buckets into actions.
 * Card order is preserved so two runs on the same input behave identically.
 */
export function planFolderMatch(
	cards: readonly PlannedCard[],
	notes: readonly PlannedNote[],
	folder: string,
): FolderPlan {
	const sorted = [...notes].sort((a, b) => a.path.localeCompare(b.path));

	const byCardId = new Map<string, PlannedNote>();
	const duplicateNotes: PlannedNote[] = [];
	const unlinked: PlannedNote[] = [];

	for (const note of sorted) {
		if (note.cardId === null) {
			unlinked.push(note);
		} else if (byCardId.has(note.cardId)) {
			duplicateNotes.push(note);
		} else {
			byCardId.set(note.cardId, note);
		}
	}

	const byPath = new Map(unlinked.map((note) => [note.path, note]));
	const pairs: FolderPair[] = [];
	const missingCards: PlannedCard[] = [];
	const claimed = new Set<string>();
	const adoptedPaths = new Set<string>();

	for (const card of cards) {
		const targetPath = joinPath(folder, `${sanitizeFileName(card.name)}.md`);
		let note = byCardId.get(card.id);
		let adopted = false;

		if (note) {
			claimed.add(card.id);
		} else {
			const candidate = byPath.get(targetPath);
			if (candidate && !adoptedPaths.has(candidate.path)) {
				note = candidate;
				adopted = true;
				adoptedPaths.add(candidate.path);
			}
		}

		if (!note) {
			missingCards.push(card);
			continue;
		}

		pairs.push({
			note,
			card,
			adopted,
			targetPath,
			needsLocalRename: note.path !== targetPath,
		});
	}

	const phantomNotes = [...byCardId.values()].filter((note) => !claimed.has(note.cardId as string));
	const unlinkedNotes = unlinked.filter((note) => !adoptedPaths.has(note.path));

	return { pairs, missingCards, phantomNotes, unlinkedNotes, duplicateNotes };
}
