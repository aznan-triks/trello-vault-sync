import type { TrelloCard, TrelloClient } from "../trello/client";

export interface BoardIndex {
	cards: TrelloCard[];
	/** List id → list name, for turning a card's `idList` into something readable. */
	listNames: Map<string, string>;
	/** List id → id of the board it is on (several boards only; empty for a single-board index). */
	listBoards?: Map<string, string>;
}

/** Fetch a board's lists and cards together — both audits need the same pair. */
export async function fetchBoardIndex(client: TrelloClient, boardId: string, signal?: AbortSignal): Promise<BoardIndex> {
	const [lists, cards] = await Promise.all([
		client.getBoardLists(boardId, signal),
		client.getBoardCards(boardId, undefined, signal),
	]);
	return { cards, listNames: new Map(lists.map((list) => [list.id, list.name])) };
}

/** `fetchBoardIndex` for each board in turn, merged: one series of reads per board. */
export async function fetchBoardIndexes(client: TrelloClient, boardIds: readonly string[], signal?: AbortSignal): Promise<BoardIndex> {
	const merged: BoardIndex = { cards: [], listNames: new Map(), listBoards: new Map() };
	for (const boardId of boardIds) {
		const index = await fetchBoardIndex(client, boardId, signal);
		merged.cards.push(...index.cards);
		for (const [listId, name] of index.listNames) {
			merged.listNames.set(listId, name);
			merged.listBoards?.set(listId, boardId);
		}
	}
	return merged;
}

/** The cards of each board in turn, merged: one read per board (`filter` "all" = archived included). */
export async function fetchBoardsCards(client: TrelloClient, boardIds: readonly string[], signal?: AbortSignal, filter?: "visible" | "all"): Promise<TrelloCard[]> {
	const cards: TrelloCard[] = [];
	for (const boardId of boardIds) cards.push(...(await client.getBoardCards(boardId, filter, signal)));
	return cards;
}
