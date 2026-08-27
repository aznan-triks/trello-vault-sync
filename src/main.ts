import { Notice, Plugin, TFile } from "obsidian";
import { auditLinks } from "./features/auditLinks";
import { auditLocations } from "./features/auditLocations";
import { linkActiveNote } from "./features/linkNote";
import { syncFolder, type FolderMapping, type FolderSyncOptions } from "./features/syncFolder";
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
		const suffix = this.settings.dryRun ? " (simulation)" : "";
		return new ProgressPanel({
			title: title + suffix,
			autoCloseMs: this.settings.panelAutoCloseSeconds * 1000,
		});
	}

	private activeNote(): NoteHandle | null {
		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile) || file.extension !== "md") {
			new Notice("Aucune note active.");
			return null;
		}
		return this.vault.noteAt(file.path);
	}

	/** Guard every command behind a configured, usable client. */
	private ready(needsBoard = false): TrelloClient | null {
		const client = this.client();
		if (!client.configured) {
			new Notice("Trello Vault Sync : renseigne la clé et le token dans les réglages.");
			return null;
		}
		if (needsBoard && this.settings.boardId.trim() === "") {
			new Notice("Trello Vault Sync : renseigne l'identifiant du tableau dans les réglages.");
			return null;
		}
		return client;
	}

	/** Run a command body with one panel, one error path and one summary notice. */
	private async run(
		title: string,
		body: (reporter: Reporter) => Promise<string>,
	): Promise<void> {
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
		}
	}

	private registerCommands(): void {
		this.addCommand({
			id: "sync-active-note",
			name: "Synchroniser la note active",
			callback: () => this.syncActive(),
		});

		this.addCommand({
			id: "pull-active-note",
			name: "Importer depuis Trello (note active)",
			callback: () => this.syncActive("pull"),
		});

		this.addCommand({
			id: "push-active-note",
			name: "Envoyer vers Trello (note active)",
			callback: () => this.syncActive("push"),
		});

		this.addCommand({
			id: "link-active-note",
			name: "Associer la note active à une carte",
			callback: () => this.linkActive(),
		});

		this.addCommand({
			id: "sync-vault",
			name: "Synchroniser toutes les notes liées",
			callback: () => this.syncAllLinked(),
		});

		this.addCommand({
			id: "sync-mapping",
			name: "Synchroniser une liste avec son dossier",
			callback: () => this.syncOneMapping(),
		});

		this.addCommand({
			id: "sync-all-mappings",
			name: "Synchroniser toutes les listes avec leurs dossiers",
			callback: () => this.syncAllMappings(),
		});

		this.addCommand({
			id: "audit-links",
			name: "Auditer les liens (cartes et notes orphelines)",
			callback: () => this.runLinkAudit(),
		});

		this.addCommand({
			id: "audit-locations",
			name: "Comparer les emplacements avec les listes Trello",
			callback: () => this.runLocationAudit(),
		});

		this.addCommand({
			id: "toggle-dry-run",
			name: "Basculer le mode simulation",
			callback: async () => {
				this.settings.dryRun = !this.settings.dryRun;
				await this.saveSettings();
				new Notice(`Mode simulation ${this.settings.dryRun ? "activé" : "désactivé"}.`);
			},
		});
	}

	private registerRibbon(): void {
		this.addRibbonIcon("refresh-cw", "Synchroniser la note active", () => this.syncActive());
		this.addRibbonIcon("kanban-square", "Synchroniser toutes les notes liées", () =>
			this.syncAllLinked(),
		);
		this.addRibbonIcon("folder-sync", "Synchroniser une liste avec son dossier", () =>
			this.syncOneMapping(),
		);
		this.addRibbonIcon("search", "Auditer les liens Trello", () => this.runLinkAudit());
	}

	private async syncActive(force?: "pull" | "push"): Promise<void> {
		const client = this.ready();
		const note = this.activeNote();
		if (!client || !note) return;

		await this.run(`Synchro — ${note.basename}`, async (reporter) => {
			reporter.setTotal(1);
			reporter.step(note.basename);
			const result = await syncNote(this.vault, client, note, this.noteOptions(force));
			reporter.log(result.direction === "unlinked" ? "warn" : "info", result.reason);

			switch (result.direction) {
				case "pull":
					return `Importé depuis Trello${result.renamed ? " et renommé" : ""}.`;
				case "push":
					return "Envoyé vers Trello.";
				case "conflict":
					return "Conflit : note et carte modifiées en même temps, rien n'a été écrit.";
				case "unlinked":
					return "Note non liée — utilise « Associer la note active à une carte ».";
				default:
					return "Déjà à jour.";
			}
		});
	}

	private async linkActive(): Promise<void> {
		const client = this.ready(true);
		const note = this.activeNote();
		if (!client || !note) return;

		await this.run(`Association — ${note.basename}`, async () => {
			const result = await linkActiveNote(this.vault, client, note, {
				boardId: this.settings.boardId,
				threshold: this.settings.similarityThreshold,
			});
			if (result.reason === "already-linked") return "Cette note est déjà liée à une carte.";
			if (!result.linked) return "Aucune carte assez proche du titre de la note.";
			return `Liée à « ${result.card?.name} » (${Math.round(result.score * 100)} %).`;
		});
	}

	private async syncAllLinked(): Promise<void> {
		const client = this.ready(true);
		if (!client) return;

		await this.run("Synchro du coffre", async (reporter) => {
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
			new Notice("Aucune correspondance liste ↔ dossier définie dans les réglages.");
			return;
		}
		new MappingSuggest(this.app, this.settings.mappings, (mapping) => {
			void this.runMapping(client, mapping);
		}).open();
	}

	private async runMapping(client: TrelloClient, mapping: FolderMapping): Promise<void> {
		await this.run(`Synchro — ${mapping.folder}`, async (reporter) => {
			const stats = await syncFolder(this.vault, client, mapping, this.folderOptions(), reporter);
			for (const [key, value] of Object.entries(stats)) reporter.count(key, value);
			return `+ ${stats.created} · 🔗 ${stats.adopted} · ↓ ${stats.pulled} · ↑ ${stats.pushed} · 🗑 ${stats.deleted} · ✕ ${stats.errors}`;
		});
	}

	private async syncAllMappings(): Promise<void> {
		const client = this.ready();
		if (!client) return;
		if (this.settings.mappings.length === 0) {
			new Notice("Aucune correspondance liste ↔ dossier définie dans les réglages.");
			return;
		}

		await this.run("Synchro de toutes les listes", async (reporter) => {
			let created = 0;
			let pulled = 0;
			let pushed = 0;
			let errors = 0;
			for (const mapping of this.settings.mappings) {
				reporter.log("info", `Dossier : ${mapping.folder}`);
				const stats = await syncFolder(this.vault, client, mapping, this.folderOptions(), reporter);
				created += stats.created;
				pulled += stats.pulled;
				pushed += stats.pushed;
				errors += stats.errors;
			}
			return `${this.settings.mappings.length} dossier(s) · + ${created} · ↓ ${pulled} · ↑ ${pushed} · ✕ ${errors}`;
		});
	}

	private auditOptions() {
		return {
			scope: this.settings.scope,
			boardId: this.settings.boardId,
			reportPath: this.settings.reportPath,
			timestamp: new Date().toLocaleString("fr-FR"),
		};
	}

	private async runLinkAudit(): Promise<void> {
		const client = this.ready(true);
		if (!client) return;

		await this.run("Audit des liens", async (reporter) => {
			const result = await auditLinks(this.vault, client, this.auditOptions(), reporter);
			reporter.count("orphanCards", result.orphanCards);
			reporter.count("phantoms", result.phantomNotes);
			reporter.count("unlinkedNotes", result.unlinkedNotes);
			return `${result.orphanCards} carte(s) sans note · ${result.phantomNotes} lien(s) brisé(s) · ${result.unlinkedNotes} note(s) non liée(s)`;
		});
	}

	private async runLocationAudit(): Promise<void> {
		const client = this.ready(true);
		if (!client) return;

		await this.run("Comparatif des emplacements", async (reporter) => {
			const result = await auditLocations(this.vault, client, this.auditOptions(), reporter);
			reporter.count("comparedNotes", result.rows);
			reporter.count("misplaced", result.misplaced);
			return `${result.rows} note(s) comparée(s) · ${result.misplaced} hors de la liste attendue`;
		});
	}
}
