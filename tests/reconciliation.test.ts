// Regression tests for the reconciliation audit (audits/AUDIT_2026-10-23_reconciliation-issue-2.md):
// one stateful fake Trello card whose every write bumps `dateLastActivity`, and a vault whose writes
// stamp `mtime` from a shared clock — the two clocks `decideSync` compares across cycles.
import { describe, expect, test } from "vitest";
import { syncNoteWithCard, type NoteSyncOptions } from "../src/features/syncNote";
import type { NoteHandle, WriteOptions } from "../src/obsidian/gateway";
import { TrelloClient, type HttpRequest, type HttpResponse, type TrelloCard, type TrelloLabel } from "../src/trello/client";
import { FakeVault } from "./fakes";

const H = 3_600_000;
const T0 = Date.parse("2026-10-01T00:00:00.000Z");
const clock = { now: T0 };

/** Vault whose writes stamp mtime with the shared clock (like a real file system). */
class ClockVault extends FakeVault {
	override async write(note: NoteHandle, content: string, options?: WriteOptions): Promise<void> {
		await super.write(note, content, options);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		if (!options?.keepMtime) (this as any).files.get(note.path).mtime = clock.now;
	}
}

/** Stateful one-card Trello: every PUT applies and bumps dateLastActivity to the clock. */
function fakeTrello(initial: TrelloCard, boardLabels: TrelloLabel[], failWhen?: (p: URLSearchParams) => boolean) {
	const state = { card: structuredClone(initial) };
	const puts: Array<{ url: string; body: URLSearchParams }> = [];
	const transport = async (req: HttpRequest): Promise<HttpResponse> => {
		const url = req.url;
		if (req.method === "GET") {
			if (url.includes("/labels")) return { status: 200, text: JSON.stringify(boardLabels) };
			if (url.includes("/members")) return { status: 200, text: "[]" };
			if (url.includes("/customFields")) return { status: 200, text: "[]" };
			if (url.includes("/checklists")) return { status: 200, text: JSON.stringify(state.card.checklists ?? []) };
			return { status: 200, text: JSON.stringify(state.card) };
		}
		const body = new URLSearchParams(String(req.body ?? ""));
		puts.push({ url, body });
		if (failWhen?.(body)) return { status: 400, text: "boom" };
		const checkItem = /checkItem\/([^/?]+)/.exec(url)?.[1];
		if (checkItem) {
			for (const cl of state.card.checklists ?? []) for (const it of cl.checkItems) if (it.id === checkItem) it.state = body.get("state") as "complete";
		} else {
			if (body.has("desc")) state.card.desc = body.get("desc") ?? "";
			if (body.has("name")) state.card.name = body.get("name") ?? "";
			if (body.has("due")) state.card.due = body.get("due") === "null" ? null : body.get("due");
			if (body.has("idLabels")) {
				const ids = (body.get("idLabels") ?? "").split(",").filter(Boolean);
				state.card.labels = ids.map((id) => boardLabels.find((l) => l.id === id)!);
			}
		}
		state.card.dateLastActivity = new Date(clock.now).toISOString();
		return { status: 200, text: "{}" };
	};
	const client = new TrelloClient({ apiKey: "k", token: "t" }, transport, { maxRetries: 0 } as never);
	return { state, puts, client, fresh: () => structuredClone(state.card) };
}

const BASE: NoteSyncOptions = {
	policy: "newer-wins",
	marginMs: 60_000,
	syncTitle: true,
	dryRun: false,
	syncAttachments: false,
	syncChecklists: false,
	syncMembers: false,
	syncCustomFields: false,
	syncCardCover: false,
};
const REF = 'trello_board_card_id: "board;c1"';
const iso = (ms: number) => new Date(ms).toISOString();
const label = (id: string, name: string, color: string | null = "green"): TrelloLabel => ({ id, name, color }) as TrelloLabel;

function remoteCard(partial: Partial<TrelloCard>): TrelloCard {
	return { id: "c1", idBoard: "board", name: "Note", desc: "", url: "u", dateLastActivity: iso(T0), due: null, labels: [], ...partial } as TrelloCard;
}

describe("lot A — nothing is written during a conflict, and the main write goes first", () => {
	test("F3a: a label merge does not touch Trello during a conflict, so the next cycle is still a conflict", async () => {
		clock.now = T0 + 10_000;
		const vault = new ClockVault({ "Note.md": { content: `---\n${REF}\ntrello_labels:\n  - "X"\n---\n\nlocal edit`, mtime: T0 } });
		const t = fakeTrello(remoteCard({ desc: "remote edit", dateLastActivity: iso(T0 + 10_000) }), [label("LX", "X")]);
		clock.now = T0 + H;
		const first = await syncNoteWithCard(vault, t.client, vault.note("Note.md"), t.fresh(), BASE);
		expect(first.direction).toBe("conflict");
		expect(t.puts).toHaveLength(0);
		clock.now = T0 + 2 * H;
		const second = await syncNoteWithCard(vault, t.client, vault.note("Note.md"), t.fresh(), BASE);
		expect(second.direction).toBe("conflict");
		expect(vault.contentOf("Note.md")).toContain("local edit");
	});

	test("F3b: a label merge does not touch the note during a conflict, so the next cycle is still a conflict", async () => {
		const vault = new ClockVault({ "Note.md": { content: `---\n${REF}\n---\n\nlocal edit`, mtime: T0 } });
		const t = fakeTrello(remoteCard({ desc: "remote edit", dateLastActivity: iso(T0 + 10_000), labels: [label("LY", "Y")] }), [label("LY", "Y")]);
		clock.now = T0 + H;
		expect((await syncNoteWithCard(vault, t.client, vault.note("Note.md"), t.fresh(), BASE)).direction).toBe("conflict");
		expect(vault.note("Note.md").mtime).toBe(T0);
		clock.now = T0 + 2 * H;
		const second = await syncNoteWithCard(vault, t.client, vault.note("Note.md"), t.fresh(), BASE);
		expect(second.direction).toBe("conflict");
		expect(t.state.card.desc).toBe("remote edit");
	});

	test("F4: a push whose main write fails leaves the card untouched, so the next cycle still pushes", async () => {
		const vault = new ClockVault({ "Note.md": { content: `---\n${REF}\ntrello_labels:\n  - "X"\n---\n\nlocal edit`, mtime: T0 + H } });
		const t = fakeTrello(remoteCard({ desc: "old", dateLastActivity: iso(T0) }), [label("LX", "X")], (b) => b.has("desc"));
		clock.now = T0 + 2 * H;
		await expect(syncNoteWithCard(vault, t.client, vault.note("Note.md"), t.fresh(), BASE)).rejects.toThrow();
		expect(t.state.card.dateLastActivity).toBe(iso(T0));
		clock.now = T0 + 3 * H;
		const t2 = fakeTrello(t.fresh(), [label("LX", "X")]);
		const second = await syncNoteWithCard(vault, t2.client, vault.note("Note.md"), t2.fresh(), BASE);
		expect(second.direction).toBe("push");
		expect(vault.contentOf("Note.md")).toContain("local edit");
		expect(t2.state.card.desc).toBe("local edit");
	});

	test("F4: a push sends the merged labels in the same request as the description", async () => {
		const vault = new ClockVault({ "Note.md": { content: `---\n${REF}\ntrello_labels:\n  - "X"\n---\n\nlocal edit`, mtime: T0 + H } });
		const t = fakeTrello(remoteCard({ desc: "old", dateLastActivity: iso(T0) }), [label("LX", "X")]);
		clock.now = T0 + 2 * H;
		await syncNoteWithCard(vault, t.client, vault.note("Note.md"), t.fresh(), BASE);
		expect(t.puts).toHaveLength(1);
		expect(t.puts[0]?.body.get("desc")).toBe("local edit");
		expect(t.puts[0]?.body.get("idLabels")).toBe("LX");
	});

	test("F3: a conflict leaves the checklists alone on both sides", async () => {
		const note = `---\n${REF}\n---\n\nlocal edit\n\n## Checklist\n### Todo\n- [x] a`;
		const vault = new ClockVault({ "Note.md": { content: note, mtime: T0 } });
		const checklists = [{ id: "cl", name: "Todo", pos: 1, checkItems: [{ id: "i1", name: "a", state: "incomplete", pos: 1 }, { id: "i2", name: "b", state: "incomplete", pos: 2 }] }];
		const t = fakeTrello(remoteCard({ desc: "remote edit", dateLastActivity: iso(T0 + 10_000), checklists: checklists as never }), []);
		clock.now = T0 + H;
		const result = await syncNoteWithCard(vault, t.client, vault.note("Note.md"), t.fresh(), { ...BASE, syncChecklists: true });
		expect(result.direction).toBe("conflict");
		expect(t.puts).toHaveLength(0);
		expect(vault.contentOf("Note.md")).toBe(note);
	});

	test("F4: a push whose main write fails sends no check-item write either", async () => {
		const note = `---\n${REF}\n---\n\nlocal edit\n\n## Checklist\n### Todo\n- [x] a`;
		const vault = new ClockVault({ "Note.md": { content: note, mtime: T0 + H } });
		const checklists = [{ id: "cl", name: "Todo", pos: 1, checkItems: [{ id: "i1", name: "a", state: "incomplete", pos: 1 }] }];
		const t = fakeTrello(remoteCard({ desc: "old", dateLastActivity: iso(T0), checklists: checklists as never }), [], (b) => b.has("desc"));
		clock.now = T0 + 2 * H;
		await expect(syncNoteWithCard(vault, t.client, vault.note("Note.md"), t.fresh(), { ...BASE, syncChecklists: true })).rejects.toThrow();
		expect(t.puts.filter((p) => p.url.includes("checkItem"))).toHaveLength(0);
	});

	test("F6: the label merge and the label properties write idLabels once, with both changes", async () => {
		const mapping = { labelId: "LP", labelName: "High", labelColor: null, key: "prio", values: ["high"] };
		const labelProperties = { direction: "both" as const, removeValues: false, mappings: [mapping] };
		const vault = new ClockVault({ "Note.md": { content: `---\n${REF}\nprio: "high"\ntrello_labels:\n  - "X"\n---\n\nsame`, mtime: T0 } });
		const t = fakeTrello(remoteCard({ desc: "same" }), [label("LX", "X"), label("LP", "High")]);
		clock.now = T0 + H;
		await syncNoteWithCard(vault, t.client, vault.note("Note.md"), t.fresh(), { ...BASE, labelProperties });
		expect(t.puts.map((p) => p.body.get("idLabels"))).toEqual(["LX,LP"]);
		expect(t.state.card.labels?.map((l) => l.id)).toEqual(["LX", "LP"]);
	});
});
