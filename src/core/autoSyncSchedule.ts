/** "interval" polls on a timer, "focus" fires when the Obsidian window regains focus, "both" does either. */
export type AutoSyncTrigger = "interval" | "focus" | "both";

/** What an auto-sync scope means to `main.ts` — this module never touches a scope's actual sync logic. */
export type AutoSyncScope = "mappings" | "vault";

export interface AutoSyncScheduleInput {
	enabled: boolean;
	trigger: AutoSyncTrigger;
	/** The event that just happened, to check against `trigger`. */
	event: "interval" | "focus";
	/** Epoch ms, "now". */
	now: number;
	/** Epoch ms of the last auto-sync attempt (successful or not), `null` before the first one this session. */
	lastRunAt: number | null;
	/** A sync (auto or manual) is already running — the plugin's own single-sync-at-a-time lock. */
	syncing: boolean;
	intervalMinutes: number;
	/** Anti-burst floor: the minimum gap between two auto-sync attempts, regardless of what triggered either. */
	minIdleSeconds: number;
}

export type AutoSyncSkipReason = "disabled" | "wrong-trigger" | "syncing" | "too-soon";

export type AutoSyncDecision = { action: "run" } | { action: "skip"; reason: AutoSyncSkipReason };

/**
 * Decides whether an auto-sync should run right now — pure, so every rule
 * (disabled, wrong trigger, already syncing, too soon) is a plain unit test,
 * no timer or Obsidian window required. `main.ts` calls this on a fixed
 * internal poll and on window-focus; the poll cadence itself is a scheduling
 * detail, not something this function knows about.
 */
export function decideAutoSync(input: AutoSyncScheduleInput): AutoSyncDecision {
	if (!input.enabled) return { action: "skip", reason: "disabled" };
	if (input.trigger !== "both" && input.trigger !== input.event) {
		return { action: "skip", reason: "wrong-trigger" };
	}
	if (input.syncing) return { action: "skip", reason: "syncing" };

	if (input.lastRunAt !== null) {
		const idleMs = input.now - input.lastRunAt;
		if (idleMs < input.minIdleSeconds * 1000) return { action: "skip", reason: "too-soon" };
		// A periodic tick additionally waits out the configured interval — a
		// "focus" event only ever answers to the anti-burst floor above, since
		// it isn't periodic to begin with.
		if (input.event === "interval" && idleMs < input.intervalMinutes * 60_000) {
			return { action: "skip", reason: "too-soon" };
		}
	}

	return { action: "run" };
}
