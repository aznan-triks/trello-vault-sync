/**
 * Trello REST access, transport-agnostic.
 *
 * The HTTP call is injected so the whole retry / redaction / parsing surface is
 * unit-testable, and so the plugin can use Obsidian's `requestUrl` (no CORS, and
 * it works on mobile) without this file importing Obsidian.
 */

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
}

export type Transport = (request: HttpRequest) => Promise<HttpResponse>;

export interface TrelloCard {
	id: string;
	idBoard: string;
	name: string;
	desc: string;
	url: string;
	dateLastActivity: string;
	idList?: string;
	closed?: boolean;
}

export interface TrelloList {
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

export interface TrelloClientOptions {
	maxRetries?: number;
	baseDelayMs?: number;
	sleep?: (ms: number) => Promise<void>;
}

const API_ROOT = "https://api.trello.com/1";
const CARD_FIELDS = "name,desc,url,dateLastActivity,idBoard,idList,closed";
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Replace every occurrence of a secret with a marker, for logs and errors. */
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
	private readonly sleep: (ms: number) => Promise<void>;

	constructor(
		private readonly credentials: TrelloCredentials,
		private readonly transport: Transport,
		options: TrelloClientOptions = {},
	) {
		this.maxRetries = options.maxRetries ?? 3;
		this.baseDelayMs = options.baseDelayMs ?? 800;
		this.sleep = options.sleep ?? defaultSleep;
	}

	/** True when both halves of the single configured credential pair are present. */
	get configured(): boolean {
		return this.credentials.apiKey.trim() !== "" && this.credentials.token.trim() !== "";
	}

	async getCard(cardId: string): Promise<TrelloCard> {
		return this.json<TrelloCard>(`/cards/${encodeURIComponent(cardId)}`, { fields: CARD_FIELDS });
	}

	async getBoardCards(boardId: string): Promise<TrelloCard[]> {
		return this.json<TrelloCard[]>(`/boards/${encodeURIComponent(boardId)}/cards`, {
			fields: CARD_FIELDS,
		});
	}

	async getBoardLists(boardId: string): Promise<TrelloList[]> {
		return this.json<TrelloList[]>(`/boards/${encodeURIComponent(boardId)}/lists`, {
			fields: "name",
		});
	}

	async getListCards(listId: string): Promise<TrelloCard[]> {
		return this.json<TrelloCard[]>(`/lists/${encodeURIComponent(listId)}/cards`, {
			fields: CARD_FIELDS,
		});
	}

	/** Update a card's title and/or description. A no-op when nothing changed. */
	async updateCard(cardId: string, fields: { name?: string; desc?: string }): Promise<void> {
		const body = new URLSearchParams();
		if (fields.name !== undefined) body.append("name", fields.name);
		if (fields.desc !== undefined) body.append("desc", fields.desc);
		if ([...body.keys()].length === 0) return;

		await this.send({
			url: this.buildUrl(`/cards/${encodeURIComponent(cardId)}`, {}),
			method: "PUT",
			body: body.toString(),
			contentType: "application/x-www-form-urlencoded",
		});
	}

	private buildUrl(path: string, params: Record<string, string>): string {
		const query = new URLSearchParams({
			...params,
			key: this.credentials.apiKey,
			token: this.credentials.token,
		});
		return `${API_ROOT}${path}?${query.toString()}`;
	}

	private async json<T>(path: string, params: Record<string, string>): Promise<T> {
		const response = await this.send({ url: this.buildUrl(path, params), method: "GET" });
		try {
			return JSON.parse(response.text) as T;
		} catch {
			throw new TrelloError("Unreadable Trello response (invalid JSON).", response.status, false);
		}
	}

	private async send(request: HttpRequest): Promise<HttpResponse> {
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
			// The credentials travel in the query string, so a transport-level failure
			// (DNS, offline, TLS) can carry the whole URL into a Notice or the console.
			const response = await this.transport(request).catch((cause: unknown) => {
				throw new TrelloError(this.redact((cause as Error).message), 0, false);
			});
			if (response.status >= 200 && response.status < 300) return response;

			const retryable = RETRYABLE.has(response.status);
			lastError = new TrelloError(this.describe(response), response.status, retryable);
			if (!retryable) throw lastError;
			if (attempt < this.maxRetries) await this.sleep(this.baseDelayMs * 2 ** attempt);
		}
		throw lastError ?? new TrelloError("Trello request failed.", 0, false);
	}

	private redact(text: string): string {
		return redactSecrets(text, [this.credentials.token, this.credentials.apiKey]);
	}

	private describe(response: HttpResponse): string {
		const detail = this.redact(response.text).slice(0, 200);
		return `Trello responded with ${response.status}${detail ? ` — ${detail}` : ""}`;
	}
}
