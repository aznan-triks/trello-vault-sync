import type { CardViewEditableField, CardViewSettings } from "../core/cardViewModel";
import type { OperationGuard } from "../core/operationGuard";
import type { CustomFieldType } from "../core/customFieldRef";
import type { CustomFieldValue, TrelloClient, TrelloComment } from "../trello/client";

/**
 * A custom-field value as Trello wants it, from what an input held ("" = cleared).
 * Throws on a number that is not one - nothing is sent.
 */
export function customFieldValueFromInput(type: CustomFieldType, raw: string): CustomFieldValue {
	switch (type) {
		case "text":
			return raw.trim() === "" ? null : { text: raw };
		case "number": {
			if (raw.trim() === "") return null;
			const parsed = Number(raw);
			if (!Number.isFinite(parsed)) throw new Error(`"${raw}" is not a number.`);
			return { number: String(parsed) };
		}
		case "date": {
			if (raw === "") return null;
			const at = new Date(raw);
			if (Number.isNaN(at.getTime())) throw new Error(`"${raw}" is not a date.`);
			return { date: at.toISOString() };
		}
		case "checkbox":
			return { checked: raw === "true" ? "true" : "false" };
		case "list":
			return raw === "" ? null : { idValue: raw };
	}
}

/**
 * What the card view can change on a card. Every write is refused (no request) when editing is off or the field
 * is not editable, and runs under the card's key so it takes turns with a sync touching the same card.
 * Nothing here deletes anything on Trello (the "always recoverable" rule): no comment, checklist item, attachment or card removal.
 */
export class CardViewActions {
	constructor(
		private readonly client: () => TrelloClient,
		private readonly guard: OperationGuard | undefined,
		private readonly settings: () => CardViewSettings,
	) {}

	canEdit(field: CardViewEditableField): boolean {
		const s = this.settings();
		return s.allowEditing && s.editable[field];
	}

	private write<T>(field: CardViewEditableField, cardId: string, task: (client: TrelloClient) => Promise<T>): Promise<T> {
		if (!this.canEdit(field)) return Promise.reject(new Error(`Editing the ${field} is turned off in the card view settings.`));
		const run = () => task(this.client());
		return this.guard ? this.guard.withKey(`card:${cardId}`, run) : run();
	}

	rename(cardId: string, name: string): Promise<void> {
		const title = name.trim();
		if (title === "") return Promise.reject(new Error("A card needs a title."));
		return this.write("title", cardId, (c) => c.updateCard(cardId, { name: title }));
	}

	setDescription(cardId: string, desc: string): Promise<void> {
		return this.write("description", cardId, (c) => c.updateCard(cardId, { desc }));
	}

	/** `due: null` clears the date. */
	setDue(cardId: string, due: string | null, dueComplete: boolean): Promise<void> {
		return this.write("due", cardId, (c) => c.updateCard(cardId, { due, dueComplete: due === null ? false : dueComplete }));
	}

	moveToList(cardId: string, listId: string): Promise<void> {
		return this.write("list", cardId, (c) => c.updateCard(cardId, { idList: listId, pos: this.settings().movedCardPosition }));
	}

	setLabels(cardId: string, labelIds: string[]): Promise<void> {
		return this.write("labels", cardId, (c) => c.updateCard(cardId, { idLabels: labelIds }));
	}

	setMembers(cardId: string, memberIds: string[]): Promise<void> {
		return this.write("members", cardId, (c) => c.updateCard(cardId, { idMembers: memberIds }));
	}

	setCheckItem(cardId: string, checkItemId: string, complete: boolean): Promise<void> {
		return this.write("checklists", cardId, (c) => c.updateCheckItemState(cardId, checkItemId, complete ? "complete" : "incomplete"));
	}

	renameCheckItem(cardId: string, checkItemId: string, name: string): Promise<void> {
		const text = name.trim();
		if (text === "") return Promise.reject(new Error("An item needs a name."));
		return this.write("checklists", cardId, (c) => c.renameCheckItem(cardId, checkItemId, text));
	}

	addCheckItem(cardId: string, checklistId: string, name: string): Promise<void> {
		const text = name.trim();
		if (text === "") return Promise.reject(new Error("An item needs a name."));
		return this.write("checklists", cardId, (c) => c.addCheckItem(checklistId, text));
	}

	comment(cardId: string, text: string): Promise<TrelloComment> {
		if (text.trim() === "") return Promise.reject(new Error("A comment cannot be empty."));
		return this.write("comments", cardId, (c) => c.addComment(cardId, text));
	}

	editComment(cardId: string, actionId: string, text: string): Promise<void> {
		if (text.trim() === "") return Promise.reject(new Error("A comment cannot be empty."));
		return this.write("comments", cardId, (c) => c.updateComment(cardId, actionId, text));
	}

	setCustomField(cardId: string, fieldId: string, value: CustomFieldValue): Promise<void> {
		return this.write("customFields", cardId, (c) => c.setCustomFieldItem(cardId, fieldId, value));
	}

	attachLink(cardId: string, url: string, name: string): Promise<void> {
		let parsed: URL;
		try {
			parsed = new URL(url.trim());
		} catch {
			return Promise.reject(new Error(`"${url}" is not a valid link.`));
		}
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return Promise.reject(new Error("Only http and https links can be attached."));
		return this.write("attachments", cardId, (c) => c.addUrlAttachment(cardId, parsed.href, name.trim() || parsed.href));
	}

	/** Archives (closes) the card - it can be reopened from Trello. */
	archive(cardId: string): Promise<void> {
		return this.write("archive", cardId, (c) => c.updateCard(cardId, { closed: true }));
	}
}
