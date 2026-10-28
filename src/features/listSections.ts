import { errorMessage } from "../core/errorMessage";
import { insertCard, isSeparatorCard, splitSections, type Section, type SectionRules } from "../core/sections";
import type { Reporter } from "../obsidian/gateway";
import type { TrelloCard, TrelloClient } from "../trello/client";

/** One read of a list's cards, cut into sections. */
export async function readSections(
	client: TrelloClient,
	listId: string,
	rules: SectionRules,
	signal?: AbortSignal,
): Promise<Section<TrelloCard>[]> {
	return splitSections(await client.getListCards(listId, signal), (card) => isSeparatorCard(card, rules.labelName));
}

/**
 * Brings the sections up to date after a card was created, and returns them. Normally the created card is filed in
 * by the `pos` Trello returned. When that is not the `pos` asked for, Trello renumbered the whole list, so every
 * cached number is stale: the list is read again (a failed read is logged and the card filed in anyway).
 * shortcut: only a renumbering is noticed; a card moved by someone else during the run is not, upgrade by reading the list before every placement if that is reported.
 */
export async function fileCreatedCard(
	client: TrelloClient,
	listId: string,
	rules: SectionRules,
	sections: Section<TrelloCard>[],
	card: TrelloCard,
	asked: number | "bottom" | undefined,
	reporter: Reporter,
	signal?: AbortSignal,
): Promise<Section<TrelloCard>[]> {
	if (typeof asked === "number" && card.pos !== asked) {
		try {
			return await readSections(client, listId, rules, signal);
		} catch (error) {
			if (!signal?.aborted) {
				reporter.log("warn", `Could not read the list again after Trello renumbered it, the next card of this run may land a place off (${errorMessage(error)})`);
			}
		}
	}
	insertCard(sections, card, (other) => isSeparatorCard(other, rules.labelName));
	return sections;
}
