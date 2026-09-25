import {
	DEFAULT_ATTACHMENTS_KEY,
	DEFAULT_COVER_KEY,
	DEFAULT_COVER_LOCAL_FORMAT,
	DEFAULT_LINKED_CARDS_KEY,
	DEFAULT_PREFER_LOCAL_COVER,
	DEFAULT_SYNC_ATTACHMENTS,
	DEFAULT_SYNC_CARD_COVER,
	DEFAULT_SYNC_LINKED_CARDS,
	type CoverLocalFormat,
} from "../core/attachmentRef";
import type { AttachmentsDestination, AttachmentsDownloadScope } from "../core/attachmentPath";
import { DEFAULT_CARD_REF_KEY } from "../core/cardRef";
import { DEFAULT_CUSTOM_FIELDS_KEY, DEFAULT_SYNC_CUSTOM_FIELDS } from "../core/customFieldRef";
import { DEFAULT_MEMBERS_KEY, DEFAULT_SYNC_MEMBERS } from "../core/memberRef";
import { DEFAULT_CHECKLIST_HEADING, DEFAULT_SYNC_CHECKLISTS } from "../core/checklistRef";
import { DEFAULT_DUE_KEY } from "../core/dueRef";
import { DEFAULT_LABELS_KEY } from "../core/labelRef";
import { DEFAULT_LABELS_SYNC_MODE, type LabelSyncMode } from "../core/labelMerge";
import { safeOverrideMode } from "../core/mappingOverride";
import type { OrphanCardScope } from "../core/orphanCardDestination";
import type { PhantomNoteScope } from "../core/phantomCardDestination";
import type { ConflictPolicy } from "../core/syncDecision";
import type { FolderMapping } from "../features/syncFolder";

export type { CoverLocalFormat, OrphanCardScope, PhantomNoteScope };

export interface TrelloVaultSyncSettings {
	/** The single Trello credential pair used by every command. */
	apiKey: string;
	token: string;
	boardId: string;

	/** Folder the vault-wide commands walk; "" means the whole vault. */
	scope: string;
	/** Folders ignored by vault-wide sync and audits, regardless of link state. */
	excludedFolders: string[];
	/** Note the audit reports are written into. Legacy fallback for link/location/changes report paths. */
	reportPath: string;
	/** Note the link audit report is written into. */
	linkAuditReportPath: string;
	/** Note the location comparison report is written into. */
	locationAuditReportPath: string;
	/** Note the change log markdown report is written into. */
	changesReportPath: string;
	/** Page the "Export change log as HTML" command writes into — created if missing, overwritten if present. */
	changesHtmlPath: string;

	policy: ConflictPolicy;
	/** Timestamp tolerance, in seconds, below which a divergence is a conflict. */
	marginSeconds: number;
	/** "merge" (default) unions both sides non-destructively; "overwrite" behaves like `policy` for labels. */
	labelsSyncMode: LabelSyncMode;
	syncTitle: boolean;
	syncDescription: boolean;
	syncDue: boolean;
	syncLabels: boolean;
	/** Global safety switch: plan everything, write nothing. */
	dryRun: boolean;

	allowCreate: boolean;
	/** Trash a note when its card leaves the mapped list. Destructive, off by default. */
	allowDelete: boolean;
	/**
	 * Before deleting, checks whether the card was only moved to another list or archived
	 * elsewhere on the board instead of truly gone. Off by default — missing from the mapped
	 * list is enough, same as everywhere else "gone" is decided in this plugin.
	 */
	protectMovedOrArchivedCards: boolean;

	/** Minimum title similarity accepted when linking a note to a card. */
	similarityThreshold: number;
	maxRetries: number;
	baseDelayMs: number;
	/** Per-attempt network timeout, in ms — a request that outlives this is treated as a transport-level failure (retryable), same path as a 5xx. */
	requestTimeoutMs: number;
	/** Ceiling on a single retry wait, in ms — independent of maxRetries/baseDelayMs or a Retry-After header. */
	maxBackoffDelayMs: number;
	/** On by default — attachments and checklists ride the card request itself instead of one extra request per note. Off: one request per note per feature (heavy boards may prefer smaller responses). */
	fetchCardDetailsWithCards: boolean;

	/** Trello list ↔ vault folder pairs, replacing the per-folder scripts. */
	mappings: FolderMapping[];

	showPanel: boolean;
	panelAutoCloseSeconds: number;
	/** Sidebar badge showing the last sync run's unresolved-conflict count — on by default, no stored history across reloads (§C6 of `AUDIT_2026-09-25_ux-settings-features.md`). */
	showConflictIndicator: boolean;
	/** On by default — a run that logged ≥ 1 error never auto-closes the panel, even when `panelAutoCloseSeconds > 0`, so errors aren't missed by a panel that vanished on its own. */
	keepPanelOpenOnError: boolean;

	/** Ids (from `commands/registry.ts`) of the commands shown as ribbon icons, in registry order. */
	ribbonCommandIds: string[];
	/** Custom hex colors for ribbon icons, keyed by command id. Missing or empty means default theme color. */
	ribbonIconColors: Record<string, string>;

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
	/** Only meaningful when `syncAttachments` is on — resolves a card-link attachment to a wikilink. On by default (matches the historical, un-toggleable behavior). No extra Trello request. */
	syncLinkedCards: boolean;

	/** On by default — costs one extra Trello request per note synced (checklists aren't embedded in the card object either). */
	syncChecklists: boolean;
	/** On by default — an audit creates its report note instead of throwing "Report note not found" when it doesn't exist yet. */
	autoCreateReportNote: boolean;
	/** Heading marking the checklist section — always the last thing in a note's body, not a frontmatter key. */
	checklistHeading: string;

	/** On by default — records every vault write a sync makes so it can be undone later ("Show sync history" / "Undo last sync run"). */
	historyEnabled: boolean;
	/** Oldest run is dropped once this many are recorded. */
	historyMaxRuns: number;
	/** On by default — an undo also reverts the Trello-side writes a run made. Off: only vault writes are reverted; Trello actions are skipped and reported as disabled in settings, not attempted. */
	historyRevertTrelloWrites: boolean;
	/** On by default — shows a confirmation modal before "Undo last sync run" / "Undo last sync for the active note" (the picker command already ends on its own explicit "Undo selected" button, so it never goes through this gate). Off disables the modal for repeated use. */
	confirmUndo: boolean;

	/** Pull-only, no extra Trello request. */
	syncCardCover: boolean;
	coverFrontmatterKey: string;
	/** Off by default — when enabled, writes the local path or wikilink of the downloaded cover image into the cover key instead of Trello's remote url. */
	preferLocalCover: boolean;
	/** Link format written into the frontmatter when a local cover image is used. */
	coverLocalFormat: CoverLocalFormat;
	/** Off by default — writes binary files into the vault, unlike every other sync feature here. */
	downloadAttachments: boolean;
	attachmentsDestination: AttachmentsDestination;
	/** Required (non-empty) only when `attachmentsDestination` is `"global-folder"`. */
	attachmentsFolder: string;
	/** `"cover-only"` restricts a download run to the card's cover attachment (via `TrelloCardCover.idAttachment`) — everything else stays a frontmatter link, never downloaded. */
	attachmentsDownloadScope: AttachmentsDownloadScope;

	/** On by default — shows a confirmation modal before a force pull/push at folder or vault scope (destructive by nature). Off disables the modal for repeated use. */
	confirmForceSync: boolean;

	/** On by default — shows a confirmation modal (with the count) before "Create for ALL" in the orphan-card / phantom-note pickers, so a single wrong click can't kick off a large batch. Off disables the modal for repeated use. */
	confirmBatchCreate: boolean;

	/** Fallback folder for "Create note from a Trello card" when the card's list isn't mapped to one. Empty means the user is prompted at creation time instead of a silent guess. */
	orphanCardFolder: string;
	/** When true, "Create note from a Trello card" offers a batch create option for all orphan cards. Default is true. */
	orphanCardBatchCreate: boolean;
	/** Scope of orphan cards to consider for note creation: "all" or "mapped-lists-only". Default is "all". */
	orphanCardScope: OrphanCardScope;
	/** Fallback note template used when creating a new note if the mapping doesn't specify one. */
	defaultTemplateName: string;
	/** Destination Trello list id where cards created from phantom/unlinked notes should go. Empty means the user is prompted each time. */
	phantomCardListId: string;
	/** When true, notes located in a mapped folder are created in that folder's mapped list rather than phantomCardListId. Default is false. */
	phantomNotePreferFolderMapping: boolean;
	/** Scope of notes to consider when creating cards from phantom notes. Default is "all-unlinked". */
	phantomNoteScope: PhantomNoteScope;

	/** Off by default — an unsolicited sync writes to the vault. */
	autoSyncEnabled: boolean;
	/** Independent toggles (not an either/or) — any combination triggers an auto-sync check on that event. */
	autoSyncOnInterval: boolean;
	autoSyncOnFocus: boolean;
	autoSyncOnStartup: boolean;
	autoSyncIntervalMinutes: number;
	/** Independent toggles — an auto-sync run does every scope turned on, in this order (mapped folders first, since that's the one that can create notes). */
	autoSyncScopeMappings: boolean;
	autoSyncScopeVault: boolean;
	/** Anti-burst floor, in seconds, between two auto-sync attempts regardless of what triggered either. */
	autoSyncMinIdleSeconds: number;

	/** Pull-only — costs one extra Trello request per *run* (the board's member directory), not per note. */
	syncMembers: boolean;
	membersFrontmatterKey: string;

	/** Pull-only — no extra request per note (values ride the card); one extra request per *run* for the field-definition directory. */
	syncCustomFields: boolean;
	customFieldsFrontmatterKey: string;
}

export const DEFAULT_SETTINGS: TrelloVaultSyncSettings = {
	apiKey: "",
	token: "",
	boardId: "",
	scope: "",
	excludedFolders: [],
	reportPath: "",
	linkAuditReportPath: "",
	locationAuditReportPath: "",
	changesReportPath: "",
	changesHtmlPath: "",
	policy: "newer-wins",
	marginSeconds: 60,
	labelsSyncMode: DEFAULT_LABELS_SYNC_MODE,
	syncTitle: true,
	syncDescription: true,
	syncDue: true,
	syncLabels: true,
	dryRun: false,
	allowCreate: true,
	allowDelete: false,
	protectMovedOrArchivedCards: false,
	similarityThreshold: 0.45,
	maxRetries: 3,
	baseDelayMs: 800,
	requestTimeoutMs: 30_000,
	maxBackoffDelayMs: 30_000,
	fetchCardDetailsWithCards: true,
	mappings: [],
	showPanel: true,
	panelAutoCloseSeconds: 8,
	showConflictIndicator: true,
	keepPanelOpenOnError: true,
	ribbonCommandIds: ["open-sidebar", "sync-active-note", "sync-vault", "sync-all-mappings", "audit-links"],
	ribbonIconColors: {},
	auditChangesCursor: "",
	cardRefFrontmatterKey: DEFAULT_CARD_REF_KEY,
	dueFrontmatterKey: DEFAULT_DUE_KEY,
	labelsFrontmatterKey: DEFAULT_LABELS_KEY,
	attachmentsFrontmatterKey: DEFAULT_ATTACHMENTS_KEY,
	linkedCardsFrontmatterKey: DEFAULT_LINKED_CARDS_KEY,
	syncAttachments: DEFAULT_SYNC_ATTACHMENTS,
	syncLinkedCards: DEFAULT_SYNC_LINKED_CARDS,
	syncChecklists: DEFAULT_SYNC_CHECKLISTS,
	autoCreateReportNote: true,
	checklistHeading: DEFAULT_CHECKLIST_HEADING,
	historyEnabled: true,
	historyMaxRuns: 20,
	historyRevertTrelloWrites: true,
	confirmUndo: true,
	syncCardCover: DEFAULT_SYNC_CARD_COVER,
	coverFrontmatterKey: DEFAULT_COVER_KEY,
	preferLocalCover: DEFAULT_PREFER_LOCAL_COVER,
	coverLocalFormat: DEFAULT_COVER_LOCAL_FORMAT,
	downloadAttachments: false,
	attachmentsDestination: "note-folder",
	attachmentsDownloadScope: "all",
	attachmentsFolder: "",
	confirmForceSync: true,
	confirmBatchCreate: true,
	orphanCardFolder: "",
	orphanCardBatchCreate: true,
	orphanCardScope: "all",
	defaultTemplateName: "",
	phantomCardListId: "",
	phantomNotePreferFolderMapping: false,
	phantomNoteScope: "all-unlinked",
	autoSyncEnabled: false,
	autoSyncOnInterval: true,
	autoSyncOnFocus: false,
	autoSyncOnStartup: false,
	autoSyncIntervalMinutes: 15,
	autoSyncScopeMappings: true,
	autoSyncScopeVault: false,
	autoSyncMinIdleSeconds: 60,
	syncMembers: DEFAULT_SYNC_MEMBERS,
	membersFrontmatterKey: DEFAULT_MEMBERS_KEY,
	syncCustomFields: DEFAULT_SYNC_CUSTOM_FIELDS,
	customFieldsFrontmatterKey: DEFAULT_CUSTOM_FIELDS_KEY,
};

/** Highest interval, in minutes, `autoSyncIntervalMinutes` will accept before clamping. */
export const AUTO_SYNC_INTERVAL_MINUTES_CEILING = 1440;
/** Highest anti-burst floor, in seconds, `autoSyncMinIdleSeconds` will accept before clamping. */
export const AUTO_SYNC_MIN_IDLE_SECONDS_CEILING = 3600;

/** Highest number of runs `historyMaxRuns` will accept before clamping — a corrupted setting must not turn into an unbounded `data.json`. */
export const HISTORY_MAX_RUNS_CEILING = 200;

/** Highest retry count normalizeSettings will accept before clamping. */
export const MAX_RETRIES_CEILING = 10;
/** Highest backoff delay, in ms, normalizeSettings will accept before clamping. */
export const BASE_DELAY_MS_CEILING = 60_000;
/** Highest per-request timeout, in ms, normalizeSettings will accept before clamping. */
export const REQUEST_TIMEOUT_MS_CEILING = 120_000;
/** Highest retry-wait ceiling, in ms, normalizeSettings will accept before clamping. */
export const MAX_BACKOFF_DELAY_MS_CEILING = 300_000;
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

export function normalizeRibbonIconColors(raw: unknown): Record<string, string> {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return {};
	}
	const result: Record<string, string> = {};
	for (const [key, val] of Object.entries(raw)) {
		if (typeof key === "string" && typeof val === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(val.trim())) {
			result[key] = val.trim();
		}
	}
	return result;
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
		linkAuditReportPath: normalizeVaultPath(
			safeString(input.linkAuditReportPath ?? input.reportPath, DEFAULT_SETTINGS.linkAuditReportPath),
		),
		locationAuditReportPath: normalizeVaultPath(
			safeString(input.locationAuditReportPath ?? input.reportPath, DEFAULT_SETTINGS.locationAuditReportPath),
		),
		changesReportPath: normalizeVaultPath(
			safeString(input.changesReportPath ?? input.reportPath, DEFAULT_SETTINGS.changesReportPath),
		),
		changesHtmlPath: normalizeVaultPath(safeString(input.changesHtmlPath, DEFAULT_SETTINGS.changesHtmlPath)),
		auditChangesCursor: safeString(input.auditChangesCursor, DEFAULT_SETTINGS.auditChangesCursor),
		marginSeconds: safeNonNegativeNumber(input.marginSeconds, DEFAULT_SETTINGS.marginSeconds),
		labelsSyncMode: input.labelsSyncMode === "overwrite" ? "overwrite" : DEFAULT_SETTINGS.labelsSyncMode,
		syncDescription: input.syncDescription !== false,
		syncDue: input.syncDue !== false,
		syncLabels: input.syncLabels !== false,
		showConflictIndicator: input.showConflictIndicator !== false,
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
		maxBackoffDelayMs: safeNonNegativeNumber(
			input.maxBackoffDelayMs,
			DEFAULT_SETTINGS.maxBackoffDelayMs,
			MAX_BACKOFF_DELAY_MS_CEILING,
		),
		panelAutoCloseSeconds: safeNonNegativeNumber(
			input.panelAutoCloseSeconds,
			DEFAULT_SETTINGS.panelAutoCloseSeconds,
		),
		keepPanelOpenOnError: input.keepPanelOpenOnError !== false,
		confirmBatchCreate: input.confirmBatchCreate !== false,
		similarityThreshold: safeNonNegativeNumber(
			input.similarityThreshold,
			DEFAULT_SETTINGS.similarityThreshold,
			SIMILARITY_THRESHOLD_CEILING,
		),
		historyMaxRuns: safeNonNegativeNumber(
			input.historyMaxRuns,
			DEFAULT_SETTINGS.historyMaxRuns,
			HISTORY_MAX_RUNS_CEILING,
		),
		ribbonCommandIds: (() => {
			const rawIds = (Array.isArray(input.ribbonCommandIds) ? input.ribbonCommandIds : DEFAULT_SETTINGS.ribbonCommandIds)
				.filter((id): id is string => typeof id === "string");
			// Migration from pre-1.18 versions where "open-sidebar" was permanently hardcoded in the ribbon:
			// If settings have the exact 4 default ribbon commands from older versions and ribbonIconColors was
			// undefined (never saved on 1.18+), upgrade to the new 5-command default including "open-sidebar".
			const OLD_DEFAULT_RIBBON_IDS = ["sync-active-note", "sync-vault", "sync-all-mappings", "audit-links"];
			const isOldDefault =
				rawIds.length === OLD_DEFAULT_RIBBON_IDS.length &&
				rawIds.every((id, idx) => id === OLD_DEFAULT_RIBBON_IDS[idx]);
			if (input.ribbonIconColors === undefined && isOldDefault) {
				return DEFAULT_SETTINGS.ribbonCommandIds;
			}
			return rawIds;
		})(),
		ribbonIconColors: normalizeRibbonIconColors(input.ribbonIconColors),
		mappings: mappings.map((mapping) => ({
			listId: safeString(mapping?.listId),
			folder: normalizeVaultPath(safeString(mapping?.folder)),
			templateName: safeString(mapping?.templateName),
			allowCreateOverride: safeOverrideMode(mapping?.allowCreateOverride),
			allowDeleteOverride: safeOverrideMode(mapping?.allowDeleteOverride),
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
		coverFrontmatterKey: safeFrontmatterKey(input.coverFrontmatterKey, DEFAULT_SETTINGS.coverFrontmatterKey),
		preferLocalCover: input.preferLocalCover === true,
		coverLocalFormat: input.coverLocalFormat === "wikilink" ? "wikilink" : "vault-path",
		attachmentsDestination: input.attachmentsDestination === "global-folder" ? "global-folder" : "note-folder",
		attachmentsDownloadScope: input.attachmentsDownloadScope === "cover-only" ? "cover-only" : "all",
		attachmentsFolder: normalizeVaultPath(safeString(input.attachmentsFolder, DEFAULT_SETTINGS.attachmentsFolder)),
		orphanCardFolder: normalizeVaultPath(safeString(input.orphanCardFolder, DEFAULT_SETTINGS.orphanCardFolder)),
		orphanCardBatchCreate: input.orphanCardBatchCreate !== false,
		orphanCardScope: input.orphanCardScope === "mapped-lists-only" ? "mapped-lists-only" : "all",
		defaultTemplateName: safeString(input.defaultTemplateName, DEFAULT_SETTINGS.defaultTemplateName).trim(),
		phantomCardListId: safeString(input.phantomCardListId, DEFAULT_SETTINGS.phantomCardListId).trim(),
		phantomNotePreferFolderMapping: input.phantomNotePreferFolderMapping === true,
		phantomNoteScope:
			input.phantomNoteScope === "phantom-only" || input.phantomNoteScope === "mapped-folders-only"
				? input.phantomNoteScope
				: "all-unlinked",
		autoSyncIntervalMinutes: safeNonNegativeNumber(
			input.autoSyncIntervalMinutes,
			DEFAULT_SETTINGS.autoSyncIntervalMinutes,
			AUTO_SYNC_INTERVAL_MINUTES_CEILING,
		),
		autoSyncMinIdleSeconds: safeNonNegativeNumber(
			input.autoSyncMinIdleSeconds,
			DEFAULT_SETTINGS.autoSyncMinIdleSeconds,
			AUTO_SYNC_MIN_IDLE_SECONDS_CEILING,
		),
		membersFrontmatterKey: safeFrontmatterKey(input.membersFrontmatterKey, DEFAULT_SETTINGS.membersFrontmatterKey),
		customFieldsFrontmatterKey: safeFrontmatterKey(
			input.customFieldsFrontmatterKey,
			DEFAULT_SETTINGS.customFieldsFrontmatterKey,
		),
	};
}
