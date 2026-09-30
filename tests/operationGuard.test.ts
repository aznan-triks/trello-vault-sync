import { describe, expect, test } from "vitest";
import { ConcurrencyGate } from "../src/core/concurrencyGate";
import { OperationGuard } from "../src/core/operationGuard";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("OperationGuard.withKey", () => {
	test("tasks with the same key run one after the other", async () => {
		const guard = new OperationGuard();
		const log: string[] = [];
		let releaseFirst: () => void = () => {};
		const first = guard.withKey("card-1", async () => {
			log.push("first:start");
			await new Promise<void>((resolve) => (releaseFirst = resolve));
			log.push("first:end");
		});
		const second = guard.withKey("card-1", async () => {
			log.push("second:start");
		});
		await tick();
		expect(log).toEqual(["first:start"]);
		releaseFirst();
		await Promise.all([first, second]);
		expect(log).toEqual(["first:start", "first:end", "second:start"]);
	});

	test("tasks with different keys overlap", async () => {
		const guard = new OperationGuard();
		const log: string[] = [];
		let releaseA: () => void = () => {};
		const a = guard.withKey("a", async () => {
			log.push("a:start");
			await new Promise<void>((resolve) => (releaseA = resolve));
		});
		const b = guard.withKey("b", async () => {
			log.push("b:start");
		});
		await tick();
		expect(log).toEqual(["a:start", "b:start"]);
		releaseA();
		await Promise.all([a, b]);
	});

	test("a failing task does not block the next one and still rejects for its own caller", async () => {
		const guard = new OperationGuard();
		const failing = guard.withKey("k", async () => {
			throw new Error("boom");
		});
		const next = guard.withKey("k", async () => "ok");
		await expect(failing).rejects.toThrow("boom");
		await expect(next).resolves.toBe("ok");
	});
});

describe("OperationGuard claims", () => {
	test("a key can be claimed once until released or reset", () => {
		const guard = new OperationGuard();
		expect(guard.claim("create:c1")).toBe(true);
		expect(guard.claim("create:c1")).toBe(false);
		guard.release("create:c1");
		expect(guard.claim("create:c1")).toBe(true);
		guard.resetClaims();
		expect(guard.claim("create:c1")).toBe(true);
	});
});

describe("ConcurrencyGate", () => {
	test("lets `limit` operations in and queues the rest in arrival order", async () => {
		const gate = new ConcurrencyGate(() => 2);
		const r1 = await gate.acquire();
		const r2 = await gate.acquire();
		const order: number[] = [];
		const third = gate.acquire().then((release) => (order.push(3), release));
		const fourth = gate.acquire().then((release) => (order.push(4), release));
		await tick();
		expect(gate.active).toBe(2);
		expect(gate.waiting).toBe(2);
		r1();
		await tick();
		expect(order).toEqual([3]);
		r2();
		await tick();
		expect(order).toEqual([3, 4]);
		(await third)();
		(await fourth)();
		expect(gate.active).toBe(0);
	});

	test("releasing twice frees only one slot", async () => {
		const gate = new ConcurrencyGate(() => 1);
		const release = await gate.acquire();
		release();
		release();
		expect(gate.active).toBe(0);
	});

	test("a limit below 1 still lets one operation run", async () => {
		const gate = new ConcurrencyGate(() => 0);
		const release = await gate.acquire();
		expect(gate.active).toBe(1);
		release();
	});

	test("raising the limit lets waiters in on the next release", async () => {
		let limit = 1;
		const gate = new ConcurrencyGate(() => limit);
		const r1 = await gate.acquire();
		let started = 0;
		const p2 = gate.acquire().then((r) => (started++, r));
		const p3 = gate.acquire().then((r) => (started++, r));
		limit = 3;
		r1();
		await tick();
		expect(started).toBe(2);
		(await p2)();
		(await p3)();
	});
});
