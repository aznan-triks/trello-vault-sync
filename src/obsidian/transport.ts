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
	return { status: response.status, text: response.text };
};
