import { Notice, Plugin, TFile } from "obsidian";
import * as auditCommands from "./commands/auditCommands";
import type { CommandContext } from "./commands/context";
import * as noteCommands from "./commands/noteCommands";
import * as syncCommands from "./commands/syncCommands";
import { errorMessage } from "./core/errorMessage";
import type { AuditOptions } from "./features/auditShared";
import type { FolderSyncOptions } from "./features/syncFolder";
import type { NoteSyncOptions } from "./features/syncNote";
import { ObsidianVault } from "./obsidian/ObsidianVault";
import { obsidianTransport } from "./obsidian/transport";
import { silentReporter, type NoteHandle, type Reporter } from "./obsidian/gateway";
import { TrelloVaultSyncSettingsTab } from "./settings/SettingsTab";
import { DEFAULT_SETTINGS, normalizeSettings, type TrelloVaultSyncSettings } from "./settings/types";
import { TrelloClient } from "./trello/client";
import { ProgressPanel } from "./ui/ProgressPanel";

export default class TrelloVaultSyncPlugin extends Plugin implements CommandContext {
	override settings: TrelloVaultSyncSettings = { ...DEFAULT_SETTINGS };
	vault!: ObsidianVault;
	/** Guards every command in `run()` — two commands writing to the vault at once can race. */
	private syncing = false;
	/** The panel of the sync currently running, if any — torn down on unload. */
	private activePanel: ProgressPanel | null = null;

	override async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.vault = new ObsidianVault(this.app);
		this.addSettingTab(new TrelloVaultSyncSettingsTab(this.app, this));
		this.registerCommands();
		this.registerRibbon();
	}

	override onunload(): void {
		this.activePanel?.destroy();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
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
				onRetry: ({ attempt, maxAttempts, delayMs, status }) =>
					reporter.log(
						"warn",
						`${status === 0 ? "Connection failed" : `Trello responded with ${status}`} — retrying in ${(delayMs / 1000).toFixed(1)}s (attempt ${attempt}/${maxAttempts})`,
					),
			},
		);
	}

	noteOptions(force?: "pull" | "push"): NoteSyncOptions {
		return {
			policy: this.settings.policy,
			marginMs: this.settings.marginSeconds * 1000,
			syncTitle: this.settings.syncTitle,
			dryRun: this.settings.dryRun,
			...(force ? { force } : {}),
		};
	}

	folderOptions(): FolderSyncOptions {
		return {
			...this.noteOptions(),
			allowCreate: this.settings.allowCreate,
			allowDelete: this.settings.allowDelete,
			boardId: this.settings.boardId,
		};
	}

	auditOptions(): AuditOptions {
		return {
			scope: this.settings.scope,
			boardId: this.settings.boardId,
			reportPath: this.settings.reportPath,
			timestamp: new Date().toLocaleString("en-CA", { hour12: false }),
		};
	}

	private panel(title: string, onCancel?: () => void): Reporter {
		if (!this.settings.showPanel) return silentReporter;
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
		if (this.settings.apiKey.trim() === "" || this.settings.token.trim() === "") {
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
		this.addCommand({
			id: "sync-active-note",
			name: "Sync active note",
			callback: () => noteCommands.syncActive(this),
		});

		this.addCommand({
			id: "pull-active-note",
			name: "Pull from Trello (active note)",
			callback: () => noteCommands.syncActive(this, "pull"),
		});

		this.addCommand({
			id: "push-active-note",
			name: "Push to Trello (active note)",
			callback: () => noteCommands.syncActive(this, "push"),
		});

		this.addCommand({
			id: "link-active-note",
			name: "Link active note to a card",
			callback: () => noteCommands.linkActive(this),
		});

		this.addCommand({
			id: "resolve-conflict",
			name: "Resolve conflict (active note), side by side",
			callback: () => noteCommands.resolveConflict(this),
		});

		this.addCommand({
			id: "sync-vault",
			name: "Sync all linked notes",
			callback: () => syncCommands.syncAllLinked(this),
		});

		this.addCommand({
			id: "sync-mapping",
			name: "Sync a list with its folder",
			callback: () => syncCommands.syncOneMapping(this),
		});

		this.addCommand({
			id: "sync-all-mappings",
			name: "Sync every list with its folder",
			callback: () => syncCommands.syncAllMappings(this),
		});

		this.addCommand({
			id: "audit-links",
			name: "Audit links (orphan cards and notes)",
			callback: () => auditCommands.runLinkAudit(this),
		});

		this.addCommand({
			id: "audit-locations",
			name: "Compare locations against Trello lists",
			callback: () => auditCommands.runLocationAudit(this),
		});

		this.addCommand({
			id: "toggle-dry-run",
			name: "Toggle dry-run mode",
			callback: () => noteCommands.toggleDryRun(this),
		});
	}

	private registerRibbon(): void {
		this.addRibbonIcon("refresh-cw", "Sync active note", () => noteCommands.syncActive(this));
		this.addRibbonIcon("kanban-square", "Sync all linked notes", () => syncCommands.syncAllLinked(this));
		this.addRibbonIcon("folder-sync", "Sync a list with its folder", () => syncCommands.syncOneMapping(this));
		this.addRibbonIcon("search", "Audit Trello links", () => auditCommands.runLinkAudit(this));
	}
}
