import { describe, expect, test, vi } from "vitest";

// `historyCommands.ts` imports `Notice` from `obsidian`, which under vitest
// resolves to a types-only package with no runtime module. A bare stub is
// enough since these commands only ever construct it for user-facing text.
vi.mock("obsidian", () => ({
	Notice: class Notice {
		constructor(_message?: string) {}
	},
}));

import { undoLastSyncRun } from "../src/commands/historyCommands";
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
		settings: { ...DEFAULT_SETTINGS, boardId: "board" },
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
