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

/**
 * Reconciles a card's checklists (freshly fetched, ids included) against the
 * note's current checklist markdown (no ids). Obsidian wins for the checked
 * state of an item known to both sides; Trello wins for which items/checklists
 * exist at all — a locally-typed item with no matching name is dropped, never
 * created on Trello.
 *
 * Matching is by (checklist name, item name), first unmatched local occurrence
 * to each remote item in order — a deliberately loose identity scheme (no
 * stable id survives a round-trip through plain Markdown), so a checklist with
 * duplicate item names matches approximately rather than exactly.
 */
export function resolveChecklists(
	remote: TrelloChecklist[],
	localBlock: string | null,
	heading: string,
): ChecklistResolution {
	const localGroups = parseChecklistMarkdown(localBlock);
	const pushes: ChecklistPush[] = [];

	const finalGroups: ChecklistGroup[] = remote.map((remoteGroup) => {
		const localGroup = localGroups.find((group) => group.name === remoteGroup.name);
		const localItemsRemaining = localGroup ? [...localGroup.items] : [];

		const items = remoteGroup.checkItems.map((remoteItem) => {
			const remoteComplete = remoteItem.state === "complete";
			const matchIndex = localItemsRemaining.findIndex((item) => item.name === remoteItem.name);
			if (matchIndex === -1) return { name: remoteItem.name, complete: remoteComplete };

			const [localItem] = localItemsRemaining.splice(matchIndex, 1);
			const localComplete = localItem?.complete ?? remoteComplete;
			if (localComplete !== remoteComplete) {
				pushes.push({ checkItemId: remoteItem.id, state: localComplete ? "complete" : "incomplete" });
			}
			return { name: remoteItem.name, complete: localComplete };
		});

		return { name: remoteGroup.name, items };
	});

	return { markdown: renderChecklistMarkdown(finalGroups, heading), pushes };
}
