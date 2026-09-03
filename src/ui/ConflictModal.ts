import { Modal, type App } from "obsidian";

export interface ConflictSides {
	noteTitle: string;
	localBody: string;
	remoteBody: string;
}

/**
 * Side-by-side view of a note and its card, both changed since the last sync.
 * Neither side is touched until the user picks a winner.
 */
export class ConflictModal extends Modal {
	constructor(
		app: App,
		private readonly sides: ConflictSides,
		private readonly onResolve: (direction: "pull" | "push") => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("tvs-conflict");
		contentEl.createEl("h3", { text: `Conflict — ${this.sides.noteTitle}` });
		contentEl.createEl("p", {
			cls: "tvs-conflict__hint",
			text: "Both the note and the card changed since the last sync. Pick which side to keep — the other is overwritten.",
		});

		const columns = contentEl.createDiv({ cls: "tvs-conflict__columns" });
		this.renderColumn(columns, "This note", this.sides.localBody);
		this.renderColumn(columns, "Trello card", this.sides.remoteBody);

		const actions = contentEl.createDiv({ cls: "tvs-conflict__actions" });
		const keepLocal = actions.createEl("button", { cls: "mod-cta", text: "Keep this note" });
		keepLocal.addEventListener("click", () => {
			this.onResolve("push");
			this.close();
		});
		const keepRemote = actions.createEl("button", { text: "Keep the Trello card" });
		keepRemote.addEventListener("click", () => {
			this.onResolve("pull");
			this.close();
		});
	}

	private renderColumn(parent: HTMLElement, title: string, body: string): void {
		const column = parent.createDiv({ cls: "tvs-conflict__column" });
		column.createEl("h4", { text: title });
		column.createEl("pre", { cls: "tvs-conflict__body", text: body.trim() === "" ? "(empty)" : body });
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
