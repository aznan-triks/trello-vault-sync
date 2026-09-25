import { Notice } from "obsidian";
import { confirmIfEnabled } from "./confirmAction";
import type { CommandContext } from "./context";
import { withHistoryRecording } from "./syncHistoryHelper";
import { yieldPeriodically } from "../core/asyncUtil";
import { errorMessage } from "../core/errorMessage";
import {
	findPhantomNoteCandidates,
	resolvePhantomCardDestination,
	type PhantomCandidate,
} from "../core/phantomCardDestination";
import { fetchBoardIndex } from "../features/boardIndex";
import { createCardFromNote } from "../features/createCardFromNote";
import type { NoteHandle } from "../obsidian/gateway";
import { TrelloError, type TrelloLabel, type TrelloList } from "../trello/client";
import { ListPickerModal } from "../ui/ListPickerModal";
import { MultiSelectPickerModal } from "../ui/MultiSelectPickerModal";
import { PhantomNotePickerModal } from "../ui/PhantomNotePickerModal";

export async function createCardFromNoteAction(
	ctx: CommandContext,
	note: NoteHandle,
	listId: string,
	listName?: string,
): Promise<void> {
	await ctx.run(
		`Create card — ${note.basename}`,
		async (reporter, signal) => {
			const boardLabels: TrelloLabel[] = ctx.settings.syncLabels
				? await ctx.client(reporter).getBoardLabels(ctx.settings.boardId, signal)
				: [];
			const result = await createCardFromNote(
				ctx.vault,
				ctx.client(reporter),
				note,
				listId,
				boardLabels,
				{
					syncDue: ctx.settings.syncDue,
					syncLabels: ctx.settings.syncLabels,
					syncChecklists: ctx.settings.syncChecklists,
					checklistHeading: ctx.settings.checklistHeading,
					dueFrontmatterKey: ctx.settings.dueFrontmatterKey,
					labelsFrontmatterKey: ctx.settings.labelsFrontmatterKey,
					cardRefFrontmatterKey: ctx.settings.cardRefFrontmatterKey,
					dryRun: ctx.settings.dryRun,
				},
				signal,
			);
			const targetDesc = listName ? ` in list "${listName}"` : "";
			return ctx.settings.dryRun
				? `[Dry-run] Would create Trello card "${result.card.name}"${targetDesc}.`
				: `Created Trello card "${result.card.name}"${targetDesc} and linked note.`;
		},
	);
}

export async function batchCreateCardsFromNotesAction(
	ctx: CommandContext,
	candidates: readonly PhantomCandidate<NoteHandle>[],
	fallbackListId: string,
	listName?: string,
): Promise<void> {
	await ctx.run("Create cards from phantom notes", async (reporter, signal) => {
		// Wrapped so every card this batch creates on Trello — and the note-side
		// link it writes — lands in sync history and can be undone (an undone
		// card creation is archived, never deleted — see `core/syncHistory.ts`'s
		// "trello-card-create" kind).
		return withHistoryRecording(ctx, "", async (vault, onTrelloWrite) => {
			reporter.setTotal(candidates.length);
			const boardLabels: TrelloLabel[] = ctx.settings.syncLabels
				? await ctx.client(reporter).getBoardLabels(ctx.settings.boardId, signal)
				: [];
			let created = 0;
			let errors = 0;

			for (const candidate of candidates) {
				if (signal?.aborted) break;
				reporter.step(candidate.note.basename);

				const dest = resolvePhantomCardDestination(
					candidate.note.folder,
					ctx.settings.mappings,
					fallbackListId,
					ctx.settings.phantomNotePreferFolderMapping,
				);
				if (dest.needsPrompt || dest.listId.trim() === "") {
					errors++;
					reporter.log("error", `${candidate.note.basename} — No destination list configured.`);
					continue;
				}

				try {
					await createCardFromNote(
						vault,
						ctx.client(reporter),
						candidate.note,
						dest.listId,
						boardLabels,
						{
							syncDue: ctx.settings.syncDue,
							syncLabels: ctx.settings.syncLabels,
							syncChecklists: ctx.settings.syncChecklists,
							checklistHeading: ctx.settings.checklistHeading,
							dueFrontmatterKey: ctx.settings.dueFrontmatterKey,
							labelsFrontmatterKey: ctx.settings.labelsFrontmatterKey,
							cardRefFrontmatterKey: ctx.settings.cardRefFrontmatterKey,
							dryRun: ctx.settings.dryRun,
							onCardCreate: onTrelloWrite,
						},
						signal,
					);
					created++;
					reporter.log("create", candidate.note.basename);
				} catch (error) {
					if (signal?.aborted) break;
					errors++;
					reporter.log("error", `${candidate.note.basename} — ${errorMessage(error)}`);
				}
			}

			const desc = listName ? ` in list "${listName}"` : "";
			return ctx.settings.dryRun
				? `[Dry-run] Would create ${created} card(s)${desc} (${errors} error(s)).`
				: `Created ${created} card(s)${desc} on Trello (${errors} error(s)).`;
		});
	});
}

/** "Create Trello card from active note": turns the active note into a card on Trello and links them. */
export async function createCardFromActiveNote(ctx: CommandContext): Promise<void> {
	if (!ctx.ready(true)) return;
	const note = ctx.activeNote();
	if (!note) return;

	const ref = ctx.vault.getCardRef(note);
	if (ref) {
		try {
			const existingCard = await ctx.client().getCard(ref.cardId);
			if (existingCard) {
				new Notice("Active note is already linked to a card on Trello.");
				return;
			}
		} catch (error) {
			if (!(error instanceof TrelloError && error.status === 404)) {
				new Notice(`❌ ${errorMessage(error)}`);
				return;
			}
			// 404: card was deleted on Trello (true phantom note) — proceed to recreate it.
		}
	}

	const dest = resolvePhantomCardDestination(
		note.folder,
		ctx.settings.mappings,
		ctx.settings.phantomCardListId,
		ctx.settings.phantomNotePreferFolderMapping,
	);

	if (!dest.needsPrompt) {
		await createCardFromNoteAction(ctx, note, dest.listId);
		return;
	}

	let lists: TrelloList[];
	try {
		lists = await ctx.client().getBoardLists(ctx.settings.boardId);
	} catch (error) {
		new Notice(`❌ ${errorMessage(error)}`);
		return;
	}

	if (lists.length === 0) {
		new Notice("No lists found on the Trello board.");
		return;
	}

	new ListPickerModal(ctx.app, lists, (list) => {
		void createCardFromNoteAction(ctx, note, list.id, list.name);
	}).open();
}

/** "Create Trello cards from phantom notes": scans for phantom/unlinked notes and creates cards for them. */
export async function createCardsFromPhantomNotes(ctx: CommandContext): Promise<void> {
	if (!ctx.ready(true)) return;

	await ctx.run("Scan for phantom notes", async (reporter, signal) => {
		const { cards, listNames } = await fetchBoardIndex(ctx.client(reporter), ctx.settings.boardId, signal);
		const aliveCardIds = new Set(cards.map((c) => c.id));
		const notes = ctx.vault.listNotes(ctx.settings.scope, ctx.settings.excludedFolders);
		const mappedFolders = new Set(ctx.settings.mappings.map((m) => m.folder));

		reporter.setTotal(notes.length);
		const plannedNotes: { path: string; basename: string; folder: string; mtime: number; cardId: string | null }[] = [];
		for (const [i, note] of notes.entries()) {
			if (signal?.aborted) break;
			reporter.step(note.basename);
			plannedNotes.push({
				path: note.path,
				basename: note.basename,
				folder: note.folder,
				mtime: note.mtime,
				cardId: ctx.vault.getCardRef(note)?.cardId ?? null,
			});
			await yieldPeriodically(i);
		}

		if (signal?.aborted) return "Scanning cancelled.";

		const candidates = findPhantomNoteCandidates(
			plannedNotes,
			aliveCardIds,
			ctx.settings.phantomNoteScope,
			mappedFolders,
		);

		if (candidates.length === 0) {
			return "No phantom or unlinked notes found in the vault.";
		}

		const noteHandleMap = new Map(notes.map((n) => [n.path, n]));
		const candidateHandles = candidates
			.map((c) => {
				const handle = noteHandleMap.get(c.note.path);
				return handle ? { note: handle, kind: c.kind } : null;
			})
			.filter((c): c is PhantomCandidate<NoteHandle> => c !== null);

		const lists = Array.from(listNames.entries()).map(([id, name]) => ({ id, name }));

		/** Runs the batch card-creation for exactly `chosen` — prompting for a destination list first when at least one of them needs it. Shared by "Create for ALL" and "Select several…". */
		const runBatchCreateCards = (chosen: readonly PhantomCandidate<NoteHandle>[]): void => {
			const anyNeedsPrompt = chosen.some((c) =>
				resolvePhantomCardDestination(
					c.note.folder,
					ctx.settings.mappings,
					ctx.settings.phantomCardListId,
					ctx.settings.phantomNotePreferFolderMapping,
				).needsPrompt,
			);

			if (!anyNeedsPrompt) {
				void batchCreateCardsFromNotesAction(
					ctx,
					chosen,
					ctx.settings.phantomCardListId,
					listNames.get(ctx.settings.phantomCardListId),
				);
			} else {
				if (lists.length === 0) {
					new Notice("No lists found on the Trello board.");
					return;
				}
				new ListPickerModal(ctx.app, lists, (list) => {
					void batchCreateCardsFromNotesAction(ctx, chosen, list.id, list.name);
				}).open();
			}
		};

		new PhantomNotePickerModal(ctx.app, candidateHandles, (choice) => {
			if (choice.type === "all") {
				void confirmIfEnabled(
					ctx,
					ctx.settings.confirmBatchCreate,
					`Create Trello cards for ALL ${choice.count} phantom note(s)?`,
					"Create all",
					() => runBatchCreateCards(candidateHandles),
				);
			} else if (choice.type === "select") {
				new MultiSelectPickerModal(
					ctx.app,
					"Create cards — select notes",
					candidateHandles,
					(c) => `${c.note.basename} (${c.note.folder || "root"}) [${c.kind}]`,
					"Create selected",
					(selected) => {
						if (selected.length > 0) runBatchCreateCards(selected);
					},
				).open();
			} else {
				const single = choice.candidate;
				const dest = resolvePhantomCardDestination(
					single.note.folder,
					ctx.settings.mappings,
					ctx.settings.phantomCardListId,
					ctx.settings.phantomNotePreferFolderMapping,
				);
				if (!dest.needsPrompt) {
					void createCardFromNoteAction(ctx, single.note, dest.listId, listNames.get(dest.listId));
				} else {
					if (lists.length === 0) {
						new Notice("No lists found on the Trello board.");
						return;
					}
					new ListPickerModal(ctx.app, lists, (list) => {
						void createCardFromNoteAction(ctx, single.note, list.id, list.name);
					}).open();
				}
			}
		}).open();

		return `Found ${candidates.length} phantom note(s) — choose an action in the dialog.`;
	});
}
