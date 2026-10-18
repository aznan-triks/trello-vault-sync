import type {
	TrelloClient,
	TrelloCardView,
	TrelloCustomFieldDefinition,
	TrelloLabel,
	TrelloList,
	TrelloMember,
} from "../trello/client";

/** How long the card view keeps what it fetched - read on every call, so a settings change applies at once. */
export interface CardViewCacheRules {
	cardMs: number;
	boardMs: number;
	commentsLimit: number;
}

interface Entry<T> {
	value: T;
	at: number;
}

/**
 * What the card view needs from Trello, cached: one request per card (reused for `cardMs`), and the board's
 * lists, labels, members and field definitions - only fetched the first time something needs them (an edit,
 * the custom-field section), then reused for `boardMs`.
 */
export class CardViewData {
	private readonly cards = new Map<string, Entry<TrelloCardView>>();
	private readonly board = new Map<string, Entry<Promise<unknown>>>();
	private me: Promise<TrelloMember> | null = null;

	constructor(
		private readonly client: () => TrelloClient,
		private readonly rules: () => CardViewCacheRules,
		private readonly now: () => number = Date.now,
	) {}

	/** The card, from the cache while it is fresh; `force` always asks Trello. */
	async card(cardId: string, force: boolean, signal?: AbortSignal): Promise<TrelloCardView> {
		const { cardMs, commentsLimit } = this.rules();
		const hit = this.cards.get(cardId);
		if (!force && hit && this.now() - hit.at < cardMs) return hit.value;
		const value = await this.client().getCardView(cardId, commentsLimit, signal);
		this.cards.set(cardId, { value, at: this.now() });
		return value;
	}

	/** After an edit: the next display asks Trello again. */
	invalidate(cardId: string): void {
		this.cards.delete(cardId);
	}

	lists(boardId: string, signal?: AbortSignal): Promise<TrelloList[]> {
		return this.cachedBoard("lists", boardId, () => this.client().getBoardLists(boardId, signal));
	}

	labels(boardId: string, signal?: AbortSignal): Promise<TrelloLabel[]> {
		return this.cachedBoard("labels", boardId, () => this.client().getBoardLabels(boardId, signal));
	}

	members(boardId: string, signal?: AbortSignal): Promise<TrelloMember[]> {
		return this.cachedBoard("members", boardId, () => this.client().getBoardMembers(boardId, signal));
	}

	customFields(boardId: string, signal?: AbortSignal): Promise<TrelloCustomFieldDefinition[]> {
		return this.cachedBoard("customFields", boardId, () => this.client().getBoardCustomFields(boardId, signal));
	}

	/** The token's owner (which comments are theirs to edit) - asked once. */
	whoAmI(signal?: AbortSignal): Promise<TrelloMember> {
		this.me ??= this.client().getMe(signal);
		this.me.catch(() => (this.me = null));
		return this.me;
	}

	private cachedBoard<T>(kind: string, boardId: string, fetch: () => Promise<T>): Promise<T> {
		const key = `${kind}:${boardId}`;
		const hit = this.board.get(key);
		if (hit && this.now() - hit.at < this.rules().boardMs) return hit.value as Promise<T>;
		const value = fetch();
		this.board.set(key, { value, at: this.now() });
		// A failed request must not stay cached: the next call retries.
		value.catch(() => {
			if (this.board.get(key)?.value === value) this.board.delete(key);
		});
		return value;
	}
}
