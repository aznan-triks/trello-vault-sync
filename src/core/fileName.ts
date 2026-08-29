/** Characters Obsidian refuses inside a note file name. */
const FORBIDDEN = new RegExp(String.raw`[*"\\/<>:|?]`, "g");
const CONTROL = /[\u0000-\u001F\u007F]/g;
/** Windows device names — illegal as a full file base name regardless of case. */
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Longest base name we will produce, leaving room for a folder prefix. */
export const MAX_BASENAME_LENGTH = 120;

/** Turn an arbitrary Trello card title into a legal note base name. */
export function sanitizeFileName(name: string): string {
	const cleaned = name
		.replace(CONTROL, "")
		.replace(FORBIDDEN, "-")
		.replace(/\.+$/, "")
		.trim()
		.slice(0, MAX_BASENAME_LENGTH)
		.trim();
	if (cleaned === "") return "Untitled";
	return RESERVED_WINDOWS_NAME.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** Join a vault folder and a file name, treating "" and "/" as the vault root. */
export function joinPath(folder: string, fileName: string): string {
	if (folder === "" || folder === "/") return fileName;
	return folder.endsWith("/") ? `${folder}${fileName}` : `${folder}/${fileName}`;
}

/**
 * First free `folder/base.md`, adding " (2)", " (3)"… on collision.
 * `ownPath` lets a rename target its own current path without bumping.
 */
export function uniqueNotePath(
	folder: string,
	base: string,
	exists: (path: string) => boolean,
	ownPath?: string,
): string {
	const candidate = (suffix: string) => joinPath(folder, `${base}${suffix}.md`);
	const free = (path: string) => path === ownPath || !exists(path);

	if (free(candidate(""))) return candidate("");
	for (let i = 2; ; i++) {
		const path = candidate(` (${i})`);
		if (free(path)) return path;
	}
}
