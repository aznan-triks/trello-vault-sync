import { boardForFolder, boardForList, qualifyWithBoard, registeredBoards } from "../core/boardResolve";
import type { TrelloClient, TrelloList } from "../trello/client";
import type { CommandContext } from "./context";

/** Ids of every board the commands read: the default board first, then the registered ones. */
export function registeredBoardIds(ctx: CommandContext): string[] {
	return registeredBoards(ctx.settings).map((board) => board.id);
}

export interface ListChoices {
	/** What the list picker shows: plain list names with one board, "Board › List" with several. */
	lists: TrelloList[];
	/** The board a list belongs to. */
	boardOf(listId: string): string;
}

/** Turns the lists of the registered boards into picker choices that remember each list's board. */
export function listChoices(ctx: CommandContext, listNames: ReadonlyMap<string, string>, listBoards?: ReadonlyMap<string, string>): ListChoices {
	const boards = registeredBoards(ctx.settings);
	const boardOf = (listId: string) => listBoards?.get(listId) ?? boardForList(listId, ctx.settings);
	const boardName = (boardId: string) => boards.find((board) => board.id === boardId)?.name ?? "";
	const lists = [...listNames].map(([id, name]) => ({ id, name: boards.length > 1 ? qualifyWithBoard(boardName(boardOf(id)), name) : name }));
	return { lists, boardOf };
}

/** The lists of every registered board, one read per board. */
export async function registeredListChoices(ctx: CommandContext, client: TrelloClient, signal?: AbortSignal): Promise<ListChoices> {
	const listNames = new Map<string, string>();
	const listBoards = new Map<string, string>();
	for (const boardId of registeredBoardIds(ctx)) {
		for (const list of await client.getBoardLists(boardId, signal)) {
			listNames.set(list.id, list.name);
			listBoards.set(list.id, boardId);
		}
	}
	return listChoices(ctx, listNames, listBoards);
}

/** The boards a note's card can be on: the board of its folder's mapping, otherwise every registered board. */
export function boardIdsForNote(ctx: CommandContext, note: { folder: string }): string[] {
	const own = boardForFolder(note.folder, ctx.settings);
	return own === null ? registeredBoardIds(ctx) : [own];
}
