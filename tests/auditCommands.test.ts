import { describe, expect, test, vi } from "vitest";

const notices: string[] = [];
vi.mock("obsidian", () => ({
	Notice: class Notice {
		constructor(message?: string) {
			notices.push(message ?? "");
		}
	},
}));

import { openLinkReport, runChangesHtmlExport } from "../src/commands/auditCommands";
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

describe("openLinkReport", () => {
	function ctxWith(vault: FakeVault, reportPath: string, opened: string[]): CommandContext {
		return {
			vault,
			app: { workspace: { openLinkText: async (path: string) => void opened.push(path) } },
			auditOptions: () => ({ reportPath }),
		} as unknown as CommandContext;
	}

	test("opens the report note when it exists", async () => {
		const vault = new FakeVault({ "Audit/links.md": { content: "# report" } });
		const opened: string[] = [];
		await openLinkReport(ctxWith(vault, "Audit/links.md", opened));
		expect(opened).toEqual(["Audit/links.md"]);
	});

	test("tells the user to run the audit first when the report is missing", async () => {
		const opened: string[] = [];
		notices.length = 0;
		await openLinkReport(ctxWith(new FakeVault(), "Audit/links.md", opened));
		expect(opened).toEqual([]);
		expect(notices[0]).toContain("Run \"Audit links");
	});
});
