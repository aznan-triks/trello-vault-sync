import type { Reporter } from "../obsidian/gateway";

/**
 * Takes the stats object itself rather than pre-built pairs: the constraint
 * `T extends Record<keyof T, number>` accepts the sync engines' plain interfaces
 * (which do not satisfy `Record<string, number>`) while still proving every field
 * is a number — `Object.entries` only widens the value back to `unknown` on a
 * generic, hence the single conversion below. Shared by `syncCommands.ts` and
 * `forceSyncCommands.ts` — every command that runs `syncFolder`/`syncVault` and
 * wants its stats reflected in the panel's counters needs this exact shape.
 */
export function reportStats<T extends Record<keyof T, number>>(reporter: Reporter, stats: T): void {
	for (const [key, value] of Object.entries(stats)) reporter.count(key, value as number);
}
