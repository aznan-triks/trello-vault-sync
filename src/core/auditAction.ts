/**
 * Minimal shape of a Trello action (`/boards/{id}/actions`) this module reads.
 * Defined locally rather than imported from `trello/client.ts` — `core/`
 * stays decoupled from the wire layer, same precedent as `SyncInput` in
 * `syncDecision.ts`.
 */
export interface TrelloAction {
	id: string;
	type: string;
	date: string;
	memberCreator?: { fullName?: string; avatarUrl?: string };
	data?: {
		old?: Record<string, unknown>;
		card?: { name?: string; closed?: boolean; idList?: string; due?: string | null };
		list?: { name?: string };
		listBefore?: { name?: string };
		listAfter?: { name?: string };
		attachment?: { name?: string };
		member?: { name?: string };
		checklist?: { name?: string };
		checkItem?: { name?: string; state?: string };
	};
}

export interface AuditEntry {
	id: string;
	date: string;
	author: string;
	/** The author's Trello avatar url, when Trello returns one — undefined otherwise (deleted account, or a member with no custom avatar). */
	authorAvatarUrl?: string;
	cardName: string;
	listName: string;
	type: string;
	detail: string;
}

/**
 * Ported from the reference proto's `describeAction_()` (old→new mapping),
 * translated to English (no French in `src/`, see CONTEXT.md §0). Unlike the
 * proto's split between `describeAction_()` (detail only) and `writeRow()`
 * (the rest of the row), this assembles the full entry in one pure function,
 * as the feature spec asks for. Returns `null` for anything not in the
 * mapping, same as the proto — keeps the change log readable.
 */
export function describeAction(action: TrelloAction): AuditEntry | null {
	const detail = describeDetail(action);
	if (detail === null) return null;

	const data = action.data ?? {};
	return {
		id: action.id,
		date: action.date,
		author: action.memberCreator?.fullName ?? "Unknown",
		authorAvatarUrl: action.memberCreator?.avatarUrl,
		cardName: data.card?.name ?? "",
		listName: data.list?.name ?? data.listAfter?.name ?? "",
		type: action.type,
		detail,
	};
}

function describeDetail(action: TrelloAction): string | null {
	const data = action.data ?? {};
	const old = data.old ?? {};

	switch (action.type) {
		case "updateCard":
			if ("name" in old) return `Name: "${String(old.name)}" → "${data.card?.name ?? ""}"`;
			if ("desc" in old) {
				const previous = typeof old.desc === "string" ? old.desc : "";
				return `Description changed (previous length: ${previous.length} chars)`;
			}
			if ("closed" in old) return data.card?.closed ? "Card archived" : "Card unarchived";
			if ("idList" in old) {
				const before = data.listBefore?.name ?? String(old.idList);
				const after = data.listAfter?.name ?? data.card?.idList ?? "";
				return `Moved: "${before}" → "${after}"`;
			}
			if ("due" in old) return `Due date changed: ${old.due || "none"} → ${data.card?.due || "none"}`;
			if ("idMembers" in old) return "Card members changed";
			return null; // other updateCard fields aren't tracked

		case "createCard":
			return "Card created";
		case "deleteCard":
			return "Card deleted";

		case "addAttachmentToCard":
			return `Attachment added: ${data.attachment?.name ?? ""}`;
		case "deleteAttachmentFromCard":
			return `Attachment removed: ${data.attachment?.name ?? ""}`;

		case "commentCard":
			return "Comment added";

		case "addMemberToCard":
			return `Member added: ${data.member?.name ?? ""}`;
		case "removeMemberFromCard":
			return `Member removed: ${data.member?.name ?? ""}`;

		case "createChecklist":
			return `Checklist created: ${data.checklist?.name ?? ""}`;
		case "updateCheckItemStateOnCard":
			return `Checklist item "${data.checkItem?.name ?? ""}" → ${data.checkItem?.state ?? ""}`;

		default:
			return null; // everything else is ignored to keep the log readable
	}
}
