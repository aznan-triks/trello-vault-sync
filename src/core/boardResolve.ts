import type { CardRef } from "./cardRef";

/** A Trello board the user registered in the settings. */
export interface BoardRef {
	id: string;
	name: string;
}

/** The slice of the settings the resolvers read. */
export interface BoardSettings {
	/** The default board: used by anything that names no board. */
	boardId: string;
	boards: readonly BoardRef[];
}

export interface BoardResolution {
	boardId: string;
	/** The mapping named a board that is no longer registered, so the default board stands in. */
	fellBack: boolean;
}

/** The default board first, then the registered ones, each id once (first name wins). Empty ids are skipped. */
export function registeredBoards(settings: BoardSettings): BoardRef[] {
	const byId = new Map<string, BoardRef>();
	for (const board of settings.boards) if (!byId.has(board.id)) byId.set(board.id, board);
	const defaultId = settings.boardId.trim();
	const ordered: BoardRef[] = [];
	if (defaultId !== "") ordered.push(byId.get(defaultId) ?? { id: defaultId, name: "" });
	for (const board of byId.values()) if (board.id !== defaultId) ordered.push(board);
	return ordered;
}

/** The board a folder mapping works on: its own when registered, otherwise the default board. */
export function boardForMapping(mapping: { boardId?: string }, settings: BoardSettings): BoardResolution {
	const own = mapping.boardId?.trim() ?? "";
	const defaultBoard = { boardId: settings.boardId, fellBack: false };
	if (own === "" || own === settings.boardId) return defaultBoard;
	if (settings.boards.some((board) => board.id === own)) return { boardId: own, fellBack: false };
	return { boardId: settings.boardId, fellBack: true };
}

/** The board a note's card lives on: the one in its reference, otherwise the default board. */
export function boardForRef(ref: CardRef, settings: BoardSettings): string {
	return ref.boardId ?? settings.boardId;
}
