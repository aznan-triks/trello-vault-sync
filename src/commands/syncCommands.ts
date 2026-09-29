import { Notice } from "obsidian";
import type { CommandContext } from "./context";
import { reportStats } from "./reportStats";
import { withHistoryRecording } from "./syncHistoryHelper";
import { syncAllMappings as syncAllMappingsFeature, syncFolder, type FolderMapping } from "../features/syncFolder";
import { syncVault } from "../features/syncVault";
import { MappingSuggest } from "../ui/MappingSuggest";

/**
 * `direction` makes this the plain "Pull/Push (vault)": one-directional like
 * "Pull/Push (active note)", but a genuine conflict is still reported, never
 * overwritten — only the Force commands bypass it (`forceSyncCommands.ts`).
 */
export async function syncAllLinked(
	ctx: CommandContext,
	direction?: "pull" | "push",
	{ skipMappedFolders = false }: { skipMappedFolders?: boolean } = {},
): Promise<void> {
	if (!ctx.ready(true)) return;

	await ctx.run(direction ? `${direction === "pull" ? "Pull" : "Push"} — vault` : "Vault sync", async (reporter, signal) => {
		return withHistoryRecording(ctx, ctx.settings.scope, async (vault, onTrelloWrite) => {
			const stats = await syncVault(
				vault,
				ctx.client(reporter),
				{
					scope: ctx.settings.scope,
					boardId: ctx.settings.boardId,
					// Auto-sync with both scopes on: the mapped folders were synced just before.
					excludedFolders: skipMappedFolders
						? [...ctx.settings.excludedFolders, ...ctx.settings.mappings.map((m) => m.folder)]
						: ctx.settings.excludedFolders,
				},
				{ ...ctx.noteOptions(direction), onTrelloWrite },
				reporter,
				signal,
			);
			reportStats(reporter, stats);
			ctx.setLastRunConflicts?.(stats.conflicts);
			return `↓ ${stats.pulled} · ↑ ${stats.pushed} · = ${stats.skipped} · ⚠ ${stats.conflicts} · 👻 ${stats.phantoms} · ✕ ${stats.errors}`;
		});
	}, { countsAsSync: direction === undefined });
}

/** `direction` makes this the plain "Pull/Push (mapped folder)" — see `syncAllLinked`. */
export async function syncOneMapping(ctx: CommandContext, direction?: "pull" | "push"): Promise<void> {
	if (!ctx.ready()) return;
	if (ctx.settings.mappings.length === 0) {
		new Notice("No list ↔ folder mapping defined in the plugin settings.");
		return;
	}
	new MappingSuggest(ctx.app, ctx.settings.mappings, (mapping) => {
		void runMapping(ctx, mapping, direction);
	}).open();
}

async function runMapping(ctx: CommandContext, mapping: FolderMapping, direction?: "pull" | "push"): Promise<void> {
	const verb = direction === "pull" ? "Pull" : direction === "push" ? "Push" : "Sync";
	await ctx.run(`${verb} — ${mapping.folder}`, async (reporter, signal) => {
		return withHistoryRecording(ctx, mapping.folder, async (vault, onTrelloWrite) => {
			const stats = await syncFolder(
				vault,
				ctx.client(reporter),
				mapping,
				{ ...ctx.folderOptions(direction), onTrelloWrite },
				reporter,
				undefined,
				signal,
			);
			reportStats(reporter, stats);
			ctx.setLastRunConflicts?.(stats.conflicts);
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
		return withHistoryRecording(ctx, "", async (vault, onTrelloWrite) => {
			const total = await syncAllMappingsFeature(
				vault,
				ctx.client(reporter),
				ctx.settings.mappings,
				{ ...ctx.folderOptions(), onTrelloWrite },
				reporter,
				signal,
			);
			reportStats(reporter, total);
			ctx.setLastRunConflicts?.(total.conflicts);
			return `${ctx.settings.mappings.length} folder(s) · + ${total.created} · ↓ ${total.pulled} · ↑ ${total.pushed} · ✕ ${total.errors}`;
		});
	}, { countsAsSync: true });
}
