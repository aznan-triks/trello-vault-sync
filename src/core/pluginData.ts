import type { JournalEntry } from "./journal";

export interface PersistedData {
	/** Raw payload for `normalizeSettings` to finish validating — this module only decides which part of `raw` it is. */
	settingsRaw: unknown;
	journal: JournalEntry[];
}

function isJournalEntry(value: unknown): value is JournalEntry {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<JournalEntry>;
	return typeof candidate.level === "string" && typeof candidate.message === "string";
}

/**
 * Splits the plugin's raw `loadData()` payload into settings and journal.
 * A payload with a `settings` key is the current format; anything else is
 * the legacy flat shape (the settings object itself, no journal) — treated
 * as settings with an empty journal rather than rejected, so an existing
 * `data.json` keeps working after this sub-plan, same tolerance already
 * applied to individual fields by `settings/types.ts::normalizeSettings`.
 */
export function normalizePersistedData(raw: unknown): PersistedData {
	const hasSettingsKey = typeof raw === "object" && raw !== null && "settings" in raw;
	if (!hasSettingsKey) return { settingsRaw: raw, journal: [] };

	const { settings, journal: rawJournal } = raw as { settings: unknown; journal?: unknown };
	const journal = Array.isArray(rawJournal) ? rawJournal.filter(isJournalEntry) : [];
	return { settingsRaw: settings, journal };
}
