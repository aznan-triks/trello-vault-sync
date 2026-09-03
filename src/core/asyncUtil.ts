/**
 * Every Nth call yields one tick to the event loop. A tight synchronous loop
 * over thousands of notes otherwise never lets the UI thread repaint until it
 * is done — this is a scheduling detail, not a user-facing threshold, so it
 * is a plain constant rather than a settings entry.
 */
export async function yieldPeriodically(index: number, everyN = 200): Promise<void> {
	if (index > 0 && index % everyN === 0) {
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
}
