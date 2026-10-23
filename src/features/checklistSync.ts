import { parseChecklistMarkdown, renderChecklistMarkdown, type ChecklistGroup } from "../core/checklistRef";
import type { TrelloChecklist } from "../trello/client";

export interface ChecklistPush {
	checkItemId: string;
	state: "complete" | "incomplete";
}

export interface ChecklistResolution {
	/** Markdown to write into the note's checklist section — `null` to remove it entirely. */
	markdown: string | null;
	/** Check-item state changes to push to Trello. */
	pushes: ChecklistPush[];
}

/** Which side's checked state wins for an item known to both: the note (a push) or the card (a pull). */
export type ChecklistWinner = "local" | "remote";

/**
 * Reconciles a card's checklists (freshly fetched, ids included) against the
 * note's current checklist markdown (no ids). Trello wins for which items/checklists
 * exist at all — a locally-typed item with no matching name is dropped, never
 * created on Trello. The checked state of an item known to both sides follows
 * `winner`, the side the sync direction picked: `local` pushes the note's state to
 * Trello, `remote` takes Trello's and pushes nothing.
 *
 * Matching is by (checklist name, item name), first unmatched local occurrence
 * to each remote item in order — a deliberately loose identity scheme (no
 * stable id survives a round-trip through plain Markdown), so a checklist with
 * duplicate item names matches approximately rather than exactly. Names are
 * compared trimmed: the note's are, and Trello may keep a trailing space.
 */
export function resolveChecklists(
	remote: TrelloChecklist[],
	localBlock: string | null,
	heading: string,
	winner: ChecklistWinner = "local",
): ChecklistResolution {
	const localGroups = parseChecklistMarkdown(localBlock);
	const pushes: ChecklistPush[] = [];

	const finalGroups: ChecklistGroup[] = remote.map((remoteGroup) => {
		const groupName = remoteGroup.name.trim();
		const localGroup = localGroups.find((group) => group.name === groupName);
		const localItemsRemaining = localGroup ? [...localGroup.items] : [];

		const items = remoteGroup.checkItems.map((remoteItem) => {
			const name = remoteItem.name.trim();
			const remoteComplete = remoteItem.state === "complete";
			if (winner === "remote") return { name, complete: remoteComplete };
			const matchIndex = localItemsRemaining.findIndex((item) => item.name === name);
			if (matchIndex === -1) return { name, complete: remoteComplete };

			const [localItem] = localItemsRemaining.splice(matchIndex, 1);
			const localComplete = localItem?.complete ?? remoteComplete;
			if (localComplete !== remoteComplete) {
				pushes.push({ checkItemId: remoteItem.id, state: localComplete ? "complete" : "incomplete" });
			}
			return { name, complete: localComplete };
		});

		return { name: groupName, items };
	});

	return { markdown: renderChecklistMarkdown(finalGroups, heading), pushes };
}

/** True when the note and the card do not show the same checklists, item names and checked states alike. */
export function checklistsDiffer(remote: TrelloChecklist[], localBlock: string | null, heading: string): boolean {
	const remoteGroups = remote.map((group) => ({
		name: group.name.trim(),
		items: group.checkItems.map((item) => ({ name: item.name.trim(), complete: item.state === "complete" })),
	}));
	return renderChecklistMarkdown(remoteGroups, heading) !== renderChecklistMarkdown(parseChecklistMarkdown(localBlock), heading);
}
