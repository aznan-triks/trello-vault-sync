import { describe, expect, test } from "vitest";
import { decideAutoSync, type AutoSyncScheduleInput } from "../src/core/autoSyncSchedule";

const base: AutoSyncScheduleInput = {
	enabled: true,
	triggerEnabled: true,
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

	test("anti-burst: a focus event 5s after a periodic run is skipped when both triggers are on with a 60s floor", () => {
		const periodicRun = decideAutoSync({ ...base, event: "interval" });
		expect(periodicRun).toEqual({ action: "run" });

		const focusFollowup: AutoSyncScheduleInput = {
			...base,
			event: "focus",
			now: base.now + 5_000,
			lastRunAt: base.now,
		};
		expect(decideAutoSync(focusFollowup)).toEqual({ action: "skip", reason: "too-soon" });
	});

	test("a focus event well past the anti-burst floor still runs even before the full interval elapses", () => {
		const input: AutoSyncScheduleInput = {
			...base,
			event: "focus",
			lastRunAt: base.now - 61_000,
		};
		expect(decideAutoSync(input)).toEqual({ action: "run" });
	});

	test("wrong trigger: this event's own toggle is off", () => {
		const input: AutoSyncScheduleInput = { ...base, event: "focus", triggerEnabled: false };
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

	test("startup: always runs on the first check of the session (lastRunAt null), ignoring the interval", () => {
		const input: AutoSyncScheduleInput = { ...base, event: "startup", lastRunAt: null };
		expect(decideAutoSync(input)).toEqual({ action: "run" });
	});

	test("startup: still respects the anti-burst floor against an immediately preceding run", () => {
		const input: AutoSyncScheduleInput = { ...base, event: "startup", lastRunAt: base.now - 5_000 };
		expect(decideAutoSync(input)).toEqual({ action: "skip", reason: "too-soon" });
	});
});
