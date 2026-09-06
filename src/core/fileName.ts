/** Characters Obsidian refuses inside a note file name. */
const FORBIDDEN = new RegExp(String.raw`[*"\\/<>:|?]`, "g");
const CONTROL = /[\u0000-\u001F\u007F]/g;
/** Windows device names — illegal as a full file base name regardless of case. */
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Longest base name we will produce, leaving room for a folder prefix. */
const MAX_BASENAME_LENGTH = 120;

/** Truncates by Unicode code point, so an emoji's surrogate pair is never split in two. */
function truncateCodePoints(value: string, maxLength: number): string {
	// UTF-16 code units are always >= code points, so staying under the limit
	// there means staying under it in code points too — skips the allocation
	// for the common case of a plain-ASCII title.
	if (value.length <= maxLength) return value;
	return Array.from(value).slice(0, maxLength).join("");
}

/** Turn an arbitrary Trello card title into a legal note base name. */
export function sanitizeFileName(name: string): string {
	const cleaned = truncateCodePoints(
		name.replace(CONTROL, "").replace(FORBIDDEN, "-").replace(/\.+$/, "").trim(),
		MAX_BASENAME_LENGTH,
	).trim();
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

/** A folder path as the prefix every note under it starts with — the one normalization every folder-scoping rule shares. */
function folderPrefix(folder: string): string {
	return `${folder.replace(/\/$/, "")}/`;
}

/** Entries among `handles` living under `folder` ("" or "/" = the whole vault). The one prefix rule every vault gateway uses to scope a listing. */
export function notesInFolder<T extends { path: string }>(handles: T[], folder: string): T[] {
	const prefix = folder === "" || folder === "/" ? "" : folderPrefix(folder);
	return prefix === "" ? handles : handles.filter((handle) => handle.path.startsWith(prefix));
}

/** Entries among `handles` living under none of `excluded` — the blacklist counterpart to `notesInFolder`. */
export function excludeFolders<T extends { path: string }>(handles: T[], excluded: string[]): T[] {
	const prefixes = excluded.filter((folder) => folder !== "").map(folderPrefix);
	if (prefixes.length === 0) return handles;
	return handles.filter((handle) => !prefixes.some((prefix) => handle.path.startsWith(prefix)));
}
