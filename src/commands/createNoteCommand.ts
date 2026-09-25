import { confirmIfEnabled } from "./confirmAction";
import type { CommandContext } from "./context";
import { withHistoryRecording } from "./syncHistoryHelper";
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
import { MultiSelectPickerModal } from "../ui/MultiSelectPickerModal";
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
			if (ctx.settings.dryRun) {
				reporter.log("create", card.name);
				return `Would create a note for "${card.name}" in ${folder || "(vault root)"}.`;
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
		// Wrapped so every note this batch creates lands in sync history — same
		// mechanism `noteCommands.syncActive`/`syncCommands.*` already use, just
		// never wired into this command before now. No `onTrelloWrite` needed
		// here (no Trello write happens), unlike the card-from-note batch below.
		return withHistoryRecording(ctx, "", async (vault) => {
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
						template = await vault.readTemplate(templateName);
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
							vault,
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

/** Runs the batch note-creation for exactly `cards` — prompting for a fallback folder first when at least one of them needs it. Shared by "Create for ALL" and "Select several…", the only difference being which subset of orphan cards reaches here. */
function runBatchCreateNotes(ctx: CommandContext, cards: readonly TrelloCard[]): void {
	const anyNeedsPrompt = cards.some(
		(card) => resolveOrphanCardDestination(card.idList, ctx.settings.mappings, ctx.settings.orphanCardFolder).needsPrompt,
	);
	if (!anyNeedsPrompt) {
		void batchCreateNotesFromCardsAction(ctx, cards);
	} else {
		new FolderPickerModal(ctx.app, () => folderCandidates(ctx), "", (folder) => {
			void batchCreateNotesFromCardsAction(ctx, cards, folder);
		}).open();
	}
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
					void confirmIfEnabled(
						ctx,
						ctx.settings.confirmBatchCreate,
						`Create notes for ALL ${choice.count} orphan card(s)?`,
						"Create all",
						() => runBatchCreateNotes(ctx, orphanCards),
					);
				} else if (choice.type === "select") {
					new MultiSelectPickerModal(
						ctx.app,
						"Create notes — select cards",
						orphanCards,
						(card) => card.name,
						"Create selected",
						(selected) => {
							if (selected.length > 0) runBatchCreateNotes(ctx, selected);
						},
					).open();
				} else {
					pickDestination(ctx, choice.card);
				}
			},
		).open();

		return `${orphanCards.length} unlinked card(s) — pick one from the list.`;
	});
}

