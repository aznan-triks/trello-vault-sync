import { Notice } from "obsidian";
import type { CommandContext } from "./context";
import { parseDueRef } from "../core/dueRef";
import { errorMessage } from "../core/errorMessage";
import { extractBody } from "../core/noteBody";
import { describeSyncOutcome, tallyNoteResult } from "../core/syncTally";
import { linkActiveNote, linkNoteToCard } from "../features/linkNote";
import { decideForCard, syncNote } from "../features/syncNote";
import { CardPickerModal } from "../ui/CardPickerModal";
import { ConflictModal } from "../ui/ConflictModal";

export async function syncActive(ctx: CommandContext, force?: "pull" | "push"): Promise<void> {
	const note = ctx.activeNote();
	if (!ctx.ready() || !note) return;

	await ctx.run(`Sync — ${note.basename}`, async (reporter) => {
		reporter.setTotal(1);
		reporter.step(note.basename);
		const result = await syncNote(ctx.vault, ctx.client(reporter), note, ctx.noteOptions(force));
		tallyNoteResult(
			{ pulled: 0, pushed: 0, skipped: 0, renamed: 0, conflicts: 0 },
			result,
			(level, message) => reporter.log(level, message),
			note.basename,
		);
		if (result.direction === "unlinked") reporter.log("warn", "Not linked to a Trello card.");

		return describeSyncOutcome(result);
	}, { cancellable: false });
}

export async function linkActive(ctx: CommandContext): Promise<void> {
	const note = ctx.activeNote();
	if (!ctx.ready(true) || !note) return;

	await ctx.run(`Link — ${note.basename}`, async (reporter) => {
		const result = await linkActiveNote(ctx.vault, ctx.client(reporter), note, {
			boardId: ctx.settings.boardId,
			threshold: ctx.settings.similarityThreshold,
		});
		if (result.reason === "already-linked") return "This note is already linked to a card.";
		if (!result.linked) return "No card close enough to the note's title.";
		return `Linked to "${result.card?.name}" (${Math.round(result.score * 100)}%).`;
	}, { cancellable: false });
}

export async function linkActivePick(ctx: CommandContext): Promise<void> {
	const note = ctx.activeNote();
	if (!ctx.ready(true) || !note) return;

	await ctx.run(`Pick a card — ${note.basename}`, async (reporter) => {
		const cards = await ctx.client(reporter).getBoardCards(ctx.settings.boardId);
		new CardPickerModal(ctx.app, cards, (card) => {
			void linkNoteToCard(ctx.vault, note, card).then(
				() => new Notice(`Linked to "${card.name}".`),
				(error) => {
					new Notice(`❌ ${errorMessage(error)}`);
					console.error("[trello-vault-sync]", error);
				},
			);
		}).open();
		return `${cards.length} card(s) loaded — pick one from the list.`;
	}, { cancellable: false });
}

export async function resolveConflict(ctx: CommandContext): Promise<void> {
	const note = ctx.activeNote();
	if (!ctx.ready() || !note) return;

	const ref = ctx.vault.getCardRef(note);
	if (!ref) {
		new Notice("Not linked to a Trello card.");
		return;
	}

	await ctx.run(`Check conflict — ${note.basename}`, async (reporter) => {
		const card = await ctx.client(reporter).getCard(ref.cardId);
		const localBody = extractBody(await ctx.vault.read(note));
		const localDue = parseDueRef(ctx.vault.readFrontmatter(note)?.[ctx.settings.dueFrontmatterKey]);
		const decision = decideForCard(
			note,
			card,
			localBody,
			{
				policy: ctx.settings.policy,
				marginMs: ctx.settings.marginSeconds * 1000,
			},
			localDue,
		);
		if (decision.direction !== "conflict") return "No conflict on this note — nothing to resolve.";

		new ConflictModal(
			ctx.app,
			{ noteTitle: note.basename, localBody, remoteBody: card.desc ?? "" },
			(direction) => void syncActive(ctx, direction),
		).open();
		return "Conflict found — resolve it in the dialog.";
	}, { cancellable: false });
}

export async function toggleDryRun(ctx: CommandContext): Promise<void> {
	ctx.settings.dryRun = !ctx.settings.dryRun;
	await ctx.saveSettings();
	new Notice(`Dry-run mode ${ctx.settings.dryRun ? "enabled" : "disabled"}.`);
}
