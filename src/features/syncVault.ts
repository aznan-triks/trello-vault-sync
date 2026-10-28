import { boardForRef, type BoardRef } from "../core/boardResolve";
import type { CustomFieldDefinitionLike } from "../core/customFieldRef";
import { errorMessage } from "../core/errorMessage";
import { tallyNoteResult } from "../core/syncTally";
import { silentReporter, type CardRefStore, type NoteHandle, type Reporter, type VaultGateway } from "../obsidian/gateway";
import type { TrelloCard, TrelloClient } from "../trello/client";
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
	/** The default board: where a note without (or with an unregistered) board prefix is read. */
	boardId: string;
	/** Other registered boards (`settings.boards`); each one a linked note names is read once. */
	boards?: readonly BoardRef[];
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
	const boardSettings = { boardId: target.boardId, boards: target.boards ?? [] };
	const linked = notes.flatMap((note) => {
		const ref = vault.getCardRef(note);
		return ref ? [{ note, ref, boardId: boardForRef(ref, boardSettings) }] : [];
	});
	stats.unlinked = notes.length - linked.length;

	const noteOptions = { ...options, cardsFetchedAt: Date.now() };
	// One series of reads per board a linked note names; a card is looked up among the cards of every board read.
	const boardIds = linked.length === 0 ? [target.boardId] : [...new Set(linked.map((entry) => entry.boardId))];
	const byId = new Map<string, { card: TrelloCard; boardId: string }>();
	const directories = new Map<string, { members?: Map<string, string>; customFields?: Map<string, CustomFieldDefinitionLike> }>();
	const unreadable = new Set<string>();
	for (const boardId of boardIds) {
		if (signal?.aborted) break;
		try {
			const boardCards = await client.getBoardCards(boardId, "visible", signal, cardIncludesFor(options));
			for (const card of boardCards) byId.set(card.id, { card, boardId });
			directories.set(boardId, {
				members:
					options.syncMembers === false ? undefined : buildMemberDirectory(await client.getBoardMembers(boardId, signal)),
				customFields:
					options.syncCustomFields === false
						? undefined
						: buildCustomFieldDefinitions(await client.getBoardCustomFields(boardId, signal)),
			});
		} catch (error) {
			if (boardIds.length === 1) throw error;
			unreadable.add(boardId);
			stats.errors++;
			reporter.log("error", `Board ${boardId} could not be read, its notes are left alone (${errorMessage(error)})`);
		}
	}
	const todo = linked.filter((entry) => !unreadable.has(entry.boardId));
	reporter.log(
		"info",
		`${byId.size} card(s) on ${boardIds.length === 1 ? "the board" : `${boardIds.length} boards`}, ${todo.length} linked note(s)`,
	);
	reporter.setTotal(todo.length);

	// A card-link attachment can point anywhere in the vault, not just `target.scope` —
	// this index always covers the whole vault, built once for the whole run.
	const cardIndex = options.syncAttachments === false ? undefined : buildCardIndex(vault, vault.listNotes(""));

	const gone: GoneNote[] = [];
	for (const { note: listed, ref, boardId: expectedBoard } of todo) {
		if (signal?.aborted) break;
		reporter.step(listed.basename);
		let note = listed;
		const found = byId.get(ref.cardId);
		if (!found) {
			stats.phantoms++;
			reporter.log("warn", `Card not found: ${note.basename}`);
			gone.push({ note, cardId: ref.cardId });
			continue;
		}
		const { card } = found;

		try {
			note = await restoreFromArchive(vault, note, card.idList, options, stats, reporter);
			// The card changed board since the note was linked: the prefix follows it (only a prefix the note already has).
			if (ref.boardId === expectedBoard && found.boardId !== expectedBoard && !options.dryRun) {
				await vault.setCardRef(note, { boardId: found.boardId, cardId: ref.cardId });
			}
			const directory = directories.get(found.boardId);
			const result = await syncNoteWithCard(
				vault,
				client,
				note,
				card,
				noteOptions,
				cardIndex,
				directory?.members,
				directory?.customFields,
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
			syncBase: options.syncBase,
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
