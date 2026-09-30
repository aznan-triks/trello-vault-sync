/**
 * Caps how many operations run at once; the rest wait their turn in arrival order.
 * `getLimit` is read at every decision so a settings change applies immediately
 * (a limit below 1 counts as 1 — never a deadlock).
 */
export class ConcurrencyGate {
	private running = 0;
	private readonly queue: Array<() => void> = [];

	constructor(private readonly getLimit: () => number) {}

	get active(): number {
		return this.running;
	}

	get waiting(): number {
		return this.queue.length;
	}

	/** Resolves with a `release` function once a slot is free. `release` is safe to call twice. */
	async acquire(): Promise<() => void> {
		if (this.queue.length > 0 || this.running >= this.limit()) {
			await new Promise<void>((resolve) => this.queue.push(resolve));
		} else {
			this.running++;
		}
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.running--;
			this.drain();
		};
	}

	private limit(): number {
		return Math.max(1, this.getLimit());
	}

	/** Lets waiters in while slots are free (also after a limit increase). The slot is counted before the waiter resumes. */
	private drain(): void {
		while (this.queue.length > 0 && this.running < this.limit()) {
			this.running++;
			this.queue.shift()?.();
		}
	}
}
