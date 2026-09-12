/** What just happened, checked against the matching `autoSyncOn*` setting in `main.ts::checkAutoSync`. */
export type AutoSyncEvent = "interval" | "focus" | "startup";

export interface AutoSyncScheduleInput {
	enabled: boolean;
	/** Whether `event` is one of the triggers the user turned on — resolved by the caller from its own `autoSyncOnInterval`/`autoSyncOnFocus`/`autoSyncOnStartup` settings, since a fixed 3-value enum doesn't scale to "any combination" (this module stays agnostic to how many trigger kinds exist). */
	triggerEnabled: boolean;
	event: AutoSyncEvent;
	/** Epoch ms, "now". */
	now: number;
	/** Epoch ms of the last auto-sync attempt (successful or not), `null` before the first one this session — always `null` for a "startup" event, so it never waits out an interval that hasn't started yet. */
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
 * internal poll, on window-focus, and once at startup; the poll cadence
 * itself is a scheduling detail, not something this function knows about.
 */
export function decideAutoSync(input: AutoSyncScheduleInput): AutoSyncDecision {
	if (!input.enabled) return { action: "skip", reason: "disabled" };
	if (!input.triggerEnabled) return { action: "skip", reason: "wrong-trigger" };
	if (input.syncing) return { action: "skip", reason: "syncing" };

	if (input.lastRunAt !== null) {
		const idleMs = input.now - input.lastRunAt;
		if (idleMs < input.minIdleSeconds * 1000) return { action: "skip", reason: "too-soon" };
		// A periodic tick additionally waits out the configured interval — a
		// "focus"/"startup" event only ever answers to the anti-burst floor
		// above, since neither is periodic to begin with.
		if (input.event === "interval" && idleMs < input.intervalMinutes * 60_000) {
			return { action: "skip", reason: "too-soon" };
		}
	}

	return { action: "run" };
}
