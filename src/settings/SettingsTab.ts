import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import type TrelloVaultSyncPlugin from "../main";
import type { ConflictPolicy } from "../core/syncDecision";

const POLICY_LABELS: Record<ConflictPolicy, string> = {
	"newer-wins": "Le plus récent gagne",
	"prefer-local": "Obsidian gagne toujours",
	"prefer-remote": "Trello gagne toujours",
};

export class TrelloVaultSyncSettingsTab extends PluginSettingTab {
	private listNames = new Map<string, string>();

	constructor(
		app: App,
		private readonly plugin: TrelloVaultSyncPlugin,
	) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderCredentials(containerEl);
		this.renderScope(containerEl);
		this.renderBehaviour(containerEl);
		this.renderMappings(containerEl);
		this.renderAdvanced(containerEl);
	}

	private save(): Promise<void> {
		return this.plugin.saveSettings();
	}

	private renderCredentials(root: HTMLElement): void {
		new Setting(root).setName("Connexion Trello").setHeading();

		root.createEl("p", {
			cls: "setting-item-description",
			text:
				"Une seule paire clé/token pour toutes les commandes. Elle est stockée dans les " +
				"réglages du plugin (data.json) — ne la recopie jamais dans une note du coffre.",
		});

		new Setting(root)
			.setName("Clé d'API")
			.setDesc("https://trello.com/app-key")
			.setClass("tvs-secret")
			.addText((text) =>
				text
					.setPlaceholder("clé d'API")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.save();
					}),
			);

		new Setting(root)
			.setName("Token")
			.setDesc("Jeton personnel généré depuis la page ci-dessus.")
			.setClass("tvs-secret")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("token")
					.setValue(this.plugin.settings.token)
					.onChange(async (value) => {
						this.plugin.settings.token = value.trim();
						await this.save();
					});
			});

		new Setting(root)
			.setName("Identifiant du tableau")
			.setDesc("L'id qui apparaît dans l'URL du tableau Trello.")
			.addText((text) =>
				text
					.setPlaceholder("idBoard")
					.setValue(this.plugin.settings.boardId)
					.onChange(async (value) => {
						this.plugin.settings.boardId = value.trim();
						await this.save();
					}),
			);

		new Setting(root)
			.setName("Tester la connexion")
			.setDesc("Vérifie la clé, le token et l'accès au tableau.")
			.addButton((button) =>
				button.setButtonText("Tester").onClick(async () => {
					button.setDisabled(true);
					try {
						const lists = await this.plugin.client().getBoardLists(this.plugin.settings.boardId);
						this.listNames = new Map(lists.map((list) => [list.id, list.name]));
						new Notice(`✅ Connexion OK — ${lists.length} liste(s) sur le tableau.`);
						this.display();
					} catch (error) {
						new Notice(`❌ ${(error as Error).message}`);
					} finally {
						button.setDisabled(false);
					}
				}),
			);
	}

	private renderScope(root: HTMLElement): void {
		new Setting(root).setName("Périmètre").setHeading();

		new Setting(root)
			.setName("Dossier synchronisé")
			.setDesc("Limite les commandes globales à ce dossier. Vide = tout le coffre.")
			.addText((text) =>
				text
					.setPlaceholder("WoT")
					.setValue(this.plugin.settings.scope)
					.onChange(async (value) => {
						this.plugin.settings.scope = value.trim().replace(/\/$/, "");
						await this.save();
					}),
			);

		new Setting(root)
			.setName("Note de rapport")
			.setDesc("Chemin de la note où les audits écrivent leur rapport. Elle doit exister.")
			.addText((text) =>
				text
					.setPlaceholder("WoT/00_Metatrois (Gestion)/Synchro.md")
					.setValue(this.plugin.settings.reportPath)
					.onChange(async (value) => {
						this.plugin.settings.reportPath = value.trim();
						await this.save();
					}),
			);
	}

	private renderBehaviour(root: HTMLElement): void {
		new Setting(root).setName("Comportement de synchronisation").setHeading();

		new Setting(root)
			.setName("Arbitrage")
			.setDesc("Qui gagne quand la note et la carte ont toutes deux changé.")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(POLICY_LABELS)) dropdown.addOption(value, label);
				dropdown.setValue(this.plugin.settings.policy).onChange(async (value) => {
					this.plugin.settings.policy = value as ConflictPolicy;
					await this.save();
				});
			});

		new Setting(root)
			.setName("Marge d'horloge (secondes)")
			.setDesc(
				"En dessous de cet écart, les deux côtés sont considérés simultanés : la divergence " +
					"est signalée comme conflit au lieu d'être tranchée au hasard.",
			)
			.addText((text) =>
				text.setValue(String(this.plugin.settings.marginSeconds)).onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.marginSeconds = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Synchroniser les titres")
			.setDesc("Renomme la note d'après la carte, et inversement.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncTitle).onChange(async (value) => {
					this.plugin.settings.syncTitle = value;
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Mode simulation")
			.setDesc("Calcule et affiche tout ce qui serait fait, sans rien écrire nulle part.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.dryRun).onChange(async (value) => {
					this.plugin.settings.dryRun = value;
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Créer les notes manquantes")
			.setDesc("Crée une note pour chaque carte sans équivalent local, lors d'une synchro de liste.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.allowCreate).onChange(async (value) => {
					this.plugin.settings.allowCreate = value;
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Supprimer les notes orphelines")
			.setDesc(
				"⚠️ Destructif : met à la corbeille la note dont la carte a quitté la liste. " +
					"Désactivé par défaut — les notes sont simplement signalées.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.allowDelete).onChange(async (value) => {
					this.plugin.settings.allowDelete = value;
					await this.save();
				}),
			);
	}

	private renderMappings(root: HTMLElement): void {
		new Setting(root).setName("Liste Trello ↔ dossier").setHeading();

		root.createEl("p", {
			cls: "setting-item-description",
			text:
				"Chaque ligne relie une liste du tableau à un dossier du coffre, avec le modèle de note " +
				"utilisé pour les créations. Remplace les scripts dédiés par dossier.",
		});

		this.plugin.settings.mappings.forEach((mapping, index) => {
			const row = root.createDiv({ cls: "tvs-mapping" });

			new Setting(row)
				.setName(`Correspondance ${index + 1}`)
				.addExtraButton((button) =>
					button
						.setIcon("trash")
						.setTooltip("Supprimer")
						.onClick(async () => {
							this.plugin.settings.mappings.splice(index, 1);
							await this.save();
							this.display();
						}),
				);

			new Setting(row).setName("Liste Trello").addText((text) =>
				text
					.setPlaceholder(this.listNames.get(mapping.listId) ?? "idList")
					.setValue(mapping.listId)
					.onChange(async (value) => {
						mapping.listId = value.trim();
						await this.save();
					}),
			);

			new Setting(row).setName("Dossier").addText((text) =>
				text
					.setPlaceholder("WoT/85_Idées")
					.setValue(mapping.folder)
					.onChange(async (value) => {
						mapping.folder = value.trim().replace(/\/$/, "");
						await this.save();
					}),
			);

			new Setting(row).setName("Modèle de note").addText((text) =>
				text
					.setPlaceholder("idée (script)")
					.setValue(mapping.templateName)
					.onChange(async (value) => {
						mapping.templateName = value.trim();
						await this.save();
					}),
			);
		});

		new Setting(root).addButton((button) =>
			button
				.setButtonText("Ajouter une correspondance")
				.setCta()
				.onClick(async () => {
					this.plugin.settings.mappings.push({ listId: "", folder: "", templateName: "" });
					await this.save();
					this.display();
				}),
		);
	}

	private renderAdvanced(root: HTMLElement): void {
		new Setting(root).setName("Avancé").setHeading();

		new Setting(root)
			.setName("Seuil de ressemblance")
			.setDesc("Score minimal (0 à 1) pour associer automatiquement une note à une carte.")
			.addSlider((slider) =>
				slider
					.setLimits(0.1, 1, 0.05)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.similarityThreshold)
					.onChange(async (value) => {
						this.plugin.settings.similarityThreshold = value;
						await this.save();
					}),
			);

		new Setting(root)
			.setName("Nouvelles tentatives")
			.setDesc("Nombre de réessais après une réponse 429 ou une erreur serveur.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.maxRetries)).onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.maxRetries = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Délai initial (ms)")
			.setDesc("Attente avant le premier réessai ; elle double à chaque tentative.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.baseDelayMs)).onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.baseDelayMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Afficher le panneau de progression")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showPanel).onChange(async (value) => {
					this.plugin.settings.showPanel = value;
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Fermeture automatique (secondes)")
			.setDesc("0 pour garder le panneau ouvert jusqu'à fermeture manuelle.")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.panelAutoCloseSeconds))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						this.plugin.settings.panelAutoCloseSeconds =
							Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
						await this.save();
					}),
			);
	}
}
