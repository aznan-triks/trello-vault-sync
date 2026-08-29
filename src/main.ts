import { Notice, Plugin, TFile } from "obsidian";
import { addCounts } from "./core/syncTally";
import { auditLinks } from "./features/auditLinks";
import { auditLocations } from "./features/auditLocations";
import { linkActiveNote } from "./features/linkNote";
import {
	emptyStats,
	syncFolder,
	type FolderMapping,
	type FolderSyncOptions,
} from "./features/syncFolder";
import { syncNote, type NoteSyncOptions } from "./features/syncNote";
import { syncVault } from "./features/syncVault";
import { ObsidianVault } from "./obsidian/ObsidianVault";
import { obsidianTransport } from "./obsidian/transport";
import { silentReporter, type NoteHandle, type Reporter } from "./obsidian/gateway";
import { TrelloVaultSyncSettingsTab } from "./settings/SettingsTab";
import { DEFAULT_SETTINGS, normalizeSettings, type TrelloVaultSyncSettings } from "./settings/types";
import { TrelloClient } from "./trello/client";
import { MappingSuggest } from "./ui/MappingSuggest";
import { ProgressPanel } from "./ui/ProgressPanel";

export default class TrelloVaultSyncPlugin extends Plugin {
	override settings: TrelloVaultSyncSettings = { ...DEFAULT_SETTINGS };
	private vault!: ObsidianVault;
	/** Guards every command in `run()` — two commands writing to the vault at once can race. */
	private syncing = false;

	override async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.vault = new ObsidianVault(this.app);
		this.addSettingTab(new TrelloVaultSyncSettingsTab(this.app, this));
		this.registerCommands();
		this.registerRibbon();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** A client built from the single configured credential pair. */
	client(): TrelloClient {
		return new TrelloClient(
			{ apiKey: this.settings.apiKey, token: this.settings.token },
			obsidianTransport,
			{ maxRetries: this.settings.maxRetries, baseDelayMs: this.settings.baseDelayMs },
		);
	}

	private noteOptions(force?: "pull" | "push"): NoteSyncOptions {
		return {
			policy: this.settings.policy,
			marginMs: this.settings.marginSeconds * 1000,
			syncTitle: this.settings.syncTitle,
			dryRun: this.settings.dryRun,
			...(force ? { force } : {}),
		};
	}

	private folderOptions(): FolderSyncOptions {
		return {
			...this.noteOptions(),
			allowCreate: this.settings.allowCreate,
			allowDelete: this.settings.allowDelete,
			boardId: this.settings.boardId,
		};
	}

	private panel(title: string): Reporter & { destroy?: () => void } {
		if (!this.settings.showPanel) return silentReporter;
		const suffix = this.settings.dryRun ? " (dry run)" : "";
		return new ProgressPanel({
			title: title + suffix,
			autoCloseMs: this.settings.panelAutoCloseSeconds * 1000,
		});
	}

	private activeNote(): NoteHandle | null {
		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile) || file.extension !== "md") {
			new Notice("No active note.");
			return null;
		}
		return this.vault.noteAt(file.path);
	}

	/** Guard every command behind a configured, usable client. */
	private ready(needsBoard = false): TrelloClient | null {
		const client = this.client();
		if (!client.configured) {
			new Notice("Trello Vault Sync: set the key and token in the plugin settings.");
			return null;
		}
		if (needsBoard && this.settings.boardId.trim() === "") {
			new Notice("Trello Vault Sync: set the board id in the plugin settings.");
			return null;
		}
		return client;
	}

	/** Run a command body with one panel, one error path and one summary notice. */
	private async run(
		title: string,
		body: (reporter: Reporter) => Promise<string>,
	): Promise<void> {
		if (this.syncing) {
			new Notice("Trello Vault Sync: a sync is already running — wait for it to finish.");
			return;
		}
		this.syncing = true;
		const reporter = this.panel(title);
		try {
			const summary = await body(reporter);
			reporter.finish("done", summary);
			new Notice(`✅ ${summary}`);
		} catch (error) {
			const message = (error as Error).message;
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
			callback: () => this.syncActive(),
		});

		this.addCommand({
			id: "pull-active-note",
			name: "Pull from Trello (active note)",
			callback: () => this.syncActive("pull"),
		});

		this.addCommand({
			id: "push-active-note",
			name: "Push to Trello (active note)",
			callback: () => this.syncActive("push"),
		});

		this.addCommand({
			id: "link-active-note",
			name: "Link active note to a card",
			callback: () => this.linkActive(),
		});

		this.addCommand({
			id: "sync-vault",
			name: "Sync all linked notes",
			callback: () => this.syncAllLinked(),
		});

		this.addCommand({
			id: "sync-mapping",
			name: "Sync a list with its folder",
			callback: () => this.syncOneMapping(),
		});

		this.addCommand({
			id: "sync-all-mappings",
			name: "Sync every list with its folder",
			callback: () => this.syncAllMappings(),
		});

		this.addCommand({
			id: "audit-links",
			name: "Audit links (orphan cards and notes)",
			callback: () => this.runLinkAudit(),
		});

		this.addCommand({
			id: "audit-locations",
			name: "Compare locations against Trello lists",
			callback: () => this.runLocationAudit(),
		});

		this.addCommand({
			id: "toggle-dry-run",
			name: "Toggle dry-run mode",
			callback: async () => {
				this.settings.dryRun = !this.settings.dryRun;
				await this.saveSettings();
				new Notice(`Dry-run mode ${this.settings.dryRun ? "enabled" : "disabled"}.`);
			},
		});
	}

	private registerRibbon(): void {
		this.addRibbonIcon("refresh-cw", "Sync active note", () => this.syncActive());
		this.addRibbonIcon("kanban-square", "Sync all linked notes", () => this.syncAllLinked());
		this.addRibbonIcon("folder-sync", "Sync a list with its folder", () => this.syncOneMapping());
		this.addRibbonIcon("search", "Audit Trello links", () => this.runLinkAudit());
	}

	private async syncActive(force?: "pull" | "push"): Promise<void> {
		const client = this.ready();
		const note = this.activeNote();
		if (!client || !note) return;

		await this.run(`Sync — ${note.basename}`, async (reporter) => {
			reporter.setTotal(1);
			reporter.step(note.basename);
			const result = await syncNote(this.vault, client, note, this.noteOptions(force));
			reporter.log(result.direction === "unlinked" ? "warn" : "info", result.reason);

			switch (result.direction) {
				case "pull":
					return `Pulled from Trello${result.renamed ? " and renamed" : ""}.`;
				case "push":
					return "Pushed to Trello.";
				case "conflict":
					return "Conflict: note and card changed at the same time, nothing was written.";
				case "unlinked":
					return "Note not linked — use \"Link active note to a card\".";
				default:
					return "Already up to date.";
			}
		});
	}

	private async linkActive(): Promise<void> {
		const client = this.ready(true);
		const note = this.activeNote();
		if (!client || !note) return;

		await this.run(`Link — ${note.basename}`, async () => {
			const result = await linkActiveNote(this.vault, client, note, {
				boardId: this.settings.boardId,
				threshold: this.settings.similarityThreshold,
			});
			if (result.reason === "already-linked") return "This note is already linked to a card.";
			if (!result.linked) return "No card close enough to the note's title.";
			return `Linked to "${result.card?.name}" (${Math.round(result.score * 100)}%).`;
		});
	}

	private async syncAllLinked(): Promise<void> {
		const client = this.ready(true);
		if (!client) return;

		await this.run("Vault sync", async (reporter) => {
			const stats = await syncVault(
				this.vault,
				client,
				{ scope: this.settings.scope, boardId: this.settings.boardId },
				this.noteOptions(),
				reporter,
			);
			for (const [key, value] of Object.entries(stats)) reporter.count(key, value);
			return `↓ ${stats.pulled} · ↑ ${stats.pushed} · = ${stats.skipped} · ⚠ ${stats.conflicts} · 👻 ${stats.phantoms} · ✕ ${stats.errors}`;
		});
	}

	private async syncOneMapping(): Promise<void> {
		const client = this.ready();
		if (!client) return;
		if (this.settings.mappings.length === 0) {
			new Notice("No list ↔ folder mapping defined in the plugin settings.");
			return;
		}
		new MappingSuggest(this.app, this.settings.mappings, (mapping) => {
			void this.runMapping(client, mapping);
		}).open();
	}

	private async runMapping(client: TrelloClient, mapping: FolderMapping): Promise<void> {
		await this.run(`Sync — ${mapping.folder}`, async (reporter) => {
			const stats = await syncFolder(this.vault, client, mapping, this.folderOptions(), reporter);
			for (const [key, value] of Object.entries(stats)) reporter.count(key, value);
			return `+ ${stats.created} · 🔗 ${stats.adopted} · ↓ ${stats.pulled} · ↑ ${stats.pushed} · 🗑 ${stats.deleted} · ✕ ${stats.errors}`;
		});
	}

	private async syncAllMappings(): Promise<void> {
		const client = this.ready();
		if (!client) return;
		if (this.settings.mappings.length === 0) {
			new Notice("No list ↔ folder mapping defined in the plugin settings.");
			return;
		}

		await this.run("Sync all mappings", async (reporter) => {
			const total = emptyStats();
			for (const mapping of this.settings.mappings) {
				reporter.log("info", `Folder: ${mapping.folder}`);
				const stats = await syncFolder(this.vault, client, mapping, this.folderOptions(), reporter);
				addCounts(total, stats);
			}
			for (const [key, value] of Object.entries(total)) reporter.count(key, value);
			return `${this.settings.mappings.length} folder(s) · + ${total.created} · ↓ ${total.pulled} · ↑ ${total.pushed} · ✕ ${total.errors}`;
		});
	}

	private auditOptions() {
		return {
			scope: this.settings.scope,
			boardId: this.settings.boardId,
			reportPath: this.settings.reportPath,
			timestamp: new Date().toLocaleString("en-CA", { hour12: false }),
		};
	}

	private async runLinkAudit(): Promise<void> {
		const client = this.ready(true);
		if (!client) return;

		await this.run("Link audit", async (reporter) => {
			const result = await auditLinks(this.vault, client, this.auditOptions(), reporter);
			reporter.count("orphanCards", result.orphanCards);
			reporter.count("phantoms", result.phantomNotes);
			reporter.count("unlinkedNotes", result.unlinkedNotes);
			return `${result.orphanCards} card(s) without a note · ${result.phantomNotes} broken link(s) · ${result.unlinkedNotes} unlinked note(s)`;
		});
	}

	private async runLocationAudit(): Promise<void> {
		const client = this.ready(true);
		if (!client) return;

		await this.run("Location audit", async (reporter) => {
			const result = await auditLocations(this.vault, client, this.auditOptions(), reporter);
			reporter.count("comparedNotes", result.rows);
			reporter.count("misplaced", result.misplaced);
			return `${result.rows} note(s) compared · ${result.misplaced} outside their expected list`;
		});
	}
}
