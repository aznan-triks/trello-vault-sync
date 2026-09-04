import type { CommandContext } from "./context";
import { auditLinks } from "../features/auditLinks";
import { auditLocations } from "../features/auditLocations";

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
