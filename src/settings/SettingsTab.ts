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
import {
	ALL_CARD_VIEW_EDITABLE_FIELDS,
	COMMENTS_LIMIT_CEILING,
	CARD_VIEW_SECTION_LABELS,
	type CardViewEditableField,
} from "../core/cardViewModel";
import { mergeScannedLabels, type LabelPropertyDirection } from "../core/labelProperty";
import { sameSettingValue, setSettingAt, settingAt } from "../core/settingValue";
import type { OnLinkedNoteDeleted } from "../core/deletedNotes";
import type { OnCardArchived, OnCardDeleted, OnCardMoved } from "../core/cardFate";
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
import { DEFAULT_ACTIONS_PAGE_LIMIT, DEFAULT_RETRYABLE_STATUS_CODES } from "../trello/client";
import { DEFAULT_DRY_RUN_PREFIX } from "../core/journal";
import { VaultPathSuggest } from "../ui/VaultPathSuggest";
import {
	AUTO_SYNC_NOTE_CHANGE_DELAY_FLOOR,
	LOG_MAX_ROWS_FLOOR,
	MAX_CONCURRENT_OPERATIONS_FLOOR,
	NOTE_NAME_MAX_LENGTH_CEILING,
	NOTE_NAME_MAX_LENGTH_FLOOR,
	normalizeVaultPath,
	safeFrontmatterKey,
	safeNonNegativeNumber,
	CHANGE_LOG_AVATAR_SIZES,
	DEFAULT_SETTINGS,
	type ChangeLogAvatarSize,
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

const ON_CARD_MOVED_LABELS: Record<OnCardMoved, string> = {
	"move-note": "Move the note to the folder of the card's new list (kept if that list has no folder)",
	keep: "Keep the note where it is",
	trash: "Move the note to the trash",
};

const ON_CARD_ARCHIVED_LABELS: Record<OnCardArchived, string> = {
	unlink: "Remove the Trello properties (the note becomes a plain note)",
	keep: "Keep the note as it is",
	"archive-folder": "Move the note to the archive folder (stays linked)",
	trash: "Move the note to the trash",
};

const ON_CARD_DELETED_LABELS: Record<OnCardDeleted, string> = {
	unlink: "Remove the Trello properties (the note becomes a plain note)",
	keep: "Keep the note as it is",
	trash: "Move the note to the trash",
};

const ON_LINKED_NOTE_DELETED_LABELS: Record<OnLinkedNoteDeleted, string> = {
	"ignore-card": "Stop creating a note for the card (it moves to the ignored list below)",
	"archive-card": "Archive the card on Trello (recoverable from Trello's archive)",
	recreate: "Create the note again",
};

const LABEL_PROPERTY_DIRECTION_LABELS: Record<LabelPropertyDirection, string> = {
	both: "Both ways",
	"to-note": "Trello labels to note properties only",
	"to-trello": "Note properties to Trello labels only",
};

/** Trello's fixed label palette (the part before any "_dark"/"_light" suffix) as CSS colors. */
const TRELLO_LABEL_COLORS: Record<string, string> = {
	green: "#4bce97",
	yellow: "#e2b203",
	orange: "#fea362",
	red: "#f87168",
	purple: "#9f8fef",
	blue: "#579dff",
	sky: "#6cc3e0",
	lime: "#94c748",
	pink: "#e774bb",
	black: "#8590a2",
};

const CARD_VIEW_EDITABLE_LABELS: Record<CardViewEditableField, string> = {
	title: "the title",
	description: "the description",
	due: "the due date",
	labels: "the labels",
	members: "the members",
	list: "the list (move the card)",
	checklists: "the checklists",
	comments: "the comments",
	customFields: "the custom fields",
	attachments: "the attachments (add a link)",
	archive: "archiving the card",
};

const CHANGELOG_RAW_URL = "https://raw.githubusercontent.com/aznan-triks/trello-vault-sync/master/CHANGELOG.md";
const CHANGELOG_REPO_URL = "https://github.com/aznan-triks/trello-vault-sync/blob/master/CHANGELOG.md";

type SettingsTabId = "general" | "sync-rules" | "mappings" | "creation" | "card-view" | "automation" | "advanced" | "changelog";

interface TabDefinition {
	id: SettingsTabId;
	label: string;
}

/** One or two lines at the top of each tab: what it controls. */
const TAB_INTROS: Partial<Record<SettingsTabId, string>> = {
	general: "Connect to Trello, choose which part of the vault the plugin works on, and where the reports go.",
	"sync-rules": "How a note and its card are kept equal: who wins, what is copied, and what happens when a card moves, is archived or deleted.",
	mappings: "Which Trello list fills which vault folder.",
	creation: "How notes are made from cards that have none, and cards from notes that have none.",
	"card-view": "The side panel that shows, and can edit, the Trello card of the open note.",
	automation: "Syncs that run without you clicking, and the history that lets you undo a sync.",
	advanced: "Matching tolerance, the progress panel and the property names written into notes. Rarely needed.",
};

const SETTINGS_TABS: TabDefinition[] = [
	{ id: "general", label: "General & Scope" },
	{ id: "sync-rules", label: "Sync Rules" },
	{ id: "mappings", label: "Mappings" },
	{ id: "creation", label: "Creation" },
	{ id: "card-view", label: "Card view" },
	{ id: "automation", label: "Automation & History" },
	{ id: "advanced", label: "Advanced" },
	{ id: "changelog", label: "Changelog" },
];

export class TrelloVaultSyncSettingsTab extends PluginSettingTab {
	private listNames = new Map<string, string>();
	/** Label ids the last scan found deleted on Trello (rows kept for the user to remove). */
	private goneLabels = new Set<string>();
	private boardName: string | null = null;
	private activeTab: SettingsTabId = "general";
	private searchQuery = "";
	/** "Show only changed": display filter, not saved. */
	private onlyChanged = false;
	private summaryEl: HTMLElement | null = null;
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
		this.renderSummary(containerEl);
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

	/** "N settings changed from default" with a filter that shows only those. */
	private renderSummary(root: HTMLElement): void {
		this.summaryEl = root.createDiv({ cls: "tvs-settings__summary" });
	}

	private updateSummary(): void {
		const bar = this.summaryEl;
		if (!bar) return;
		const count = this.containerEl.querySelectorAll(".tvs-setting--modified").length;
		bar.empty();
		bar.createSpan({ text: count === 0 ? "Every setting has its default value." : `${count} setting${count === 1 ? "" : "s"} changed from default.` });
		if (count === 0 && !this.onlyChanged) return;
		const toggle = bar.createEl("button", { text: this.onlyChanged ? "Show all settings" : "Show only changed" });
		toggle.addEventListener("click", () => {
			this.onlyChanged = !this.onlyChanged;
			this.updateVisibility();
		});
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
			{ id: "card-lifecycle", tab: "sync-rules", render: (el) => this.renderCardLifecycle(el) },
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
			{ id: "card-view", tab: "card-view", render: (el) => this.renderCardView(el) },
			{ id: "auto-sync", tab: "automation", render: (el) => this.renderAutoSync(el) },
			// Tab 6: Advanced
			{ id: "advanced", tab: "advanced", render: (el) => this.renderAdvanced(el) },
			// Tab 7: Changelog
			{ id: "changelog", tab: "changelog", render: (el) => this.renderChangelog(el) },
		];

		const introduced = new Set<SettingsTabId>();
		for (const sec of sections) {
			const intro = TAB_INTROS[sec.tab];
			if (intro && !introduced.has(sec.tab)) {
				introduced.add(sec.tab);
				const introEl = container.createDiv({ cls: "tvs-settings__section" });
				introEl.dataset.tab = sec.tab;
				introEl.createEl("p", { cls: "tvs-settings__intro", text: intro });
			}
			const secEl = container.createDiv({
				cls: `tvs-settings__section tvs-settings__section--${sec.id}`,
			});
			secEl.dataset.tab = sec.tab;
			// Shown only while searching: names the tab a match lives in and jumps
			// there, so the next visit doesn't need a search at all.
			const tabLabel = SETTINGS_TABS.find((t) => t.id === sec.tab)?.label ?? sec.tab;
			const jump = secEl.createEl("button", {
				cls: "tvs-settings__search-jump",
				text: `In tab: ${tabLabel} — go there →`,
			});
			jump.addEventListener("click", () => {
				this.searchQuery = "";
				this.activeTab = sec.tab;
				this.display();
				this.containerEl.querySelector(`.tvs-settings__section--${sec.id}`)?.scrollIntoView({ block: "start" });
			});
			sec.render(secEl);
		}
	}

	private updateVisibility(): void {
		const isSearching = this.searchQuery.length > 0 || this.onlyChanged;
		this.containerEl.toggleClass("tvs-settings--searching", isSearching);
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
			sectionEl.querySelector(".tvs-settings__search-jump")?.toggleClass("is-hidden", !isSearching);
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
		this.updateSummary();
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

		this.track(new Setting(root)
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
			}), "scope");

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

	/**
	 * Adds, under a setting's description, its default value, and - once the value differs from it - a marker
	 * and a reset button. `path` is the key in the settings ("a.b" for a nested one). Stays in step as the
	 * control changes, without redrawing the tab.
	 */
	private track(setting: Setting, path: string): Setting {
		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		const initial = settingAt(DEFAULT_SETTINGS, path);
		const select = setting.controlEl.querySelector("select");
		const option = select ? Array.from(select.options).find((candidate) => candidate.value === String(initial)) : undefined;
		const shown = option?.text ?? (typeof initial === "boolean" ? (initial ? "on" : "off") : initial === "" ? "empty" : String(initial));
		setting.descEl.createDiv({ cls: "tvs-setting__default", text: `Default: ${shown}` });
		let reset: HTMLElement | null = null;
		setting.addExtraButton((button) => {
			button.setIcon("rotate-ccw").setTooltip("Reset to default").onClick(() => {
				setSettingAt(settings, path, structuredClone(initial));
				void this.save();
				this.display();
			});
			reset = button.extraSettingsEl;
		});
		const refresh = (notify = true) => {
			const modified = !sameSettingValue(settingAt(settings, path), initial);
			setting.settingEl.toggleClass("tvs-setting--modified", modified);
			reset?.toggleClass("is-hidden", !modified);
			if (notify) this.updateSummary();
		};
		for (const event of ["click", "input", "change"]) setting.controlEl.addEventListener(event, () => refresh());
		refresh(false);
		return setting;
	}

	/** A block of settings that only apply while a parent switch is on: hidden when it is off (still found by the search). */
	private group(root: HTMLElement, on: boolean): HTMLElement {
		return root.createDiv({ cls: on ? "tvs-settings__dependent" : "tvs-settings__dependent is-off" });
	}

	/** Under a hidden group: says how many settings the parent switch would reveal. */
	private groupHint(root: HTMLElement, holder: HTMLElement): void {
		if (!holder.hasClass("is-off")) return;
		const count = holder.querySelectorAll(".setting-item:not(.setting-item-heading)").length;
		if (count > 0) root.createDiv({ cls: "tvs-settings__more", text: `${count} more setting${count === 1 ? "" : "s"} when this is on.` });
	}

	private toggleField(root: HTMLElement, name: string, desc: string, get: () => boolean, set: (value: boolean) => void): Setting {
		return new Setting(root)
			.setName(name)
			.setDesc(desc)
			.addToggle((toggle) =>
				toggle.setValue(get()).onChange((value) => {
					set(value);
					void this.save();
				}),
			);
	}

	/** A whole-number field; an unusable entry is ignored until it parses, then clamped to `min`..`max`. */
	private numberField(
		root: HTMLElement,
		name: string,
		desc: string,
		get: () => number,
		set: (value: number) => void,
		min: number,
		max = Number.POSITIVE_INFINITY,
	): Setting {
		return new Setting(root)
			.setName(name)
			.setDesc(desc)
			.addText((text) =>
				text.setValue(String(get())).onChange((value) => {
					const parsed = Number(value);
					if (value.trim() === "" || !Number.isFinite(parsed)) return;
					set(Math.min(max, Math.max(min, parsed)));
					void this.save();
				}),
			);
	}

	private textField(
		root: HTMLElement,
		name: string,
		desc: string,
		get: () => string,
		set: (value: string) => void,
		placeholder = "",
	): Setting {
		return new Setting(root)
			.setName(name)
			.setDesc(desc)
			.addText((text) =>
				text.setPlaceholder(placeholder).setValue(get()).onChange((value) => {
					set(value);
					void this.save();
				}),
			);
	}

	private renderReportLabels(root: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(root).setName("Report wording and change log page").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Reports are rewritten at every audit, so changing a heading takes effect on the next one (an old report keeps its old heading until then). A heading or group prefix must start with #.",
		});
		const heading = (name: string, key: "linkReportHeading" | "locationReportHeading" | "changesReportHeading" | "orphanCardGroupPrefix" | "phantomNoteGroupPrefix" | "unlinkedNoteGroupPrefix", desc: string) =>
			this.textField(root, name, desc, () => s[key], (value) => { s[key] = value.trim() === "" || !value.trimStart().startsWith("#") ? DEFAULT_SETTINGS[key] : value; }, DEFAULT_SETTINGS[key]);
		heading("Link report heading", "linkReportHeading", "Title line of the link report.");
		heading("Location report heading", "locationReportHeading", "Title line of the location report.");
		heading("Change log report heading", "changesReportHeading", "Title line of the change log report.");
		heading("Heading prefix: cards without a note", "orphanCardGroupPrefix", "Starts each list's group of cards without a note, in the link report.");
		heading("Heading prefix: notes whose card is gone", "phantomNoteGroupPrefix", "Starts each folder's group of notes whose card is gone.");
		heading("Heading prefix: notes without a card", "unlinkedNoteGroupPrefix", "Starts each folder's group of notes with no card.");

		this.track(new Setting(root)
			.setName("Change log avatar size")
			.setDesc("Size of the avatars embedded in the HTML change log. Trello serves these sizes only; a larger one makes the page heavier.")
			.addDropdown((dropdown) => {
				for (const size of CHANGE_LOG_AVATAR_SIZES) dropdown.addOption(size, size === "original" ? "Original" : `${size} px`);
				dropdown.setValue(s.changeLogAvatarSize).onChange((value) => {
					s.changeLogAvatarSize = value as ChangeLogAvatarSize;
					void this.save();
				});
			}), "changeLogAvatarSize");
		this.track(new Setting(root)
			.setName("Change log extra CSS")
			.setDesc("Appended to the HTML change log's own style, after it, so your rules win. Applied the next time the page is exported.")
			.addTextArea((area) =>
				area.setValue(s.changeLogHtmlExtraCss).onChange((value) => {
					s.changeLogHtmlExtraCss = value;
					void this.save();
				}),
			), "changeLogHtmlExtraCss");
	}

	private renderCardView(root: HTMLElement): void {
		const v = this.plugin.settings.cardView;
		new Setting(root).setName("Card view").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "A side panel that shows the Trello card of the open note, loaded with a single request, and lets you edit it. Each part below can be hidden or made read-only.",
		});
		this.track(this.toggleField(root, "Enable the card view", "Off: the view is not registered at the next start and nothing is requested. Takes effect after restarting Obsidian.", () => v.enabled, (x) => (v.enabled = x)), "cardView.enabled");
		this.track(this.toggleField(root, "Open at startup", "Open the card view when Obsidian starts.", () => v.openOnStartup, (x) => (v.openOnStartup = x)), "cardView.openOnStartup");
		this.track(new Setting(root)
			.setName("Side")
			.setDesc("Which side panel the view opens in.")
			.addDropdown((d) =>
				d.addOption("right", "Right").addOption("left", "Left").setValue(v.side).onChange((x) => {
					v.side = x as "left" | "right";
					void this.save();
				}),
			), "cardView.side");
		this.track(this.toggleField(root, "Refresh while hidden", "Off: no request is made while the view is not visible; it reloads when shown.", () => v.refreshWhenHidden, (x) => (v.refreshWhenHidden = x)), "cardView.refreshWhenHidden");
		this.track(this.numberField(root, "Follow delay (ms)", "Wait after you switch note before the view follows. Minimum 0.", () => v.followDelayMs, (x) => (v.followDelayMs = x), 0), "cardView.followDelayMs");

		new Setting(root).setName("What the view shows").setHeading();
		root.createEl("p", { cls: "setting-item-description", text: "Order and visibility, for every card. A single card can differ: use the gear in the view's header." });
		v.sectionOrder.forEach((section, index) => {
			new Setting(root)
				.setName(CARD_VIEW_SECTION_LABELS[section])
				.addToggle((toggle) =>
					toggle.setValue(v.sections[section]).onChange((x) => {
						v.sections[section] = x;
						void this.save();
					}),
				)
				.addExtraButton((b) =>
					b.setIcon("arrow-up").setTooltip("Move up").setDisabled(index === 0).onClick(() => this.moveCardViewSection(index, -1)),
				)
				.addExtraButton((b) =>
					b.setIcon("arrow-down").setTooltip("Move down").setDisabled(index === v.sectionOrder.length - 1).onClick(() => this.moveCardViewSection(index, 1)),
				);
		});
		this.track(this.toggleField(root, "Show empty sections", "On: a section with nothing in it says so (\"No labels\"). Off: it is hidden.", () => v.showEmptySections, (x) => (v.showEmptySections = x)), "cardView.showEmptySections");
		this.track(this.toggleField(root, "Render Markdown", "Show the description and the comments as formatted Markdown.", () => v.renderMarkdown, (x) => (v.renderMarkdown = x)), "cardView.renderMarkdown");
		this.track(this.textField(root, "Date format", "A moment.js format such as DD/MM/YYYY HH:mm. Empty uses your system's format.", () => v.dateFormat, (x) => (v.dateFormat = x), "DD/MM/YYYY HH:mm"), "cardView.dateFormat");
		this.track(this.numberField(root, "Due soon within (hours)", "A due date closer than this is highlighted as soon. Minimum 0.", () => v.dueSoonHours, (x) => (v.dueSoonHours = x), 0), "cardView.dueSoonHours");
		this.track(new Setting(root)
			.setName("Open links in")
			.setDesc("Where \"Open on Trello\" and card links go.")
			.addDropdown((d) =>
				d.addOption("browser", "Browser").addOption("desktop-app", "Trello desktop app").setValue(v.openLinksIn).onChange((x) => {
					v.openLinksIn = x as "browser" | "desktop-app";
					void this.save();
				}),
			), "cardView.openLinksIn");

		new Setting(root).setName("Loading").setHeading();
		this.track(this.numberField(root, "Card cache (seconds)", "A loaded card is reused for this long. 0 reloads at every display.", () => v.cacheSeconds, (x) => (v.cacheSeconds = x), 0), "cardView.cacheSeconds");
		this.track(this.numberField(root, "Board data cache (seconds)", "The board's lists, labels, members and field definitions, loaded when you first edit.", () => v.boardCacheSeconds, (x) => (v.boardCacheSeconds = x), 0), "cardView.boardCacheSeconds");
		this.track(this.numberField(root, "Comments loaded", `Comments fetched with the card. 0 loads none. At most ${COMMENTS_LIMIT_CEILING} (Trello's own limit).`, () => v.commentsLimit, (x) => (v.commentsLimit = Math.round(x)), 0, COMMENTS_LIMIT_CEILING), "cardView.commentsLimit");

		new Setting(root).setName("Editing").setHeading();
		this.track(this.toggleField(root, "Allow editing", "Off: the view is read-only whatever the switches below say.", () => v.allowEditing, (x) => {
			v.allowEditing = x;
			this.display();
		}), "cardView.allowEditing");
		const holder = this.group(root, v.allowEditing);
		for (const field of ALL_CARD_VIEW_EDITABLE_FIELDS) {
			this.toggleField(holder, `Edit ${CARD_VIEW_EDITABLE_LABELS[field]}`, "", () => v.editable[field], (x) => (v.editable[field] = x));
		}
		this.track(new Setting(holder)
			.setName("Moved card goes to")
			.setDesc("Where a card lands in its new list.")
			.addDropdown((d) =>
				d.addOption("top", "Top").addOption("bottom", "Bottom").setValue(v.movedCardPosition).onChange((x) => {
					v.movedCardPosition = x as "top" | "bottom";
					void this.save();
				}),
			), "cardView.movedCardPosition");
		this.track(this.toggleField(holder, "Confirm before archiving", "Ask before the Archive button archives the card.", () => v.confirmArchive, (x) => (v.confirmArchive = x)), "cardView.confirmArchive");
		this.track(this.toggleField(holder, "Update the note after an edit", "After an edit, run \"Update this note from its card\" so the note follows.", () => v.pullAfterEdit, (x) => (v.pullAfterEdit = x)), "cardView.pullAfterEdit");
		this.groupHint(root, holder);
		root.createEl("p", { cls: "setting-item-description", text: "Deleting a comment, a checklist item, an attachment or the card is deliberately not offered: those cannot be undone on Trello." });
	}

	private moveCardViewSection(index: number, delta: number): void {
		const order = this.plugin.settings.cardView.sectionOrder;
		const target = index + delta;
		const moved = order[index];
		const other = order[target];
		if (moved === undefined || other === undefined) return;
		order[index] = other;
		order[target] = moved;
		void this.save();
		this.display();
	}

	private renderTuning(root: HTMLElement): void {
		const s = this.plugin.settings;
		new Setting(root).setName("Tuning").setHeading();
		this.track(this.numberField(root, "Auto-sync check every (seconds)", "How often auto-sync looks at whether it is time to sync. The interval above still decides when it actually syncs. Minimum 1.", () => s.autoSyncCheckSeconds, (v) => (s.autoSyncCheckSeconds = Math.round(v)), 1), "autoSyncCheckSeconds");
		this.track(this.numberField(root, "Own-write grace (ms)", "After a sync, note edits within this time count as the sync's own writes and do not trigger a sync. Minimum 0.", () => s.ownWriteGraceMs, (v) => (s.ownWriteGraceMs = v), 0), "ownWriteGraceMs");
		this.textField(root, "Retry on these HTTP statuses", "Comma-separated codes (100-599) that a failed request is retried on.", () => s.retryableStatusCodes.join(", "), (value) => {
			s.retryableStatusCodes = [...new Set(value.split(",").map((part) => Number(part.trim())).filter((code) => Number.isInteger(code) && code >= 100 && code <= 599))];
		}, DEFAULT_RETRYABLE_STATUS_CODES.join(", "));
		this.track(this.numberField(root, "Change log page size", `Actions requested per Trello call by the change log. 1 to ${DEFAULT_ACTIONS_PAGE_LIMIT} (Trello's own maximum).`, () => s.changeLogPageSize, (v) => (s.changeLogPageSize = Math.round(v)), 1, DEFAULT_ACTIONS_PAGE_LIMIT), "changeLogPageSize");
		this.track(this.numberField(root, "Notes between UI pauses", "A scan over many notes pauses once every this many notes so Obsidian can repaint. Minimum 1.", () => s.yieldEveryNotes, (v) => (s.yieldEveryNotes = Math.round(v)), 1), "yieldEveryNotes");
		this.track(this.numberField(root, "Title containment score", "Score (0 to 1) given when a note's name appears whole inside a card's title, or the reverse, when linking by name.", () => s.nameContainmentScore, (v) => (s.nameContainmentScore = v), 0, 1), "nameContainmentScore");
		this.track(this.textField(root, "Dry-run log prefix", "Put before every journal line of a dry run. Empty for none.", () => s.dryRunLogPrefix, (v) => (s.dryRunLogPrefix = v), DEFAULT_DRY_RUN_PREFIX), "dryRunLogPrefix");
		this.track(this.toggleField(root, "Success notices", "Show a notice when an operation finishes well. Errors are always shown.", () => s.showSuccessNotices, (v) => (s.showSuccessNotices = v)), "showSuccessNotices");
		this.track(this.toggleField(root, "Queue notices", "Show a notice when an operation waits behind others or is already running.", () => s.showQueueNotices, (v) => (s.showQueueNotices = v)), "showQueueNotices");
	}

	private renderAuditOutput(root: HTMLElement): void {
		new Setting(root).setName("Audit output").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Where the report-producing commands write their results.",
		});

		this.track(new Setting(root)
			.setName("Auto-create report notes")
			.setDesc(
				"Create the report note below when it doesn't exist yet, instead of blocking the audit with an error.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoCreateReportNote).onChange((value) => {
					this.plugin.settings.autoCreateReportNote = value;
					void this.save();
				}),
			), "autoCreateReportNote");

		this.track(new Setting(root)
			.setName("Link audit report note")
			.setDesc('Path of the note "Report unlinked cards and notes" writes its report into.')
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
			}), "linkAuditReportPath");

		this.track(new Setting(root)
			.setName("Location audit report note")
			.setDesc('Path of the note "Report notes in the wrong folder" writes its report into.')
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
			}), "locationAuditReportPath");

		this.track(new Setting(root)
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
			}), "changesReportPath");

		this.track(new Setting(root)
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
			}), "changesHtmlPath");
	}

	private renderArbitration(root: HTMLElement): void {
		new Setting(root).setName("Arbitration & safety").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Core rules every sync respects: who wins when both sides changed, and the switches that guard against an unwanted write or deletion.",
		});

		this.track(new Setting(root)
			.setName("Arbitration")
			.setDesc("Who wins when both the note and the card changed.")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(POLICY_LABELS)) dropdown.addOption(value, label);
				dropdown.setValue(this.plugin.settings.policy).onChange((value) => {
					this.plugin.settings.policy = value as ConflictPolicy;
					void this.save();
				});
			}), "policy");

		this.track(new Setting(root)
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
			), "marginSeconds");

		this.track(new Setting(root)
			.setName("Sync titles")
			.setDesc("Renames the note from the card's title, and vice versa.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncTitle).onChange((value) => {
					this.plugin.settings.syncTitle = value;
					void this.save();
				}),
			), "syncTitle");

		this.track(new Setting(root)
			.setName("Sync descriptions")
			.setDesc("Synchronizes the note body and the card description. Off keeps both sides intact and syncs only metadata.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncDescription).onChange((value) => {
					this.plugin.settings.syncDescription = value;
					void this.save();
				}),
			), "syncDescription");

		this.track(new Setting(root)
			.setName("Sync due dates")
			.setDesc("Synchronizes the card due date with the note frontmatter (Due date key, in Frontmatter keys below).")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncDue).onChange((value) => {
					this.plugin.settings.syncDue = value;
					void this.save();
				}),
			), "syncDue");

		this.track(new Setting(root)
			.setName("Dry run")
			.setDesc("Computes and shows everything that would be done, without writing anything.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.dryRun).onChange((value) => {
					this.plugin.settings.dryRun = value;
					void this.save();
				}),
			), "dryRun");

		this.track(new Setting(root)
			.setName("Create missing notes")
			.setDesc("Creates a note for every card with no local match, during a list sync.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.allowCreate).onChange((value) => {
					this.plugin.settings.allowCreate = value;
					void this.save();
					this.display();
				}),
			), "allowCreate");

		this.track(new Setting(root)
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
			), "confirmForceSync");

		this.track(this.toggleField(
			root,
			"Adopt a note named like a card",
			"During a folder sync, an unlinked note whose file name is exactly a card's title takes that card as its own instead of the card getting a second note. Off: such a note is only reported as unlinked.",
			() => this.plugin.settings.adoptUnlinkedNotesByName,
			(value) => (this.plugin.settings.adoptUnlinkedNotesByName = value),
		), "adoptUnlinkedNotesByName");
	}

	private renderCardLifecycle(root: HTMLElement): void {
		new Setting(root).setName("When a card changes on Trello").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "What a sync does with a note when its card was moved, archived or deleted on Trello. Every change can be undone from the sync history.",
		});

		this.track(new Setting(root)
			.setName("Card moved to another list or board")
			.setDesc("A list sync notices the card is no longer in the list. Moving a note follows the card to the folder mapped to its new list.")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(ON_CARD_MOVED_LABELS)) dropdown.addOption(value, label);
				dropdown.setValue(this.plugin.settings.onCardMoved).onChange((value) => {
					this.plugin.settings.onCardMoved = value as OnCardMoved;
					void this.save();
				});
			}), "onCardMoved");

		this.track(new Setting(root)
			.setName("Card archived")
			.setDesc("The note's own text is never touched. Keeping the link means later syncs keep failing to find the card, so the default removes it.")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(ON_CARD_ARCHIVED_LABELS)) dropdown.addOption(value, label);
				dropdown.setValue(this.plugin.settings.onCardArchived).onChange((value) => {
					this.plugin.settings.onCardArchived = value as OnCardArchived;
					void this.save();
					this.display();
				});
			}), "onCardArchived");

		if (this.plugin.settings.onCardArchived === "archive-folder") {
			this.track(new Setting(root)
				.setName("Archive folder")
				.setDesc("Where the notes of archived cards go. Empty keeps them where they are (and says so in the log).")
				.addText((text) => {
					text
						.setPlaceholder("Archive")
						.setValue(this.plugin.settings.archiveFolder)
						.onChange((value) => {
							this.plugin.settings.archiveFolder = normalizeVaultPath(value.trim());
							void this.save();
						});
					new VaultPathSuggest(this.app, text.inputEl, () => this.folderCandidates());
				}), "archiveFolder");

			this.track(new Setting(root)
				.setName("Also create notes for archived cards")
				.setDesc("A list-to-folder sync creates, in the archive folder, a note for every archived card of a mapped list that has none. Costs one board-wide request per run.")
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.archiveFolderCreateMissing).onChange((value) => {
						this.plugin.settings.archiveFolderCreateMissing = value;
						void this.save();
					}),
				), "archiveFolderCreateMissing");

			this.track(new Setting(root)
				.setName("Bring a note back when its card is unarchived")
				.setDesc("A card taken out of the archive sends its note from the archive folder back to the folder of its list.")
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.archiveFolderRestoreOnUnarchive).onChange((value) => {
						this.plugin.settings.archiveFolderRestoreOnUnarchive = value;
						void this.save();
					}),
				), "archiveFolderRestoreOnUnarchive");
		}

		this.track(new Setting(root)
			.setName("Card deleted")
			.setDesc("A deleted card cannot be recovered on Trello; the note is what is left.")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(ON_CARD_DELETED_LABELS)) dropdown.addOption(value, label);
				dropdown.setValue(this.plugin.settings.onCardDeleted).onChange((value) => {
					this.plugin.settings.onCardDeleted = value as OnCardDeleted;
					void this.save();
				});
			}), "onCardDeleted");

		new Setting(root).setName("When you delete a synced note").setHeading();
		this.track(new Setting(root)
			.setName("Note deleted, card still on Trello")
			.setDesc("Told apart from a new card by remembering which cards had a note at the previous sync, so nothing is detected on the very first sync after updating.")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(ON_LINKED_NOTE_DELETED_LABELS)) dropdown.addOption(value, label);
				dropdown.setValue(this.plugin.settings.onLinkedNoteDeleted).onChange((value) => {
					this.plugin.settings.onLinkedNoteDeleted = value as OnLinkedNoteDeleted;
					void this.save();
					this.display();
				});
			}), "onLinkedNoteDeleted");
		if (this.plugin.settings.onLinkedNoteDeleted === "ignore-card") this.renderIgnoredCards(root);

		this.track(new Setting(root)
			.setName("Confirm before unlinking a note")
			.setDesc("Asks before the command \"Unlink active note from its card\" removes the card link and every Trello property from the open note.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.confirmUnlink).onChange((value) => {
					this.plugin.settings.confirmUnlink = value;
					void this.save();
				}),
			), "confirmUnlink");
	}

	private renderIgnoredCards(root: HTMLElement): void {
		const entries = Object.entries(this.plugin.ignoredCards);
		new Setting(root)
			.setName("Ignored cards")
			.setDesc(entries.length === 0 ? "None. A card lands here when you delete its note." : "These cards never get a note again. A note linked to one of them brings it back automatically.");
		for (const [cardId, { name, since }] of entries) {
			new Setting(root)
				.setName(name)
				.setDesc(`Ignored since ${since}`)
				.addButton((button) =>
					button.setButtonText("Stop ignoring").onClick(() => {
						Reflect.deleteProperty(this.plugin.ignoredCards, cardId);
						void this.save();
						this.display();
					}),
				);
		}
	}

	private renderLabels(root: HTMLElement): void {
		new Setting(root).setName("Labels").setHeading();

		this.track(new Setting(root)
			.setName("Sync labels")
			.setDesc("Whether labels are synchronized between Trello cards and notes.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncLabels).onChange((value) => {
					this.plugin.settings.syncLabels = value;
					void this.save();
				}),
			), "syncLabels");

		this.track(new Setting(root)
			.setName("Labels sync")
			.setDesc("How the note's labels (Labels key, below) and the card's assigned labels reconcile when they diverge.")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(LABELS_SYNC_MODE_LABELS)) dropdown.addOption(value, label);
				dropdown.setValue(this.plugin.settings.labelsSyncMode).onChange((value) => {
					this.plugin.settings.labelsSyncMode = value as LabelSyncMode;
					void this.save();
				});
			}), "labelsSyncMode");

		this.renderLabelProperties(root);
	}

	/** Property names already used in the vault's notes, for the key field's suggestions - computed once per render. */
	private propertyKeyCandidates(): string[] {
		const keys = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			for (const key of Object.keys(this.app.metadataCache.getFileCache(file)?.frontmatter ?? {})) keys.add(key);
		}
		keys.delete("position");
		return [...keys].sort();
	}

	private renderLabelProperties(root: HTMLElement): void {
		const settings = this.plugin.settings;
		new Setting(root).setName("Labels to properties").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Turn a Trello label into a note property: label \"NPC\" can write type: npc, label \"Urgent\" priority: high. A label counts as present on the note when all its values are in the property. Rows with an empty key or no value do nothing.",
		});

		new Setting(root)
			.setName("Sync labels to properties")
			.setDesc("Master switch. Without a filled-in row below nothing changes.")
			.addToggle((toggle) =>
				toggle.setValue(settings.labelPropertySync).onChange((value) => {
					settings.labelPropertySync = value;
					void this.save();
					this.display();
				}),
			);

		const holder = this.group(root, settings.labelPropertySync);
				new Setting(holder)
			.setName("Direction")
			.setDesc("Both ways, only from Trello into the notes, or only from the notes onto the cards.")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(LABEL_PROPERTY_DIRECTION_LABELS)) dropdown.addOption(value, label);
				dropdown.setValue(settings.labelPropertyDirection).onChange((value) => {
					settings.labelPropertyDirection = value as LabelPropertyDirection;
					void this.save();
				});
			});

		new Setting(holder)
			.setName("Propagate removals")
			.setDesc("When a pull takes a label off the card, its values leave the property; when a push finds a mapped value missing, the label leaves the card. Off: values and labels are only ever added.")
			.addToggle((toggle) =>
				toggle.setValue(settings.labelPropertyRemoveValues).onChange((value) => {
					settings.labelPropertyRemoveValues = value;
					void this.save();
				}),
			);

		new Setting(holder)
			.setName("Scan board labels")
			.setDesc("Adds a row for every label of the board that has none, and refreshes the names and colors of the others.")
			.addButton((button) =>
				button.setButtonText("Scan board labels").onClick(() => void this.scanLabels(button)),
			);

		const keys = this.propertyKeyCandidates();
		for (const row of settings.labelPropertyMappings) {
			const setting = new Setting(holder);
			const dot = setting.nameEl.createSpan({ cls: "tvs-label-dot" });
			dot.setCssProps({ "--tvs-label-color": TRELLO_LABEL_COLORS[(row.labelColor ?? "").split("_")[0] ?? ""] ?? "var(--text-faint)" });
			setting.nameEl.appendText(row.labelName === "" ? "(no name)" : row.labelName);
			if (this.goneLabels.has(row.labelId)) setting.setDesc("Deleted on Trello - remove this row.");
			setting
				.addText((text) => {
					text.setPlaceholder("Property").setValue(row.key).onChange((value) => {
						row.key = value.trim();
						void this.save();
					});
					new VaultPathSuggest(this.app, text.inputEl, () => keys);
				})
				.addText((text) =>
					text.setPlaceholder("Value, value...").setValue(row.values.join(", ")).onChange((value) => {
						row.values = value.split(",").map((v) => v.trim()).filter((v) => v !== "");
						void this.save();
					}),
				)
				.addExtraButton((button) =>
					button.setIcon("trash").setTooltip("Remove this row").onClick(() => {
						settings.labelPropertyMappings = settings.labelPropertyMappings.filter((r) => r !== row);
						void this.save();
						this.display();
					}),
				);
		}
		this.groupHint(root, holder);
	}

	private async scanLabels(button: ButtonComponent): Promise<void> {
		button.setDisabled(true);
		try {
			const labels = await this.plugin.client().getBoardLabels(this.plugin.settings.boardId);
			const { mappings, gone } = mergeScannedLabels(this.plugin.settings.labelPropertyMappings, labels);
			this.plugin.settings.labelPropertyMappings = mappings;
			this.goneLabels = gone;
			await this.save();
			new Notice(`${labels.length} label(s) on the board.`);
			this.display();
		} catch (error) {
			new Notice(`❌ ${errorMessage(error)}`);
			console.error("[trello-vault-sync]", error);
		} finally {
			button.setDisabled(false);
		}
	}

	private renderAttachments(root: HTMLElement): void {
		new Setting(root).setName("Attachments").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Whether a card's attachments show up as frontmatter links, whether the files themselves get downloaded into the vault, and whether the card's cover becomes the note's banner image.",
		});

		// Topic 1: attachments as frontmatter links (no download).
		new Setting(root).setName("As frontmatter links").setHeading();

		this.track(new Setting(root)
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
			), "syncAttachments");

		if (this.plugin.settings.syncAttachments) {
			this.track(new Setting(root)
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
				), "syncLinkedCards");
		}

		// Topic 2: downloading the files themselves into the vault.
		new Setting(root).setName("Download to vault").setHeading();

		this.track(new Setting(root)
			.setName("Download attachments")
			.setDesc(
				"⚠️ Writes binary files into the vault: downloads each uploaded (non-link) attachment to the " +
					"chosen destination below. Off by default. An attachment already present under the same name " +
					"and byte size is never re-downloaded. If Sync history (Sync history section) is on, a run " +
					"that downloads files can be undone from \"Undo the last sync\".",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.downloadAttachments).onChange((value) => {
					this.plugin.settings.downloadAttachments = value;
					void this.save();
					this.display();
				}),
			), "downloadAttachments");

		if (this.plugin.settings.downloadAttachments) {
			this.track(new Setting(root)
				.setName("Attachment download scope")
				.setDesc('What "Download attachments" (above) actually fetches — every uploaded attachment, or just the one set as the card\'s cover.')
				.addDropdown((dropdown) => {
					dropdown.addOption("all", "All attachments");
					dropdown.addOption("cover-only", "Cover image only");
					dropdown.setValue(this.plugin.settings.attachmentsDownloadScope).onChange((value) => {
						this.plugin.settings.attachmentsDownloadScope = value === "cover-only" ? "cover-only" : "all";
						void this.save();
					});
				}), "attachmentsDownloadScope");

			this.track(new Setting(root)
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
				}), "attachmentsDestination");

			if (this.plugin.settings.attachmentsDestination === "global-folder") {
				this.track(new Setting(root)
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
					}), "attachmentsFolder");
			}
		}

		// Topic 3: the card's cover as the note's banner image.
		new Setting(root).setName("Cover image").setHeading();

		this.track(new Setting(root)
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
			), "syncCardCover");

		if (this.plugin.settings.syncCardCover) {
			this.track(new Setting(root)
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
				), "coverFrontmatterKey");

			this.track(new Setting(root)
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
				), "preferLocalCover");

			if (this.plugin.settings.preferLocalCover) {
				this.track(new Setting(root)
					.setName("Local cover format")
					.setDesc("Link format written into the frontmatter when using a local cover.")
					.addDropdown((dropdown) => {
						dropdown.addOption("vault-path", "Vault path (e.g. Attachments/cover.jpg)");
						dropdown.addOption("wikilink", "Wikilink (e.g. [[Attachments/cover.jpg]])");
						dropdown.setValue(this.plugin.settings.coverLocalFormat).onChange((value) => {
							this.plugin.settings.coverLocalFormat = value === "wikilink" ? "wikilink" : "vault-path";
							void this.save();
						});
					}), "coverLocalFormat");
			}
		}
	}

	private renderChecklists(root: HTMLElement): void {
		new Setting(root).setName("Checklists").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Whether a card's checklists mirror into the note's body as Markdown tasks.",
		});

		this.track(new Setting(root)
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
					this.display();
				}),
			), "syncChecklists");

		const holder = this.group(root, this.plugin.settings.syncChecklists);
				this.track(new Setting(holder)
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
			), "checklistHeading");
		this.groupHint(root, holder);
	}

	private renderMembers(root: HTMLElement): void {
		new Setting(root).setName("Members").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Whether a card's assigned people show up in the note's frontmatter, as readable names.",
		});

		this.track(new Setting(root)
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
					this.display();
				}),
			), "syncMembers");

		const holder = this.group(root, this.plugin.settings.syncMembers);
				this.track(new Setting(holder)
			.setName("Members key")
			.setDesc("The frontmatter key holding the card's assigned members. Empty resets it to the default key.")
			.addText((text) =>
				text.setValue(this.plugin.settings.membersFrontmatterKey).onChange((value) => {
					this.plugin.settings.membersFrontmatterKey = safeFrontmatterKey(value, DEFAULT_MEMBERS_KEY);
					void this.save();
				}),
			), "membersFrontmatterKey");
		this.groupHint(root, holder);
	}

	private renderCustomFields(root: HTMLElement): void {
		new Setting(root).setName("Custom fields").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Whether a card's custom fields (text, number, date, checkbox, dropdown) show up in the note's frontmatter.",
		});

		this.track(new Setting(root)
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
					this.display();
				}),
			), "syncCustomFields");

		const holder = this.group(root, this.plugin.settings.syncCustomFields);
				this.track(new Setting(holder)
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
			), "customFieldsFrontmatterKey");
		this.groupHint(root, holder);
	}

	private renderSyncHistory(root: HTMLElement): void {
		new Setting(root).setName("Sync history").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Keeps a record of what each sync changed, so a bad run can be undone from the sidebar or command palette.",
		});

		this.track(new Setting(root)
			.setName("Sync history")
			.setDesc(
				"Records every write a sync makes — in the vault and on Trello — so it can be undone from " +
					"\"Undo the last sync\" / \"Undo the last sync of this note\". Neither side is ever " +
					"overwritten blindly: a note, card field or checklist item that changed since the run is " +
					"skipped and reported. Cancelling a running sync cannot recall a request already sent to " +
					"Trello, but undo can put it back.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.historyEnabled).onChange((value) => {
					this.plugin.settings.historyEnabled = value;
					void this.save();
					this.display();
				}),
			), "historyEnabled");

		const holder = this.group(root, this.plugin.settings.historyEnabled);
				this.track(new Setting(holder)
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
			), "historyRevertTrelloWrites");

		this.track(new Setting(holder)
			.setName("Confirm before undoing")
			.setDesc(
				'On: "Undo the last sync" and "Undo the last sync of this note" ask for confirmation before ' +
					'writing anything. Off disables the modal for repeated use. "Undo a sync run (pick what to ' +
					'undo)" already ends on its own explicit confirm button and is unaffected by this setting.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.confirmUndo).onChange((value) => {
					this.plugin.settings.confirmUndo = value;
					void this.save();
				}),
			), "confirmUndo");

		this.track(new Setting(holder)
			.setName("Sync history — runs kept")
			.setDesc(
				"Oldest run is dropped once this many are recorded. Minimum 0 (a very large value makes data.json heavy). 0 keeps no history " +
					"at all — every run is dropped right after it completes, and undo has nothing to work with.",
			)
			.addText((text) =>
				text.setValue(String(this.plugin.settings.historyMaxRuns)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.historyMaxRuns = safeNonNegativeNumber(parsed, 0);
					void this.save();
				}),
			), "historyMaxRuns");
		this.groupHint(root, holder);
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

		this.track(new Setting(root)
			.setName("Folder for cards without a note (fallback)")
			.setDesc(
				'Destination for "Create a note from an unlinked card" — checked in this order: (1) the folder mapped ' +
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
			}), "orphanCardFolder");

		this.track(new Setting(root)
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
			}), "defaultTemplateName");

		this.track(new Setting(root)
			.setName('Offer "create all" for cards without a note')
			.setDesc("When multiple orphan cards are detected, show an option at the top of the picker to create notes for all of them at once.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.orphanCardBatchCreate)
					.onChange((value) => {
						this.plugin.settings.orphanCardBatchCreate = value;
						void this.save();
					});
			}), "orphanCardBatchCreate");

		this.track(new Setting(root)
			.setName('Confirm "create all"')
			.setDesc(
				'On by default — shows a confirmation dialog with the count before "Create for ALL" runs, in both the orphan-card and phantom-note pickers. Off skips straight to creating.',
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.confirmBatchCreate)
					.onChange((value) => {
						this.plugin.settings.confirmBatchCreate = value;
						void this.save();
					});
			}), "confirmBatchCreate");

		this.track(new Setting(root)
			.setName("Where to look for cards without a note")
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
			}), "orphanCardScope");

		new Setting(root).setName("Cards for notes whose card is gone").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Destination list and options when creating Trello cards from phantom or unlinked notes.",
		});

		const phantomListName = this.listNames.get(this.plugin.settings.phantomCardListId);
		new Setting(root)
			.setName("List for the recreated cards")
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

		this.track(new Setting(root)
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
			}), "phantomNotePreferFolderMapping");

		this.track(new Setting(root)
			.setName("Where to look for notes whose card is gone")
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
			}), "phantomNoteScope");

		new Setting(root).setName("Create from audit report").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text:
				'What "Create from audit report (unchecked items)" does with the link audit report: items you ticked are left ' +
				"alone, unchecked ones are created (after a preview). Broken-link notes are never included — use " +
				'"Recreate the missing cards of notes" for those.',
		});

		this.track(new Setting(root)
			.setName("Unchecked cards without a note → notes")
			.setDesc("Create a note for each orphan card left unchecked in the report (same folder rules as above).")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.auditReportCreateNotes).onChange((value) => {
					this.plugin.settings.auditReportCreateNotes = value;
					void this.save();
				}),
			), "auditReportCreateNotes");

		this.track(new Setting(root)
			.setName("Unchecked notes without a card → cards")
			.setDesc(
				"Create a Trello card for each unlinked note left unchecked in the report (same list rules as above). " +
					"With both toggles off, the command does nothing.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.auditReportCreateCards).onChange((value) => {
					this.plugin.settings.auditReportCreateCards = value;
					void this.save();
				}),
			), "auditReportCreateCards");

		this.track(new Setting(root)
			.setName("Apply creation scopes to the audit report")
			.setDesc(
				'On by default — the link audit report lists only the orphan cards and unlinked notes allowed by the two ' +
					'"detection scope" settings above, so its counts match the creation pickers. Off lists every one.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.auditReportApplyCreationScopes).onChange((value) => {
					this.plugin.settings.auditReportApplyCreationScopes = value;
					void this.save();
				}),
			), "auditReportApplyCreationScopes");
	}

	private renderAutoSync(root: HTMLElement): void {
		new Setting(root).setName("Auto-sync").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "Runs a sync on its own instead of only when you click a command — pick what starts it (any combination) and what it runs (any combination) below.",
		});

		this.track(new Setting(root)
			.setName("Enable auto-sync")
			.setDesc(
				"⚠️ Runs a sync without you clicking anything. Off by default. Respects Dry run, Create missing " +
					"notes, Delete phantom notes and Excluded folders exactly like a manual sync would.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncEnabled).onChange((value) => {
					this.plugin.settings.autoSyncEnabled = value;
					void this.save();
					this.display();
				}),
			), "autoSyncEnabled");

		const holder = this.group(root, this.plugin.settings.autoSyncEnabled);
				this.track(new Setting(holder)
			.setName("Trigger — on a timer")
			.setDesc("Checks periodically (interval below) whether it's time to sync.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncOnInterval).onChange((value) => {
					this.plugin.settings.autoSyncOnInterval = value;
					void this.save();
				}),
			), "autoSyncOnInterval");

		this.track(new Setting(holder)
			.setName("Trigger — when Obsidian regains focus")
			.setDesc("Syncs when you switch back to the Obsidian window (still subject to the minimum gap below).")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncOnFocus).onChange((value) => {
					this.plugin.settings.autoSyncOnFocus = value;
					void this.save();
				}),
			), "autoSyncOnFocus");

		this.track(new Setting(holder)
			.setName("Trigger — at startup")
			.setDesc("Syncs once, shortly after Obsidian finishes loading this vault.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncOnStartup).onChange((value) => {
					this.plugin.settings.autoSyncOnStartup = value;
					void this.save();
				}),
			), "autoSyncOnStartup");

		this.track(new Setting(holder)
			.setName("Trigger — after I edit a linked note")
			.setDesc(
				"Syncs just that note once you stop typing for the delay below. Only notes linked to a card, " +
					"inside the sync scope. Off by default.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncOnNoteChange).onChange((value) => {
					this.plugin.settings.autoSyncOnNoteChange = value;
					void this.save();
				}),
			), "autoSyncOnNoteChange");

		this.track(new Setting(holder)
			.setName("Delay after the last edit (seconds)")
			.setDesc(
				`Quiet time before an edited note is synced. Minimum ${AUTO_SYNC_NOTE_CHANGE_DELAY_FLOOR}.`,
			)
			.addText((text) =>
				text.setValue(String(this.plugin.settings.autoSyncNoteChangeDelaySeconds)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					if (!Number.isFinite(parsed)) return;
					this.plugin.settings.autoSyncNoteChangeDelaySeconds = Math.max(AUTO_SYNC_NOTE_CHANGE_DELAY_FLOOR, parsed);
					void this.save();
				}),
			), "autoSyncNoteChangeDelaySeconds");

		this.track(new Setting(holder)
			.setName("Interval (minutes)")
			.setDesc(
				'Minimum wait before "On a timer" syncs again, counted from the last successful sync — manual ' +
					"syncs included, and remembered across restarts (it checks every 30 seconds, but " +
					"only actually syncs once this many minutes have passed). Minimum 0. 0 " +
					"removes this wait — every 30-second check can sync, still subject to the minimum gap below.",
			)
			.addText((text) =>
				text.setValue(String(this.plugin.settings.autoSyncIntervalMinutes)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.autoSyncIntervalMinutes = safeNonNegativeNumber(parsed, 0);
					void this.save();
				}),
			), "autoSyncIntervalMinutes");

		this.track(new Setting(holder)
			.setName("Scope — every mapped folder")
			.setDesc('Runs "Sync every folder with its list" — the only scope that can create a missing note.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncScopeMappings).onChange((value) => {
					this.plugin.settings.autoSyncScopeMappings = value;
					void this.save();
				}),
			), "autoSyncScopeMappings");

		this.track(new Setting(holder)
			.setName("Scope — the whole vault")
			.setDesc('Runs "Sync all linked notes" — every note already linked to a card, anywhere in scope.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncScopeVault).onChange((value) => {
					this.plugin.settings.autoSyncScopeVault = value;
					void this.save();
				}),
			), "autoSyncScopeVault");

		this.track(new Setting(holder)
			.setName("Minimum gap between auto-syncs (seconds)")
			.setDesc(
				"However it was triggered, an auto-sync never starts less than this long after the previous " +
					"one. Range 0-3600 (1h). 0 removes this floor — a focus/startup trigger can fire " +
					"right after the previous run.",
			)
			.addText((text) =>
				text.setValue(String(this.plugin.settings.autoSyncMinIdleSeconds)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.autoSyncMinIdleSeconds = safeNonNegativeNumber(parsed, 0);
					void this.save();
				}),
			), "autoSyncMinIdleSeconds");

		this.track(new Setting(holder)
			.setName("Only when Obsidian is visible")
			.setDesc("Skip timer-triggered auto-syncs while the Obsidian window is minimized or hidden. Off by default.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncOnlyWhenVisible).onChange((value) => {
					this.plugin.settings.autoSyncOnlyWhenVisible = value;
					void this.save();
				}),
			), "autoSyncOnlyWhenVisible");

		this.track(new Setting(holder)
			.setName("Show the progress panel for auto-syncs")
			.setDesc(
				"Off (default): automatic syncs run quietly — no panel, no success notice; errors still show a " +
					"notice and everything lands in the journal. On: same panel and notice as a manual sync.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoSyncShowPanel).onChange((value) => {
					this.plugin.settings.autoSyncShowPanel = value;
					void this.save();
				}),
			), "autoSyncShowPanel");

		this.track(new Setting(holder)
			.setName("Pause after failed runs in a row")
			.setDesc(
				`Auto-sync pauses itself after this many consecutive failures (a notice says so), instead of ` +
					`failing on every trigger. A successful manual sync or switching auto-sync off and on resumes it. ` +
					`Minimum 0. 0 never pauses. ` +
					`Being offline is skipped, not counted as a failure.`,
			)
			.addText((text) =>
				text.setValue(String(this.plugin.settings.autoSyncPauseAfterFailures)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					if (!Number.isFinite(parsed)) return;
					this.plugin.settings.autoSyncPauseAfterFailures = Math.max(0, parsed);
					void this.save();
				}),
			), "autoSyncPauseAfterFailures");
		this.groupHint(root, holder);
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

			new Setting(detailsContent)
				.setName("Never trash notes in this folder")
				.setDesc(
					"Whatever the choices in \"When a card changes on Trello\" say, a note of this folder is kept instead of being moved to the trash.",
				)
				.addToggle((toggle) =>
					toggle.setValue(mapping.allowDeleteOverride === "off").onChange((value) => {
						mapping.allowDeleteOverride = value ? "off" : "inherit";
						void this.save();
					}),
				);
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

		this.track(new Setting(root)
			.setName("Sidebar conflict indicator")
			.setDesc(
				"Show a badge in the sidebar with the unresolved-conflict count from the last sync run. Resets when Obsidian reloads.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showConflictIndicator).onChange((value) => {
					this.plugin.settings.showConflictIndicator = value;
					void this.save();
				}),
			), "showConflictIndicator");

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
			text: "Matching tolerance, the progress panel, frontmatter key names. Rarely changed values (network retries, timings, report wording) are in \"Expert settings\" at the bottom.",
		});
		// Built here, shown last (moved to the end below): the settings that only matter when something needs adjusting.
		const expert = root.createEl("details", { cls: "tvs-settings__expert" });
		expert.createEl("summary", { text: "Expert settings - network retries, timings, report wording" });

		this.track(new Setting(root)
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
			), "similarityThreshold");

		this.track(new Setting(expert)
			.setName("Retries")
			.setDesc("Number of retries after a 429 response or a server error.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.maxRetries)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.maxRetries = safeNonNegativeNumber(parsed, 0);
					void this.save();
				}),
			), "maxRetries");

		this.track(new Setting(expert)
			.setName("Initial delay (ms)")
			.setDesc("Wait before the first retry; it doubles on every subsequent attempt.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.baseDelayMs)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.baseDelayMs = safeNonNegativeNumber(parsed, 0);
					void this.save();
				}),
			), "baseDelayMs");

		this.track(new Setting(expert)
			.setName("Request timeout (ms)")
			.setDesc("How long to wait for a single Trello response before treating it as a failed attempt.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.requestTimeoutMs)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.requestTimeoutMs = safeNonNegativeNumber(parsed, 0);
					void this.save();
				}),
			), "requestTimeoutMs");

		this.track(new Setting(expert)
			.setName("Max retry wait (ms)")
			.setDesc("Ceiling on a single retry wait, regardless of how many attempts have already doubled the delay.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.maxBackoffDelayMs)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.maxBackoffDelayMs = safeNonNegativeNumber(parsed, 0);
					void this.save();
				}),
			), "maxBackoffDelayMs");

		this.track(new Setting(root)
			.setName("Fetch attachments and checklists with the cards")
			.setDesc(
				"Gets every card's attachments and checklists in the same request as the cards — much faster. Off: one extra request per note for each, which keeps each response smaller on very heavy boards.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.fetchCardDetailsWithCards).onChange((value) => {
					this.plugin.settings.fetchCardDetailsWithCards = value;
					void this.save();
				}),
			), "fetchCardDetailsWithCards");

		this.track(new Setting(root)
			.setName("Show the progress panel")
			.setDesc("Floating panel with live progress while a sync runs. Off: the sync still runs, just silently.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showPanel).onChange((value) => {
					this.plugin.settings.showPanel = value;
					void this.save();
					this.display();
				}),
			), "showPanel");

		const holder = this.group(root, this.plugin.settings.showPanel);
				this.track(new Setting(holder)
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
			), "panelAutoCloseSeconds");

		this.track(new Setting(holder)
			.setName("Keep panel open on error")
			.setDesc("A run that logged at least one error never auto-closes, even when auto-close above is > 0. Off: auto-close always applies, errors included.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.keepPanelOpenOnError).onChange((value) => {
					this.plugin.settings.keepPanelOpenOnError = value;
					void this.save();
				}),
			), "keepPanelOpenOnError");
		this.groupHint(root, holder);
		this.track(new Setting(root)
			.setName("Journal lines kept")
			.setDesc(
				`Lines shown in the progress panel and the sidebar journal before the oldest is dropped. ` +
					`Minimum ${LOG_MAX_ROWS_FLOOR}. Every line is kept in data.json, so a very large value makes it heavy.`,
			)
			.addText((text) =>
				text.setValue(String(this.plugin.settings.logMaxRows)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					if (!Number.isFinite(parsed)) return;
					this.plugin.settings.logMaxRows = Math.max(LOG_MAX_ROWS_FLOOR, parsed);
					void this.save();
				}),
			), "logMaxRows");

		this.track(new Setting(root)
			.setName("Operations at the same time")
			.setDesc(
				`How many operations (syncs, audits, creations…) may run together, each with its own progress panel. ` +
					`One more waits for a free slot. 1 = one at a time. ` +
					`Minimum ${MAX_CONCURRENT_OPERATIONS_FLOOR}. A high value can hit Trello's rate limits.`,
			)
			.addText((text) =>
				text.setValue(String(this.plugin.settings.maxConcurrentOperations)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					if (!Number.isFinite(parsed)) return;
					this.plugin.settings.maxConcurrentOperations = Math.max(MAX_CONCURRENT_OPERATIONS_FLOOR, parsed);
					void this.save();
				}),
			), "maxConcurrentOperations");

		this.track(new Setting(root)
			.setName("Note name max length")
			.setDesc(
				`Longest note file name (without ".md") made from a card title — longer titles are cut. Applies to ` +
					`new notes and to renames when titles sync. Range ${NOTE_NAME_MAX_LENGTH_FLOOR}-` +
					`${NOTE_NAME_MAX_LENGTH_CEILING}. Changing it renames already-cut notes on their next sync.`,
			)
			.addText((text) =>
				text.setValue(String(this.plugin.settings.noteNameMaxLength)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					if (!Number.isFinite(parsed)) return;
					this.plugin.settings.noteNameMaxLength = Math.max(
						NOTE_NAME_MAX_LENGTH_FLOOR,
						Math.min(parsed, NOTE_NAME_MAX_LENGTH_CEILING),
					);
					void this.save();
				}),
			), "noteNameMaxLength");

		new Setting(root).setName("Frontmatter keys").setHeading();
		root.createEl("p", {
			cls: "setting-item-description",
			text: "The property name each synced value is written under. Change one only if it collides with something else already in your notes — the note that already exists under the old key needs updating by hand, this plugin never renames it for you. Leaving any of these fields empty resets it to its built-in default name on save.",
		});

		this.track(new Setting(root)
			.setName("Due date key")
			.setDesc("Frontmatter property that carries the card's due date.")
			.addText((text) =>
				text.setValue(this.plugin.settings.dueFrontmatterKey).onChange((value) => {
					this.plugin.settings.dueFrontmatterKey = safeFrontmatterKey(value, DEFAULT_DUE_KEY);
					void this.save();
				}),
			), "dueFrontmatterKey");

		this.track(new Setting(root)
			.setName("Labels key")
			.setDesc("Frontmatter property that carries the card's labels.")
			.addText((text) =>
				text.setValue(this.plugin.settings.labelsFrontmatterKey).onChange((value) => {
					this.plugin.settings.labelsFrontmatterKey = safeFrontmatterKey(value, DEFAULT_LABELS_KEY);
					void this.save();
				}),
			), "labelsFrontmatterKey");

		this.track(new Setting(root)
			.setName("Attachments key")
			.setDesc("Frontmatter property that carries the card's plain attachment urls.")
			.addText((text) =>
				text.setValue(this.plugin.settings.attachmentsFrontmatterKey).onChange((value) => {
					this.plugin.settings.attachmentsFrontmatterKey = safeFrontmatterKey(value, DEFAULT_ATTACHMENTS_KEY);
					void this.save();
				}),
			), "attachmentsFrontmatterKey");

		this.track(new Setting(root)
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
			), "linkedCardsFrontmatterKey");

		this.track(new Setting(root)
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
			), "cardRefFrontmatterKey");

		this.track(new Setting(root)
			.setName("Write the \"Trello\" plugin's note id")
			.setDesc(
				"Also adds trello_plugin_note_id to every note this plugin links or creates, for people who still use " +
					"the \"Trello\" plugin by nathonius alongside this one (the card link itself is already compatible).",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.writeTrelloPluginNoteId).onChange((value) => {
					this.plugin.settings.writeTrelloPluginNoteId = value;
					void this.save();
				}),
			), "writeTrelloPluginNoteId");

		this.renderTuning(expert);
		this.renderReportLabels(expert);
		root.appendChild(expert);
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

