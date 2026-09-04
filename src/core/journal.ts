/** Single source for every log level a `Reporter` can emit — `Reporter.log` in `obsidian/gateway.ts` references this instead of an inline union. */
export type LogLevel = "info" | "pull" | "push" | "create" | "adopt" | "rename" | "skip" | "delete" | "warn" | "error";

export interface JournalEntry {
	level: LogLevel;
	message: string;
}

/**
 * Appends an entry to a journal kept oldest-first, dropping the oldest
 * entries once `maxEntries` is exceeded. Rendering prepends each entry, so
 * an oldest-first store still displays newest-first, matching `ProgressPanel`.
 */
export function appendJournalEntry(entries: readonly JournalEntry[], entry: JournalEntry, maxEntries: number): JournalEntry[] {
	const next = [...entries, entry];
	return next.length > maxEntries ? next.slice(next.length - maxEntries) : next;
}
