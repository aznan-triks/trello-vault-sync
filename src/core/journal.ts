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

const DRY_RUN_PREFIX = "[Dry-run] ";

/**
 * The single place that prefixes a log line with `[Dry-run]` — called once,
 * from `main.ts::withJournal`, for every `Reporter.log()` call made while
 * `settings.dryRun` is on, so the panel/journal/sidebar never need their own
 * copy of this rule (DRY). Idempotent: a message a command already prefixed
 * itself (e.g. a batch action's own summary text) is never double-prefixed.
 */
export function prefixDryRunMessage(message: string, dryRun: boolean): string {
	if (!dryRun || message.startsWith(DRY_RUN_PREFIX)) return message;
	return `${DRY_RUN_PREFIX}${message}`;
}
