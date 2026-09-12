import { Notice } from "obsidian";
import type { CommandContext } from "./context";
import * as noteCommands from "./noteCommands";
import { reportStats } from "./reportStats";
import { withHistoryRecording } from "./syncHistoryHelper";
import { syncFolder, type FolderMapping } from "../features/syncFolder";
import { syncVault } from "../features/syncVault";
import { ConfirmModal } from "../ui/ConfirmModal";
import { MappingSuggest } from "../ui/MappingSuggest";

/** Runs `action` directly, or behind a confirmation modal when `confirmForceSync` is on — never a native `confirm()`. */
function confirmIfNeeded(ctx: CommandContext, message: string, action: () => void): void {
	if (!ctx.settings.confirmForceSync) {
		action();
		return;
	}
	new ConfirmModal(ctx.app, message, action, "Force sync").open();
}

/** Note scope reuses `syncActive`'s existing imposed direction as-is — forcing a single note is already exactly what "Pull/Push (active note)" does, just under a more explicit id/label. */
export async function forcePullActiveNote(ctx: CommandContext): Promise<void> {
	await noteCommands.syncActive(ctx, "pull");
}

export async function forcePushActiveNote(ctx: CommandContext): Promise<void> {
	await noteCommands.syncActive(ctx, "push");
}

async function runForcedFolder(ctx: CommandContext, mapping: FolderMapping, direction: "pull" | "push"): Promise<void> {
	await ctx.run(`Force ${direction} — ${mapping.folder}`, async (reporter, signal) => {
		return withHistoryRecording(ctx, mapping.folder, async (vault) => {
			const stats = await syncFolder(
				vault,
				ctx.client(reporter),
				mapping,
				ctx.folderOptions(direction),
				reporter,
				undefined,
				signal,
			);
			reportStats(reporter, stats);
			return `+ ${stats.created} · ↓ ${stats.pulled} · ↑ ${stats.pushed} · 🗑 ${stats.deleted} · ✕ ${stats.errors}`;
		});
	});
}

function pickMappingThenForce(ctx: CommandContext, direction: "pull" | "push"): void {
	if (!ctx.ready()) return;
	if (ctx.settings.mappings.length === 0) {
		new Notice("No list ↔ folder mapping defined in the plugin settings.");
		return;
	}
	new MappingSuggest(ctx.app, ctx.settings.mappings, (mapping) => {
		const verb = direction === "pull" ? "overwrite every linked note in" : "overwrite every linked card from";
		confirmIfNeeded(
			ctx,
			`Force ${direction} will ${verb} "${mapping.folder}" with the other side's content, ignoring which changed last. Continue?`,
			() => void runForcedFolder(ctx, mapping, direction),
		);
	}).open();
}

export async function forcePullFolder(ctx: CommandContext): Promise<void> {
	pickMappingThenForce(ctx, "pull");
}

export async function forcePushFolder(ctx: CommandContext): Promise<void> {
	pickMappingThenForce(ctx, "push");
}

async function runForcedVault(ctx: CommandContext, direction: "pull" | "push"): Promise<void> {
	await ctx.run(`Force ${direction} — vault`, async (reporter, signal) => {
		return withHistoryRecording(ctx, ctx.settings.scope, async (vault) => {
			const stats = await syncVault(
				vault,
				ctx.client(reporter),
				{ scope: ctx.settings.scope, boardId: ctx.settings.boardId, excludedFolders: ctx.settings.excludedFolders },
				ctx.noteOptions(direction),
				reporter,
				signal,
			);
			reportStats(reporter, stats);
			return `↓ ${stats.pulled} · ↑ ${stats.pushed} · = ${stats.skipped} · 👻 ${stats.phantoms} · ✕ ${stats.errors}`;
		});
	});
}

function forceVault(ctx: CommandContext, direction: "pull" | "push"): void {
	if (!ctx.ready(true)) return;
	const verb = direction === "pull" ? "overwrite every linked note in the vault" : "overwrite every linked card from the vault";
	confirmIfNeeded(
		ctx,
		`Force ${direction} will ${verb} with the other side's content, ignoring which changed last. Continue?`,
		() => void runForcedVault(ctx, direction),
	);
}

export async function forcePullVault(ctx: CommandContext): Promise<void> {
	forceVault(ctx, "pull");
}

export async function forcePushVault(ctx: CommandContext): Promise<void> {
	forceVault(ctx, "push");
}
