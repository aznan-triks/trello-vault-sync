import { describe, expect, test } from "vitest";
import { checklistsDiffer, resolveChecklists } from "../src/features/checklistSync";
import type { TrelloChecklist } from "../src/trello/client";

const HEADING = "## Checklist";

describe("resolveChecklists", () => {
	test("renders the remote state as-is when there is no local checklist section", () => {
		const remote: TrelloChecklist[] = [
			{ id: "cl1", name: "Prep", checkItems: [{ id: "i1", name: "Réserver", state: "complete" }] },
		];

		const result = resolveChecklists(remote, null, HEADING);

		expect(result).toEqual({
			markdown: "## Checklist\n### Prep\n- [x] Réserver",
			pushes: [],
		});
	});

	test("pushes the local checked state for a matching item, and reflects it in the final render", () => {
		const remote: TrelloChecklist[] = [
			{ id: "cl1", name: "Prep", checkItems: [{ id: "i1", name: "Réserver", state: "incomplete" }] },
		];
		const local = "## Checklist\n### Prep\n- [x] Réserver";

		const result = resolveChecklists(remote, local, HEADING);

		expect(result.pushes).toEqual([{ checkItemId: "i1", state: "complete" }]);
		expect(result.markdown).toBe("## Checklist\n### Prep\n- [x] Réserver");
	});

	test("does nothing for an item whose local and remote state already agree", () => {
		const remote: TrelloChecklist[] = [
			{ id: "cl1", name: "Prep", checkItems: [{ id: "i1", name: "Réserver", state: "complete" }] },
		];
		const local = "## Checklist\n### Prep\n- [x] Réserver";

		const result = resolveChecklists(remote, local, HEADING);

		expect(result.pushes).toEqual([]);
	});

	test("drops a locally-typed item with no matching name on the remote checklist", () => {
		const remote: TrelloChecklist[] = [
			{ id: "cl1", name: "Prep", checkItems: [{ id: "i1", name: "Réserver", state: "incomplete" }] },
		];
		const local = "## Checklist\n### Prep\n- [ ] Réserver\n- [ ] Acheter des fleurs";

		const result = resolveChecklists(remote, local, HEADING);

		expect(result.markdown).toBe("## Checklist\n### Prep\n- [ ] Réserver");
		expect(result.pushes).toEqual([]);
	});

	test("returns a null markdown and no pushes when the card has no checklists at all", () => {
		const local = "## Checklist\n### Prep\n- [x] Réserver";

		const result = resolveChecklists([], local, HEADING);

		expect(result).toEqual({ markdown: null, pushes: [] });
	});

	test("matches duplicate item names in order, first local occurrence to first remote occurrence", () => {
		const remote: TrelloChecklist[] = [
			{
				id: "cl1",
				name: "Prep",
				checkItems: [
					{ id: "i1", name: "Item", state: "incomplete" },
					{ id: "i2", name: "Item", state: "incomplete" },
				],
			},
		];
		const local = "## Checklist\n### Prep\n- [x] Item\n- [ ] Item";

		const result = resolveChecklists(remote, local, HEADING);

		expect(result.pushes).toEqual([{ checkItemId: "i1", state: "complete" }]);
		expect(result.markdown).toBe("## Checklist\n### Prep\n- [x] Item\n- [ ] Item");
	});

	test("ignores a local checklist group with no matching name on the remote", () => {
		const remote: TrelloChecklist[] = [
			{ id: "cl1", name: "Prep", checkItems: [{ id: "i1", name: "Réserver", state: "incomplete" }] },
		];
		const local = "## Checklist\n### Autre\n- [x] Truc";

		const result = resolveChecklists(remote, local, HEADING);

		expect(result.markdown).toBe("## Checklist\n### Prep\n- [ ] Réserver");
		expect(result.pushes).toEqual([]);
	});
});

describe("resolveChecklists — remote wins", () => {
	test("takes the remote state of an item known to both sides and pushes nothing", () => {
		const remote: TrelloChecklist[] = [
			{ id: "cl1", name: "Prep", checkItems: [{ id: "i1", name: "Réserver", state: "complete" }] },
		];
		const local = "## Checklist\n### Prep\n- [ ] Réserver";

		const result = resolveChecklists(remote, local, HEADING, "remote");

		expect(result.pushes).toEqual([]);
		expect(result.markdown).toBe("## Checklist\n### Prep\n- [x] Réserver");
	});

	test("matches names ignoring surrounding spaces on the Trello side", () => {
		const remote: TrelloChecklist[] = [
			{ id: "cl1", name: "Prep ", checkItems: [{ id: "i1", name: "Réserver ", state: "incomplete" }] },
		];
		const local = "## Checklist\n### Prep\n- [x] Réserver";

		const result = resolveChecklists(remote, local, HEADING);

		expect(result.pushes).toEqual([{ checkItemId: "i1", state: "complete" }]);
		expect(result.markdown).toBe("## Checklist\n### Prep\n- [x] Réserver");
	});
});

describe("checklistsDiffer", () => {
	const remote: TrelloChecklist[] = [
		{ id: "cl1", name: "Prep", checkItems: [{ id: "i1", name: "Réserver", state: "complete" }] },
	];

	test("is false when the note shows the same items in the same states", () => {
		expect(checklistsDiffer(remote, "## Checklist\n### Prep\n- [x] Réserver", HEADING)).toBe(false);
	});

	test("is true for a different state, a missing item or a missing section", () => {
		expect(checklistsDiffer(remote, "## Checklist\n### Prep\n- [ ] Réserver", HEADING)).toBe(true);
		expect(checklistsDiffer(remote, "## Checklist\n### Prep", HEADING)).toBe(true);
		expect(checklistsDiffer(remote, null, HEADING)).toBe(true);
	});

	test("is false when neither side has a checklist", () => {
		expect(checklistsDiffer([], null, HEADING)).toBe(false);
	});

	test("ignores spaces around a Trello name", () => {
		const spaced: TrelloChecklist[] = [
			{ id: "cl1", name: "Prep", checkItems: [{ id: "i1", name: "Réserver ", state: "complete" }] },
		];
		expect(checklistsDiffer(spaced, "## Checklist\n### Prep\n- [x] Réserver", HEADING)).toBe(false);
	});
});
