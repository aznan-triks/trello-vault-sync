import { Notice } from "obsidian";
import type { CommandContext } from "./context";
import { syncAllMappings as syncAllMappingsFeature, syncFolder, type FolderMapping } from "../features/syncFolder";
import { syncVault } from "../features/syncVault";
import type { Reporter } from "../obsidian/gateway";
import { MappingSuggest } from "../ui/MappingSuggest";

/**
 * Takes the stats object itself rather than pre-built pairs: the constraint
 * `T extends Record<keyof T, number>` accepts the sync engines' plain interfaces
 * (which do not satisfy `Record<string, number>`) while still proving every field
 * is a number — `Object.entries` only widens the value back to `unknown` on a
 * generic, hence the single conversion below.
 */
function reportStats<T extends Record<keyof T, number>>(reporter: Reporter, stats: T): void {
	for (const [key, value] of Object.entries(stats)) reporter.count(key, value as number);
}

export async function syncAllLinked(ctx: CommandContext): Promise<void> {
	if (!ctx.ready(true)) return;

	await ctx.run("Vault sync", async (reporter, signal) => {
		const stats = await syncVault(
			ctx.vault,
			ctx.client(reporter),
			{ scope: ctx.settings.scope, boardId: ctx.settings.boardId, excludedFolders: ctx.settings.excludedFolders },
			ctx.noteOptions(),
			reporter,
			signal,
		);
		reportStats(reporter, stats);
		return `↓ ${stats.pulled} · ↑ ${stats.pushed} · = ${stats.skipped} · ⚠ ${stats.conflicts} · 👻 ${stats.phantoms} · ✕ ${stats.errors}`;
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
		const stats = await syncFolder(
			ctx.vault,
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
}

export async function syncAllMappings(ctx: CommandContext): Promise<void> {
	if (!ctx.ready()) return;
	if (ctx.settings.mappings.length === 0) {
		new Notice("No list ↔ folder mapping defined in the plugin settings.");
		return;
	}

	await ctx.run("Sync all mappings", async (reporter, signal) => {
		const total = await syncAllMappingsFeature(
			ctx.vault,
			ctx.client(reporter),
			ctx.settings.mappings,
			ctx.folderOptions(),
			reporter,
			signal,
		);
		reportStats(reporter, total);
		return `${ctx.settings.mappings.length} folder(s) · + ${total.created} · ↓ ${total.pulled} · ↑ ${total.pushed} · ✕ ${total.errors}`;
	});
}
