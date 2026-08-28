import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import type TrelloVaultSyncPlugin from "../main";
import type { ConflictPolicy } from "../core/syncDecision";

const POLICY_LABELS: Record<ConflictPolicy, string> = {
	"newer-wins": "Newer side wins",
	"prefer-local": "Obsidian always wins",
	"prefer-remote": "Trello always wins",
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
		new Setting(root).setName("Trello connection").setHeading();

		root.createEl("p", {
			cls: "setting-item-description",
			text:
				"A single key/token pair for every command. It is stored in the plugin's own " +
				"settings (data.json) — never copy it into a vault note.",
		});

		new Setting(root)
			.setName("API key")
			.setDesc("https://trello.com/app-key")
			.setClass("tvs-secret")
			.addText((text) =>
				text
					.setPlaceholder("API key")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.save();
					}),
			);

		new Setting(root)
			.setName("Token")
			.setDesc("Personal token generated from the page above.")
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
			.setName("Board id")
			.setDesc("The id that appears in the Trello board's URL.")
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
			.setName("Test connection")
			.setDesc("Checks the key, the token, and access to the board.")
			.addButton((button) =>
				button.setButtonText("Test").onClick(async () => {
					button.setDisabled(true);
					try {
						const lists = await this.plugin.client().getBoardLists(this.plugin.settings.boardId);
						this.listNames = new Map(lists.map((list) => [list.id, list.name]));
						new Notice(`✅ Connected — ${lists.length} list(s) on the board.`);
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
		new Setting(root).setName("Scope").setHeading();

		new Setting(root)
			.setName("Synced folder")
			.setDesc("Restricts the vault-wide commands to this folder. Empty = the whole vault.")
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
			.setName("Report note")
			.setDesc("Path of the note the audits write their report into. It must already exist.")
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
		new Setting(root).setName("Sync behaviour").setHeading();

		new Setting(root)
			.setName("Arbitration")
			.setDesc("Who wins when both the note and the card changed.")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(POLICY_LABELS)) dropdown.addOption(value, label);
				dropdown.setValue(this.plugin.settings.policy).onChange(async (value) => {
					this.plugin.settings.policy = value as ConflictPolicy;
					await this.save();
				});
			});

		new Setting(root)
			.setName("Clock margin (seconds)")
			.setDesc(
				"Below this gap, both sides are considered simultaneous: the divergence is " +
					"reported as a conflict instead of being resolved by a coin flip.",
			)
			.addText((text) =>
				text.setValue(String(this.plugin.settings.marginSeconds)).onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.marginSeconds = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Sync titles")
			.setDesc("Renames the note from the card's title, and vice versa.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncTitle).onChange(async (value) => {
					this.plugin.settings.syncTitle = value;
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Dry run")
			.setDesc("Computes and shows everything that would be done, without writing anything.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.dryRun).onChange(async (value) => {
					this.plugin.settings.dryRun = value;
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Create missing notes")
			.setDesc("Creates a note for every card with no local match, during a list sync.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.allowCreate).onChange(async (value) => {
					this.plugin.settings.allowCreate = value;
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Delete orphan notes")
			.setDesc(
				"⚠️ Destructive: trashes the note whose card left the list. Off by default — " +
					"such notes are simply reported.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.allowDelete).onChange(async (value) => {
					this.plugin.settings.allowDelete = value;
					await this.save();
				}),
			);
	}

	private renderMappings(root: HTMLElement): void {
		new Setting(root).setName("Trello list ↔ folder").setHeading();

		root.createEl("p", {
			cls: "setting-item-description",
			text:
				"Each row pairs a board list with a vault folder, and the note template used for " +
				"creations. Replaces the dedicated per-folder scripts.",
		});

		this.plugin.settings.mappings.forEach((mapping, index) => {
			const row = root.createDiv({ cls: "tvs-mapping" });

			new Setting(row)
				.setName(`Mapping ${index + 1}`)
				.addExtraButton((button) =>
					button
						.setIcon("trash")
						.setTooltip("Remove")
						.onClick(async () => {
							this.plugin.settings.mappings.splice(index, 1);
							await this.save();
							this.display();
						}),
				);

			new Setting(row).setName("Trello list").addText((text) =>
				text
					.setPlaceholder(this.listNames.get(mapping.listId) ?? "idList")
					.setValue(mapping.listId)
					.onChange(async (value) => {
						mapping.listId = value.trim();
						await this.save();
					}),
			);

			new Setting(row).setName("Folder").addText((text) =>
				text
					.setPlaceholder("WoT/85_Idées")
					.setValue(mapping.folder)
					.onChange(async (value) => {
						mapping.folder = value.trim().replace(/\/$/, "");
						await this.save();
					}),
			);

			new Setting(row).setName("Note template").addText((text) =>
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
				.setButtonText("Add a mapping")
				.setCta()
				.onClick(async () => {
					this.plugin.settings.mappings.push({ listId: "", folder: "", templateName: "" });
					await this.save();
					this.display();
				}),
		);
	}

	private renderAdvanced(root: HTMLElement): void {
		new Setting(root).setName("Advanced").setHeading();

		new Setting(root)
			.setName("Similarity threshold")
			.setDesc("Minimum score (0 to 1) to automatically match a note to a card.")
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
			.setName("Retries")
			.setDesc("Number of retries after a 429 response or a server error.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.maxRetries)).onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.maxRetries = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Initial delay (ms)")
			.setDesc("Wait before the first retry; it doubles on every subsequent attempt.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.baseDelayMs)).onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.baseDelayMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Show the progress panel")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showPanel).onChange(async (value) => {
					this.plugin.settings.showPanel = value;
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Auto-close (seconds)")
			.setDesc("0 keeps the panel open until closed manually.")
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
