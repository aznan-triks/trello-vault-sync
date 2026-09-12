import { describe, expect, test } from "vitest";
import { downloadAttachments, type AttachmentDownloadDeps } from "../src/features/attachmentDownload";
import type { TrelloAttachment } from "../src/trello/client";

function attachment(partial: Partial<TrelloAttachment> & { id: string; name: string }): TrelloAttachment {
	return { url: `https://trello.com/1/cards/c1/attachments/${partial.id}/download/${partial.name}`, isUpload: true, ...partial };
}

function deps(overrides: Partial<AttachmentDownloadDeps> = {}): AttachmentDownloadDeps & { writes: Array<{ path: string; size: number }> } {
	const writes: Array<{ path: string; size: number }> = [];
	const sizes = new Map<string, number>();
	return {
		writes,
		binarySize: (path) => sizes.get(path) ?? null,
		writeBinary: async (path, data) => {
			sizes.set(path, data.byteLength);
			writes.push({ path, size: data.byteLength });
		},
		authenticatedUrl: (url) => `${url}?key=k&token=t`,
		fetchBinary: async () => new ArrayBuffer(10),
		redact: (text) => text,
		...overrides,
	};
}

const DEST = { destination: "note-folder" as const, noteFolder: "WoT/85_Idées", globalFolder: "" };

describe("downloadAttachments", () => {
	test("downloads an uploaded attachment not yet present", async () => {
		const d = deps();
		const result = await downloadAttachments([attachment({ id: "a1", name: "photo.jpg" })], DEST, d);
		expect(result).toEqual({ downloaded: 1, skipped: 0, errors: [] });
		expect(d.writes).toEqual([{ path: "WoT/85_Idées/photo.jpg", size: 10 }]);
	});

	test("skips a link attachment (isUpload: false) entirely", async () => {
		const d = deps();
		const result = await downloadAttachments(
			[attachment({ id: "a1", name: "photo.jpg", isUpload: false })],
			DEST,
			d,
		);
		expect(result).toEqual({ downloaded: 0, skipped: 0, errors: [] });
		expect(d.writes).toEqual([]);
	});

	test("skips (no-op, no fetch at all) when the remote-reported size matches what's already on disk", async () => {
		let calls = 0;
		const d = deps({
			binarySize: (path) => (path === "WoT/85_Idées/photo.jpg" ? 10 : null),
			fetchBinary: async () => {
				calls++;
				return new ArrayBuffer(10);
			},
		});
		const result = await downloadAttachments([attachment({ id: "a1", name: "photo.jpg", bytes: 10 })], DEST, d);
		expect(result).toEqual({ downloaded: 0, skipped: 1, errors: [] });
		expect(d.writes).toEqual([]);
		expect(calls).toBe(0);
	});

	test("still dedupes after fetching when Trello reported no size up front", async () => {
		const d = deps({ binarySize: (path) => (path === "WoT/85_Idées/photo.jpg" ? 10 : null) });
		const result = await downloadAttachments([attachment({ id: "a1", name: "photo.jpg" })], DEST, d);
		expect(result).toEqual({ downloaded: 0, skipped: 1, errors: [] });
		expect(d.writes).toEqual([]);
	});

	test("re-downloads when the existing file's size differs", async () => {
		const d = deps({ binarySize: (path) => (path === "WoT/85_Idées/photo.jpg" ? 999 : null) });
		const result = await downloadAttachments([attachment({ id: "a1", name: "photo.jpg", bytes: 10 })], DEST, d);
		expect(result).toEqual({ downloaded: 1, skipped: 0, errors: [] });
	});

	test("reports a failed download without throwing, and continues with the rest", async () => {
		let calls = 0;
		const d = deps({
			fetchBinary: async () => {
				calls++;
				return calls === 1 ? null : new ArrayBuffer(5);
			},
		});
		const result = await downloadAttachments(
			[attachment({ id: "a1", name: "broken.jpg" }), attachment({ id: "a2", name: "ok.jpg" })],
			DEST,
			d,
		);
		expect(result.downloaded).toBe(1);
		expect(result.errors).toEqual(["broken.jpg — download failed"]);
	});

	test("refuses (no write) when global-folder mode has an empty folder, and reports it explicitly", async () => {
		const d = deps();
		const result = await downloadAttachments(
			[attachment({ id: "a1", name: "photo.jpg" })],
			{ destination: "global-folder", noteFolder: "x", globalFolder: "" },
			d,
		);
		expect(result).toEqual({ downloaded: 0, skipped: 0, errors: ["Attachment download folder is not set."] });
		expect(d.writes).toEqual([]);
	});

	test("redacts a thrown error through the injected redact() before reporting it — defense in depth if fetchBinary ever broke its no-throw contract", async () => {
		const d = deps({
			fetchBinary: async () => {
				throw new Error("network error for https://trello.com/x?key=SECRET_KEY&token=SECRET_TOKEN");
			},
			redact: (text) => text.replace("SECRET_KEY", "«masked»").replace("SECRET_TOKEN", "«masked»"),
		});
		const result = await downloadAttachments([attachment({ id: "a1", name: "photo.jpg" })], DEST, d);
		expect(result.errors[0]).not.toContain("SECRET_KEY");
		expect(result.errors[0]).not.toContain("SECRET_TOKEN");
		expect(result.errors[0]).toContain("«masked»");
	});

	test("builds the authenticated url before fetching", async () => {
		const seen: string[] = [];
		const d = deps({
			authenticatedUrl: (url) => {
				const authed = `${url}?key=k&token=t`;
				return authed;
			},
			fetchBinary: async (url) => {
				seen.push(url);
				return new ArrayBuffer(1);
			},
		});
		await downloadAttachments([attachment({ id: "a1", name: "photo.jpg" })], DEST, d);
		expect(seen[0]).toContain("?key=k&token=t");
	});
});
