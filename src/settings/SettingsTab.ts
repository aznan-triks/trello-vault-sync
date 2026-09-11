import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import type TrelloVaultSyncPlugin from "../main";
import { ALL_SECTIONS, COMMANDS } from "../commands/registry";
import { DEFAULT_CARD_REF_KEY } from "../core/cardRef";
import { DEFAULT_DUE_KEY } from "../core/dueRef";
import { errorMessage } from "../core/errorMessage";
import { DEFAULT_LABELS_KEY } from "../core/labelRef";
import type { LabelSyncMode } from "../core/labelMerge";
import type { ConflictPolicy } from "../core/syncDecision";
import { TrelloPickerSuggest } from "../ui/TrelloPickerSuggest";
import { VaultPathSuggest } from "../ui/VaultPathSuggest";
import {
	BASE_DELAY_MS_CEILING,
	MAX_RETRIES_CEILING,
	REQUEST_TIMEOUT_MS_CEILING,
	normalizeVaultPath,
	safeFrontmatterKey,
	safeNonNegativeNumber,
} from "./types";

const POLICY_LABELS: Record<ConflictPolicy, string> = {
	"newer-wins": "Newer side wins",
	"prefer-local": "Obsidian always wins",
	"prefer-remote": "Trello always wins",
};

const LABELS_SYNC_MODE_LABELS: Record<LabelSyncMode, string> = {
	merge: "Merge (never lose a label)",
	overwrite: "Overwrite (same rule as arbitration above)",
};

export class TrelloVaultSyncSettingsTab extends PluginSettingTab {
	private listNames = new Map<string, string>();
	private boardName: string | null = null;

	constructor(
		app: App,
		private readonly plugin: TrelloVaultSyncPlugin,
	) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.addClass("tvs-settings");
		// Every action that changes a setting (picking a board/list, adding or
		// removing a mapping, testing the connection) rebuilds the whole tab from
		// scratch, which would otherwise reset the scroll position to the top —
		// jarring once there are enough mappings to scroll at all.
		const scrollTop = containerEl.scrollTop;
		containerEl.empty();

		this.renderCredentials(containerEl);
		this.renderScope(containerEl);
		this.renderBehaviour(containerEl);
		this.renderMappings(containerEl);
		this.renderRibbon(containerEl);
		this.renderAdvanced(containerEl);

		containerEl.scrollTop = scrollTop;
	}

	private save(): Promise<void> {
		return this.plugin.saveSettings();
	}

	private folderCandidates(): string[] {
		return this.app.vault.getAllFolders(false).map((folder) => folder.path);
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
			.setDesc(
				createFragment((el) => {
					el.createEl("a", {
						text: "https://trello.com/app-key",
						href: "https://trello.com/app-key",
						attr: { target: "_blank", rel: "noopener" },
					});
				}),
			)
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
			.setDesc(
				this.boardName
					? `→ ${this.boardName}`
					: "The id that appears in the Trello board's URL. Start typing to see your boards by name.",
			)
			.addText((text) => {
				text
					.setPlaceholder("idBoard")
					.setValue(this.plugin.settings.boardId)
					.onChange(async (value) => {
						this.plugin.settings.boardId = value.trim();
						this.boardName = null;
						await this.save();
					});
				new TrelloPickerSuggest(
					this.app,
					text.inputEl,
					() => this.plugin.client().getMyBoards(),
					async (board) => {
						this.plugin.settings.boardId = board.id;
						this.boardName = board.name;
						await this.save();
						this.display();
					},
				);
			});

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
						new Notice(`❌ ${errorMessage(error)}`);
						console.error("[trello-vault-sync]", error);
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
			.addText((text) => {
				text
					.setPlaceholder("Projects")
					.setValue(this.plugin.settings.scope)
					.onChange(async (value) => {
						this.plugin.settings.scope = normalizeVaultPath(value.trim());
						await this.save();
					});
				new VaultPathSuggest(this.app, text.inputEl, () => this.folderCandidates());
			});

		new Setting(root)
			.setName("Excluded folders")
			.setDesc(
				"Folders skipped by vault-wide sync and audits — even a linked note under one of them is left alone.",
			);

		this.plugin.settings.excludedFolders.forEach((folder, index) => {
			new Setting(root)
				.setClass("tvs-mapping")
				.addText((text) => {
					text
						.setPlaceholder("Archive")
						.setValue(folder)
						.onChange(async (value) => {
							this.plugin.settings.excludedFolders[index] = normalizeVaultPath(value.trim());
							await this.save();
						});
					new VaultPathSuggest(this.app, text.inputEl, () => this.folderCandidates());
				})
				.addExtraButton((button) =>
					button
						.setIcon("trash")
						.setTooltip("Remove")
						.onClick(async () => {
							this.plugin.settings.excludedFolders.splice(index, 1);
							await this.save();
							this.display();
						}),
				);
		});

		new Setting(root).addButton((button) =>
			button
				.setButtonText("Add a folder")
				.setCta()
				.onClick(async () => {
					this.plugin.settings.excludedFolders.push("");
					await this.save();
					this.display();
				}),
		);

		new Setting(root)
			.setName("Report note")
			.setDesc("Path of the note the audits write their report into. It must already exist.")
			.addText((text) => {
				text
					.setPlaceholder("Projects/Trello Sync Report.md")
					.setValue(this.plugin.settings.reportPath)
					.onChange(async (value) => {
						this.plugin.settings.reportPath = normalizeVaultPath(value.trim());
						await this.save();
					});
				new VaultPathSuggest(this.app, text.inputEl, () =>
					this.app.vault.getMarkdownFiles().map((file) => file.path),
				);
			});

		new Setting(root)
			.setName("Change log HTML page")
			.setDesc(
				'Path of the standalone HTML page "Export change log as HTML" writes into — ' +
					"created if missing, overwritten if it already exists.",
			)
			.addText((text) => {
				text
					.setPlaceholder("Projects/Trello Changes.html")
					.setValue(this.plugin.settings.changesHtmlPath)
					.onChange(async (value) => {
						this.plugin.settings.changesHtmlPath = normalizeVaultPath(value.trim());
						await this.save();
					});
				// Suggests folders, not `reportPath`'s markdown-file list above — this page
				// is machine-generated and usually doesn't exist yet on first setup.
				new VaultPathSuggest(this.app, text.inputEl, () => this.folderCandidates());
			});
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
			.setName("Labels sync")
			.setDesc("How the note's labels (Labels key, below) and the card's assigned labels reconcile when they diverge.")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(LABELS_SYNC_MODE_LABELS)) dropdown.addOption(value, label);
				dropdown.setValue(this.plugin.settings.labelsSyncMode).onChange(async (value) => {
					this.plugin.settings.labelsSyncMode = value as LabelSyncMode;
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
			.setName("Delete phantom notes")
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

			const resolvedName = this.listNames.get(mapping.listId);
			new Setting(row)
				.setName("Trello list")
				.setDesc(
					resolvedName
						? `→ ${resolvedName}`
						: "Paste the list id from the Trello board URL. Start typing to see this board's lists by name.",
				)
				.addText((text) => {
					text
						.setPlaceholder("idList")
						.setValue(mapping.listId)
						.onChange(async (value) => {
							mapping.listId = value.trim();
							await this.save();
						});
					new TrelloPickerSuggest(
						this.app,
						text.inputEl,
						async () => {
							if (this.plugin.settings.boardId.trim() === "") {
								throw new Error("Set the board id above first.");
							}
							const lists = await this.plugin.client().getBoardLists(this.plugin.settings.boardId);
							this.listNames = new Map(lists.map((list) => [list.id, list.name]));
							return lists;
						},
						async (list) => {
							mapping.listId = list.id;
							await this.save();
							this.display();
						},
					);
				});

			new Setting(row)
				.setName("Folder")
				.setDesc("Vault folder synced with this Trello list.")
				.addText((text) => {
					text
						.setPlaceholder("Projects/Ideas")
						.setValue(mapping.folder)
						.onChange(async (value) => {
							mapping.folder = normalizeVaultPath(value.trim());
							await this.save();
						});
					new VaultPathSuggest(this.app, text.inputEl, () => this.folderCandidates());
				});

			new Setting(row)
				.setName("Note template")
				.setDesc("Note used as the template for new notes created from this list; empty = a plain description.")
				.addText((text) => {
					text
						.setPlaceholder("Trello Card")
						.setValue(mapping.templateName)
						.onChange(async (value) => {
							mapping.templateName = value.trim();
							await this.save();
						});
					new VaultPathSuggest(this.app, text.inputEl, () =>
						this.app.vault.getMarkdownFiles().map((file) => file.basename),
					);
				});
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

	private renderRibbon(root: HTMLElement): void {
		new Setting(root).setName("Ribbon icons").setHeading();
		new Setting(root).setDesc("Choose which commands get a button in Obsidian's left ribbon.");

		for (const section of ALL_SECTIONS) {
			for (const command of COMMANDS.filter((c) => c.section === section)) {
				new Setting(root).setName(command.name).addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.ribbonCommandIds.includes(command.id))
						.onChange(async (value) => {
							const ids = this.plugin.settings.ribbonCommandIds;
							this.plugin.settings.ribbonCommandIds = value
								? [...ids, command.id]
								: ids.filter((id) => id !== command.id);
							await this.save();
						}),
				);
			}
		}
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
					this.plugin.settings.maxRetries = safeNonNegativeNumber(parsed, 0, MAX_RETRIES_CEILING);
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Initial delay (ms)")
			.setDesc("Wait before the first retry; it doubles on every subsequent attempt.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.baseDelayMs)).onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.baseDelayMs = safeNonNegativeNumber(parsed, 0, BASE_DELAY_MS_CEILING);
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Request timeout (ms)")
			.setDesc("How long to wait for a single Trello response before treating it as a failed attempt.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.requestTimeoutMs)).onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.requestTimeoutMs = safeNonNegativeNumber(
						parsed,
						0,
						REQUEST_TIMEOUT_MS_CEILING,
					);
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Show the progress panel")
			.setDesc("Floating panel with live progress while a sync runs. Off: the sync still runs, just silently.")
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

		new Setting(root).setName("Frontmatter keys").setHeading();

		new Setting(root)
			.setName("Due date key")
			.setDesc("Frontmatter property that carries the card's due date.")
			.addText((text) =>
				text.setValue(this.plugin.settings.dueFrontmatterKey).onChange(async (value) => {
					this.plugin.settings.dueFrontmatterKey = safeFrontmatterKey(value, DEFAULT_DUE_KEY);
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Labels key")
			.setDesc("Frontmatter property that carries the card's labels.")
			.addText((text) =>
				text.setValue(this.plugin.settings.labelsFrontmatterKey).onChange(async (value) => {
					this.plugin.settings.labelsFrontmatterKey = safeFrontmatterKey(value, DEFAULT_LABELS_KEY);
					await this.save();
				}),
			);

		new Setting(root)
			.setName("Card link key")
			.setDesc(
				"Frontmatter property that links a note to its card — every command depends on it. " +
					"⚠️ Changing this on a vault that already has linked notes orphans every one of them " +
					"until their frontmatter is updated to the new key too.",
			)
			.addText((text) =>
				text.setValue(this.plugin.settings.cardRefFrontmatterKey).onChange(async (value) => {
					this.plugin.settings.cardRefFrontmatterKey = safeFrontmatterKey(value, DEFAULT_CARD_REF_KEY);
					await this.save();
				}),
			);
	}
}
