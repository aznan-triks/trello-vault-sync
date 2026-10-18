/**
 * Every Nth call yields one tick to the event loop. A tight synchronous loop
 * over thousands of notes otherwise never lets the UI thread repaint until it
 * is done — this is a scheduling detail, not a user-facing threshold, so it
 * is a plain constant rather than a settings entry.
 */
/**
 * The timer host: the real `window` under Obsidian (so a pop-out window keeps its
 * own timers), `globalThis` under the unit tests, which run in Node where there is
 * no `window` at all — `core/` must stay importable outside Obsidian (see CONTEXT §9).
 */
const timers: { setTimeout: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => number } =
	typeof window !== "undefined"
		? window
		: (typeof global !== "undefined" ? global : ({} as Window));

export const DEFAULT_YIELD_EVERY = 200;
let yieldEvery = DEFAULT_YIELD_EVERY;
/** Sets how often `yieldPeriodically` yields (setting `yieldEveryNotes`); read on every call, so it applies at once. */
export function configureYieldEvery(everyN: number): void {
	yieldEvery = Math.max(1, Math.floor(everyN));
}

export async function yieldPeriodically(index: number, everyN = yieldEvery): Promise<void> {
	if (index > 0 && index % everyN === 0) {
		await new Promise<void>((resolve) => timers.setTimeout(resolve, 0));
	}
}
