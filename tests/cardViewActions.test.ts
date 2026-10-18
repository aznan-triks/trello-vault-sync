import { describe, expect, test } from "vitest";
import { DEFAULT_CARD_VIEW_SETTINGS, dueToInputValue, inputValueToDue, type CardViewSettings } from "../src/core/cardViewModel";
import { OperationGuard } from "../src/core/operationGuard";
import { CardViewActions, customFieldValueFromInput } from "../src/features/cardViewActions";
import { TrelloClient } from "../src/trello/client";
import { routedTransport } from "./fakes";

function setup(patch: Partial<CardViewSettings> = {}) {
	const { transport, requests } = routedTransport({});
	const client = new TrelloClient({ apiKey: "k", token: "t" }, transport, { maxRetries: 0 });
	const settings = { ...DEFAULT_CARD_VIEW_SETTINGS, ...patch };
	return { actions: new CardViewActions(() => client, new OperationGuard(), () => settings), requests };
}

const bodyOf = (request: { body?: string }) => new URLSearchParams(request.body ?? "");

describe("CardViewActions", () => {
	test("rename sends the trimmed title with PUT", async () => {
		const { actions, requests } = setup();
		await actions.rename("c1", "  New title ");
		expect(requests).toHaveLength(1);
		expect(requests[0]!.method).toBe("PUT");
		expect(requests[0]!.url).toContain("/cards/c1");
		expect(bodyOf(requests[0]!).get("name")).toBe("New title");
	});

	test("an empty title or comment is refused before any request", async () => {
		const { actions, requests } = setup();
		await expect(actions.rename("c1", "  ")).rejects.toThrow();
		await expect(actions.comment("c1", " ")).rejects.toThrow();
		expect(requests).toHaveLength(0);
	});

	test("a field that is not editable makes no request", async () => {
		const { actions, requests } = setup({ editable: { ...DEFAULT_CARD_VIEW_SETTINGS.editable, description: false } });
		await expect(actions.setDescription("c1", "x")).rejects.toThrow(/turned off/);
		expect(requests).toHaveLength(0);
	});

	test("editing off makes every write refuse", async () => {
		const { actions, requests } = setup({ allowEditing: false });
		await expect(actions.archive("c1")).rejects.toThrow();
		await expect(actions.setLabels("c1", [])).rejects.toThrow();
		expect(requests).toHaveLength(0);
	});

	test("moving to a list uses the configured position", async () => {
		const { actions, requests } = setup({ movedCardPosition: "bottom" });
		await actions.moveToList("c1", "l2");
		expect(bodyOf(requests[0]!).get("idList")).toBe("l2");
		expect(bodyOf(requests[0]!).get("pos")).toBe("bottom");
	});

	test("clearing the due date also clears done", async () => {
		const { actions, requests } = setup();
		await actions.setDue("c1", null, true);
		expect(bodyOf(requests[0]!).get("due")).toBe("null");
		expect(bodyOf(requests[0]!).get("dueComplete")).toBe("false");
	});

	test("archiving closes the card, never deletes it", async () => {
		const { actions, requests } = setup();
		await actions.archive("c1");
		expect(requests[0]!.method).toBe("PUT");
		expect(bodyOf(requests[0]!).get("closed")).toBe("true");
	});

	test("check items: toggle, rename, add", async () => {
		const { actions, requests } = setup();
		await actions.setCheckItem("c1", "i1", true);
		await actions.renameCheckItem("c1", "i1", "Renamed");
		await actions.addCheckItem("c1", "cl1", "More");
		expect(requests.map((r) => r.method)).toEqual(["PUT", "PUT", "POST"]);
		expect(bodyOf(requests[0]!).get("state")).toBe("complete");
		expect(requests[2]!.url).toContain("/checklists/cl1/checkItems");
	});

	test("comments: add and edit", async () => {
		const { actions, requests } = setup();
		await actions.comment("c1", "hello").catch(() => undefined);
		await actions.editComment("c1", "a1", "edited");
		expect(requests[0]!.url).toContain("/cards/c1/actions/comments");
		expect(requests[1]!.url).toContain("/cards/c1/actions/a1/comments");
	});

	test("custom field goes out as JSON", async () => {
		const { actions, requests } = setup();
		await actions.setCustomField("c1", "f1", { text: "x" });
		expect(requests[0]!.contentType).toBe("application/json");
		expect(requests[0]!.url).toContain("/cards/c1/customField/f1/item");
	});

	test("attaching a link needs a http(s) url", async () => {
		const { actions, requests } = setup();
		await expect(actions.attachLink("c1", "not a url", "x")).rejects.toThrow();
		await expect(actions.attachLink("c1", "javascript:alert(1)", "x")).rejects.toThrow(/http/);
		expect(requests).toHaveLength(0);
		await actions.attachLink("c1", "https://example.com/a", "");
		expect(bodyOf(requests[0]!).get("url")).toBe("https://example.com/a");
		expect(bodyOf(requests[0]!).get("name")).toBe("https://example.com/a");
	});
});

describe("customFieldValueFromInput", () => {
	test("each type", () => {
		expect(customFieldValueFromInput("text", "")).toBeNull();
		expect(customFieldValueFromInput("text", "a")).toEqual({ text: "a" });
		expect(customFieldValueFromInput("number", "4.5")).toEqual({ number: "4.5" });
		expect(() => customFieldValueFromInput("number", "x")).toThrow();
		expect(customFieldValueFromInput("checkbox", "true")).toEqual({ checked: "true" });
		expect(customFieldValueFromInput("checkbox", "false")).toEqual({ checked: "false" });
		expect(customFieldValueFromInput("list", "")).toBeNull();
		expect(customFieldValueFromInput("list", "o1")).toEqual({ idValue: "o1" });
		expect(customFieldValueFromInput("date", "2026-10-20T10:30")).toEqual({ date: new Date("2026-10-20T10:30").toISOString() });
	});
});

describe("due date inputs", () => {
	test("round trip keeps the minute", () => {
		const iso = "2026-10-20T10:30:00.000Z";
		expect(inputValueToDue(dueToInputValue(iso))).toBe(iso);
	});
	test("empty or unreadable", () => {
		expect(dueToInputValue(null)).toBe("");
		expect(dueToInputValue("garbage")).toBe("");
		expect(inputValueToDue("")).toBeNull();
		expect(inputValueToDue("garbage")).toBeNull();
	});
});
