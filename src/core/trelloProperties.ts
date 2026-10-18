import { DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY } from "./cardRef";

/** The frontmatter keys this plugin writes, as configured — every one is user-renamable. */
export interface TrelloPropertyKeySettings {
	cardRefFrontmatterKey: string;
	dueFrontmatterKey: string;
	labelsFrontmatterKey: string;
	membersFrontmatterKey: string;
	customFieldsFrontmatterKey: string;
	attachmentsFrontmatterKey: string;
	linkedCardsFrontmatterKey: string;
}

/** Every key an unlink removes. The cover key is deliberately absent: its default ("banner") is shared with other plugins. */
export function trelloPropertyKeys(settings: TrelloPropertyKeySettings, extraKeys: string[] = []): string[] {
	return [
		...new Set([
			settings.cardRefFrontmatterKey,
			settings.dueFrontmatterKey,
			settings.labelsFrontmatterKey,
			settings.membersFrontmatterKey,
			settings.customFieldsFrontmatterKey,
			settings.attachmentsFrontmatterKey,
			settings.linkedCardsFrontmatterKey,
			DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY,
			...extraKeys,
		]),
	];
}

/** Deletes `keys` from `frontmatter` in place; returns the ones that were actually there. */
export function stripTrelloProperties(frontmatter: Record<string, unknown>, keys: readonly string[]): string[] {
	const removed = keys.filter((key) => key in frontmatter);
	for (const key of removed) delete frontmatter[key];
	return removed;
}
