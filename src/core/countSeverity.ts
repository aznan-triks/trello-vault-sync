export type CountSeverity = "neutral" | "ok" | "warn" | "error";

/**
 * Keys whose non-zero value flags something needing attention (a broken
 * link, a misplaced note, a conflict) — colored orange above zero, green at
 * zero. Everything else (routine action counts: created, pushed, skipped…)
 * stays neutral. `errors` is its own case: red instead of orange, since it's
 * the most severe signal the panel shows.
 */
const PROBLEM_KEYS = new Set([
	"conflicts",
	"phantoms",
	"unlinked",
	"duplicates",
	"orphanCards",
	"unlinkedNotes",
	"misplaced",
]);

/** Severity a `ProgressPanel` counter should render at, for a given key and value. */
export function countSeverity(key: string, value: number): CountSeverity {
	if (key === "errors") return value > 0 ? "error" : "ok";
	if (PROBLEM_KEYS.has(key)) return value > 0 ? "warn" : "ok";
	return "neutral";
}
