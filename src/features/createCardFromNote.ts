import { DEFAULT_CHECKLIST_HEADING } from "../core/checklistRef";
import { DEFAULT_DUE_KEY, parseDueRef } from "../core/dueRef";
import { DEFAULT_LABELS_KEY, normalizeLabelName, parseLabelsRef } from "../core/labelRef";
import { extractBody } from "../core/noteBody";
import type { TrelloCardCreateAction } from "../core/syncHistory";
import type { CardRefStore, NoteHandle, VaultGateway } from "../obsidian/gateway";
import type { TrelloCard, TrelloClient, TrelloLabel } from "../trello/client";

export interface CreateCardFromNoteOptions {
	syncDue?: boolean;
	syncLabels?: boolean;
	syncChecklists?: boolean;
	checklistHeading?: string;
	dueFrontmatterKey?: string;
	labelsFrontmatterKey?: string;
	cardRefFrontmatterKey?: string;
	dryRun?: boolean;
	/** Called once, after the card is created and the note is linked — never in dry-run. Feeds "Create cards from phantom notes" into sync history so the creation can be undone (archived) later. */
	onCardCreate?: (action: TrelloCardCreateAction) => void;
}

export interface CreateCardFromNoteResult {
	card: TrelloCard;
	note: NoteHandle;
}

/**
 * Creates a new Trello card on the board for a vault note (e.g. phantom or unlinked note),
 * and links the note's frontmatter to the newly created card.
 */
export async function createCardFromNote(
	vault: VaultGateway & CardRefStore,
	client: TrelloClient,
	note: NoteHandle,
	listId: string,
	boardLabels: readonly TrelloLabel[],
	options: CreateCardFromNoteOptions = {},
	signal?: AbortSignal,
): Promise<CreateCardFromNoteResult> {
	const rawContent = await vault.read(note);
	const checklistHeading = options.checklistHeading ?? DEFAULT_CHECKLIST_HEADING;
	const body = extractBody(rawContent, checklistHeading);

	const frontmatter = vault.readFrontmatter(note) ?? {};
	const dueKey = options.dueFrontmatterKey ?? DEFAULT_DUE_KEY;
	const labelsKey = options.labelsFrontmatterKey ?? DEFAULT_LABELS_KEY;

	const due = options.syncDue !== false ? parseDueRef(frontmatter[dueKey]) : null;
	const localLabelNames = options.syncLabels !== false ? parseLabelsRef(frontmatter[labelsKey]) : [];

	const labelMap = new Map(boardLabels.map((l) => [normalizeLabelName(l.name), l.id]));
	const idLabels = localLabelNames
		.map((name) => labelMap.get(normalizeLabelName(name)))
		.filter((id): id is string => typeof id === "string" && id.length > 0);

	if (options.dryRun) {
		const simulatedCard: TrelloCard = {
			id: "dry-run-card-id",
			idBoard: "dry-run-board-id",
			idList: listId,
			name: note.basename,
			desc: body,
			url: "https://trello.com/c/dryrun",
			dateLastActivity: new Date().toISOString(),
			due,
		};
		return { card: simulatedCard, note };
	}

	const card = await client.createCard(
		{
			idList: listId,
			name: note.basename,
			desc: body,
			due,
			idLabels,
			pos: "bottom",
		},
		signal,
	);

	await vault.setCardRef(note, { boardId: card.idBoard, cardId: card.id });
	options.onCardCreate?.({ kind: "trello-card-create", path: note.path, cardId: card.id });
	return { card, note };
}
