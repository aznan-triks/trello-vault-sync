import { errorMessage } from "../core/errorMessage";
import type { Reporter } from "../obsidian/gateway";
import { TrelloError, type TrelloClient } from "../trello/client";

export type GoneState = "archived" | "deleted" | "alive";

export interface GoneCardInfo {
	state: GoneState;
	idList?: string;
	idBoard?: string;
}

/** What a caller already knows about a card (from a board-wide fetch), so no request is spent on it. */
export type KnownCard = { closed?: boolean; idList?: string; idBoard?: string };

/**
 * Tells archived, deleted and alive-elsewhere cards apart — a card missing from a
 * list is none of those on its face. `known` short-circuits cards a board fetch
 * already returned. A 404 means deleted; any other failure leaves the card out of
 * the result (unknown ⇒ the caller touches nothing) and is logged, never swallowed.
 */
export async function classifyGoneCards(
	client: TrelloClient,
	cardIds: string[],
	signal?: AbortSignal,
	reporter?: Pick<Reporter, "log">,
	known?: ReadonlyMap<string, KnownCard>,
): Promise<Map<string, GoneCardInfo>> {
	const result = new Map<string, GoneCardInfo>();
	for (const id of cardIds) {
		if (signal?.aborted) break;
		const hit = known?.get(id);
		if (hit) {
			result.set(id, { state: hit.closed ? "archived" : "alive", idList: hit.idList, idBoard: hit.idBoard });
			continue;
		}
		try {
			const card = await client.getCard(id, signal);
			result.set(id, { state: card.closed ? "archived" : "alive", idList: card.idList, idBoard: card.idBoard });
		} catch (error) {
			if (error instanceof TrelloError && error.status === 404) {
				result.set(id, { state: "deleted" });
			} else if (!signal?.aborted) {
				reporter?.log("warn", `Could not check card ${id} — left untouched: ${errorMessage(error)}`);
			}
		}
	}
	return result;
}
