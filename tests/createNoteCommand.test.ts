import { describe, expect, test, vi } from "vitest";

// `createNoteCommand.ts` pulls in `CardPickerModal`/`FolderPickerModal`, which
// extend obsidian's `FuzzySuggestModal`/`Modal` — neither resolves under vitest
// (the "obsidian" package ships type declarations only). `createInFolder` never
// instantiates either modal, so a bare stub that only needs to satisfy `extends`
// is enough (same pattern as tests/noteCommands.test.ts).
vi.mock("obsidian", () => ({
	Notice: class Notice {
		constructor(_message?: string) {}
	},
	Modal: class Modal {
		constructor(_app: unknown) {}
	},
	FuzzySuggestModal: class FuzzySuggestModal {
		constructor(_app: unknown) {}
		setPlaceholder(_text: string): void {}
	},
	AbstractInputSuggest: class AbstractInputSuggest {
		constructor(_app: unknown, _inputEl: unknown) {}
	},
}));

import { createInFolder } from "../src/commands/createNoteCommand";
import type { CommandContext } from "../src/commands/context";
import { card, FakeVault, recordingReporter, routedTransport } from "./fakes";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { TrelloClient } from "../src/trello/client";

function fakeContext(overrides: Partial<CommandContext> = {}): CommandContext {
	const vault = new FakeVault();
	return {
		app: {} as CommandContext["app"],
		vault,
		settings: { ...DEFAULT_SETTINGS, boardId: "board" },
		journal: [],
		history: [],
		recordSyncRun: async () => {},
		setHistory: async () => {},
		client: () => new TrelloClient({ apiKey: "k", token: "t" }, routedTransport({}).transport),
		fetchBinary: async () => null,
		run: async (_title, body) => {
			await body(recordingReporter(), new AbortController().signal);
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

describe("createInFolder", () => {
	test("warns when the configured template has no card-ref key", async () => {
		const vault = new FakeVault();
		vault.templates.set("idée (script)", "---\ntype: idée\n---\n{{DESCRIPTION}}");
		const reporter = recordingReporter();
		const ctx = fakeContext({
			vault,
			settings: {
				...DEFAULT_SETTINGS,
				boardId: "board",
				mappings: [{ listId: "l1", folder: "WoT/85_Idées", templateName: "idée (script)" }],
			},
			run: async (_title, body) => {
				await body(reporter, new AbortController().signal);
			},
		});

		await createInFolder(ctx, card({ id: "c1", idList: "l1", name: "Sagondo" }), "WoT/85_Idées");

		const warnings = reporter.logs.filter((entry) => entry.message.includes("trello_board_card_id"));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.level).toBe("warn");
	});

	test("does not warn when the configured template has the card-ref key", async () => {
		const vault = new FakeVault();
		vault.templates.set(
			"idée (script)",
			'---\ntrello_board_card_id: "{{BOARD_ID}};{{CARD_ID}}"\n---\n{{DESCRIPTION}}',
		);
		const reporter = recordingReporter();
		const ctx = fakeContext({
			vault,
			settings: {
				...DEFAULT_SETTINGS,
				boardId: "board",
				mappings: [{ listId: "l1", folder: "WoT/85_Idées", templateName: "idée (script)" }],
			},
			run: async (_title, body) => {
				await body(reporter, new AbortController().signal);
			},
		});

		await createInFolder(ctx, card({ id: "c1", idList: "l1", name: "Sagondo" }), "WoT/85_Idées");

		expect(reporter.logs.filter((entry) => entry.level === "warn")).toHaveLength(0);
	});
});
