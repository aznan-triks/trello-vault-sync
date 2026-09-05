import type { CommandContext } from "./context";
import { auditChanges } from "../features/auditChanges";
import { auditLinks } from "../features/auditLinks";
import { auditLocations } from "../features/auditLocations";
import { exportChangesHtml } from "../features/exportChangesHtml";

export async function runLinkAudit(ctx: CommandContext): Promise<void> {
	if (!ctx.ready(true)) return;

	await ctx.run("Link audit", async (reporter, signal) => {
		const result = await auditLinks(ctx.vault, ctx.client(reporter), ctx.auditOptions(), reporter, signal);
		reporter.count("orphanCards", result.orphanCards);
		reporter.count("phantoms", result.phantomNotes);
		reporter.count("unlinkedNotes", result.unlinkedNotes);
		return `${result.orphanCards} orphan card(s) · ${result.phantomNotes} phantom note(s) · ${result.unlinkedNotes} unlinked note(s)`;
	});
}

export async function runLocationAudit(ctx: CommandContext): Promise<void> {
	if (!ctx.ready(true)) return;

	await ctx.run("Location audit", async (reporter, signal) => {
		const result = await auditLocations(ctx.vault, ctx.client(reporter), ctx.auditOptions(), reporter, signal);
		reporter.count("comparedNotes", result.rows);
		reporter.count("misplaced", result.misplaced);
		return `${result.rows} note(s) compared · ${result.misplaced} outside their expected list`;
	});
}

export async function runChangesAudit(ctx: CommandContext): Promise<void> {
	if (!ctx.ready(true)) return;

	await ctx.run("Audit changes", async (reporter, signal) => {
		const { boardId, reportPath, timestamp } = ctx.auditOptions();
		const result = await auditChanges(
			ctx.vault,
			ctx.client(reporter),
			{ boardId, reportPath, timestamp, since: ctx.settings.auditChangesCursor },
			reporter,
			signal,
		);
		// Dry run plans/reports but never advances state — same rule as every write path.
		if (!ctx.settings.dryRun && result.cursor) {
			ctx.settings.auditChangesCursor = result.cursor;
			await ctx.saveSettings();
		}
		reporter.count("changes", result.entries);
		return `${result.entries} change(s) logged`;
	});
}

export async function runChangesHtmlExport(ctx: CommandContext): Promise<void> {
	if (!ctx.ready(true)) return;

	await ctx.run("Export change log as HTML", async (reporter, signal) => {
		const { boardId, timestamp } = ctx.auditOptions();
		const result = await exportChangesHtml(
			ctx.vault,
			ctx.client(reporter),
			{ boardId, htmlPath: ctx.settings.changesHtmlPath, timestamp, since: ctx.settings.auditChangesCursor },
			(url) => ctx.fetchBinary(url),
			reporter,
			signal,
		);
		reporter.count("changes", result.entries);
		return `${result.entries} change(s) exported to ${ctx.settings.changesHtmlPath}`;
	});
}
