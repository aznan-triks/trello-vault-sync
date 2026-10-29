import { yieldPeriodically } from "../core/asyncUtil";
import { describeAction, type AuditEntry } from "../core/auditAction";
import { DEFAULT_REPORT_LABELS, buildChangesReport, type ReportLabels, mergeReport } from "../core/auditReport";
import { silentReporter, type Reporter, type VaultGateway } from "../obsidian/gateway";
import type { TrelloClient } from "../trello/client";
import { fetchChangesActions, requireReportNote, type ChangesSource } from "./auditShared";

/**
 * Board-only audit: no vault notes are scanned, so this doesn't reuse
 * `AuditOptions` (`scope`/`excludedFolders` don't apply here).
 */
export interface ChangesAuditOptions extends ChangesSource {
	/** Note the report is written into. Must already exist. */
	reportPath: string;
	timestamp: string;
	// `since` (from `ChangesSource`) is the cursor from the previous run (an action id), "" for a first run.
	/** Create the report note when missing instead of throwing. */
	autoCreateReportNote?: boolean;
	/** Report headings (Settings -> Audit output); absent = the built-in ones. */
	reportLabels?: ReportLabels;
}

export interface ChangesAuditResult {
	entries: number;
	/** Id of the most recent action seen — the caller persists this as the next `since`, unless dry-running. `null` when nothing was fetched. */
	cursor: string | null;
	/** The newest action id seen on each board that had any: what the caller persists as that board's next `since`. */
	cursors: Record<string, string>;
	markdown: string;
}

/** Log Trello board activity (`/boards/{id}/actions`) since the last run into the Report note. */
export async function auditChanges(
	vault: VaultGateway,
	client: TrelloClient,
	options: ChangesAuditOptions,
	reporter: Reporter = silentReporter,
	signal?: AbortSignal,
): Promise<ChangesAuditResult> {
	const reportNote = await requireReportNote(vault, options.reportPath, options.autoCreateReportNote);

	const { actions, boardOf, cursors, qualify } = await fetchChangesActions(client, options, signal);
	reporter.setTotal(actions.length);

	const entries: AuditEntry[] = [];
	for (const [i, action] of actions.entries()) {
		if (signal?.aborted) break;
		reporter.step(action.type);
		const entry = describeAction(action);
		if (entry) {
			entries.push({ ...entry, cardName: entry.cardName === "" ? "" : qualify(boardOf.get(action) ?? options.boardId, entry.cardName) });
			reporter.log("info", `${entry.cardName || entry.type} — ${entry.detail}`);
		}
		await yieldPeriodically(i);
	}

	const markdown = buildChangesReport({ timestamp: options.timestamp, entries, labels: options.reportLabels });
	const existing = await vault.read(reportNote);
	await vault.write(reportNote, mergeReport(existing, markdown, (options.reportLabels ?? DEFAULT_REPORT_LABELS).changesHeading));

	return { entries: entries.length, cursor: cursors[options.boardId] ?? null, cursors, markdown };
}
