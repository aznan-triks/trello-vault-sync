import type { VaultGateway } from "../obsidian/gateway";

export interface AuditOptions {
	scope: string;
	boardId: string;
	/** Note the report is written into. Must already exist. */
	reportPath: string;
	/** Pre-formatted date, injected so a report is reproducible. */
	timestamp: string;
	/** Folders skipped regardless of link state. */
	excludedFolders?: string[];
}

/** Find the report note, or explain precisely what is missing. */
export function requireReportNote(vault: VaultGateway, reportPath: string) {
	if (reportPath.trim() === "") {
		throw new Error("The report note is not configured — set it in the plugin settings.");
	}
	const note = vault.noteAt(reportPath);
	if (!note) {
		throw new Error(`Report note not found: ${reportPath} — create it or change the setting.`);
	}
	return note;
}
