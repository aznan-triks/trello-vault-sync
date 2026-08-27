import { silentReporter, type Reporter, type VaultGateway } from "../obsidian/gateway";
import type { TrelloClient } from "../trello/client";
import { syncNoteWithCard, type NoteSyncOptions } from "./syncNote";

export interface VaultSyncScope {
	/** Folder to restrict the run to; "" walks the whole vault. */
	scope: string;
	boardId: string;
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
	vault: VaultGateway,
	client: TrelloClient,
	target: VaultSyncScope,
	options: NoteSyncOptions,
	reporter: Reporter = silentReporter,
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

	const notes = vault.listNotes(target.scope);
	const linked = notes.flatMap((note) => {
		const ref = vault.getCardRef(note);
		return ref ? [{ note, ref }] : [];
	});
	stats.unlinked = notes.length - linked.length;

	const cards = await client.getBoardCards(target.boardId);
	const byId = new Map(cards.map((card) => [card.id, card]));
	reporter.log("info", `${cards.length} carte(s) sur le tableau, ${linked.length} note(s) liée(s)`);
	reporter.setTotal(linked.length);

	for (const { note, ref } of linked) {
		reporter.step(note.basename);
		const card = byId.get(ref.cardId);
		if (!card) {
			stats.phantoms++;
			reporter.log("warn", `Carte introuvable : ${note.basename}`);
			continue;
		}

		try {
			const result = await syncNoteWithCard(vault, client, note, card, options);
			if (result.renamed) stats.renamed++;
			if (result.direction === "pull") {
				stats.pulled++;
				reporter.log("pull", note.basename);
			} else if (result.direction === "push") {
				stats.pushed++;
				reporter.log("push", note.basename);
			} else if (result.direction === "conflict") {
				stats.conflicts++;
				reporter.log("warn", `Conflit : ${note.basename}`);
			} else {
				stats.skipped++;
			}
		} catch (error) {
			stats.errors++;
			reporter.log("error", `${note.basename} — ${(error as Error).message}`);
		}
	}

	return stats;
}
