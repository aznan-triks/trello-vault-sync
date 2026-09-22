import { describe, expect, test, vi } from "vitest";

// `historyCommands.ts` imports `Notice` from `obsidian`, which under vitest
// resolves to a types-only package with no runtime module. A bare stub is
// enough since these commands only ever construct it for user-facing text.
vi.mock("obsidian", () => ({
	Notice: class Notice {
		constructor(_message?: string) {}
	},
}));

// `SyncRunPickerModal`/`SyncActionPickerModal` are real UI classes (they extend
// obsidian's `FuzzySuggestModal`/`Modal`, stubbed above just enough for
// `Notice`). Swapped here for bare fakes that capture the constructor
// callback so a test can drive the two-step pick without any DOM.
let lastRunPicker: { runs: readonly SyncRun[]; onPick: (run: SyncRun) => void } | undefined;
let lastActionPicker: { run: SyncRun; onConfirm: (selected: ReadonlySet<number>) => void } | undefined;

// `ConfirmModal` is a real UI class extending obsidian's `Modal`. Swapped for
// a bare fake that captures the confirm callback instead of opening any DOM,
// so a test can assert the gate opened without confirming it, or confirm it
// on demand. Read through `currentConfirm()` rather than the field directly —
// TypeScript's control-flow narrowing otherwise pins the field to `undefined`
// across the `await` that lets the mocked constructor below actually set it,
// and then reports the property access as an error on type `never`; a
// function call's return type isn't narrowed that way.
const confirmBox: { current: { message: string; confirmLabel: string; onConfirm: () => void } | undefined } = {
	current: undefined,
};
function currentConfirm(): { message: string; confirmLabel: string; onConfirm: () => void } | undefined {
	return confirmBox.current;
}

vi.mock("../src/ui/ConfirmModal", () => ({
	ConfirmModal: class {
		constructor(
			_app: unknown,
			message: string,
			onConfirm: () => void,
			confirmLabel = "Continue",
		) {
			confirmBox.current = { message, confirmLabel, onConfirm };
		}
		open(): void {}
	},
}));

vi.mock("../src/ui/SyncRunPickerModal", () => ({
	SyncRunPickerModal: class {
		constructor(
			_app: unknown,
			runs: readonly SyncRun[],
			onPick: (run: SyncRun) => void,
		) {
			lastRunPicker = { runs, onPick };
		}
		open(): void {}
	},
}));

vi.mock("../src/ui/SyncActionPickerModal", () => ({
	SyncActionPickerModal: class {
		constructor(
			_app: unknown,
			run: SyncRun,
			onConfirm: (selected: ReadonlySet<number>) => void,
		) {
			lastActionPicker = { run, onConfirm };
		}
		open(): void {}
	},
}));

import { undoLastSyncRun, undoLastSyncForActiveNote, undoSyncRunPicked } from "../src/commands/historyCommands";
import type { CommandContext } from "../src/commands/context";
import type { SyncAction, SyncRun } from "../src/core/syncHistory";
import { silentReporter } from "../src/obsidian/gateway";
import { wrapWithHistoryRecorder } from "../src/features/syncHistoryRecorder";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { FakeVault, clientFor } from "./fakes";

/** Just enough of `CommandContext` for the history commands to run — `run()` invokes the body directly, no panel. */
function fakeContext(overrides: Partial<CommandContext> = {}): CommandContext {
	const { client } = clientFor([], [], []);
	return {
		app: {} as CommandContext["app"],
		vault: new FakeVault(),
		// `confirmUndo` defaults to on; set explicitly to false here so these
		// tests keep exercising the undo directly, without a `ConfirmModal` in
		// the way (that gate is covered on its own further down).
		settings: { ...DEFAULT_SETTINGS, boardId: "board", confirmUndo: false },
		journal: [],
		history: [],
		recordSyncRun: async () => {},
		setHistory: async () => {},
		client: () => client,
		fetchBinary: async () => null,
		run: async (_title, body) => {
			await body(silentReporter, new AbortController().signal);
		},
		activeNote: () => null,
		isSyncing: () => false,
		ready: () => true,
		noteOptions: () => ({ policy: "newer-wins", marginMs: 0, syncTitle: true, dryRun: false }),
		folderOptions: () => ({
			policy: "newer-wins",
			marginMs: 0,
			syncTitle: true,
			dryRun: false,
			allowCreate: true,
			allowDelete: false,
			protectMovedOrArchivedCards: false,
			boardId: "board",
		}),
		auditOptions: () => ({ scope: "", boardId: "board", reportPath: "", timestamp: "t", excludedFolders: [] }),
		activateSidebarView: async () => {},
		saveSettings: async () => {},
		...overrides,
	};
}

describe("undoLastSyncRun", () => {
	test("passes the abort signal through to undoRun: an already-aborted signal reverts nothing", async () => {
		const vault = new FakeVault({ "a.md": { content: "original" } });
		const actions: SyncAction[] = [];
		const wrapped = wrapWithHistoryRecorder(vault, (a) => actions.push(a));
		await wrapped.write(vault.note("a.md"), "synced");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		let historyAfter: readonly SyncRun[] | undefined;

		const ctx = fakeContext({
			vault,
			history: [run],
			setHistory: async (next) => {
				historyAfter = next;
			},
			// Body receives an already-aborted signal, exactly what `run()` would
			// hand it if the user hit Cancel before the undo started.
			run: async (_title, body) => {
				const controller = new AbortController();
				controller.abort();
				await body(silentReporter, controller.signal);
			},
		});

		await undoLastSyncRun(ctx);

		// Nothing reverted: the note keeps the synced content, not the original.
		expect(vault.contentOf("a.md")).toBe("synced");
		// The whole run is carried over untouched, ready to retry.
		expect(historyAfter).toEqual([run]);
	});

	test("with a live signal, undoes the run as usual", async () => {
		const vault = new FakeVault({ "a.md": { content: "original" } });
		const actions: SyncAction[] = [];
		const wrapped = wrapWithHistoryRecorder(vault, (a) => actions.push(a));
		await wrapped.write(vault.note("a.md"), "synced");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		let historyAfter: readonly SyncRun[] | undefined;

		const ctx = fakeContext({
			vault,
			history: [run],
			setHistory: async (next) => {
				historyAfter = next;
			},
		});

		await undoLastSyncRun(ctx);

		expect(vault.contentOf("a.md")).toBe("original");
		expect(historyAfter).toEqual([]);
	});
});

describe("undoSyncRunPicked", () => {
	test("undoes only the checked actions of the picked run, wherever it sits in history, and leaves the rest untouched", async () => {
		const vault = new FakeVault({
			"a.md": { content: "a-original" },
			"b.md": { content: "b-original" },
		});
		const actions: SyncAction[] = [];
		const wrapped = wrapWithHistoryRecorder(vault, (a) => actions.push(a));
		await wrapped.write(vault.note("a.md"), "a-synced"); // index 0
		await wrapped.write(vault.note("b.md"), "b-synced"); // index 1

		const olderRun: SyncRun = { timestamp: "t0", scope: "older", actions: [] };
		const targetRun: SyncRun = { timestamp: "t1", scope: "", actions };
		let historyAfter: readonly SyncRun[] | undefined;

		const ctx = fakeContext({
			vault,
			history: [olderRun, targetRun],
			setHistory: async (next) => {
				historyAfter = next;
			},
		});

		await undoSyncRunPicked(ctx);
		expect(lastRunPicker?.runs).toEqual([olderRun, targetRun]);
		lastRunPicker?.onPick(targetRun);
		expect(lastActionPicker?.run).toBe(targetRun);

		// Only "a.md" (index 0) is checked — "b.md" stays synced and its action stays in the run.
		lastActionPicker?.onConfirm(new Set([0]));
		await vi.waitFor(() => expect(historyAfter).toBeDefined());

		expect(vault.contentOf("a.md")).toBe("a-original");
		expect(vault.contentOf("b.md")).toBe("b-synced");
		expect(historyAfter).toEqual([olderRun, { ...targetRun, actions: [actions[1]] }]);
	});

	test("empty selection: no writes, history unchanged, no undo triggered", async () => {
		const vault = new FakeVault({ "a.md": { content: "a-original" } });
		const actions: SyncAction[] = [];
		const wrapped = wrapWithHistoryRecorder(vault, (a) => actions.push(a));
		await wrapped.write(vault.note("a.md"), "a-synced");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		let setHistoryCalled = false;
		const ctx = fakeContext({
			vault,
			history: [run],
			setHistory: async () => {
				setHistoryCalled = true;
			},
		});

		await undoSyncRunPicked(ctx);
		lastRunPicker?.onPick(run);
		lastActionPicker?.onConfirm(new Set());

		expect(vault.contentOf("a.md")).toBe("a-synced");
		expect(setHistoryCalled).toBe(false);
	});

	test("does nothing when history is empty", async () => {
		lastRunPicker = undefined;
		const ctx = fakeContext({ history: [] });

		await undoSyncRunPicked(ctx);

		expect(lastRunPicker).toBeUndefined();
	});

	test("does nothing when sync history is disabled in settings", async () => {
		lastRunPicker = undefined;
		const run: SyncRun = { timestamp: "t", scope: "", actions: [] };
		const ctx = fakeContext({
			history: [run],
			settings: { ...DEFAULT_SETTINGS, boardId: "board", historyEnabled: false },
		});

		await undoSyncRunPicked(ctx);

		expect(lastRunPicker).toBeUndefined();
	});
});

describe("confirmUndo", () => {
	test("undoLastSyncRun: on, asks for confirmation first and reverts nothing until confirmed", async () => {
		confirmBox.current = undefined;
		const vault = new FakeVault({ "a.md": { content: "original" } });
		const actions: SyncAction[] = [];
		const wrapped = wrapWithHistoryRecorder(vault, (a) => actions.push(a));
		await wrapped.write(vault.note("a.md"), "synced");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		let historyAfter: readonly SyncRun[] | undefined;

		const ctx = fakeContext({
			vault,
			history: [run],
			settings: { ...DEFAULT_SETTINGS, boardId: "board", confirmUndo: true },
			setHistory: async (next) => {
				historyAfter = next;
			},
		});

		await undoLastSyncRun(ctx);

		// Not reverted yet — waiting on the (mocked) modal's own confirm click.
		expect(vault.contentOf("a.md")).toBe("synced");
		expect(historyAfter).toBeUndefined();
		expect(currentConfirm()).toBeDefined();

		const confirm = currentConfirm();
		confirm?.onConfirm();
		await vi.waitFor(() => expect(historyAfter).toBeDefined());
		expect(vault.contentOf("a.md")).toBe("original");
	});

	test("undoLastSyncForActiveNote: on, asks for confirmation first", async () => {
		confirmBox.current = undefined;
		const vault = new FakeVault({ "a.md": { content: "original" } });
		const actions: SyncAction[] = [];
		const wrapped = wrapWithHistoryRecorder(vault, (a) => actions.push(a));
		await wrapped.write(vault.note("a.md"), "synced");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		let historyAfter: readonly SyncRun[] | undefined;

		const ctx = fakeContext({
			vault,
			history: [run],
			settings: { ...DEFAULT_SETTINGS, boardId: "board", confirmUndo: true },
			activeNote: () => ({ path: "a.md", basename: "a" }) as never,
			setHistory: async (next) => {
				historyAfter = next;
			},
		});

		await undoLastSyncForActiveNote(ctx);

		expect(vault.contentOf("a.md")).toBe("synced");
		expect(currentConfirm()).toBeDefined();

		const confirm = currentConfirm();
		confirm?.onConfirm();
		await vi.waitFor(() => expect(historyAfter).toBeDefined());
		expect(vault.contentOf("a.md")).toBe("original");
	});

	test("off, undoes immediately with no modal", async () => {
		confirmBox.current = undefined;
		const vault = new FakeVault({ "a.md": { content: "original" } });
		const actions: SyncAction[] = [];
		const wrapped = wrapWithHistoryRecorder(vault, (a) => actions.push(a));
		await wrapped.write(vault.note("a.md"), "synced");

		const run: SyncRun = { timestamp: "t", scope: "", actions };
		const ctx = fakeContext({
			vault,
			history: [run],
			settings: { ...DEFAULT_SETTINGS, boardId: "board", confirmUndo: false },
		});

		await undoLastSyncRun(ctx);

		expect(currentConfirm()).toBeUndefined();
		expect(vault.contentOf("a.md")).toBe("original");
	});
});

describe("historyRevertTrelloWrites", () => {
	test("off: undoLastSyncRun skips Trello actions as disabled in settings, not as missing a connection", async () => {
		const vault = new FakeVault();
		const trelloAction: SyncAction = {
			kind: "trello-card",
			path: "a.md",
			cardId: "c1",
			previous: { name: "old" },
			written: { name: "new" },
		};
		const run: SyncRun = { timestamp: "t", scope: "", actions: [trelloAction] };
		const logs: Array<{ level: string; message: string }> = [];

		const ctx = fakeContext({
			vault,
			history: [run],
			settings: { ...DEFAULT_SETTINGS, boardId: "board", confirmUndo: false, historyRevertTrelloWrites: false },
			run: async (_title, body) => {
				await body(
					{
						setTotal: () => {},
						step: () => {},
						count: () => {},
						log: (level, message) => logs.push({ level, message }),
						finish: () => {},
					},
					new AbortController().signal,
				);
			},
		});

		await undoLastSyncRun(ctx);

		expect(logs).toContainEqual({ level: "skip", message: "a.md — Trello revert disabled in settings" });
		expect(logs.some((entry) => entry.message.includes("needs a connection"))).toBe(false);
	});
});
