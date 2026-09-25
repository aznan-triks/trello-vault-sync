/**
 * Whether `ProgressPanel.finish()` should schedule its auto-close timer.
 * Pure so the rule (audit finding: a run with errors used to auto-close just
 * like a clean one) is a plain unit test — `ProgressPanel` itself has no DOM
 * to unit-test against under vitest (`environment: "node"`).
 */
export function shouldAutoClosePanel(input: {
	outcome: "done" | "aborted" | "error";
	autoCloseMs: number;
	hasErrors: boolean;
	keepOpenOnError: boolean;
}): boolean {
	if (input.outcome !== "done") return false;
	if (input.autoCloseMs <= 0) return false;
	if (input.hasErrors && input.keepOpenOnError) return false;
	return true;
}
