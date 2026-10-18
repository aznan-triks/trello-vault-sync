import { DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY } from "./cardRef";

/**
 * All 12 alignment categories supported by the note cleanup and settings alignment engine.
 */
export type AlignCategory =
	| "due"
	| "labels"
	| "members"
	| "custom-fields"
	| "attachments"
	| "linked-cards"
	| "cover"
	| "plugin-note-id"
	| "missing-plugin-note-id"
	| "checklist-section"
	| "obsolete-label-property"
	| "key-migration";

/**
 * Complete list of all 12 alignment categories in stable order.
 */
export const ALIGN_CATEGORIES: readonly AlignCategory[] = [
	"due",
	"labels",
	"members",
	"custom-fields",
	"attachments",
	"linked-cards",
	"cover",
	"plugin-note-id",
	"missing-plugin-note-id",
	"checklist-section",
	"obsolete-label-property",
	"key-migration",
] as const;

/**
 * Categories safe for automated background alignment during card sync (`cleanUpDuringSync`).
 * Strictly excludes:
 * - `checklist-section`: Mutates note markdown body content.
 * - `plugin-note-id`: Shared with third-party community plugin.
 * - `missing-plugin-note-id`: Backfilling note IDs on un-migrated notes should be an explicit user choice.
 * - `obsolete-label-property`: Deletes custom properties that may require manual curation.
 */
export const SAFE_ALIGN_CATEGORIES: readonly AlignCategory[] = [
	"due",
	"labels",
	"members",
	"custom-fields",
	"attachments",
	"linked-cards",
	"cover",
	"key-migration",
] as const;

/**
 * Categories checked by default in the manual clean-up modal (`MultiSelectPickerModal`).
 * Standard frontmatter sync keys are pre-selected; user body content, third-party plugin IDs,
 * and obsolete label properties require deliberate user opt-in.
 */
export const DEFAULT_MANUAL_ALIGN_CATEGORIES: readonly AlignCategory[] = [
	"due",
	"labels",
	"members",
	"custom-fields",
	"attachments",
	"linked-cards",
	"cover",
	"key-migration",
] as const;

/**
 * Mutation action represented by an alignment change.
 */
export type AlignAction = "remove" | "add" | "migrate";

/**
 * A discrete change to be applied to a note's frontmatter or markdown body.
 */
export interface AlignChange {
	category: AlignCategory;
	action: AlignAction;
	keys: string[];
	migrations?: Record<string, string>;
	description?: string;
}

/**
 * Settings configuration interface required by the alignment decision engine.
 * Completely self-contained in `src/core/` with ZERO external dependencies or imports
 * from Obsidian or Trello network layers.
 */
export interface AlignSettings {
	syncDue: boolean;
	dueFrontmatterKey: string;
	syncLabels: boolean;
	labelsFrontmatterKey: string;
	syncMembers: boolean;
	membersFrontmatterKey: string;
	syncCustomFields: boolean;
	customFieldsFrontmatterKey: string;
	syncAttachments: boolean;
	attachmentsFrontmatterKey: string;
	syncLinkedCards: boolean;
	linkedCardsFrontmatterKey: string;
	syncCardCover: boolean;
	coverFrontmatterKey: string;
	writeTrelloPluginNoteId: boolean;
	syncChecklists: boolean;
	checklistHeading: string;
	labelPropertySync: boolean;
	labelPropertyMappings: readonly { key: string; values: readonly string[] }[];
	obsoleteLabelPropertyKeys?: readonly string[];
	keyMigrations?: Record<string, string>;
}

/**
 * Parameters passed to `detectStaleChanges`.
 */
export interface DetectStaleParams {
	frontmatter: Record<string, unknown> | null;
	hasCardRef: boolean;
	hasChecklistSection?: boolean;
	settings: AlignSettings;
}

const TRELLO_S3_ATTACHMENTS_HOST_REGEX =
	/^trello-attachments\.s3(?:(?:-|\.)(?:dualstack\.)?[a-z0-9]+(?:-[a-z0-9]+)+-\d+)?\.amazonaws\.com$/;
const TRELLO_S3_BACKGROUNDS_HOST_REGEX =
	/^trello-backgrounds\.s3(?:(?:-|\.)(?:dualstack\.)?[a-z0-9]+(?:-[a-z0-9]+)+-\d+)?\.amazonaws\.com$/;

/**
 * Returns true if a value is a remote URL pointing to Trello or Trello's attachment storage.
 *
 * Distinguishes remote Trello covers from:
 * - Local files (e.g. `assets/banners/landscape.png`)
 * - Obsidian wikilinks (e.g. `[[landscape.png]]`)
 * - External non-Trello URLs (e.g. Unsplash or personal CDN)
 * - Non-string / undefined / null values
 */
export function isTrelloUrl(value: unknown): boolean {
	if (typeof value !== "string") return false;
	const trimmed = value.trim();
	if (!trimmed) return false;

	// Fast rejection for local paths and wikilinks
	if (trimmed.startsWith("[[") || (!trimmed.startsWith("http://") && !trimmed.startsWith("https://"))) {
		return false;
	}

	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return false;
		}
		const host = parsed.hostname.toLowerCase();
		return (
			host === "trello.com" ||
			host.endsWith(".trello.com") ||
			TRELLO_S3_ATTACHMENTS_HOST_REGEX.test(host) ||
			TRELLO_S3_BACKGROUNDS_HOST_REGEX.test(host)
		);
	} catch {
		return false;
	}
}

/**
 * Pure decision function: inspects note frontmatter and checklist presence against active
 * settings, returning a list of stale changes to execute.
 */
export function detectStaleChanges(params: DetectStaleParams): AlignChange[] {
	const changes: AlignChange[] = [];
	const { frontmatter, hasCardRef, hasChecklistSection, settings } = params;

	// 1. Due date
	if (!settings.syncDue && settings.dueFrontmatterKey && frontmatter && settings.dueFrontmatterKey in frontmatter) {
		changes.push({
			category: "due",
			action: "remove",
			keys: [settings.dueFrontmatterKey],
		});
	}

	// 2. Labels
	if (!settings.syncLabels && settings.labelsFrontmatterKey && frontmatter && settings.labelsFrontmatterKey in frontmatter) {
		changes.push({
			category: "labels",
			action: "remove",
			keys: [settings.labelsFrontmatterKey],
		});
	}

	// 3. Members
	if (!settings.syncMembers && settings.membersFrontmatterKey && frontmatter && settings.membersFrontmatterKey in frontmatter) {
		changes.push({
			category: "members",
			action: "remove",
			keys: [settings.membersFrontmatterKey],
		});
	}

	// 4. Custom fields
	if (!settings.syncCustomFields && settings.customFieldsFrontmatterKey && frontmatter && settings.customFieldsFrontmatterKey in frontmatter) {
		changes.push({
			category: "custom-fields",
			action: "remove",
			keys: [settings.customFieldsFrontmatterKey],
		});
	}

	// 5. Attachments: prunes attachments and linked-cards keys when attachments sync is disabled
	if (!settings.syncAttachments && frontmatter) {
		const keysToRemove: string[] = [];
		if (settings.attachmentsFrontmatterKey && settings.attachmentsFrontmatterKey in frontmatter) {
			keysToRemove.push(settings.attachmentsFrontmatterKey);
		}
		if (
			settings.linkedCardsFrontmatterKey &&
			settings.linkedCardsFrontmatterKey in frontmatter &&
			!keysToRemove.includes(settings.linkedCardsFrontmatterKey)
		) {
			keysToRemove.push(settings.linkedCardsFrontmatterKey);
		}
		if (keysToRemove.length > 0) {
			changes.push({
				category: "attachments",
				action: "remove",
				keys: keysToRemove,
			});
		}
	}

	// 6. Linked cards: prunes linked cards key when attachments are synced but linked cards is disabled
	if (
		settings.syncAttachments &&
		!settings.syncLinkedCards &&
		settings.linkedCardsFrontmatterKey &&
		frontmatter &&
		settings.linkedCardsFrontmatterKey in frontmatter
	) {
		changes.push({
			category: "linked-cards",
			action: "remove",
			keys: [settings.linkedCardsFrontmatterKey],
		});
	}

	// 7. Cover: prunes remote Trello URLs, strictly keeping local paths and non-Trello URLs
	if (!settings.syncCardCover && settings.coverFrontmatterKey && frontmatter && settings.coverFrontmatterKey in frontmatter) {
		const coverValue = frontmatter[settings.coverFrontmatterKey];
		if (isTrelloUrl(coverValue)) {
			changes.push({
				category: "cover",
				action: "remove",
				keys: [settings.coverFrontmatterKey],
			});
		}
	}

	// 8. Plugin note ID removal: prunes trello_plugin_note_id when disabled
	if (!settings.writeTrelloPluginNoteId && frontmatter && DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY in frontmatter) {
		changes.push({
			category: "plugin-note-id",
			action: "remove",
			keys: [DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY],
		});
	}

	// 9. Missing plugin note ID backfill: adds trello_plugin_note_id to linked notes lacking it
	if (settings.writeTrelloPluginNoteId && hasCardRef) {
		const hasPluginId =
			frontmatter !== null &&
			DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY in frontmatter &&
			typeof frontmatter[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY] === "string" &&
			(frontmatter[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY] as string).trim() !== "";
		if (!hasPluginId) {
			changes.push({
				category: "missing-plugin-note-id",
				action: "add",
				keys: [DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY],
			});
		}
	}

	// 10. Checklist section in markdown body
	if (!settings.syncChecklists && settings.checklistHeading && hasChecklistSection) {
		changes.push({
			category: "checklist-section",
			action: "remove",
			keys: [settings.checklistHeading],
		});
	}

	// 11. Obsolete label property keys
	if (frontmatter) {
		const candidateKeys = new Set<string>();
		if (settings.obsoleteLabelPropertyKeys) {
			for (const key of settings.obsoleteLabelPropertyKeys) {
				if (typeof key === "string" && key.trim() !== "") {
					candidateKeys.add(key.trim());
				}
			}
		}
		if (!settings.labelPropertySync && settings.labelPropertyMappings) {
			for (const mapping of settings.labelPropertyMappings) {
				if (typeof mapping.key === "string" && mapping.key.trim() !== "") {
					candidateKeys.add(mapping.key.trim());
				}
			}
		}
		const presentKeys = Array.from(candidateKeys).filter((key) => key in frontmatter);
		if (presentKeys.length > 0) {
			changes.push({
				category: "obsolete-label-property",
				action: "remove",
				keys: presentKeys,
			});
		}
	}

	// 12. Key migration
	if (settings.keyMigrations && frontmatter) {
		const migratedKeys: string[] = [];
		const applicableMigrations: Record<string, string> = {};

		for (const [oldKey, targetKey] of Object.entries(settings.keyMigrations)) {
			if (
				typeof oldKey === "string" &&
				typeof targetKey === "string" &&
				oldKey.trim() !== "" &&
				targetKey.trim() !== "" &&
				oldKey !== targetKey &&
				oldKey in frontmatter
			) {
				migratedKeys.push(oldKey);
				applicableMigrations[oldKey] = targetKey;
			}
		}

		if (migratedKeys.length > 0) {
			changes.push({
				category: "key-migration",
				action: "migrate",
				keys: migratedKeys,
				migrations: applicableMigrations,
			});
		}
	}

	return changes;
}
