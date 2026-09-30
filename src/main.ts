import { Notice, Plugin, TFile } from "obsidian";
import type { CommandContext } from "./commands/context";
import * as noteCommands from "./commands/noteCommands";
import { COMMANDS, type CommandDescriptor } from "./commands/registry";
import * as syncCommands from "./commands/syncCommands";
import { decideAutoSync, type AutoSyncEvent } from "./core/autoSyncSchedule";
import { ConcurrencyGate } from "./core/concurrencyGate";
import { excludeFolders, notesInFolder } from "./core/fileName";
import { errorMessage } from "./core/errorMessage";
import { appendJournalEntry, prefixDryRunMessage, type JournalEntry, type LogLevel } from "./core/journal";
import { OperationGuard } from "./core/operationGuard";
import { normalizePersistedData } from "./core/pluginData";
import { appendSyncRun, type SyncAction, type SyncRun } from "./core/syncHistory";
import type { AuditOptions } from "./features/auditShared";
import type { FolderSyncOptions } from "./features/syncFolder";
import type { NoteSyncOptions } from "./features/syncNote";
import { ObsidianVault } from "./obsidian/ObsidianVault";
import { obsidianDownloadBinary, obsidianTransport } from "./obsidian/transport";
import { silentReporter, type NoteHandle, type Reporter } from "./obsidian/gateway";
import { TrelloVaultSyncSettingsTab } from "./settings/SettingsTab";
import { DEFAULT_SETTINGS, hasCredentials, normalizeSettings, type TrelloVaultSyncSettings } from "./settings/types";
import { redactSecrets, TrelloClient } from "./trello/client";
import { ProgressPanel } from "./ui/ProgressPanel";
import { SidebarView, VIEW_TYPE_TVS_SIDEBAR } from "./ui/SidebarView";

/** How an operation ended — `busy` means it was refused because the same one was already running. */
type RunOutcome = "done" | "error" | "aborted" | "busy";

export default class TrelloVaultSyncPlugin extends Plugin implements CommandContext {
	override settings: TrelloVaultSyncSettings = { ...DEFAULT_SETTINGS };
	vault!: ObsidianVault;
	journal: JournalEntry[] = [];
	history: SyncRun[] = [];
	/** Conflicts counted in the most recent sync run — in-memory only, see `CommandContext.lastRunConflicts`. */
	lastRunConflicts: number | null = null;
	/** Shared by every operation running at the same time — two that reach the same card take turns. Handed to the engines through `noteOptions()`. */
	readonly guard = new OperationGuard();
	/** Caps how many operations run together (setting `maxConcurrentOperations`); the next one waits for a slot. */
	private readonly gate = new ConcurrencyGate(() => this.settings.maxConcurrentOperations);
	/** Titles of the operations running or waiting for a slot — launching one that is already there is refused, not stacked. */
	private readonly pendingTitles = new Set<string>();
	/** Epoch ms of the last successful sync (manual or auto) — persisted in data.json, so the auto-sync timer survives a restart and a manual sync resets it. */
	private lastSyncAt: number | null = null;
	/** Auto-syncs that ended in error in a row — `autoSyncPauseAfterFailures` pauses auto-sync when reached. */
	private autoSyncFailures = 0;
	/** Paused after too many failures; cleared by re-enabling auto-sync or by any successful sync. In memory: a restart retries. */
	private autoSyncPaused = false;
	/** Epoch ms when the latest operation ended — edits right after a sync are the sync's own writes, not the user's. */
	private lastRunEndedAt = 0;
	/** Pending "note changed" syncs, one debounce timer per note path. */
	private noteChangeTimers = new Map<string, number>();
	/** Fixed scheduling detail, not a setting — how often `checkAutoSync("interval")` is polled; `decideAutoSync` (fed live settings each tick) is what actually decides whether that tick fires a sync. */
	private static readonly AUTO_SYNC_POLL_MS = 30_000;
	/** Fixed detail, not a setting: edits within this long after a sync ended are treated as the sync's own writes. */
	private static readonly OWN_WRITE_GRACE_MS = 1500;
	/** The panels of the operations currently on screen — torn down on unload. */
	private readonly panels = new Set<ProgressPanel>();
	/** Writes to `data.json` one after the other: operations finishing together must not interleave their writes. */
	private persistQueue: Promise<unknown> = Promise.resolve();
	/** Tracked ribbon icon elements (with their title, for proper native removal) — removed and rebuilt by `rebuildRibbon()` when settings change. */
	private configurableRibbonEls: { el: HTMLElement; title: string }[] = [];

	override async onload(): Promise<void> {
		this.registerView(VIEW_TYPE_TVS_SIDEBAR, (leaf) => new SidebarView(leaf, this));

		const { settingsRaw, journal, history, lastSyncAt } = normalizePersistedData(await this.loadData());
		this.lastSyncAt = lastSyncAt;
		this.settings = normalizeSettings(settingsRaw);
		this.journal = journal;
		this.history = history;
		this.vault = new ObsidianVault(this.app, () => this.settings.cardRefFrontmatterKey);
		this.addSettingTab(new TrelloVaultSyncSettingsTab(this.app, this));
		this.registerCommands();
		this.registerRibbon();
		this.registerAutoSync();
	}

	override onunload(): void {
		for (const panel of [...this.panels]) panel.destroy();
		for (const timer of this.noteChangeTimers.values()) window.clearTimeout(timer);
	}

	async saveSettings(): Promise<void> {
		await this.persist();
		this.refreshSidebarViews();
		this.rebuildRibbon();
	}

	/** Writes settings, journal and sync history together into the plugin's own `data.json` — none of it a vault note (internal state, not a user-facing deliverable like the audit reports). */
	private persist(): Promise<void> {
		// The snapshot is taken when the write actually starts, so the last write always carries the newest state.
		const write = this.persistQueue.then(() =>
			this.saveData({
				settings: this.settings,
				journal: this.journal,
				history: this.history,
				lastSyncAt: this.lastSyncAt,
			}),
		);
		this.persistQueue = write.catch(() => undefined);
		return write;
	}

	/**
	 * Appends a completed run's actions to `history` — a no-op when nothing was written
	 * (dry run, or history disabled). In memory only: every sync command records inside
	 * `run()`, whose `finish` already writes `data.json` once at the end of the command
	 * (see `withJournal`) — persisting here too rewrote the whole file twice per sync.
	 */
	async recordSyncRun(scope: string, actions: SyncAction[]): Promise<void> {
		if (actions.length === 0) return;
		const run: SyncRun = { timestamp: new Date().toISOString(), scope, actions };
		this.history = appendSyncRun(this.history, run, this.settings.historyMaxRuns);
	}

	async setHistory(next: readonly SyncRun[]): Promise<void> {
		this.history = [...next];
		await this.persist();
	}

	/** Truly empties the journal (not just the sidebar's display) and persists it — see `CommandContext.clearJournal`. */
	async clearJournal(): Promise<void> {
		this.journal = [];
		await this.persist();
	}

	setLastRunConflicts(count: number): void {
		this.lastRunConflicts = count;
		this.refreshSidebarViews();
	}

	/** Reflects a settings change (settings tab, or the palette's dry-run toggle) in any open sidebar. */
	private refreshSidebarViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TVS_SIDEBAR)) {
			if (leaf.view instanceof SidebarView) leaf.view.refresh();
		}
	}

	/**
	 * Ensures any sidebar leaf restored from workspace layout is fully loaded,
	 * woken up if deferred, instantiated as SidebarView if needed, and rendered.
	 */
	async ensureSidebarViewsLoaded(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TVS_SIDEBAR)) {
			const leafWithDeferred = leaf as unknown as { loadIfDeferred?: () => Promise<void> };
			if (typeof leafWithDeferred.loadIfDeferred === "function") {
				await leafWithDeferred.loadIfDeferred();
			}
			if (!(leaf.view instanceof SidebarView) && typeof leaf.getViewState === "function" && typeof leaf.setViewState === "function") {
				await leaf.setViewState(leaf.getViewState());
			}
			if (leaf.view instanceof SidebarView) {
				leaf.view.refresh();
			}
		}
	}

	/** Opens the sidebar view, or reveals it if already open — never a second instance. */
	async activateSidebarView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TVS_SIDEBAR);
		if (existing.length > 0 && existing[0]) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_TVS_SIDEBAR, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	/**
	 * A client built from the single configured credential pair.
	 * Pass the active reporter so a rate-limit retry shows up in the panel
	 * instead of the sync looking stalled while it silently backs off.
	 */
	client(reporter: Reporter = silentReporter): TrelloClient {
		return new TrelloClient(
			{ apiKey: this.settings.apiKey, token: this.settings.token },
			obsidianTransport,
			{
				maxRetries: this.settings.maxRetries,
				baseDelayMs: this.settings.baseDelayMs,
				requestTimeoutMs: this.settings.requestTimeoutMs,
				maxBackoffDelayMs: this.settings.maxBackoffDelayMs,
				onRetry: ({ attempt, maxAttempts, delayMs, status }) =>
					reporter.log(
						"warn",
						`${status === 0 ? "Connection failed" : `Trello responded with ${status}`} — retrying in ${(delayMs / 1000).toFixed(1)}s (attempt ${attempt}/${maxAttempts})`,
					),
			},
		);
	}

	fetchBinary(
		url: string,
		signal?: AbortSignal,
		redactFrom?: (text: string) => string,
		headers?: Record<string, string>,
	): Promise<ArrayBuffer | null> {
		return obsidianDownloadBinary(url, signal, redactFrom, headers);
	}

	/**
	 * The header Trello's card-attachment download endpoint actually accepts —
	 * see `audits/AUDIT_attachment-download.md` for why the query string this
	 * plugin used before doesn't work. Built from `this.settings` directly
	 * since a full `TrelloClient` isn't needed just for this string. No
	 * quote-escaping: Trello's own key/token format is fixed-length hex
	 * (`apps.trello.com`'s own docs), never containing a `"`.
	 */
	private attachmentAuthHeaders(): Record<string, string> {
		return { Authorization: `OAuth oauth_consumer_key="${this.settings.apiKey}", oauth_token="${this.settings.token}"` };
	}

	noteOptions(force?: "pull" | "push", bypassConflict?: boolean): NoteSyncOptions {
		return {
			policy: this.settings.policy,
			marginMs: this.settings.marginSeconds * 1000,
			syncTitle: this.settings.syncTitle,
			maxNameLength: this.settings.noteNameMaxLength,
			syncDescription: this.settings.syncDescription,
			syncDue: this.settings.syncDue,
			syncLabels: this.settings.syncLabels,
			dryRun: this.settings.dryRun,
			labelsSyncMode: this.settings.labelsSyncMode,
			dueFrontmatterKey: this.settings.dueFrontmatterKey,
			labelsFrontmatterKey: this.settings.labelsFrontmatterKey,
			syncAttachments: this.settings.syncAttachments,
			syncLinkedCards: this.settings.syncLinkedCards,
			attachmentsFrontmatterKey: this.settings.attachmentsFrontmatterKey,
			linkedCardsFrontmatterKey: this.settings.linkedCardsFrontmatterKey,
			syncChecklists: this.settings.syncChecklists,
			checklistHeading: this.settings.checklistHeading,
			syncCardCover: this.settings.syncCardCover,
			coverFrontmatterKey: this.settings.coverFrontmatterKey,
			preferLocalCover: this.settings.preferLocalCover,
			coverLocalFormat: this.settings.coverLocalFormat,
			syncMembers: this.settings.syncMembers,
			membersFrontmatterKey: this.settings.membersFrontmatterKey,
			syncCustomFields: this.settings.syncCustomFields,
			customFieldsFrontmatterKey: this.settings.customFieldsFrontmatterKey,
			fetchCardDetailsWithCards: this.settings.fetchCardDetailsWithCards,
			downloadAttachments: this.settings.downloadAttachments,
			attachmentsDestination: this.settings.attachmentsDestination,
			attachmentsFolder: this.settings.attachmentsFolder,
			attachmentsDownloadScope: this.settings.attachmentsDownloadScope,
			fetchBinary: (url, signal) =>
				this.fetchBinary(
					url,
					signal,
					(text) => redactSecrets(text, [this.settings.token, this.settings.apiKey]),
					this.attachmentAuthHeaders(),
				),
			guard: this.guard,
			...(force ? { force } : {}),
			...(bypassConflict ? { bypassConflict } : {}),
		};
	}

	folderOptions(force?: "pull" | "push", bypassConflict?: boolean): FolderSyncOptions {
		return {
			...this.noteOptions(force, bypassConflict),
			allowCreate: this.settings.allowCreate,
			allowDelete: this.settings.allowDelete,
			protectMovedOrArchivedCards: this.settings.protectMovedOrArchivedCards,
			boardId: this.settings.boardId,
			cardRefFrontmatterKey: this.settings.cardRefFrontmatterKey,
			defaultTemplateName: this.settings.defaultTemplateName,
		};
	}

	auditOptions(kind?: "links" | "locations" | "changes"): AuditOptions {
		let reportPath = this.settings.reportPath;
		if (kind === "links") {
			reportPath = this.settings.linkAuditReportPath || this.settings.reportPath;
		} else if (kind === "locations") {
			reportPath = this.settings.locationAuditReportPath || this.settings.reportPath;
		} else if (kind === "changes") {
			reportPath = this.settings.changesReportPath || this.settings.reportPath;
		}
		return {
			scope: this.settings.scope,
			boardId: this.settings.boardId,
			reportPath,
			timestamp: new Date().toLocaleString("en-CA", { hour12: false }),
			excludedFolders: this.settings.excludedFolders,
			autoCreateReportNote: this.settings.autoCreateReportNote,
		};
	}

	private panel(title: string, background: boolean, onCancel?: () => void): Reporter {
		const visible = this.settings.showPanel && (!background || this.settings.autoSyncShowPanel);
		const base = visible ? this.buildPanel(title, onCancel) : silentReporter;
		return this.withJournal(base, title);
	}

	private buildPanel(title: string, onCancel?: () => void): ProgressPanel {
		const suffix = this.settings.dryRun ? " (dry run)" : "";
		const panel = new ProgressPanel({
			title: title + suffix,
			autoCloseMs: this.settings.panelAutoCloseSeconds * 1000,
			maxLogRows: this.settings.logMaxRows,
			onCancel,
			keepOpenOnError: this.settings.keepPanelOpenOnError,
			onDestroy: () => this.panels.delete(panel),
		});
		// Tracked so onunload() can tear them down: without this, a panel left open
		// (autoCloseMs: 0, or one still mid-sync) survives a plugin disable/reload
		// with no owner left to remove it.
		this.panels.add(panel);
		return panel;
	}

	/**
	 * Wraps a `Reporter` so every `log()` call also lands in the persistent
	 * journal — even with `showPanel: false`, since the journal is a separate,
	 * always-on record. Explicit method forwarding (not `{ ...base }`): `base`
	 * can be a `ProgressPanel` instance, whose methods live on the prototype
	 * and would be lost by a shallow spread.
	 */
	private withJournal(base: Reporter, title: string): Reporter {
		return {
			setTotal: (total) => base.setTotal(total),
			step: (label) => base.step(label),
			count: (key, value) => base.count(key, value),
			// Single point that sees every log() call plus `settings.dryRun` — the
			// only place a "[Dry-run]" prefix is ever added (core/journal.ts::prefixDryRunMessage),
			// so the panel, the in-memory journal and every sidebar copy stay in sync for free.
			log: (level, rawMessage) => {
				const message = prefixDryRunMessage(rawMessage, this.settings.dryRun);
				base.log(level, message);
				// The shared journal mixes lines from every running operation: name the source only when that is ambiguous.
				const source = this.gate.active > 1 ? title : undefined;
				this.journal = appendJournalEntry(
					this.journal,
					source ? { level, message, source } : { level, message },
					this.settings.logMaxRows,
				);
				this.appendJournalToSidebars(level, message, source);
			},
			// Written to disk once per finished command, not once per log() call
			// — a sync can emit dozens of log lines, one disk write per line would be wasteful.
			// Fire-and-forget: onunload() doesn't await this, so a plugin disable in the
			// instant right after finish() could lose that last write — acceptable, the
			// journal is best-effort operational history, not data the user relies on.
			finish: (outcome, summary) => {
				base.finish(outcome, summary);
				void this.persist();
			},
		};
	}

	private appendJournalToSidebars(level: LogLevel, message: string, source?: string): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TVS_SIDEBAR)) {
			if (leaf.view instanceof SidebarView) leaf.view.appendJournalEntry(level, message, source);
		}
	}

	activeNote(): NoteHandle | null {
		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile) || file.extension !== "md") {
			new Notice("No active note.");
			return null;
		}
		return this.vault.noteAt(file.path);
	}

	isSyncing(): boolean {
		return this.pendingTitles.size > 0;
	}

	/**
	 * Guard every command behind usable settings. Each command still builds its
	 * own client via `this.client(reporter)` once its panel/reporter exists —
	 * this only checks the settings, it never constructs a client.
	 */
	ready(needsBoard = false): boolean {
		if (!hasCredentials(this.settings)) {
			new Notice("Trello Vault Sync: set the key and token in the plugin settings.");
			return false;
		}
		if (needsBoard && this.settings.boardId.trim() === "") {
			new Notice("Trello Vault Sync: set the board id in the plugin settings.");
			return false;
		}
		return true;
	}

	/**
	 * Run a command body with its own panel, one error path and one summary notice.
	 * Operations run side by side (up to `maxConcurrentOperations`), each with its own
	 * panel and cancel button; launching one never cancels another.
	 * The Cancel button is shown by default. `cancellable: false` is reserved for
	 * bodies that make no network call and run no unbounded loop — there, the
	 * button would have nothing to actually stop, so showing it would just risk a
	 * falsely reported "Cancelled." over a change that landed anyway.
	 */
	async run(
		title: string,
		body: (reporter: Reporter, signal: AbortSignal) => Promise<string>,
		opts: { cancellable?: boolean; countsAsSync?: boolean } = {},
	): Promise<void> {
		await this.execute(title, body, opts);
	}

	/** `run()` plus what auto-sync needs: the operation's outcome, and whether it is a background one. */
	private async execute(
		title: string,
		body: (reporter: Reporter, signal: AbortSignal) => Promise<string>,
		{
			cancellable = true,
			countsAsSync = false,
			background = false,
		}: { cancellable?: boolean; countsAsSync?: boolean; background?: boolean } = {},
	): Promise<RunOutcome> {
		if (this.pendingTitles.has(title)) {
			if (!background) new Notice(`Trello Vault Sync: "${title}" is already running — wait for it to finish.`);
			return "busy";
		}
		this.pendingTitles.add(title);
		let release: (() => void) | null = null;
		try {
			const mustWait = this.gate.waiting > 0 || this.gate.active >= this.settings.maxConcurrentOperations;
			if (mustWait && !background) {
				new Notice(`Trello Vault Sync: "${title}" is queued — ${this.gate.active} operation(s) running.`);
			}
			release = await this.gate.acquire();
			return await this.executeInSlot(title, body, cancellable, countsAsSync, background);
		} finally {
			release?.();
			this.pendingTitles.delete(title);
			this.lastRunEndedAt = Date.now();
			// Nothing running or waiting any more: the next busy period starts with a clean slate.
			if (this.pendingTitles.size === 0) this.guard.resetClaims();
		}
	}

	private async executeInSlot(
		title: string,
		body: (reporter: Reporter, signal: AbortSignal) => Promise<string>,
		cancellable: boolean,
		countsAsSync: boolean,
		background: boolean,
	): Promise<RunOutcome> {
		const quiet = background && !this.settings.autoSyncShowPanel;
		const prefix = background ? "Auto-sync: " : "";
		const controller = new AbortController();
		const reporter = this.panel(title, background, cancellable ? () => controller.abort() : undefined);
		try {
			const summary = await body(reporter, controller.signal);
			if (controller.signal.aborted) {
				reporter.finish("aborted", "Cancelled.");
				new Notice("Trello Vault Sync: sync cancelled.");
				return "aborted";
			}
			if (countsAsSync && !this.settings.dryRun) this.markSyncSucceeded();
			reporter.finish("done", summary);
			if (!quiet) new Notice(`✅ ${prefix}${summary}`);
			return "done";
		} catch (error) {
			if (controller.signal.aborted) {
				reporter.finish("aborted", "Cancelled.");
				new Notice("Trello Vault Sync: sync cancelled.");
				return "aborted";
			}
			const message = errorMessage(error);
			reporter.log("error", message);
			reporter.finish("error", message);
			new Notice(`❌ ${prefix}${message}`);
			console.error("[trello-vault-sync]", error);
			return "error";
		}
	}

	/** A sync finished cleanly: restart the auto-sync timer from now and lift a failure pause. */
	private markSyncSucceeded(): void {
		this.lastSyncAt = Date.now();
		this.autoSyncFailures = 0;
		if (this.autoSyncPaused) {
			this.autoSyncPaused = false;
			this.refreshSidebarViews();
		}
	}

	/** What the sidebar shows next to its auto-sync switch. */
	autoSyncState(): "off" | "on" | "paused" {
		if (!this.settings.autoSyncEnabled) return "off";
		return this.autoSyncPaused ? "paused" : "on";
	}

	/** Palette command and sidebar switch: turning auto-sync on also lifts a failure pause. */
	async setAutoSyncEnabled(enabled: boolean): Promise<void> {
		this.settings.autoSyncEnabled = enabled;
		this.autoSyncPaused = false;
		this.autoSyncFailures = 0;
		await this.saveSettings();
	}

	private registerCommands(): void {
		for (const command of COMMANDS) {
			this.addCommand({
				id: command.id,
				name: command.name,
				callback: () => command.run(this),
			});
		}

		this.addCommand({
			id: "toggle-auto-sync",
			name: "Toggle auto-sync",
			callback: async () => {
				await this.setAutoSyncEnabled(!this.settings.autoSyncEnabled);
				new Notice(`Auto-sync ${this.settings.autoSyncEnabled ? "enabled" : "disabled"}.`);
			},
		});

		this.addCommand({
			id: "toggle-dry-run",
			name: "Toggle dry-run mode",
			callback: () => noteCommands.toggleDryRun(this),
		});
	}

	private registerRibbon(): void {
		this.rebuildRibbon();
	}

	/**
	 * Re-reads `settings.ribbonCommandIds` and replaces the configurable ribbon
	 * icons accordingly — called after every settings save so a change made in
	 * the settings tab shows up without restarting Obsidian. An id no longer in
	 * `COMMANDS` (settings saved by an older version, a command since removed)
	 * is skipped rather than treated as an error: unlike the old hardcoded list,
	 * this one is user data, not a dev-time invariant.
	 */
	private rebuildRibbon(): void {
		for (const { el, title } of this.configurableRibbonEls) this.removeRibbonIconEl(el, title);
		this.configurableRibbonEls = this.settings.ribbonCommandIds
			.map((id) => COMMANDS.find((entry) => entry.id === id))
			.filter((command): command is CommandDescriptor => command !== undefined)
			.map((command) => {
				const el = this.addRibbonIcon(command.icon, command.name, () => command.run(this));
				const customColor = this.settings.ribbonIconColors[command.id];
				if (customColor) {
					el.style.color = customColor;
					el.style.setProperty("--icon-color", customColor);
					el.style.setProperty("--ribbon-icon-color", customColor);
					const svg = typeof el.querySelector === "function" ? el.querySelector<SVGElement>("svg") : null;
					if (svg) {
						svg.style.color = customColor;
						if (typeof svg.style.setProperty === "function") {
							svg.style.setProperty("stroke", customColor);
						}
					}
				}
				return { el, title: command.name };
			});
	}

	/**
	 * Detaches a ribbon icon and purges it from Obsidian's own ribbon registry.
	 * `el.remove()` alone only hides the icon until the next workspace layout pass:
	 * since some Obsidian version, `app.workspace.leftRibbon` keeps its own list of
	 * every icon ever added (keyed `"pluginId:title"`, with a `hidden` flag — this is
	 * what backs the built-in right-click "Hide icon" feature) and re-inserts any
	 * entry that's still registered and not marked hidden, silently undoing a plain
	 * `.remove()`. `removeRibbonAction` is how the icon actually gets forgotten.
	 * It's not part of the public Plugin API, so this is wrapped defensively — if a
	 * future Obsidian release changes its shape, this quietly no-ops and the icon
	 * falls back to disappearing only after a restart, same as before this fix.
	 */
	private removeRibbonIconEl(el: HTMLElement, title: string): void {
		el.remove();
		try {
			const leftRibbon = (
				this.app.workspace as unknown as {
					leftRibbon?: { removeRibbonAction?: (id: string) => void };
				}
			).leftRibbon;
			leftRibbon?.removeRibbonAction?.(`${this.manifest.id}:${title}`);
		} catch {
			// Best-effort only — see doc comment above.
		}
	}

	/**
	 * Wires the two possible auto-sync triggers, once, for the plugin's whole
	 * lifetime — `registerInterval`/`registerDomEvent` tear both down automatically
	 * on unload, so there is nothing to clean up when a setting changes: every
	 * tick re-reads `this.settings` live, `decideAutoSync` (pure) does the
	 * actual gating. This means disabling auto-sync, or changing its interval,
	 * takes effect on the very next tick — no reload needed.
	 */
	private registerAutoSync(): void {
		this.registerInterval(
			window.setInterval(() => void this.checkAutoSync("interval"), TrelloVaultSyncPlugin.AUTO_SYNC_POLL_MS),
		);
		this.registerDomEvent(window, "focus", () => void this.checkAutoSync("focus"));
		this.registerEvent(this.app.vault.on("modify", (file) => this.onNoteModified(file)));
		// Layout-ready, not onload() itself: the workspace (active file, panes)
		// isn't settled yet inside onload(), and a sync that fires before it is
		// would race Obsidian's own startup.
		this.app.workspace.onLayoutReady(() => {
			void this.ensureSidebarViewsLoaded();
			void this.checkAutoSync("startup");
		});
	}

	/** Whether `event` is one of the triggers the user turned on — a plain lookup, not a fixed enum, so a 4th trigger kind is just one more setting and one more branch here. */
	private isAutoSyncTriggerEnabled(event: AutoSyncEvent): boolean {
		switch (event) {
			case "interval":
				return this.settings.autoSyncOnInterval;
			case "focus":
				return this.settings.autoSyncOnFocus;
			case "startup":
				return this.settings.autoSyncOnStartup;
			case "note-change":
				return this.settings.autoSyncOnNoteChange;
		}
	}

	/**
	 * "Sync a linked note after I edit it": debounced per note, so a typing
	 * burst becomes one sync once the note has been quiet for
	 * `autoSyncNoteChangeDelaySeconds`. Edits during a sync, or just after, are
	 * the sync's own writes (pull, rename) and are ignored.
	 */
	private onNoteModified(file: unknown): void {
		if (!this.settings.autoSyncEnabled || !this.settings.autoSyncOnNoteChange) return;
		if (!(file instanceof TFile) || file.extension !== "md") return;
		if (this.isSyncing() || Date.now() - this.lastRunEndedAt < TrelloVaultSyncPlugin.OWN_WRITE_GRACE_MS) return;
		const inScope = excludeFolders(notesInFolder([file], this.settings.scope), this.settings.excludedFolders);
		if (inScope.length === 0) return;

		const path = file.path;
		const pending = this.noteChangeTimers.get(path);
		if (pending !== undefined) window.clearTimeout(pending);
		this.noteChangeTimers.set(
			path,
			window.setTimeout(() => {
				this.noteChangeTimers.delete(path);
				void this.runNoteChangeSync(path);
			}, this.settings.autoSyncNoteChangeDelaySeconds * 1000),
		);
	}

	private async runNoteChangeSync(path: string): Promise<void> {
		const note = this.vault.noteAt(path);
		if (!note || !this.vault.getCardRef(note)) return;
		if (!this.autoSyncAllowed("note-change")) return;
		await this.inBackground((ctx) => noteCommands.syncNoteAt(ctx, note));
	}

	/** Shared gate for every trigger. A single-note sync ignores `lastSyncAt`: its own floor is the edit debounce. */
	private autoSyncAllowed(event: AutoSyncEvent): boolean {
		// No credentials yet: stay silent — `ready()` would otherwise pop a notice on every tick.
		if (!hasCredentials(this.settings)) return false;
		const decision = decideAutoSync({
			enabled: this.settings.autoSyncEnabled,
			triggerEnabled: this.isAutoSyncTriggerEnabled(event),
			event,
			now: Date.now(),
			lastRunAt: event === "note-change" ? null : this.lastSyncAt,
			syncing: this.isSyncing(),
			intervalMinutes: this.settings.autoSyncIntervalMinutes,
			minIdleSeconds: this.settings.autoSyncMinIdleSeconds,
			online: navigator.onLine,
			paused: this.autoSyncPaused,
			hidden: document.hidden,
			onlyWhenVisible: this.settings.autoSyncOnlyWhenVisible,
		});
		return decision.action === "run";
	}

	/**
	 * Runs `body` as an automatic sync (quiet by default) and counts its failures toward the pause threshold.
	 * `body` gets a context whose `run()` marks each operation as a background one and records its outcome —
	 * per call, so a manual operation running at the same time cannot be mistaken for it.
	 */
	private async inBackground(
		body: (ctx: this, lastOutcome: () => RunOutcome | undefined) => Promise<void>,
	): Promise<void> {
		const outcomes: RunOutcome[] = [];
		const lastOutcome = () => outcomes[outcomes.length - 1];
		const ctx = new Proxy(this, {
			get: (target, key) => {
				if (key === "run") {
					return async (
						title: string,
						runBody: (reporter: Reporter, signal: AbortSignal) => Promise<string>,
						opts: { cancellable?: boolean; countsAsSync?: boolean } = {},
					): Promise<void> => {
						outcomes.push(await target.execute(title, runBody, { ...opts, background: true }));
					};
				}
				const value: unknown = Reflect.get(target, key, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		await body(ctx, lastOutcome);
		if (lastOutcome() === "error") this.recordAutoSyncFailure();
		else if (lastOutcome() === "done") this.autoSyncFailures = 0;
	}

	private recordAutoSyncFailure(): void {
		this.autoSyncFailures++;
		const limit = this.settings.autoSyncPauseAfterFailures;
		if (limit > 0 && this.autoSyncFailures >= limit && !this.autoSyncPaused) {
			this.autoSyncPaused = true;
			new Notice(
				`Trello Vault Sync: auto-sync paused after ${this.autoSyncFailures} failed runs in a row. ` +
					"A successful manual sync, or switching auto-sync off and on, resumes it.",
			);
			this.refreshSidebarViews();
		}
	}

	private async checkAutoSync(event: AutoSyncEvent): Promise<void> {
		if (!this.autoSyncAllowed(event)) return;
		const { autoSyncScopeMappings: mappings, autoSyncScopeVault: vault } = this.settings;
		if (!mappings && !vault) return;

		// Mapped folders first — it's the only one of the two that can create a
		// note — then the whole vault, so a note just created above is already
		// linked and gets picked up by the same run. With both on, the vault pass
		// skips the mapped folders: they were just synced, a second pass would
		// only spend Trello requests. A failed folder pass stops there.
		await this.inBackground(async (ctx, lastOutcome) => {
			if (mappings) await syncCommands.syncAllMappings(ctx);
			if (vault && (!mappings || lastOutcome() === "done")) {
				await syncCommands.syncAllLinked(ctx, undefined, { skipMappedFolders: mappings });
			}
		});
	}
}
