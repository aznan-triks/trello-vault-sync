import { describe, expect, test } from "vitest";
import type { CommandContext } from "../src/commands/context";
import { withHistoryRecording } from "../src/commands/syncHistoryHelper";
import type { SyncAction } from "../src/core/syncHistory";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { FakeVault } from "./fakes";

/** Just enough of `CommandContext` for `withHistoryRecording` — it only reads `settings`/`vault` and calls `recordSyncRun`. */
function fakeContext(historyEnabled: boolean, recorded: Array<{ scope: string; actions: SyncAction[] }>): CommandContext {
	return {
		vault: new FakeVault({ "a.md": { content: "body" } }),
		settings: { ...DEFAULT_SETTINGS, historyEnabled },
		recordSyncRun: async (scope: string, actions: SyncAction[]) => {
			recorded.push({ scope, actions });
		},
	} as unknown as CommandContext;
}

describe("withHistoryRecording", () => {
	test("records both vault and Trello writes in one run, interleaved in call order", async () => {
		const recorded: Array<{ scope: string; actions: SyncAction[] }> = [];
		const ctx = fakeContext(true, recorded);

		await withHistoryRecording(ctx, "a.md", async (vault, onTrelloWrite) => {
			expect(onTrelloWrite).toBeDefined();
			onTrelloWrite?.({
				kind: "trello-card",
				path: "a.md",
				cardId: "c1",
				previous: { desc: "before" },
				written: { desc: "after" },
			});
			await vault.write(vault.noteAt("a.md")!, "new body");
			return "done";
		});

		expect(recorded).toHaveLength(1);
		expect(recorded[0]?.actions.map((action) => action.kind)).toEqual(["trello-card", "body"]);
	});

	test("hands no Trello recorder to the body when sync history is disabled", async () => {
		const recorded: Array<{ scope: string; actions: SyncAction[] }> = [];
		const ctx = fakeContext(false, recorded);

		await withHistoryRecording(ctx, "a.md", async (vault, onTrelloWrite) => {
			// Undefined, so a sync passes `onTrelloWrite: undefined` in its options and
			// `syncNote` records nothing — the same way the vault is left unwrapped.
			expect(onTrelloWrite).toBeUndefined();
			await vault.write(vault.noteAt("a.md")!, "new body");
			return "done";
		});

		expect(recorded).toHaveLength(1);
		expect(recorded[0]?.actions).toEqual([]);
	});
});
