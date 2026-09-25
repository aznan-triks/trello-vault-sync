import { describe, expect, test } from "vitest";
import { shouldAutoClosePanel } from "../src/core/panelAutoClose";

describe("shouldAutoClosePanel", () => {
	test("closes on a clean 'done' run when autoCloseMs > 0", () => {
		expect(shouldAutoClosePanel({ outcome: "done", autoCloseMs: 8000, hasErrors: false, keepOpenOnError: true })).toBe(true);
	});

	test("never closes when autoCloseMs is 0, error or not", () => {
		expect(shouldAutoClosePanel({ outcome: "done", autoCloseMs: 0, hasErrors: false, keepOpenOnError: true })).toBe(false);
		expect(shouldAutoClosePanel({ outcome: "done", autoCloseMs: 0, hasErrors: true, keepOpenOnError: false })).toBe(false);
	});

	test("never closes an 'aborted' or 'error' outcome, regardless of the other flags", () => {
		expect(shouldAutoClosePanel({ outcome: "aborted", autoCloseMs: 8000, hasErrors: false, keepOpenOnError: false })).toBe(false);
		expect(shouldAutoClosePanel({ outcome: "error", autoCloseMs: 8000, hasErrors: false, keepOpenOnError: false })).toBe(false);
	});

	test("keeps a 'done' run with errors open when keepOpenOnError is on", () => {
		expect(shouldAutoClosePanel({ outcome: "done", autoCloseMs: 8000, hasErrors: true, keepOpenOnError: true })).toBe(false);
	});

	test("auto-closes a 'done' run with errors when keepOpenOnError is off", () => {
		expect(shouldAutoClosePanel({ outcome: "done", autoCloseMs: 8000, hasErrors: true, keepOpenOnError: false })).toBe(true);
	});

	test("a 'done' run with no errors still auto-closes regardless of keepOpenOnError", () => {
		expect(shouldAutoClosePanel({ outcome: "done", autoCloseMs: 8000, hasErrors: false, keepOpenOnError: true })).toBe(true);
	});
});
