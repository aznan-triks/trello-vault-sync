import { formatCardRef } from "../core/cardRef";
import { sanitizeFileName, uniqueNotePath } from "../core/fileName";
import { planFolderMatch, type PlannedNote } from "../core/folderPlan";
import { renderTemplate } from "../core/template";
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
	errors: number;
}

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
): Promise<FolderSyncStats> {
	const stats = emptyStats();
	const cards = await client.getListCards(mapping.listId);
	reporter.log("info", `${cards.length} carte(s) dans la liste`);

	const handles = vault.listNotes(mapping.folder);
	const planned: PlannedNote[] = handles.map((note) => ({
		path: note.path,
		basename: note.basename,
		folder: note.folder,
		mtime: note.mtime,
		cardId: vault.getCardRef(note)?.cardId ?? null,
	}));

	const plan = planFolderMatch(cards, planned, mapping.folder);
	reporter.setTotal(
		plan.pairs.length +
			(options.allowCreate ? plan.missingCards.length : 0) +
			(options.allowDelete ? plan.phantomNotes.length : 0),
	);

	const template = mapping.templateName ? await vault.readTemplate(mapping.templateName) : null;
	const byPath = new Map(handles.map((note) => [note.path, note]));

	for (const pair of plan.pairs) {
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

			if (result.renamed) stats.renamed++;
			if (pair.adopted) {
				stats.adopted++;
				reporter.log("adopt", pair.card.name);
			} else if (result.direction === "pull") {
				stats.pulled++;
				reporter.log("pull", pair.card.name);
			} else if (result.direction === "push") {
				stats.pushed++;
				reporter.log("push", pair.card.name);
			} else if (result.direction === "conflict") {
				stats.conflicts++;
				reporter.log("warn", `Conflit : ${pair.card.name}`);
			} else {
				stats.skipped++;
			}
		} catch (error) {
			stats.errors++;
			reporter.log("error", `${pair.card.name} — ${(error as Error).message}`);
		}
	}

	if (options.allowCreate) {
		for (const card of plan.missingCards) {
			reporter.step(card.name);
			try {
				stats.created++;
				reporter.log("create", card.name);
				if (options.dryRun) continue;
				const path = uniqueNotePath(mapping.folder, sanitizeFileName(card.name), (p) =>
					vault.exists(p),
				);
				await vault.create(path, newNoteContent(card, template));
			} catch (error) {
				stats.created--;
				stats.errors++;
				reporter.log("error", `${card.name} — ${(error as Error).message}`);
			}
		}
	}

	stats.phantoms = plan.phantomNotes.length;

	// A card that left this list has usually just been dragged to another column;
	// only a card gone from the whole board justifies touching the note.
	let aliveElsewhere = new Set<string>();
	if (options.allowDelete && plan.phantomNotes.length > 0) {
		const boardCards = await client.getBoardCards(options.boardId);
		aliveElsewhere = new Set(boardCards.map((card) => card.id));
	}

	for (const phantom of plan.phantomNotes) {
		const note = byPath.get(phantom.path);
		if (!note) continue;
		if (!options.allowDelete) {
			reporter.log("warn", `Carte absente de la liste : ${phantom.basename} (conservé)`);
			continue;
		}
		if (phantom.cardId !== null && aliveElsewhere.has(phantom.cardId)) {
			stats.moved++;
			reporter.log("warn", `Carte déplacée ailleurs sur le tableau : ${phantom.basename} (conservé)`);
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
