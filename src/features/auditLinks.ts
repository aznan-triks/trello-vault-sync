import { yieldPeriodically } from "../core/asyncUtil";
import {
	LINK_REPORT_HEADING,
	buildLinkReport,
	extractCheckedKeys,
	mergeReport,
	type ReportCard,
	type ReportNote,
} from "../core/auditReport";
import { silentReporter, type Reporter, type VaultGateway } from "../obsidian/gateway";
import type { TrelloClient } from "../trello/client";
import { requireReportNote, type AuditOptions } from "./auditShared";
import { fetchBoardIndex } from "./boardIndex";

export interface LinkAuditResult {
	orphanCards: number;
	phantomNotes: number;
	unlinkedNotes: number;
	markdown: string;
}

/** Cross-check the board against the vault: what is linked, dangling or missing. */
export async function auditLinks(
	vault: VaultGateway,
	client: TrelloClient,
	options: AuditOptions,
	reporter: Reporter = silentReporter,
	signal?: AbortSignal,
): Promise<LinkAuditResult> {
	const reportNote = requireReportNote(vault, options.reportPath);

	const { cards, listNames } = await fetchBoardIndex(client, options.boardId);
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

	const orphanCards: ReportCard[] = cards
		.filter((card) => !linkedCardIds.has(card.id) && !card.closed)
		.map((card) => ({
			id: card.id,
			name: card.name,
			url: card.url,
			idList: card.idList ?? "",
		}));

	const existing = await vault.read(reportNote);
	const markdown = buildLinkReport({
		scope: options.scope,
		timestamp: options.timestamp,
		listNames,
		orphanCards,
		phantomNotes,
		unlinkedNotes,
		checked: extractCheckedKeys(existing),
	});
	await vault.write(reportNote, mergeReport(existing, markdown, LINK_REPORT_HEADING));

	return {
		orphanCards: orphanCards.length,
		phantomNotes: phantomNotes.length,
		unlinkedNotes: unlinkedNotes.length,
		markdown,
	};
}
