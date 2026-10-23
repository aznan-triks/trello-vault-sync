import { isSeparatorCard, splitSections, type Section, type SectionRules } from "../core/sections";
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
