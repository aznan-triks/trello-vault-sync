import { ItemView, MarkdownRenderer, moment, setIcon, setTooltip, type WorkspaceLeaf } from "obsidian";
import type { CommandContext } from "../commands/context";
import { COMMANDS } from "../commands/registry";
import { cardLink, checklistProgress, dueState, visibleSections, type CardViewSection } from "../core/cardViewModel";
import { resolveCustomFields } from "../core/customFieldRef";
import { errorMessage } from "../core/errorMessage";
import { CardViewData } from "../features/cardViewData";
import { buildCustomFieldDefinitions } from "../features/syncNote";
import type { NoteHandle } from "../obsidian/gateway";
import { hasCredentials } from "../settings/types";
import { TrelloError, type TrelloCardView } from "../trello/client";
import type { AppWithSettingDialog } from "./SidebarView";

export const VIEW_TYPE_TVS_CARD = "trello-vault-sync-card-view";

interface MessageAction {
	label: string;
	run: () => void;
}

/**
 * Side panel showing the Trello card of the open note: one request per card (cached, see `CardViewData`),
 * nothing requested while the note is unlinked or the panel is hidden. Follows the active note.
 */
export class CardView extends ItemView {
	private readonly data: CardViewData;
	private controller: AbortController | null = null;
	private followTimer: number | null = null;
	/** Bumped by every load and render: a late answer for a note the user already left is dropped. */
	private seq = 0;
	private shownPath: string | null = null;
	private shownCardId: string | null = null;
	/** A note change came in while the panel was hidden - it follows when shown again. */
	private stale = false;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly ctx: CommandContext,
	) {
		super(leaf);
		const v = () => this.ctx.settings.cardView;
		this.data = new CardViewData(
			() => this.ctx.client(),
			() => ({ cardMs: v().cacheSeconds * 1000, boardMs: v().boardCacheSeconds * 1000, commentsLimit: v().commentsLimit }),
		);
	}

	override getViewType(): string {
		return VIEW_TYPE_TVS_CARD;
	}

	override getDisplayText(): string {
		return "Trello card";
	}

	override getIcon(): string {
		return "square-kanban";
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("tvs-card-view-host");
		const { workspace, metadataCache } = this.app;
		this.registerEvent(workspace.on("active-leaf-change", (leaf) => (leaf !== this.leaf || this.stale) && this.schedule()));
		this.registerEvent(workspace.on("file-open", () => this.schedule()));
		this.registerEvent(workspace.on("layout-change", () => this.stale && this.isVisible() && this.schedule()));
		this.registerEvent(
			metadataCache.on("changed", (file) => {
				if (file.path !== this.shownPath) return;
				const note = this.ctx.vault.noteAt(file.path);
				const cardId = note ? (this.ctx.vault.getCardRef(note)?.cardId ?? null) : null;
				if (cardId !== this.shownCardId) this.schedule();
			}),
		);
		await this.follow(false);
	}

	override async onClose(): Promise<void> {
		this.controller?.abort();
		if (this.followTimer !== null) window.clearTimeout(this.followTimer);
	}

	/** Redraws from the cache - a setting changed (no request). */
	refresh(): void {
		void this.follow(false, true);
	}

	private isVisible(): boolean {
		return this.containerEl.isShown();
	}

	private schedule(): void {
		if (this.followTimer !== null) window.clearTimeout(this.followTimer);
		this.followTimer = window.setTimeout(() => void this.follow(false), this.ctx.settings.cardView.followDelayMs);
	}

	/** Shows the card of the active note. `force` asks Trello again; `redraw` redraws even when nothing changed. */
	private async follow(force: boolean, redraw = false): Promise<void> {
		const v = this.ctx.settings.cardView;
		if (!force && !v.refreshWhenHidden && !this.isVisible()) {
			this.stale = true;
			return;
		}
		this.stale = false;
		if (!hasCredentials(this.ctx.settings)) {
			this.controller?.abort();
			this.forget();
			this.message("Set your Trello key and token to see the card of a note.", [
				{ label: "Open the plugin settings", run: () => this.openSettings() },
			]);
			return;
		}
		const file = this.app.workspace.getActiveFile();
		const note = file?.extension === "md" ? this.ctx.vault.noteAt(file.path) : null;
		if (!note) {
			if (this.shownPath === null) this.message("Open a note to see its Trello card.");
			return;
		}
		const ref = this.ctx.vault.getCardRef(note);
		if (!ref) {
			this.controller?.abort();
			this.shownPath = note.path;
			this.shownCardId = null;
			this.message(`"${note.basename}" is not linked to a Trello card.`, this.commandActions(["link-active-note-pick", "create-card-from-active-note"]));
			return;
		}
		if (!force && !redraw && this.shownPath === note.path && this.shownCardId === ref.cardId) return;
		await this.show(note, ref.cardId, force);
	}

	private forget(): void {
		this.shownPath = null;
		this.shownCardId = null;
	}

	private async show(note: NoteHandle, cardId: string, force: boolean): Promise<void> {
		const seq = ++this.seq;
		this.controller?.abort();
		const controller = (this.controller = new AbortController());
		this.shownPath = note.path;
		this.shownCardId = cardId;
		if (this.contentEl.childElementCount === 0) this.message("Loading the card…");
		try {
			const card = await this.data.card(cardId, force, controller.signal);
			if (seq !== this.seq) return;
			await this.renderCard(note, card, seq);
		} catch (error) {
			if (seq !== this.seq || controller.signal.aborted) return;
			this.showError(error, note);
		}
	}

	private showError(error: unknown, note: NoteHandle): void {
		const status = error instanceof TrelloError ? error.status : 0;
		const retry: MessageAction = { label: "Try again", run: () => void this.follow(true) };
		if (status === 404) {
			this.message("This card no longer exists on Trello.", this.commandActions(["unlink-active-note", "link-active-note-pick"]));
		} else if (status === 401) {
			this.message("Trello refused the key or token.", [{ label: "Open the plugin settings", run: () => this.openSettings() }, retry]);
		} else if (status === 429) {
			this.message("Trello says too many requests were made. Wait a little, then try again.", [retry]);
		} else {
			console.error("[trello-vault-sync]", error);
			this.message(`${errorMessage(error)} (${note.basename})`, [retry]);
		}
	}

	private commandActions(ids: string[]): MessageAction[] {
		return COMMANDS.filter((command) => ids.includes(command.id)).map((command) => ({
			label: command.name,
			run: () => void command.run(this.ctx),
		}));
	}

	private openSettings(): void {
		const app = this.app as AppWithSettingDialog;
		app.setting.open();
		app.setting.openTabById("trello-vault-sync");
	}

	private message(text: string, actions: MessageAction[] = []): void {
		this.contentEl.empty();
		const box = this.contentEl.createDiv({ cls: "tvs-card-view__empty" });
		box.createEl("p", { text });
		for (const action of actions) {
			box.createEl("button", { text: action.label }).addEventListener("click", action.run);
		}
	}

	private async renderCard(note: NoteHandle, card: TrelloCardView, seq: number): Promise<void> {
		const v = this.ctx.settings.cardView;
		const root = createDiv({ cls: "tvs-card-view" });
		this.renderHeader(root, card);
		if (card.closed) {
			const banner = root.createDiv({ cls: "tvs-card-view__banner" });
			banner.createSpan({ text: "This card is archived on Trello." });
			for (const action of this.commandActions(["unlink-active-note"])) {
				banner.createEl("button", { text: action.label }).addEventListener("click", action.run);
			}
		}
		for (const section of visibleSections(v.sectionOrder, v.sections, v.perCard[card.id])) {
			await this.renderSection(section, card, root, note.path);
			if (seq !== this.seq) return;
		}
		this.contentEl.empty();
		this.contentEl.appendChild(root);
	}

	private renderHeader(root: HTMLElement, card: TrelloCardView): void {
		const bar = root.createDiv({ cls: "tvs-card-view__header" });
		const button = (icon: string, tip: string, run: () => void | Promise<void>) => {
			const el = bar.createEl("button", { cls: "clickable-icon" });
			setIcon(el, icon);
			setTooltip(el, tip);
			el.addEventListener("click", () => void run());
		};
		const afterCommand = (id: string) => async () => {
			await COMMANDS.find((command) => command.id === id)?.run(this.ctx);
			await this.follow(true);
		};
		button("refresh-cw", "Reload the card from Trello", () => this.follow(true));
		button("external-link", "Open on Trello", () => {
			window.open(cardLink(card.url, this.ctx.settings.cardView.openLinksIn));
		});
		button("link", "Link this note to another card", afterCommand("link-active-note-pick"));
		button("unlink", "Unlink this note from its card", afterCommand("unlink-active-note"));
		button("arrow-left-right", "Sync this note with its card", afterCommand("sync-active-note"));
	}

	private async renderSection(section: CardViewSection, card: TrelloCardView, root: HTMLElement, sourcePath: string): Promise<void> {
		const v = this.ctx.settings.cardView;
		const block = (cls: string, title: string | null, empty: string, filled: boolean): HTMLElement | null => {
			if (!filled && !v.showEmptySections) return null;
			const el = root.createDiv({ cls: `tvs-card-view__section tvs-card-view__${cls}` });
			if (title) el.createDiv({ cls: "tvs-card-view__section-title", text: title });
			if (!filled) el.createDiv({ cls: "tvs-card-view__none", text: empty });
			return filled ? el : null;
		};

		switch (section) {
			case "cover": {
				const scaled = [...(card.cover?.scaled ?? [])].sort((a, b) => a.width - b.width);
				const best = scaled.find((image) => image.width >= this.contentEl.clientWidth) ?? scaled[scaled.length - 1];
				const el = block("cover", null, "No cover", best !== undefined);
				if (el && best) el.createEl("img", { attr: { src: best.url, alt: "" } });
				return;
			}
			case "title": {
				const el = root.createDiv({ cls: "tvs-card-view__section tvs-card-view__title" });
				const heading = el.createEl("h3");
				heading.createEl("a", { text: card.name, href: cardLink(card.url, v.openLinksIn) });
				return;
			}
			case "list": {
				const el = block("list", "List", "No list", card.list !== undefined);
				el?.createSpan({ text: card.list?.name ?? "" });
				return;
			}
			case "due": {
				const state = dueState(card.due, card.dueComplete, Date.now(), v.dueSoonHours);
				const el = block("due", "Due date", "No due date", state !== "none");
				if (!el || !card.due) return;
				const badge = el.createSpan({ cls: `tvs-card-view__due tvs-card-view__due--${state}`, text: this.formatDate(card.due) });
				if (state === "complete") badge.appendText(" · done");
				else if (state === "overdue") badge.appendText(" · overdue");
				return;
			}
			case "labels": {
				const labels = card.labels ?? [];
				const el = block("labels", "Labels", "No labels", labels.length > 0);
				for (const label of labels) {
					const base = (label.color ?? "none").split("_")[0];
					el?.createSpan({ cls: `tvs-card-view__label tvs-card-view__label--${base}`, text: label.name || base || "label" });
				}
				return;
			}
			case "members": {
				const members = card.members ?? [];
				const el = block("members", "Members", "No members", members.length > 0);
				for (const member of members) el?.createSpan({ cls: "tvs-card-view__member", text: member.fullName });
				return;
			}
			case "description": {
				const el = block("description", "Description", "No description", card.desc.trim() !== "");
				if (el) await this.renderText(el.createDiv({ cls: "tvs-card-view__text" }), card.desc, sourcePath);
				return;
			}
			case "checklists": {
				const checklists = card.checklists ?? [];
				const el = block("checklists", "Checklists", "No checklists", checklists.length > 0);
				for (const checklist of checklists) {
					const { done, total } = checklistProgress(checklist);
					const details = el?.createEl("details", { attr: { open: "" } });
					details?.createEl("summary", { text: `${checklist.name} (${done}/${total})` });
					details?.createEl("progress", { attr: { value: String(done), max: String(Math.max(total, 1)) } });
					for (const item of checklist.checkItems) {
						const row = details?.createEl("label", { cls: "tvs-card-view__check" });
						const box = row?.createEl("input", { attr: { type: "checkbox", disabled: "" } });
						if (box) box.checked = item.state === "complete";
						row?.createSpan({ text: item.name });
					}
				}
				return;
			}
			case "attachments": {
				const attachments = card.attachments ?? [];
				const el = block("attachments", "Attachments", "No attachments", attachments.length > 0);
				for (const attachment of attachments) {
					el?.createDiv().createEl("a", { text: attachment.name || attachment.url, href: attachment.url });
				}
				return;
			}
			case "customFields": {
				const items = card.customFieldItems ?? [];
				if (items.length === 0 && !v.showEmptySections) return;
				const el = block("custom-fields", "Custom fields", "No custom fields", items.length > 0);
				if (!el) return;
				const definitions = buildCustomFieldDefinitions(await this.data.customFields(card.idBoard));
				for (const item of items) {
					const def = definitions.get(item.idCustomField);
					const value = def ? resolveCustomFields([item], definitions)[def.name] : undefined;
					if (!def || value === undefined) continue;
					const row = el.createDiv({ cls: "tvs-card-view__field" });
					row.createSpan({ cls: "tvs-card-view__field-name", text: `${def.name}: ` });
					row.createSpan({ text: this.formatFieldValue(def.type, value) });
				}
				return;
			}
			case "comments": {
				const comments = card.actions ?? [];
				const el = block("comments", "Comments", "No comments", comments.length > 0);
				for (const comment of comments) {
					const entry = el?.createDiv({ cls: "tvs-card-view__comment" });
					const head = entry?.createDiv({ cls: "tvs-card-view__comment-head" });
					head?.createSpan({ cls: "tvs-card-view__comment-author", text: comment.memberCreator?.fullName ?? "Someone" });
					head?.createSpan({ cls: "tvs-card-view__comment-date", text: ` · ${this.formatDate(comment.date)}` });
					if (entry) await this.renderText(entry.createDiv({ cls: "tvs-card-view__text" }), comment.data.text, sourcePath);
				}
				return;
			}
		}
	}

	private formatFieldValue(type: string, value: string | number | boolean): string {
		if (type === "checkbox") return value === true ? "Yes" : "No";
		return type === "date" ? this.formatDate(String(value)) : String(value);
	}

	private formatDate(iso: string): string {
		const format = this.ctx.settings.cardView.dateFormat;
		return format ? moment(iso).format(format) : new Date(iso).toLocaleString();
	}

	private async renderText(el: HTMLElement, markdown: string, sourcePath: string): Promise<void> {
		if (this.ctx.settings.cardView.renderMarkdown) {
			await MarkdownRenderer.render(this.app, markdown, el, sourcePath, this);
		} else {
			el.addClass("tvs-card-view__plain");
			el.setText(markdown);
		}
	}
}
