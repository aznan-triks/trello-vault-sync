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
