import {
	DEFAULT_ATTACHMENTS_KEY,
	DEFAULT_COVER_KEY,
	DEFAULT_COVER_LOCAL_FORMAT,
	DEFAULT_LINKED_CARDS_KEY,
	DEFAULT_PREFER_LOCAL_COVER,
	DEFAULT_SYNC_ATTACHMENTS,
	DEFAULT_SYNC_CARD_COVER,
	DEFAULT_SYNC_LINKED_CARDS,
	coverImageUrl,
	formatAttachmentsRef,
	formatLinkedCardsRef,
	formatWikilink,
	parseAttachmentsRef,
	parseLinkedCardsRef,
	type CoverLocalFormat,
} from "../core/attachmentRef";
import {
	resolveAttachmentPath,
	type AttachmentsDestination,
	type AttachmentsDownloadScope,
} from "../core/attachmentPath";
import { DEFAULT_CHECKLIST_HEADING, DEFAULT_SYNC_CHECKLISTS } from "../core/checklistRef";
import { DEFAULT_DUE_KEY, formatDueRef, parseDueRef } from "../core/dueRef";
import { errorMessage } from "../core/errorMessage";
import { sanitizeFileName, uniqueNotePath } from "../core/fileName";
import { DEFAULT_LABELS_KEY, formatLabelsRef, normalizeLabelName, parseLabelsRef } from "../core/labelRef";
import { DEFAULT_LABELS_SYNC_MODE, resolveLabelSync, type LabelSyncMode } from "../core/labelMerge";
import {
	DEFAULT_CUSTOM_FIELDS_KEY,
	DEFAULT_SYNC_CUSTOM_FIELDS,
	formatCustomFieldsRef,
	parseCustomFieldsRef,
	resolveCustomFields,
	type CustomFieldDefinitionLike,
} from "../core/customFieldRef";
import {
	DEFAULT_MEMBERS_KEY,
	DEFAULT_SYNC_MEMBERS,
	formatMembersRef,
	parseMembersRef,
	resolveMemberNames,
} from "../core/memberRef";
import { extractBody, insertChecklistSection, replaceBody, splitChecklistSection } from "../core/noteBody";
import { decideSync, type ConflictPolicy, type SyncDecision, type SyncDirection } from "../core/syncDecision";
import type { TrelloCardUpdateAction, TrelloCheckItemAction } from "../core/syncHistory";
import { buildCardIndex, resolveAttachments } from "./attachmentSync";
import { downloadAttachments } from "./attachmentDownload";
import { resolveChecklists } from "./checklistSync";
import type { CardRefStore, NoteHandle, VaultGateway } from "../obsidian/gateway";
import type {
	CardIncludes,
	TrelloCard,
	TrelloChecklist,
	TrelloClient,
	TrelloCustomFieldDefinition,
	TrelloLabel,
	TrelloMember,
} from "../trello/client";

export interface NoteSyncOptions {
	policy: ConflictPolicy;
	marginMs: number;
	/** Whether the note file name and the card title follow each other. */
	syncTitle: boolean;
	/** Whether the note body and the card description follow each other. Defaults to true. */
	syncDescription?: boolean;
	/** Whether the note frontmatter due date and the card due follow each other. Defaults to true. */
	syncDue?: boolean;
	/** Whether labels are synchronized. Defaults to true. */
	syncLabels?: boolean;
	dryRun: boolean;
	/** Explicit user choice, bypassing timestamps entirely. */
	force?: "pull" | "push";
	/** `undefined` behaves as `"merge"` — the non-destructive default. */
	labelsSyncMode?: LabelSyncMode;
	/** `undefined` behaves as `DEFAULT_DUE_KEY`. */
	dueFrontmatterKey?: string;
	/** `undefined` behaves as `DEFAULT_LABELS_KEY`. */
	labelsFrontmatterKey?: string;
	/** Pull-only, on by default (`undefined` behaves as `true`) — see `DEFAULT_SYNC_ATTACHMENTS` for its request cost. */
	syncAttachments?: boolean;
	/** `undefined` behaves as `DEFAULT_ATTACHMENTS_KEY`. */
	attachmentsFrontmatterKey?: string;
	/** `undefined` behaves as `DEFAULT_LINKED_CARDS_KEY`. */
	linkedCardsFrontmatterKey?: string;
	/** Only meaningful when `syncAttachments` is on — resolves a card-link attachment to a wikilink. `undefined` behaves as `DEFAULT_SYNC_LINKED_CARDS`. */
	syncLinkedCards?: boolean;
	/** See `DEFAULT_SYNC_CHECKLISTS` for its request cost. `undefined` behaves as `true`. */
	syncChecklists?: boolean;
	/** `undefined` behaves as `DEFAULT_CHECKLIST_HEADING`. */
	checklistHeading?: string;
	/** Pull-only, no extra Trello request (`cover` rides the already-fetched card). `undefined` behaves as `DEFAULT_SYNC_CARD_COVER`. */
	syncCardCover?: boolean;
	/** `undefined` behaves as `DEFAULT_COVER_KEY`. */
	coverFrontmatterKey?: string;
	/** `undefined` behaves as `DEFAULT_PREFER_LOCAL_COVER` (false). */
	preferLocalCover?: boolean;
	/** `undefined` behaves as `DEFAULT_COVER_LOCAL_FORMAT` ("vault-path"). */
	coverLocalFormat?: CoverLocalFormat;
	/** Off by default — downloads uploaded (non-link) attachments into the vault. */
	downloadAttachments?: boolean;
	/** `undefined` behaves as `"note-folder"`. */
	attachmentsDestination?: AttachmentsDestination;
	/** Required (non-empty) only when `attachmentsDestination` is `"global-folder"`. */
	attachmentsFolder?: string;
	/** `"cover-only"` restricts a download run to the card's cover attachment. `undefined` behaves as `"all"`. */
	attachmentsDownloadScope?: AttachmentsDownloadScope;
	/**
	 * Fetches a url's bytes, `null` on failure — only consulted when
	 * `downloadAttachments` is on. Bundled into options rather than threaded as
	 * its own parameter through `syncFolder`/`syncVault`: it's off by default,
	 * so every other caller of those two engines is unaffected by its absence.
	 */
	fetchBinary?: (url: string, signal?: AbortSignal) => Promise<ArrayBuffer | null>;
	/**
	 * Called once per Trello write this sync performs, with everything needed to
	 * invert it later. Bundled into options like `fetchBinary` above: history
	 * recording is opt-in, so every other caller is unaffected by its absence.
	 */
	onTrelloWrite?: (action: TrelloCardUpdateAction | TrelloCheckItemAction) => void;
	/** No extra Trello request per note — the board's member directory is fetched once per run, see `cardIndex`'s own pattern. `undefined` behaves as `DEFAULT_SYNC_MEMBERS`. */
	syncMembers?: boolean;
	/** `undefined` behaves as `DEFAULT_MEMBERS_KEY`. */
	membersFrontmatterKey?: string;
	/** No extra Trello request per note — custom-field values ride the already-fetched card, and the board's field-definition directory is fetched once per run, see `cardIndex`'s own pattern. `undefined` behaves as `DEFAULT_SYNC_CUSTOM_FIELDS`. */
	syncCustomFields?: boolean;
	/** `undefined` behaves as `DEFAULT_CUSTOM_FIELDS_KEY`. */
	customFieldsFrontmatterKey?: string;
	/**
	 * Asks for attachments/checklists inside the card request itself instead of one
	 * extra request per card. `undefined` behaves as `true`; `false` restores the
	 * per-card requests. A card fetched without them always falls back to its own request.
	 */
	fetchCardDetailsWithCards?: boolean;
}

/**
 * Which card details the card request should carry for these options — `undefined`
 * when none is needed (feature off, dry run, or `fetchCardDetailsWithCards: false`).
 * Shared by `syncNote`, `syncFolder` and `syncVault` so the rule lives once.
 */
export function cardIncludesFor(options: NoteSyncOptions): CardIncludes | undefined {
	if (options.fetchCardDetailsWithCards === false || options.dryRun) return undefined;
	const attachments = (options.syncAttachments ?? DEFAULT_SYNC_ATTACHMENTS) || options.downloadAttachments === true;
	const checklists = options.syncChecklists ?? DEFAULT_SYNC_CHECKLISTS;
	return attachments || checklists ? { attachments, checklists } : undefined;
}

/** Checklists and their items in Trello's own order — an embedded list is not guaranteed to come back sorted. */
function orderedChecklists(checklists: TrelloChecklist[]): TrelloChecklist[] {
	const byPos = <T extends { pos?: number }>(a: T, b: T) => (a.pos ?? 0) - (b.pos ?? 0);
	return [...checklists]
		.sort(byPos)
		.map((checklist) => ({ ...checklist, checkItems: [...checklist.checkItems].sort(byPos) }));
}

export interface NoteSyncResult {
	direction: SyncDirection | "unlinked";
	renamed: boolean;
	/** The note after the operation — the path changes on rename. */
	note: NoteHandle;
	reason: string;
}

/**
 * What a note and its already-fetched card need, without touching either side.
 * Shared by the sync engines and by the "resolve conflict" UI, which needs the
 * same decision just to know whether there is a conflict to show at all.
 */
/** The card's own label names — a nameless (color-only) label is never surfaced. */
function remoteLabelsOf(card: TrelloCard): string[] {
	return (card.labels ?? []).map((label) => label.name).filter((name) => name.trim() !== "");
}

export function decideForCard(
	note: Pick<NoteHandle, "basename" | "mtime">,
	card: TrelloCard,
	localBody: string,
	options: Pick<
		NoteSyncOptions,
		"policy" | "marginMs" | "labelsSyncMode" | "syncTitle" | "syncDescription" | "syncDue" | "syncLabels"
	>,
	localDue: string | null,
	localLabels: string[] = [],
): SyncDecision {
	const remoteMtime = new Date(card.dateLastActivity).getTime();
	if (!Number.isFinite(remoteMtime)) {
		throw new Error(
			`Card "${card.name}" (${card.id}) has an unreadable dateLastActivity: "${card.dateLastActivity}" — refusing to guess a sync direction.`,
		);
	}
	return decideSync({
		localTitle: note.basename,
		localBody,
		localMtime: note.mtime,
		localDue,
		localLabels,
		remoteTitle: card.name,
		remoteBody: card.desc ?? "",
		remoteMtime,
		remoteDue: card.due,
		remoteLabels: remoteLabelsOf(card),
		labelsSyncMode: options.labelsSyncMode,
		syncTitle: options.syncTitle,
		syncDescription: options.syncDescription,
		syncDue: options.syncDue,
		syncLabels: options.syncLabels,
		policy: options.policy,
		marginMs: options.marginMs,
	});
}

/** Resolve label names to board ids, logging (not throwing) on a name with no match. */
function resolveLabelIds(names: string[], boardLabels: TrelloLabel[]): string[] {
	const ids: string[] = [];
	for (const name of names) {
		const match = boardLabels.find((label) => normalizeLabelName(label.name) === normalizeLabelName(name));
		if (match) ids.push(match.id);
		else console.warn(`[trello-vault-sync] Label "${name}" has no match on the Trello board — left unassigned.`);
	}
	return ids;
}

/** Write a resolved label list into a note's frontmatter, deleting the key when empty. */
async function writeLocalLabels(
	vault: VaultGateway,
	note: NoteHandle,
	labels: string[],
	labelsKey: string,
): Promise<void> {
	await vault.writeFrontmatter(note, (frontmatter) => {
		const formatted = formatLabelsRef(labels);
		if (formatted === null) delete frontmatter[labelsKey];
		else frontmatter[labelsKey] = formatted;
	});
}

/** Resolve a label list to the card's board's ids — one `getBoardLabels` call, shared by every push path. */
async function resolveLabelIdsForCard(
	client: TrelloClient,
	card: TrelloCard,
	labels: string[],
	signal?: AbortSignal,
): Promise<string[]> {
	const boardLabels = await client.getBoardLabels(card.idBoard, signal);
	return resolveLabelIds(labels, boardLabels);
}

/** Resolve a label list to ids and push it as the card's full label set, on its own `updateCard` call. */
async function pushRemoteLabels(
	client: TrelloClient,
	note: NoteHandle,
	card: TrelloCard,
	labels: string[],
	onTrelloWrite: NoteSyncOptions["onTrelloWrite"],
	signal?: AbortSignal,
): Promise<void> {
	if (signal?.aborted) return;
	const idLabels = await resolveLabelIdsForCard(client, card, labels, signal);
	await client.updateCard(card.id, { idLabels }, signal);
	onTrelloWrite?.({
		kind: "trello-card",
		path: note.path,
		cardId: card.id,
		previous: { idLabels: (card.labels ?? []).map((label) => label.id) },
		written: { idLabels },
	});
}

/**
 * Converges labels in `merge` mode: both sides move to their union, independently
 * of whatever direction was decided for title/body/due — a name typed on either
 * side is never lost. No-op under `overwrite` mode, where labels instead ride
 * the pull/push branches below like `due` does.
 */
async function convergeLabelsOnMerge(
	vault: VaultGateway,
	client: TrelloClient,
	note: NoteHandle,
	card: TrelloCard,
	localLabels: string[],
	remoteLabels: string[],
	labelsKey: string,
	onTrelloWrite: NoteSyncOptions["onTrelloWrite"],
	signal?: AbortSignal,
): Promise<boolean> {
	const { nextLocal, nextRemote } = resolveLabelSync(localLabels, remoteLabels, "merge", "pull");
	const writeLocal = nextLocal !== null && !signal?.aborted;
	if (writeLocal) await writeLocalLabels(vault, note, nextLocal, labelsKey);
	if (nextRemote !== null) await pushRemoteLabels(client, note, card, nextRemote, onTrelloWrite, signal);
	return writeLocal;
}

/** Order-sensitive equality — attachment/linked-card lists follow Trello's own order, never sorted. */
function sameOrderedList(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Logs a best-effort failure from a `converge*` step, unless it was the
 * aborting signal itself that caused the failure — a cancelled undo/sync is
 * not an error, and warning about it would be misleading (constat 5 of the
 * 2026-09-14 manual test).
 */
function warnUnlessAborted(signal: AbortSignal | undefined, message: string): void {
	if (!signal?.aborted) console.warn(message);
}

/**
 * Converges a note's attachment-derived frontmatter (plain urls + linked-card
 * wikilinks) from the card's current attachments. Pull-only, independent of
 * whatever direction was decided for title/body/due — same hook point as
 * `convergeLabelsOnMerge`, runs even when that direction is "skip"/"conflict".
 * The attachment list rides the card when it was fetched with them
 * (`cardIncludesFor`), otherwise it costs its own Trello request; either way a
 * failure is treated as best-effort: logged to the console and otherwise ignored, the
 * same non-fatal treatment `resolveLabelIds` already gives an unmatched label
 * name — not reported through `Reporter`/`NoteSyncResult`, so it stays
 * invisible in the progress panel (a known, pre-existing limitation of that
 * console.warn pattern, not something this feature was meant to fix).
 */
async function convergeAttachments(
	vault: VaultGateway,
	client: TrelloClient,
	note: NoteHandle,
	card: TrelloCard,
	cardIndex: Map<string, NoteHandle>,
	attachmentsKey: string,
	linkedCardsKey: string,
	syncLinkedCards: boolean,
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		if (signal?.aborted) return false;
		const { urls, linkedCards } = await resolveAttachments(client, card.id, cardIndex, signal, card.attachments);
		const frontmatter = vault.readFrontmatter(note);
		const currentUrls = parseAttachmentsRef(frontmatter?.[attachmentsKey]);
		const currentLinkedCards = syncLinkedCards ? parseLinkedCardsRef(frontmatter?.[linkedCardsKey]) : [];
		const nextLinkedCards = syncLinkedCards ? linkedCards : [];
		if (sameOrderedList(currentUrls, urls) && sameOrderedList(currentLinkedCards, nextLinkedCards)) return false;
		if (signal?.aborted) return false;

		await vault.writeFrontmatter(note, (fm) => {
			const formattedUrls = formatAttachmentsRef(urls);
			if (formattedUrls === null) delete fm[attachmentsKey];
			else fm[attachmentsKey] = formattedUrls;

			if (syncLinkedCards) {
				const formattedLinkedCards = formatLinkedCardsRef(linkedCards);
				if (formattedLinkedCards === null) delete fm[linkedCardsKey];
				else fm[linkedCardsKey] = formattedLinkedCards;
			}
		});
		return true;
	} catch (error) {
		warnUnlessAborted(
			signal,
			`[trello-vault-sync] Could not sync attachments for card "${card.name}" (${card.id}): ${errorMessage(error)}`,
		);
		// A write interrupted by the failure may still have landed — never trust the caller's snapshot then.
		return true;
	}
}

/**
 * Converges a note's checklist section from the card's current checklists.
 * Same hook point and failure handling as `convergeAttachments` — runs
 * independently of the title/body/due direction (a checkbox toggle must reach
 * Trello even when that direction is "skip"), never throws.
 *
 * Obsidian wins the checked state of an item known to both sides (pushed via
 * `resolveChecklists`'s `pushes`); Trello wins which items/checklists exist at
 * all, so the section is always rewritten to Trello's own structure — see
 * `resolveChecklists` for the full reconciliation rule. `content` is the note's
 * current text, already read by the caller. Returns whether the note may have changed.
 */
async function convergeChecklists(
	vault: VaultGateway,
	client: TrelloClient,
	note: NoteHandle,
	card: TrelloCard,
	heading: string,
	content: string,
	onTrelloWrite: NoteSyncOptions["onTrelloWrite"],
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		if (signal?.aborted) return false;
		const fullBody = extractBody(content);
		const { rest: description, checklistBlock } = splitChecklistSection(fullBody, heading);

		const remoteChecklists = orderedChecklists(card.checklists ?? (await client.getCardChecklists(card.id, signal)));
		const { markdown, pushes } = resolveChecklists(remoteChecklists, checklistBlock, heading);
		const remoteStateById = new Map(
			remoteChecklists.flatMap((group) => group.checkItems.map((item) => [item.id, item.state] as const)),
		);

		for (const push of pushes) {
			if (signal?.aborted) break;
			await client.updateCheckItemState(card.id, push.checkItemId, push.state, signal);
			const previousState = remoteStateById.get(push.checkItemId) ?? (push.state === "complete" ? "incomplete" : "complete");
			onTrelloWrite?.({
				kind: "trello-checkitem",
				path: note.path,
				cardId: card.id,
				checkItemId: push.checkItemId,
				previousState,
				writtenState: push.state,
			});
		}

		if (signal?.aborted) return false;
		if (markdown === checklistBlock) return false;
		const nextContent = replaceBody(content, insertChecklistSection(description, markdown));
		if (nextContent === content) return false;
		await vault.write(note, nextContent);
		return true;
	} catch (error) {
		warnUnlessAborted(
			signal,
			`[trello-vault-sync] Could not sync checklists for card "${card.name}" (${card.id}): ${errorMessage(error)}`,
		);
		return true;
	}
}

/**
 * Converges a note's cover-image frontmatter key from the card's own cover —
 * pull-only, no network call of its own (`cover` rides the already-fetched
 * card), so unlike `convergeAttachments`/`convergeChecklists` this never needs
 * a try/catch around it. Deletes the key when the card has no image cover
 * (a plain color, or nothing set) instead of leaving a stale url behind.
 * When `preferLocalCover` is enabled and a matching downloaded cover exists in the
 * vault, writes its local link (vault path or wikilink) instead of the remote url.
 */
async function convergeCover(
	vault: VaultGateway,
	client: TrelloClient,
	note: NoteHandle,
	card: TrelloCard,
	coverKey: string,
	options?: {
		preferLocalCover?: boolean;
		coverLocalFormat?: CoverLocalFormat;
		attachmentsDestination?: AttachmentsDestination;
		attachmentsFolder?: string;
	},
	signal?: AbortSignal,
): Promise<boolean> {
	let desired: string | null = null;
	if (options?.preferLocalCover && card.cover?.idAttachment) {
		let attachments = card.attachments;
		if (!attachments) {
			try {
				attachments = await client.getCardAttachments(card.id, signal);
				card.attachments = attachments;
			} catch {
				attachments = undefined;
			}
		}
		const coverAttachment = attachments?.find((a) => a.id === card.cover?.idAttachment);
		if (coverAttachment) {
			const destination = options.attachmentsDestination ?? "note-folder";
			const globalFolder = options.attachmentsFolder ?? "";
			const planned = resolveAttachmentPath(coverAttachment.name, {
				destination,
				noteFolder: note.folder,
				globalFolder,
			});
			if (planned.ok && vault.binarySize(planned.path) !== null) {
				desired =
					options.coverLocalFormat === "wikilink"
						? formatWikilink(planned.path)
						: planned.path;
			}
		}
	}
	if (desired === null) {
		desired = coverImageUrl(card.cover);
	}
	const current = vault.readFrontmatter(note)?.[coverKey];
	if (current === desired || (desired === null && current === undefined)) return false;
	if (signal?.aborted) return false;
	await vault.writeFrontmatter(note, (frontmatter) => {
		if (desired === null) delete frontmatter[coverKey];
		else frontmatter[coverKey] = desired;
	});
	return true;
}

/** id → display name, preferring the full name (a member with none set falls back to their username). Exported so `syncFolder`/`syncVault` can build it once per run, the same way `attachmentSync.ts::buildCardIndex` is shared. */
export function buildMemberDirectory(members: readonly TrelloMember[]): Map<string, string> {
	return new Map(members.map((member) => [member.id, member.fullName.trim() || member.username]));
}

/**
 * Converges a note's assigned-members frontmatter key from the card's
 * `idMembers`, resolved against the board's member directory — pull-only,
 * like `convergeAttachments`. The directory is fetched once per run by the
 * caller (`syncFolder`/`syncVault`) and passed in; built lazily here (one
 * extra `getBoardMembers` call) only when omitted, e.g. a lone `syncNote`
 * call for a single note. Never throws.
 */
async function convergeMembers(
	vault: VaultGateway,
	client: TrelloClient,
	note: NoteHandle,
	card: TrelloCard,
	membersKey: string,
	directory?: Map<string, string>,
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		if (signal?.aborted) return false;
		const table = directory ?? buildMemberDirectory(await client.getBoardMembers(card.idBoard, signal));
		const names = resolveMemberNames(card.idMembers ?? [], table, (id) =>
			console.warn(
				`[trello-vault-sync] Member "${id}" on card "${card.name}" (${card.id}) is no longer on the board — omitted.`,
			),
		);
		const current = parseMembersRef(vault.readFrontmatter(note)?.[membersKey]);
		if (sameOrderedList(current, names)) return false;
		if (signal?.aborted) return false;

		await vault.writeFrontmatter(note, (frontmatter) => {
			const formatted = formatMembersRef(names);
			if (formatted === null) delete frontmatter[membersKey];
			else frontmatter[membersKey] = formatted;
		});
		return true;
	} catch (error) {
		warnUnlessAborted(
			signal,
			`[trello-vault-sync] Could not sync members for card "${card.name}" (${card.id}): ${errorMessage(error)}`,
		);
		return true;
	}
}

/** id → definition, with a "list" field's options pre-resolved to id→text — exported so `syncFolder`/`syncVault` can build it once per run, the same way `buildMemberDirectory` is shared. */
export function buildCustomFieldDefinitions(
	definitions: readonly TrelloCustomFieldDefinition[],
): Map<string, CustomFieldDefinitionLike> {
	return new Map(
		definitions.map((def) => [
			def.id,
			{
				id: def.id,
				name: def.name,
				type: def.type,
				options: def.options ? new Map(def.options.map((option) => [option.id, option.value.text])) : undefined,
			},
		]),
	);
}

/** Shallow key/value equality on a flat record — the custom-fields object never nests. */
function sameRecord(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}

/**
 * Converges a note's custom-fields frontmatter key from the card's
 * `customFieldItems`, resolved against the board's field-definition
 * directory — pull-only, like `convergeMembers`. No extra Trello request for
 * the values themselves (they ride the already-fetched card); only the
 * definition directory costs one request, fetched once per run by the caller
 * and passed in, or built lazily here when omitted. Never throws.
 */
async function convergeCustomFields(
	vault: VaultGateway,
	client: TrelloClient,
	note: NoteHandle,
	card: TrelloCard,
	customFieldsKey: string,
	definitions?: Map<string, CustomFieldDefinitionLike>,
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		if (signal?.aborted) return false;
		const table = definitions ?? buildCustomFieldDefinitions(await client.getBoardCustomFields(card.idBoard, signal));
		const resolved = resolveCustomFields(card.customFieldItems ?? [], table, (id) =>
			console.warn(
				`[trello-vault-sync] Custom field "${id}" on card "${card.name}" (${card.id}) is no longer on the board — omitted.`,
			),
		);
		const current = parseCustomFieldsRef(vault.readFrontmatter(note)?.[customFieldsKey]);
		if (sameRecord(current, resolved)) return false;
		if (signal?.aborted) return false;

		await vault.writeFrontmatter(note, (frontmatter) => {
			const formatted = formatCustomFieldsRef(resolved);
			if (formatted === null) delete frontmatter[customFieldsKey];
			else frontmatter[customFieldsKey] = formatted;
		});
		return true;
	} catch (error) {
		warnUnlessAborted(
			signal,
			`[trello-vault-sync] Could not sync custom fields for card "${card.name}" (${card.id}): ${errorMessage(error)}`,
		);
		return true;
	}
}

/**
 * Downloads the card's uploaded attachments into the vault — off by default.
 * Reuses the attachment list embedded in the card when present; otherwise its
 * own `getCardAttachments` call, independent of `syncAttachments`'s own fetch of
 * the same endpoint (two calls with both on, only when embedding is off).
 * Never throws — a failure here must not fail the rest of the note's sync.
 */
async function convergeAttachmentDownloads(
	vault: VaultGateway,
	client: TrelloClient,
	note: NoteHandle,
	card: TrelloCard,
	destination: AttachmentsDestination,
	globalFolder: string,
	scope: AttachmentsDownloadScope,
	fetchBinary: (url: string, signal?: AbortSignal) => Promise<ArrayBuffer | null>,
	signal?: AbortSignal,
): Promise<void> {
	try {
		if (signal?.aborted) return;
		// No image cover at all — nothing a "cover-only" run could ever download,
		// so skip the attachments fetch entirely rather than spending a Trello
		// request just to filter its result down to nothing.
		if (scope === "cover-only" && !card.cover?.idAttachment) return;
		const attachments = card.attachments ?? (await client.getCardAttachments(card.id, signal));
		if (!card.attachments) {
			card.attachments = attachments;
		}
		if (signal?.aborted) return;
		const toDownload =
			scope === "cover-only" ? attachments.filter((a) => a.id === card.cover?.idAttachment) : attachments;
		const result = await downloadAttachments(toDownload, { destination, noteFolder: note.folder, globalFolder }, {
			binarySize: (path) => vault.binarySize(path),
			writeBinary: (path, data) => vault.writeBinary(path, data),
			fetchBinary: (url) => fetchBinary(url, signal),
			redact: (text) => client.redactOwnSecrets(text),
		}, signal);
		for (const message of result.errors) {
			console.warn(`[trello-vault-sync] ${message}`);
		}
	} catch (error) {
		warnUnlessAborted(
			signal,
			`[trello-vault-sync] Could not download attachments for card "${card.name}" (${card.id}): ${client.redactOwnSecrets(errorMessage(error))}`,
		);
	}
}

/** Sync one note against a card that has already been fetched. */
export async function syncNoteWithCard(
	vault: VaultGateway & CardRefStore,
	client: TrelloClient,
	note: NoteHandle,
	card: TrelloCard,
	options: NoteSyncOptions,
	/** Pre-built vault-wide card index for resolving card-link attachments — built lazily (one extra vault scan) when omitted. */
	cardIndex?: Map<string, NoteHandle>,
	/** Pre-built board member id→name directory — built lazily (one extra `getBoardMembers` call) when omitted. Shared by a run's every note, exactly like `cardIndex`. */
	memberDirectory?: Map<string, string>,
	/** Pre-built board custom-field definition directory — built lazily (one extra `getBoardCustomFields` call) when omitted. Shared by a run's every note, exactly like `memberDirectory`. */
	customFieldDefinitions?: Map<string, CustomFieldDefinitionLike>,
	signal?: AbortSignal,
): Promise<NoteSyncResult> {
	if (signal?.aborted) {
		return { direction: "skip", renamed: false, note, reason: "aborted" };
	}
	const dueKey = options.dueFrontmatterKey ?? DEFAULT_DUE_KEY;
	const labelsKey = options.labelsFrontmatterKey ?? DEFAULT_LABELS_KEY;
	const syncChecklists = options.syncChecklists ?? DEFAULT_SYNC_CHECKLISTS;
	const checklistHeading = options.checklistHeading ?? DEFAULT_CHECKLIST_HEADING;
	let content = await vault.read(note);
	// Always split off the checklist section, whether or not `syncChecklists` is
	// currently on: the heading marks plugin-managed content that was never part
	// of the Trello description, and a note can carry a leftover section from
	// when the toggle was on. Only the active reconciliation against Trello's
	// own checklists (below) is gated by the setting.
	const localBody = extractBody(content, checklistHeading);
	const localDue = parseDueRef(vault.readFrontmatter(note)?.[dueKey]);
	const localLabels = parseLabelsRef(vault.readFrontmatter(note)?.[labelsKey]);
	const remoteLabels = remoteLabelsOf(card);
	const labelsSyncMode = options.labelsSyncMode ?? DEFAULT_LABELS_SYNC_MODE;

	const decision = decideForCard(note, card, localBody, options, localDue, localLabels);
	// `decision.direction === "skip"` only ever means "identical" (see
	// `core/syncDecision.ts`) — even a forced pull/push must not overwrite
	// either side, or bump a note's mtime, when there is genuinely nothing to
	// change (the "identical = no-op" guarantee force pull/push relies on).
	const direction = decision.direction === "skip" ? "skip" : (options.force ?? decision.direction);

	const syncDescription = options.syncDescription !== false;
	const syncDue = options.syncDue !== false;
	const syncLabels = options.syncLabels !== false;

	// Independent of the direction decided above for title/body/due — each step
	// below can write the note, and runs even when that direction ends up "skip"
	// or "conflict". `stale` tracks whether `content` may no longer match the file:
	// the checklist step and the pull branch rebuild the whole file from `content`,
	// and a stale snapshot would silently undo a write made before them. The note
	// is re-read only then — never after a step that wrote nothing.
	let stale = false;
	if (syncLabels && labelsSyncMode === "merge" && !options.dryRun && !signal?.aborted) {
		const wrote = await convergeLabelsOnMerge(vault, client, note, card, localLabels, remoteLabels, labelsKey, options.onTrelloWrite, signal);
		stale = stale || wrote;
	}

	const syncAttachments = options.syncAttachments ?? DEFAULT_SYNC_ATTACHMENTS;
	if (syncAttachments && !options.dryRun && !signal?.aborted) {
		const attachmentsKey = options.attachmentsFrontmatterKey ?? DEFAULT_ATTACHMENTS_KEY;
		const linkedCardsKey = options.linkedCardsFrontmatterKey ?? DEFAULT_LINKED_CARDS_KEY;
		const syncLinkedCards = options.syncLinkedCards ?? DEFAULT_SYNC_LINKED_CARDS;
		const wrote = await convergeAttachments(
			vault,
			client,
			note,
			card,
			cardIndex ?? buildCardIndex(vault, vault.listNotes("")),
			attachmentsKey,
			linkedCardsKey,
			syncLinkedCards,
			signal,
		);
		stale = stale || wrote;
	}

	if (syncChecklists && !options.dryRun && !signal?.aborted) {
		if (stale) {
			content = await vault.read(note);
			stale = false;
		}
		stale = await convergeChecklists(vault, client, note, card, checklistHeading, content, options.onTrelloWrite, signal);
	}

	if (options.downloadAttachments && !options.dryRun && !signal?.aborted) {
		if (options.fetchBinary) {
			await convergeAttachmentDownloads(
				vault,
				client,
				note,
				card,
				options.attachmentsDestination ?? "note-folder",
				options.attachmentsFolder ?? "",
				options.attachmentsDownloadScope ?? "all",
				options.fetchBinary,
				signal,
			);
		} else {
			console.warn(
				`[trello-vault-sync] Attachment download is enabled but no downloader was wired — skipped for "${card.name}".`,
			);
		}
	}

	const syncCardCover = options.syncCardCover ?? DEFAULT_SYNC_CARD_COVER;
	if (syncCardCover && !options.dryRun && !signal?.aborted) {
		const wrote = await convergeCover(
			vault,
			client,
			note,
			card,
			options.coverFrontmatterKey ?? DEFAULT_COVER_KEY,
			{
				preferLocalCover: options.preferLocalCover ?? DEFAULT_PREFER_LOCAL_COVER,
				coverLocalFormat: options.coverLocalFormat ?? DEFAULT_COVER_LOCAL_FORMAT,
				attachmentsDestination: options.attachmentsDestination,
				attachmentsFolder: options.attachmentsFolder,
			},
			signal,
		);
		stale = stale || wrote;
	}

	const syncMembers = options.syncMembers ?? DEFAULT_SYNC_MEMBERS;
	if (syncMembers && !options.dryRun && !signal?.aborted) {
		const wrote = await convergeMembers(
			vault,
			client,
			note,
			card,
			options.membersFrontmatterKey ?? DEFAULT_MEMBERS_KEY,
			memberDirectory,
			signal,
		);
		stale = stale || wrote;
	}

	const syncCustomFields = options.syncCustomFields ?? DEFAULT_SYNC_CUSTOM_FIELDS;
	if (syncCustomFields && !options.dryRun && !signal?.aborted) {
		const wrote = await convergeCustomFields(
			vault,
			client,
			note,
			card,
			options.customFieldsFrontmatterKey ?? DEFAULT_CUSTOM_FIELDS_KEY,
			customFieldDefinitions,
			signal,
		);
		stale = stale || wrote;
	}

	if (stale) content = await vault.read(note);

	if (direction === "skip" || direction === "conflict") {
		return { direction, renamed: false, note, reason: decision.reason };
	}

	if (options.dryRun) {
		return { direction, renamed: false, note, reason: `${decision.reason} (simulation)` };
	}

	if (signal?.aborted) {
		return { direction, renamed: false, note, reason: `${decision.reason} (aborted)` };
	}

	if (direction === "pull") {
		let current = note;
		if (syncDescription) {
			// Same reasoning as `localBody` above: preserve a leftover checklist
			// section on pull regardless of `syncChecklists`, so turning the toggle
			// off never destroys it.
			const nextContent = replaceBody(content, card.desc ?? "", checklistHeading);
			if (nextContent !== content && !signal?.aborted) await vault.write(current, nextContent);
		}

		if (syncDue && decision.dueChanged && !signal?.aborted) {
			await vault.writeFrontmatter(current, (frontmatter) => {
				const formatted = formatDueRef(card.due);
				if (formatted === null) delete frontmatter[dueKey];
				else frontmatter[dueKey] = formatted;
			});
		}

		if (syncLabels && labelsSyncMode === "overwrite" && !signal?.aborted) {
			const { nextLocal } = resolveLabelSync(localLabels, remoteLabels, "overwrite", "pull");
			if (nextLocal !== null) await writeLocalLabels(vault, current, nextLocal, labelsKey);
		}

		let renamed = false;
		if (options.syncTitle && sanitizeFileName(card.name) !== current.basename && !signal?.aborted) {
			const target = uniqueNotePath(
				current.folder,
				sanitizeFileName(card.name),
				(path) => vault.exists(path),
				current.path,
			);
			if (target !== current.path) {
				current = await vault.rename(current, target);
				renamed = true;
			}
		}
		return { direction, renamed, note: current, reason: decision.reason };
	}

	const fields: { name?: string; desc?: string; due?: string | null; idLabels?: string[] } = {};
	if (syncDescription) fields.desc = localBody;
	if (options.syncTitle && decision.titleChanged) fields.name = note.basename;
	if (syncDue && decision.dueChanged) fields.due = localDue;
	if (syncLabels && labelsSyncMode === "overwrite") {
		const { nextRemote } = resolveLabelSync(localLabels, remoteLabels, "overwrite", "push");
		if (nextRemote !== null) fields.idLabels = await resolveLabelIdsForCard(client, card, nextRemote, signal);
	}
	if (signal?.aborted) {
		return { direction, renamed: false, note, reason: `${decision.reason} (aborted)` };
	}
	if (Object.keys(fields).length > 0) {
		await client.updateCard(card.id, fields, signal);
		if (options.onTrelloWrite) {
			const previous: TrelloCardUpdateAction["previous"] = {};
			if (fields.name !== undefined) previous.name = card.name;
			if (fields.desc !== undefined) previous.desc = card.desc;
			if (fields.due !== undefined) previous.due = card.due;
			if (fields.idLabels !== undefined) previous.idLabels = (card.labels ?? []).map((label) => label.id);
			options.onTrelloWrite({ kind: "trello-card", path: note.path, cardId: card.id, previous, written: fields });
		}
	}
	return { direction, renamed: false, note, reason: decision.reason };
}

/** Sync one note, fetching its card first. */
export async function syncNote(
	vault: VaultGateway & CardRefStore,
	client: TrelloClient,
	note: NoteHandle,
	options: NoteSyncOptions,
	signal?: AbortSignal,
): Promise<NoteSyncResult> {
	// "skip", never "unlinked": a cancelled run has not established anything
	// about the note's card link, and `noteCommands.syncActive` reports
	// "unlinked" to the user as "Not linked to a Trello card."
	if (signal?.aborted) {
		return { direction: "skip", renamed: false, note, reason: "aborted" };
	}
	const ref = vault.getCardRef(note);
	if (!ref) {
		return { direction: "unlinked", renamed: false, note, reason: "no card id" };
	}
	const card = await client.getCard(ref.cardId, signal, cardIncludesFor(options));
	return syncNoteWithCard(vault, client, note, card, options, undefined, undefined, undefined, signal);
}
