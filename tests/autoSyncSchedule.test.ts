import { describe, expect, test } from "vitest";
import { decideAutoSync, type AutoSyncScheduleInput } from "../src/core/autoSyncSchedule";

const base: AutoSyncScheduleInput = {
	enabled: true,
	trigger: "interval",
	event: "interval",
	now: 1_000_000,
	lastRunAt: null,
	syncing: false,
	intervalMinutes: 15,
	minIdleSeconds: 60,
};

describe("decideAutoSync", () => {
	test("happy path: enabled, no run yet, an interval tick fires", () => {
		expect(decideAutoSync(base)).toEqual({ action: "run" });
	});

	test("happy path: last run further back than the interval → run", () => {
		const input = { ...base, lastRunAt: base.now - 16 * 60_000 };
		expect(decideAutoSync(input)).toEqual({ action: "run" });
	});

	test("never triggers while disabled, no matter how long it's been", () => {
		const input = { ...base, enabled: false, lastRunAt: base.now - 999 * 60_000 };
		expect(decideAutoSync(input)).toEqual({ action: "skip", reason: "disabled" });
	});

	test("skips when a sync is already running, even if otherwise due", () => {
		const input = { ...base, lastRunAt: base.now - 16 * 60_000, syncing: true };
		expect(decideAutoSync(input)).toEqual({ action: "skip", reason: "syncing" });
	});

	test("anti-burst: a focus event 5s after a periodic run is skipped under trigger 'both' with a 60s floor", () => {
		const periodicRun = decideAutoSync({ ...base, trigger: "both", event: "interval" });
		expect(periodicRun).toEqual({ action: "run" });

		const focusFollowup: AutoSyncScheduleInput = {
			...base,
			trigger: "both",
			event: "focus",
			now: base.now + 5_000,
			lastRunAt: base.now,
		};
		expect(decideAutoSync(focusFollowup)).toEqual({ action: "skip", reason: "too-soon" });
	});

	test("a focus event well past the anti-burst floor still runs even before the full interval elapses", () => {
		const input: AutoSyncScheduleInput = {
			...base,
			trigger: "both",
			event: "focus",
			lastRunAt: base.now - 61_000,
		};
		expect(decideAutoSync(input)).toEqual({ action: "run" });
	});

	test("wrong trigger: an interval-only setting ignores a focus event", () => {
		const input: AutoSyncScheduleInput = { ...base, trigger: "interval", event: "focus" };
		expect(decideAutoSync(input)).toEqual({ action: "skip", reason: "wrong-trigger" });
	});

	test("wrong trigger: a focus-only setting ignores an interval tick", () => {
		const input: AutoSyncScheduleInput = { ...base, trigger: "focus", event: "interval" };
		expect(decideAutoSync(input)).toEqual({ action: "skip", reason: "wrong-trigger" });
	});

	test("an interval tick before the configured interval has elapsed is too soon", () => {
		const input = { ...base, lastRunAt: base.now - 5 * 60_000 };
		expect(decideAutoSync(input)).toEqual({ action: "skip", reason: "too-soon" });
	});

	test("lifecycle: disabling mid-session stops every future decision immediately, not just after a reload", () => {
		const dueForRun = { ...base, lastRunAt: base.now - 16 * 60_000 };
		expect(decideAutoSync(dueForRun)).toEqual({ action: "run" });
		expect(decideAutoSync({ ...dueForRun, enabled: false })).toEqual({ action: "skip", reason: "disabled" });
	});
});
