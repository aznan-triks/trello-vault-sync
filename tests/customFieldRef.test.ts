import { describe, expect, test } from "vitest";
import {
	DEFAULT_CUSTOM_FIELDS_KEY,
	DEFAULT_SYNC_CUSTOM_FIELDS,
	formatCustomFieldsRef,
	parseCustomFieldsRef,
	resolveCustomFields,
	type CustomFieldDefinitionLike,
} from "../src/core/customFieldRef";

describe("DEFAULT_CUSTOM_FIELDS_KEY", () => {
	test("is trello_custom_fields", () => {
		expect(DEFAULT_CUSTOM_FIELDS_KEY).toBe("trello_custom_fields");
	});
});

describe("DEFAULT_SYNC_CUSTOM_FIELDS", () => {
	test("is on by default", () => {
		expect(DEFAULT_SYNC_CUSTOM_FIELDS).toBe(true);
	});
});

describe("parseCustomFieldsRef", () => {
	test("keeps a well-formed object as is", () => {
		expect(parseCustomFieldsRef({ Priority: "High" })).toEqual({ Priority: "High" });
	});

	test("defaults to an empty object for anything else", () => {
		expect(parseCustomFieldsRef(undefined)).toEqual({});
		expect(parseCustomFieldsRef("nope")).toEqual({});
		expect(parseCustomFieldsRef(["a", "b"])).toEqual({});
		expect(parseCustomFieldsRef(null)).toEqual({});
	});
});

describe("formatCustomFieldsRef", () => {
	test("returns the record as is when non-empty", () => {
		expect(formatCustomFieldsRef({ Priority: "High" })).toEqual({ Priority: "High" });
	});

	test("returns null (clears the key) for an empty record", () => {
		expect(formatCustomFieldsRef({})).toBeNull();
	});
});

describe("resolveCustomFields", () => {
	const definitions = new Map<string, CustomFieldDefinitionLike>([
		["f-text", { id: "f-text", name: "Notes", type: "text" }],
		["f-number", { id: "f-number", name: "Estimate", type: "number" }],
		["f-date", { id: "f-date", name: "Deadline", type: "date" }],
		["f-checkbox", { id: "f-checkbox", name: "Approved", type: "checkbox" }],
		[
			"f-list",
			{
				id: "f-list",
				name: "Priority",
				type: "list",
				options: new Map([
					["opt-high", "High"],
					["opt-low", "Low"],
				]),
			},
		],
	]);

	test("resolves every field type to a typed, usable value", () => {
		const result = resolveCustomFields(
			[
				{ idCustomField: "f-text", value: { text: "some notes" } },
				{ idCustomField: "f-number", value: { number: "8" } },
				{ idCustomField: "f-date", value: { date: "2026-09-20T00:00:00.000Z" } },
				{ idCustomField: "f-checkbox", value: { checked: "true" } },
				{ idCustomField: "f-list", idValue: "opt-high" },
			],
			definitions,
		);
		expect(result).toEqual({
			Notes: "some notes",
			Estimate: 8,
			Deadline: "2026-09-20T00:00:00.000Z",
			Approved: true,
			Priority: "High",
		});
	});

	test("never creates a key for a field with no value at all", () => {
		const result = resolveCustomFields([{ idCustomField: "f-text" }, { idCustomField: "f-number" }], definitions);
		expect(result).toEqual({});
	});

	test("omits a list field whose chosen option no longer exists, without throwing", () => {
		const result = resolveCustomFields([{ idCustomField: "f-list", idValue: "opt-removed" }], definitions);
		expect(result).toEqual({});
	});

	test("omits (and reports) an item whose field definition is gone from the board", () => {
		const unresolved: string[] = [];
		const result = resolveCustomFields(
			[{ idCustomField: "f-deleted", value: { text: "orphaned" } }],
			definitions,
			(id) => unresolved.push(id),
		);
		expect(result).toEqual({});
		expect(unresolved).toEqual(["f-deleted"]);
	});

	test("a falsy but present checkbox value (\"false\") is still written, not treated as empty", () => {
		const result = resolveCustomFields([{ idCustomField: "f-checkbox", value: { checked: "false" } }], definitions);
		expect(result).toEqual({ Approved: false });
	});

	test("a non-numeric number value is omitted rather than writing NaN", () => {
		const result = resolveCustomFields([{ idCustomField: "f-number", value: { number: "not-a-number" } }], definitions);
		expect(result).toEqual({});
	});
});
