/** The subset of a note-sync result the tally needs — matches `NoteSyncResult`. */
export interface TallyableResult {
	renamed: boolean;
	direction: "skip" | "pull" | "push" | "conflict" | "unlinked";
}

export interface NoteTallyStats {
	pulled: number;
	pushed: number;
	skipped: number;
	renamed: number;
	conflicts: number;
}

/**
 * Bump the shared pull/push/skip/conflict/renamed counters for one note-sync
 * result, and emit the matching log line. `syncVault` and `syncFolder` both
 * need this after running `syncNoteWithCard` on a pair that isn't a fresh
 * adoption — this is the one place that shape is expressed.
 */
export function tallyNoteResult(
	stats: NoteTallyStats,
	result: TallyableResult,
	log: (level: "pull" | "push" | "warn", message: string) => void,
	label: string,
): void {
	if (result.renamed) stats.renamed++;
	if (result.direction === "pull") {
		stats.pulled++;
		log("pull", label);
	} else if (result.direction === "push") {
		stats.pushed++;
		log("push", label);
	} else if (result.direction === "conflict") {
		stats.conflicts++;
		log("warn", `Conflict: ${label}`);
	} else if (result.direction === "skip") {
		stats.skipped++;
	}
}

/**
 * Add every field of `source` into the matching field of `target`, in place.
 * `T extends object` rather than `Record<string, number>`: the stats
 * interfaces this accumulates (`FolderSyncStats`, `VaultSyncStats`) declare no
 * index signature, which TS will not match structurally against the latter.
 */
/**
 * Turn one note-sync result into the user-facing summary line for `syncActive`.
 * Exhaustive on `direction` (compiler-enforced) so a new direction added to
 * `NoteSyncResult` fails the build here instead of silently reporting
 * "Already up to date." — the bug this replaced.
 */
export function describeSyncOutcome(result: TallyableResult): string {
	switch (result.direction) {
		case "pull":
			return `Pulled from Trello${result.renamed ? " and renamed" : ""}.`;
		case "push":
			return "Pushed to Trello.";
		case "conflict":
			return "Conflict: note and card changed at the same time, nothing was written.";
		case "unlinked":
			return "Note not linked — use \"Link active note to a card\".";
		case "skip":
			return "Already up to date.";
		default: {
			const _exhaustive: never = result.direction;
			throw new Error(`Unhandled sync direction: ${String(_exhaustive)}`);
		}
	}
}

export function addCounts<T extends object>(target: T, source: T): T {
	const t = target as unknown as Record<string, number>;
	const s = source as unknown as Record<string, number>;
	for (const key of Object.keys(t)) {
		t[key] = (t[key] ?? 0) + (s[key] ?? 0);
	}
	return target;
}
