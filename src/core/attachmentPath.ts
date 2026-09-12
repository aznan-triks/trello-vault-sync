import { sanitizeFileName } from "./fileName";

/** Where a downloaded attachment file is written — mirrors the two-mode choice already used elsewhere in the settings (e.g. `scope`). */
export type AttachmentsDestination = "note-folder" | "global-folder";

export interface AttachmentPathOptions {
	destination: AttachmentsDestination;
	/** The syncing note's own folder — used only when `destination` is "note-folder". */
	noteFolder: string;
	/** Required (non-empty) only when `destination` is "global-folder". */
	globalFolder: string;
}

export type AttachmentPathResult = { ok: true; path: string } | { ok: false; reason: string };

/**
 * Resolves where one downloaded attachment should live, sanitizing its file
 * name the same way a note's own name is sanitized (`sanitizeFileName`) — a
 * name with `/`, `:`, or a reserved Windows device name never escapes the
 * chosen folder. Refuses (never falls back to the vault root) when
 * "global-folder" is chosen with no folder set — Fail Fast over guessing.
 */
export function resolveAttachmentPath(fileName: string, options: AttachmentPathOptions): AttachmentPathResult {
	const safeName = sanitizeFileName(fileName);
	if (options.destination === "global-folder") {
		const folder = options.globalFolder.trim();
		if (folder === "") return { ok: false, reason: "Attachment download folder is not set." };
		return { ok: true, path: `${folder}/${safeName}` };
	}
	return { ok: true, path: options.noteFolder ? `${options.noteFolder}/${safeName}` : safeName };
}
