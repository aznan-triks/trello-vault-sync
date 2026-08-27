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

/** Settings merged over the defaults, tolerating a partial or legacy payload. */
export function normalizeSettings(raw: unknown): TrelloVaultSyncSettings {
	const input = (raw ?? {}) as Partial<TrelloVaultSyncSettings>;
	const mappings = Array.isArray(input.mappings) ? input.mappings : [];
	return {
		...DEFAULT_SETTINGS,
		...input,
		mappings: mappings.map((mapping) => ({
			listId: mapping?.listId ?? "",
			folder: mapping?.folder ?? "",
			templateName: mapping?.templateName ?? "",
		})),
	};
}
