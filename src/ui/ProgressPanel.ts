import type { Reporter } from "../obsidian/gateway";

type LogLevel = Parameters<Reporter["log"]>[0];

const ICONS: Record<LogLevel, string> = {
	info: "ℹ",
	pull: "↓",
	push: "↑",
	create: "+",
	adopt: "🔗",
	rename: "⇄",
	skip: "·",
	delete: "🗑",
	warn: "⚠",
	error: "✕",
};

const MAX_LOG_ROWS = 60;

/** Human labels for the counters the sync engines emit. */
const COUNT_LABELS: Record<string, string> = {
	created: "created",
	adopted: "adopted",
	pulled: "pulled",
	pushed: "pushed",
	skipped: "skipped",
	renamed: "renamed",
	conflicts: "conflicts",
	phantoms: "phantoms",
	moved: "moved",
	deleted: "deleted",
	duplicates: "duplicates",
	unlinked: "unlinked",
	errors: "errors",
	orphanCards: "orphan cards",
	unlinkedNotes: "unlinked notes",
	comparedNotes: "notes",
	misplaced: "misplaced",
};

export interface PanelOptions {
	title: string;
	/** Delay before a successful panel disappears; 0 keeps it until dismissed. */
	autoCloseMs: number;
}

/**
 * The single floating progress panel, shared by every command.
 *
 * The legacy scripts each carried their own ~120-line copy of this widget with
 * inline styles; here there is one implementation and one stylesheet.
 */
export class ProgressPanel implements Reporter {
	private readonly root: HTMLElement;
	private readonly statusEl: HTMLElement;
	private readonly barEl: HTMLElement;
	private readonly progressEl: HTMLElement;
	private readonly countsEl: HTMLElement;
	private readonly logEl: HTMLElement;
	private readonly currentEl: HTMLElement;
	private readonly closeEl: HTMLElement;
	private readonly counters = new Map<string, HTMLElement>();

	private total = 0;
	private done = 0;
	private timer: number | null = null;

	constructor(private readonly options: PanelOptions) {
		document.querySelectorAll(".tvs-panel").forEach((node) => node.remove());

		this.root = document.body.createDiv({ cls: "tvs-panel" });

		const header = this.root.createDiv({ cls: "tvs-panel__header" });
		header.createSpan({ cls: "tvs-panel__title", text: options.title });
		this.statusEl = header.createSpan({ cls: "tvs-panel__status", text: "Running…" });
		// Hidden while a sync is in flight: closing the panel cannot stop it, so the
		// button only appears once there is nothing left to hide.
		this.closeEl = header.createEl("button", {
			cls: "tvs-panel__close tvs-panel__close--hidden",
			text: "×",
		});
		this.closeEl.setAttr("aria-label", "Close");
		this.closeEl.addEventListener("click", () => this.destroy());

		const progress = this.root.createDiv({ cls: "tvs-panel__progress" });
		this.progressEl = progress.createSpan({ cls: "tvs-panel__progress-label", text: "0 / 0" });
		const track = progress.createDiv({ cls: "tvs-panel__track" });
		this.barEl = track.createDiv({ cls: "tvs-panel__bar" });

		this.countsEl = this.root.createDiv({ cls: "tvs-panel__counts" });
		this.logEl = this.root.createDiv({ cls: "tvs-panel__log" });
		this.currentEl = this.root.createDiv({ cls: "tvs-panel__current", text: "Starting…" });
	}

	setTotal(total: number): void {
		this.total = total;
		this.renderProgress();
	}

	step(label: string): void {
		this.done++;
		this.currentEl.setText(label);
		this.renderProgress();
	}

	count(key: string, value: number): void {
		let cell = this.counters.get(key);
		if (!cell) {
			const box = this.countsEl.createDiv({ cls: "tvs-panel__count" });
			cell = box.createDiv({ cls: "tvs-panel__count-value" });
			box.createDiv({ cls: "tvs-panel__count-label", text: COUNT_LABELS[key] ?? key });
			this.counters.set(key, cell);
		}
		cell.setText(String(value));
	}

	log(level: LogLevel, message: string): void {
		// Newest first, so the panel never needs scrolling to show what just happened.
		// Built detached (global `createDiv`, not `this.logEl.createDiv`) because it is
		// prepended below, not appended.
		const row = createDiv({ cls: `tvs-panel__row tvs-panel__row--${level}` });
		row.createSpan({ cls: "tvs-panel__icon", text: ICONS[level] });
		row.createSpan({ cls: "tvs-panel__message", text: message });
		this.logEl.prepend(row);
		while (this.logEl.children.length > MAX_LOG_ROWS) this.logEl.lastElementChild?.remove();
	}

	finish(outcome: "done" | "aborted" | "error", summary: string): void {
		this.statusEl.setText(
			outcome === "done" ? "Done" : outcome === "aborted" ? "Aborted" : "Error",
		);
		this.root.addClass(`tvs-panel--${outcome}`);
		this.barEl.style.transform = "scaleX(1)";
		this.currentEl.setText(summary);
		this.closeEl.removeClass("tvs-panel__close--hidden");
		if (outcome === "done" && this.options.autoCloseMs > 0) {
			this.timer = window.setTimeout(() => this.destroy(), this.options.autoCloseMs);
		}
	}

	destroy(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.root.remove();
	}

	private renderProgress(): void {
		const ratio = this.total > 0 ? Math.min(1, this.done / this.total) : 0;
		this.barEl.style.transform = `scaleX(${ratio})`;
		this.progressEl.setText(`${this.done} / ${this.total}`);
	}
}
