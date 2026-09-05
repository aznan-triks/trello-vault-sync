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
		client: () => client,
		fetchBinary: async () => null,
		run: async (_title, body) => {
			await body(silentReporter, new AbortController().signal);
		},
		activeNote: () => null,
		ready: () => true,
		noteOptions: () => ({ policy: "newer-wins", marginMs: 0, syncTitle: true, dryRun: false }),
		folderOptions: () => ({
			policy: "newer-wins",
			marginMs: 0,
			syncTitle: true,
			dryRun: false,
			allowCreate: true,
			allowDelete: false,
			boardId: "board",
		}),
		auditOptions: () => ({ scope: "", boardId: "board", reportPath: "", timestamp: "t", excludedFolders: [] }),
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
