/**
 * Extracts a display message from a thrown value. `catch` clauses type the
 * caught value as `unknown` — most call sites in this codebase used to cast
 * it straight to `Error` and read `.message`, which is unsafe if something
 * else was thrown (the field would be `undefined`). This falls back to
 * `String(e)` in that case instead.
 */
export function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
