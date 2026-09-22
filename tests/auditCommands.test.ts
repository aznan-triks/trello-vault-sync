import { describe, expect, test } from "vitest";
import { runChangesHtmlExport } from "../src/commands/auditCommands";
import type { CommandContext } from "../src/commands/context";
import { silentReporter } from "../src/obsidian/gateway";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { FakeVault, clientFor } from "./fakes";

/** Just enough of `CommandContext` for `runChangesHtmlExport` to run — `run()` invokes the body directly, no panel. */
function fakeContext(overrides: Partial<CommandContext> = {}): CommandContext {
	const { client } = clientFor([], [], []);
	return {
		app: {} as CommandContext["app"],
		vault: new FakeVault(),
		settings: { ...DEFAULT_SETTINGS, boardId: "board", changesHtmlPath: "Changes.html", auditChangesCursor: "prev-cursor" },
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

describe("runChangesHtmlExport", () => {
	test("never advances auditChangesCursor, unlike the Markdown audit", async () => {
		const ctx = fakeContext();

		await runChangesHtmlExport(ctx);

		expect(ctx.settings.auditChangesCursor).toBe("prev-cursor");
	});
});

describe("audit commands routing to dedicated report notes", () => {
	test("runLinkAudit requests auditOptions with kind 'links'", async () => {
		let requestedKind: string | undefined;
		const ctx = fakeContext({
			auditOptions: (kind) => {
				requestedKind = kind;
				return { scope: "", boardId: "board", reportPath: "LinkReport.md", timestamp: "t" };
			},
		});
		(ctx.vault as FakeVault).create("LinkReport.md", "# Report");

		const { runLinkAudit } = await import("../src/commands/auditCommands");
		await runLinkAudit(ctx);

		expect(requestedKind).toBe("links");
	});

	test("runLocationAudit requests auditOptions with kind 'locations'", async () => {
		let requestedKind: string | undefined;
		const ctx = fakeContext({
			auditOptions: (kind) => {
				requestedKind = kind;
				return { scope: "", boardId: "board", reportPath: "LocationReport.md", timestamp: "t" };
			},
		});
		(ctx.vault as FakeVault).create("LocationReport.md", "# Report");

		const { runLocationAudit } = await import("../src/commands/auditCommands");
		await runLocationAudit(ctx);

		expect(requestedKind).toBe("locations");
	});

	test("runChangesAudit requests auditOptions with kind 'changes'", async () => {
		let requestedKind: string | undefined;
		const ctx = fakeContext({
			auditOptions: (kind) => {
				requestedKind = kind;
				return { scope: "", boardId: "board", reportPath: "ChangesReport.md", timestamp: "t" };
			},
		});
		(ctx.vault as FakeVault).create("ChangesReport.md", "# Report");

		const { runChangesAudit } = await import("../src/commands/auditCommands");
		await runChangesAudit(ctx);

		expect(requestedKind).toBe("changes");
	});
});
