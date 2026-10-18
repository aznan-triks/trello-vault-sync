import { decideNoteFate, type CardChange, type CardFateRules, type NoteFate } from "../core/cardFate";
import { errorMessage } from "../core/errorMessage";
import { joinPath, notesInFolder } from "../core/fileName";
import type { NoteHandle, Reporter, VaultGateway } from "../obsidian/gateway";
import type { TrelloClient } from "../trello/client";
import { classifyGoneCards, type KnownCard } from "./goneCards";
import { unlinkNote } from "./unlinkNote";

export type FateResult = "detached" | "deleted" | "relocated" | "kept";

const CHANGE_TEXT: Record<CardChange, string> = {
	moved: "Card moved to another list",
	archived: "Card archived on Trello",
	deleted: "Card deleted on Trello",
};

/** True when a note sits in (or below) one of the `folders` — used for "Never trash notes in this folder". */
export function isUnderAny(note: Pick<NoteHandle, "path">, folders: readonly string[]): boolean {
	return folders.some((folder) => folder !== "" && notesInFolder([note], folder).length > 0);
}

/** Moves a note into `folder` unless that would overwrite another note; the destination is created on demand. */
export async function moveNoteToFolder(
	vault: Pick<VaultGateway, "exists" | "rename">,
	note: NoteHandle,
	folder: string,
): Promise<{ moved: true; note: NoteHandle } | { moved: false; reason: string }> {
	const target = joinPath(folder, `${note.basename}.md`);
	if (target === note.path) return { moved: false, reason: "already there" };
	if (vault.exists(target)) return { moved: false, reason: `${target} already exists` };
	return { moved: true, note: await vault.rename(note, target) };
}

/** Applies one `NoteFate` to a note, logging what happened. Dry-run logs the same line and writes nothing. */
export async function applyNoteFate(
	vault: Pick<VaultGateway, "exists" | "rename" | "trash" | "readFrontmatter" | "writeFrontmatter">,
	note: NoteHandle,
	fate: NoteFate,
	context: { change: CardChange; propertyKeys: readonly string[]; dryRun: boolean; reporter: Pick<Reporter, "log"> },
): Promise<{ result: FateResult; note: NoteHandle; message: string }> {
	const { reporter } = context;
	const head = `${CHANGE_TEXT[context.change]}: ${note.basename}`;

	if (fate.action === "unlink") {
		const removed = await unlinkNote(vault, note, context.propertyKeys, context.dryRun);
		const message = `${head} — Trello properties removed`;
		reporter.log("rename", `${message}${removed.length > 0 ? ` (${removed.join(", ")})` : ""}`);
		return { result: "detached", note, message };
	}
	if (fate.action === "trash") {
		const message = `${head} — note moved to the trash`;
		reporter.log("delete", message);
		if (!context.dryRun) await vault.trash(note);
		return { result: "deleted", note, message };
	}
	if (fate.action === "move") {
		const target = joinPath(fate.folder, `${note.basename}.md`);
		if (target === note.path) return { result: "kept", note, message: `${head} — already in ${fate.folder}` };
		if (vault.exists(target)) {
			const message = `${head} — kept (${target} already exists)`;
			reporter.log("warn", message);
			return { result: "kept", note, message };
		}
		const message = `${head} — note moved to ${fate.folder}`;
		reporter.log("rename", message);
		if (context.dryRun) return { result: "relocated", note, message };
		return { result: "relocated", note: await vault.rename(note, target), message };
	}
	const message = `${head} — kept${fate.reason ? ` (${fate.reason})` : ""}`;
	reporter.log("warn", message);
	return { result: "kept", note, message };
}

export interface GoneNote {
	note: NoteHandle;
	cardId: string;
}

export interface GoneNoteStats {
	detached: number;
	relocated: number;
	deleted: number;
	moved: number;
	errors: number;
}

/**
 * Decides and applies the fate of notes whose card is no longer where the sync looked for it.
 * `aliveMode: "leave"` (vault-wide runs) never acts on a card that still exists — it is on another
 * board, which this run cannot judge; folder runs apply the "card moved" rule instead.
 */
export async function handleGoneNotes(
	vault: Pick<VaultGateway, "exists" | "rename" | "trash" | "readFrontmatter" | "writeFrontmatter">,
	client: TrelloClient,
	gone: GoneNote[],
	context: {
		rules: CardFateRules;
		propertyKeys: readonly string[];
		mappedFolderByListId: ReadonlyMap<string, string>;
		trashAllowed: (note: NoteHandle) => boolean;
		aliveMode: "apply" | "leave";
		dryRun: boolean;
		reporter: Reporter;
		stats: GoneNoteStats;
		signal?: AbortSignal;
		known?: ReadonlyMap<string, KnownCard>;
	},
): Promise<void> {
	if (gone.length === 0) return;
	const { reporter, stats } = context;
	const states = await classifyGoneCards(client, [...new Set(gone.map((entry) => entry.cardId))], context.signal, reporter, context.known);

	for (const { note, cardId } of gone) {
		if (context.signal?.aborted) break;
		const info = states.get(cardId);
		if (!info) continue; // could not be checked — already logged, nothing touched
		reporter.step(note.basename);
		if (info.state === "alive" && context.aliveMode === "leave") {
			stats.moved++;
			reporter.log("warn", `Card on another board: ${note.basename} (kept)`);
			continue;
		}
		const change: CardChange = info.state === "alive" ? "moved" : info.state;
		const fate = decideNoteFate(change, context.rules, {
			mappedFolderOfNewList: (info.idList && context.mappedFolderByListId.get(info.idList)) || null,
			trashAllowed: context.trashAllowed(note),
		});
		try {
			const outcome = await applyNoteFate(vault, note, fate, {
				change,
				propertyKeys: context.propertyKeys,
				dryRun: context.dryRun,
				reporter,
			});
			if (outcome.result === "detached") stats.detached++;
			else if (outcome.result === "deleted") stats.deleted++;
			else if (outcome.result === "relocated") stats.relocated++;
			else if (change === "moved") stats.moved++;
		} catch (error) {
			stats.errors++;
			reporter.log("error", `${note.basename} — ${errorMessage(error)}`);
		}
	}
}
