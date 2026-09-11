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
const timers: { setTimeout: typeof globalThis.setTimeout } =
	typeof window === "undefined" ? globalThis : window;

export async function yieldPeriodically(index: number, everyN = 200): Promise<void> {
	if (index > 0 && index % everyN === 0) {
		await new Promise<void>((resolve) => timers.setTimeout(resolve, 0));
	}
}
