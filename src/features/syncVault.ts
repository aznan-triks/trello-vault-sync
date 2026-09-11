import { errorMessage } from "../core/errorMessage";
import { tallyNoteResult } from "../core/syncTally";
import { silentReporter, type CardRefStore, type Reporter, type VaultGateway } from "../obsidian/gateway";
import type { TrelloClient } from "../trello/client";
import { buildCardIndex } from "./attachmentSync";
import { syncNoteWithCard, type NoteSyncOptions } from "./syncNote";

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
	/** Notes pointing at a card the board no longer holds. */
	phantoms: number;
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
		unlinked: 0,
		errors: 0,
	};

	const notes = vault.listNotes(target.scope, target.excludedFolders);
	const linked = notes.flatMap((note) => {
		const ref = vault.getCardRef(note);
		return ref ? [{ note, ref }] : [];
	});
	stats.unlinked = notes.length - linked.length;

	const cards = await client.getBoardCards(target.boardId, "visible", signal);
	const byId = new Map(cards.map((card) => [card.id, card]));
	reporter.log("info", `${cards.length} card(s) on the board, ${linked.length} linked note(s)`);
	reporter.setTotal(linked.length);

	// A card-link attachment can point anywhere in the vault, not just `target.scope` —
	// this index always covers the whole vault, built once for the whole run.
	const cardIndex = options.syncAttachments === false ? undefined : buildCardIndex(vault, vault.listNotes(""));

	for (const { note, ref } of linked) {
		if (signal?.aborted) break;
		reporter.step(note.basename);
		const card = byId.get(ref.cardId);
		if (!card) {
			stats.phantoms++;
			reporter.log("warn", `Card not found: ${note.basename}`);
			continue;
		}

		try {
			const result = await syncNoteWithCard(vault, client, note, card, options, cardIndex);
			tallyNoteResult(stats, result, (level, message) => reporter.log(level, message), note.basename);
		} catch (error) {
			stats.errors++;
			reporter.log("error", `${note.basename} — ${errorMessage(error)}`);
		}
	}

	return stats;
}
