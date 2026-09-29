/** What just happened, checked against the matching `autoSyncOn*` setting in `main.ts::checkAutoSync`. */
export type AutoSyncEvent = "interval" | "focus" | "startup" | "note-change";

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
	/** `navigator.onLine` — false skips without counting as a failure. Omitted = online. */
	online?: boolean;
	/** Auto-sync paused after too many consecutive failures, until the user re-enables it or a sync succeeds. */
	paused?: boolean;
	/** Obsidian's window is hidden/minimized (`document.hidden`). */
	hidden?: boolean;
	/** Setting `autoSyncOnlyWhenVisible`: skip timer ticks while `hidden`. */
	onlyWhenVisible?: boolean;
}

export type AutoSyncSkipReason = "disabled" | "wrong-trigger" | "syncing" | "too-soon" | "offline" | "paused" | "hidden";

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
	if (input.paused) return { action: "skip", reason: "paused" };
	if (input.syncing) return { action: "skip", reason: "syncing" };
	if (input.online === false) return { action: "skip", reason: "offline" };
	if (input.event === "interval" && input.onlyWhenVisible && input.hidden) return { action: "skip", reason: "hidden" };

	if (input.lastRunAt !== null) {
		const idleMs = input.now - input.lastRunAt;
		if (idleMs < input.minIdleSeconds * 1000) return { action: "skip", reason: "too-soon" };
		// A periodic tick additionally waits out the configured interval — a
		// "focus"/"startup"/"note-change" event only ever answers to the anti-burst
		// floor above, since none is periodic to begin with. `lastRunAt` is the last
		// successful sync of any kind (manual included), persisted across restarts.
		if (input.event === "interval" && idleMs < input.intervalMinutes * 60_000) {
			return { action: "skip", reason: "too-soon" };
		}
	}

	return { action: "run" };
}
