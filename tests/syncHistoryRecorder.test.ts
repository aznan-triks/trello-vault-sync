import { describe, expect, test } from "vitest";
import { fingerprint, type SyncAction } from "../src/core/syncHistory";
import { wrapWithHistoryRecorder } from "../src/features/syncHistoryRecorder";
import { syncNoteWithCard, type NoteSyncOptions } from "../src/features/syncNote";
import { TrelloClient } from "../src/trello/client";
import { FakeVault, at, card, routedTransport } from "./fakes";

function recorder(vault: FakeVault) {
	const actions: SyncAction[] = [];
	const wrapped = wrapWithHistoryRecorder(vault, (a) => actions.push(a));
	return { wrapped, actions };
}

describe("wrapWithHistoryRecorder", () => {
	test("write() records a body action with the previous content and new fingerprint", async () => {
		const vault = new FakeVault({ "n.md": { content: "old body" } });
		const { wrapped, actions } = recorder(vault);
		await wrapped.write(vault.note("n.md"), "new body");
		expect(actions).toEqual([
			{ kind: "body", path: "n.md", previousContent: "old body", fingerprint: fingerprint("new body") },
		]);
		expect(vault.contentOf("n.md")).toBe("new body");
	});

	test("writeFrontmatter() records a frontmatter action capturing the whole file before/after", async () => {
		const vault = new FakeVault({ "n.md": { content: '---\ndue: "old"\n---\n\nbody' } });
		const { wrapped, actions } = recorder(vault);
		await wrapped.writeFrontmatter(vault.note("n.md"), (fm) => {
			fm.due = "new";
		});
		expect(actions).toHaveLength(1);
		expect(actions[0]?.kind).toBe("frontmatter");
		expect(actions[0]).toMatchObject({ path: "n.md", previousContent: '---\ndue: "old"\n---\n\nbody' });
		expect(actions[0]?.fingerprint).toBe(fingerprint(vault.contentOf("n.md")));
	});

	test("setCardRef() is recorded the same way as a frontmatter write", async () => {
		const vault = new FakeVault({ "n.md": { content: "body" } });
		const { wrapped, actions } = recorder(vault);
		await wrapped.setCardRef(vault.note("n.md"), { boardId: "b1", cardId: "c1" });
		expect(actions).toHaveLength(1);
		expect(actions[0]?.kind).toBe("frontmatter");
	});

	test("create() records a create action fingerprinted on the initial content", async () => {
		const vault = new FakeVault();
		const { wrapped, actions } = recorder(vault);
		await wrapped.create("new.md", "hello");
		expect(actions).toEqual([{ kind: "create", path: "new.md", fingerprint: fingerprint("hello") }]);
	});

	test("rename() records the previous path and the content's fingerprint at the new path", async () => {
		const vault = new FakeVault({ "a.md": { content: "body" } });
		const { wrapped, actions } = recorder(vault);
		await wrapped.rename(vault.note("a.md"), "b.md");
		expect(actions).toEqual([
			{ kind: "rename", path: "b.md", previousPath: "a.md", fingerprint: fingerprint("body") },
		]);
	});

	test("trash() records the content lost, with a null fingerprint", async () => {
		const vault = new FakeVault({ "n.md": { content: "goodbye" } });
		const { wrapped, actions } = recorder(vault);
		await wrapped.trash(vault.note("n.md"));
		expect(actions).toEqual([{ kind: "trash", path: "n.md", previousContent: "goodbye", fingerprint: null }]);
		expect(vault.exists("n.md")).toBe(false);
	});

	test("a dry-run sync through the recorder records zero actions", async () => {
		const path = "WoT/85_Idées/Sagondo.md";
		const frontmatter = '---\ntrello_board_card_id: "board;c1"\n---\n\n';
		const vault = new FakeVault({ [path]: { content: `${frontmatter}old`, mtime: at("2026-01-01") } });
		const { wrapped, actions } = recorder(vault);
		const { transport } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const remote = card({ id: "c1", name: "Sagondo", desc: "new text", dateLastActivity: "2026-02-01" });
		const options: NoteSyncOptions = {
			policy: "newer-wins",
			marginMs: 0,
			syncTitle: true,
			dryRun: true,
			syncAttachments: false,
			syncChecklists: false,
			syncMembers: false,
			syncCustomFields: false,
		};

		const result = await syncNoteWithCard(wrapped, client, vault.note(path), remote, options);

		expect(result.direction).toBe("pull");
		expect(vault.contentOf(path)).toBe(`${frontmatter}old`);
		expect(actions).toEqual([]);
	});

	test("read-only methods pass straight through, unrecorded", () => {
		const vault = new FakeVault({ "n.md": { content: "x" } });
		const { wrapped, actions } = recorder(vault);
		wrapped.listNotes("");
		wrapped.noteAt("n.md");
		wrapped.exists("n.md");
		wrapped.readFrontmatter(vault.note("n.md"));
		wrapped.getCardRef(vault.note("n.md"));
		expect(actions).toEqual([]);
	});
});
