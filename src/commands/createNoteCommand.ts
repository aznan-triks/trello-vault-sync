import type { CommandContext } from "./context";
import { resolveOrphanCardDestination } from "../core/orphanCardDestination";
import { buildCardIndex } from "../features/attachmentSync";
import { createNoteFromCard, unlinkedCards } from "../features/createNoteFromCard";
import type { TrelloCard } from "../trello/client";
import { CardPickerModal } from "../ui/CardPickerModal";
import { FolderPickerModal } from "../ui/FolderPickerModal";

async function createInFolder(ctx: CommandContext, card: TrelloCard, folder: string): Promise<void> {
	await ctx.run(
		`Create note — ${card.name}`,
		async () => {
			const mapping = ctx.settings.mappings.find((candidate) => candidate.listId === card.idList);
			const template = mapping?.templateName ? await ctx.vault.readTemplate(mapping.templateName) : null;
			const note = await createNoteFromCard(ctx.vault, card, folder, template, ctx.settings.cardRefFrontmatterKey);
			return `Created "${note.basename}.md" in ${note.folder || "(vault root)"}, linked to "${card.name}".`;
		},
		{ cancellable: false },
	);
}

function folderCandidates(ctx: CommandContext): string[] {
	return ctx.vault.listNotes("").reduce<string[]>((folders, note) => {
		if (note.folder !== "" && !folders.includes(note.folder)) folders.push(note.folder);
		return folders;
	}, []);
}

/** Creates a note from a card the user picks, in the folder mapped to the card's list, or the configured fallback, or (only when neither is set) a folder the user confirms first — never a silent guess. */
function pickDestination(ctx: CommandContext, card: TrelloCard): void {
	const destination = resolveOrphanCardDestination(card.idList, ctx.settings.mappings, ctx.settings.orphanCardFolder);
	if (!destination.needsPrompt) {
		void createInFolder(ctx, card, destination.folder);
		return;
	}
	new FolderPickerModal(ctx.app, () => folderCandidates(ctx), "", (folder) => {
		void createInFolder(ctx, card, folder);
	}).open();
}

/** "Create note from a Trello card": lets the user adopt a card with no note yet, the inverse of linking an existing note to a card. */
export async function createNoteFromOrphanCard(ctx: CommandContext): Promise<void> {
	if (!ctx.ready(true)) return;

	await ctx.run(
		"Load Trello cards",
		async (reporter) => {
			const cards = await ctx.client(reporter).getBoardCards(ctx.settings.boardId);
			const linkedCardIds = new Set(buildCardIndex(ctx.vault, ctx.vault.listNotes("")).keys());
			const orphanCards = unlinkedCards(cards, linkedCardIds);

			if (orphanCards.length === 0) {
				return "Every card on the board is already linked to a note.";
			}

			new CardPickerModal(ctx.app, orphanCards, (card) => pickDestination(ctx, card)).open();
			return `${orphanCards.length} unlinked card(s) — pick one from the list.`;
		},
		{ cancellable: false },
	);
}
