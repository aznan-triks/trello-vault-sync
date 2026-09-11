/**
 * A note carries a card's checklists as Markdown tasks under a dedicated
 * heading, always the last thing in the body (see `noteBody.ts`'s
 * `splitChecklistSection`) — one `###` sub-heading per Trello checklist, one
 * `- [ ]`/`- [x]` line per item, in Trello's own order.
 */

/** Default heading marking the checklist section — configurable via `checklistHeading`. */
export const DEFAULT_CHECKLIST_HEADING = "## Checklist";

/** On by default — costs one extra Trello request per note synced (checklists aren't embedded in the card object either), see `syncChecklists` setting. */
export const DEFAULT_SYNC_CHECKLISTS = true;

export interface ChecklistItem {
	name: string;
	complete: boolean;
}

export interface ChecklistGroup {
	name: string;
	items: ChecklistItem[];
}

const SUB_HEADING = /^###\s+(.*)$/;
const CHECKBOX_ITEM = /^-\s*\[([ xX])\]\s*(.*)$/;

/** Renders every checklist group under the given heading — `null` when there are none, so the caller can drop the whole section. */
export function renderChecklistMarkdown(checklists: ChecklistGroup[], heading: string = DEFAULT_CHECKLIST_HEADING): string | null {
	if (checklists.length === 0) return null;
	const lines = [heading];
	for (const group of checklists) {
		lines.push(`### ${group.name}`);
		for (const item of group.items) lines.push(`- [${item.complete ? "x" : " "}] ${item.name}`);
	}
	return lines.join("\n");
}

/** Parses a checklist section (as produced by `renderChecklistMarkdown`) back into groups — stray lines other than a sub-heading or a checkbox item are silently ignored. */
export function parseChecklistMarkdown(block: string | null): ChecklistGroup[] {
	if (block === null) return [];
	const groups: ChecklistGroup[] = [];
	let current: ChecklistGroup | null = null;
	for (const line of block.split("\n")) {
		const heading = SUB_HEADING.exec(line);
		if (heading) {
			current = { name: (heading[1] ?? "").trim(), items: [] };
			groups.push(current);
			continue;
		}
		const item = CHECKBOX_ITEM.exec(line);
		if (item && current) {
			current.items.push({ name: (item[2] ?? "").trim(), complete: item[1]?.toLowerCase() === "x" });
		}
	}
	return groups;
}
