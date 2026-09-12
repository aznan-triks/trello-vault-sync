/**
 * A note carries a card's custom fields through a single frontmatter object,
 * keyed by the field's own label, each value already typed (string, number,
 * or boolean) — never Trello's internal field/option ids. Resolving an item
 * against its field definition happens where the frontmatter meets the
 * Trello API (see `features/syncNote.ts::convergeCustomFields`), never here.
 */

/** Default frontmatter key for a card's custom fields — configurable via `customFieldsFrontmatterKey`. */
export const DEFAULT_CUSTOM_FIELDS_KEY = "trello_custom_fields";

/** On by default — costs one extra Trello request per *run*, not per note: the board's field-definition directory, fetched once and reused. */
export const DEFAULT_SYNC_CUSTOM_FIELDS = true;

export type CustomFieldType = "text" | "number" | "date" | "checkbox" | "list";

/** The subset of a Trello custom-field definition this module needs. */
export interface CustomFieldDefinitionLike {
	id: string;
	name: string;
	type: CustomFieldType;
	/** For type "list" only: option id → its display text. */
	options?: ReadonlyMap<string, string>;
}

/** The subset of a Trello custom-field item (one card's value for one field) this module needs. */
export interface CustomFieldItemLike {
	idCustomField: string;
	/** For type "list": the chosen option's id. */
	idValue?: string;
	value?: { text?: string; number?: string; checked?: string; date?: string };
}

export type CustomFieldValue = string | number | boolean;

/** Parse a frontmatter value into a plain record — anything else (missing, an array, a scalar) becomes an empty object rather than throwing. */
export function parseCustomFieldsRef(raw: unknown): Record<string, unknown> {
	return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/** Render a resolved field-value record back into its frontmatter form — `null` clears the key. */
export function formatCustomFieldsRef(
	fields: Record<string, CustomFieldValue>,
): Record<string, CustomFieldValue> | null {
	return Object.keys(fields).length === 0 ? null : fields;
}

/** One item's value, typed per its definition — `null` when there is nothing usable to write (empty value, or a "list" item whose option no longer exists). */
function extractValue(item: CustomFieldItemLike, def: CustomFieldDefinitionLike): CustomFieldValue | null {
	switch (def.type) {
		case "text":
			return item.value?.text ?? null;
		case "number": {
			const raw = item.value?.number;
			if (raw === undefined) return null;
			const parsed = Number(raw);
			return Number.isFinite(parsed) ? parsed : null;
		}
		case "checkbox": {
			const raw = item.value?.checked;
			return raw === undefined ? null : raw === "true";
		}
		case "date":
			return item.value?.date ?? null;
		case "list":
			return item.idValue ? (def.options?.get(item.idValue) ?? null) : null;
		default:
			return null;
	}
}

/**
 * Resolves a card's custom-field items into a name→typed-value record, using
 * the board's field-definition directory. An item whose definition is gone,
 * whose "list" option was removed from the board, or that carries no value
 * at all contributes no key — never an exception, never an empty key.
 */
export function resolveCustomFields(
	items: readonly CustomFieldItemLike[],
	definitions: ReadonlyMap<string, CustomFieldDefinitionLike>,
	onUnresolved?: (fieldId: string) => void,
): Record<string, CustomFieldValue> {
	const result: Record<string, CustomFieldValue> = {};
	for (const item of items) {
		const def = definitions.get(item.idCustomField);
		if (!def) {
			onUnresolved?.(item.idCustomField);
			continue;
		}
		const value = extractValue(item, def);
		if (value === null) continue;
		result[def.name] = value;
	}
	return result;
}
