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

export interface TrelloLabel {
	id: string;
	name: string;
	color: string | null;
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
}

export interface TrelloList {
	id: string;
	name: string;
}

export interface TrelloBoard {
	id: string;
	name: string;
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
}

const API_ROOT = "https://api.trello.com/1";
const CARD_FIELDS = "name,desc,url,dateLastActivity,idBoard,idList,closed,due,labels";
/** Only the name and color are used — id is always returned regardless of `fields`. */
const LABEL_FIELDS = "name,color";
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
/** One page's worth of actions per call — no automatic multi-page walk, see PLAN_2026-09-04_feature-audit-changes.md. */
const ACTIONS_PAGE_LIMIT = "1000";
/** Extra fields requested on `memberCreator` — `avatarUrl` lets the HTML export show who did what without a separate per-member call. */
const MEMBER_CREATOR_FIELDS = "avatarUrl,fullName";

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Replace every occurrence of a secret with a marker, for logs and errors. */
function redactSecrets(text: string, secrets: readonly string[]): string {
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
	}

	/** True when both halves of the single configured credential pair are present. */
	get configured(): boolean {
		return this.credentials.apiKey.trim() !== "" && this.credentials.token.trim() !== "";
	}

	async getCard(cardId: string, signal?: AbortSignal): Promise<TrelloCard> {
		return this.json<TrelloCard>(`/cards/${encodeURIComponent(cardId)}`, { fields: CARD_FIELDS }, signal);
	}

	/** `filter: "all"` includes archived (closed) cards, which "visible" (the default) excludes. */
	async getBoardCards(boardId: string, filter: "visible" | "all" = "visible", signal?: AbortSignal): Promise<TrelloCard[]> {
		return this.json<TrelloCard[]>(
			`/boards/${encodeURIComponent(boardId)}/cards`,
			{ fields: CARD_FIELDS, filter },
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

	async getListCards(listId: string, signal?: AbortSignal): Promise<TrelloCard[]> {
		return this.json<TrelloCard[]>(`/lists/${encodeURIComponent(listId)}/cards`, { fields: CARD_FIELDS }, signal);
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
			limit: ACTIONS_PAGE_LIMIT,
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
		fields: { name?: string; desc?: string; due?: string | null; idLabels?: string[] },
		signal?: AbortSignal,
	): Promise<void> {
		const body = new URLSearchParams();
		if (fields.name !== undefined) body.append("name", fields.name);
		if (fields.desc !== undefined) body.append("desc", fields.desc);
		if (fields.due !== undefined) body.append("due", fields.due === null ? "null" : fields.due);
		if (fields.idLabels !== undefined) body.append("idLabels", fields.idLabels.join(","));
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

	private buildUrl(path: string, params: Record<string, string>): string {
		const query = new URLSearchParams({
			...params,
			key: this.credentials.apiKey,
			token: this.credentials.token,
		});
		return `${API_ROOT}${path}?${query.toString()}`;
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
				const retryable = RETRYABLE.has(response.status);
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
