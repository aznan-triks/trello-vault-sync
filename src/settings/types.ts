import type { ConflictPolicy } from "../core/syncDecision";
import type { FolderMapping } from "../features/syncFolder";

export interface TrelloVaultSyncSettings {
	/** The single Trello credential pair used by every command. */
	apiKey: string;
	token: string;
	boardId: string;

	/** Folder the vault-wide commands walk; "" means the whole vault. */
	scope: string;
	/** Note the audit reports are written into. */
	reportPath: string;

	policy: ConflictPolicy;
	/** Timestamp tolerance, in seconds, below which a divergence is a conflict. */
	marginSeconds: number;
	syncTitle: boolean;
	/** Global safety switch: plan everything, write nothing. */
	dryRun: boolean;

	allowCreate: boolean;
	/** Trash a note when its card leaves the mapped list. Destructive, off by default. */
	allowDelete: boolean;

	/** Minimum title similarity accepted when linking a note to a card. */
	similarityThreshold: number;
	maxRetries: number;
	baseDelayMs: number;

	/** Trello list ↔ vault folder pairs, replacing the per-folder scripts. */
	mappings: FolderMapping[];

	showPanel: boolean;
	panelAutoCloseSeconds: number;
}

export const DEFAULT_SETTINGS: TrelloVaultSyncSettings = {
	apiKey: "",
	token: "",
	boardId: "",
	scope: "",
	reportPath: "",
	policy: "newer-wins",
	marginSeconds: 60,
	syncTitle: true,
	dryRun: false,
	allowCreate: true,
	allowDelete: false,
	similarityThreshold: 0.45,
	maxRetries: 3,
	baseDelayMs: 800,
	mappings: [],
	showPanel: true,
	panelAutoCloseSeconds: 8,
};

/** Highest retry count normalizeSettings will accept before clamping. */
const MAX_RETRIES_CEILING = 10;
/** Highest backoff delay, in ms, normalizeSettings will accept before clamping. */
const BASE_DELAY_MS_CEILING = 60_000;
/** A similarity score never exceeds 1 (100% match). */
const SIMILARITY_THRESHOLD_CEILING = 1;

/**
 * A non-negative, finite number, or `fallback` when the raw value is not usable.
 * `ceiling`, when given, caps the result so a corrupted setting cannot turn into
 * an unbounded retry loop or a permanently-disabled safety margin.
 */
function safeNonNegativeNumber(value: unknown, fallback: number, ceiling?: number): number {
	const usable = typeof value === "number" && Number.isFinite(value) ? value : fallback;
	const nonNegative = Math.max(0, usable);
	return ceiling === undefined ? nonNegative : Math.min(nonNegative, ceiling);
}

/** Settings merged over the defaults, tolerating a partial or legacy payload. */
export function normalizeSettings(raw: unknown): TrelloVaultSyncSettings {
	const input = (raw ?? {}) as Partial<TrelloVaultSyncSettings>;
	const mappings = Array.isArray(input.mappings) ? input.mappings : [];
	return {
		...DEFAULT_SETTINGS,
		...input,
		marginSeconds: safeNonNegativeNumber(input.marginSeconds, DEFAULT_SETTINGS.marginSeconds),
		maxRetries: safeNonNegativeNumber(
			input.maxRetries,
			DEFAULT_SETTINGS.maxRetries,
			MAX_RETRIES_CEILING,
		),
		baseDelayMs: safeNonNegativeNumber(
			input.baseDelayMs,
			DEFAULT_SETTINGS.baseDelayMs,
			BASE_DELAY_MS_CEILING,
		),
		panelAutoCloseSeconds: safeNonNegativeNumber(
			input.panelAutoCloseSeconds,
			DEFAULT_SETTINGS.panelAutoCloseSeconds,
		),
		similarityThreshold: safeNonNegativeNumber(
			input.similarityThreshold,
			DEFAULT_SETTINGS.similarityThreshold,
			SIMILARITY_THRESHOLD_CEILING,
		),
		mappings: mappings.map((mapping) => ({
			listId: mapping?.listId ?? "",
			folder: mapping?.folder ?? "",
			templateName: mapping?.templateName ?? "",
		})),
	};
}
