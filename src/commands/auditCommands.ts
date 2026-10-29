import { Notice } from "obsidian";
import type { CommandContext } from "./context";
import { auditChanges } from "../features/auditChanges";
import { auditLinks } from "../features/auditLinks";
import { auditLocations } from "../features/auditLocations";
import { exportChangesHtml } from "../features/exportChangesHtml";
import { DEFAULT_BOARD_LABEL, registeredBoards } from "../core/boardResolve";
import type { ChangesSource } from "../features/auditShared";
import { ListPickerModal } from "../ui/ListPickerModal";

/**
 * Runs an audit on the board the user chose: asked at launch when "Ask which board to audit" is on (several boards only),
 * otherwise the board filter of the settings. "" means every registered board.
 */
async function forAuditBoard(ctx: CommandContext, run: (onlyBoardId: string) => Promise<void>): Promise<void> {
	const boards = registeredBoards(ctx.settings);
	if (boards.length > 1 && ctx.settings.auditAskBoard) {
		const choices = [{ id: "", name: "All boards" }, ...boards.map((board) => ({ id: board.id, name: board.name || DEFAULT_BOARD_LABEL }))];
		new ListPickerModal(ctx.app, choices, (choice) => void run(choice.id), "Choose a board to audit…").open();
		return;
	}
	await run(boards.some((board) => board.id === ctx.settings.auditBoardFilter) ? ctx.settings.auditBoardFilter : "");
}

/** The boards whose change log is read, each with its own cursor: all the registered ones, or just `only`. */
function changesSource(ctx: CommandContext, only: string): ChangesSource {
	const { settings } = ctx;
	const cursorOf = (boardId: string) => (boardId === settings.boardId ? settings.auditChangesCursor : (settings.auditChangesCursors[boardId] ?? ""));
	const boards = registeredBoards(settings).filter((board) => only === "" || board.id === only);
	const [first, ...others] = boards;
	if (!first) return { boardId: settings.boardId, since: settings.auditChangesCursor };
	return {
		boardId: first.id,
		since: cursorOf(first.id),
		extraBoards: others.map((board) => ({ id: board.id, name: board.name, since: cursorOf(board.id) })),
	};
}

export async function runLinkAudit(ctx: CommandContext): Promise<void> {
	if (!ctx.ready(true)) return;
	await forAuditBoard(ctx, (only) => linkAudit(ctx, only));
}

async function linkAudit(ctx: CommandContext, onlyBoardId: string): Promise<void> {
	await ctx.run("Link audit", async (reporter, signal) => {
		const { settings } = ctx;
		const creationScopes = settings.auditReportApplyCreationScopes
			? {
					mappings: settings.mappings,
					orphanCardScope: settings.orphanCardScope,
					phantomNoteScope: settings.phantomNoteScope,
				}
			: undefined;
		const result = await auditLinks(
			ctx.vault,
			ctx.client(reporter),
			{ ...ctx.auditOptions("links"), onlyBoardId, creationScopes },
			reporter,
			signal,
		);
		reporter.count("orphanCards", result.orphanCards);
		reporter.count("phantoms", result.phantomNotes);
		reporter.count("unlinkedNotes", result.unlinkedNotes);
		return `${result.orphanCards} orphan card(s) · ${result.phantomNotes} phantom note(s) · ${result.unlinkedNotes} unlinked note(s)`;
	});
}

export async function runLocationAudit(ctx: CommandContext): Promise<void> {
	if (!ctx.ready(true)) return;
	await forAuditBoard(ctx, (only) => locationAudit(ctx, only));
}

async function locationAudit(ctx: CommandContext, onlyBoardId: string): Promise<void> {
	await ctx.run("Location audit", async (reporter, signal) => {
		const result = await auditLocations(ctx.vault, ctx.client(reporter), { ...ctx.auditOptions("locations"), onlyBoardId }, reporter, signal);
		reporter.count("comparedNotes", result.rows);
		return `${result.rows} note(s) compared`;
	});
}

export async function runChangesAudit(ctx: CommandContext): Promise<void> {
	if (!ctx.ready(true)) return;
	await forAuditBoard(ctx, (only) => changesAudit(ctx, only));
}

async function changesAudit(ctx: CommandContext, onlyBoardId: string): Promise<void> {
	await ctx.run("Audit changes", async (reporter, signal) => {
		const { reportPath, timestamp, reportLabels } = ctx.auditOptions("changes");
		const result = await auditChanges(
			ctx.vault,
			ctx.client(reporter),
			{ ...changesSource(ctx, onlyBoardId), reportPath, timestamp, reportLabels },
			reporter,
			signal,
		);
		// Dry run plans/reports but never advances state — same rule as every write path.
		if (!ctx.settings.dryRun && Object.keys(result.cursors).length > 0) {
			for (const [boardId, cursor] of Object.entries(result.cursors)) {
				if (boardId === ctx.settings.boardId) ctx.settings.auditChangesCursor = cursor;
				else ctx.settings.auditChangesCursors[boardId] = cursor;
			}
			await ctx.saveSettings();
		}
		reporter.count("changes", result.entries);
		return `${result.entries} change(s) logged`;
	});
}

export async function runChangesHtmlExport(ctx: CommandContext): Promise<void> {
	if (!ctx.ready(true)) return;
	await forAuditBoard(ctx, (only) => changesHtmlExport(ctx, only));
}

async function changesHtmlExport(ctx: CommandContext, onlyBoardId: string): Promise<void> {
	await ctx.run("Export change log as HTML", async (reporter, signal) => {
		const { timestamp } = ctx.auditOptions();
		const result = await exportChangesHtml(
			ctx.vault,
			ctx.client(reporter),
			{
				...changesSource(ctx, onlyBoardId),
				htmlPath: ctx.settings.changesHtmlPath,
				timestamp,
				avatarSize: ctx.settings.changeLogAvatarSize,
				extraCss: ctx.settings.changeLogHtmlExtraCss,
			},
			(url, avatarSignal) => ctx.fetchBinary(url, avatarSignal),
			reporter,
			signal,
		);
		reporter.count("changes", result.entries);
		return `${result.entries} change(s) exported to ${ctx.settings.changesHtmlPath}`;
	});
}

/** Opens the link report note, so its checkboxes can be triaged without hunting for the file. */
export async function openLinkReport(ctx: CommandContext): Promise<void> {
	const reportPath = ctx.auditOptions("links").reportPath.trim();
	if (reportPath === "" || !ctx.vault.noteAt(reportPath)) {
		new Notice(`No link report found${reportPath ? ` in ${reportPath}` : ""}. Run "Report unlinked cards and notes" first.`);
		return;
	}
	await ctx.app.workspace.openLinkText(reportPath, "", false);
}
