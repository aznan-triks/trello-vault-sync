import { describe, expect, test, vi } from "vitest";
import { yieldPeriodically } from "../src/core/asyncUtil";

describe("yieldPeriodically", () => {
	test("resolves immediately off the boundary, no timer needed", async () => {
		vi.useFakeTimers();
		let resolved = false;
		void yieldPeriodically(1, 200).then(() => {
			resolved = true;
		});
		await Promise.resolve();
		expect(resolved).toBe(true);
		vi.useRealTimers();
	});

	test("waits for a scheduled tick on the boundary", async () => {
		vi.useFakeTimers();
		let resolved = false;
		void yieldPeriodically(200, 200).then(() => {
			resolved = true;
		});
		await Promise.resolve();
		expect(resolved).toBe(false);
		await vi.runAllTimersAsync();
		expect(resolved).toBe(true);
		vi.useRealTimers();
	});

	test("never yields at index 0", async () => {
		vi.useFakeTimers();
		let resolved = false;
		void yieldPeriodically(0, 200).then(() => {
			resolved = true;
		});
		await Promise.resolve();
		expect(resolved).toBe(true);
		vi.useRealTimers();
	});
});
