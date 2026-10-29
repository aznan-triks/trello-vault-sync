import type { ReportLabels } from "../core/auditReport";
import { qualifyWithBoard, registeredBoards, type BoardRef } from "../core/boardResolve";
import type { TrelloAction } from "../core/auditAction";
import type { VaultGateway } from "../obsidian/gateway";
import type { TrelloClient } from "../trello/client";

export interface AuditOptions {
	scope: string;
	/** The default board. */
	boardId: string;
	/** Other registered boards (`settings.boards`): all of them are read. */
	boards?: readonly BoardRef[];
	/** Report only this board's cards (phantom notes are still judged against every registered board). Absent or "" = every board. */
	onlyBoardId?: string;
	/** Note the report is written into. Must already exist. */
	reportPath: string;
	/** Pre-formatted date, injected so a report is reproducible. */
	timestamp: string;
	/** Folders skipped regardless of link state. */
	excludedFolders?: string[];
	/** Cards the user chose to stop creating notes for: not reported as orphan cards. */
	ignoredCardIds?: ReadonlySet<string>;
	/** Report headings and group prefixes (Settings -> Audit output); absent = the built-in ones. */
	reportLabels?: ReportLabels;
	/** Create the report note when missing instead of throwing. */
	autoCreateReportNote?: boolean;
}

/** Find the report note, create it when missing and allowed, or explain precisely what is missing. */
export async function requireReportNote(vault: VaultGateway, reportPath: string, autoCreate?: boolean) {
	if (reportPath.trim() === "") {
		throw new Error("The report note is not configured — set it in the plugin settings.");
	}
	const note = vault.noteAt(reportPath);
	if (note) return note;
	if (autoCreate) return vault.create(reportPath, "");
	throw new Error(`Report note not found: ${reportPath} — create it or change the setting.`);
}

/** The boards an audit reads: the default one, then the registered ones. */
export function auditBoards(options: { boardId: string; boards?: readonly BoardRef[] }): BoardRef[] {
	return registeredBoards({ boardId: options.boardId, boards: options.boards ?? [] });
}

/** Says which board a list or entry belongs to, but only when several boards are audited (a single-board report reads as it always did). */
export function boardQualifier(boards: readonly BoardRef[]): (boardId: string, text: string) => string {
	const names = new Map(boards.map((board) => [board.id, board.name]));
	return boards.length > 1 ? (boardId, text) => qualifyWithBoard(names.get(boardId) ?? "", text) : (_boardId, text) => text;
}

/** A board whose change log is read, with its own cursor (the id of the last action seen). */
export interface ChangesBoard {
	id: string;
	name: string;
	since: string;
}

/** The change-log sources shared by the Markdown audit and the HTML export. */
export interface ChangesSource {
	/** The default board. */
	boardId: string;
	/** Its cursor. */
	since: string;
	/** The other registered boards, each with its own cursor. */
	extraBoards?: readonly ChangesBoard[];
}

/**
 * One `getActions` per board, merged newest first. `qualify` names the board when several are read, `cursors` holds
 * each board's newest action id (a board with no new action keeps no entry, so its cursor does not move).
 */
export async function fetchChangesActions(
	client: TrelloClient,
	source: ChangesSource,
	signal?: AbortSignal,
): Promise<{ actions: TrelloAction[]; boardOf: Map<TrelloAction, string>; cursors: Record<string, string>; qualify: (boardId: string, text: string) => string }> {
	const boards: ChangesBoard[] = [{ id: source.boardId, name: "", since: source.since }, ...(source.extraBoards ?? [])];
	const actions: TrelloAction[] = [];
	const boardOf = new Map<TrelloAction, string>();
	const cursors: Record<string, string> = {};
	for (const board of boards) {
		const fetched = await client.getActions(board.id, { since: board.since || undefined }, signal);
		for (const action of fetched) boardOf.set(action, board.id);
		actions.push(...fetched);
		if (fetched[0]) cursors[board.id] = fetched[0].id;
	}
	if (boards.length > 1) actions.sort((a, b) => b.date.localeCompare(a.date));
	return { actions, boardOf, cursors, qualify: boardQualifier(boards) };
}
