import {
	DEFAULT_CARD_REF_KEY,
	DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY,
	newPluginNoteId,
	parseCardRef,
} from "../core/cardRef";
import { errorMessage } from "../core/errorMessage";
import { hasChecklistSection, removeChecklistSection } from "../core/noteBody";
import type { OperationGuard } from "../core/operationGuard";
import {
	ALIGN_CATEGORIES,
	detectStaleChanges,
	type AlignCategory,
	type AlignChange,
	type AlignSettings,
} from "../core/staleProperties";
import type { CardRefStore, NoteHandle, Reporter, VaultGateway } from "../obsidian/gateway";

/**
 * Options for single-note settings alignment.
 */
export interface AlignNoteOptions {
	dryRun?: boolean;
	keepMtime?: boolean;
}

/**
 * Options for batch settings alignment across multiple notes.
 */
export interface AlignNotesOptions extends AlignNoteOptions {
	guard?: OperationGuard;
	reporter?: Reporter;
	signal?: AbortSignal;
}

/**
 * Accumulated results of a batch alignment operation.
 */
export interface AlignResult {
	notesScanned: number;
	notesModified: number;
	changesByCategory: Record<AlignCategory, number>;
}

/**
 * Aligns a single note against active settings by removing stale frontmatter properties,
 * adding missing plugin note IDs, migrating renamed keys, or stripping obsolete checklist sections.
 *
 * Guarantees:
 * - Single-pass frontmatter write: executes all frontmatter alterations in one `vault.writeFrontmatter`.
 * - Performance: only reads markdown body from disk when "checklist-section" is in categories.
 * - Dry-run: zero mutations performed if `options?.dryRun` is true.
 * - Timestamp preservation: passes `keepMtime: options?.keepMtime` to preserve filesystem mtime.
 */
export async function alignNote(
	vault: VaultGateway,
	note: NoteHandle,
	categories: readonly AlignCategory[],
	settings: AlignSettings,
	options?: AlignNoteOptions,
): Promise<AlignChange[]> {
	if (!categories || categories.length === 0) {
		return [];
	}

	if ("exists" in vault && typeof vault.exists === "function" && !vault.exists(note.path)) {
		return [];
	}

	const frontmatter = vault.readFrontmatter(note);

	let hasCardRef = false;
	if ("getCardRef" in vault && typeof (vault as unknown as CardRefStore).getCardRef === "function") {
		try {
			hasCardRef = (vault as unknown as CardRefStore).getCardRef(note) !== null;
		} catch {
			hasCardRef = false;
		}
	}
	if (!hasCardRef && frontmatter) {
		hasCardRef = parseCardRef(frontmatter[DEFAULT_CARD_REF_KEY]) !== null;
	}

	let hasChecklist = false;
	let initialContent: string | null = null;
	const shouldCheckChecklist =
		categories.includes("checklist-section") &&
		!settings.syncChecklists &&
		Boolean(settings.checklistHeading);

	if (shouldCheckChecklist) {
		initialContent = await vault.read(note);
		hasChecklist = hasChecklistSection(initialContent, settings.checklistHeading);
	}

	const allChanges = detectStaleChanges({
		frontmatter,
		hasCardRef,
		hasChecklistSection: hasChecklist,
		settings,
	});

	const matchingChanges = allChanges.filter((change) => categories.includes(change.category));

	if (options?.dryRun || matchingChanges.length === 0) {
		return matchingChanges;
	}

	const frontmatterChanges = matchingChanges.filter((change) => change.category !== "checklist-section");
	const hasChecklistChange = matchingChanges.some((change) => change.category === "checklist-section");

	if (frontmatterChanges.length > 0) {
		await vault.writeFrontmatter(
			note,
			(fm) => {
				for (const change of frontmatterChanges) {
					if (change.action === "remove") {
						for (const key of change.keys) {
							delete fm[key];
						}
					} else if (change.action === "add") {
						if (change.category === "missing-plugin-note-id") {
							fm[DEFAULT_TRELLO_PLUGIN_NOTE_ID_KEY] = newPluginNoteId();
						}
					} else if (change.action === "migrate" && change.migrations) {
						for (const [oldKey, targetKey] of Object.entries(change.migrations)) {
							if (oldKey in fm) {
								fm[targetKey] = fm[oldKey];
								delete fm[oldKey];
							}
						}
					}
				}
			},
			{ keepMtime: options?.keepMtime },
		);
	}

	if (hasChecklistChange) {
		const contentToClean =
			frontmatterChanges.length > 0 ? await vault.read(note) : (initialContent ?? (await vault.read(note)));
		const updatedContent = removeChecklistSection(contentToClean, settings.checklistHeading);
		if (updatedContent !== contentToClean) {
			await vault.write(note, updatedContent, { keepMtime: options?.keepMtime });
		}
	}

	return matchingChanges;
}

/**
 * Executes settings alignment and stale property cleanup across a batch of notes.
 *
 * - Serializes operations per card via `OperationGuard.withKey("card:<id>")` when a card ID is present.
 * - Handles graceful abort signaling via `options.signal`.
 * - Emits progress events to `options.reporter`.
 * - Accumulates metrics for notes scanned, notes modified, and all 12 alignment categories.
 * - Safe for dry-run and undo history recording.
 */
export async function alignNotes(
	vault: VaultGateway & CardRefStore,
	notes: readonly NoteHandle[],
	categories: readonly AlignCategory[],
	settings: AlignSettings,
	options?: AlignNotesOptions,
): Promise<AlignResult> {
	const reporter = options?.reporter;
	const signal = options?.signal;

	let notesScanned = 0;
	let notesModified = 0;

	// Initialize all 12 categories to 0
	const changesByCategory = {} as Record<AlignCategory, number>;
	for (const category of ALIGN_CATEGORIES) {
		changesByCategory[category] = 0;
	}

	if (notes.length === 0) {
		reporter?.finish("done", "Aligned 0 of 0 note(s).");
		return { notesScanned: 0, notesModified: 0, changesByCategory };
	}

	reporter?.setTotal(notes.length);

	for (const note of notes) {
		if (signal?.aborted) {
			reporter?.log("warn", "Batch alignment cancelled.");
			break;
		}

		notesScanned++;
		reporter?.step(note.basename);

		try {
			if ("exists" in vault && typeof vault.exists === "function" && !vault.exists(note.path)) {
				continue;
			}

			// Resolve cardId for concurrency locking
			let cardId: string | null = null;
			try {
				if ("getCardRef" in vault && typeof (vault as unknown as CardRefStore).getCardRef === "function") {
					cardId = (vault as unknown as CardRefStore).getCardRef(note)?.cardId?.trim() ?? null;
				}
			} catch {
				cardId = null;
			}

			if (!cardId) {
				const fm = vault.readFrontmatter(note);
				if (fm && DEFAULT_CARD_REF_KEY in fm) {
					const parsed = parseCardRef(fm[DEFAULT_CARD_REF_KEY]);
					if (parsed?.cardId) {
						cardId = parsed.cardId.trim();
					}
				}
			}

			const runAlign = () => alignNote(vault, note, categories, settings, options);

			const changes = options?.guard && cardId
				? await options.guard.withKey(`card:${cardId}`, runAlign)
				: await runAlign();

			if (changes.length > 0) {
				notesModified++;
				for (const change of changes) {
					changesByCategory[change.category] = (changesByCategory[change.category] ?? 0) + 1;
				}
				reporter?.count("modified", notesModified);
				reporter?.log(
					"info",
					`${note.basename} — aligned ${changes.length} change(s): ${changes.map((c) => c.category).join(", ")}`,
				);
			}
		} catch (error) {
			reporter?.log("error", `${note.basename} — ${errorMessage(error)}`);
		}
	}

	if (signal?.aborted) {
		reporter?.finish("aborted", "Batch alignment cancelled.");
	} else {
		reporter?.finish("done", `Aligned ${notesModified} of ${notesScanned} note(s).`);
	}

	return {
		notesScanned,
		notesModified,
		changesByCategory,
	};
}
