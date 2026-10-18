import { describe, expect, test } from "vitest";
import { type SyncAction, type SyncRun } from "../src/core/syncHistory";
import { undoRun, undoRunForNote } from "../src/features/rollback";
import { wrapWithHistoryRecorder } from "../src/features/syncHistoryRecorder";
import type { VaultGateway } from "../src/obsidian/gateway";
import { FakeVault } from "./fakes";

function recorder(vault: FakeVault): {
	wrapped: VaultGateway;
	actions: SyncAction[];
} {
	const actions: SyncAction[] = [];
	const wrapped = wrapWithHistoryRecorder(vault, (action) => actions.push(action));
	return { wrapped, actions };
}

describe("Milestone 1 Empirical Stress Tests", () => {
	describe("1. Multiple consecutive writes with keepMtime: true", () => {
		test("15 consecutive write() calls preserve original mtime", async () => {
			const initialMtime = 99999;
			const vault = new FakeVault({ "note.md": { content: "initial", mtime: initialMtime } });

			for (let i = 1; i <= 15; i++) {
				await vault.write(vault.note("note.md"), `body content version ${i}`, { keepMtime: true });
				expect(vault.note("note.md").mtime).toBe(initialMtime);
				expect(vault.contentOf("note.md")).toBe(`body content version ${i}`);
			}
		});

		test("15 consecutive writeFrontmatter() calls preserve original mtime", async () => {
			const initialMtime = 88888;
			const vault = new FakeVault({
				"note.md": {
					content: "---\ncounter: 0\n---\n\nbody",
					mtime: initialMtime,
				},
			});

			for (let i = 1; i <= 15; i++) {
				await vault.writeFrontmatter(
					vault.note("note.md"),
					(fm) => {
						fm.counter = i;
						fm[`key_${i}`] = `value_${i}`;
					},
					{ keepMtime: true },
				);
				expect(vault.note("note.md").mtime).toBe(initialMtime);
				const parsed = vault.readFrontmatter(vault.note("note.md"));
				expect(parsed?.counter).toBe(i);
				expect(parsed?.[`key_${i}`]).toBe(`value_${i}`);
			}
		});

		test("alternating write() and writeFrontmatter() with keepMtime: true preserves original mtime", async () => {
			const initialMtime = 77777;
			const vault = new FakeVault({
				"note.md": {
					content: "---\ntitle: test\n---\n\nbody initial",
					mtime: initialMtime,
				},
			});

			for (let round = 1; round <= 10; round++) {
				await vault.writeFrontmatter(
					vault.note("note.md"),
					(fm) => {
						fm.round = round;
					},
					{ keepMtime: true },
				);
				expect(vault.note("note.md").mtime).toBe(initialMtime);

				await vault.write(
					vault.note("note.md"),
					`---\ntitle: test\nround: ${round}\n---\n\nbody round ${round}`,
					{ keepMtime: true },
				);
				expect(vault.note("note.md").mtime).toBe(initialMtime);
			}
		});
	});

	describe("2. Mixed sequences of keepMtime and standard writes", () => {
		test("accurately bumps or preserves mtime according to options across complex sequence", async () => {
			let currentMtime = 1000;
			const vault = new FakeVault({ "note.md": { content: "start", mtime: currentMtime } });

			// 1. keepMtime: true -> preserves
			await vault.write(vault.note("note.md"), "k1", { keepMtime: true });
			expect(vault.note("note.md").mtime).toBe(currentMtime);

			await vault.write(vault.note("note.md"), "k2", { keepMtime: true });
			expect(vault.note("note.md").mtime).toBe(currentMtime);

			// 2. standard write (no options) -> bumps (+1)
			await vault.write(vault.note("note.md"), "s1");
			currentMtime += 1;
			expect(vault.note("note.md").mtime).toBe(currentMtime);

			// 3. writeFrontmatter keepMtime: true -> preserves
			await vault.writeFrontmatter(
				vault.note("note.md"),
				(fm) => {
					fm.a = "alpha";
				},
				{ keepMtime: true },
			);
			expect(vault.note("note.md").mtime).toBe(currentMtime);

			// 4. writeFrontmatter standard -> bumps (+1)
			await vault.writeFrontmatter(vault.note("note.md"), (fm) => {
				fm.b = "beta";
			});
			currentMtime += 1;
			expect(vault.note("note.md").mtime).toBe(currentMtime);

			// 5. write with keepMtime: false -> bumps (+1)
			await vault.write(vault.note("note.md"), "s2", { keepMtime: false });
			currentMtime += 1;
			expect(vault.note("note.md").mtime).toBe(currentMtime);

			// 6. writeFrontmatter with keepMtime: false -> bumps (+1)
			await vault.writeFrontmatter(
				vault.note("note.md"),
				(fm) => {
					fm.c = "gamma";
				},
				{ keepMtime: false },
			);
			currentMtime += 1;
			expect(vault.note("note.md").mtime).toBe(currentMtime);

			// 7. consecutive keepMtime: true after bumps -> preserves new mtime
			await vault.write(vault.note("note.md"), "k3", { keepMtime: true });
			expect(vault.note("note.md").mtime).toBe(currentMtime);

			await vault.writeFrontmatter(
				vault.note("note.md"),
				(fm) => {
					fm.d = "delta";
				},
				{ keepMtime: true },
			);
			expect(vault.note("note.md").mtime).toBe(currentMtime);

			// 8. standard write -> bumps (+1)
			await vault.write(vault.note("note.md"), "final");
			currentMtime += 1;
			expect(vault.note("note.md").mtime).toBe(currentMtime);
		});
	});

	describe("3. writeFrontmatter mutating complex YAML structures with keepMtime: true", () => {
		test("mutating nested objects, arrays, and scalars preserves mtime and data integrity", async () => {
			const initialContent = [
				"---",
				'due: "2026-10-18"',
				"labels:",
				'  - "trello"',
				'  - "sync"',
				"custom_fields:",
				"  estimate: 8",
				'  priority: "urgent"',
				"  review: true",
				"members:",
				'  - "alice"',
				'  - "bob"',
				"---",
				"",
				"# Main Section",
				"Some important note body.",
			].join("\n");

			const initialMtime = 55555;
			const vault = new FakeVault({ "card.md": { content: initialContent, mtime: initialMtime } });

			await vault.writeFrontmatter(
				vault.note("card.md"),
				(fm) => {
					// 1. Delete scalar
					delete fm.due;
					// 2. Mutate array
					const labels = (fm.labels as string[]) ?? [];
					labels.push("cleaned");
					fm.labels = labels;
					// 3. Mutate nested object
					const custom = (fm.custom_fields as Record<string, unknown>) ?? {};
					custom.estimate = 13;
					delete custom.review;
					custom.lead = "alice";
					fm.custom_fields = custom;
					// 4. Add new scalar
					fm.status = "processed";
				},
				{ keepMtime: true },
			);

			// Verify mtime preserved
			expect(vault.note("card.md").mtime).toBe(initialMtime);

			// Verify content integrity
			const fm = vault.readFrontmatter(vault.note("card.md"));
			expect(fm?.due).toBeUndefined();
			expect(fm?.labels).toEqual(["trello", "sync", "cleaned"]);
			expect(fm?.custom_fields).toEqual({
				estimate: 13,
				priority: "urgent",
				lead: "alice",
			});
			expect(fm?.members).toEqual(["alice", "bob"]);
			expect(fm?.status).toBe("processed");

			// Verify body preserved
			expect(vault.contentOf("card.md")).toContain("# Main Section\nSome important note body.");
		});

		test("adding frontmatter to a note with no initial frontmatter preserves mtime", async () => {
			const initialContent = "# Note with no frontmatter\nJust paragraphs.";
			const initialMtime = 44444;
			const vault = new FakeVault({ "plain.md": { content: initialContent, mtime: initialMtime } });

			await vault.writeFrontmatter(
				vault.note("plain.md"),
				(fm) => {
					fm.trello_plugin_note_id = "p-123";
					fm.tags = ["tag1", "tag2"];
				},
				{ keepMtime: true },
			);

			expect(vault.note("plain.md").mtime).toBe(initialMtime);
			const fm = vault.readFrontmatter(vault.note("plain.md"));
			expect(fm).toEqual({
				trello_plugin_note_id: "p-123",
				tags: ["tag1", "tag2"],
			});
			expect(vault.contentOf("plain.md")).toContain("# Note with no frontmatter\nJust paragraphs.");
		});
	});

	describe("4. History undo (undoRun) on runs containing multiple keepMtime mutations", () => {
		test("multiple keepMtime mutations on a single note are undone in reverse order", async () => {
			const initialContent = [
				"---",
				'due: "2026-10-18"',
				'status: "active"',
				"---",
				"",
				"## Checklists",
				"- [ ] Item 1",
				"",
				"Body text.",
			].join("\n");

			const initialMtime = 33333;
			const vault = new FakeVault({ "task.md": { content: initialContent, mtime: initialMtime } });
			const { wrapped, actions } = recorder(vault);

			// Step 1: Remove due date with keepMtime
			await wrapped.writeFrontmatter(
				vault.note("task.md"),
				(fm) => {
					delete fm.due;
				},
				{ keepMtime: true },
			);

			// Step 2: Strip checklist body section with keepMtime
			const contentAfterStep1 = vault.contentOf("task.md");
			const contentWithoutChecklists = contentAfterStep1.replace(/## Checklists\n- \[ \] Item 1\n\n/, "");
			await wrapped.write(vault.note("task.md"), contentWithoutChecklists, { keepMtime: true });

			// Step 3: Add cleanup flag to frontmatter with keepMtime
			await wrapped.writeFrontmatter(
				vault.note("task.md"),
				(fm) => {
					fm.cleaned = true;
				},
				{ keepMtime: true },
			);

			// Verify all 3 mutations preserved initialMtime
			expect(vault.note("task.md").mtime).toBe(initialMtime);
			expect(actions).toHaveLength(3);
			expect(actions[0]?.kind).toBe("frontmatter");
			expect(actions[1]?.kind).toBe("body");
			expect(actions[2]?.kind).toBe("frontmatter");

			// Undo run
			const run: SyncRun = {
				timestamp: "2026-10-18T00:00:00.000Z",
				scope: "task.md",
				actions,
			};

			const { stats } = await undoRun(vault, run);
			expect(stats).toEqual({ reverted: 3, revertedRemote: 0, skipped: 0 });

			// Content should be restored to initialContent exactly
			expect(vault.contentOf("task.md")).toBe(initialContent);
			expect(vault.readFrontmatter(vault.note("task.md"))).toEqual({
				due: "2026-10-18",
				status: "active",
			});
		});

		test("multiple keepMtime mutations across multiple notes are all reverted", async () => {
			const vault = new FakeVault({
				"n1.md": { content: "---\ndue: 1\n---\nbody 1", mtime: 100 },
				"n2.md": { content: "---\nlabels:\n  - a\n---\nbody 2", mtime: 200 },
				"n3.md": { content: "body 3 only", mtime: 300 },
			});
			const { wrapped, actions } = recorder(vault);

			await wrapped.writeFrontmatter(vault.note("n1.md"), (fm) => delete fm.due, { keepMtime: true });
			await wrapped.write(vault.note("n1.md"), "---\n---\nmodified body 1", { keepMtime: true });

			await wrapped.writeFrontmatter(vault.note("n2.md"), (fm) => delete fm.labels, { keepMtime: true });
			await wrapped.writeFrontmatter(vault.note("n2.md"), (fm) => { fm.migrated = true; }, { keepMtime: true });

			await wrapped.write(vault.note("n3.md"), "modified body 3", { keepMtime: true });

			expect(vault.note("n1.md").mtime).toBe(100);
			expect(vault.note("n2.md").mtime).toBe(200);
			expect(vault.note("n3.md").mtime).toBe(300);
			expect(actions).toHaveLength(5);

			const run: SyncRun = {
				timestamp: "2026-10-18T00:00:00.000Z",
				scope: "vault",
				actions,
			};

			const { stats } = await undoRun(vault, run);
			expect(stats).toEqual({ reverted: 5, revertedRemote: 0, skipped: 0 });

			expect(vault.contentOf("n1.md")).toBe("---\ndue: 1\n---\nbody 1");
			expect(vault.contentOf("n2.md")).toBe("---\nlabels:\n  - a\n---\nbody 2");
			expect(vault.contentOf("n3.md")).toBe("body 3 only");
		});

		test("selective undo (undoRunForNote) reverts only targeted note actions", async () => {
			const vault = new FakeVault({
				"target.md": { content: "target orig", mtime: 10 },
				"other.md": { content: "other orig", mtime: 20 },
			});
			const { wrapped, actions } = recorder(vault);

			await wrapped.write(vault.note("target.md"), "target mod 1", { keepMtime: true });
			await wrapped.write(vault.note("target.md"), "target mod 2", { keepMtime: true });
			await wrapped.write(vault.note("other.md"), "other mod", { keepMtime: true });

			const run: SyncRun = {
				timestamp: "2026-10-18T00:00:00.000Z",
				scope: "vault",
				actions,
			};

			const { stats, remainingRun } = await undoRunForNote(vault, run, "target.md");
			expect(stats).toEqual({ reverted: 2, revertedRemote: 0, skipped: 0 });
			expect(vault.contentOf("target.md")).toBe("target orig");
			expect(vault.contentOf("other.md")).toBe("other mod");
			expect(remainingRun.actions).toHaveLength(1);
			expect(remainingRun.actions[0]?.path).toBe("other.md");
		});

		test("external edits after keepMtime mutations cause undo to safely skip", async () => {
			const initialContent = "initial safe text";
			const vault = new FakeVault({ "note.md": { content: initialContent, mtime: 50 } });
			const { wrapped, actions } = recorder(vault);

			await wrapped.write(vault.note("note.md"), "cleanup text", { keepMtime: true });

			// User makes an external edit
			await vault.write(vault.note("note.md"), "user concurrent edit");

			const run: SyncRun = {
				timestamp: "2026-10-18T00:00:00.000Z",
				scope: "note.md",
				actions,
			};

			const { stats } = await undoRun(vault, run);
			expect(stats).toEqual({ reverted: 0, revertedRemote: 0, skipped: 1 });
			// Ensure user's edit was preserved, not overwritten!
			expect(vault.contentOf("note.md")).toBe("user concurrent edit");
		});
	});
});
