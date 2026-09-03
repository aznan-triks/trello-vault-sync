import { formatCardRef } from "../core/cardRef";
import { sanitizeFileName, uniqueNotePath } from "../core/fileName";
import { planFolderMatch, type PlannedNote } from "../core/folderPlan";
import { tallyNoteResult } from "../core/syncTally";
import { renderTemplate, templateMissingCardRefKey } from "../core/template";
import { silentReporter, type Reporter, type VaultGateway } from "../obsidian/gateway";
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
export const emptyStats = (): FolderSyncStats => ({
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
	return `---\ntrello_board_card_id: "${ref}"\n---\n\n${card.desc ?? ""}`;
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
): Promise<FolderSyncStats> {
	const stats = emptyStats();
	const cards = await client.getListCards(mapping.listId);
	reporter.log("info", `${cards.length} card(s) in the list`);

	const handles = vault.listNotes(mapping.folder);
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
			`Template "${mapping.templateName}" has no trello_board_card_id key — new notes from it won't link back to their card.`,
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
			reporter.log("error", `${pair.card.name} — ${(error as Error).message}`);
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
				reporter.log("error", `${card.name} — ${(error as Error).message}`);
			}
		}
	}

	stats.phantoms = plan.phantomNotes.length;

	// A card that left this list has usually just been dragged to another column,
	// or archived — only a card gone from the whole board justifies touching the
	// note. "all" (not the default "visible") is required here or an archived
	// card would be indistinguishable from a genuinely deleted one.
	let aliveElsewhere = new Map<string, boolean>(); // cardId -> closed
	if (options.allowDelete && plan.phantomNotes.length > 0 && !signal?.aborted) {
		const cards = boardCards ?? (await client.getBoardCards(options.boardId, "all"));
		aliveElsewhere = new Map(cards.map((card) => [card.id, card.closed === true]));
	}

	for (const phantom of plan.phantomNotes) {
		if (signal?.aborted) break;
		const note = byPath.get(phantom.path);
		if (!note) continue;
		if (!options.allowDelete) {
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
			reporter.log("error", `${phantom.basename} — ${(error as Error).message}`);
		}
	}

	return stats;
}
