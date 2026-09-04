import { describe, expect, test } from "vitest";
import { describeAction, type TrelloAction } from "../src/core/auditAction";

const action = (partial: Partial<TrelloAction> & { type: string }): TrelloAction => ({
	id: "a1",
	date: "2026-09-04T10:00:00.000Z",
	memberCreator: { fullName: "Ann" },
	...partial,
});

describe("describeAction", () => {
	test("updateCard — name change", () => {
		const entry = describeAction(
			action({
				type: "updateCard",
				data: { old: { name: "Before" }, card: { name: "After" } },
			}),
		);
		expect(entry?.detail).toBe('Name: "Before" → "After"');
	});

	test("updateCard — description change", () => {
		const entry = describeAction(
			action({
				type: "updateCard",
				data: { old: { desc: "1234567890" }, card: {} },
			}),
		);
		expect(entry?.detail).toBe("Description changed (previous length: 10 chars)");
	});

	test("updateCard — archived", () => {
		const entry = describeAction(
			action({ type: "updateCard", data: { old: { closed: false }, card: { closed: true } } }),
		);
		expect(entry?.detail).toBe("Card archived");
	});

	test("updateCard — unarchived", () => {
		const entry = describeAction(
			action({ type: "updateCard", data: { old: { closed: true }, card: { closed: false } } }),
		);
		expect(entry?.detail).toBe("Card unarchived");
	});

	test("updateCard — moved between lists", () => {
		const entry = describeAction(
			action({
				type: "updateCard",
				data: {
					old: { idList: "l1" },
					card: { idList: "l2" },
					listBefore: { name: "Ideas" },
					listAfter: { name: "Done" },
				},
			}),
		);
		expect(entry?.detail).toBe('Moved: "Ideas" → "Done"');
	});

	test("updateCard — due date changed", () => {
		const entry = describeAction(
			action({
				type: "updateCard",
				data: { old: { due: null }, card: { due: "2026-10-01T00:00:00.000Z" } },
			}),
		);
		expect(entry?.detail).toBe("Due date changed: none → 2026-10-01T00:00:00.000Z");
	});

	test("updateCard — members changed", () => {
		const entry = describeAction(
			action({ type: "updateCard", data: { old: { idMembers: [] }, card: {} } }),
		);
		expect(entry?.detail).toBe("Card members changed");
	});

	test("updateCard — untracked field returns null", () => {
		const entry = describeAction(
			action({ type: "updateCard", data: { old: { pos: 1 }, card: {} } }),
		);
		expect(entry).toBeNull();
	});

	test("createCard", () => {
		expect(describeAction(action({ type: "createCard" }))?.detail).toBe("Card created");
	});

	test("deleteCard", () => {
		expect(describeAction(action({ type: "deleteCard" }))?.detail).toBe("Card deleted");
	});

	test("addAttachmentToCard", () => {
		const entry = describeAction(
			action({ type: "addAttachmentToCard", data: { attachment: { name: "map.png" } } }),
		);
		expect(entry?.detail).toBe("Attachment added: map.png");
	});

	test("deleteAttachmentFromCard", () => {
		const entry = describeAction(
			action({ type: "deleteAttachmentFromCard", data: { attachment: { name: "map.png" } } }),
		);
		expect(entry?.detail).toBe("Attachment removed: map.png");
	});

	test("commentCard", () => {
		expect(describeAction(action({ type: "commentCard" }))?.detail).toBe("Comment added");
	});

	test("addMemberToCard", () => {
		const entry = describeAction(action({ type: "addMemberToCard", data: { member: { name: "bob" } } }));
		expect(entry?.detail).toBe("Member added: bob");
	});

	test("removeMemberFromCard", () => {
		const entry = describeAction(
			action({ type: "removeMemberFromCard", data: { member: { name: "bob" } } }),
		);
		expect(entry?.detail).toBe("Member removed: bob");
	});

	test("createChecklist", () => {
		const entry = describeAction(
			action({ type: "createChecklist", data: { checklist: { name: "Steps" } } }),
		);
		expect(entry?.detail).toBe("Checklist created: Steps");
	});

	test("updateCheckItemStateOnCard", () => {
		const entry = describeAction(
			action({
				type: "updateCheckItemStateOnCard",
				data: { checkItem: { name: "Step 1", state: "complete" } },
			}),
		);
		expect(entry?.detail).toBe('Checklist item "Step 1" → complete');
	});

	test("unmapped action type returns null", () => {
		expect(describeAction(action({ type: "voteOnCard" }))).toBeNull();
	});

	test("assembles the full entry — id, date, author, card, list, type", () => {
		const entry = describeAction(
			action({
				id: "a42",
				type: "createCard",
				date: "2026-09-04T10:00:00.000Z",
				memberCreator: { fullName: "Ann" },
				data: { card: { name: "New quest" }, list: { name: "Ideas" } },
			}),
		);
		expect(entry).toEqual({
			id: "a42",
			date: "2026-09-04T10:00:00.000Z",
			author: "Ann",
			cardName: "New quest",
			listName: "Ideas",
			type: "createCard",
			detail: "Card created",
		});
	});

	test("falls back to Unknown author and empty card/list names when missing", () => {
		const entry = describeAction({ id: "a1", date: "t", type: "createCard" });
		expect(entry?.author).toBe("Unknown");
		expect(entry?.cardName).toBe("");
		expect(entry?.listName).toBe("");
	});
});
