import { resolveAttachmentPath, type AttachmentPathOptions } from "../core/attachmentPath";
import { errorMessage } from "../core/errorMessage";
import type { TrelloAttachment } from "../trello/client";

export interface DownloadAttachmentsResult {
	downloaded: number;
	skipped: number;
	errors: string[];
}

export interface AttachmentDownloadDeps {
	binarySize(path: string): number | null;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	/**
	 * Fetches an attachment's bytes, or `null` on failure — contractually never
	 * throws. Authentication (the `Authorization` header Trello's download
	 * endpoint actually needs, see `audits/AUDIT_attachment-download.md`) is
	 * the caller's concern, baked into this closure — the attachment's own
	 * `url` is passed through unmodified, no query string added.
	 */
	fetchBinary(url: string, signal?: AbortSignal): Promise<ArrayBuffer | null>;
	/** Masks this download's own credentials out of an error message. Defense in depth: `fetchBinary` isn't supposed to throw, but if it ever did, the message could otherwise carry credentials in the clear. */
	redact(text: string): string;
}

/**
 * Downloads every uploaded (non-link) attachment not already present at its
 * resolved destination with a matching byte size — same name + same size is
 * treated as already downloaded: no re-fetch, no re-write. Never throws: one
 * attachment's failure is reported in `errors`, the rest still proceed.
 */
export async function downloadAttachments(
	attachments: readonly TrelloAttachment[],
	destination: Pick<AttachmentPathOptions, "destination" | "noteFolder" | "globalFolder">,
	deps: AttachmentDownloadDeps,
	signal?: AbortSignal,
): Promise<DownloadAttachmentsResult> {
	const result: DownloadAttachmentsResult = { downloaded: 0, skipped: 0, errors: [] };
	for (const attachment of attachments) {
		if (signal?.aborted) break;
		if (!attachment.isUpload) continue;

		const planned = resolveAttachmentPath(attachment.name, destination);
		if (!planned.ok) {
			result.errors.push(planned.reason);
			continue;
		}

		const existingSize = deps.binarySize(planned.path);
		// Trello reports the attachment's own byte size up front — when it matches
		// what's already on disk, skip the fetch entirely rather than downloading
		// bytes only to discard them (the byteLength check below is a fallback for
		// the rarer case where Trello didn't report a size at all).
		if (typeof attachment.bytes === "number" && existingSize === attachment.bytes) {
			result.skipped++;
			continue;
		}

		try {
			const bytes = await deps.fetchBinary(attachment.url, signal);
			if (bytes === null) {
				result.errors.push(`${attachment.name} — download failed`);
				continue;
			}
			if (existingSize === bytes.byteLength) {
				result.skipped++;
				continue;
			}
			await deps.writeBinary(planned.path, bytes);
			result.downloaded++;
		} catch (error) {
			result.errors.push(`${attachment.name} — ${deps.redact(errorMessage(error))}`);
		}
	}
	return result;
}
