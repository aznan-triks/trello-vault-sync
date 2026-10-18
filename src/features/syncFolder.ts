import type { CardFateRules } from "../core/cardFate";
import { DEFAULT_CARD_REF_KEY } from "../core/cardRef";
import type { CustomFieldDefinitionLike } from "../core/customFieldRef";
import { errorMessage } from "../core/errorMessage";
import { cardsWithDeletedNotes, nextKnownLinks, type OnLinkedNoteDeleted } from "../core/deletedNotes";
import { notesInFolder, sanitizeFileName } from "../core/fileName";
import { planFolderMatch, type PlannedNote } from "../core/folderPlan";
import { resolveOverride, type MappingOverride } from "../core/mappingOverride";
import { addCounts, tallyNoteResult } from "../core/syncTally";
import { templateMissingCardRefKey } from "../core/template";
import {
	silentReporter,
	type CardRefStore,
	type NoteHandle,
	type Reporter,
	type TemplateResolver,
	type VaultGateway,
} from "../obsidian/gateway";
import type { TrelloCard, TrelloClient } from "../trello/client";
import { buildCardIndex } from "./attachmentSync";
import { createNoteFromCard } from "./createNoteFromCard";
import { handleGoneNotes, isUnderAny, moveNoteToFolder } from "./noteFate";
import {
	buildCustomFieldDefinitions,
	buildMemberDirectory,
	cardIncludesFor,
	syncNoteWithCard,
	type NoteSyncOptions,
} from "./syncNote";

/** One Trello list mirrored into one vault folder. */
export interface FolderMapping {
	listId: string;
	folder: string;
	/** Template note used for new files; "" or missing means a bare description. */
	templateName: string;
	/** Overrides `allowCreate` for this mapping only; `undefined`/missing behaves as "inherit". */
	allowCreateOverride?: MappingOverride;
	/** `"off"` = never trash a note of this folder, whatever the global choice; `undefined`/missing/"inherit" follows it. */
	allowDeleteOverride?: MappingOverride;
}

export interface FolderSyncOptions extends NoteSyncOptions {
	allowCreate: boolean;
	/** What a sync does with a note whose card was moved, archived or deleted. */
	cardFate: CardFateRules;
	/** Every frontmatter key an "unlink" removes. */
	trelloPropertyKeys: readonly string[];
	/** List id -> mapped folder, for every mapping (not just the ones in this run): where a note follows a moved card. */
	mappedFolderByListId: ReadonlyMap<string, string>;
	/** Also creates, in the archive folder, a note for every archived card of a mapped list that has none. Needs `cardFate.onCardArchived: "archive-folder"`. */
	archiveCreateMissing?: boolean;
	/** What to do with a card whose note the user deleted; absent = the old behaviour (the note is created again). */
	deletedNotes?: DeletedNotesContext;
	/** Board the list belongs to. */
	boardId: string;
	/** `undefined` behaves as `DEFAULT_CARD_REF_KEY`. */
	cardRefFrontmatterKey?: string;
	/** Fallback template note used when the mapping doesn't specify one. */
	defaultTemplateName?: string;
}

/** The memory a pass needs to tell "the user deleted this note" from "a new card" - persisted by the caller, never by the engine. */
export interface DeletedNotesContext {
	rule: OnLinkedNoteDeleted;
	/** Ids of this list's cards that had a note at the last successful pass. */
	knownLinks: (listId: string) => ReadonlySet<string>;
	ignoredIds: ReadonlySet<string>;
	/** Called once at the end of a complete, non-dry pass over a list. */
	record: (update: { listId: string; knownLinks: string[]; newlyIgnored: { id: string; name: string }[]; unignored: string[] }) => void;
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
	/** Notes left in place although their card moved to another list (rule "keep", or the new list is not mapped). */
	moved: number;
	/** Notes moved to the trash because their card was moved, archived or deleted. */
	deleted: number;
	/** Notes whose Trello properties were removed because their card was moved, archived or deleted. */
	detached: number;
	/** Notes filed into another folder (their card changed list, was archived, or came back from the archive). */
	relocated: number;
	/** Cards left without a note because the user deleted theirs (rule "ignore-card"), or ignored earlier. */
	ignored: number;
	/** Extra notes in the folder claiming a card another note already claimed. */
	duplicates: number;
	/** Notes in the folder carrying no card id at all. */
	unlinked: number;
	errors: number;
}

/** A stats object with every counter at zero — also the shape callers accumulate into. */
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
	detached: 0,
	relocated: 0,
	ignored: 0,
	duplicates: 0,
	unlinked: 0,
	errors: 0,
});

/**
 * Mirror one Trello list into one vault folder.
 *
 * A single list request feeds the whole run — the legacy script issued one HTTP
 * call per note. Matching is delegated to the pure planner, so this function
 * only performs the resulting IO.
 */
export async function syncFolder(
	vault: VaultGateway & CardRefStore & TemplateResolver,
	client: TrelloClient,
	mapping: FolderMapping,
	options: FolderSyncOptions,
	reporter: Reporter = silentReporter,
	/** Pre-fetched (filter "all") board cards — lets a multi-mapping run share one fetch. */
	boardCards?: TrelloCard[],
	signal?: AbortSignal,
	/** Pre-scanned notes already narrowed to this folder — lets a multi-mapping run share one vault scan. */
	noteHandles?: NoteHandle[],
	/** Pre-built vault-wide card index for resolving card-link attachments — lets a multi-mapping run share one build; built from its own vault scan when omitted and attachments syncing is on. */
	cardIndex?: Map<string, NoteHandle>,
	/** Pre-built board member id→name directory — lets a multi-mapping run share one `getBoardMembers` call; fetched once here when omitted and member syncing is on. */
	memberDirectory?: Map<string, string>,
	/** Pre-built board custom-field definition directory — lets a multi-mapping run share one `getBoardCustomFields` call; fetched once here when omitted and custom-field syncing is on. */
	customFieldDefinitions?: Map<string, CustomFieldDefinitionLike>,
): Promise<FolderSyncStats> {
	const stats = emptyStats();
	const cardRefKey = options.cardRefFrontmatterKey ?? DEFAULT_CARD_REF_KEY;
	const allowCreate = resolveOverride(mapping.allowCreateOverride, options.allowCreate);
	const trashAllowed = mapping.allowDeleteOverride !== "off";
	const cards = await client.getListCards(mapping.listId, signal, cardIncludesFor(options));
	reporter.log("info", `${cards.length} card(s) in the list`);

	const attachmentsCardIndex =
		options.syncAttachments === false ? undefined : (cardIndex ?? buildCardIndex(vault, vault.listNotes("")));
	const members =
		options.syncMembers === false
			? undefined
			: (memberDirectory ?? buildMemberDirectory(await client.getBoardMembers(options.boardId, signal)));
	const customFields =
		options.syncCustomFields === false
			? undefined
			: (customFieldDefinitions ??
				buildCustomFieldDefinitions(await client.getBoardCustomFields(options.boardId, signal)));

	const handles = noteHandles ?? vault.listNotes(mapping.folder);
	const planned: PlannedNote[] = handles.map((note) => ({
		path: note.path,
		basename: note.basename,
		folder: note.folder,
		mtime: note.mtime,
		cardId: vault.getCardRef(note)?.cardId ?? null,
	}));

	const plan = planFolderMatch(cards, planned, mapping.folder, options.maxNameLength);

	stats.duplicates = plan.duplicateNotes.length;
	for (const duplicate of plan.duplicateNotes) {
		reporter.log(
			"warn",
			`Duplicate note claiming an already-linked card: ${duplicate.basename} (kept, not synced)`,
		);
	}
	stats.unlinked = plan.unlinkedNotes.length;

	reporter.setTotal(plan.pairs.length + (allowCreate ? plan.missingCards.length : 0) + plan.phantomNotes.length);

	const templateName = mapping.templateName || options.defaultTemplateName || "";
	const template = templateName ? await vault.readTemplate(templateName) : null;
	if (template && templateMissingCardRefKey(template, cardRefKey)) {
		reporter.log(
			"warn",
			`Template "${templateName}" has no ${cardRefKey} key — new notes from it won't link back to their card.`,
		);
	}
	const byPath = new Map(handles.map((note) => [note.path, note]));

	for (const pair of plan.pairs) {
		if (signal?.aborted) break;
		reporter.step(pair.card.name);
		const note = byPath.get(pair.note.path);
		if (!note) continue;

		try {
			if (pair.adopted && !options.dryRun) {
				await vault.setCardRef(note, { boardId: pair.card.idBoard, cardId: pair.card.id });
			}
			// An adopted note has no sync history to arbitrate: the card wins.
			const result = await syncNoteWithCard(
				vault,
				client,
				note,
				pair.card,
				{
					...options,
					...(pair.adopted ? { force: "pull" as const } : {}),
				},
				attachmentsCardIndex,
				members,
				customFields,
				signal,
			);

			if (pair.adopted) {
				if (result.renamed) stats.renamed++;
				stats.adopted++;
				reporter.log("adopt", pair.card.name);
			} else {
				tallyNoteResult(stats, result, (level, message) => reporter.log(level, message), pair.card.name);
			}
		} catch (error) {
			stats.errors++;
			reporter.log("error", `${pair.card.name} — ${errorMessage(error)}`);
		}
	}

	// A card with no note in this folder may already have one elsewhere (its card moved lists, or came back
	// from the archive): that note follows it here instead of a duplicate being created.
	let toCreate = plan.missingCards;
	const { deletedNotes } = options;
	const newlyIgnored: { id: string; name: string }[] = [];
	let linkedAnywhere: ReadonlySet<string> = new Set();
	if (plan.missingCards.length > 0 && !signal?.aborted) {
		const elsewhere = buildCardIndex(vault, vault.listNotes(""));
		linkedAnywhere = new Set(elsewhere.keys());
		const deletedIds = deletedNotes
			? new Set(cardsWithDeletedNotes(plan.missingCards.map((c) => c.id), deletedNotes.knownLinks(mapping.listId), linkedAnywhere))
			: new Set<string>();
		toCreate = [];
		for (const card of plan.missingCards) {
			if (signal?.aborted) break;
			const existing = elsewhere.get(card.id);
			if (!existing) {
				if (deletedNotes?.ignoredIds.has(card.id)) {
					stats.ignored++;
					reporter.log("skip", `${card.name} — ignored card, no note created`);
				} else if (deletedIds.has(card.id) && deletedNotes?.rule !== "recreate") {
					await handleDeletedNote(client, card, deletedNotes?.rule ?? "recreate", options, stats, reporter, newlyIgnored, signal);
				} else {
					toCreate.push(card);
				}
				continue;
			}
			reporter.step(card.name);
			try {
				await adoptNoteFromElsewhere(vault, client, mapping, options, card, existing, stats, reporter, {
					attachmentsCardIndex,
					members,
					customFields,
					signal,
				});
			} catch (error) {
				stats.errors++;
				reporter.log("error", `${card.name} — ${errorMessage(error)}`);
			}
		}
	}

	const createdIds = new Set<string>();
	if (allowCreate) {
		for (const card of toCreate) {
			if (signal?.aborted) break;
			reporter.step(card.name);
			try {
				stats.created++;
				const safeName = sanitizeFileName(card.name, options.maxNameLength);
				reporter.log(
					"create",
					safeName === card.name ? card.name : `${card.name} → saved as "${safeName}"`,
				);
				if (options.dryRun) continue;
				const created = await createNoteFromCard(
					vault,
					card,
					mapping.folder,
					template,
					cardRefKey,
					options.maxNameLength,
					options.guard,
				);
				if (created === null) {
					stats.created--;
					stats.skipped++;
					reporter.log("skip", `${card.name} — already being created by another operation`);
				} else {
					createdIds.add(card.id);
				}
			} catch (error) {
				stats.created--;
				stats.errors++;
				reporter.log("error", `${card.name} — ${errorMessage(error)}`);
			}
		}
	}

	stats.phantoms = plan.phantomNotes.length;

	if (deletedNotes && !options.dryRun && !signal?.aborted && stats.errors === 0) {
		const have = new Set([...linkedAnywhere, ...createdIds, ...plan.pairs.map((pair) => pair.card.id)]);
		deletedNotes.record({
			listId: mapping.listId,
			knownLinks: nextKnownLinks(cards.map((c) => c.id), have),
			newlyIgnored,
			unignored: cards.filter((c) => deletedNotes.ignoredIds.has(c.id) && have.has(c.id)).map((c) => c.id),
		});
	}

	// A note already filed in the archive folder is where its (archived) card wants it: nothing to decide, no request to spend.
	const archiveFolder = options.cardFate.onCardArchived === "archive-folder" ? options.cardFate.archiveFolder : "";
	const gone = plan.phantomNotes.flatMap((phantom) => {
		const note = byPath.get(phantom.path);
		if (!note || phantom.cardId === null) return [];
		return archiveFolder !== "" && isUnderAny(note, [archiveFolder]) ? [] : [{ note, cardId: phantom.cardId }];
	});
	await handleGoneNotes(vault, client, gone, {
		rules: options.cardFate,
		propertyKeys: options.trelloPropertyKeys,
		mappedFolderByListId: options.mappedFolderByListId,
		trashAllowed: () => trashAllowed,
		aliveMode: "apply",
		dryRun: options.dryRun,
		reporter,
		stats,
		signal,
		known: boardCards ? new Map(boardCards.map((boardCard) => [boardCard.id, boardCard])) : undefined,
	});

	return stats;
}

/** Applies the user's rule to a card whose note was deleted: remember it as ignored, or archive it on Trello (recoverable). */
async function handleDeletedNote(
	client: TrelloClient,
	card: TrelloCard,
	rule: OnLinkedNoteDeleted,
	options: FolderSyncOptions,
	stats: FolderSyncStats,
	reporter: Reporter,
	newlyIgnored: { id: string; name: string }[],
	signal?: AbortSignal,
): Promise<void> {
	if (rule === "archive-card") {
		reporter.log("push", `${card.name} — its note was deleted, archiving the card`);
		if (!options.dryRun) {
			const archive = () => client.updateCard(card.id, { closed: true }, signal);
			await (options.guard ? options.guard.withKey(`card:${card.id}`, archive) : archive());
		}
		return;
	}
	stats.ignored++;
	reporter.log("skip", `${card.name} — its note was deleted, the card is now ignored`);
	if (!options.dryRun) newlyIgnored.push({ id: card.id, name: card.name });
}

/**
 * A card of this list whose note lives in another folder: moves the note here when the rules say it
 * follows its card (it sits in another mapped folder, or comes back from the archive folder), then
 * syncs it like any other pair. Otherwise leaves it where it is - never a second note.
 */
async function adoptNoteFromElsewhere(
	vault: VaultGateway & CardRefStore,
	client: TrelloClient,
	mapping: FolderMapping,
	options: FolderSyncOptions,
	card: TrelloCard,
	existing: NoteHandle,
	stats: FolderSyncStats,
	reporter: Reporter,
	shared: {
		attachmentsCardIndex?: Map<string, NoteHandle>;
		members?: Map<string, string>;
		customFields?: Map<string, CustomFieldDefinitionLike>;
		signal?: AbortSignal;
	},
): Promise<void> {
	let note = existing;
	if (existing.folder !== mapping.folder) {
		const { cardFate } = options;
		const inMappedFolder = isUnderAny(existing, [...options.mappedFolderByListId.values()]);
		const inArchive = cardFate.archiveFolder !== "" && isUnderAny(existing, [cardFate.archiveFolder]);
		const follows =
			(inMappedFolder && cardFate.onCardMoved === "move-note") ||
			(inArchive && options.archiveRestoreOnUnarchive !== false);
		const where = existing.folder || "the vault root";
		if (!follows) {
			stats.skipped++;
			reporter.log("skip", `${card.name} — its note lives at ${existing.path}, not created again`);
			return;
		}
		if (options.dryRun) {
			stats.relocated++;
			reporter.log("rename", `${card.name} — note would move from ${where} to ${mapping.folder}`);
			return;
		}
		const moved = await moveNoteToFolder(vault, existing, mapping.folder);
		if (!moved.moved) {
			stats.skipped++;
			reporter.log("warn", `${card.name} — note kept at ${existing.path} (${moved.reason})`);
			return;
		}
		note = moved.note;
		stats.relocated++;
		reporter.log("rename", `${card.name} — note moved from ${where} to ${mapping.folder}`);
	}
	const result = await syncNoteWithCard(
		vault,
		client,
		note,
		card,
		options,
		shared.attachmentsCardIndex,
		shared.members,
		shared.customFields,
		shared.signal,
	);
	tallyNoteResult(stats, result, (level, message) => reporter.log(level, message), card.name);
}

/**
 * Mirror every configured list ↔ folder mapping into its folder.
 *
 * One board fetch and one vault scan feed every mapping in the run instead of
 * one each — mirrors the sharing `syncFolder` already does for a single
 * mapping. A mapping that throws (e.g. its list was deleted) is counted as an
 * error and does not stop the mappings after it.
 */
export async function syncAllMappings(
	vault: VaultGateway & CardRefStore & TemplateResolver,
	client: TrelloClient,
	mappings: FolderMapping[],
	options: FolderSyncOptions,
	reporter: Reporter = silentReporter,
	signal?: AbortSignal,
): Promise<FolderSyncStats> {
	const total = emptyStats();
	// One board-wide fetch (archived cards included) only when archived cards are to get a note of their own.
	const wantsArchivedNotes =
		options.archiveCreateMissing === true &&
		options.cardFate.onCardArchived === "archive-folder" &&
		options.cardFate.archiveFolder !== "";
	const boardCards = wantsArchivedNotes ? await client.getBoardCards(options.boardId, "all", signal) : undefined;
	const allNotes = vault.listNotes("");
	const cardIndex = options.syncAttachments === false ? undefined : buildCardIndex(vault, allNotes);
	const memberDirectory =
		options.syncMembers === false
			? undefined
			: buildMemberDirectory(await client.getBoardMembers(options.boardId, signal));
	const customFieldDefinitions =
		options.syncCustomFields === false
			? undefined
			: buildCustomFieldDefinitions(await client.getBoardCustomFields(options.boardId, signal));

	for (const mapping of mappings) {
		if (signal?.aborted) break;
		reporter.log("info", `Folder: ${mapping.folder}`);
		try {
			const stats = await syncFolder(
				vault,
				client,
				mapping,
				options,
				reporter,
				boardCards,
				signal,
				notesInFolder(allNotes, mapping.folder),
				cardIndex,
				memberDirectory,
				customFieldDefinitions,
			);
			addCounts(total, stats);
		} catch (error) {
			total.errors++;
			reporter.log("error", `${mapping.folder} — ${errorMessage(error)}`);
		}
	}

	if (boardCards && !signal?.aborted) {
		await createArchivedCardNotes(vault, mappings, boardCards, options, total, reporter, signal);
	}
	return total;
}

/** "Also create notes for archived cards": one note in the archive folder per archived card of a mapped list that no note carries yet. */
async function createArchivedCardNotes(
	vault: VaultGateway & CardRefStore & TemplateResolver,
	mappings: FolderMapping[],
	boardCards: TrelloCard[],
	options: FolderSyncOptions,
	total: FolderSyncStats,
	reporter: Reporter,
	signal?: AbortSignal,
): Promise<void> {
	const linked = buildCardIndex(vault, vault.listNotes(""));
	const cardRefKey = options.cardRefFrontmatterKey ?? DEFAULT_CARD_REF_KEY;
	const templates = new Map<string, string | null>();
	for (const card of boardCards) {
		if (signal?.aborted) break;
		const mapping = card.closed === true ? mappings.find((candidate) => candidate.listId === card.idList) : undefined;
		if (!mapping || linked.has(card.id)) continue;
		if (!resolveOverride(mapping.allowCreateOverride, options.allowCreate)) continue;
		reporter.step(card.name);
		try {
			const templateName = mapping.templateName || options.defaultTemplateName || "";
			if (!templates.has(templateName)) {
				templates.set(templateName, templateName ? await vault.readTemplate(templateName) : null);
			}
			total.created++;
			reporter.log("create", `${card.name} (archived card) → ${options.cardFate.archiveFolder}`);
			if (options.dryRun) continue;
			const created = await createNoteFromCard(
				vault,
				card,
				options.cardFate.archiveFolder,
				templates.get(templateName) ?? null,
				cardRefKey,
				options.maxNameLength,
				options.guard,
			);
			if (created === null) {
				total.created--;
				total.skipped++;
			}
		} catch (error) {
			total.created--;
			total.errors++;
			reporter.log("error", `${card.name} — ${errorMessage(error)}`);
		}
	}
}
