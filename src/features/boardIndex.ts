import type { TrelloCard, TrelloClient } from "../trello/client";

export interface BoardIndex {
	cards: TrelloCard[];
	/** List id → list name, for turning a card's `idList` into something readable. */
	listNames: Map<string, string>;
}

/** Fetch a board's lists and cards together — both audits need the same pair. */
export async function fetchBoardIndex(client: TrelloClient, boardId: string): Promise<BoardIndex> {
	const [lists, cards] = await Promise.all([
		client.getBoardLists(boardId),
		client.getBoardCards(boardId),
	]);
	return { cards, listNames: new Map(lists.map((list) => [list.id, list.name])) };
}
