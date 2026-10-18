import { errorMessage } from "../core/errorMessage";
import { tallyNoteResult } from "../core/syncTally";
import { silentReporter, type CardRefStore, type NoteHandle, type Reporter, type VaultGateway } from "../obsidian/gateway";
import type { TrelloClient } from "../trello/client";
import { buildCardIndex } from "./attachmentSync";
import { handleGoneNotes, isUnderAny, moveNoteToFolder, type GoneNote } from "./noteFate";
import {
	buildCustomFieldDefinitions,
	buildMemberDirectory,
	cardIncludesFor,
	syncNoteWithCard,
	type NoteSyncOptions,
} from "./syncNote";

export interface VaultSyncScope {
	/** Folder to restrict the run to; "" walks the whole vault. */
	scope: string;
	boardId: string;
	/** Folders skipped regardless of link state. */
	excludedFolders?: string[];
}

export interface VaultSyncStats {
	pulled: number;
	pushed: number;
	skipped: number;
	renamed: number;
	conflicts: number;
	/** Notes pointing at a card the board no longer holds (archived, deleted, or on another board). */
	phantoms: number;
	/** Notes whose card is on another board and was left alone. */
	moved: number;
	/** Notes moved to the trash because their card was archived or deleted. */
	deleted: number;
	/** Notes whose Trello properties were removed because their card was archived or deleted. */
	detached: number;
	/** Notes filed into another folder (archive folder, or back out of it). */
	relocated: number;
	/** Notes with no usable card id — never touched. */
	unlinked: number;
	errors: number;
}

/**
 * Sync every linked note under `scope` against its card.
 *
 * The board is fetched once and indexed in memory; the legacy batch script
 * issued one request per note, which is what made it hit Trello's rate limit.
 */
export async function syncVault(
	vault: VaultGateway & CardRefStore,
	client: TrelloClient,
	target: VaultSyncScope,
	options: NoteSyncOptions,
	reporter: Reporter = silentReporter,
	signal?: AbortSignal,
): Promise<VaultSyncStats> {
	const stats: VaultSyncStats = {
		pulled: 0,
		pushed: 0,
		skipped: 0,
		renamed: 0,
		conflicts: 0,
		phantoms: 0,
		moved: 0,
		deleted: 0,
		detached: 0,
		relocated: 0,
		unlinked: 0,
		errors: 0,
	};

	const notes = vault.listNotes(target.scope, target.excludedFolders);
	const linked = notes.flatMap((note) => {
		const ref = vault.getCardRef(note);
		return ref ? [{ note, ref }] : [];
	});
	stats.unlinked = notes.length - linked.length;

	const cards = await client.getBoardCards(target.boardId, "visible", signal, cardIncludesFor(options));
	const byId = new Map(cards.map((card) => [card.id, card]));
	reporter.log("info", `${cards.length} card(s) on the board, ${linked.length} linked note(s)`);
	reporter.setTotal(linked.length);

	// A card-link attachment can point anywhere in the vault, not just `target.scope` —
	// this index always covers the whole vault, built once for the whole run.
	const cardIndex = options.syncAttachments === false ? undefined : buildCardIndex(vault, vault.listNotes(""));
	const memberDirectory =
		options.syncMembers === false
			? undefined
			: buildMemberDirectory(await client.getBoardMembers(target.boardId, signal));
	const customFieldDefinitions =
		options.syncCustomFields === false
			? undefined
			: buildCustomFieldDefinitions(await client.getBoardCustomFields(target.boardId, signal));

	const gone: GoneNote[] = [];
	for (const { note: listed, ref } of linked) {
		if (signal?.aborted) break;
		reporter.step(listed.basename);
		let note = listed;
		const card = byId.get(ref.cardId);
		if (!card) {
			stats.phantoms++;
			reporter.log("warn", `Card not found: ${note.basename}`);
			gone.push({ note, cardId: ref.cardId });
			continue;
		}

		try {
			note = await restoreFromArchive(vault, note, card.idList, options, stats, reporter);
			const result = await syncNoteWithCard(
				vault,
				client,
				note,
				card,
				options,
				cardIndex,
				memberDirectory,
				customFieldDefinitions,
				signal,
			);
			tallyNoteResult(stats, result, (level, message) => reporter.log(level, message), note.basename);
		} catch (error) {
			stats.errors++;
			reporter.log("error", `${note.basename} — ${errorMessage(error)}`);
		}
	}

	if (options.cardFate && gone.length > 0 && !signal?.aborted) {
		const blocked = options.trashBlockedFolders ?? [];
		await handleGoneNotes(vault, client, gone, {
			rules: options.cardFate,
			propertyKeys: options.trelloPropertyKeys ?? [],
			mappedFolderByListId: options.mappedFolderByListId ?? new Map(),
			trashAllowed: (note) => !isUnderAny(note, blocked),
			aliveMode: "leave",
			dryRun: options.dryRun,
			reporter,
			stats,
			signal,
		});
	}
	return stats;
}

/** A card back from the archive: its note leaves the archive folder for the folder of the card's list. */
async function restoreFromArchive(
	vault: VaultGateway,
	note: NoteHandle,
	idList: string | undefined,
	options: NoteSyncOptions,
	stats: VaultSyncStats,
	reporter: Reporter,
): Promise<NoteHandle> {
	const rules = options.cardFate;
	if (!rules || options.archiveRestoreOnUnarchive === false || rules.onCardArchived !== "archive-folder") return note;
	if (rules.archiveFolder === "" || !isUnderAny(note, [rules.archiveFolder])) return note;
	const folder = idList ? options.mappedFolderByListId?.get(idList) : undefined;
	if (folder === undefined) return note;
	if (options.dryRun) {
		reporter.log("rename", `Card back from the archive: ${note.basename} \u2014 note would move to ${folder}`);
		return note;
	}
	const moved = await moveNoteToFolder(vault, note, folder);
	if (!moved.moved) {
		reporter.log("warn", `Card back from the archive: ${note.basename} \u2014 kept (${moved.reason})`);
		return note;
	}
	stats.relocated++;
	reporter.log("rename", `Card back from the archive: ${note.basename} \u2014 note moved to ${folder}`);
	return moved.note;
}
