import { describe, expect, test } from "vitest";
import type { SyncAction, SyncRun, TrelloCardUpdateAction, TrelloCheckItemAction } from "../src/core/syncHistory";
import { undoRun, undoRunForNote, undoSelectedActions } from "../src/features/rollback";
import { wrapWithHistoryRecorder } from "../src/features/syncHistoryRecorder";
import { TrelloClient, type HttpRequest, type HttpResponse } from "../src/trello/client";
import { card, FakeVault, routedTransport } from "./fakes";

function record(vault: FakeVault) {
	const actions: SyncAction[] = [];
	const wrapped = wrapWithHistoryRecorder(vault, (a) => actions.push(a));
	return { wrapped, actions };
}

describe("undoRun", () => {
	test("happy path: body + frontmatter + create → undo restores the initial vault", async () => {
		const vault = new FakeVault({
			"a.md": { content: '---\ndue: "old"\n---\n\noriginal body' },
		});
		const before = vault.contentOf("a.md");
		const { wrapped, actions } = record(vault);

		await wrapped.writeFrontmatter(vault.note("a.md"), (fm) => {
			fm.due = "new";
		});
		await wrapped.write(vault.note("a.md"), '---\ndue: "new"\n---\n\nupdated body');
		await wrapped.create("b.md", "brand new note");

		expect(vault.exists("b.md")).toBe(true);

		const run: SyncRun = { timestamp: "2026-09-12T00:00:00.000Z", scope: "", actions };
		const { stats } = await undoRun(vault, run);

		expect(stats).toEqual({ reverted: 3, revertedRemote: 0, skipped: 0 });
		expect(vault.contentOf("a.md")).toBe(before);
		expect(vault.exists("b.md")).toBe(false);
	});

	test("skips an action whose note was modified after the run, without touching it", async () => {
		const vault = new FakeVault({ "a.md": { content: "original" } });
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "synced");

		// The user edits the note after the sync ran.
		await vault.write(vault.note("a.md"), "user's own edit");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const { stats } = await undoRun(vault, run);

		expect(stats).toEqual({ reverted: 0, revertedRemote: 0, skipped: 1 });
		expect(vault.contentOf("a.md")).toBe("user's own edit");
	});

	test("skips a write action whose note was since deleted, without recreating it", async () => {
		const vault = new FakeVault({ "a.md": { content: "original" } });
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "synced");

		await vault.trash(vault.note("a.md"));

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const { stats } = await undoRun(vault, run);

		expect(stats).toEqual({ reverted: 0, revertedRemote: 0, skipped: 1 });
		expect(vault.exists("a.md")).toBe(false);
	});

	test("undoes a rename by moving the note back to its previous path", async () => {
		const vault = new FakeVault({ "a.md": { content: "body" } });
		const { wrapped, actions } = record(vault);
		await wrapped.rename(vault.note("a.md"), "b.md");
		expect(vault.exists("a.md")).toBe(false);
		expect(vault.exists("b.md")).toBe(true);

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const { stats } = await undoRun(vault, run);

		expect(stats).toEqual({ reverted: 1, revertedRemote: 0, skipped: 0 });
		expect(vault.exists("a.md")).toBe(true);
		expect(vault.exists("b.md")).toBe(false);
		expect(vault.contentOf("a.md")).toBe("body");
	});

	test("undoes a trash by recreating the note when nothing has taken its path since", async () => {
		const vault = new FakeVault({ "a.md": { content: "will be trashed" } });
		const { wrapped, actions } = record(vault);
		await wrapped.trash(vault.note("a.md"));
		expect(vault.exists("a.md")).toBe(false);

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const { stats } = await undoRun(vault, run);

		expect(stats).toEqual({ reverted: 1, revertedRemote: 0, skipped: 0 });
		expect(vault.contentOf("a.md")).toBe("will be trashed");
	});

	test("mixed run: unaffected actions still revert while the divergent one is reported skipped", async () => {
		const vault = new FakeVault({
			"a.md": { content: "a-original" },
			"c.md": { content: "c-original" },
		});
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "a-synced");
		await wrapped.write(vault.note("c.md"), "c-synced");
		await vault.write(vault.note("c.md"), "c edited by user after sync");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const { stats } = await undoRun(vault, run);

		expect(stats).toEqual({ reverted: 1, revertedRemote: 0, skipped: 1 });
		expect(vault.contentOf("a.md")).toBe("a-original");
		expect(vault.contentOf("c.md")).toBe("c edited by user after sync");
	});

	test("regression: without a signal, behaviour is unchanged (everything reverted, remainingRun empty)", async () => {
		const vault = new FakeVault({
			"a.md": { content: "a-original" },
			"b.md": { content: "b-original" },
		});
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "a-synced");
		await wrapped.write(vault.note("b.md"), "b-synced");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const { stats, remainingRun } = await undoRun(vault, run);

		expect(stats).toEqual({ reverted: 2, revertedRemote: 0, skipped: 0 });
		expect(remainingRun.actions).toHaveLength(0);
	});

	test("stops when the signal is aborted after the first action, leaving the unreached actions in remainingRun in original order", async () => {
		const vault = new FakeVault({
			"a.md": { content: "a-original" },
			"b.md": { content: "b-original" },
			"c.md": { content: "c-original" },
		});
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "a-synced");
		await wrapped.write(vault.note("b.md"), "b-synced");
		await wrapped.write(vault.note("c.md"), "c-synced");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const controller = new AbortController();
		const { stats, remainingRun } = await undoRun(
			vault,
			run,
			() => controller.abort(),
			controller.signal,
		);

		// Reverse processing order is c, b, a — only c gets processed before the abort is observed.
		expect(stats).toEqual({ reverted: 1, revertedRemote: 0, skipped: 0 });
		expect(vault.contentOf("c.md")).toBe("c-original");
		expect(vault.contentOf("a.md")).toBe("a-synced");
		expect(vault.contentOf("b.md")).toBe("b-synced");
		expect(remainingRun.actions.map((a) => a.path)).toEqual(["a.md", "b.md"]);
	});

	test("an already-aborted signal reverts nothing and returns the whole run as remaining", async () => {
		const vault = new FakeVault({
			"a.md": { content: "a-original" },
			"b.md": { content: "b-original" },
		});
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "a-synced");
		await wrapped.write(vault.note("b.md"), "b-synced");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const controller = new AbortController();
		controller.abort();
		const { stats, remainingRun } = await undoRun(vault, run, () => {}, controller.signal);

		expect(stats).toEqual({ reverted: 0, revertedRemote: 0, skipped: 0 });
		expect(vault.contentOf("a.md")).toBe("a-synced");
		expect(vault.contentOf("b.md")).toBe("b-synced");
		expect(remainingRun.actions.map((a) => a.path)).toEqual(["a.md", "b.md"]);
	});
});

describe("undoRunForNote", () => {
	test("only undoes actions for the given note, leaving the rest of the run intact", async () => {
		const vault = new FakeVault({
			"a.md": { content: "a-original" },
			"c.md": { content: "c-original" },
		});
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "a-synced");
		await wrapped.write(vault.note("c.md"), "c-synced");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const { stats, remainingRun } = await undoRunForNote(vault, run, "a.md");

		expect(stats).toEqual({ reverted: 1, revertedRemote: 0, skipped: 0 });
		expect(vault.contentOf("a.md")).toBe("a-original");
		expect(vault.contentOf("c.md")).toBe("c-synced");
		expect(remainingRun.actions).toHaveLength(1);
		expect(remainingRun.actions[0]?.path).toBe("c.md");
	});

	test("aborting mid-way keeps both the other-note actions and the unreached target-note actions, in original order", async () => {
		const vault = new FakeVault({
			"x.md": { content: "x-original" },
			"a.md": { content: "a-original" },
			"y.md": { content: "y-original" },
		});
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("x.md"), "x-synced"); // other note, action 1
		await wrapped.write(vault.note("a.md"), "a-synced-1"); // target note, action 2
		await wrapped.write(vault.note("a.md"), "a-synced-2"); // target note, action 3
		await wrapped.write(vault.note("y.md"), "y-synced"); // other note, action 4

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const controller = new AbortController();
		// Reverse order visits y (other, no log), then a's 2nd action (target, logs) — abort there.
		const { stats, remainingRun } = await undoRunForNote(vault, run, "a.md", () => controller.abort(), controller.signal);

		expect(stats).toEqual({ reverted: 1, revertedRemote: 0, skipped: 0 });
		expect(vault.contentOf("x.md")).toBe("x-synced");
		expect(vault.contentOf("y.md")).toBe("y-synced");
		expect(remainingRun.actions.map((a) => a.path)).toEqual(["x.md", "a.md", "y.md"]);
	});
});

describe("undoRun — Trello side", () => {
	function cardAction(overrides: Partial<TrelloCardUpdateAction> = {}): TrelloCardUpdateAction {
		return {
			kind: "trello-card",
			path: "a.md",
			cardId: "c1",
			previous: { name: "Old" },
			written: { name: "New" },
			...overrides,
		};
	}

	function checkItemAction(overrides: Partial<TrelloCheckItemAction> = {}): TrelloCheckItemAction {
		return {
			kind: "trello-checkitem",
			path: "a.md",
			cardId: "c1",
			checkItemId: "i1",
			previousState: "incomplete",
			writtenState: "complete",
			...overrides,
		};
	}

	test("reverts a trello-card write whose fields still match what the run wrote", async () => {
		const vault = new FakeVault({ "a.md": { content: "note" } });
		const { transport, requests } = routedTransport({
			"/cards/c1": card({ id: "c1", name: "New", desc: "", due: null, labels: [] }),
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const run: SyncRun = { timestamp: "t", scope: "", actions: [cardAction()] };
		const { stats } = await undoRun(vault, run, () => {}, undefined, client);

		expect(stats).toEqual({ reverted: 0, revertedRemote: 1, skipped: 0 });
		const put = requests.find((r) => r.method === "PUT" && r.url.includes("/cards/c1"));
		expect(put).toBeDefined();
		expect(put?.body).toContain("name=Old");
	});

	test("re-reads a card between two reverts that touch it, instead of trusting a stale snapshot", async () => {
		// Two successive pushes to the same card in one run: "orig" -> "mid" -> "final".
		// Undone in reverse, the second revert must see the state the first one just
		// produced ("mid"), not the snapshot taken before any revert ("final").
		const vault = new FakeVault({ "a.md": { content: "note" } });
		let remoteName = "final";
		const transport = async (request: HttpRequest): Promise<HttpResponse> => {
			if (request.method === "PUT") {
				const sent = new URLSearchParams(request.body ?? "").get("name");
				if (sent !== null) remoteName = sent;
				return { status: 200, text: "{}" };
			}
			return { status: 200, text: JSON.stringify(card({ id: "c1", name: remoteName, desc: "", due: null, labels: [] })) };
		};
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const run: SyncRun = {
			timestamp: "t",
			scope: "",
			actions: [
				cardAction({ previous: { name: "orig" }, written: { name: "mid" } }),
				cardAction({ previous: { name: "mid" }, written: { name: "final" } }),
			],
		};
		const { stats } = await undoRun(vault, run, () => {}, undefined, client);

		expect(stats).toEqual({ reverted: 0, revertedRemote: 2, skipped: 0 });
		expect(remoteName).toBe("orig");
	});

	test("skips a trello-card write whose remote field changed since the run", async () => {
		const vault = new FakeVault({ "a.md": { content: "note" } });
		const { transport, requests } = routedTransport({
			"/cards/c1": card({ id: "c1", name: "SomethingElse", desc: "", due: null, labels: [] }),
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const run: SyncRun = { timestamp: "t", scope: "", actions: [cardAction()] };
		const { stats } = await undoRun(vault, run, () => {}, undefined, client);

		expect(stats).toEqual({ reverted: 0, revertedRemote: 0, skipped: 1 });
		expect(requests.some((r) => r.method === "PUT")).toBe(false);
	});

	test("reverts a trello-checkitem write whose state still matches what the run wrote", async () => {
		const vault = new FakeVault({ "a.md": { content: "note" } });
		const { transport, requests } = routedTransport({
			"/cards/c1/checklists": [{ id: "cl1", name: "Steps", checkItems: [{ id: "i1", name: "Step 1", state: "complete" }] }],
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const run: SyncRun = { timestamp: "t", scope: "", actions: [checkItemAction()] };
		const { stats } = await undoRun(vault, run, () => {}, undefined, client);

		expect(stats).toEqual({ reverted: 0, revertedRemote: 1, skipped: 0 });
		const put = requests.find((r) => r.method === "PUT" && r.url.includes("/checkItem/i1"));
		expect(put).toBeDefined();
		expect(put?.body).toContain("state=incomplete");
	});

	test("skips a Trello action with no connection message when no client is supplied", async () => {
		const vault = new FakeVault({ "a.md": { content: "note" } });
		const logs: Array<{ level: string; message: string }> = [];

		const run: SyncRun = { timestamp: "t", scope: "", actions: [cardAction()] };
		const { stats } = await undoRun(vault, run, (level, message) => logs.push({ level, message }));

		expect(stats).toEqual({ reverted: 0, revertedRemote: 0, skipped: 1 });
		expect(logs).toContainEqual({ level: "skip", message: "a.md — Trello revert needs a connection" });
	});

	test("a 404 fetching the current card state is skipped, not thrown, and the rest of the run still runs", async () => {
		const vault = new FakeVault({ "b.md": { content: "note" } });
		const { wrapped, actions } = (() => {
			const captured: SyncAction[] = [];
			const w = wrapWithHistoryRecorder(vault, (a) => captured.push(a));
			return { wrapped: w, actions: captured };
		})();
		await wrapped.write(vault.note("b.md"), "b-synced");

		// No route for /cards/c1 → the fake transport answers 404, so getCard throws.
		const { transport } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const run: SyncRun = {
			timestamp: "t",
			scope: "",
			actions: [cardAction({ path: "gone-card.md" }), ...actions],
		};
		const logs: Array<{ level: string; message: string }> = [];
		const { stats } = await undoRun(vault, run, (level, message) => logs.push({ level, message }), undefined, client);

		// The Trello action failed to fetch and was skipped, but the vault action after it still ran.
		expect(stats).toEqual({ reverted: 1, revertedRemote: 0, skipped: 1 });
		expect(vault.contentOf("b.md")).toBe("note");
		expect(logs.some((l) => l.level === "skip")).toBe(true);
	});

	test("aborting while reading a card's current state reports cancelled, not card no longer exists", async () => {
		const vault = new FakeVault({ "a.md": { content: "note" } });
		const controller = new AbortController();
		const transport = async (): Promise<HttpResponse> => {
			// Simulates the abort happening mid-flight, inside the network call itself.
			controller.abort();
			throw new DOMException("Aborted", "AbortError");
		};
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const run: SyncRun = { timestamp: "t", scope: "", actions: [cardAction()] };
		const logs: Array<{ level: string; message: string }> = [];
		const { stats } = await undoRun(
			vault,
			run,
			(level, message) => logs.push({ level, message }),
			controller.signal,
			client,
		);

		expect(stats).toEqual({ reverted: 0, revertedRemote: 0, skipped: 1 });
		expect(logs).toContainEqual({ level: "skip", message: "a.md — cancelled" });
		expect(logs.some((l) => l.message.includes("card no longer exists"))).toBe(false);
	});

	test("a card genuinely gone (never aborted) is still reported as card no longer exists", async () => {
		const vault = new FakeVault({ "a.md": { content: "note" } });
		// No route for /cards/c1 → the fake transport answers 404, so getCard throws — no abort involved.
		const { transport } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const run: SyncRun = { timestamp: "t", scope: "", actions: [cardAction()] };
		const logs: Array<{ level: string; message: string }> = [];
		const { stats } = await undoRun(vault, run, (level, message) => logs.push({ level, message }), undefined, client);

		expect(stats).toEqual({ reverted: 0, revertedRemote: 0, skipped: 1 });
		expect(logs).toContainEqual({ level: "skip", message: "a.md — card no longer exists" });
	});

	test("regression: a vault-only run behaves exactly as before even when a client is passed", async () => {
		const vault = new FakeVault({ "a.md": { content: "a-original" } });
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "a-synced");

		const { transport } = routedTransport({});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const { stats } = await undoRun(vault, run, () => {}, undefined, client);

		expect(stats).toEqual({ reverted: 1, revertedRemote: 0, skipped: 0 });
		expect(vault.contentOf("a.md")).toBe("a-original");
	});
});

describe("undoSelectedActions", () => {
	test("undoes only the actions at the selected indices, leaving the others in the run untouched and in place", async () => {
		const vault = new FakeVault({
			"a.md": { content: "a-original" },
			"b.md": { content: "b-original" },
			"c.md": { content: "c-original" },
		});
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "a-synced"); // index 0
		await wrapped.write(vault.note("b.md"), "b-synced"); // index 1
		await wrapped.write(vault.note("c.md"), "c-synced"); // index 2

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const selected = new Set([0, 2]);
		const { stats, remainingRun } = await undoSelectedActions(vault, run, (_action, index) => selected.has(index));

		expect(stats).toEqual({ reverted: 2, revertedRemote: 0, skipped: 0 });
		expect(vault.contentOf("a.md")).toBe("a-original");
		expect(vault.contentOf("b.md")).toBe("b-synced");
		expect(vault.contentOf("c.md")).toBe("c-original");
		expect(remainingRun.actions.map((a) => a.path)).toEqual(["b.md"]);
	});

	test("a selected action that gets skipped (note changed since the run) leaves the run, same as before undoSelectedActions existed", async () => {
		const vault = new FakeVault({
			"a.md": { content: "a-original" },
			"b.md": { content: "b-original" },
		});
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "a-synced"); // index 0
		await wrapped.write(vault.note("b.md"), "b-synced"); // index 1

		// The user edits "a.md" after the sync ran — its undo will be skipped.
		await vault.write(vault.note("a.md"), "user's own edit");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const { stats, remainingRun } = await undoSelectedActions(vault, run, () => true);

		expect(stats).toEqual({ reverted: 1, revertedRemote: 0, skipped: 1 });
		expect(vault.contentOf("a.md")).toBe("user's own edit");
		expect(vault.contentOf("b.md")).toBe("b-original");
		// A skipped undo would be skipped again next time (the note still diverges),
		// so keeping it would pin this run as "last" forever and block "Undo last sync run".
		expect(remainingRun.actions).toEqual([]);
	});

	test("empty selection: no writes, history unchanged", async () => {
		const vault = new FakeVault({ "a.md": { content: "a-original" } });
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "a-synced");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const { stats, remainingRun } = await undoSelectedActions(vault, run, () => false);

		expect(stats).toEqual({ reverted: 0, revertedRemote: 0, skipped: 0 });
		expect(vault.contentOf("a.md")).toBe("a-synced");
		expect(remainingRun).toEqual(run);
	});

	test("selecting every action empties the run", async () => {
		const vault = new FakeVault({ "a.md": { content: "a-original" } });
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "a-synced");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const { stats, remainingRun } = await undoSelectedActions(vault, run, () => true);

		expect(stats).toEqual({ reverted: 1, revertedRemote: 0, skipped: 0 });
		expect(remainingRun.actions).toHaveLength(0);
	});

	test("covers Trello action kinds: a selected trello-card action reverts, an unselected trello-checkitem action stays", async () => {
		const vault = new FakeVault({ "a.md": { content: "note" } });
		const { transport, requests } = routedTransport({
			"/cards/c1": card({ id: "c1", name: "New", desc: "", due: null, labels: [] }),
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);

		const cardAction: TrelloCardUpdateAction = {
			kind: "trello-card",
			path: "a.md",
			cardId: "c1",
			previous: { name: "Old" },
			written: { name: "New" },
		};
		const checkItemAction: TrelloCheckItemAction = {
			kind: "trello-checkitem",
			path: "a.md",
			cardId: "c1",
			checkItemId: "i1",
			previousState: "incomplete",
			writtenState: "complete",
		};
		const run: SyncRun = { timestamp: "t", scope: "", actions: [checkItemAction, cardAction] };

		const { stats, remainingRun } = await undoSelectedActions(
			vault,
			run,
			(action) => action.kind === "trello-card",
			() => {},
			undefined,
			client,
		);

		expect(stats).toEqual({ reverted: 0, revertedRemote: 1, skipped: 0 });
		const put = requests.find((r) => r.method === "PUT" && r.url.includes("/cards/c1"));
		expect(put).toBeDefined();
		expect(remainingRun.actions).toEqual([checkItemAction]);
	});

	test("aborting mid-way keeps unselected actions, the not-yet-reached selected actions, and preserves original order", async () => {
		const vault = new FakeVault({
			"a.md": { content: "a-original" },
			"b.md": { content: "b-original" },
			"c.md": { content: "c-original" },
		});
		const { wrapped, actions } = record(vault);
		await wrapped.write(vault.note("a.md"), "a-synced"); // index 0, not selected
		await wrapped.write(vault.note("b.md"), "b-synced"); // index 1, selected
		await wrapped.write(vault.note("c.md"), "c-synced"); // index 2, selected

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const controller = new AbortController();
		const selected = new Set([1, 2]);
		// Reverse order visits c first (selected) — its log callback aborts before b is reached.
		const { stats, remainingRun } = await undoSelectedActions(
			vault,
			run,
			(_action, index) => selected.has(index),
			() => controller.abort(),
			controller.signal,
		);

		expect(stats).toEqual({ reverted: 1, revertedRemote: 0, skipped: 0 });
		expect(vault.contentOf("c.md")).toBe("c-original");
		expect(vault.contentOf("b.md")).toBe("b-synced");
		expect(vault.contentOf("a.md")).toBe("a-synced");
		expect(remainingRun.actions.map((a) => a.path)).toEqual(["a.md", "b.md"]);
	});
});
