import { ItemView, MarkdownRenderer, moment, Notice, setIcon, setTooltip, type WorkspaceLeaf } from "obsidian";
import type { CommandContext } from "../commands/context";
import { COMMANDS } from "../commands/registry";
import {
	cardLink,
	checklistProgress,
	dueState,
	dueToInputValue,
	inputValueToDue,
	visibleSections,
	type CardViewEditableField,
	type CardViewSection,
} from "../core/cardViewModel";
import { resolveCustomFields } from "../core/customFieldRef";
import { errorMessage } from "../core/errorMessage";
import { CardViewActions, customFieldValueFromInput } from "../features/cardViewActions";
import { CardViewData } from "../features/cardViewData";
import { buildCustomFieldDefinitions } from "../features/syncNote";
import type { NoteHandle } from "../obsidian/gateway";
import { hasCredentials } from "../settings/types";
import { TrelloError, type TrelloCardView } from "../trello/client";
import { ConfirmModal } from "./ConfirmModal";
import { ListPickerModal } from "./ListPickerModal";
import { MultiSelectPickerModal } from "./MultiSelectPickerModal";
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
	private readonly actions: CardViewActions;
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
		this.actions = new CardViewActions(() => this.ctx.client(), this.ctx.guard, v);
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
		if (this.actions.canEdit("archive") && !card.closed) {
			button("archive", "Archive the card on Trello", () => this.archive(card));
		}
	}

	private archive(card: TrelloCardView): void {
		const run = () => void this.edit(card.id, () => this.actions.archive(card.id));
		if (this.ctx.settings.cardView.confirmArchive) {
			new ConfirmModal(this.app, `Archive "${card.name}" on Trello? You can reopen it from Trello.`, run, "Archive").open();
		} else {
			run();
		}
	}

	/**
	 * Runs one write, then reloads the card (and updates the note when asked). A failure is reported
	 * and the display goes back to what Trello last said.
	 */
	private async edit(cardId: string, task: () => Promise<unknown>): Promise<void> {
		try {
			await task();
		} catch (error) {
			this.reportError(error);
			await this.follow(false, true);
			return;
		}
		this.data.invalidate(cardId);
		if (this.ctx.settings.cardView.pullAfterEdit) await COMMANDS.find((command) => command.id === "pull-active-note")?.run(this.ctx);
		await this.follow(true);
	}

	private cancelEdit(): void {
		void this.follow(false, true);
	}

	private pencil(parent: HTMLElement | null, tip: string, run: () => void): void {
		if (!parent) return;
		const el = parent.createEl("button", { cls: "clickable-icon tvs-card-view__edit" });
		setIcon(el, "pencil");
		setTooltip(el, tip);
		el.addEventListener("click", run);
	}

	/** Save and Cancel buttons under a form. */
	private formButtons(form: HTMLElement, save: () => void, saveLabel = "Save"): void {
		const row = form.createDiv({ cls: "tvs-card-view__buttons" });
		row.createEl("button", { text: saveLabel, cls: "mod-cta" }).addEventListener("click", save);
		row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.cancelEdit());
	}

	/** One-line input: Enter saves, Escape cancels. */
	private lineInput(parent: HTMLElement, value: string, save: (value: string) => void, type = "text"): HTMLInputElement {
		const input = parent.createEl("input", { attr: { type }, cls: "tvs-card-view__input" });
		input.value = value;
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") save(input.value);
			else if (event.key === "Escape") this.cancelEdit();
		});
		return input;
	}

	private async renderSection(section: CardViewSection, card: TrelloCardView, root: HTMLElement, sourcePath: string): Promise<void> {
		const v = this.ctx.settings.cardView;
		/** The section's container (null = hidden because empty), plus the title row where its edit button goes. */
		const block = (
			cls: string,
			title: string | null,
			empty: string,
			filled: boolean,
			field?: CardViewEditableField,
		): SectionBlock | null => {
			const editable = field !== undefined && this.actions.canEdit(field);
			if (!filled && !v.showEmptySections && !editable) return null;
			const el = root.createDiv({ cls: `tvs-card-view__section tvs-card-view__${cls}` });
			const head = title ? el.createDiv({ cls: "tvs-card-view__section-head" }) : null;
			head?.createDiv({ cls: "tvs-card-view__section-title", text: title ?? "" });
			if (!filled) el.createDiv({ cls: "tvs-card-view__none", text: empty });
			return { el, head, editable };
		};

		switch (section) {
			case "cover": {
				const scaled = [...(card.cover?.scaled ?? [])].sort((a, b) => a.width - b.width);
				const best = scaled.find((image) => image.width >= this.contentEl.clientWidth) ?? scaled[scaled.length - 1];
				const b = block("cover", null, "No cover", best !== undefined);
				if (b && best) b.el.createEl("img", { attr: { src: best.url, alt: "" } });
				return;
			}
			case "title": {
				const el = root.createDiv({ cls: "tvs-card-view__section tvs-card-view__title" });
				const heading = el.createEl("h3");
				heading.createEl("a", { text: card.name, href: cardLink(card.url, v.openLinksIn) });
				if (this.actions.canEdit("title")) {
					this.pencil(heading, "Rename the card", () => {
						heading.empty();
						const save = (value: string) => void this.edit(card.id, () => this.actions.rename(card.id, value));
						this.lineInput(heading, card.name, save).focus();
					});
				}
				return;
			}
			case "list": {
				const b = block("list", "List", "No list", card.list !== undefined, "list");
				if (!b) return;
				if (card.list) b.el.createSpan({ text: card.list.name });
				this.pencil(b.editable ? b.head : null, "Move the card to another list", () => {
					void this.data.lists(card.idBoard).then(
						(lists) =>
							new ListPickerModal(this.app, lists, (list) => void this.edit(card.id, () => this.actions.moveToList(card.id, list.id))).open(),
						(error: unknown) => this.reportError(error),
					);
				});
				return;
			}
			case "due": {
				const state = dueState(card.due, card.dueComplete, Date.now(), v.dueSoonHours);
				const b = block("due", "Due date", "No due date", state !== "none", "due");
				if (!b) return;
				if (card.due) {
					const badge = b.el.createSpan({ cls: `tvs-card-view__due tvs-card-view__due--${state}`, text: this.formatDate(card.due) });
					if (state === "complete") badge.appendText(" · done");
					else if (state === "overdue") badge.appendText(" · overdue");
				}
				this.pencil(b.editable ? b.head : null, "Change the due date", () => this.editDue(b.el, card));
				return;
			}
			case "labels": {
				const labels = card.labels ?? [];
				const b = block("labels", "Labels", "No labels", labels.length > 0, "labels");
				if (!b) return;
				for (const label of labels) {
					const base = (label.color ?? "none").split("_")[0];
					b.el.createSpan({ cls: `tvs-card-view__label tvs-card-view__label--${base}`, text: label.name || base || "label" });
				}
				this.pencil(b.editable ? b.head : null, "Choose the labels", () => {
					void this.data.labels(card.idBoard).then(
						(all) => {
							const current = new Set(labels.map((label) => label.id));
							new MultiSelectPickerModal(
								this.app,
								"Labels of the card",
								all,
								(label) => label.name || label.color || label.id,
								"Save",
								(chosen) => void this.edit(card.id, () => this.actions.setLabels(card.id, chosen.map((label) => label.id))),
								(label) => current.has(label.id),
							).open();
						},
						(error: unknown) => this.reportError(error),
					);
				});
				return;
			}
			case "members": {
				const members = card.members ?? [];
				const b = block("members", "Members", "No members", members.length > 0, "members");
				if (!b) return;
				for (const member of members) b.el.createSpan({ cls: "tvs-card-view__member", text: member.fullName });
				this.pencil(b.editable ? b.head : null, "Choose the members", () => {
					void this.data.members(card.idBoard).then(
						(all) => {
							const current = new Set(members.map((member) => member.id));
							new MultiSelectPickerModal(
								this.app,
								"Members of the card",
								all,
								(member) => member.fullName,
								"Save",
								(chosen) => void this.edit(card.id, () => this.actions.setMembers(card.id, chosen.map((member) => member.id))),
								(member) => current.has(member.id),
							).open();
						},
						(error: unknown) => this.reportError(error),
					);
				});
				return;
			}
			case "description": {
				const b = block("description", "Description", "No description", card.desc.trim() !== "", "description");
				if (!b) return;
				if (card.desc.trim() !== "") await this.renderText(b.el.createDiv({ cls: "tvs-card-view__text" }), card.desc, sourcePath);
				this.pencil(b.editable ? b.head : null, "Edit the description", () => {
					b.el.empty();
					const area = b.el.createEl("textarea", { cls: "tvs-card-view__input", attr: { rows: "8" } });
					area.value = card.desc;
					this.formButtons(b.el, () => void this.edit(card.id, () => this.actions.setDescription(card.id, area.value)));
					area.focus();
				});
				return;
			}
			case "checklists": {
				const checklists = card.checklists ?? [];
				const b = block("checklists", "Checklists", "No checklists", checklists.length > 0, "checklists");
				if (!b) return;
				for (const checklist of checklists) this.renderChecklist(b.el, card, checklist);
				return;
			}
			case "attachments": {
				const attachments = card.attachments ?? [];
				const b = block("attachments", "Attachments", "No attachments", attachments.length > 0, "attachments");
				if (!b) return;
				for (const attachment of attachments) {
					b.el.createDiv().createEl("a", { text: attachment.name || attachment.url, href: attachment.url });
				}
				this.pencil(b.editable ? b.head : null, "Attach a link", () => {
					const form = b.el.createDiv({ cls: "tvs-card-view__form" });
					const url = form.createEl("input", { cls: "tvs-card-view__input", attr: { type: "url", placeholder: "https://…" } });
					const name = form.createEl("input", { cls: "tvs-card-view__input", attr: { type: "text", placeholder: "Name (optional)" } });
					this.formButtons(form, () => void this.edit(card.id, () => this.actions.attachLink(card.id, url.value, name.value)), "Attach");
					url.focus();
				});
				return;
			}
			case "customFields":
				await this.renderCustomFields(card, block("custom-fields", "Custom fields", "No custom fields", (card.customFieldItems ?? []).length > 0, "customFields"));
				return;
			case "comments":
				await this.renderComments(card, sourcePath, block("comments", "Comments", "No comments", (card.actions ?? []).length > 0, "comments"));
				return;
		}
	}

	private renderChecklist(parent: HTMLElement, card: TrelloCardView, checklist: NonNullable<TrelloCardView["checklists"]>[number]): void {
		const editable = this.actions.canEdit("checklists");
		const progress = checklistProgress(checklist);
		const details = parent.createEl("details", { attr: { open: "" } });
		const summary = details.createEl("summary", { text: `${checklist.name} (${progress.done}/${progress.total})` });
		const bar = details.createEl("progress", { attr: { value: String(progress.done), max: String(Math.max(progress.total, 1)) } });
		const refreshProgress = () => {
			const now = checklistProgress(checklist);
			summary.setText(`${checklist.name} (${now.done}/${now.total})`);
			bar.value = now.done;
			bar.max = Math.max(now.total, 1);
		};
		for (const item of checklist.checkItems) {
			const row = details.createEl("div", { cls: "tvs-card-view__check" });
			const box = row.createEl("input", { attr: { type: "checkbox" } });
			box.checked = item.state === "complete";
			box.disabled = !editable;
			const label = row.createSpan({ text: item.name });
			box.addEventListener("change", () => {
				const complete = box.checked;
				this.actions.setCheckItem(card.id, item.id, complete).then(
					() => {
						// The card is cached: keep it true without asking Trello again.
						item.state = complete ? "complete" : "incomplete";
						refreshProgress();
					},
					(error: unknown) => {
						box.checked = !complete;
						this.reportError(error);
					},
				);
			});
			if (editable) {
				label.addEventListener("dblclick", () => {
					label.empty();
					const save = (value: string) => void this.edit(card.id, () => this.actions.renameCheckItem(card.id, item.id, value));
					this.lineInput(label, item.name, save).focus();
				});
			}
		}
		if (editable) {
			const add = details.createEl("button", { text: "Add an item", cls: "tvs-card-view__add" });
			add.addEventListener("click", () => {
				add.remove();
				const save = (value: string) => void this.edit(card.id, () => this.actions.addCheckItem(card.id, checklist.id, value));
				this.lineInput(details, "", save).focus();
			});
		}
	}

	private async renderCustomFields(card: TrelloCardView, b: SectionBlock | null): Promise<void> {
		if (!b) return;
		const items = card.customFieldItems ?? [];
		const definitions = buildCustomFieldDefinitions(await this.data.customFields(card.idBoard));
		// Editing offers every field of the board; reading shows only the ones the card has a value for.
		const shown = b.editable ? [...definitions.values()] : items.flatMap((item) => definitions.get(item.idCustomField) ?? []);
		for (const def of shown) {
			const item = items.find((candidate) => candidate.idCustomField === def.id);
			const value = item ? resolveCustomFields([item], definitions)[def.name] : undefined;
			if (!b.editable && value === undefined) continue;
			const row = b.el.createDiv({ cls: "tvs-card-view__field" });
			row.createSpan({ cls: "tvs-card-view__field-name", text: `${def.name}: ` });
			if (!b.editable) {
				row.createSpan({ text: this.formatFieldValue(def.type, value ?? "") });
				continue;
			}
			const save = (raw: string) =>
				void this.edit(card.id, () => this.actions.setCustomField(card.id, def.id, customFieldValueFromInput(def.type, raw)));
			if (def.type === "list") {
				const select = row.createEl("select");
				select.createEl("option", { text: "—", attr: { value: "" } });
				for (const [id, text] of def.options ?? []) select.createEl("option", { text, attr: { value: id } });
				select.value = item?.idValue ?? "";
				select.addEventListener("change", () => save(select.value));
			} else if (def.type === "checkbox") {
				const box = row.createEl("input", { attr: { type: "checkbox" } });
				box.checked = value === true;
				box.addEventListener("change", () => save(String(box.checked)));
			} else {
				const type = def.type === "date" ? "datetime-local" : def.type === "number" ? "number" : "text";
				const input = row.createEl("input", { cls: "tvs-card-view__input", attr: { type } });
				input.value = def.type === "date" ? dueToInputValue(typeof value === "string" ? value : null) : value === undefined ? "" : String(value);
				input.addEventListener("change", () => save(input.value));
			}
		}
	}

	private async renderComments(card: TrelloCardView, sourcePath: string, b: SectionBlock | null): Promise<void> {
		if (!b) return;
		let myId: string | null = null;
		if (b.editable) {
			try {
				myId = (await this.data.whoAmI()).id;
			} catch (error) {
				console.error("[trello-vault-sync]", error);
			}
			const form = b.el.createDiv({ cls: "tvs-card-view__form" });
			const area = form.createEl("textarea", { cls: "tvs-card-view__input", attr: { rows: "3", placeholder: "Write a comment…" } });
			const send = () => void this.edit(card.id, () => this.actions.comment(card.id, area.value));
			area.addEventListener("keydown", (event) => {
				if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) send();
			});
			form.createEl("button", { text: "Comment", cls: "mod-cta" }).addEventListener("click", send);
		}
		for (const comment of card.actions ?? []) {
			const entry = b.el.createDiv({ cls: "tvs-card-view__comment" });
			const head = entry.createDiv({ cls: "tvs-card-view__comment-head" });
			head.createSpan({ cls: "tvs-card-view__comment-author", text: comment.memberCreator?.fullName ?? "Someone" });
			head.createSpan({ cls: "tvs-card-view__comment-date", text: ` · ${this.formatDate(comment.date)}` });
			const text = entry.createDiv({ cls: "tvs-card-view__text" });
			await this.renderText(text, comment.data.text, sourcePath);
			if (b.editable && myId !== null && comment.idMemberCreator === myId) {
				this.pencil(head, "Edit your comment", () => {
					text.empty();
					const area = text.createEl("textarea", { cls: "tvs-card-view__input", attr: { rows: "3" } });
					area.value = comment.data.text;
					this.formButtons(text, () => void this.edit(card.id, () => this.actions.editComment(card.id, comment.id, area.value)));
				});
			}
		}
	}

	private editDue(el: HTMLElement, card: TrelloCardView): void {
		el.empty();
		const form = el.createDiv({ cls: "tvs-card-view__form" });
		const input = form.createEl("input", { cls: "tvs-card-view__input", attr: { type: "datetime-local" } });
		input.value = dueToInputValue(card.due);
		const doneLabel = form.createEl("label", { cls: "tvs-card-view__check" });
		const done = doneLabel.createEl("input", { attr: { type: "checkbox" } });
		done.checked = card.dueComplete === true;
		doneLabel.createSpan({ text: "Done" });
		const row = form.createDiv({ cls: "tvs-card-view__buttons" });
		row.createEl("button", { text: "Save", cls: "mod-cta" }).addEventListener("click", () => {
			const due = inputValueToDue(input.value);
			if (due === null) {
				new Notice("Pick a date, or use Clear to remove the due date.");
				return;
			}
			void this.edit(card.id, () => this.actions.setDue(card.id, due, done.checked));
		});
		row.createEl("button", { text: "Clear" }).addEventListener("click", () => void this.edit(card.id, () => this.actions.setDue(card.id, null, false)));
		row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.cancelEdit());
	}

	private reportError(error: unknown): void {
		new Notice(`❌ ${errorMessage(error)}`);
		console.error("[trello-vault-sync]", error);
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

/** A drawn section: its container, the title row (where the edit button goes) and whether the card view may change it. */
interface SectionBlock {
	el: HTMLElement;
	head: HTMLElement | null;
	editable: boolean;
}
