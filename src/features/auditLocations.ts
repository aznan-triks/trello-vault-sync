import {
	LOCATION_REPORT_HEADING,
	buildLocationReport,
	mergeReport,
	type LocationRow,
} from "../core/auditReport";
import { silentReporter, type Reporter, type VaultGateway } from "../obsidian/gateway";
import type { TrelloClient } from "../trello/client";
import { requireReportNote, type AuditOptions } from "./auditLinks";
import { fetchBoardIndex } from "./boardIndex";

export interface LocationAuditResult {
	rows: number;
	/** Notes whose folder name does not echo their Trello list name. */
	misplaced: number;
	markdown: string;
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Compare each linked note's folder with the Trello list its card sits in. */
export async function auditLocations(
	vault: VaultGateway,
	client: TrelloClient,
	options: AuditOptions,
	reporter: Reporter = silentReporter,
): Promise<LocationAuditResult> {
	const reportNote = requireReportNote(vault, options.reportPath);

	const { cards, listNames } = await fetchBoardIndex(client, options.boardId);
	const byId = new Map(cards.map((card) => [card.id, card]));

	const notes = vault.listNotes(options.scope);
	reporter.setTotal(notes.length);

	const rows: LocationRow[] = [];
	let misplaced = 0;

	for (const note of notes) {
		reporter.step(note.basename);
		const ref = vault.getCardRef(note);
		if (!ref) continue;
		const card = byId.get(ref.cardId);
		if (!card) continue;

		const listName = listNames.get(card.idList ?? "") ?? "Unknown list";
		rows.push({ listName, cardName: card.name, folder: note.folder, notePath: note.path });

		const folderSlug = slug(note.folder.split("/").pop() ?? "");
		const listSlug = slug(listName);
		if (listSlug !== "" && !folderSlug.includes(listSlug)) {
			misplaced++;
			reporter.log("warn", `${note.basename} → ${note.folder} (list: ${listName})`);
		}
	}

	const markdown = buildLocationReport({
		scope: options.scope,
		timestamp: options.timestamp,
		rows,
	});
	const existing = await vault.read(reportNote);
	await vault.write(reportNote, mergeReport(existing, markdown, LOCATION_REPORT_HEADING));

	return { rows: rows.length, misplaced, markdown };
}
