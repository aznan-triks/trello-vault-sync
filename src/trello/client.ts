/**
 * Trello REST access, transport-agnostic.
 *
 * The HTTP call is injected so the whole retry / redaction / parsing surface is
 * unit-testable, and so the plugin can use Obsidian's `requestUrl` (no CORS, and
 * it works on mobile) without this file importing Obsidian.
 */

import type { TrelloAction } from "../core/auditAction";
import { errorMessage } from "../core/errorMessage";

export interface TrelloCredentials {
	apiKey: string;
	token: string;
}

export interface HttpRequest {
	url: string;
	method: "GET" | "PUT" | "POST";
	body?: string;
	contentType?: string;
}

export interface HttpResponse {
	status: number;
	text: string;
	headers?: Record<string, string>;
}

export type Transport = (request: HttpRequest, signal?: AbortSignal) => Promise<HttpResponse>;

export interface TrelloChecklistItem {
	id: string;
	name: string;
	state: "complete" | "incomplete";
	/** Trello's own ordering key — used to keep item order stable whichever request returned the checklist. */
	pos?: number;
}

export interface TrelloChecklist {
	id: string;
	name: string;
	/** Trello's own ordering key, see `TrelloChecklistItem.pos`. */
	pos?: number;
	checkItems: TrelloChecklistItem[];
}

export interface TrelloAttachment {
	id: string;
	name: string;
	url: string;
	isUpload: boolean;
	/** File size in bytes — `null`/missing for a link attachment, or an old upload Trello never recorded a size for. */
	bytes?: number | null;
}

export interface TrelloLabel {
	id: string;
	name: string;
	color: string | null;
}

/** A card's cover, requested via `cover_scaled=true` — only the "is it an image, and how big" subset this plugin reads. */
export interface TrelloCardCover {
	idAttachment: string | null;
	scaled?: { url: string; width: number }[];
}

export interface TrelloCard {
	id: string;
	idBoard: string;
	name: string;
	desc: string;
	url: string;
	dateLastActivity: string;
	idList?: string;
	closed?: boolean;
	due: string | null;
	/** Optional so `PlannedCard` (a deliberate subset used by the folder planner, out of this feature's scope) keeps satisfying this shape unchanged. */
	labels?: TrelloLabel[];
	/** `null`/missing when the card has no cover (a plain color cover carries no `scaled` images — see `core/attachmentRef.ts::coverImageUrl`). */
	cover?: TrelloCardCover | null;
	/** Ids of the card's assigned members — resolved to names via `getBoardMembers`, see `core/memberRef.ts`. */
	idMembers?: string[];
	/** The card's custom-field values, requested via `customFieldItems=true` — resolved against `getBoardCustomFields`, see `core/customFieldRef.ts`. */
	customFieldItems?: TrelloCustomFieldItem[];
	/** Present only when the card was fetched with `includes.attachments` — `undefined` means "not fetched", never "no attachments". */
	attachments?: TrelloAttachment[];
	/** Present only when the card was fetched with `includes.checklists` — `undefined` means "not fetched", never "no checklists". */
	checklists?: TrelloChecklist[];
}

/** Card details embedded in a card request instead of one extra request per card. */
export interface CardIncludes {
	attachments: boolean;
	checklists: boolean;
}

export interface TrelloCustomFieldItem {
	idCustomField: string;
	/** For a "list"-type field: the chosen option's id. */
	idValue?: string;
	value?: { text?: string; number?: string; checked?: string; date?: string };
}

export interface CreateCardFields {
	idList: string;
	name: string;
	desc?: string;
	due?: string | null;
	idLabels?: string[];
	pos?: "top" | "bottom" | number;
}

export interface TrelloCustomFieldOption {
	id: string;
	value: { text: string };
}

export interface TrelloCustomFieldDefinition {
	id: string;
	name: string;
	type: "text" | "number" | "date" | "checkbox" | "list";
	/** Only present for a "list"-type field. */
	options?: TrelloCustomFieldOption[];
}

export interface TrelloMember {
	id: string;
	fullName: string;
	username: string;
}

export interface TrelloList {
	id: string;
	name: string;
}

export interface TrelloComment {
	id: string;
	date: string;
	idMemberCreator: string;
	data: { text: string };
	memberCreator?: { fullName: string; avatarUrl?: string | null };
}

/** A card with everything the card view shows, fetched in one request. */
export interface TrelloCardView extends TrelloCard {
	list?: TrelloList;
	members?: TrelloMember[];
	/** Comments only (`actions=commentCard`), newest first. */
	actions?: TrelloComment[];
	dueComplete?: boolean;
	start?: string | null;
}

/** The value of one custom-field item as Trello expects it; `null` clears the field. */
export type CustomFieldValue =
	| { text: string }
	| { number: string }
	| { date: string }
	| { checked: "true" | "false" }
	| { idValue: string }
	| null;

export interface TrelloBoard {
	id: string;
	name: string;
}

/** Trello wants a "list" choice as `{ idValue }` and any other value wrapped in `{ value }`; both fields empty clears it. */
function customFieldBody(value: CustomFieldValue): object {
	if (value === null) return { value: "", idValue: "" };
	return "idValue" in value ? value : { value };
}

export class TrelloError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly retryable: boolean,
	) {
		super(message);
		this.name = "TrelloError";
	}
}

/** Details of one retry, reported before the wait so a caller can surface it live. */
export interface RetryInfo {
	/** 1-based index of the attempt about to run. */
	attempt: number;
	maxAttempts: number;
	delayMs: number;
	/** 0 for a transport-level failure (no HTTP response was received). */
	status: number;
}

export interface TrelloClientOptions {
	maxRetries?: number;
	baseDelayMs?: number;
	/** Ceiling on a single retry wait, independent of maxRetries/baseDelayMs or a Retry-After header. */
	maxBackoffDelayMs?: number;
	sleep?: (ms: number) => Promise<void>;
	/** Called right before each retry's wait — lets the caller show live progress. */
	onRetry?: (info: RetryInfo) => void;
	/** Per-attempt timeout — a request that outlives this is treated as a transport-level failure (retryable), same path as a 5xx. */
	requestTimeoutMs?: number;
	/** HTTP statuses that are retried. Default: `DEFAULT_RETRYABLE_STATUS_CODES`. */
	retryableStatusCodes?: readonly number[];
	/** Actions asked per call of `getActions`. Default (and Trello's maximum): `DEFAULT_ACTIONS_PAGE_LIMIT`. */
	actionsPageLimit?: number;
}

const API_ROOT = "https://api.trello.com/1";
/**
 * `fields: "all"` rather than a whitelist — confirmed by hand (2026-09-16) that Trello's API
 * silently drops `cover.scaled` (the image renditions `coverImageUrl` needs) whenever `fields`
 * names anything less than `all`, `cover_scaled=true` or not. A restricted `fields` list used to
 * sit here; it shrank the payload but made every synced cover a dead url. See
 * audits/AUDIT_cover-scaled-fields.md.
 */
const CARD_FIELDS = "all";
/** Only the display name is used — id is always returned regardless of `fields`. */
const MEMBER_FIELDS = "fullName,username";
/** Belt-and-suspenders alongside `fields: "all"` above — costs nothing extra once `fields` already returns everything. */
const CARD_COVER_PARAMS = { cover_scaled: "true" };
/** Without this, `TrelloCard.customFieldItems` is always omitted — a card's custom-field values travel with the card only when explicitly requested. */
const CARD_CUSTOM_FIELD_PARAMS = { customFieldItems: "true" };
/** Only the type and (for a "list" field) its options are used — id/name are always returned regardless of `fields`. */
const CUSTOM_FIELD_FIELDS = "name,type";
/** Only the name and color are used — id is always returned regardless of `fields`. */
const LABEL_FIELDS = "name,color";
/** id is always returned regardless of `fields`. `bytes` lets a download be skipped before ever fetching it (see `features/attachmentDownload.ts`). */
const ATTACHMENT_FIELDS = "name,url,isUpload,bytes";
/** id is always returned on both the checklist and its items, regardless of `fields`/`checkItem_fields`. */
const CHECKLIST_FIELDS = "name,pos";
const CHECK_ITEM_FIELDS = "name,state,pos";

/** Query parameters embedding attachments/checklists in a card request — same field lists as the per-card endpoints, so both paths return the same shape. */
function includeParams(includes?: CardIncludes): Record<string, string> {
	const params: Record<string, string> = {};
	if (includes?.attachments) {
		params.attachments = "true";
		params.attachment_fields = ATTACHMENT_FIELDS;
	}
	if (includes?.checklists) {
		params.checklists = "all";
		params.checklist_fields = CHECKLIST_FIELDS;
		params.checkItem_fields = CHECK_ITEM_FIELDS;
	}
	return params;
}

/** Status codes that are retried unless the caller says otherwise. */
export const DEFAULT_RETRYABLE_STATUS_CODES: readonly number[] = [408, 429, 500, 502, 503, 504];
/** Trello's own maximum for one page of actions (no automatic multi-page walk). */
export const DEFAULT_ACTIONS_PAGE_LIMIT = 1000;
/** Extra fields requested on `memberCreator` — `avatarUrl` lets the HTML export show who did what without a separate per-member call. */
const MEMBER_CREATOR_FIELDS = "avatarUrl,fullName";

/** `window` under Obsidian (pop-out windows own their timers), `globalThis` under the Node test run. */
const timers: { setTimeout: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => number } =
	typeof window !== "undefined"
		? window
		: (typeof globalThis !== "undefined" ? globalThis : ({} as Window));

const defaultSleep = (ms: number) => new Promise<void>((resolve) => timers.setTimeout(resolve, ms));

/** Replace every occurrence of a secret with a marker, for logs and errors — exported so a caller building its own error message from an already-authenticated url (e.g. `features/attachmentDownload.ts`) can mask the same credentials without needing a `TrelloClient` instance. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
	let out = text;
	for (const secret of secrets) {
		if (secret.length >= 4) out = out.split(secret).join("«masked»");
	}
	return out;
}

export class TrelloClient {
	private readonly maxRetries: number;
	private readonly baseDelayMs: number;
	private readonly maxBackoffDelayMs: number;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly onRetry?: (info: RetryInfo) => void;
	private readonly requestTimeoutMs: number;
	private readonly retryable: ReadonlySet<number>;
	private readonly actionsPageLimit: number;

	constructor(
		private readonly credentials: TrelloCredentials,
		private readonly transport: Transport,
		options: TrelloClientOptions = {},
	) {
		this.maxRetries = options.maxRetries ?? 3;
		this.baseDelayMs = options.baseDelayMs ?? 800;
		this.maxBackoffDelayMs = options.maxBackoffDelayMs ?? 30_000;
		this.sleep = options.sleep ?? defaultSleep;
		this.onRetry = options.onRetry;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
		this.retryable = new Set(options.retryableStatusCodes ?? DEFAULT_RETRYABLE_STATUS_CODES);
		this.actionsPageLimit = options.actionsPageLimit ?? DEFAULT_ACTIONS_PAGE_LIMIT;
	}

	/** True when both halves of the single configured credential pair are present. */
	get configured(): boolean {
		return this.credentials.apiKey.trim() !== "" && this.credentials.token.trim() !== "";
	}

	async getCard(cardId: string, signal?: AbortSignal, includes?: CardIncludes): Promise<TrelloCard> {
		return this.json<TrelloCard>(
			`/cards/${encodeURIComponent(cardId)}`,
			{ fields: CARD_FIELDS, ...CARD_COVER_PARAMS, ...CARD_CUSTOM_FIELD_PARAMS, ...includeParams(includes) },
			signal,
		);
	}

	/** `filter: "all"` includes archived (closed) cards, which "visible" (the default) excludes. */
	async getBoardCards(
		boardId: string,
		filter: "visible" | "all" = "visible",
		signal?: AbortSignal,
		includes?: CardIncludes,
	): Promise<TrelloCard[]> {
		return this.json<TrelloCard[]>(
			`/boards/${encodeURIComponent(boardId)}/cards`,
			{ fields: CARD_FIELDS, filter, ...CARD_COVER_PARAMS, ...CARD_CUSTOM_FIELD_PARAMS, ...includeParams(includes) },
			signal,
		);
	}

	/**
	 * Open boards the current token's owner is a member of — lets the settings
	 * tab offer a picker instead of a raw id field. `filter: "open"` because the
	 * Trello API defaults this endpoint to "all", which includes closed boards
	 * a user picking a board to sync almost never wants to see.
	 */
	async getMyBoards(signal?: AbortSignal): Promise<TrelloBoard[]> {
		return this.json<TrelloBoard[]>("/members/me/boards", { fields: "name", filter: "open" }, signal);
	}

	async getBoardLists(boardId: string, signal?: AbortSignal): Promise<TrelloList[]> {
		return this.json<TrelloList[]>(`/boards/${encodeURIComponent(boardId)}/lists`, { fields: "name" }, signal);
	}

	/** The board's full label catalog — needed to resolve a name typed in the frontmatter to an id. */
	async getBoardLabels(boardId: string, signal?: AbortSignal): Promise<TrelloLabel[]> {
		return this.json<TrelloLabel[]>(
			`/boards/${encodeURIComponent(boardId)}/labels`,
			{ fields: LABEL_FIELDS },
			signal,
		);
	}

	/** The board's member directory — needed to resolve a card's `idMembers` to display names. One call per run, not per note (see `features/syncNote.ts::convergeMembers`). */
	async getBoardMembers(boardId: string, signal?: AbortSignal): Promise<TrelloMember[]> {
		return this.json<TrelloMember[]>(
			`/boards/${encodeURIComponent(boardId)}/members`,
			{ fields: MEMBER_FIELDS },
			signal,
		);
	}

	/** The board's custom-field definitions — needed to resolve a card's `customFieldItems` (raw ids/values) to a name and a typed value. One call per run, not per note (see `features/syncNote.ts::convergeCustomFields`). */
	async getBoardCustomFields(boardId: string, signal?: AbortSignal): Promise<TrelloCustomFieldDefinition[]> {
		return this.json<TrelloCustomFieldDefinition[]>(
			`/boards/${encodeURIComponent(boardId)}/customFields`,
			{ fields: CUSTOM_FIELD_FIELDS },
			signal,
		);
	}

	async getListCards(listId: string, signal?: AbortSignal, includes?: CardIncludes): Promise<TrelloCard[]> {
		return this.json<TrelloCard[]>(
			`/lists/${encodeURIComponent(listId)}/cards`,
			{ fields: CARD_FIELDS, ...CARD_COVER_PARAMS, ...CARD_CUSTOM_FIELD_PARAMS, ...includeParams(includes) },
			signal,
		);
	}

	/** A card's attachments — includes both uploaded files and links, and links to other Trello cards. */
	async getCardAttachments(cardId: string, signal?: AbortSignal): Promise<TrelloAttachment[]> {
		return this.json<TrelloAttachment[]>(
			`/cards/${encodeURIComponent(cardId)}/attachments`,
			{ fields: ATTACHMENT_FIELDS },
			signal,
		);
	}

	/** A card's checklists, each with its items' name and checked state. */
	async getCardChecklists(cardId: string, signal?: AbortSignal): Promise<TrelloChecklist[]> {
		return this.json<TrelloChecklist[]>(
			`/cards/${encodeURIComponent(cardId)}/checklists`,
			{ fields: CHECKLIST_FIELDS, checkItem_fields: CHECK_ITEM_FIELDS },
			signal,
		);
	}

	/** Checks or unchecks one item, on the card it belongs to. */
	async updateCheckItemState(
		cardId: string,
		checkItemId: string,
		state: "complete" | "incomplete",
		signal?: AbortSignal,
	): Promise<void> {
		await this.send(
			{
				url: this.buildUrl(`/cards/${encodeURIComponent(cardId)}/checkItem/${encodeURIComponent(checkItemId)}`, {}),
				method: "PUT",
				body: new URLSearchParams({ state }).toString(),
				contentType: "application/x-www-form-urlencoded",
			},
			signal,
		);
	}

	/**
	 * Board activity (`filter=all`: every action type, not Trello's narrower
	 * default). `since`/`before` are action ids or ISO dates, passed through
	 * unchanged — the caller decides which.
	 */
	async getActions(
		boardId: string,
		options: { since?: string; before?: string } = {},
		signal?: AbortSignal,
	): Promise<TrelloAction[]> {
		const params: Record<string, string> = {
			filter: "all",
			limit: String(this.actionsPageLimit),
			memberCreator_fields: MEMBER_CREATOR_FIELDS,
		};
		if (options.since) params.since = options.since;
		if (options.before) params.before = options.before;
		return this.json<TrelloAction[]>(`/boards/${encodeURIComponent(boardId)}/actions`, params, signal);
	}

	/**
	 * Update a card's title, description, due date and/or assigned labels. A
	 * no-op when nothing changed. `due: undefined` leaves the field untouched;
	 * `due: null` clears it. `idLabels: []` clears every label on the card —
	 * Trello replaces the full set, it never appends.
	 */
	async updateCard(
		cardId: string,
		fields: {
			name?: string;
			desc?: string;
			due?: string | null;
			dueComplete?: boolean;
			idLabels?: string[];
			idMembers?: string[];
			idList?: string;
			pos?: "top" | "bottom";
			closed?: boolean;
		},
		signal?: AbortSignal,
	): Promise<void> {
		const body = new URLSearchParams();
		if (fields.dueComplete !== undefined) body.append("dueComplete", String(fields.dueComplete));
		if (fields.idMembers !== undefined) body.append("idMembers", fields.idMembers.join(","));
		if (fields.idList !== undefined) body.append("idList", fields.idList);
		if (fields.pos !== undefined) body.append("pos", fields.pos);
		if (fields.name !== undefined) body.append("name", fields.name);
		if (fields.desc !== undefined) body.append("desc", fields.desc);
		if (fields.due !== undefined) body.append("due", fields.due === null ? "null" : fields.due);
		if (fields.idLabels !== undefined) body.append("idLabels", fields.idLabels.join(","));
		// Archiving, not deleting — the "always recoverable" rule (§9): the only
		// way `planTrelloUndo`'s "trello-card-create" branch inverts a card
		// creation, never Trello's (irreversible) delete endpoint.
		if (fields.closed !== undefined) body.append("closed", String(fields.closed));
		if ([...body.keys()].length === 0) return;

		await this.send(
			{
				url: this.buildUrl(`/cards/${encodeURIComponent(cardId)}`, {}),
				method: "PUT",
				body: body.toString(),
				contentType: "application/x-www-form-urlencoded",
			},
			signal,
		);
	}

	/** Everything the card view shows - list, members, checklists, attachments, custom-field values and comments - in a single request. */
	async getCardView(cardId: string, commentsLimit: number, signal?: AbortSignal): Promise<TrelloCardView> {
		const params: Record<string, string> = {
			fields: CARD_FIELDS,
			...CARD_COVER_PARAMS,
			...CARD_CUSTOM_FIELD_PARAMS,
			list: "true",
			members: "true",
			checklists: "all",
			checklist_fields: CHECKLIST_FIELDS,
			checkItem_fields: CHECK_ITEM_FIELDS,
			attachments: "true",
			attachment_fields: ATTACHMENT_FIELDS,
		};
		if (commentsLimit > 0) {
			params.actions = "commentCard";
			params.actions_limit = String(commentsLimit);
			params.action_memberCreator_fields = MEMBER_CREATOR_FIELDS;
		}
		return this.json<TrelloCardView>(`/cards/${encodeURIComponent(cardId)}`, params, signal);
	}

	/** The token's owner - tells the card view which comments are theirs to edit. */
	async getMe(signal?: AbortSignal): Promise<TrelloMember> {
		return this.json<TrelloMember>("/members/me", { fields: MEMBER_FIELDS }, signal);
	}

	async addComment(cardId: string, text: string, signal?: AbortSignal): Promise<TrelloComment> {
		const response = await this.send(
			{
				url: this.buildUrl(`/cards/${encodeURIComponent(cardId)}/actions/comments`, {}),
				method: "POST",
				body: new URLSearchParams({ text }).toString(),
				contentType: "application/x-www-form-urlencoded",
			},
			signal,
		);
		return this.parse<TrelloComment>(response);
	}

	async updateComment(cardId: string, actionId: string, text: string, signal?: AbortSignal): Promise<void> {
		await this.send(
			{
				url: this.buildUrl(`/cards/${encodeURIComponent(cardId)}/actions/${encodeURIComponent(actionId)}/comments`, {}),
				method: "PUT",
				body: new URLSearchParams({ text }).toString(),
				contentType: "application/x-www-form-urlencoded",
			},
			signal,
		);
	}

	async addCheckItem(checklistId: string, name: string, signal?: AbortSignal): Promise<void> {
		await this.send(
			{
				url: this.buildUrl(`/checklists/${encodeURIComponent(checklistId)}/checkItems`, {}),
				method: "POST",
				body: new URLSearchParams({ name }).toString(),
				contentType: "application/x-www-form-urlencoded",
			},
			signal,
		);
	}

	async renameCheckItem(cardId: string, checkItemId: string, name: string, signal?: AbortSignal): Promise<void> {
		await this.send(
			{
				url: this.buildUrl(`/cards/${encodeURIComponent(cardId)}/checkItem/${encodeURIComponent(checkItemId)}`, {}),
				method: "PUT",
				body: new URLSearchParams({ name }).toString(),
				contentType: "application/x-www-form-urlencoded",
			},
			signal,
		);
	}

	/** Sets (or, with `null`, clears) one custom field on a card. The body is JSON: Trello does not take a nested value as a form field. */
	async setCustomFieldItem(cardId: string, customFieldId: string, value: CustomFieldValue, signal?: AbortSignal): Promise<void> {
		await this.send(
			{
				url: this.buildUrl(`/cards/${encodeURIComponent(cardId)}/customField/${encodeURIComponent(customFieldId)}/item`, {}),
				method: "PUT",
				body: JSON.stringify(customFieldBody(value)),
				contentType: "application/json",
			},
			signal,
		);
	}

	async addUrlAttachment(cardId: string, url: string, name: string, signal?: AbortSignal): Promise<void> {
		await this.send(
			{
				url: this.buildUrl(`/cards/${encodeURIComponent(cardId)}/attachments`, {}),
				method: "POST",
				body: new URLSearchParams({ url, name }).toString(),
				contentType: "application/x-www-form-urlencoded",
			},
			signal,
		);
	}

	/**
	 * Create a new card on Trello. Returns the newly created card.
	 */
	async createCard(fields: CreateCardFields, signal?: AbortSignal): Promise<TrelloCard> {
		const body = new URLSearchParams();
		body.append("idList", fields.idList);
		body.append("name", fields.name);
		if (fields.desc !== undefined) body.append("desc", fields.desc);
		if (fields.due !== undefined && fields.due !== null) body.append("due", fields.due);
		if (fields.idLabels !== undefined && fields.idLabels.length > 0) body.append("idLabels", fields.idLabels.join(","));
		if (fields.pos !== undefined) body.append("pos", String(fields.pos));

		const response = await this.send(
			{
				url: this.buildUrl("/cards", {}),
				method: "POST",
				body: body.toString(),
				contentType: "application/x-www-form-urlencoded",
			},
			signal,
		);
		try {
			return JSON.parse(response.text) as TrelloCard;
		} catch {
			throw new TrelloError("Unreadable Trello response (invalid JSON).", response.status, false);
		}
	}

	/**
	 * Redacts this client's own credentials from arbitrary text. Defense in
	 * depth for `features/attachmentDownload.ts`, whose `fetchBinary` dependency
	 * is contractually never supposed to throw (it resolves to `null` on
	 * failure) — if a future transport swap broke that contract, an error
	 * message could otherwise carry the key/token into a console warning
	 * unredacted.
	 */
	redactOwnSecrets(text: string): string {
		return this.redact(text);
	}

	private buildUrl(path: string, params: Record<string, string>): string {
		const query = new URLSearchParams({
			...params,
			key: this.credentials.apiKey,
			token: this.credentials.token,
		});
		return `${API_ROOT}${path}?${query.toString()}`;
	}

	private parse<T>(response: HttpResponse): T {
		try {
			return JSON.parse(response.text) as T;
		} catch {
			throw new TrelloError("Unreadable Trello response (invalid JSON).", response.status, false);
		}
	}

	private async json<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
		const response = await this.send({ url: this.buildUrl(path, params), method: "GET" }, signal);
		try {
			return JSON.parse(response.text) as T;
		} catch {
			throw new TrelloError("Unreadable Trello response (invalid JSON).", response.status, false);
		}
	}

	private async send(request: HttpRequest, callerSignal?: AbortSignal): Promise<HttpResponse> {
		if (!this.configured) {
			throw new TrelloError(
				"Missing Trello credentials — set the key and token in the plugin settings.",
				0,
				false,
			);
		}

		let lastError: TrelloError | null = null;
		// `maxRetries` counts the retries that follow the first attempt.
		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			let response: HttpResponse | undefined;
			// A fresh timeout per attempt (not one budget for the whole retry loop), combined
			// with the caller's own signal so either one can cut the wait short.
			const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
			const combinedSignal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
			try {
				// The credentials travel in the query string, so a transport-level failure
				// (DNS, offline, TLS) can carry the whole URL into a Notice or the console.
				response = await this.transport(request, combinedSignal);
			} catch (cause) {
				// A transport-level failure is transient in the same way a 5xx/429 is —
				// retry it through the same backoff budget instead of failing on attempt 1.
				// A timeout lands here too (the combined signal firing rejects the transport
				// the same way a network error would), so it rides the exact same path.
				lastError = new TrelloError(this.redact(errorMessage(cause)), 0, true);
			}

			if (response) {
				if (response.status >= 200 && response.status < 300) return response;
				const retryable = this.retryable.has(response.status);
				lastError = new TrelloError(this.describe(response), response.status, retryable);
				if (!retryable) throw lastError;
			}

			// The caller's own signal (not the combined one, which also fires on a plain
			// timeout) aborting means "stop now" — fail fast with the error already in
			// hand instead of spending the next sleep()/attempt on a cancelled request.
			if (callerSignal?.aborted) throw lastError ?? new TrelloError("Trello request cancelled.", 0, false);

			if (attempt < this.maxRetries) {
				const delayMs = this.computeDelay(attempt, response);
				this.onRetry?.({
					// `attempt` is the 0-based index of the call that just failed —
					// +2 converts to the 1-based index of the call about to run.
					attempt: attempt + 2,
					maxAttempts: this.maxRetries + 1,
					delayMs,
					status: response?.status ?? 0,
				});
				await this.sleep(delayMs);
			}
		}
		throw lastError ?? new TrelloError("Trello request failed.", 0, false);
	}

	/** Trello's own Retry-After header, when present and valid, wins over the exponential formula. */
	private computeDelay(attempt: number, response?: HttpResponse): number {
		const retryAfter = Number(response?.headers?.["retry-after"]);
		const delayMs =
			Number.isFinite(retryAfter) && retryAfter >= 0
				? retryAfter * 1000
				: this.baseDelayMs * 2 ** attempt;
		return Math.min(delayMs, this.maxBackoffDelayMs);
	}

	private redact(text: string): string {
		return redactSecrets(text, [this.credentials.token, this.credentials.apiKey]);
	}

	private describe(response: HttpResponse): string {
		const detail = this.redact(response.text).slice(0, 200);
		return `Trello responded with ${response.status}${detail ? ` — ${detail}` : ""}`;
	}
}
