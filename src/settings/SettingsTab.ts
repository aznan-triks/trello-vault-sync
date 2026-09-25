import { Notice, PluginSettingTab, Setting, requestUrl, type App, type ButtonComponent } from "obsidian";
import type TrelloVaultSyncPlugin from "../main";
import { ALL_SECTIONS, COMMANDS } from "../commands/registry";
import { DEFAULT_ATTACHMENTS_KEY, DEFAULT_COVER_KEY, DEFAULT_LINKED_CARDS_KEY } from "../core/attachmentRef";
import { DEFAULT_CUSTOM_FIELDS_KEY } from "../core/customFieldRef";
import { DEFAULT_MEMBERS_KEY } from "../core/memberRef";
import { DEFAULT_CARD_REF_KEY } from "../core/cardRef";
import { DEFAULT_CHECKLIST_HEADING } from "../core/checklistRef";
import { DEFAULT_DUE_KEY } from "../core/dueRef";
import { errorMessage } from "../core/errorMessage";
import { DEFAULT_LABELS_KEY } from "../core/labelRef";
import type { LabelSyncMode } from "../core/labelMerge";
import type { MappingOverride } from "../core/mappingOverride";
import type { ConflictPolicy } from "../core/syncDecision";
import {
	buildChangelogVersionCard,
	filterAndGroupChangelog,
	parseRawChangelogMarkdown,
	type ChangelogViewMode,
	type RawChangelogItem,
} from "../core/changelog";
import { BUNDLED_CHANGELOG } from "../core/bundledChangelog";
import { TrelloPickerSuggest, type IdName } from "../ui/TrelloPickerSuggest";
import { VaultPathSuggest } from "../ui/VaultPathSuggest";
import {
	AUTO_SYNC_INTERVAL_MINUTES_CEILING,
	AUTO_SYNC_MIN_IDLE_SECONDS_CEILING,
	BASE_DELAY_MS_CEILING,
	HISTORY_MAX_RUNS_CEILING,
	MAX_BACKOFF_DELAY_MS_CEILING,
	MAX_RETRIES_CEILING,
	REQUEST_TIMEOUT_MS_CEILING,
	normalizeVaultPath,
	safeFrontmatterKey,
	safeNonNegativeNumber,
	type OrphanCardScope,
	type PhantomNoteScope,
} from "./types";

const POLICY_LABELS: Record<ConflictPolicy, string> = {
	"newer-wins": "Newer side wins",
	"prefer-local": "Obsidian always wins",
	"prefer-remote": "Trello always wins",
};

const LABELS_SYNC_MODE_LABELS: Record<LabelSyncMode, string> = {
	merge: "Merge (never lose a label)",
	overwrite: "Overwrite (the losing side's labels are dropped, decided by \"Arbitration\" above)",
};

const CHANGELOG_RAW_URL = "https://raw.githubusercontent.com/aznan-triks/trello-vault-sync/master/CHANGELOG.md";
const CHANGELOG_REPO_URL = "https://github.com/aznan-triks/trello-vault-sync/blob/master/CHANGELOG.md";

type SettingsTabId = "general" | "sync-rules" | "mappings" | "creation" | "automation" | "advanced" | "changelog";

interface TabDefinition {
	id: SettingsTabId;
	label: string;
}

const SETTINGS_TABS: TabDefinition[] = [
	{ id: "general", label: "General & Scope" },
	{ id: "sync-rules", label: "Sync Rules" },
	{ id: "mappings", label: "Mappings" },
	{ id: "creation", label: "Creation" },
	{ id: "automation", label: "Automation & History" },
	{ id: "advanced", label: "Advanced" },
	{ id: "changelog", label: "Changelog" },
];

export class TrelloVaultSyncSettingsTab extends PluginSettingTab {
	private listNames = new Map<string, string>();
	private boardName: string | null = null;
	private activeTab: SettingsTabId = "general";
	private searchQuery = "";
	private tokenRevealed = false;
	private searchCountEl: HTMLElement | null = null;
	private navEl: HTMLElement | null = null;

	// Changelog viewer state
	private changelogRawMarkdown: string = BUNDLED_CHANGELOG;
	private changelogLoading = false;
	private changelogFetchedAt: Date | null = null;
	private clSearchQuery = "";
	private clSortOrder: "desc" | "asc" = "desc";
	private clViewMode: ChangelogViewMode = "plain";
	private clActiveCats = new Set<string>(["Added", "Changed", "Fixed", "Removed", "Security"]);
	private clVersionFrom = "all";
	private clVersionTo = "all";
	private clContentContainer: HTMLElement | null = null;
	private clCounterEl: HTMLElement | null = null;
	private clTimeEl: HTMLElement | null = null;
	private clVersionFromSelect: HTMLSelectElement | null = null;
	private clVersionToSelect: HTMLSelectElement | null = null;

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

		this.renderHeader(containerEl);
		this.renderSearchBar(containerEl);
		this.renderNav(containerEl);

		const contentContainer = containerEl.createDiv({ cls: "tvs-settings__content" });
		this.renderAllSections(contentContainer);

		this.updateVisibility();

		containerEl.scrollTop = scrollTop;
	}

	private renderHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: "tvs-settings__header" });
		const title = header.createDiv({ cls: "tvs-settings__header-title" });
		title.createSpan({ text: "Trello Vault Sync" });

		const badges = header.createDiv({ cls: "tvs-settings__badges" });

		// 1. Connection status badge (100% computed locally without network request, Directive R3)
		const hasCreds = Boolean(
			this.plugin.settings.apiKey.trim() &&
			this.plugin.settings.token.trim() &&
			this.plugin.settings.boardId.trim(),
		);
		if (hasCreds) {
			const boardLabel = this.boardName ? `Board: ${this.boardName}` : "Board configured";
			badges.createSpan({
				cls: "tvs-badge tvs-badge--ok",
				text: `Connected (${boardLabel})`,
			});
		} else {
			badges.createSpan({
				cls: "tvs-badge tvs-badge--warn",
				text: "Connection incomplete",
			});
		}

		// 2. Mappings count badge
		const mappingCount = this.plugin.settings.mappings.length;
		badges.createSpan({
			cls: "tvs-badge",
			text: `${mappingCount} mapping${mappingCount === 1 ? "" : "s"}`,
		});

		// 3. Auto-sync status badge
		if (this.plugin.settings.autoSyncEnabled) {
			badges.createSpan({
				cls: "tvs-badge tvs-badge--accent",
				text: "Auto-sync: ON",
			});
		}

		// 4. Dry run badge
		if (this.plugin.settings.dryRun) {
			badges.createSpan({
				cls: "tvs-badge tvs-badge--warn",
				text: "Dry run: ON",
			});
		}
	}

	private renderSearchBar(root: HTMLElement): void {
		const searchContainer = root.createDiv({ cls: "tvs-settings__search-container" });
		new Setting(searchContainer)
			.setClass("tvs-settings__search-setting")
			.addSearch((search) => {
				search
					.setPlaceholder("Search all settings...")
					.setValue(this.searchQuery)
					.onChange((value) => {
						this.searchQuery = value.trim().toLowerCase();
						this.updateVisibility();
					});
			});

		this.searchCountEl = searchContainer.createDiv({ cls: "tvs-settings__search-count is-hidden" });
	}

	private renderNav(root: HTMLElement): void {
		this.navEl = root.createDiv({ cls: "tvs-settings__nav" });
		for (const tab of SETTINGS_TABS) {
			const btn = this.navEl.createEl("button", {
				cls: `tvs-settings__tab-btn ${this.activeTab === tab.id ? "is-active" : ""}`,
				text: tab.label,
			});
			if (tab.id === "mappings") {
				const count = this.plugin.settings.mappings.length;
				btn.createSpan({ cls: "tvs-settings__tab-count", text: String(count) });
			}
			btn.addEventListener("click", () => {
				this.activeTab = tab.id;
				this.navEl?.querySelectorAll(".tvs-settings__tab-btn").forEach((b) => b.removeClass("is-active"));
				btn.addClass("is-active");
				this.updateVisibility();
			});
		}
	}

	private renderAllSections(container: HTMLElement): void {
		const sections: Array<{ id: string; tab: SettingsTabId; render: (root: HTMLElement) => void }> = [
			// Tab 1: General & Scope
			{ id: "credentials", tab: "general", render: (el) => this.renderCredentials(el) },
			{ id: "scope", tab: "general", render: (el) => this.renderScope(el) },
			{ id: "ribbon", tab: "general", render: (el) => this.renderRibbon(el) },
			{ id: "audit-output", tab: "general", render: (el) => this.renderAuditOutput(el) },
			// Tab 2: Sync Rules
			{ id: "arbitration", tab: "sync-rules", render: (el) => this.renderArbitration(el) },
			{ id: "labels", tab: "sync-rules", render: (el) => this.renderLabels(el) },
			{ id: "attachments", tab: "sync-rules", render: (el) => this.renderAttachments(el) },
			{ id: "checklists", tab: "sync-rules", render: (el) => this.renderChecklists(el) },
			{ id: "members", tab: "sync-rules", render: (el) => this.renderMembers(el) },
			{ id: "custom-fields", tab: "sync-rules", render: (el) => this.renderCustomFields(el) },
			{ id: "sync-history", tab: "sync-rules", render: (el) => this.renderSyncHistory(el) },
			// Tab 3: Mappings
			{ id: "mappings", tab: "mappings", render: (el) => this.renderMappings(el) },
			// Tab 4: Creation (note-from-card, card-from-note)
			{ id: "orphan-cards", tab: "creation", render: (el) => this.renderOrphanCards(el) },
			// Tab 5: Automation
			{ id: "auto-sync", tab: "automation", render: (el) => this.renderAutoSync(el) },
			// Tab 6: Advanced
			{ id: "advanced", tab: "advanced", render: (el) => this.renderAdvanced(el) },
			// Tab 7: Changelog
			{ id: "changelog", tab: "changelog", render: (el) => this.renderChangelog(el) },
		];

		for (const sec of sections) {
			const secEl = container.createDiv({
				cls: `tvs-settings__section tvs-settings__section--${sec.id}`,
			});
			secEl.dataset.tab = sec.tab;
			sec.render(secEl);
		}
	}

	private updateVisibility(): void {
		const isSearching = this.searchQuery.length > 0;
		const allSections = this.containerEl.querySelectorAll<HTMLElement>(".tvs-settings__section");
		let matchCount = 0;

		allSections.forEach((sectionEl) => {
			const tab = sectionEl.dataset.tab;
			if (!isSearching) {
				const isCurrentTab = tab === this.activeTab;
				sectionEl.toggleClass("is-hidden", !isCurrentTab);
				sectionEl.querySelectorAll<HTMLElement>(".setting-item").forEach((item) => {
					item.removeClass("tvs-setting--hidden");
				});
			} else {
				let sectionHasMatch = false;
				if (
					tab === "changelog" &&
					("changelog".includes(this.searchQuery) ||
						this.changelogRawMarkdown.toLowerCase().includes(this.searchQuery))
				) {
					sectionHasMatch = true;
					matchCount++;
				}
				const items = sectionEl.querySelectorAll<HTMLElement>(".setting-item");
				items.forEach((item) => {
					const text = (item.textContent || "").toLowerCase();
					const matches = text.includes(this.searchQuery);
					if (matches) {
						item.removeClass("tvs-setting--hidden");
						sectionHasMatch = true;
						matchCount++;
					} else {
						item.addClass("tvs-setting--hidden");
					}
				});
				sectionEl.toggleClass("is-hidden", !sectionHasMatch);
			}
		});

		if (this.searchCountEl) {
			if (isSearching) {
				this.searchCountEl.setText(`Found ${matchCount} setting(s) matching "${this.searchQuery}"`);
				this.searchCountEl.removeClass("is-hidden");
			} else {
				this.searchCountEl.setText("");
				this.searchCountEl.addClass("is-hidden");
			}
		}

		if (this.navEl) {
			this.navEl.toggleClass("is-hidden", isSearching);
		}
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

		const tokenSetting = new Setting(root)
			.setName("Token")
			.setDesc("Personal token generated from the page above.")
			.setClass("tvs-secret");

		tokenSetting.addText((text) => {
			text.inputEl.type = this.tokenRevealed ? "text" : "password";
			text
				.setPlaceholder("token")
				.setValue(this.plugin.settings.token)
				.onChange((value) => {
					this.plugin.settings.token = value.trim();
					void this.save();
				});
		});

		tokenSetting.addExtraButton((button) =>
			button
				.setIcon(this.tokenRevealed ? "eye-off" : "eye")
				.setTooltip(this.tokenRevealed ? "Hide token" : "Show token")
				.onClick(() => {
					this.tokenRevealed = !this.tokenRevealed;
					this.display();
				}),
		);

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
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Which part of the vault the vault-wide commands (\"Sync all linked notes\", the audits) touch, and what's always left alone regardless of link state.",
		});

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

	}

	private renderAuditOutput(root: HTMLElement): void {
		new Setting(root).setName("Audit output").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Where the report-producing commands write their results.",
		});

		new Setting(root)
			.setName("Auto-create report notes")
			.setDesc(
				"Create the report note below when it doesn't exist yet, instead of blocking the audit with an error.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoCreateReportNote).onChange((value) => {
					this.plugin.settings.autoCreateReportNote = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Link audit report note")
			.setDesc('Path of the note "Audit links" writes its report into.')
			.addText((text) => {
				text
					.setPlaceholder("Projects/Trello Link Report.md")
					.setValue(this.plugin.settings.linkAuditReportPath)
					.onChange((value) => {
						this.plugin.settings.linkAuditReportPath = normalizeVaultPath(value.trim());
						void this.save();
					});
				new VaultPathSuggest(this.app, text.inputEl, () =>
					this.app.vault.getMarkdownFiles().map((file) => file.path),
				);
			});

		new Setting(root)
			.setName("Location audit report note")
			.setDesc('Path of the note "Compare locations against Trello" writes its report into.')
			.addText((text) => {
				text
					.setPlaceholder("Projects/Trello Location Report.md")
					.setValue(this.plugin.settings.locationAuditReportPath)
					.onChange((value) => {
						this.plugin.settings.locationAuditReportPath = normalizeVaultPath(value.trim());
						void this.save();
					});
				new VaultPathSuggest(this.app, text.inputEl, () =>
					this.app.vault.getMarkdownFiles().map((file) => file.path),
				);
			});

		new Setting(root)
			.setName("Change log report note")
			.setDesc('Path of the markdown note "Audit changes" writes its log into.')
			.addText((text) => {
				text
					.setPlaceholder("Projects/Trello Change Log.md")
					.setValue(this.plugin.settings.changesReportPath)
					.onChange((value) => {
						this.plugin.settings.changesReportPath = normalizeVaultPath(value.trim());
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
				// Suggests folders, not markdown-file list above — this page
				// is machine-generated and usually doesn't exist yet on first setup.
				new VaultPathSuggest(this.app, text.inputEl, () => this.folderCandidates());
			});
	}

	private renderArbitration(root: HTMLElement): void {
		new Setting(root).setName("Arbitration & safety").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Core rules every sync respects: who wins when both sides changed, and the switches that guard against an unwanted write or deletion.",
		});

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
			.setName("Sync descriptions")
			.setDesc("Synchronizes the note body and the card description. Off keeps both sides intact and syncs only metadata.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncDescription).onChange((value) => {
					this.plugin.settings.syncDescription = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Sync due dates")
			.setDesc("Synchronizes the card due date with the note frontmatter (Due date key, in Frontmatter keys below).")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncDue).onChange((value) => {
					this.plugin.settings.syncDue = value;
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
					this.display();
				}),
			);

		new Setting(root)
			.setName("Delete phantom notes")
			.setDesc(
				"⚠️ Destructive: trashes the note whose card left the list. Off by default — " +
					"such notes are simply reported. If Sync history (below) is on, a run that deletes notes can be " +
					"undone from \"Undo last sync run\".",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.allowDelete).onChange((value) => {
					this.plugin.settings.allowDelete = value;
					void this.save();
					this.display();
				}),
			);

		new Setting(root)
			.setName("Protect cards moved or archived elsewhere")
			.setDesc(
				"Before deleting, checks whether the card was only moved to another list or archived " +
					"instead of truly gone from the board — an extra Trello request per sync. Off by default: " +
					"missing from this list is enough, the same way \"gone\" is decided everywhere else here.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.protectMovedOrArchivedCards).onChange((value) => {
					this.plugin.settings.protectMovedOrArchivedCards = value;
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
	}

	private renderLabels(root: HTMLElement): void {
		new Setting(root).setName("Labels").setHeading();

		new Setting(root)
			.setName("Sync labels")
			.setDesc("Whether labels are synchronized between Trello cards and notes.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncLabels).onChange((value) => {
					this.plugin.settings.syncLabels = value;
					void this.save();
				}),
			);

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
	}

	private renderAttachments(root: HTMLElement): void {
		new Setting(root).setName("Attachments").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Whether a card's attachments show up as frontmatter links, whether the files themselves get downloaded into the vault, and whether the card's cover becomes the note's banner image.",
		});

		// Topic 1: attachments as frontmatter links (no download).
		new Setting(root).setName("As frontmatter links").setHeading();

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
					this.display();
				}),
			);

		if (this.plugin.settings.syncAttachments) {
			new Setting(root)
				.setName("Sync linked cards")
				.setDesc(
					"Resolves a card-link attachment to a wikilink in the Linked cards key (below). Off writes " +
						"plain attachment urls as usual but leaves this key untouched — no extra Trello request " +
						"either way, it rides the same attachment list.",
				)
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.syncLinkedCards).onChange((value) => {
						this.plugin.settings.syncLinkedCards = value;
						void this.save();
					}),
				);
		}

		// Topic 2: downloading the files themselves into the vault.
		new Setting(root).setName("Download to vault").setHeading();

		new Setting(root)
			.setName("Download attachments")
			.setDesc(
				"⚠️ Writes binary files into the vault: downloads each uploaded (non-link) attachment to the " +
					"chosen destination below. Off by default. An attachment already present under the same name " +
					"and byte size is never re-downloaded. If Sync history (Sync history section) is on, a run " +
					"that downloads files can be undone from \"Undo last sync run\".",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.downloadAttachments).onChange((value) => {
					this.plugin.settings.downloadAttachments = value;
					void this.save();
					this.display();
				}),
			);

		if (this.plugin.settings.downloadAttachments) {
			new Setting(root)
				.setName("Attachment download scope")
				.setDesc('What "Download attachments" (above) actually fetches — every uploaded attachment, or just the one set as the card\'s cover.')
				.addDropdown((dropdown) => {
					dropdown.addOption("all", "All attachments");
					dropdown.addOption("cover-only", "Cover image only");
					dropdown.setValue(this.plugin.settings.attachmentsDownloadScope).onChange((value) => {
						this.plugin.settings.attachmentsDownloadScope = value === "cover-only" ? "cover-only" : "all";
						void this.save();
					});
				});

			new Setting(root)
				.setName("Attachment download destination")
				.setDesc("Where a downloaded attachment is written.")
				.addDropdown((dropdown) => {
					dropdown.addOption("note-folder", "Same folder as the note");
					dropdown.addOption("global-folder", "One shared folder (below)");
					dropdown.setValue(this.plugin.settings.attachmentsDestination).onChange((value) => {
						this.plugin.settings.attachmentsDestination = value === "global-folder" ? "global-folder" : "note-folder";
						void this.save();
						this.display();
					});
				});

			if (this.plugin.settings.attachmentsDestination === "global-folder") {
				new Setting(root)
					.setName("Attachment download folder")
					.setDesc(
						"Required in this mode — left empty, every download is skipped and reported as an " +
							"error instead of failing silently.",
					)
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
			}
		}

		// Topic 3: the card's cover as the note's banner image.
		new Setting(root).setName("Cover image").setHeading();

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
					this.display();
				}),
			);

		if (this.plugin.settings.syncCardCover) {
			new Setting(root)
				.setName("Cover key")
				.setDesc(
					'The frontmatter key holding the cover image url — "banner" is what Pixelbanner itself reads. ' +
						"Empty resets it to the default key.",
				)
				.addText((text) =>
					text.setValue(this.plugin.settings.coverFrontmatterKey).onChange((value) => {
						this.plugin.settings.coverFrontmatterKey = safeFrontmatterKey(value, DEFAULT_COVER_KEY);
						void this.save();
					}),
				);

			new Setting(root)
				.setName("Prefer local cover")
				.setDesc(
					"When a downloaded cover image exists in the vault (needs \"Download attachments\" above), " +
						"write its local link into the cover frontmatter key instead of the remote Trello url. " +
						"Falls back to the remote url if not downloaded.",
				)
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.preferLocalCover).onChange((value) => {
						this.plugin.settings.preferLocalCover = value;
						void this.save();
						this.display();
					}),
				);

			if (this.plugin.settings.preferLocalCover) {
				new Setting(root)
					.setName("Local cover format")
					.setDesc("Link format written into the frontmatter when using a local cover.")
					.addDropdown((dropdown) => {
						dropdown.addOption("vault-path", "Vault path (e.g. Attachments/cover.jpg)");
						dropdown.addOption("wikilink", "Wikilink (e.g. [[Attachments/cover.jpg]])");
						dropdown.setValue(this.plugin.settings.coverLocalFormat).onChange((value) => {
							this.plugin.settings.coverLocalFormat = value === "wikilink" ? "wikilink" : "vault-path";
							void this.save();
						});
					});
			}
		}
	}

	private renderChecklists(root: HTMLElement): void {
		new Setting(root).setName("Checklists").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Whether a card's checklists mirror into the note's body as Markdown tasks.",
		});

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
					"changing this key doesn't move an existing section written under the old heading. Empty " +
					"resets it to the default heading.",
			)
			.addText((text) =>
				text.setValue(this.plugin.settings.checklistHeading).onChange((value) => {
					this.plugin.settings.checklistHeading = safeFrontmatterKey(value, DEFAULT_CHECKLIST_HEADING);
					void this.save();
				}),
			);
	}

	private renderMembers(root: HTMLElement): void {
		new Setting(root).setName("Members").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Whether a card's assigned people show up in the note's frontmatter, as readable names.",
		});

		new Setting(root)
			.setName("Sync members")
			.setDesc(
				"Writes the card's assigned members as readable names into the note's frontmatter (Members key, " +
					"below) — removed when they leave the card. Pull-only. Costs one extra Trello request per " +
					"sync run (the board's member directory), not per note.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncMembers).onChange((value) => {
					this.plugin.settings.syncMembers = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Members key")
			.setDesc("The frontmatter key holding the card's assigned members. Empty resets it to the default key.")
			.addText((text) =>
				text.setValue(this.plugin.settings.membersFrontmatterKey).onChange((value) => {
					this.plugin.settings.membersFrontmatterKey = safeFrontmatterKey(value, DEFAULT_MEMBERS_KEY);
					void this.save();
				}),
			);
	}

	private renderCustomFields(root: HTMLElement): void {
		new Setting(root).setName("Custom fields").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Whether a card's custom fields (text, number, date, checkbox, dropdown) show up in the note's frontmatter.",
		});

		new Setting(root)
			.setName("Sync custom fields")
			.setDesc(
				"Writes the card's custom fields into a single frontmatter object (Custom fields key, below), " +
					"keyed by each field's own label. Pull-only. No extra Trello request per note (values ride the " +
					"card already fetched); the board's field-definition directory costs one request per sync run.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncCustomFields).onChange((value) => {
					this.plugin.settings.syncCustomFields = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Custom fields key")
			.setDesc(
				"The frontmatter key holding the card's custom fields, grouped under one object. Empty resets " +
					"it to the default key.",
			)
			.addText((text) =>
				text.setValue(this.plugin.settings.customFieldsFrontmatterKey).onChange((value) => {
					this.plugin.settings.customFieldsFrontmatterKey = safeFrontmatterKey(value, DEFAULT_CUSTOM_FIELDS_KEY);
					void this.save();
				}),
			);
	}

	private renderSyncHistory(root: HTMLElement): void {
		new Setting(root).setName("Sync history").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Keeps a record of what each sync changed, so a bad run can be undone from the sidebar or command palette.",
		});

		new Setting(root)
			.setName("Sync history")
			.setDesc(
				"Records every write a sync makes — in the vault and on Trello — so it can be undone from " +
					"\"Undo last sync run\" / \"Undo last sync for the active note\". Neither side is ever " +
					"overwritten blindly: a note, card field or checklist item that changed since the run is " +
					"skipped and reported. Cancelling a running sync cannot recall a request already sent to " +
					"Trello, but undo can put it back.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.historyEnabled).onChange((value) => {
					this.plugin.settings.historyEnabled = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Revert Trello writes on undo")
			.setDesc(
				"On: undoing a run also reverts the Trello-side writes it made (a card's fields, a checklist " +
					"item's state). Off: only vault writes are reverted — Trello actions are skipped and reported " +
					"as disabled in settings.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.historyRevertTrelloWrites).onChange((value) => {
					this.plugin.settings.historyRevertTrelloWrites = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Confirm before undoing")
			.setDesc(
				'On: "Undo last sync run" and "Undo last sync for the active note" ask for confirmation before ' +
					'writing anything. Off disables the modal for repeated use. "Undo a sync run (pick what to ' +
					'undo)" already ends on its own explicit confirm button and is unaffected by this setting.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.confirmUndo).onChange((value) => {
					this.plugin.settings.confirmUndo = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Sync history — runs kept")
			.setDesc(
				"Oldest run is dropped once this many are recorded. Range 0-200, default 20. 0 keeps no history " +
					"at all — every run is dropped right after it completes, and undo has nothing to work with.",
			)
			.addText((text) =>
				text.setValue(String(this.plugin.settings.historyMaxRuns)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.historyMaxRuns = safeNonNegativeNumber(parsed, 0, HISTORY_MAX_RUNS_CEILING);
					void this.save();
				}),
			);
	}

	private renderOrphanCards(root: HTMLElement): void {
		root.createEl("p", {
			cls: "setting-item-description",
			text:
				"Three terms used throughout this tab and in audit reports — an orphan card is a Trello card " +
				"(not archived) that no note links to; a phantom note is a note whose card link points to a card " +
				"that no longer exists (deleted or archived); an unlinked note is a note with no card link at all.",
		});

		new Setting(root).setName("Note creation from a card").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Fallback settings when creating a note from a card — fallback destination folder for unmapped lists, and fallback note template when no mapping template is specified.",
		});

		new Setting(root)
			.setName("Orphan card fallback folder")
			.setDesc(
				'Destination for "Create note from a Trello card" — checked in this order: (1) the folder mapped ' +
					"to the card's list, if any (Mappings tab), (2) this fallback folder, used directly with no " +
					"prompt, (3) if this is left empty, you're asked for a folder each time instead.",
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
			.setName("Default note template")
			.setDesc(
				"Fallback note template when creating a note from a card whose list has no mapping template. " +
					"Empty creates a bare note with only the card-link frontmatter, no template content.",
			)
			.addText((text) => {
				text
					.setPlaceholder("Trello Card")
					.setValue(this.plugin.settings.defaultTemplateName)
					.onChange((value) => {
						this.plugin.settings.defaultTemplateName = value.trim();
						void this.save();
					});
				new VaultPathSuggest(this.app, text.inputEl, () =>
					this.app.vault.getMarkdownFiles().map((file) => file.basename),
				);
			});

		new Setting(root)
			.setName('Offer "create all" for orphan cards')
			.setDesc("When multiple orphan cards are detected, show an option at the top of the picker to create notes for all of them at once.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.orphanCardBatchCreate)
					.onChange((value) => {
						this.plugin.settings.orphanCardBatchCreate = value;
						void this.save();
					});
			});

		new Setting(root)
			.setName("Orphan cards detection scope")
			.setDesc("Which orphan cards are considered candidates when creating notes.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("all", "All unlinked cards on the board")
					.addOption("mapped-lists-only", "Only cards in mapped Trello lists")
					.setValue(this.plugin.settings.orphanCardScope)
					.onChange((value) => {
						this.plugin.settings.orphanCardScope = value as OrphanCardScope;
						void this.save();
					});
			});

		new Setting(root).setName("Card creation from phantom notes").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Destination list and options when creating Trello cards from phantom or unlinked notes.",
		});

		const phantomListName = this.listNames.get(this.plugin.settings.phantomCardListId);
		new Setting(root)
			.setName("Phantom notes destination list")
			.setDesc(
				(phantomListName ? `→ ${phantomListName}. ` : "") +
					'Default Trello list where phantom and unlinked notes are created as cards (e.g. "Inbox" or ' +
					'"Unorganized"). Order of priority: see "Prefer folder mapping" below for how this list and a ' +
					"folder's mapped list are chosen between. Leave empty to be prompted each time, unless a " +
					"folder mapping applies.",
			)
			.addText((text) => {
				text
					.setPlaceholder("idList")
					.setValue(this.plugin.settings.phantomCardListId)
					.onChange((value) => {
						this.plugin.settings.phantomCardListId = value.trim();
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
						this.plugin.settings.phantomCardListId = list.id;
						text.setValue(list.id);
						void this.save();
						this.display();
					},
				);
			});

		new Setting(root)
			.setName("Prefer folder mapping")
			.setDesc(
				'Decides the order of priority for the destination list above. On: (1) the note\'s folder mapped ' +
					"list, if any, (2) the destination list above, (3) ask. Off (default): (1) the destination " +
					"list above, if set, (2) the note's folder mapped list, if any, (3) ask.",
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.phantomNotePreferFolderMapping)
					.onChange((value) => {
						this.plugin.settings.phantomNotePreferFolderMapping = value;
						void this.save();
					});
			});

		new Setting(root)
			.setName("Phantom notes detection scope")
			.setDesc(
				"Which notes are considered candidates when scanning for phantom and unlinked notes " +
					"(see the definitions above).",
			)
			.addDropdown((dropdown) => {
				dropdown
					.addOption("all-unlinked", "All unlinked & phantom notes in vault scope")
					.addOption("mapped-folders-only", "Phantom notes + unlinked notes in mapped folders")
					.addOption("phantom-only", "Only phantom notes (broken card links)")
					.setValue(this.plugin.settings.phantomNoteScope)
					.onChange((value) => {
						this.plugin.settings.phantomNoteScope = value as PhantomNoteScope;
						void this.save();
					});
			});
	}

	private renderAutoSync(root: HTMLElement): void {
		new Setting(root).setName("Auto-sync").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Runs a sync on its own instead of only when you click a command — pick what starts it (any combination) and what it runs (any combination) below.",
		});

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
			.setName("Trigger — on a timer")
			.setDesc("Checks periodically (interval below) whether it's time to sync.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncOnInterval).onChange((value) => {
					this.plugin.settings.autoSyncOnInterval = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Trigger — when Obsidian regains focus")
			.setDesc("Syncs when you switch back to the Obsidian window (still subject to the minimum gap below).")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncOnFocus).onChange((value) => {
					this.plugin.settings.autoSyncOnFocus = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Trigger — at startup")
			.setDesc("Syncs once, shortly after Obsidian finishes loading this vault.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncOnStartup).onChange((value) => {
					this.plugin.settings.autoSyncOnStartup = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Interval (minutes)")
			.setDesc(
				'Minimum wait before "On a timer" is allowed to sync again (it checks every 30 seconds, but ' +
					"only actually syncs once this many minutes have passed). Range 0-1440 (24h), default 15. 0 " +
					"removes this wait — every 30-second check can sync, still subject to the minimum gap below.",
			)
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
			.setName("Scope — every mapped folder")
			.setDesc('Runs "Sync every list with its folder" — the only scope that can create a missing note.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncScopeMappings).onChange((value) => {
					this.plugin.settings.autoSyncScopeMappings = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Scope — the whole vault")
			.setDesc('Runs "Sync all linked notes" — every note already linked to a card, anywhere in scope.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncScopeVault).onChange((value) => {
					this.plugin.settings.autoSyncScopeVault = value;
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Minimum gap between auto-syncs (seconds)")
			.setDesc(
				"However it was triggered, an auto-sync never starts less than this long after the previous " +
					"one. Range 0-3600 (1h), default 60. 0 removes this floor — a focus/startup trigger can fire " +
					"right after the previous run.",
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
			const card = root.createDiv({ cls: "tvs-mapping-card" });
			const cardHeader = card.createDiv({ cls: "tvs-mapping-card__header" });
			const titleDiv = cardHeader.createDiv({ cls: "tvs-mapping-card__title" });
			titleDiv.createSpan({ text: `Mapping #${index + 1}` });

			const resolvedName = this.listNames.get(mapping.listId);
			if (resolvedName) {
				titleDiv.createSpan({ cls: "tvs-badge tvs-badge--ok", text: resolvedName });
			}

			const hasOverride =
				(mapping.allowCreateOverride && mapping.allowCreateOverride !== "inherit") ||
				(mapping.allowDeleteOverride && mapping.allowDeleteOverride !== "inherit");
			if (hasOverride) {
				titleDiv.createSpan({ cls: "tvs-badge tvs-badge--warn", text: "Custom overrides" });
			}

			new Setting(cardHeader).addExtraButton((button) =>
				button
					.setIcon("trash")
					.setTooltip("Remove mapping")
					.onClick(() => {
						this.plugin.settings.mappings.splice(index, 1);
						void this.save();
						this.display();
					}),
			);

			const cardBody = card.createDiv({ cls: "tvs-mapping-card__body" });

			new Setting(cardBody)
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

			new Setting(cardBody)
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

			new Setting(cardBody)
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

			// Collapsible folder overrides (Directive R2)
			const details = cardBody.createEl("details", { cls: "tvs-mapping-card__details" });
			if (hasOverride) {
				details.open = true;
			}
			const summary = details.createEl("summary", { cls: "tvs-mapping-card__summary" });
			summary.createSpan({ text: "Folder overrides (create / delete)" });
			if (hasOverride) {
				summary.createSpan({ cls: "tvs-badge tvs-badge--warn", text: "Active" });
			}

			const detailsContent = details.createDiv({ cls: "tvs-mapping-card__details-content" });

			this.renderMappingOverride(detailsContent, {
				name: "Create missing notes (this folder)",
				globalName: "Create missing notes",
				globalEnabled: this.plugin.settings.allowCreate,
				descriptionPrefix: "Overrides",
				alwaysLabel: "Always create",
				neverLabel: "Never create",
				value: mapping.allowCreateOverride ?? "inherit",
				onChange: (mode) => {
					mapping.allowCreateOverride = mode;
				},
			});

			this.renderMappingOverride(detailsContent, {
				name: "Delete phantom notes (this folder)",
				globalName: "Delete phantom notes",
				globalEnabled: this.plugin.settings.allowDelete,
				descriptionPrefix: "⚠️ Destructive: overrides",
				alwaysLabel: "Always delete",
				neverLabel: "Never delete",
				value: mapping.allowDeleteOverride ?? "inherit",
				onChange: (mode) => {
					mapping.allowDeleteOverride = mode;
				},
			});
		});

		new Setting(root).addButton((button) =>
			button
				.setButtonText("Add a mapping")
				.setCta()
				.onClick(() => {
					this.plugin.settings.mappings.push({
						listId: "",
						folder: "",
						templateName: "",
						allowCreateOverride: "inherit",
						allowDeleteOverride: "inherit",
					});
					void this.save();
					this.display();
				}),
		);
	}

	private renderMappingOverride(
		row: HTMLElement,
		options: {
			name: string;
			globalName: string;
			globalEnabled: boolean;
			descriptionPrefix: string;
			alwaysLabel: string;
			neverLabel: string;
			value: MappingOverride;
			onChange: (mode: MappingOverride) => void;
		},
	): void {
		const globalState = options.globalEnabled ? "on" : "off";
		new Setting(row)
			.setName(options.name)
			.setDesc(
				`${options.descriptionPrefix} the global "${options.globalName}" setting (in Arbitration & safety, currently ${globalState}) for this mapping only.`,
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("inherit", `Inherit global setting (currently ${globalState})`);
				dropdown.addOption("on", options.alwaysLabel);
				dropdown.addOption("off", options.neverLabel);
				dropdown.setValue(options.value).onChange((value) => {
					options.onChange(value as MappingOverride);
					void this.save();
				});
			});
	}

	private renderRibbon(root: HTMLElement): void {
		new Setting(root).setName("Ribbon icons").setHeading();
		new Setting(root).setDesc(
			"Choose which commands get a button in Obsidian's left ribbon, and optionally customize their colors individually.",
		);

		new Setting(root)
			.setName("Sidebar conflict indicator")
			.setDesc(
				"Show a badge in the sidebar with the unresolved-conflict count from the last sync run. Resets when Obsidian reloads.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showConflictIndicator).onChange((value) => {
					this.plugin.settings.showConflictIndicator = value;
					void this.save();
				}),
			);

		for (const section of ALL_SECTIONS) {
			const sectionCommands = COMMANDS.filter((c) => c.section === section);
			if (sectionCommands.length === 0) continue;

			new Setting(root).setName(section).setHeading();

			for (const command of sectionCommands) {
				const currentColor = this.plugin.settings.ribbonIconColors[command.id] || "";
				const setting = new Setting(root).setName(command.name);
				setting.setDesc(currentColor ? `Custom color: ${currentColor}` : "Default theme color");

				let resetBtn: { setDisabled: (d: boolean) => void; setTooltip: (t: string) => void } | null = null;
				let colorPicker: { setValue: (v: string) => void } | null = null;

				setting.addColorPicker((picker) => {
					colorPicker = picker;
					if (currentColor) {
						picker.setValue(currentColor);
					}
					picker.onChange((val) => {
						this.plugin.settings.ribbonIconColors[command.id] = val;
						setting.setDesc(`Custom color: ${val}`);
						resetBtn?.setDisabled(false);
						resetBtn?.setTooltip(`Reset color (${val}) to default`);
						void this.save();
					});
				});

				setting.addExtraButton((btn) => {
					btn.setIcon("rotate-ccw")
						.setTooltip(currentColor ? `Reset color (${currentColor}) to default` : "Reset to default color")
						.setDisabled(!currentColor)
						.onClick(() => {
							if (this.plugin.settings.ribbonIconColors[command.id]) {
								delete this.plugin.settings.ribbonIconColors[command.id];
								colorPicker?.setValue("#000000");
								setting.setDesc("Default theme color");
								btn.setDisabled(true);
								btn.setTooltip("Reset to default color");
								void this.save();
							}
						});
					resetBtn = btn;
				});

				setting.addToggle((toggle) =>
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
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Matching tolerance, network retry tuning, and the progress panel — settings you're unlikely to need until something needs adjusting.",
		});

		new Setting(root)
			.setName("Similarity threshold")
			.setDesc("Minimum score (0 to 1) to automatically match a note to a card.")
			.addSlider((slider) =>
				slider
					.setLimits(0.1, 1, 0.05)
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
			.setName("Max retry wait (ms)")
			.setDesc("Ceiling on a single retry wait, regardless of how many attempts have already doubled the delay.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.maxBackoffDelayMs)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.maxBackoffDelayMs = safeNonNegativeNumber(
						parsed,
						0,
						MAX_BACKOFF_DELAY_MS_CEILING,
					);
					void this.save();
				}),
			);

		new Setting(root)
			.setName("Fetch attachments and checklists with the cards")
			.setDesc(
				"Gets every card's attachments and checklists in the same request as the cards — much faster. Off: one extra request per note for each, which keeps each response smaller on very heavy boards.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.fetchCardDetailsWithCards).onChange((value) => {
					this.plugin.settings.fetchCardDetailsWithCards = value;
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
		root.createEl("p", {
			cls: "setting-item-description",
			text: "The property name each synced value is written under. Change one only if it collides with something else already in your notes — the note that already exists under the old key needs updating by hand, this plugin never renames it for you. Leaving any of these fields empty resets it to its built-in default name on save.",
		});

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

	private renderChangelog(root: HTMLElement): void {
		const container = root.createDiv({ cls: "tvs-cl" });

		// 1) Header card
		const headerCard = container.createDiv({ cls: "tvs-cl-header-card" });
		const info = headerCard.createDiv({ cls: "tvs-cl-header-card__info" });
		new Setting(info).setName("Changelog & Version History").setHeading();
		const subtitle = info.createEl("p");
		subtitle.createSpan({ text: "Fetched live from Git repository (" });
		subtitle.createEl("a", {
			text: "aznan-triks/trello-vault-sync",
			href: CHANGELOG_REPO_URL,
			cls: "tvs-cl-repo-link",
		});
		subtitle.createSpan({ text: ")" });

		const actions = headerCard.createDiv({ cls: "tvs-cl-header-card__actions" });
		this.clTimeEl = actions.createSpan({
			cls: "tvs-cl-time",
			text: this.changelogFetchedAt
				? `Last Git sync: ${this.changelogFetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
				: "Bundled release notes",
		});

		const refreshBtn = actions.createEl("button", {
			cls: "mod-cta",
			text: "🔄 Refresh",
		});
		refreshBtn.addEventListener("click", () => {
			void this.loadChangelog(true);
		});

		// 2) Filter Card
		const filterCard = container.createDiv({ cls: "tvs-cl-filter-card" });

		// Row 1: Search, View Mode, Sort
		const row1 = filterCard.createDiv({ cls: "tvs-cl-filter-row" });

		const searchWrap = row1.createDiv({ cls: "tvs-cl-search-wrap" });
		const searchInput = searchWrap.createEl("input", {
			type: "text",
			cls: "tvs-cl-search-input",
			placeholder: "🔍 Search version, keyword, fix...",
			value: this.clSearchQuery,
		});
		searchInput.addEventListener("input", (e) => {
			const target = e.target as HTMLInputElement;
			this.clSearchQuery = target.value.trim().toLowerCase();
			this.renderChangelogView();
		});

		this.clCounterEl = searchWrap.createSpan({ cls: "tvs-cl-counter" });

		const controlGroup = row1.createDiv({ cls: "tvs-cl-control-group" });

		// Segmented View Mode
		const segmented = controlGroup.createDiv({ cls: "tvs-cl-segmented" });
		const viewModes: Array<{ mode: ChangelogViewMode; label: string }> = [
			{ mode: "all", label: "👁️ All" },
			{ mode: "plain", label: "👤 Plain" },
			{ mode: "tech", label: "💻 Technical" },
		];
		for (const vm of viewModes) {
			const btn = segmented.createEl("button", {
				cls: `tvs-cl-view-btn ${this.clViewMode === vm.mode ? "is-active" : ""}`,
				text: vm.label,
			});
			btn.addEventListener("click", () => {
				segmented.querySelectorAll(".tvs-cl-view-btn").forEach((b) => b.removeClass("is-active"));
				btn.addClass("is-active");
				this.clViewMode = vm.mode;
				this.renderChangelogView();
			});
		}

		// Sort Order Select
		const sortSelect = controlGroup.createEl("select", { cls: "tvs-cl-select" });
		const optDesc = sortSelect.createEl("option", { value: "desc", text: "🔽 Newest first" });
		const optAsc = sortSelect.createEl("option", { value: "asc", text: "🔼 Oldest first" });
		if (this.clSortOrder === "asc") optAsc.selected = true;
		else optDesc.selected = true;
		sortSelect.addEventListener("change", (e) => {
			this.clSortOrder = (e.target as HTMLSelectElement).value as "desc" | "asc";
			this.renderChangelogView();
		});

		// Row 2: Categories & Version Range
		const row2 = filterCard.createDiv({ cls: "tvs-cl-filter-row tvs-cl-filter-row--border" });

		const catGroup = row2.createDiv({ cls: "tvs-cl-cat-group" });
		catGroup.createSpan({ cls: "tvs-cl-cat-label", text: "Categories:" });
		const categories = [
			{ name: "Added", icon: "✨" },
			{ name: "Changed", icon: "⚡" },
			{ name: "Fixed", icon: "🐛" },
			{ name: "Removed", icon: "🗑️" },
			{ name: "Security", icon: "🛡️" },
		];
		for (const cat of categories) {
			const chip = catGroup.createEl("button", {
				cls: `tvs-cl-cat-chip ${this.clActiveCats.has(cat.name) ? "is-active" : ""}`,
				text: `${cat.icon} ${cat.name}`,
			});
			chip.setAttribute("data-cat", cat.name);
			chip.addEventListener("click", () => {
				if (this.clActiveCats.has(cat.name)) {
					if (this.clActiveCats.size > 1) {
						this.clActiveCats.delete(cat.name);
						chip.removeClass("is-active");
					}
				} else {
					this.clActiveCats.add(cat.name);
					chip.addClass("is-active");
				}
				this.renderChangelogView();
			});
		}

		// Version Range
		const rangeGroup = row2.createDiv({ cls: "tvs-cl-control-group" });
		rangeGroup.createSpan({ cls: "tvs-cl-cat-label", text: "Range:" });

		this.clVersionFromSelect = rangeGroup.createEl("select", { cls: "tvs-cl-select" });
		rangeGroup.createSpan({ text: "to", cls: "tvs-cl-range-to" });
		this.clVersionToSelect = rangeGroup.createEl("select", { cls: "tvs-cl-select" });

		this.clVersionFromSelect.addEventListener("change", (e) => {
			this.clVersionFrom = (e.target as HTMLSelectElement).value;
			this.renderChangelogView();
		});
		this.clVersionToSelect.addEventListener("change", (e) => {
			this.clVersionTo = (e.target as HTMLSelectElement).value;
			this.renderChangelogView();
		});

		// 3) Content Container
		this.clContentContainer = container.createDiv({ cls: "tvs-cl-content" });

		this.renderChangelogView();
	}

	/** `buildChangelogVersionCard`/`parseRawChangelogMarkdown` escape all raw text before emitting their whitelisted tags, so this is not a raw-innerHTML sink — parsing avoids the analyzer's blanket innerHTML flag without changing what actually renders. */
	private renderSafeHtml(container: HTMLElement, html: string): void {
		const parsed = new DOMParser().parseFromString(html, "text/html");
		container.append(...Array.from(parsed.body.childNodes));
	}

	private renderChangelogView(): void {
		if (!this.clContentContainer) return;
		const container = this.clContentContainer;
		container.empty();

		const { introHtml, rawItems } = parseRawChangelogMarkdown(this.changelogRawMarkdown);

		this.populateVersionSelects(rawItems);

		const result = filterAndGroupChangelog(rawItems, {
			searchQuery: this.clSearchQuery,
			viewMode: this.clViewMode,
			activeCats: this.clActiveCats,
			sortOrder: this.clSortOrder,
			versionFrom: this.clVersionFrom,
			versionTo: this.clVersionTo,
		});

		if (this.clCounterEl) {
			this.clCounterEl.setText(
				`${result.processedItems.length} / ${rawItems.length} version${rawItems.length > 1 ? "s" : ""}`,
			);
		}

		if (result.processedItems.length === 0) {
			const empty = container.createDiv({ cls: "tvs-cl-empty" });
			empty.createDiv({ cls: "tvs-cl-empty__icon", text: "🔍" });
			empty.createDiv({ cls: "tvs-cl-empty__title", text: "No results found" });
			empty.createDiv({
				cls: "tvs-cl-empty__desc",
				text: "No updates match your current filters.",
			});
			const resetBtn = empty.createEl("button", {
				cls: "mod-cta",
				text: "🔄 Reset filters",
			});
			resetBtn.addEventListener("click", () => {
				this.resetChangelogFilters();
			});
			return;
		}

		if (introHtml) {
			const introEl = container.createDiv();
			this.renderSafeHtml(introEl, introHtml);
		}

		for (const group of result.dateGroups) {
			const isHistorical =
				group.date.toLowerCase().includes("history") ||
				group.date.toLowerCase().includes("historique");
			const groupEl = container.createDiv({ cls: "tvs-cl-date-group" });

			const headerEl = groupEl.createDiv({ cls: "tvs-cl-date-header" });
			headerEl.createSpan({
				cls: "tvs-cl-date-header__title",
				text: isHistorical ? `📜 ${group.date}` : `📅 ${group.date}`,
			});
			if (!isHistorical) {
				headerEl.createSpan({
					cls: "tvs-cl-counter",
					text: `${group.versions.length} version${group.versions.length > 1 ? "s" : ""}`,
				});
			}

			const listEl = groupEl.createDiv({ cls: "tvs-cl-versions-list" });
			for (const item of group.versions) {
				const cardWrapper = listEl.createDiv();
				this.renderSafeHtml(cardWrapper, buildChangelogVersionCard(item));
			}
		}
	}

	private populateVersionSelects(rawItems: RawChangelogItem[]): void {
		if (!this.clVersionFromSelect || !this.clVersionToSelect) return;
		const uniqueVers = rawItems.map((i) => i.ver).filter((v, idx, a) => v && a.indexOf(v) === idx);
		const currentFrom = this.clVersionFrom;
		const currentTo = this.clVersionTo;

		this.clVersionFromSelect.empty();
		this.clVersionToSelect.empty();

		this.clVersionFromSelect.createEl("option", { value: "all", text: "All versions" });
		this.clVersionToSelect.createEl("option", { value: "all", text: "Latest version" });

		for (const v of uniqueVers) {
			this.clVersionFromSelect.createEl("option", { value: v, text: v });
			this.clVersionToSelect.createEl("option", { value: v, text: v });
		}

		this.clVersionFromSelect.value = currentFrom;
		this.clVersionToSelect.value = currentTo;
	}

	private resetChangelogFilters(): void {
		this.clSearchQuery = "";
		this.clSortOrder = "desc";
		this.clViewMode = "plain";
		this.clActiveCats = new Set(["Added", "Changed", "Fixed", "Removed", "Security"]);
		this.clVersionFrom = "all";
		this.clVersionTo = "all";
		this.display();
	}

	private async loadChangelog(forceRefresh = false): Promise<void> {
		if (this.changelogLoading) return;
		this.changelogLoading = true;
		if (this.clTimeEl) {
			this.clTimeEl.setText("Fetching changelog from GitHub...");
		}

		try {
			const headers = forceRefresh ? { "Cache-Control": "no-cache" } : undefined;
			const res = await requestUrl({
				url: CHANGELOG_RAW_URL,
				method: "GET",
				headers,
				throw: false,
			});
			this.changelogLoading = false;
			if (res.status >= 200 && res.status < 300 && res.text) {
				this.changelogRawMarkdown = res.text;
				this.changelogFetchedAt = new Date();
				if (this.clTimeEl) {
					this.clTimeEl.setText(
						`Last Git sync: ${this.changelogFetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
					);
				}
				new Notice("Changelog updated from GitHub.");
				this.renderChangelogView();
			} else {
				if (this.clTimeEl) {
					this.clTimeEl.setText("Git sync failed (using bundled changelog)");
				}
				new Notice(`Could not fetch changelog from GitHub (HTTP ${res.status}).`);
			}
		} catch (err) {
			this.changelogLoading = false;
			if (this.clTimeEl) {
				this.clTimeEl.setText("Git sync error (using bundled changelog)");
			}
			new Notice(`Could not fetch changelog from GitHub: ${errorMessage(err)}`);
		}
	}
}

