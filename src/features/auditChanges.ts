import { yieldPeriodically } from "../core/asyncUtil";
import { describeAction, type AuditEntry } from "../core/auditAction";
import { CHANGES_REPORT_HEADING, buildChangesReport, mergeReport } from "../core/auditReport";
import { silentReporter, type Reporter, type VaultGateway } from "../obsidian/gateway";
import type { TrelloClient } from "../trello/client";
import { requireReportNote } from "./auditShared";

/**
 * Board-only audit: no vault notes are scanned, so this doesn't reuse
 * `AuditOptions` (`scope`/`excludedFolders` don't apply here).
 */
export interface ChangesAuditOptions {
	boardId: string;
	/** Note the report is written into. Must already exist. */
	reportPath: string;
	timestamp: string;
	/** Cursor from the previous run (an action id), "" for a first run. */
	since: string;
}

export interface ChangesAuditResult {
	entries: number;
	/** Id of the most recent action seen — the caller persists this as the next `since`, unless dry-running. `null` when nothing was fetched. */
	cursor: string | null;
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
	const reportNote = requireReportNote(vault, options.reportPath);

	const actions = await client.getActions(options.boardId, { since: options.since || undefined }, signal);
	reporter.setTotal(actions.length);

	const entries: AuditEntry[] = [];
	for (const [i, action] of actions.entries()) {
		if (signal?.aborted) break;
		reporter.step(action.type);
		const entry = describeAction(action);
		if (entry) {
			entries.push(entry);
			reporter.log("info", `${entry.cardName || entry.type} — ${entry.detail}`);
		}
		await yieldPeriodically(i);
	}

	const markdown = buildChangesReport({ timestamp: options.timestamp, entries });
	const existing = await vault.read(reportNote);
	await vault.write(reportNote, mergeReport(existing, markdown, CHANGES_REPORT_HEADING));

	return { entries: entries.length, cursor: actions[0]?.id ?? null, markdown };
}
