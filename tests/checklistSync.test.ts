import { describe, expect, test } from "vitest";
import { resolveChecklists } from "../src/features/checklistSync";
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
