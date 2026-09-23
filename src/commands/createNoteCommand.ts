import type { CommandContext } from "./context";
import { errorMessage } from "../core/errorMessage";
import {
	filterOrphanCardsByScope,
	isUsableDestinationFolder,
	resolveOrphanCardDestination,
} from "../core/orphanCardDestination";
import { templateMissingCardRefKey } from "../core/template";
import { buildCardIndex } from "../features/attachmentSync";
import { createNoteFromCard, unlinkedCards } from "../features/createNoteFromCard";
import type { TrelloCard } from "../trello/client";
import { FolderPickerModal } from "../ui/FolderPickerModal";
import { OrphanCardPickerModal } from "../ui/OrphanCardPickerModal";

export async function createInFolder(ctx: CommandContext, card: TrelloCard, folder: string): Promise<void> {
	await ctx.run(
		`Create note — ${card.name}`,
		async (reporter) => {
			const mapping = ctx.settings.mappings.find((candidate) => candidate.listId === card.idList);
			const templateName = mapping?.templateName || ctx.settings.defaultTemplateName || "";
			const template = templateName ? await ctx.vault.readTemplate(templateName) : null;
			if (template && templateMissingCardRefKey(template, ctx.settings.cardRefFrontmatterKey)) {
				reporter.log(
					"warn",
					`Template "${templateName}" has no ${ctx.settings.cardRefFrontmatterKey} key — new notes from it won't link back to their card.`,
				);
			}
			const note = await createNoteFromCard(ctx.vault, card, folder, template, ctx.settings.cardRefFrontmatterKey);
			return `Created "${note.basename}.md" in ${note.folder || "(vault root)"}, linked to "${card.name}".`;
		},
		// One local vault write (template read + note creation): no network call, no loop — nothing to interrupt.
		{ cancellable: false },
	);
}

export async function batchCreateNotesFromCardsAction(
	ctx: CommandContext,
	cards: readonly TrelloCard[],
	promptedFolder?: string,
): Promise<void> {
	await ctx.run("Create notes from orphan cards", async (reporter, signal) => {
		reporter.setTotal(cards.length);
		let created = 0;
		let errors = 0;
		const templateCache = new Map<string, string | null>();
		const warnedTemplates = new Set<string>();

		for (const card of cards) {
			if (signal?.aborted) break;
			reporter.step(card.name);

			const dest = resolveOrphanCardDestination(card.idList, ctx.settings.mappings, ctx.settings.orphanCardFolder);
			const targetFolder = !dest.needsPrompt ? dest.folder : (promptedFolder ?? "");

			if (!isUsableDestinationFolder(targetFolder)) {
				errors++;
				reporter.log("error", `${card.name} — No destination folder configured.`);
				continue;
			}

			const mapping = ctx.settings.mappings.find((candidate) => candidate.listId === card.idList);
			const templateName = mapping?.templateName || ctx.settings.defaultTemplateName || "";
			let template: string | null = null;
			if (templateName) {
				if (templateCache.has(templateName)) {
					template = templateCache.get(templateName)!;
				} else {
					template = await ctx.vault.readTemplate(templateName);
					templateCache.set(templateName, template);
				}
				if (template && templateMissingCardRefKey(template, ctx.settings.cardRefFrontmatterKey)) {
					if (!warnedTemplates.has(templateName)) {
						warnedTemplates.add(templateName);
						reporter.log(
							"warn",
							`Template "${templateName}" has no ${ctx.settings.cardRefFrontmatterKey} key — new notes from it won't link back to their card.`,
						);
					}
				}
			}

			try {
				if (ctx.settings.dryRun) {
					created++;
					reporter.log("create", card.name);
				} else {
					const note = await createNoteFromCard(
						ctx.vault,
						card,
						targetFolder,
						template,
						ctx.settings.cardRefFrontmatterKey,
					);
					created++;
					reporter.log("create", note.basename);
				}
			} catch (error) {
				if (signal?.aborted) break;
				errors++;
				reporter.log("error", `${card.name} — ${errorMessage(error)}`);
			}
		}

		if (ctx.settings.dryRun) {
			return errors > 0
				? `[Dry-run] Would create ${created} note(s) (${errors} error(s)).`
				: `[Dry-run] Would create ${created} note(s).`;
		}
		return `${created} created · ${errors} error(s)`;
	});
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

	await ctx.run("Load Trello cards", async (reporter, signal) => {
		const cards = await ctx.client(reporter).getBoardCards(ctx.settings.boardId, undefined, signal);
		const linkedCardIds = new Set(buildCardIndex(ctx.vault, ctx.vault.listNotes("")).keys());
		const allOrphans = unlinkedCards(cards, linkedCardIds);
		const orphanCards = filterOrphanCardsByScope(allOrphans, ctx.settings.mappings, ctx.settings.orphanCardScope);

		if (orphanCards.length === 0) {
			return allOrphans.length === 0
				? "Every card on the board is already linked to a note."
				: "No orphan cards match the configured detection scope.";
		}

		new OrphanCardPickerModal(
			ctx.app,
			orphanCards,
			ctx.settings.orphanCardBatchCreate,
			(choice) => {
				if (choice.type === "all") {
					const anyNeedsPrompt = orphanCards.some(
						(card) =>
							resolveOrphanCardDestination(card.idList, ctx.settings.mappings, ctx.settings.orphanCardFolder)
								.needsPrompt,
					);
					if (!anyNeedsPrompt) {
						void batchCreateNotesFromCardsAction(ctx, orphanCards);
					} else {
						new FolderPickerModal(ctx.app, () => folderCandidates(ctx), "", (folder) => {
							void batchCreateNotesFromCardsAction(ctx, orphanCards, folder);
						}).open();
					}
				} else {
					pickDestination(ctx, choice.card);
				}
			},
		).open();

		return `${orphanCards.length} unlinked card(s) — pick one from the list.`;
	});
}

