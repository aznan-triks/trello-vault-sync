/** Which note property (and value) a Trello label stands for. */
export interface LabelPropertyMapping {
	labelId: string;
	/** Last name/color seen on Trello - display only; the id is the identity (a renamed label keeps its mapping). */
	labelName: string;
	labelColor: string | null;
	/** Frontmatter key; "" = row inactive. */
	key: string;
	/** One or more values written under `key`; [] = row inactive. */
	values: string[];
}

export type LabelPropertyDirection = "both" | "to-note" | "to-trello";
export const LABEL_PROPERTY_DIRECTIONS: readonly LabelPropertyDirection[] = ["both", "to-note", "to-trello"];

const norm = (value: unknown): string => String(value).trim().toLowerCase();
const asList = (value: unknown): unknown[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);
const activeValues = (mapping: LabelPropertyMapping): string[] => mapping.values.map((v) => v.trim()).filter((v) => v !== "");
const isActive = (mapping: LabelPropertyMapping): boolean => mapping.key.trim() !== "" && activeValues(mapping).length > 0;

/** Board labels as the settings scan sees them. */
export interface BoardLabelLike {
	id: string;
	name: string;
	color: string | null;
}

/**
 * Result of "Scan board labels": existing rows get the label's current name/color, labels without a row get an
 * empty (inactive) one, and rows whose label no longer exists are kept and reported in `gone` for the user to delete.
 */
export function mergeScannedLabels(
	existing: readonly LabelPropertyMapping[],
	boardLabels: readonly BoardLabelLike[],
): { mappings: LabelPropertyMapping[]; gone: Set<string> } {
	const byId = new Map(boardLabels.map((label) => [label.id, label]));
	const mappings = existing.map((row) => {
		const label = byId.get(row.labelId);
		return label ? { ...row, labelName: label.name, labelColor: label.color } : row;
	});
	const known = new Set(existing.map((row) => row.labelId));
	for (const label of boardLabels) {
		if (!known.has(label.id)) mappings.push({ labelId: label.id, labelName: label.name, labelColor: label.color, key: "", values: [] });
	}
	return { mappings, gone: new Set(existing.filter((row) => !byId.has(row.labelId)).map((row) => row.labelId)) };
}

/** Rows that do something: a key and at least one value. */
export function activeMappings(mappings: readonly LabelPropertyMapping[]): LabelPropertyMapping[] {
	return mappings.filter(isActive);
}

/**
 * Writes the mapped values of the card's labels into `frontmatter` (in place). Values of a label the card no
 * longer has are removed when `removeValues` is set; values no mapping produces are never touched.
 * Returns true when something changed.
 */
export function applyLabelsToProperties(
	frontmatter: Record<string, unknown>,
	cardLabelIds: ReadonlySet<string>,
	mappings: readonly LabelPropertyMapping[],
	removeValues: boolean,
): boolean {
	let changed = false;
	for (const key of new Set(activeMappings(mappings).map((m) => m.key.trim()))) {
		const forKey = activeMappings(mappings).filter((m) => m.key.trim() === key);
		const original = frontmatter[key];
		let list = asList(original);
		// A value another present label also supplies must survive the removal of this label.
		const kept = new Set(forKey.filter((m) => cardLabelIds.has(m.labelId)).flatMap((m) => activeValues(m).map(norm)));
		if (removeValues) {
			const gone = new Set(forKey.filter((m) => !cardLabelIds.has(m.labelId)).flatMap((m) => activeValues(m).map(norm)));
			list = list.filter((value) => !gone.has(norm(value)) || kept.has(norm(value)));
		}
		for (const mapping of forKey.filter((m) => cardLabelIds.has(m.labelId))) {
			for (const value of activeValues(mapping)) {
				if (!list.some((existing) => norm(existing) === norm(value))) list.push(value);
			}
		}
		const before = asList(original);
		if (list.length === before.length && list.every((value, i) => value === before[i])) continue;
		changed = true;
		if (list.length === 0) delete frontmatter[key];
		else frontmatter[key] = list.length === 1 && !Array.isArray(original) ? list[0] : list;
	}
	return changed;
}

/** Label ids the note asks for: every active mapping whose values are all present under its key. */
export function labelsFromProperties(
	frontmatter: Record<string, unknown>,
	mappings: readonly LabelPropertyMapping[],
): Set<string> {
	const wanted = new Set<string>();
	for (const mapping of activeMappings(mappings)) {
		const present = new Set(asList(frontmatter[mapping.key.trim()]).map(norm));
		if (activeValues(mapping).every((value) => present.has(norm(value)))) wanted.add(mapping.labelId);
	}
	return wanted;
}

/** Label ids that have an active mapping - the only ones a label-property sync may add to or remove from a card. */
export function mappedLabelIds(mappings: readonly LabelPropertyMapping[]): Set<string> {
	return new Set(activeMappings(mappings).map((m) => m.labelId));
}

/** Keys used by active mappings. */
export function mappedPropertyKeys(mappings: readonly LabelPropertyMapping[]): string[] {
	return [...new Set(activeMappings(mappings).map((m) => m.key.trim()))];
}
