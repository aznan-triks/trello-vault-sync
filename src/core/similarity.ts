/**
 * Title matching used when adopting an existing note into a Trello card.
 * Normalised Levenshtein distance, plus the containment boost the original
 * linker script relied on ("Sagondo (draft)" should still match "Sagondo").
 */

const CONTAINMENT_SCORE = 0.9;

function levenshtein(a: string, b: string): number {
	const costs: number[] = new Array(b.length + 1);
	for (let j = 0; j <= b.length; j++) costs[j] = j;

	for (let i = 1; i <= a.length; i++) {
		let previous = costs[0] as number;
		costs[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const current = costs[j] as number;
			costs[j] =
				a[i - 1] === b[j - 1]
					? previous
					: 1 + Math.min(previous, current, costs[j - 1] as number);
			previous = current;
		}
	}
	return costs[b.length] as number;
}

/** Similarity between two titles, from 0 (unrelated) to 1 (identical). */
export function similarity(a: string, b: string): number {
	const left = a.trim().toLowerCase();
	const right = b.trim().toLowerCase();
	if (left === right) return 1;
	const longer = left.length >= right.length ? left : right;
	const shorter = left.length >= right.length ? right : left;
	if (longer.length === 0) return 1;
	if (shorter.length === 0) return 0;
	return (longer.length - levenshtein(longer, shorter)) / longer.length;
}

/** True when `word` appears in `text` as a whole word, not merely as a substring. */
function containsWholeWord(text: string, word: string): boolean {
	if (word === "") return false;
	const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|\\W)${escaped}(\\W|$)`).test(text);
}

export interface Match<T> {
	item: T;
	score: number;
}

/** Closest candidate at or above `threshold`, or `null`. */
export function bestMatch<T>(
	query: string,
	candidates: readonly T[],
	label: (item: T) => string,
	threshold: number,
): Match<T> | null {
	const needle = query.trim().toLowerCase();
	let best: Match<T> | null = null;

	for (const item of candidates) {
		const name = label(item).trim().toLowerCase();
		let score = similarity(needle, name);
		const contained = name !== "" && (containsWholeWord(needle, name) || containsWholeWord(name, needle));
		if (contained) score = Math.max(score, CONTAINMENT_SCORE);
		if (!best || score > best.score) best = { item, score };
	}

	return best && best.score >= threshold ? best : null;
}
