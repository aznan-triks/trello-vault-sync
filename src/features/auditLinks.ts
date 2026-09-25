import { yieldPeriodically } from "../core/asyncUtil";
import {
	LINK_REPORT_HEADING,
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
import { requireReportNote, type AuditOptions } from "./auditShared";
import { fetchBoardIndex } from "./boardIndex";

export interface LinkAuditOptions extends AuditOptions {
	/**
	 * When set, the report lists only the orphan cards and unlinked notes the
	 * creation pickers would offer ("Create note from a Trello card" /
	 * "Create Trello cards from phantom notes"), so its counts match theirs.
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

	const { cards, listNames } = await fetchBoardIndex(client, options.boardId, signal);
	const cardIds = new Set(cards.map((card) => card.id));

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
		else phantomNotes.push(entry);
		await yieldPeriodically(i);
	}

	const scopes = options.creationScopes;
	const allOrphans = cards.filter((card) => !linkedCardIds.has(card.id) && !card.closed);
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
	});
	await vault.write(reportNote, mergeReport(existing, markdown, LINK_REPORT_HEADING));

	return {
		orphanCards: orphanCards.length,
		phantomNotes: phantomNotes.length,
		unlinkedNotes: reportedUnlinked.length,
		markdown,
	};
}
