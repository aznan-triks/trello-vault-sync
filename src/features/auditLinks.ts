import { yieldPeriodically } from "../core/asyncUtil";
import {
	DEFAULT_REPORT_LABELS,
	buildLinkReport,
	extractCheckedKeys,
	mergeReport,
	type ReportCard,
	type ReportNote,
} from "../core/auditReport";
import { filterOrphanCardsByScope, type MappingLookup, type OrphanCardScope } from "../core/orphanCardDestination";
import { isUnlinkedNoteInScope, type PhantomNoteScope } from "../core/phantomCardDestination";
import { silentReporter, type CardRefStore, type Reporter, type VaultGateway } from "../obsidian/gateway";
import type { TrelloClient } from "../trello/client";
import { auditBoards, boardQualifier, requireReportNote, type AuditOptions } from "./auditShared";
import { fetchBoardIndexes } from "./boardIndex";
import { boardForRef } from "../core/boardResolve";

export interface LinkAuditOptions extends AuditOptions {
	/**
	 * When set, the report lists only the orphan cards and unlinked notes the
	 * creation pickers would offer ("Create a note from an unlinked card" /
	 * "Recreate the missing cards of notes"), so its counts match theirs.
	 * Omitted = every orphan card and unlinked note (the historical behavior).
	 */
	creationScopes?: {
		mappings: readonly MappingLookup[];
		orphanCardScope: OrphanCardScope;
		phantomNoteScope: PhantomNoteScope;
	};
}

export interface LinkAuditResult {
	orphanCards: number;
	phantomNotes: number;
	unlinkedNotes: number;
	markdown: string;
}

/** Cross-check the board against the vault: what is linked, dangling or missing. */
export async function auditLinks(
	vault: VaultGateway & CardRefStore,
	client: TrelloClient,
	options: LinkAuditOptions,
	reporter: Reporter = silentReporter,
	signal?: AbortSignal,
): Promise<LinkAuditResult> {
	const reportNote = await requireReportNote(vault, options.reportPath, options.autoCreateReportNote);

	const boards = auditBoards(options);
	const qualify = boardQualifier(boards);
	const index = await fetchBoardIndexes(client, boards.map((board) => board.id), signal);
	const { cards } = index;
	const listNames = new Map([...index.listNames].map(([listId, name]) => [listId, qualify(index.listBoards?.get(listId) ?? options.boardId, name)]));
	const cardIds = new Set(cards.map((card) => card.id));
	const only = options.onlyBoardId || undefined;
	const boardSettings = { boardId: options.boardId, boards: options.boards ?? [] };

	const notes = vault.listNotes(options.scope, options.excludedFolders);
	reporter.setTotal(notes.length);

	const linkedCardIds = new Set<string>();
	const phantomNotes: ReportNote[] = [];
	const unlinkedNotes: ReportNote[] = [];

	for (const [i, note] of notes.entries()) {
		if (signal?.aborted) break;
		reporter.step(note.basename);
		const ref = vault.getCardRef(note);
		const entry: ReportNote = {
			path: note.path,
			basename: note.basename,
			folder: note.folder,
			cardId: ref?.cardId ?? null,
		};
		if (!ref) unlinkedNotes.push(entry);
		else if (cardIds.has(ref.cardId)) linkedCardIds.add(ref.cardId);
		else if (only === undefined || boardForRef(ref, boardSettings) === only) phantomNotes.push(entry);
		await yieldPeriodically(i);
	}

	const scopes = options.creationScopes;
	const allOrphans = cards.filter(
		(card) => !linkedCardIds.has(card.id) && !card.closed && !options.ignoredCardIds?.has(card.id) && (only === undefined || card.idBoard === only),
	);
	const orphanCards: ReportCard[] = (
		scopes ? filterOrphanCardsByScope(allOrphans, scopes.mappings, scopes.orphanCardScope) : allOrphans
	).map((card) => ({
		id: card.id,
		name: card.name,
		url: card.url,
		idList: card.idList ?? "",
	}));

	const mappedFolders = new Set(scopes?.mappings.map((mapping) => mapping.folder));
	const reportedUnlinked = scopes
		? unlinkedNotes.filter((note) => isUnlinkedNoteInScope(note.folder, scopes.phantomNoteScope, mappedFolders))
		: unlinkedNotes;

	const existing = await vault.read(reportNote);
	const markdown = buildLinkReport({
		scope: options.scope,
		timestamp: options.timestamp,
		listNames,
		orphanCards,
		phantomNotes,
		unlinkedNotes: reportedUnlinked,
		checked: extractCheckedKeys(existing),
		filteredByCreationScopes: scopes !== undefined,
		labels: options.reportLabels,
	});
	await vault.write(reportNote, mergeReport(existing, markdown, (options.reportLabels ?? DEFAULT_REPORT_LABELS).linkHeading));

	return {
		orphanCards: orphanCards.length,
		phantomNotes: phantomNotes.length,
		unlinkedNotes: reportedUnlinked.length,
		markdown,
	};
}
