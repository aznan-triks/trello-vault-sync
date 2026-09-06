import { requestUrl } from "obsidian";
import type { HttpRequest, HttpResponse, Transport } from "../trello/client";

/**
 * Obsidian's own HTTP client: no CORS preflight, works on mobile, and it does
 * not throw on a 4xx/5xx so the retry logic can inspect the status itself.
 */
export const obsidianTransport: Transport = async (
	request: HttpRequest,
): Promise<HttpResponse> => {
	const response = await requestUrl({
		url: request.url,
		method: request.method,
		...(request.body === undefined ? {} : { body: request.body }),
		...(request.contentType === undefined
			? {}
			: { headers: { "Content-Type": request.contentType } }),
		throw: false,
	});
	return { status: response.status, text: response.text, headers: response.headers };
};

/**
 * Fetches a public url (a Trello avatar image, not the authenticated `/1/...`
 * API) and returns its bytes, or `null` on anything short of success — a
 * missing avatar must never fail the export it's decorating.
 */
export async function obsidianDownloadBinary(url: string): Promise<ArrayBuffer | null> {
	try {
		const response = await requestUrl({ url, method: "GET", throw: false });
		return response.status >= 200 && response.status < 300 ? response.arrayBuffer : null;
	} catch (error) {
		// Still degrades to `null` (the initial fallback shows instead), but the
		// underlying error is logged rather than silently dropped.
		console.warn("[trello-vault-sync] public url download failed", error);
		return null;
	}
}
