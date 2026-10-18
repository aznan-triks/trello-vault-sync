import type { IgnoredCards } from "./deletedNotes";
import type { JournalEntry } from "./journal";
import type { SyncAction, SyncRun } from "./syncHistory";

export interface PersistedData {
	/** Raw payload for `normalizeSettings` to finish validating — this module only decides which part of `raw` it is. */
	settingsRaw: unknown;
	journal: JournalEntry[];
	history: SyncRun[];
	/** Epoch ms of the last successful sync (manual or auto) — the auto-sync timer counts from it, across restarts. */
	lastSyncAt: number | null;
	/** List id -> ids of its cards that had a note at the last successful pass (how a deleted note is told from a new card). */
	knownLinks: Record<string, string[]>;
	/** Cards that must never get a note again, by card id. */
	ignoredCards: IgnoredCards;
}

function normalizeKnownLinks(raw: unknown): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	if (typeof raw !== "object" || raw === null) return out;
	for (const [listId, ids] of Object.entries(raw)) {
		if (Array.isArray(ids)) out[listId] = ids.filter((id): id is string => typeof id === "string");
	}
	return out;
}

function normalizeIgnoredCards(raw: unknown): IgnoredCards {
	const out: IgnoredCards = {};
	if (typeof raw !== "object" || raw === null) return out;
	for (const [cardId, entry] of Object.entries(raw)) {
		const e = entry as { name?: unknown; since?: unknown } | null;
		if (typeof e?.name === "string" && typeof e.since === "string") out[cardId] = { name: e.name, since: e.since };
	}
	return out;
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
	switch (candidate.kind) {
		case "body":
		case "frontmatter":
		case "trash": {
			const fp = (candidate as { fingerprint?: unknown }).fingerprint;
			if (fp !== null && typeof fp !== "string") return false;
			return typeof (candidate as { previousContent?: unknown }).previousContent === "string";
		}
		case "create": {
			const fp = (candidate as { fingerprint?: unknown }).fingerprint;
			return fp === null || typeof fp === "string";
		}
		case "rename": {
			const fp = (candidate as { fingerprint?: unknown }).fingerprint;
			if (fp !== null && typeof fp !== "string") return false;
			return typeof (candidate as { previousPath?: unknown }).previousPath === "string";
		}
		case "trello-card":
			return typeof (candidate as { cardId?: unknown }).cardId === "string";
		case "trello-checkitem":
			return (
				typeof (candidate as { cardId?: unknown }).cardId === "string" &&
				typeof (candidate as { checkItemId?: unknown }).checkItemId === "string"
			);
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
	if (!hasSettingsKey) return { settingsRaw: raw, journal: [], history: [], lastSyncAt: null, knownLinks: {}, ignoredCards: {} };

	const { settings, journal: rawJournal, history: rawHistory, lastSyncAt: rawLastSyncAt, knownLinks: rawKnown, ignoredCards: rawIgnored } = raw as {
		settings: unknown;
		journal?: unknown;
		history?: unknown;
		lastSyncAt?: unknown;
		knownLinks?: unknown;
		ignoredCards?: unknown;
	};
	const journal = Array.isArray(rawJournal) ? rawJournal.filter(isJournalEntry) : [];
	const history = Array.isArray(rawHistory) ? rawHistory.filter(isSyncRun) : [];
	const lastSyncAt = typeof rawLastSyncAt === "number" && Number.isFinite(rawLastSyncAt) ? rawLastSyncAt : null;
	return {
		settingsRaw: settings,
		journal,
		history,
		lastSyncAt,
		knownLinks: normalizeKnownLinks(rawKnown),
		ignoredCards: normalizeIgnoredCards(rawIgnored),
	};
}
