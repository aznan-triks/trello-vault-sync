import { describe, expect, test } from "vitest";
import { createCardFromNote } from "../src/features/createCardFromNote";
import { FakeVault } from "./fakes";
import { TrelloClient, type HttpRequest, type HttpResponse, type TrelloCard } from "../src/trello/client";

const CREDENTIALS = { apiKey: "key", token: "tok" };

function stubTransport(responses: HttpResponse[]) {
	const calls: HttpRequest[] = [];
	const queue = [...responses];
	const transport = async (req: HttpRequest): Promise<HttpResponse> => {
		calls.push(req);
		return queue.shift() ?? { status: 200, text: "{}" };
	};
	return { transport, calls };
}

const ok = (body: unknown): HttpResponse => ({ status: 200, text: JSON.stringify(body) });

describe("createCardFromNote", () => {
	const createdCard: TrelloCard = {
		id: "c-new",
		idBoard: "b1",
		idList: "l-inbox",
		name: "My Note",
		desc: "Body of the note",
		due: "2026-10-01T10:00:00.000Z",
		url: "https://trello.com/c/new",
		dateLastActivity: "2026-09-22T06:00:00.000Z",
	};

	const boardLabels = [
		{ id: "lbl1", name: "Urgent", color: "red" },
		{ id: "lbl2", name: "Feature", color: "blue" },
	];

	test("creates a card on Trello with note name, body, due, labels and links the note", async () => {
		const vault = new FakeVault({
			"Notes/My Note.md": {
				content: `---\ntrello_due: "2026-10-01T10:00:00.000Z"\ntrello_labels:\n  - "Urgent"\n---\n\nBody of the note`,
			},
		});
		const note = vault.note("Notes/My Note.md");

		const { transport, calls } = stubTransport([ok(createdCard)]);
		const client = new TrelloClient(CREDENTIALS, transport);

		const result = await createCardFromNote(
			vault,
			client,
			note,
			"l-inbox",
			boardLabels,
		);

		expect(result.card).toEqual(createdCard);
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.body).toContain("idList=l-inbox");
		expect(calls[0]?.body).toContain("name=My+Note");
		expect(calls[0]?.body).toContain("desc=Body+of+the+note");
		expect(calls[0]?.body).toContain("due=2026-10-01T10%3A00%3A00.000Z");
		expect(calls[0]?.body).toContain("idLabels=lbl1");

		// Note frontmatter should now have cardRef linking to the new card
		const ref = vault.getCardRef(note);
		expect(ref).toEqual({ boardId: "b1", cardId: "c-new" });
	});

	test("replaces a dead/phantom card link on the note with the newly created card link", async () => {
		const vault = new FakeVault({
			"Notes/Phantom.md": {
				content: `---\ntrello_board_card_id: "b1;c-dead"\n---\n\nRecreating this card`,
			},
		});
		const note = vault.note("Notes/Phantom.md");

		const { transport } = stubTransport([
			ok({ ...createdCard, id: "c-reborn", name: "Phantom" }),
		]);
		const client = new TrelloClient(CREDENTIALS, transport);

		await createCardFromNote(vault, client, note, "l-inbox", []);

		const ref = vault.getCardRef(note);
		expect(ref).toEqual({ boardId: "b1", cardId: "c-reborn" });
	});

	test("respects dryRun: does not call Trello or touch note frontmatter", async () => {
		const vault = new FakeVault({
			"Notes/Draft.md": { content: "Unlinked content" },
		});
		const note = vault.note("Notes/Draft.md");

		const { transport, calls } = stubTransport([]);
		const client = new TrelloClient(CREDENTIALS, transport);

		const result = await createCardFromNote(
			vault,
			client,
			note,
			"l-inbox",
			[],
			{ dryRun: true },
		);

		expect(calls).toHaveLength(0);
		expect(vault.getCardRef(note)).toBeNull();
		expect(result.card.name).toBe("Draft");
		expect(result.card.idList).toBe("l-inbox");
	});

	test("strips checklist section from card desc even when syncChecklists is false", async () => {
		const vault = new FakeVault({
			"Notes/WithChecklist.md": {
				content: `# Title\n\nReal body content\n\n## Checklist\n- [ ] Item 1\n- [x] Item 2`,
			},
		});
		const note = vault.note("Notes/WithChecklist.md");

		const { transport, calls } = stubTransport([ok(createdCard)]);
		const client = new TrelloClient(CREDENTIALS, transport);

		await createCardFromNote(
			vault,
			client,
			note,
			"l-inbox",
			[],
			{ syncChecklists: false, checklistHeading: "## Checklist" },
		);

		const params = new URLSearchParams(calls[0]?.body);
		const desc = params.get("desc") ?? "";
		expect(desc).not.toContain("Item 1");
		expect(desc).not.toContain("Checklist");
		expect(desc).toContain("Real body content");
	});
});
