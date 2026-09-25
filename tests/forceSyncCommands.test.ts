import { describe, expect, test } from "vitest";

// Same pattern as tests/noteCommands.test.ts: `forceSyncCommands.ts` pulls in
// `obsidian` (for `Notice`) transitively via `ConfirmModal`/`MappingSuggest`,
// none of which resolve to a real module under vitest.
vi.mock("obsidian", () => ({
	Notice: class Notice {
		constructor(_message?: string) {}
	},
	Modal: class Modal {
		contentEl = { empty: () => {}, addClass: () => {}, createEl: () => ({}), createDiv: () => ({}) };
		constructor(_app: unknown) {}
		open(): void {}
		close(): void {}
	},
	FuzzySuggestModal: class FuzzySuggestModal {
		constructor(_app: unknown) {}
		setPlaceholder(_text: string): void {}
		open(): void {}
	},
	SuggestModal: class SuggestModal {
		constructor(_app: unknown) {}
		setPlaceholder(_text: string): void {}
		open(): void {}
	},
}));

import { forcePullActiveNote } from "../src/commands/forceSyncCommands";
import { syncActive } from "../src/commands/noteCommands";
import type { CommandContext } from "../src/commands/context";
import { silentReporter } from "../src/obsidian/gateway";
import { DEFAULT_SETTINGS } from "../src/settings/types";
import { TrelloClient } from "../src/trello/client";
import { ConfirmModal } from "../src/ui/ConfirmModal";
import { card, FakeVault, routedTransport } from "./fakes";
import { vi } from "vitest";

const PATH = "note.md";
const FRONTMATTER = '---\ntrello_board_card_id: "board;c1"\n---\n\nlocal body';

/**
 * Unlike `tests/noteCommands.test.ts`'s stub (which ignores its arguments),
 * this `noteOptions` genuinely forwards `force`/`bypassConflict` — needed to
 * prove "Force pull (active note)" now behaves differently from the plain
 * "Pull (active note)" command (the bug this test file targets).
 */
function fakeContext(overrides: Partial<CommandContext> = {}): CommandContext {
	const vault = new FakeVault({
		[PATH]: { content: FRONTMATTER, mtime: 0 },
	});
	// dateLastActivity 30ms after the note's mtime (0), well within a 60s margin
	// — decideSync reports "conflict", not "pull"/"push" (tests/syncNote.test.ts
	// exercises the same setup at the syncNote layer).
	const { transport } = routedTransport({
		"/cards/c1": card({ id: "c1", name: "Card", desc: "remote body", dateLastActivity: "1970-01-01T00:00:00.030Z" }),
	});
	const client = new TrelloClient({ apiKey: "k", token: "t" }, transport);
	return {
		app: {} as CommandContext["app"],
		vault,
		settings: { ...DEFAULT_SETTINGS, boardId: "board", marginSeconds: 60, confirmForceSync: false },
		journal: [],
		history: [],
		recordSyncRun: async () => {},
		setHistory: async () => {},
		client: () => client,
		fetchBinary: async () => null,
		run: async (_title, body) => {
			await body(silentReporter, new AbortController().signal);
		},
		activeNote: () => vault.note(PATH),
		isSyncing: () => false,
		ready: () => true,
		noteOptions: (force, bypassConflict) => ({
			policy: "newer-wins",
			marginMs: 60_000,
			// Title sync off: the card's name ("Card") differs from the note's
			// basename ("note"), and this test only cares about body content —
			// a rename would just move the file the assertions check.
			syncTitle: false,
			dryRun: false,
			...(force ? { force } : {}),
			...(bypassConflict ? { bypassConflict } : {}),
		}),
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

describe("force pull/push (active note) — genuinely bypasses a conflict, unlike plain pull/push", () => {
	test("plain 'Pull (active note)' does NOT overwrite during a conflict", async () => {
		const ctx = fakeContext();

		await syncActive(ctx, "pull");

		expect(ctx.vault.exists(PATH)).toBe(true);
		expect((ctx.vault as FakeVault).contentOf(PATH)).toBe(FRONTMATTER);
	});

	test("'Force pull (active note)' overwrites during a conflict (confirmForceSync off)", async () => {
		const ctx = fakeContext();

		// `forcePullActiveNote` fires the (unawaited, disabled) confirmation gate
		// and returns — same fire-and-forget shape as the folder/vault force
		// commands. Flush microtasks so the sync underneath has actually run.
		await forcePullActiveNote(ctx);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect((ctx.vault as FakeVault).contentOf(PATH)).toContain("remote body");
	});

	test("'Force pull (active note)' waits for confirmation when confirmForceSync is on", async () => {
		let capturedConfirm: (() => void) | undefined;
		vi.spyOn(ConfirmModal.prototype, "open").mockImplementation(function (this: ConfirmModal) {
			capturedConfirm = (this as unknown as { onConfirm: () => void }).onConfirm;
		});

		const ctx = fakeContext({ settings: { ...DEFAULT_SETTINGS, boardId: "board", marginSeconds: 60, confirmForceSync: true } });

		await forcePullActiveNote(ctx);
		expect(capturedConfirm).toBeDefined();
		expect((ctx.vault as FakeVault).contentOf(PATH)).toBe(FRONTMATTER);

		capturedConfirm!();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect((ctx.vault as FakeVault).contentOf(PATH)).toContain("remote body");
	});
});
