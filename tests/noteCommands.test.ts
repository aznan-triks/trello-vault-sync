import { describe, expect, test, vi } from "vitest";

// `linkActivePick` opens a modal and gets the chosen card back through its callback: capture that callback.
const picker = vi.hoisted(() => ({ pick: null as null | ((card: unknown) => void) }));
vi.mock("../src/ui/CardPickerModal", () => ({
	CardPickerModal: class CardPickerModal {
		constructor(_app: unknown, _cards: unknown, onPick: (card: unknown) => void) {
			picker.pick = onPick;
		}
		open(): void {}
	},
}));

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

import { linkActive, linkActivePick, syncActive, unlinkActive } from "../src/commands/noteCommands";
import type { CommandContext } from "../src/commands/context";
import { silentReporter } from "../src/obsidian/gateway";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { TrelloClient } from "../src/trello/client";
import { at, card, FakeVault, routedTransport, FATE_OPTIONS } from "./fakes";

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
			...FATE_OPTIONS,
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

describe("unlinkActive", () => {
	const keys = ["trello_board_card_id"];
	const linked = () => fakeContext({ noteOptions: () => ({ policy: "newer-wins", marginMs: 0, syncTitle: true, dryRun: false, trelloPropertyKeys: keys }) });

	test("removes the Trello properties and keeps the body", async () => {
		const ctx = linked();
		await unlinkActive({ ...ctx, settings: { ...ctx.settings, confirmUnlink: false } });
		const vault = ctx.vault as FakeVault;
		expect(vault.readFrontmatter(vault.note(PATH))?.trello_board_card_id).toBeUndefined();
		expect(vault.contentOf(PATH)).toContain("old body");
	});

	test("the card's per-card view sections are dropped with the link", async () => {
		const ctx = linked();
		const vault = ctx.vault as FakeVault;
		const cardId = vault.getCardRef(vault.note(PATH))!.cardId;
		const settings = { ...ctx.settings, confirmUnlink: false, cardView: { ...ctx.settings.cardView, perCard: { [cardId]: { comments: false }, other: { cover: true } } } };
		await unlinkActive({ ...ctx, settings });
		expect(settings.cardView.perCard).toEqual({ other: { cover: true } });
	});

	test("a note that is not linked is left alone", async () => {
		const ctx = fakeContext({ vault: new FakeVault({ [PATH]: { content: "no link" } }) });
		await unlinkActive({ ...ctx, settings: { ...ctx.settings, confirmUnlink: false } });
		expect((ctx.vault as FakeVault).contentOf(PATH)).toBe("no link");
	});
});

describe("linking a note by hand (F13)", () => {
	const CARD = card({ id: "c1", name: "note", desc: "remote body", dateLastActivity: "2026-08-01T00:00:00.000Z" });
	/** A note edited after the card's last activity: left to newer-wins, its text would overwrite the card. */
	const linkContext = (manualLinkCardWins: boolean) => {
		const vault = new FakeVault({ [PATH]: { content: "---\ntype: x\n---\n\nnote text", mtime: at("2026-09-01T00:00:00.000Z") } });
		const { transport } = routedTransport({ "/boards/board/cards": [CARD], "/cards/c1": CARD });
		const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
		const ctx = fakeContext({
			vault,
			client: () => client,
			settings: { ...DEFAULT_SETTINGS, boardId: "board", manualLinkCardWins },
			activeNote: () => vault.note(PATH),
			noteOptions: (force) => ({ policy: "newer-wins", marginMs: 0, syncTitle: true, dryRun: false, ...(force ? { force } : {}) }),
		});
		return { vault, ctx };
	};

	test("linking by name pulls the card's content into the note when the card wins", async () => {
		const { vault, ctx } = linkContext(true);
		await linkActive(ctx);
		expect(vault.getCardRef(vault.note(PATH))?.cardId).toBe("c1");
		expect(vault.contentOf(PATH)).toContain("remote body");
		expect(vault.contentOf(PATH)).not.toContain("note text");
	});

	test("linking by name leaves the note's text alone when the setting is off", async () => {
		const { vault, ctx } = linkContext(false);
		await linkActive(ctx);
		expect(vault.getCardRef(vault.note(PATH))?.cardId).toBe("c1");
		expect(vault.contentOf(PATH)).toContain("note text");
	});

	test("linking by name pulls nothing when no card matches", async () => {
		const { vault, ctx } = linkContext(true);
		await linkActive({ ...ctx, activeNote: () => ({ ...vault.note(PATH), basename: "zzz" }) });
		expect(vault.getCardRef(vault.note(PATH))).toBeNull();
		expect(vault.contentOf(PATH)).toContain("note text");
	});

	test("picking a card pulls its content into the note when the card wins", async () => {
		const { vault, ctx } = linkContext(true);
		await linkActivePick(ctx);
		picker.pick?.(CARD);
		await vi.waitFor(() => expect(vault.contentOf(PATH)).toContain("remote body"));
		expect(vault.contentOf(PATH)).not.toContain("note text");
	});

	test("picking a card leaves the note's text alone when the setting is off", async () => {
		const { vault, ctx } = linkContext(false);
		await linkActivePick(ctx);
		picker.pick?.(CARD);
		await vi.waitFor(() => expect(vault.getCardRef(vault.note(PATH))?.cardId).toBe("c1"));
		await Promise.resolve();
		expect(vault.contentOf(PATH)).toContain("note text");
	});
});
