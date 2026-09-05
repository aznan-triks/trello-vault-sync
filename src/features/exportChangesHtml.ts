import { arrayBufferToBase64 } from "../core/base64";
import { describeAction } from "../core/auditAction";
import { buildChangesHtml, type ChangesHtmlEntry } from "../core/changesHtml";
import { yieldPeriodically } from "../core/asyncUtil";
import { silentReporter, type Reporter, type VaultGateway } from "../obsidian/gateway";
import type { TrelloClient } from "../trello/client";

/** Board-only, like `ChangesAuditOptions` — no vault notes are scanned. */
export interface ChangesHtmlOptions {
	boardId: string;
	/** Vault-relative path of the page to write. Created if missing, overwritten if present. */
	htmlPath: string;
	timestamp: string;
	/** Cursor from the last "Audit changes" run — this command never advances it. */
	since: string;
}

export interface ChangesHtmlResult {
	entries: number;
	html: string;
}

/** One size — small enough for a list row, still recognizable. Trello serves this suffix off the base `avatarUrl`. */
const AVATAR_SIZE_SUFFIX = "/50.png";

function requireHtmlPath(htmlPath: string): string {
	if (htmlPath.trim() === "") {
		throw new Error("The change log HTML page is not configured — set it in the plugin settings.");
	}
	return htmlPath;
}

/**
 * A standalone HTML view of the Trello change log, avatars embedded as data
 * urls. Independent of "Audit changes" (Markdown): reads from the same
 * cursor but never advances it, so it can be regenerated any time without
 * affecting what the canonical audit will report next.
 */
export async function exportChangesHtml(
	vault: VaultGateway,
	client: TrelloClient,
	options: ChangesHtmlOptions,
	fetchBinary: (url: string) => Promise<ArrayBuffer | null>,
	reporter: Reporter = silentReporter,
	signal?: AbortSignal,
): Promise<ChangesHtmlResult> {
	const htmlPath = requireHtmlPath(options.htmlPath);

	const actions = await client.getActions(options.boardId, { since: options.since || undefined });
	reporter.setTotal(actions.length);

	const avatarCache = new Map<string, string | null>();
	async function resolveAvatar(url: string): Promise<string | null> {
		if (avatarCache.has(url)) return avatarCache.get(url) ?? null;
		const bytes = await fetchBinary(url + AVATAR_SIZE_SUFFIX);
		if (!bytes) reporter.log("warn", `Could not download avatar, showing an initial instead: ${url}`);
		const dataUri = bytes ? `data:image/png;base64,${arrayBufferToBase64(bytes)}` : null;
		avatarCache.set(url, dataUri);
		return dataUri;
	}

	const entries: ChangesHtmlEntry[] = [];
	for (const [i, action] of actions.entries()) {
		if (signal?.aborted) break;
		reporter.step(action.type);
		const entry = describeAction(action);
		if (entry) {
			const avatarDataUri = entry.authorAvatarUrl ? await resolveAvatar(entry.authorAvatarUrl) : null;
			entries.push({ ...entry, avatarDataUri });
			reporter.log("info", `${entry.cardName || entry.type} — ${entry.detail}`);
		}
		await yieldPeriodically(i);
	}

	const html = buildChangesHtml({ timestamp: options.timestamp, entries });
	const existing = vault.noteAt(htmlPath);
	if (existing) await vault.write(existing, html);
	else await vault.create(htmlPath, html);

	return { entries: entries.length, html };
}
