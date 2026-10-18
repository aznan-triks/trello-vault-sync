import { yieldPeriodically } from "../core/asyncUtil";
import {
	DEFAULT_REPORT_LABELS,
	buildLocationReport,
	mergeReport,
	type LocationRow,
} from "../core/auditReport";
import { silentReporter, type CardRefStore, type Reporter, type VaultGateway } from "../obsidian/gateway";
import type { TrelloClient } from "../trello/client";
import { requireReportNote, type AuditOptions } from "./auditShared";
import { fetchBoardIndex } from "./boardIndex";

export interface LocationAuditResult {
	rows: number;
	markdown: string;
}

/** Compare each linked note's folder with the Trello list its card sits in. */
export async function auditLocations(
	vault: VaultGateway & CardRefStore,
	client: TrelloClient,
	options: AuditOptions,
	reporter: Reporter = silentReporter,
	signal?: AbortSignal,
): Promise<LocationAuditResult> {
	const reportNote = await requireReportNote(vault, options.reportPath, options.autoCreateReportNote);

	const { cards, listNames } = await fetchBoardIndex(client, options.boardId, signal);
	const byId = new Map(cards.map((card) => [card.id, card]));

	const notes = vault.listNotes(options.scope, options.excludedFolders);
	reporter.setTotal(notes.length);

	const rows: LocationRow[] = [];

	for (const [i, note] of notes.entries()) {
		if (signal?.aborted) break;
		reporter.step(note.basename);
		const ref = vault.getCardRef(note);
		if (ref) {
			const card = byId.get(ref.cardId);
			if (card) {
				const listName = listNames.get(card.idList ?? "") ?? "Unknown list";
				rows.push({ listName, cardName: card.name, folder: note.folder, notePath: note.path });
			}
		}
		await yieldPeriodically(i);
	}

	const markdown = buildLocationReport({
		scope: options.scope,
		timestamp: options.timestamp,
		rows,
		labels: options.reportLabels,
	});
	const existing = await vault.read(reportNote);
	await vault.write(reportNote, mergeReport(existing, markdown, (options.reportLabels ?? DEFAULT_REPORT_LABELS).locationHeading));

	return { rows: rows.length, markdown };
}
