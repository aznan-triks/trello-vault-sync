import { describe, expect, test, vi } from "vitest";

// `noteCommands.ts` pulls in `obsidian` (for `Notice`) and, transitively via
// `CardPickerModal`/`ConflictModal`, `FuzzySuggestModal`/`Modal` — none of
// which resolve to a real module under vitest (the "obsidian" package ships
// type declarations only). `syncActive` itself never instantiates either
// modal, so a bare stub that only needs to satisfy `extends` is enough.
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
}));

import { syncActive } from "../src/commands/noteCommands";
import type { CommandContext } from "../src/commands/context";
import { silentReporter } from "../src/obsidian/gateway";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { TrelloClient } from "../src/trello/client";
import { card, FakeVault, routedTransport } from "./fakes";

const PATH = "note.md";
const FRONTMATTER = '---\ntrello_board_card_id: "board;c1"\n---\n\nold body';

/** Just enough of `CommandContext` for `syncActive` to run — `run()` invokes the body directly, no panel. */
function fakeContext(overrides: Partial<CommandContext> = {}): CommandContext {
	const { transport } = routedTransport({ "/cards/c1": card({ id: "c1", name: "Card", desc: "remote body" }) });
	const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
	return {
		app: {} as CommandContext["app"],
		vault: new FakeVault({ [PATH]: { content: FRONTMATTER } }),
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
		activeNote: () => ({ path: PATH, basename: "note", folder: "", mtime: 0 }),
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

describe("syncActive", () => {
	test("with an already-aborted signal, forwards it into syncNote and makes no Trello request", async () => {
		const vault = new FakeVault({ [PATH]: { content: FRONTMATTER } });
		const { transport, requests } = routedTransport({
			"/cards/c1": card({ id: "c1", name: "Card", desc: "remote body" }),
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const ctx = fakeContext({
			vault,
			client: () => client,
			run: async (_title, body) => {
				const controller = new AbortController();
				controller.abort();
				await body(silentReporter, controller.signal);
			},
		});

		await syncActive(ctx);

		expect(requests).toHaveLength(0);
		expect(vault.contentOf(PATH)).toBe(FRONTMATTER);
	});

	test("with a live signal, syncs as usual and reaches the Trello card", async () => {
		const vault = new FakeVault({ [PATH]: { content: FRONTMATTER } });
		const { transport, requests } = routedTransport({
			"/cards/c1": card({ id: "c1", name: "Card", desc: "remote body" }),
		});
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const ctx = fakeContext({ vault, client: () => client });

		await syncActive(ctx);

		expect(requests.length).toBeGreaterThan(0);
	});
});
