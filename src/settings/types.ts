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
export const MAX_RETRIES_CEILING = 10;
/** Highest backoff delay, in ms, normalizeSettings will accept before clamping. */
export const BASE_DELAY_MS_CEILING = 60_000;
/** A similarity score never exceeds 1 (100% match). */
const SIMILARITY_THRESHOLD_CEILING = 1;

/**
 * A non-negative, finite number, or `fallback` when the raw value is not usable.
 * `ceiling`, when given, caps the result so a corrupted setting cannot turn into
 * an unbounded retry loop or a permanently-disabled safety margin.
 */
export function safeNonNegativeNumber(value: unknown, fallback: number, ceiling?: number): number {
	const usable = typeof value === "number" && Number.isFinite(value) ? value : fallback;
	const nonNegative = Math.max(0, usable);
	return ceiling === undefined ? nonNegative : Math.min(nonNegative, ceiling);
}

/** A string, or `fallback` when the raw value is not a string. */
function safeString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

/** True once the single Trello key/token pair is filled in — the minimum every command needs. */
export function hasCredentials(settings: Pick<TrelloVaultSyncSettings, "apiKey" | "token">): boolean {
	return settings.apiKey.trim() !== "" && settings.token.trim() !== "";
}

/**
 * Normalizes a user-typed vault-relative path: backslashes become forward
 * slashes, duplicate/leading/trailing slashes are collapsed. A leading slash
 * in particular is easy to paste in by accident and otherwise makes
 * `VaultGateway.listNotes` silently match zero notes instead of failing fast.
 * A local reimplementation rather than Obsidian's own `normalizePath`: this
 * file is unit-tested in plain Node, and the `obsidian` package ships no
 * runtime code outside the real app.
 */
export function normalizeVaultPath(value: string): string {
	return value
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/^\/+/, "")
		.replace(/\/+$/, "");
}

/** Settings merged over the defaults, tolerating a partial or legacy payload. */
export function normalizeSettings(raw: unknown): TrelloVaultSyncSettings {
	const input = (raw ?? {}) as Partial<TrelloVaultSyncSettings>;
	const mappings = Array.isArray(input.mappings) ? input.mappings : [];
	return {
		...DEFAULT_SETTINGS,
		...input,
		apiKey: safeString(input.apiKey, DEFAULT_SETTINGS.apiKey),
		token: safeString(input.token, DEFAULT_SETTINGS.token),
		boardId: safeString(input.boardId, DEFAULT_SETTINGS.boardId),
		scope: normalizeVaultPath(safeString(input.scope, DEFAULT_SETTINGS.scope)),
		reportPath: normalizeVaultPath(safeString(input.reportPath, DEFAULT_SETTINGS.reportPath)),
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
			listId: safeString(mapping?.listId),
			folder: normalizeVaultPath(safeString(mapping?.folder)),
			templateName: safeString(mapping?.templateName),
		})),
	};
}
