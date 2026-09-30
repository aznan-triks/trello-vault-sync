/**
 * Keeps operations that run at the same time from stepping on each other.
 *
 * - `withKey`: one task at a time per key. Two operations that touch the same
 *   card (a note sync and a vault sync, say) take turns; everything else runs in parallel.
 * - `claim`: a card id can be claimed once per "busy period", so two operations
 *   that both found the same card without a note cannot both create one.
 *   The plugin calls `resetClaims` when no operation is running any more.
 *
 * Pure (no Obsidian, no timers): it only chains promises.
 */
export class OperationGuard {
	private readonly tails = new Map<string, Promise<unknown>>();
	private readonly claims = new Set<string>();

	/** Runs `task` once every earlier task with the same `key` has settled (success or failure). */
	withKey<T>(key: string, task: () => Promise<T>): Promise<T> {
		const previous = this.tails.get(key) ?? Promise.resolve();
		const run = previous.then(task, task);
		const tail = run.catch(() => undefined);
		this.tails.set(key, tail);
		void tail.then(() => {
			// Drop the entry only if nobody queued behind us — otherwise the map would grow without bound.
			if (this.tails.get(key) === tail) this.tails.delete(key);
		});
		return run;
	}

	/** True the first time `key` is claimed, false afterwards (until `release`/`resetClaims`). */
	claim(key: string): boolean {
		if (this.claims.has(key)) return false;
		this.claims.add(key);
		return true;
	}

	release(key: string): void {
		this.claims.delete(key);
	}

	resetClaims(): void {
		this.claims.clear();
	}
}
