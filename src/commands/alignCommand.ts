import { Notice } from "obsidian";
import type { CommandContext } from "./context";
import { withHistoryRecording } from "./syncHistoryHelper";
import { DEFAULT_CARD_REF_KEY, parseCardRef } from "../core/cardRef";
import { hasChecklistSection } from "../core/noteBody";
import {
	ALIGN_CATEGORIES,
	DEFAULT_MANUAL_ALIGN_CATEGORIES,
	detectStaleChanges,
	type AlignCategory,
} from "../core/staleProperties";
import { alignNotes, type AlignResult } from "../features/alignNotes";
import type { CardRefStore, NoteHandle, Reporter, VaultGateway } from "../obsidian/gateway";
import { MultiSelectPickerModal } from "../ui/MultiSelectPickerModal";

/**
 * Human-readable labels for all 12 alignment categories in user-facing dialogs.
 */
export const ALIGN_CATEGORY_LABELS: Record<AlignCategory, string> = {
	"due": "Due date",
	"labels": "Labels",
	"members": "Members",
	"custom-fields": "Custom fields",
	"attachments": "Attachments",
	"linked-cards": "Linked cards",
	"cover": "Cover image (remote Trello URLs)",
	"plugin-note-id": "Plugin note ID (remove trello_plugin_note_id)",
	"missing-plugin-note-id": "Missing plugin note ID (backfill trello_plugin_note_id)",
	"checklist-section": "Checklist section (markdown body)",
	"obsolete-label-property": "Obsolete label properties",
	"key-migration": "Key migrations",
};

/**
 * Formats user-facing alignment summary sentence.
 */
export function formatAlignSummary(modifiedCount: number, categoriesCount: number, isDryRun?: boolean): string {
	const base = `Cleaned ${modifiedCount} note${modifiedCount === 1 ? "" : "s"} across ${categoriesCount} categor${categoriesCount === 1 ? "y" : "ies"}.`;
	return isDryRun ? `[Dry-run] ${base}` : base;
}

/**
 * Executes settings alignment across notes, wrapped in history recording and operation progress.
 */
export async function executeAlignNotes(
	ctx: CommandContext,
	notes: readonly NoteHandle[],
	selectedCategories: readonly AlignCategory[],
): Promise<AlignResult> {
	let result: AlignResult = {
		notesScanned: 0,
		notesModified: 0,
		changesByCategory: Object.fromEntries(ALIGN_CATEGORIES.map((c) => [c, 0])) as Record<AlignCategory, number>,
	};

	const runWithHistory = async (
		scope: string,
		fn: (vault: VaultGateway & CardRefStore) => Promise<AlignResult>,
	): Promise<AlignResult> => {
		const customWithHistory = (ctx as unknown as { withHistoryRecording?: unknown }).withHistoryRecording;
		if (typeof customWithHistory === "function") {
			if (customWithHistory.length === 1) {
				return (customWithHistory as (fn: (v: VaultGateway & CardRefStore) => Promise<AlignResult>) => Promise<AlignResult>)(fn);
			}
			return (customWithHistory as (s: string, fn: (v: VaultGateway & CardRefStore) => Promise<AlignResult>) => Promise<AlignResult>)(scope, fn);
		}
		return withHistoryRecording(ctx, scope, (vault) => fn(vault as VaultGateway & CardRefStore));
	};

	if (typeof ctx.run === "function") {
		await ctx.run("Clean up notes", async (reporter, signal) => {
			result = await runWithHistory("Clean up notes", async (vault) => {
				return alignNotes(vault, notes, selectedCategories, ctx.settings, {
					keepMtime: true,
					guard: ctx.guard,
					reporter: reporter ?? (ctx as unknown as { reporter?: typeof reporter }).reporter,
					signal: signal ?? (ctx as unknown as { signal?: typeof signal }).signal,
					dryRun: ctx.settings.dryRun,
				});
			});
			return formatAlignSummary(result.notesModified, selectedCategories.length, ctx.settings.dryRun);
		});
	} else {
		const ctxAny = ctx as unknown as { reporter?: Reporter; signal?: AbortSignal };
		result = await runWithHistory("Clean up notes", async (vault) => {
			return alignNotes(vault, notes, selectedCategories, ctx.settings, {
				keepMtime: true,
				guard: ctx.guard,
				reporter: ctxAny.reporter,
				signal: ctxAny.signal,
				dryRun: ctx.settings.dryRun,
			});
		});
	}

	const summary = formatAlignSummary(result.notesModified, selectedCategories.length, ctx.settings.dryRun);
	new Notice(summary);
	return result;
}

/**
 * Interactive command: pre-scans notes for stale data matching current settings,
 * presents a category picker modal with counts, and applies cleanup when confirmed.
 */
export async function alignNotesWithSettings(
	ctx: CommandContext,
	preselect?: AlignCategory,
): Promise<void> {
	const vaultAny = ctx.vault as unknown as { list?: () => NoteHandle[]; listNotes?: (folder: string, excluded?: string[]) => NoteHandle[] };
	const notes = typeof vaultAny.list === "function"
		? vaultAny.list()
		: typeof vaultAny.listNotes === "function"
		? vaultAny.listNotes(ctx.settings.scope ?? "", ctx.settings.excludedFolders ?? [])
		: [];

	const shouldCheckChecklist = !ctx.settings.syncChecklists && Boolean(ctx.settings.checklistHeading);

	const counts = Object.fromEntries(ALIGN_CATEGORIES.map((c) => [c, 0])) as Record<AlignCategory, number>;

	for (const note of notes) {
		const frontmatter = ctx.vault.readFrontmatter(note);

		let hasCardRef = false;
		if (typeof (ctx.vault as unknown as CardRefStore).getCardRef === "function") {
			try {
				hasCardRef = (ctx.vault as unknown as CardRefStore).getCardRef(note) !== null;
			} catch {
				hasCardRef = false;
			}
		}
		if (!hasCardRef && frontmatter) {
			hasCardRef = parseCardRef(frontmatter[DEFAULT_CARD_REF_KEY]) !== null;
		}

		let hasChecklist = false;
		if (shouldCheckChecklist) {
			try {
				const content = await ctx.vault.read(note);
				hasChecklist = hasChecklistSection(content, ctx.settings.checklistHeading);
			} catch {
				hasChecklist = false;
			}
		}

		const changes = detectStaleChanges({
			frontmatter,
			hasCardRef,
			hasChecklistSection: hasChecklist,
			settings: ctx.settings,
		});

		const categoriesInNote = new Set<AlignCategory>();
		for (const change of changes) {
			categoriesInNote.add(change.category);
		}
		for (const category of categoriesInNote) {
			counts[category] = (counts[category] ?? 0) + 1;
		}
	}

	const totalAffected = Object.values(counts).reduce((sum, n) => sum + n, 0);
	if (totalAffected === 0) {
		new Notice("All notes are already aligned with current settings.");
		return;
	}

	const items = ALIGN_CATEGORIES.filter((cat) => (counts[cat] ?? 0) > 0 || cat === preselect);

	const isInitiallySelected = (category: AlignCategory): boolean => {
		if (preselect !== undefined) {
			return category === preselect;
		}
		return DEFAULT_MANUAL_ALIGN_CATEGORIES.includes(category);
	};

	new MultiSelectPickerModal<AlignCategory>(
		ctx.app,
		"Clean up notes",
		items,
		(category) => {
			const count = counts[category] ?? 0;
			const label = ALIGN_CATEGORY_LABELS[category] ?? category;
			return `${label} (${count} note${count === 1 ? "" : "s"})`;
		},
		"Clean selected properties",
		(selected) => {
			if (selected.length === 0) {
				new Notice("No categories selected — nothing cleaned.");
				return;
			}
			void executeAlignNotes(ctx, notes, selected);
		},
		isInitiallySelected,
	).open();
}
