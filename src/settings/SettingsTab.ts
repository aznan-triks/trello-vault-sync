import { Notice, PluginSettingTab, Setting, type App, type ButtonComponent } from "obsidian";
import type TrelloVaultSyncPlugin from "../main";
import { ALL_SECTIONS, COMMANDS } from "../commands/registry";
import { DEFAULT_ATTACHMENTS_KEY, DEFAULT_COVER_KEY, DEFAULT_LINKED_CARDS_KEY } from "../core/attachmentRef";
import { DEFAULT_CARD_REF_KEY } from "../core/cardRef";
import { DEFAULT_CHECKLIST_HEADING } from "../core/checklistRef";
import { DEFAULT_DUE_KEY } from "../core/dueRef";
import { errorMessage } from "../core/errorMessage";
import { DEFAULT_LABELS_KEY } from "../core/labelRef";
import type { LabelSyncMode } from "../core/labelMerge";
import type { AutoSyncScope, AutoSyncTrigger } from "../core/autoSyncSchedule";
import type { ConflictPolicy } from "../core/syncDecision";
import { TrelloPickerSuggest, type IdName } from "../ui/TrelloPickerSuggest";
import { VaultPathSuggest } from "../ui/VaultPathSuggest";
import {
	AUTO_SYNC_INTERVAL_MINUTES_CEILING,
	AUTO_SYNC_MIN_IDLE_SECONDS_CEILING,
	BASE_DELAY_MS_CEILING,
	HISTORY_MAX_RUNS_CEILING,
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

const AUTO_SYNC_TRIGGER_LABELS: Record<AutoSyncTrigger, string> = {
	interval: "On a timer",
	focus: "When Obsidian regains focus",
	both: "Both",
};

const AUTO_SYNC_SCOPE_LABELS: Record<AutoSyncScope, string> = {
	mappings: "Every mapped folder (\"Sync every list with its folder\")",
	vault: "The whole vault (\"Sync all linked notes\")",
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
		this.renderAutoSync(containerEl);
		this.renderMappings(containerEl);
		this.renderRibbon(containerEl);
		this.renderAdvanced(containerEl);

		containerEl.scrollTop = scrollTop;
	}

	private save(): Promise<void> {
		return this.plugin.saveSettings();
	}

	/**
	 * The picker's callback is synchronous by contract (`onPick: (item) => void`),
	 * so the write is fired and forgotten here rather than returning a promise the
	 * suggester would drop — same shape as `void runMapping(...)` in the commands layer.
	 */
	private applyPickedBoard(board: IdName): void {
		this.plugin.settings.boardId = board.id;
		this.boardName = board.name;
		void this.save();
		this.display();
	}

	private applyPickedList(mapping: { listId: string }, list: IdName): void {
		mapping.listId = list.id;
		void this.save();
		this.display();
	}

	/** `onClick` expects a synchronous handler, so the round trip lives here and is fired with `void`. */
	private async testConnection(button: ButtonComponent): Promise<void> {
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
					.onChange((value) => {
						this.plugin.settings.apiKey = value.trim();
						void this.save();
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
					.onChange((value) => {
						this.plugin.settings.token = value.trim();
						void this.save();
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
					.onChange((value) => {
						this.plugin.settings.boardId = value.trim();
						this.boardName = null;
						void this.save();
					});
				new TrelloPickerSuggest(
					this.app,
					text.inputEl,
					() => this.plugin.client().getMyBoards(),
					(board) => {
						this.applyPickedBoard(board);
					},
				);
			});

		new Setting(root)
			.setName("Test connection")
			.setDesc("Checks the key, the token, and access to the board.")
			.addButton((button) =>
				button.setButtonText("Test").onClick(() => {
					void this.testConnection(button);
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
					.onChange((value) => {
						this.plugin.settings.scope = normalizeVaultPath(value.trim());
						void this.save();
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
						.onChange((value) => {
							this.plugin.settings.excludedFolders[index] = normalizeVaultPath(value.trim());
							void this.save();
						});
					new VaultPathSuggest(this.app, text.inputEl, () => this.folderCandidates());
				})
				.addExtraButton((button) =>
					button
						.setIcon("trash")
						.setTooltip("Remove")
						.onClick(() => {
							this.plugin.settings.excludedFolders.splice(index, 1);
							void this.save();
							this.display();
						}),
				);
		});

		new Setting(root).addButton((button) =>
			button
				.setButtonText("Add a folder")
				.setCta()
				.onClick(() => {
					this.plugin.settings.excludedFolders.push("");
					void this.save();
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
					.onChange((value) => {
						this.plugin.settings.reportPath = normalizeVaultPath(value.trim());
						void this.save();
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
					.onChange((value) => {
						this.plugin.settings.changesHtmlPath = normalizeVaultPath(value.trim());
						void this.save();
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
				dropdown.setValue(this.plugin.settings.policy).onChange((value) => {
					this.plugin.settings.policy = value as ConflictPolicy;
					void this.save();
				});
			});

		new Setting(root)
			.setName("Labels sync")
			.setDesc("How the note's labels (Labels key, below) and the card's assigned labels reconcile when they diverge.")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(LABELS_SYNC_MODE_LABELS)) dropdown.addOption(value, label);
				dropdown.setValue(this.plugin.settings.labelsSyncMode).onChange((value) => {
					this.plugin.settings.labelsSyncMode = value as LabelSyncMode;
					void this.save();
				});
			});

		new Setting(root)
			.setName("Sync attachments")
			.setDesc(
				"Pulls the card's attachments into the note's frontmatter (Attachments key/Linked cards key, " +
					"below) — a plain url in one, a wikilink to the linked card's own note (or a placeholder " +
					"by name) in the other. Pull-only. Costs one extra Trello request per note synced.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncAttachments).onChange((value) => {
					this.plugin.settings.syncAttachments = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Sync checklists")
			.setDesc(
				"Mirrors the card's checklists as Markdown tasks under the checklist section (Checklist section " +
					"heading, below), always the last thing in the note. Checking a box in Obsidian pushes that " +
					"state to Trello even when nothing else changed; which items/checklists exist always follows " +
					"Trello — an item typed by hand with no match on the card is dropped, never created there. " +
					"Costs one extra Trello request per note synced.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncChecklists).onChange((value) => {
					this.plugin.settings.syncChecklists = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Checklist section heading")
			.setDesc(
				"The exact line marking where the checklist section starts in a note's body — must be the last " +
					"thing in the body. ⚠️ The section under this heading is rebuilt from Trello on every sync; " +
					"changing this key doesn't move an existing section written under the old heading.",
			)
			.addText((text) =>
				text.setValue(this.plugin.settings.checklistHeading).onChange((value) => {
					this.plugin.settings.checklistHeading = safeFrontmatterKey(value, DEFAULT_CHECKLIST_HEADING);
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Sync card cover")
			.setDesc(
				"Writes the card's cover image url into the note's frontmatter (Cover key, below) — readable by " +
					"Pixelbanner or any other banner plugin that reads the same key. Pull-only, no extra Trello request.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncCardCover).onChange((value) => {
					this.plugin.settings.syncCardCover = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Cover key")
			.setDesc('The frontmatter key holding the cover image url — "banner" is what Pixelbanner itself reads.')
			.addText((text) =>
				text.setValue(this.plugin.settings.coverFrontmatterKey).onChange((value) => {
					this.plugin.settings.coverFrontmatterKey = safeFrontmatterKey(value, DEFAULT_COVER_KEY);
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Download attachments")
			.setDesc(
				"⚠️ Writes binary files into the vault: downloads each uploaded (non-link) attachment to the " +
					"chosen destination below. Off by default. An attachment already present under the same name " +
					"and byte size is never re-downloaded.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.downloadAttachments).onChange((value) => {
					this.plugin.settings.downloadAttachments = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Attachment download destination")
			.setDesc("Where a downloaded attachment is written.")
			.addDropdown((dropdown) => {
				dropdown.addOption("note-folder", "Same folder as the note");
				dropdown.addOption("global-folder", "One shared folder (below)");
				dropdown.setValue(this.plugin.settings.attachmentsDestination).onChange((value) => {
					this.plugin.settings.attachmentsDestination = value === "global-folder" ? "global-folder" : "note-folder";
					void this.save();
				});
			});

		new Setting(root)
			.setName("Attachment download folder")
			.setDesc('Used only when the destination above is "One shared folder". Required in that mode.')
			.addText((text) => {
				text
					.setPlaceholder("Attachments")
					.setValue(this.plugin.settings.attachmentsFolder)
					.onChange((value) => {
						this.plugin.settings.attachmentsFolder = normalizeVaultPath(value.trim());
						void this.save();
					});
				new VaultPathSuggest(this.app, text.inputEl, () => this.folderCandidates());
			});

		new Setting(root)
			.setName("Clock margin (seconds)")
			.setDesc(
				"Below this gap, both sides are considered simultaneous: the divergence is " +
					"reported as a conflict instead of being resolved by a coin flip.",
			)
			.addText((text) =>
				text.setValue(String(this.plugin.settings.marginSeconds)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.marginSeconds = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Sync titles")
			.setDesc("Renames the note from the card's title, and vice versa.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncTitle).onChange((value) => {
					this.plugin.settings.syncTitle = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Dry run")
			.setDesc("Computes and shows everything that would be done, without writing anything.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.dryRun).onChange((value) => {
					this.plugin.settings.dryRun = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Create missing notes")
			.setDesc("Creates a note for every card with no local match, during a list sync.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.allowCreate).onChange((value) => {
					this.plugin.settings.allowCreate = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Delete phantom notes")
			.setDesc(
				"⚠️ Destructive: trashes the note whose card left the list. Off by default — " +
					"such notes are simply reported.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.allowDelete).onChange((value) => {
					this.plugin.settings.allowDelete = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Confirm before a forced sync")
			.setDesc(
				"Shows a confirmation dialog before a force pull/push at folder or vault scope (destructive by " +
					"nature: it overwrites the older side even when nothing else changed). Off for repeated use.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.confirmForceSync).onChange((value) => {
					this.plugin.settings.confirmForceSync = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Orphan card fallback folder")
			.setDesc(
				'Destination for "Create note from a Trello card" when the card\'s list isn\'t mapped to a folder — ' +
					"used directly, no prompt. Leave empty to be asked for a folder each time instead.",
			)
			.addText((text) => {
				text
					.setPlaceholder("Projects")
					.setValue(this.plugin.settings.orphanCardFolder)
					.onChange((value) => {
						this.plugin.settings.orphanCardFolder = normalizeVaultPath(value.trim());
						void this.save();
					});
				new VaultPathSuggest(this.app, text.inputEl, () => this.folderCandidates());
			});

		new Setting(root)
			.setName("Sync history")
			.setDesc(
				"Records every vault write a sync makes, so it can be undone from \"Undo last sync run\" / " +
					"\"Undo last sync for the active note\". Skips a note that changed since the run instead of " +
					"overwriting it.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.historyEnabled).onChange((value) => {
					this.plugin.settings.historyEnabled = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Sync history — runs kept")
			.setDesc("Oldest run is dropped once this many are recorded.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.historyMaxRuns)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.historyMaxRuns = safeNonNegativeNumber(parsed, 0, HISTORY_MAX_RUNS_CEILING);
					void this.save();
				}),
			);
	}

	private renderAutoSync(root: HTMLElement): void {
		new Setting(root).setName("Auto-sync").setHeading();

		new Setting(root)
			.setName("Enable auto-sync")
			.setDesc(
				"⚠️ Runs a sync without you clicking anything. Off by default. Respects Dry run, Create missing " +
					"notes, Delete phantom notes and Excluded folders exactly like a manual sync would.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncEnabled).onChange((value) => {
					this.plugin.settings.autoSyncEnabled = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Trigger")
			.setDesc("What starts an auto-sync.")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(AUTO_SYNC_TRIGGER_LABELS)) dropdown.addOption(value, label);
				dropdown.setValue(this.plugin.settings.autoSyncTrigger).onChange((value) => {
					this.plugin.settings.autoSyncTrigger = value as AutoSyncTrigger;
					void this.save();
				});
			});

		new Setting(root)
			.setName("Interval (minutes)")
			.setDesc('How often "On a timer" checks whether it\'s time to sync.')
			.addText((text) =>
				text.setValue(String(this.plugin.settings.autoSyncIntervalMinutes)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.autoSyncIntervalMinutes = safeNonNegativeNumber(
						parsed,
						0,
						AUTO_SYNC_INTERVAL_MINUTES_CEILING,
					);
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Scope")
			.setDesc("What an auto-sync runs.")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(AUTO_SYNC_SCOPE_LABELS)) dropdown.addOption(value, label);
				dropdown.setValue(this.plugin.settings.autoSyncScope).onChange((value) => {
					this.plugin.settings.autoSyncScope = value as AutoSyncScope;
					void this.save();
				});
			});

		new Setting(root)
			.setName("Minimum gap between auto-syncs (seconds)")
			.setDesc(
				"However it was triggered, an auto-sync never starts less than this long after the previous one.",
			)
			.addText((text) =>
				text.setValue(String(this.plugin.settings.autoSyncMinIdleSeconds)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.autoSyncMinIdleSeconds = safeNonNegativeNumber(
						parsed,
						0,
						AUTO_SYNC_MIN_IDLE_SECONDS_CEILING,
					);
					void this.save();
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
						.onClick(() => {
							this.plugin.settings.mappings.splice(index, 1);
							void this.save();
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
						.onChange((value) => {
							mapping.listId = value.trim();
							void this.save();
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
						(list) => {
							this.applyPickedList(mapping, list);
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
						.onChange((value) => {
							mapping.folder = normalizeVaultPath(value.trim());
							void this.save();
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
						.onChange((value) => {
							mapping.templateName = value.trim();
							void this.save();
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
				.onClick(() => {
					this.plugin.settings.mappings.push({ listId: "", folder: "", templateName: "" });
					void this.save();
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
						.onChange((value) => {
							const ids = this.plugin.settings.ribbonCommandIds;
							this.plugin.settings.ribbonCommandIds = value
								? [...ids, command.id]
								: ids.filter((id) => id !== command.id);
							void this.save();
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
					// Deprecated from Obsidian 1.13 on (the value shows inline there), but this
					// tab renders imperatively for 1.7-1.12 too, where it is the only way to see
					// the value while dragging. Remove it with `display()`, never before.
					.setDynamicTooltip()
					.setValue(this.plugin.settings.similarityThreshold)
					.onChange((value) => {
						this.plugin.settings.similarityThreshold = value;
						void this.save();
					}),
			);

		new Setting(root)
			.setName("Retries")
			.setDesc("Number of retries after a 429 response or a server error.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.maxRetries)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.maxRetries = safeNonNegativeNumber(parsed, 0, MAX_RETRIES_CEILING);
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Initial delay (ms)")
			.setDesc("Wait before the first retry; it doubles on every subsequent attempt.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.baseDelayMs)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.baseDelayMs = safeNonNegativeNumber(parsed, 0, BASE_DELAY_MS_CEILING);
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Request timeout (ms)")
			.setDesc("How long to wait for a single Trello response before treating it as a failed attempt.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.requestTimeoutMs)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.requestTimeoutMs = safeNonNegativeNumber(
						parsed,
						0,
						REQUEST_TIMEOUT_MS_CEILING,
					);
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Show the progress panel")
			.setDesc("Floating panel with live progress while a sync runs. Off: the sync still runs, just silently.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showPanel).onChange((value) => {
					this.plugin.settings.showPanel = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Auto-close (seconds)")
			.setDesc("0 keeps the panel open until closed manually.")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.panelAutoCloseSeconds))
					.onChange((value) => {
						const parsed = Number.parseInt(value, 10);
						this.plugin.settings.panelAutoCloseSeconds =
							Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
						void this.save();
					}),
			);

		new Setting(root).setName("Frontmatter keys").setHeading();

		new Setting(root)
			.setName("Due date key")
			.setDesc("Frontmatter property that carries the card's due date.")
			.addText((text) =>
				text.setValue(this.plugin.settings.dueFrontmatterKey).onChange((value) => {
					this.plugin.settings.dueFrontmatterKey = safeFrontmatterKey(value, DEFAULT_DUE_KEY);
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Labels key")
			.setDesc("Frontmatter property that carries the card's labels.")
			.addText((text) =>
				text.setValue(this.plugin.settings.labelsFrontmatterKey).onChange((value) => {
					this.plugin.settings.labelsFrontmatterKey = safeFrontmatterKey(value, DEFAULT_LABELS_KEY);
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Attachments key")
			.setDesc("Frontmatter property that carries the card's plain attachment urls.")
			.addText((text) =>
				text.setValue(this.plugin.settings.attachmentsFrontmatterKey).onChange((value) => {
					this.plugin.settings.attachmentsFrontmatterKey = safeFrontmatterKey(value, DEFAULT_ATTACHMENTS_KEY);
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Linked cards key")
			.setDesc("Frontmatter property that carries a wikilink for each attachment pointing to another Trello card.")
			.addText((text) =>
				text.setValue(this.plugin.settings.linkedCardsFrontmatterKey).onChange((value) => {
					this.plugin.settings.linkedCardsFrontmatterKey = safeFrontmatterKey(
						value,
						DEFAULT_LINKED_CARDS_KEY,
					);
					void this.save();
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
				text.setValue(this.plugin.settings.cardRefFrontmatterKey).onChange((value) => {
					this.plugin.settings.cardRefFrontmatterKey = safeFrontmatterKey(value, DEFAULT_CARD_REF_KEY);
					void this.save();
				}),
			);
	}
}
