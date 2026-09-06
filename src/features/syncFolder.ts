import { CARD_REF_KEY, formatCardRef } from "../core/cardRef";
import { errorMessage } from "../core/errorMessage";
import { notesInFolder, sanitizeFileName, uniqueNotePath } from "../core/fileName";
import { planFolderMatch, type PlannedNote } from "../core/folderPlan";
import { addCounts, tallyNoteResult } from "../core/syncTally";
import { renderTemplate, templateMissingCardRefKey } from "../core/template";
import { silentReporter, type NoteHandle, type Reporter, type VaultGateway } from "../obsidian/gateway";
import type { TrelloCard, TrelloClient } from "../trello/client";
import { syncNoteWithCard, type NoteSyncOptions } from "./syncNote";

/** One Trello list mirrored into one vault folder. */
export interface FolderMapping {
	listId: string;
	folder: string;
	/** Template note used for new files; "" or missing means a bare description. */
	templateName: string;
}

export interface FolderSyncOptions extends NoteSyncOptions {
	allowCreate: boolean;
	/** Move a note to the trash when its card leaves the board. Off by default. */
	allowDelete: boolean;
	/** Board the list belongs to; consulted only to protect notes before deleting. */
	boardId: string;
}

export interface FolderSyncStats {
	created: number;
	adopted: number;
	pulled: number;
	pushed: number;
	skipped: number;
	renamed: number;
	conflicts: number;
	phantoms: number;
	/** Notes spared because their card is alive elsewhere on the board. */
	moved: number;
	deleted: number;
	/** Extra notes in the folder claiming a card another note already claimed. */
	duplicates: number;
	/** Notes in the folder carrying no card id at all. */
	unlinked: number;
	errors: number;
}

/** A stats object with every counter at zero — also the shape callers accumulate into. */
const emptyStats = (): FolderSyncStats => ({
	created: 0,
	adopted: 0,
	pulled: 0,
	pushed: 0,
	skipped: 0,
	renamed: 0,
	conflicts: 0,
	phantoms: 0,
	moved: 0,
	deleted: 0,
	duplicates: 0,
	unlinked: 0,
	errors: 0,
});

function newNoteContent(card: TrelloCard, template: string | null): string {
	const vars = {
		TITLE: card.name,
		DESCRIPTION: card.desc ?? "",
		URL: card.url,
		CARD_ID: card.id,
		BOARD_ID: card.idBoard,
	};
	if (template) return renderTemplate(template, vars);
	const ref = formatCardRef(card.idBoard, card.id);
	return `---\n${CARD_REF_KEY}: "${ref}"\n---\n\n${card.desc ?? ""}`;
}

/**
 * Mirror one Trello list into one vault folder.
 *
 * A single list request feeds the whole run — the legacy script issued one HTTP
 * call per note. Matching is delegated to the pure planner, so this function
 * only performs the resulting IO.
 */
export async function syncFolder(
	vault: VaultGateway,
	client: TrelloClient,
	mapping: FolderMapping,
	options: FolderSyncOptions,
	reporter: Reporter = silentReporter,
	/** Pre-fetched (filter "all") board cards — lets a multi-mapping run share one fetch. */
	boardCards?: TrelloCard[],
	signal?: AbortSignal,
	/** Pre-scanned notes already narrowed to this folder — lets a multi-mapping run share one vault scan. */
	noteHandles?: NoteHandle[],
): Promise<FolderSyncStats> {
	const stats = emptyStats();
	const cards = await client.getListCards(mapping.listId);
	reporter.log("info", `${cards.length} card(s) in the list`);

	const handles = noteHandles ?? vault.listNotes(mapping.folder);
	const planned: PlannedNote[] = handles.map((note) => ({
		path: note.path,
		basename: note.basename,
		folder: note.folder,
		mtime: note.mtime,
		cardId: vault.getCardRef(note)?.cardId ?? null,
	}));

	const plan = planFolderMatch(cards, planned, mapping.folder);

	stats.duplicates = plan.duplicateNotes.length;
	for (const duplicate of plan.duplicateNotes) {
		reporter.log(
			"warn",
			`Duplicate note claiming an already-linked card: ${duplicate.basename} (kept, not synced)`,
		);
	}
	stats.unlinked = plan.unlinkedNotes.length;

	reporter.setTotal(
		plan.pairs.length +
			(options.allowCreate ? plan.missingCards.length : 0) +
			(options.allowDelete ? plan.phantomNotes.length : 0),
	);

	const template = mapping.templateName ? await vault.readTemplate(mapping.templateName) : null;
	if (template && templateMissingCardRefKey(template)) {
		reporter.log(
			"warn",
				`Template "${mapping.templateName}" has no ${CARD_REF_KEY} key — new notes from it won't link back to their card.`,
		);
	}
	const byPath = new Map(handles.map((note) => [note.path, note]));

	for (const pair of plan.pairs) {
		if (signal?.aborted) break;
		reporter.step(pair.card.name);
		const note = byPath.get(pair.note.path);
		if (!note) continue;

		try {
			if (pair.adopted && !options.dryRun) {
				await vault.setCardRef(note, { boardId: pair.card.idBoard, cardId: pair.card.id });
			}
			// An adopted note has no sync history to arbitrate: the card wins.
			const result = await syncNoteWithCard(vault, client, note, pair.card, {
				...options,
				...(pair.adopted ? { force: "pull" as const } : {}),
			});

			if (pair.adopted) {
				if (result.renamed) stats.renamed++;
				stats.adopted++;
				reporter.log("adopt", pair.card.name);
			} else {
				tallyNoteResult(stats, result, (level, message) => reporter.log(level, message), pair.card.name);
			}
		} catch (error) {
			stats.errors++;
			reporter.log("error", `${pair.card.name} — ${errorMessage(error)}`);
		}
	}

	if (options.allowCreate) {
		for (const card of plan.missingCards) {
			if (signal?.aborted) break;
			reporter.step(card.name);
			try {
				stats.created++;
				const safeName = sanitizeFileName(card.name);
				reporter.log(
					"create",
					safeName === card.name ? card.name : `${card.name} → saved as "${safeName}"`,
				);
				if (options.dryRun) continue;
				const path = uniqueNotePath(mapping.folder, safeName, (p) => vault.exists(p));
				await vault.create(path, newNoteContent(card, template));
			} catch (error) {
				stats.created--;
				stats.errors++;
				reporter.log("error", `${card.name} — ${errorMessage(error)}`);
			}
		}
	}

	stats.phantoms = plan.phantomNotes.length;

	// A card that left this list has usually just been dragged to another column,
	// or archived — only a card gone from the whole board justifies touching the
	// note. "all" (not the default "visible") is required here or an archived
	// card would be indistinguishable from a genuinely deleted one.
	let aliveElsewhere = new Map<string, boolean>(); // cardId -> closed
	// Protection check itself is network I/O like everything else here — a failure
	// must not lose the create/pull/push stats already accumulated above it.
	let protectionCheckFailed = false;
	if (options.allowDelete && plan.phantomNotes.length > 0 && !signal?.aborted) {
		try {
			const cards = boardCards ?? (await client.getBoardCards(options.boardId, "all"));
			aliveElsewhere = new Map(cards.map((card) => [card.id, card.closed === true]));
		} catch (error) {
			protectionCheckFailed = true;
			stats.errors++;
			reporter.log(
				"error",
				`Could not verify phantom notes against the board — skipping deletion this pass: ${errorMessage(error)}`,
			);
		}
	}

	for (const phantom of plan.phantomNotes) {
		if (signal?.aborted) break;
		const note = byPath.get(phantom.path);
		if (!note) continue;
		if (!options.allowDelete || protectionCheckFailed) {
			reporter.log("warn", `Card missing from the list: ${phantom.basename} (kept)`);
			continue;
		}
		if (phantom.cardId !== null && aliveElsewhere.has(phantom.cardId)) {
			stats.moved++;
			const archived = aliveElsewhere.get(phantom.cardId);
			reporter.log(
				"warn",
				archived
					? `Card archived on Trello: ${phantom.basename} (kept)`
					: `Card moved elsewhere on the board: ${phantom.basename} (kept)`,
			);
			continue;
		}
		reporter.step(phantom.basename);
		try {
			stats.deleted++;
			reporter.log("delete", phantom.basename);
			if (!options.dryRun) await vault.trash(note);
		} catch (error) {
			stats.deleted--;
			stats.errors++;
			reporter.log("error", `${phantom.basename} — ${errorMessage(error)}`);
		}
	}

	return stats;
}

/**
 * Mirror every configured list ↔ folder mapping into its folder.
 *
 * One board fetch and one vault scan feed every mapping in the run instead of
 * one each — mirrors the sharing `syncFolder` already does for a single
 * mapping. A mapping that throws (e.g. its list was deleted) is counted as an
 * error and does not stop the mappings after it.
 */
export async function syncAllMappings(
	vault: VaultGateway,
	client: TrelloClient,
	mappings: FolderMapping[],
	options: FolderSyncOptions,
	reporter: Reporter = silentReporter,
	signal?: AbortSignal,
): Promise<FolderSyncStats> {
	const total = emptyStats();
	const boardCards = options.allowDelete ? await client.getBoardCards(options.boardId, "all") : undefined;
	const allNotes = vault.listNotes("");

	for (const mapping of mappings) {
		if (signal?.aborted) break;
		reporter.log("info", `Folder: ${mapping.folder}`);
		try {
			const stats = await syncFolder(
				vault,
				client,
				mapping,
				options,
				reporter,
				boardCards,
				signal,
				notesInFolder(allNotes, mapping.folder),
			);
			addCounts(total, stats);
		} catch (error) {
			total.errors++;
			reporter.log("error", `${mapping.folder} — ${errorMessage(error)}`);
		}
	}

	return total;
}
