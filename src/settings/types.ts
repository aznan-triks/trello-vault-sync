import { DEFAULT_ATTACHMENTS_KEY, DEFAULT_LINKED_CARDS_KEY, DEFAULT_SYNC_ATTACHMENTS } from "../core/attachmentRef";
import { DEFAULT_CARD_REF_KEY } from "../core/cardRef";
import { DEFAULT_CHECKLIST_HEADING, DEFAULT_SYNC_CHECKLISTS } from "../core/checklistRef";
import { DEFAULT_DUE_KEY } from "../core/dueRef";
import { DEFAULT_LABELS_KEY } from "../core/labelRef";
import { DEFAULT_LABELS_SYNC_MODE, type LabelSyncMode } from "../core/labelMerge";
import type { ConflictPolicy } from "../core/syncDecision";
import type { FolderMapping } from "../features/syncFolder";

export interface TrelloVaultSyncSettings {
	/** The single Trello credential pair used by every command. */
	apiKey: string;
	token: string;
	boardId: string;

	/** Folder the vault-wide commands walk; "" means the whole vault. */
	scope: string;
	/** Folders ignored by vault-wide sync and audits, regardless of link state. */
	excludedFolders: string[];
	/** Note the audit reports are written into. */
	reportPath: string;
	/** Page the "Export change log as HTML" command writes into — created if missing, overwritten if present. */
	changesHtmlPath: string;

	policy: ConflictPolicy;
	/** Timestamp tolerance, in seconds, below which a divergence is a conflict. */
	marginSeconds: number;
	/** "merge" (default) unions both sides non-destructively; "overwrite" behaves like `policy` for labels. */
	labelsSyncMode: LabelSyncMode;
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
	/** Per-attempt network timeout, in ms — a request that outlives this is treated as a transport-level failure (retryable), same path as a 5xx. */
	requestTimeoutMs: number;

	/** Trello list ↔ vault folder pairs, replacing the per-folder scripts. */
	mappings: FolderMapping[];

	showPanel: boolean;
	panelAutoCloseSeconds: number;

	/** Ids (from `commands/registry.ts`) of the commands shown as ribbon icons, in registry order. */
	ribbonCommandIds: string[];

	/** "Audit changes" cursor: id of the last processed Trello action, "" before a first run. No settings-tab field — internal bookkeeping. */
	auditChangesCursor: string;

	/**
	 * Frontmatter keys — every one is user-editable, none is a hidden constant
	 * in the sync logic (§1.4, no-hardcode). Changing one on a vault with
	 * already-linked notes orphans them until their frontmatter is updated to
	 * match; `cardRefFrontmatterKey` carries the biggest blast radius since
	 * every command depends on it to find a note's card.
	 */
	cardRefFrontmatterKey: string;
	dueFrontmatterKey: string;
	labelsFrontmatterKey: string;
	attachmentsFrontmatterKey: string;
	linkedCardsFrontmatterKey: string;

	/** Pull-only, on by default — costs one extra Trello request per note synced (attachments aren't embedded in the card object). */
	syncAttachments: boolean;

	/** On by default — costs one extra Trello request per note synced (checklists aren't embedded in the card object either). */
	syncChecklists: boolean;
	/** Heading marking the checklist section — always the last thing in a note's body, not a frontmatter key. */
	checklistHeading: string;
}

export const DEFAULT_SETTINGS: TrelloVaultSyncSettings = {
	apiKey: "",
	token: "",
	boardId: "",
	scope: "",
	excludedFolders: [],
	reportPath: "",
	changesHtmlPath: "",
	policy: "newer-wins",
	marginSeconds: 60,
	labelsSyncMode: DEFAULT_LABELS_SYNC_MODE,
	syncTitle: true,
	dryRun: false,
	allowCreate: true,
	allowDelete: false,
	similarityThreshold: 0.45,
	maxRetries: 3,
	baseDelayMs: 800,
	requestTimeoutMs: 30_000,
	mappings: [],
	showPanel: true,
	panelAutoCloseSeconds: 8,
	ribbonCommandIds: ["sync-active-note", "sync-vault", "sync-all-mappings", "audit-links"],
	auditChangesCursor: "",
	cardRefFrontmatterKey: DEFAULT_CARD_REF_KEY,
	dueFrontmatterKey: DEFAULT_DUE_KEY,
	labelsFrontmatterKey: DEFAULT_LABELS_KEY,
	attachmentsFrontmatterKey: DEFAULT_ATTACHMENTS_KEY,
	linkedCardsFrontmatterKey: DEFAULT_LINKED_CARDS_KEY,
	syncAttachments: DEFAULT_SYNC_ATTACHMENTS,
	syncChecklists: DEFAULT_SYNC_CHECKLISTS,
	checklistHeading: DEFAULT_CHECKLIST_HEADING,
};

/** Highest retry count normalizeSettings will accept before clamping. */
export const MAX_RETRIES_CEILING = 10;
/** Highest backoff delay, in ms, normalizeSettings will accept before clamping. */
export const BASE_DELAY_MS_CEILING = 60_000;
/** Highest per-request timeout, in ms, normalizeSettings will accept before clamping. */
export const REQUEST_TIMEOUT_MS_CEILING = 120_000;
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

/**
 * A trimmed, non-empty frontmatter key, or `fallback` — a blank key would
 * silently break every read/write through it. Shared by `normalizeSettings`
 * (persisted data) and `SettingsTab.ts` (live user input) — the same
 * unknown-input-to-safe-string concern at both boundaries.
 */
export function safeFrontmatterKey(value: unknown, fallback: string): string {
	const trimmed = safeString(value).trim();
	return trimmed === "" ? fallback : trimmed;
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
		excludedFolders: (Array.isArray(input.excludedFolders) ? input.excludedFolders : [])
			.map((folder) => normalizeVaultPath(safeString(folder)))
			.filter((folder) => folder !== ""),
		reportPath: normalizeVaultPath(safeString(input.reportPath, DEFAULT_SETTINGS.reportPath)),
		changesHtmlPath: normalizeVaultPath(safeString(input.changesHtmlPath, DEFAULT_SETTINGS.changesHtmlPath)),
		auditChangesCursor: safeString(input.auditChangesCursor, DEFAULT_SETTINGS.auditChangesCursor),
		marginSeconds: safeNonNegativeNumber(input.marginSeconds, DEFAULT_SETTINGS.marginSeconds),
		labelsSyncMode: input.labelsSyncMode === "overwrite" ? "overwrite" : DEFAULT_SETTINGS.labelsSyncMode,
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
		requestTimeoutMs: safeNonNegativeNumber(
			input.requestTimeoutMs,
			DEFAULT_SETTINGS.requestTimeoutMs,
			REQUEST_TIMEOUT_MS_CEILING,
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
		ribbonCommandIds: (Array.isArray(input.ribbonCommandIds) ? input.ribbonCommandIds : DEFAULT_SETTINGS.ribbonCommandIds)
			.filter((id): id is string => typeof id === "string"),
		mappings: mappings.map((mapping) => ({
			listId: safeString(mapping?.listId),
			folder: normalizeVaultPath(safeString(mapping?.folder)),
			templateName: safeString(mapping?.templateName),
		})),
		cardRefFrontmatterKey: safeFrontmatterKey(input.cardRefFrontmatterKey, DEFAULT_SETTINGS.cardRefFrontmatterKey),
		dueFrontmatterKey: safeFrontmatterKey(input.dueFrontmatterKey, DEFAULT_SETTINGS.dueFrontmatterKey),
		labelsFrontmatterKey: safeFrontmatterKey(input.labelsFrontmatterKey, DEFAULT_SETTINGS.labelsFrontmatterKey),
		attachmentsFrontmatterKey: safeFrontmatterKey(
			input.attachmentsFrontmatterKey,
			DEFAULT_SETTINGS.attachmentsFrontmatterKey,
		),
		linkedCardsFrontmatterKey: safeFrontmatterKey(
			input.linkedCardsFrontmatterKey,
			DEFAULT_SETTINGS.linkedCardsFrontmatterKey,
		),
		checklistHeading: safeFrontmatterKey(input.checklistHeading, DEFAULT_SETTINGS.checklistHeading),
	};
}
