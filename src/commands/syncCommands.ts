import { Notice } from "obsidian";
import type { CommandContext } from "./context";
import { reportStats } from "./reportStats";
import { withHistoryRecording } from "./syncHistoryHelper";
import { syncAllMappings as syncAllMappingsFeature, syncFolder, type FolderMapping } from "../features/syncFolder";
import { syncVault } from "../features/syncVault";
import { MappingSuggest } from "../ui/MappingSuggest";

export async function syncAllLinked(ctx: CommandContext): Promise<void> {
	if (!ctx.ready(true)) return;

	await ctx.run("Vault sync", async (reporter, signal) => {
		return withHistoryRecording(ctx, ctx.settings.scope, async (vault) => {
			const stats = await syncVault(
				vault,
				ctx.client(reporter),
				{ scope: ctx.settings.scope, boardId: ctx.settings.boardId, excludedFolders: ctx.settings.excludedFolders },
				ctx.noteOptions(),
				reporter,
				signal,
			);
			reportStats(reporter, stats);
			return `↓ ${stats.pulled} · ↑ ${stats.pushed} · = ${stats.skipped} · ⚠ ${stats.conflicts} · 👻 ${stats.phantoms} · ✕ ${stats.errors}`;
		});
	});
}

export async function syncOneMapping(ctx: CommandContext): Promise<void> {
	if (!ctx.ready()) return;
	if (ctx.settings.mappings.length === 0) {
		new Notice("No list ↔ folder mapping defined in the plugin settings.");
		return;
	}
	new MappingSuggest(ctx.app, ctx.settings.mappings, (mapping) => {
		void runMapping(ctx, mapping);
	}).open();
}

async function runMapping(ctx: CommandContext, mapping: FolderMapping): Promise<void> {
	await ctx.run(`Sync — ${mapping.folder}`, async (reporter, signal) => {
		return withHistoryRecording(ctx, mapping.folder, async (vault) => {
			const stats = await syncFolder(
				vault,
				ctx.client(reporter),
				mapping,
				ctx.folderOptions(),
				reporter,
				undefined,
				signal,
			);
			reportStats(reporter, stats);
			return `+ ${stats.created} · 🔗 ${stats.adopted} · ↓ ${stats.pulled} · ↑ ${stats.pushed} · 🗑 ${stats.deleted} · ✕ ${stats.errors}`;
		});
	});
}

export async function syncAllMappings(ctx: CommandContext): Promise<void> {
	if (!ctx.ready()) return;
	if (ctx.settings.mappings.length === 0) {
		new Notice("No list ↔ folder mapping defined in the plugin settings.");
		return;
	}

	await ctx.run("Sync all mappings", async (reporter, signal) => {
		return withHistoryRecording(ctx, "", async (vault) => {
			const total = await syncAllMappingsFeature(
				vault,
				ctx.client(reporter),
				ctx.settings.mappings,
				ctx.folderOptions(),
				reporter,
				signal,
			);
			reportStats(reporter, total);
			return `${ctx.settings.mappings.length} folder(s) · + ${total.created} · ↓ ${total.pulled} · ↑ ${total.pushed} · ✕ ${total.errors}`;
		});
	});
}
