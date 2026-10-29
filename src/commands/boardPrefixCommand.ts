import { registeredBoardIds } from "./boardPick";
import type { CommandContext } from "./context";
import { withHistoryRecording } from "./syncHistoryHelper";
import { formatCardRef } from "../core/cardRef";
import { fetchBoardsCards } from "../features/boardIndex";

/**
 * "Add the board id to note references": rewrites `<cardId>` as `<boardId>;<cardId>` in the notes whose
 * card sits on a registered board. Only the reference property is written (never the body or another
 * property); a note whose card is on no registered board is counted and left alone. Never automatic.
 */
export async function addBoardToReferences(ctx: CommandContext): Promise<void> {
	if (!ctx.ready(true)) return;
	await ctx.run("Add the board id to note references", async (reporter, signal) => {
		const cards = await fetchBoardsCards(ctx.client(reporter), registeredBoardIds(ctx), signal, "all");
		const boardOfCard = new Map(cards.map((card) => [card.id, card.idBoard]));
		const key = ctx.settings.cardRefFrontmatterKey;

		const targets: { note: ReturnType<typeof ctx.vault.listNotes>[number]; cardId: string; boardId: string }[] = [];
		let unknown = 0;
		for (const note of ctx.vault.listNotes(ctx.settings.scope, ctx.settings.excludedFolders)) {
			const ref = ctx.vault.getCardRef(note);
			if (!ref || ref.boardId !== null) continue;
			const boardId = boardOfCard.get(ref.cardId);
			if (boardId) targets.push({ note, cardId: ref.cardId, boardId });
			else unknown++;
		}

		const missing = unknown > 0 ? ` · ${unknown} on no registered board, left alone` : "";
		if (ctx.settings.dryRun) return `[Dry-run] Would add the board id to ${targets.length} note(s)${missing}.`;

		reporter.setTotal(targets.length);
		let written = 0;
		await withHistoryRecording(ctx, "", async (vault) => {
			for (const { note, cardId, boardId } of targets) {
				if (signal.aborted) break;
				reporter.step(note.basename);
				await vault.writeFrontmatter(
					note,
					(frontmatter) => {
						frontmatter[key] = formatCardRef(boardId, cardId);
					},
					{ keepMtime: true },
				);
				written++;
			}
		});
		return `Added the board id to ${written} note(s)${missing}.`;
	});
}
