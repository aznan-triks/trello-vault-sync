import { requestUrl } from "obsidian";
import type { HttpRequest, HttpResponse, Transport } from "../trello/client";

/**
 * `requestUrl` exposes no abort mechanism of its own (confirmed against
 * `obsidian.d.ts`'s `RequestUrlParam`), so a signal can only cut short the
 * *waiting* here — the underlying request Obsidian issued keeps running.
 * Documented limitation, not a bug: see PLAN_2026-09-06_fix-cancellation-timeout.md.
 */
/** A rejection is always an `Error`; a non-`Error` abort reason is kept as its `cause`. */
function abortError(signal: AbortSignal): Error {
	if (signal.reason instanceof Error) return signal.reason;
	return signal.reason === undefined ? new Error("Aborted") : new Error("Aborted", { cause: signal.reason });
}

function racedAgainst<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	const abortion = new Promise<never>((_resolve, reject) => {
		if (signal.aborted) {
			reject(abortError(signal));
			return;
		}
		signal.addEventListener("abort", () => reject(abortError(signal)), { once: true });
	});
	return Promise.race([promise, abortion]);
}

/**
 * Obsidian's own HTTP client: no CORS preflight, works on mobile, and it does
 * not throw on a 4xx/5xx so the retry logic can inspect the status itself.
 */
export const obsidianTransport: Transport = async (
	request: HttpRequest,
	signal?: AbortSignal,
): Promise<HttpResponse> => {
	const response = await racedAgainst(
		requestUrl({
			url: request.url,
			method: request.method,
			...(request.body === undefined ? {} : { body: request.body }),
			...(request.contentType === undefined
				? {}
				: { headers: { "Content-Type": request.contentType } }),
			throw: false,
		}),
		signal,
	);
	return { status: response.status, text: response.text, headers: response.headers };
};

/**
 * Fetches a url and returns its bytes, or `null` on anything short of
 * success — originally for a public Trello avatar (a missing one must never
 * fail the export it's decorating), also used for an authenticated attachment
 * download url (`TrelloClient.authenticatedAttachmentUrl`). `redactFrom`
 * masks the caller's own secrets out of the warning below — the avatar case
 * passes none (there's nothing to redact), the attachment case passes its
 * key/token so neither ever reaches the console in the clear.
 */
export async function obsidianDownloadBinary(
	url: string,
	signal?: AbortSignal,
	redactFrom: (text: string) => string = (text) => text,
): Promise<ArrayBuffer | null> {
	try {
		const response = await racedAgainst(requestUrl({ url, method: "GET", throw: false }), signal);
		return response.status >= 200 && response.status < 300 ? response.arrayBuffer : null;
	} catch (error) {
		// Still degrades to `null` (the initial fallback shows instead), but the
		// underlying error is logged rather than silently dropped.
		console.warn("[trello-vault-sync] binary download failed", redactFrom(String(error)));
		return null;
	}
}
