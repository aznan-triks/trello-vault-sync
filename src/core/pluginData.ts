import type { JournalEntry } from "./journal";
import type { SyncAction, SyncRun } from "./syncHistory";

export interface PersistedData {
	/** Raw payload for `normalizeSettings` to finish validating — this module only decides which part of `raw` it is. */
	settingsRaw: unknown;
	journal: JournalEntry[];
	history: SyncRun[];
}

function isJournalEntry(value: unknown): value is JournalEntry {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<JournalEntry>;
	return typeof candidate.level === "string" && typeof candidate.message === "string";
}

function isSyncAction(value: unknown): value is SyncAction {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<SyncAction>;
	if (typeof candidate.kind !== "string" || typeof candidate.path !== "string") return false;
	if (candidate.fingerprint !== null && typeof candidate.fingerprint !== "string") return false;
	switch (candidate.kind) {
		case "body":
		case "frontmatter":
		case "trash":
			return typeof (candidate as { previousContent?: unknown }).previousContent === "string";
		case "create":
			return true;
		case "rename":
			return typeof (candidate as { previousPath?: unknown }).previousPath === "string";
		default:
			return false;
	}
}

function isSyncRun(value: unknown): value is SyncRun {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<SyncRun>;
	if (typeof candidate.timestamp !== "string" || typeof candidate.scope !== "string") return false;
	return Array.isArray(candidate.actions) && candidate.actions.every(isSyncAction);
}

/**
 * Splits the plugin's raw `loadData()` payload into settings, journal and sync
 * history. A payload with a `settings` key is the current format; anything
 * else is the legacy flat shape (the settings object itself, no journal/
 * history) — treated as settings with both empty rather than rejected, so an
 * existing `data.json` keeps working after this sub-plan, same tolerance
 * already applied to individual fields by `settings/types.ts::normalizeSettings`.
 */
export function normalizePersistedData(raw: unknown): PersistedData {
	const hasSettingsKey = typeof raw === "object" && raw !== null && "settings" in raw;
	if (!hasSettingsKey) return { settingsRaw: raw, journal: [], history: [] };

	const { settings, journal: rawJournal, history: rawHistory } = raw as {
		settings: unknown;
		journal?: unknown;
		history?: unknown;
	};
	const journal = Array.isArray(rawJournal) ? rawJournal.filter(isJournalEntry) : [];
	const history = Array.isArray(rawHistory) ? rawHistory.filter(isSyncRun) : [];
	return { settingsRaw: settings, journal, history };
}
