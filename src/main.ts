import { Notice, Plugin, TFile } from "obsidian";
import type { CommandContext } from "./commands/context";
import * as noteCommands from "./commands/noteCommands";
import { COMMANDS } from "./commands/registry";
import { errorMessage } from "./core/errorMessage";
import { appendJournalEntry, type JournalEntry, type LogLevel } from "./core/journal";
import { normalizePersistedData } from "./core/pluginData";
import type { AuditOptions } from "./features/auditShared";
import type { FolderSyncOptions } from "./features/syncFolder";
import type { NoteSyncOptions } from "./features/syncNote";
import { ObsidianVault } from "./obsidian/ObsidianVault";
import { obsidianDownloadBinary, obsidianTransport } from "./obsidian/transport";
import { silentReporter, type NoteHandle, type Reporter } from "./obsidian/gateway";
import { TrelloVaultSyncSettingsTab } from "./settings/SettingsTab";
import { DEFAULT_SETTINGS, hasCredentials, normalizeSettings, type TrelloVaultSyncSettings } from "./settings/types";
import { TrelloClient } from "./trello/client";
import { MAX_LOG_ROWS, ProgressPanel } from "./ui/ProgressPanel";
import { SidebarView, VIEW_TYPE_TVS_SIDEBAR } from "./ui/SidebarView";

export default class TrelloVaultSyncPlugin extends Plugin implements CommandContext {
	override settings: TrelloVaultSyncSettings = { ...DEFAULT_SETTINGS };
	vault!: ObsidianVault;
	journal: JournalEntry[] = [];
	/** Guards every command in `run()` — two commands writing to the vault at once can race. */
	private syncing = false;
	/** The panel of the sync currently running, if any — torn down on unload. */
	private activePanel: ProgressPanel | null = null;
	/** Icons added from `settings.ribbonCommandIds` — tracked so `rebuildRibbon()` can remove them, unlike the fixed "Open Trello Vault Sync" icon. */
	private configurableRibbonEls: HTMLElement[] = [];

	override async onload(): Promise<void> {
		const { settingsRaw, journal } = normalizePersistedData(await this.loadData());
		this.settings = normalizeSettings(settingsRaw);
		this.journal = journal;
		this.vault = new ObsidianVault(this.app, () => this.settings.cardRefFrontmatterKey);
		this.addSettingTab(new TrelloVaultSyncSettingsTab(this.app, this));
		this.registerView(VIEW_TYPE_TVS_SIDEBAR, (leaf) => new SidebarView(leaf, this));
		this.registerCommands();
		this.registerRibbon();
	}

	override onunload(): void {
		this.activePanel?.destroy();
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_TVS_SIDEBAR);
	}

	async saveSettings(): Promise<void> {
		await this.persist();
		this.refreshSidebarViews();
		this.rebuildRibbon();
	}

	/** Writes settings and journal together into the plugin's own `data.json` — the journal's persistence, not a vault note (internal state, not a user-facing deliverable like the audit reports). */
	private async persist(): Promise<void> {
		await this.saveData({ settings: this.settings, journal: this.journal });
	}

	/** Reflects a settings change (settings tab, or the palette's dry-run toggle) in any open sidebar. */
	private refreshSidebarViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TVS_SIDEBAR)) {
			if (leaf.view instanceof SidebarView) leaf.view.refresh();
		}
	}

	/** Opens the sidebar view, or reveals it if already open — never a second instance. */
	private async activateSidebarView(): Promise<void> {
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
				onRetry: ({ attempt, maxAttempts, delayMs, status }) =>
					reporter.log(
						"warn",
						`${status === 0 ? "Connection failed" : `Trello responded with ${status}`} — retrying in ${(delayMs / 1000).toFixed(1)}s (attempt ${attempt}/${maxAttempts})`,
					),
			},
		);
	}

	fetchBinary(url: string, signal?: AbortSignal): Promise<ArrayBuffer | null> {
		return obsidianDownloadBinary(url, signal);
	}

	noteOptions(force?: "pull" | "push"): NoteSyncOptions {
		return {
			policy: this.settings.policy,
			marginMs: this.settings.marginSeconds * 1000,
			syncTitle: this.settings.syncTitle,
			dryRun: this.settings.dryRun,
			labelsSyncMode: this.settings.labelsSyncMode,
			dueFrontmatterKey: this.settings.dueFrontmatterKey,
			labelsFrontmatterKey: this.settings.labelsFrontmatterKey,
			...(force ? { force } : {}),
		};
	}

	folderOptions(): FolderSyncOptions {
		return {
			...this.noteOptions(),
			allowCreate: this.settings.allowCreate,
			allowDelete: this.settings.allowDelete,
			boardId: this.settings.boardId,
			cardRefFrontmatterKey: this.settings.cardRefFrontmatterKey,
		};
	}

	auditOptions(): AuditOptions {
		return {
			scope: this.settings.scope,
			boardId: this.settings.boardId,
			reportPath: this.settings.reportPath,
			timestamp: new Date().toLocaleString("en-CA", { hour12: false }),
			excludedFolders: this.settings.excludedFolders,
		};
	}

	private panel(title: string, onCancel?: () => void): Reporter {
		const base = this.settings.showPanel ? this.buildPanel(title, onCancel) : silentReporter;
		return this.withJournal(base);
	}

	private buildPanel(title: string, onCancel?: () => void): ProgressPanel {
		const suffix = this.settings.dryRun ? " (dry run)" : "";
		const panel = new ProgressPanel({
			title: title + suffix,
			autoCloseMs: this.settings.panelAutoCloseSeconds * 1000,
			onCancel,
		});
		// Tracked so onunload() can tear it down: without this, a panel left open
		// (autoCloseMs: 0, or one still mid-sync) survives a plugin disable/reload
		// with no owner left to remove it.
		this.activePanel = panel;
		return panel;
	}

	/**
	 * Wraps a `Reporter` so every `log()` call also lands in the persistent
	 * journal — even with `showPanel: false`, since the journal is a separate,
	 * always-on record. Explicit method forwarding (not `{ ...base }`): `base`
	 * can be a `ProgressPanel` instance, whose methods live on the prototype
	 * and would be lost by a shallow spread.
	 */
	private withJournal(base: Reporter): Reporter {
		return {
			setTotal: (total) => base.setTotal(total),
			step: (label) => base.step(label),
			count: (key, value) => base.count(key, value),
			log: (level, message) => {
				base.log(level, message);
				this.journal = appendJournalEntry(this.journal, { level, message }, MAX_LOG_ROWS);
				this.appendJournalToSidebars(level, message);
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

	private appendJournalToSidebars(level: LogLevel, message: string): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TVS_SIDEBAR)) {
			if (leaf.view instanceof SidebarView) leaf.view.appendJournalEntry(level, message);
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
	 * Run a command body with one panel, one error path and one summary notice.
	 * `cancellable: false` (single-note commands — one HTTP call, nothing to break
	 * out of mid-flight) hides the Cancel affordance: showing one that can't stop
	 * the already-in-flight request would let it complete and then falsely report
	 * "Cancelled." over a change that actually landed.
	 */
	async run(
		title: string,
		body: (reporter: Reporter, signal: AbortSignal) => Promise<string>,
		{ cancellable = true }: { cancellable?: boolean } = {},
	): Promise<void> {
		if (this.syncing) {
			new Notice("Trello Vault Sync: a sync is already running — wait for it to finish.");
			return;
		}
		this.syncing = true;
		const controller = new AbortController();
		const reporter = this.panel(title, cancellable ? () => controller.abort() : undefined);
		try {
			const summary = await body(reporter, controller.signal);
			if (controller.signal.aborted) {
				reporter.finish("aborted", "Cancelled.");
				new Notice("Trello Vault Sync: sync cancelled.");
			} else {
				reporter.finish("done", summary);
				new Notice(`✅ ${summary}`);
			}
		} catch (error) {
			if (controller.signal.aborted) {
				reporter.finish("aborted", "Cancelled.");
				new Notice("Trello Vault Sync: sync cancelled.");
				return;
			}
			const message = errorMessage(error);
			reporter.log("error", message);
			reporter.finish("error", message);
			new Notice(`❌ ${message}`);
			console.error("[trello-vault-sync]", error);
		} finally {
			this.syncing = false;
		}
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
			id: "toggle-dry-run",
			name: "Toggle dry-run mode",
			callback: () => noteCommands.toggleDryRun(this),
		});
	}

	private registerRibbon(): void {
		this.addRibbonIcon("panel-right", "Open Trello Vault Sync", () => void this.activateSidebarView());
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
		for (const el of this.configurableRibbonEls) el.remove();
		this.configurableRibbonEls = this.settings.ribbonCommandIds
			.map((id) => COMMANDS.find((entry) => entry.id === id))
			.filter((command) => command !== undefined)
			.map((command) => this.addRibbonIcon(command.icon, command.name, () => command.run(this)));
	}
}
