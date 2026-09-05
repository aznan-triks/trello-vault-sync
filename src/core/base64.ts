/**
 * Encodes raw bytes as base64 using `btoa` rather than Node's `Buffer` — the
 * plugin's own build targets a browser-shaped runtime (Obsidian's renderer),
 * and this module is loaded by tests too, so it stays free of a Node-only API.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}
