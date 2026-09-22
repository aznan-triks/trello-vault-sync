import { ItemView, Setting, setIcon, type App, type WorkspaceLeaf } from "obsidian";
import type { CommandContext } from "../commands/context";
import { ALL_SECTIONS, COMMANDS, type CommandDescriptor, type CommandSection } from "../commands/registry";
import type { LogLevel } from "../core/journal";
import { hasCredentials } from "../settings/types";
import { MAX_LOG_ROWS, renderLogRow } from "./ProgressPanel";

/**
 * `App.setting` opens/targets the settings dialog but isn't part of Obsidian's
 * public type declarations — this is the minimal typed shape plugins rely on
 * instead of casting to `any`. "trello-vault-sync" mirrors `manifest.json`'s
 * `id`: an internal identifier, not a user-configurable value (§1.4 no-hardcode
 * targets numbers/paths/URLs/thresholds/delays/labels, not this).
 */
interface AppWithSettingDialog extends App {
	setting: { open(): void; openTabById(id: string): void };
}

export const VIEW_TYPE_TVS_SIDEBAR = "trello-vault-sync-sidebar";

type NavSection = "All" | CommandSection;

type ActionTone = "sync" | "pull" | "push" | "link" | "audit" | "history" | "default";

function getActionTone(id: string): ActionTone {
	if (id.startsWith("sync-")) return "sync";
	if (id.includes("pull")) return "pull";
	if (id.includes("push")) return "push";
	if (id.startsWith("link-") || id === "create-note-from-card") return "link";
	if (id.startsWith("audit-") || id === "export-changes-html") return "audit";
	if (id.includes("undo") || id === "show-sync-history" || id === "resolve-conflict") return "history";
	return "default";
}

/**
 * Persistent sidebar counterpart to the command palette: compact action cards
 * with instant filtering, category navigation, quick dry-run toggle, and
 * persistent activity log, delegating to `src/commands/*.ts` handlers.
 */
export class SidebarView extends ItemView {
	/** Set by `render()` while the view is ready — null while `renderNotReady()` shows instead. */
	private journalEl: HTMLElement | null = null;
	private journalEmptyEl: HTMLElement | null = null;
	private journalCountBadgeEl: HTMLElement | null = null;
	private commandsListEl: HTMLElement | null = null;
	private activeTab: NavSection = "All";
	private searchQuery = "";

	constructor(
		leaf: WorkspaceLeaf,
		private readonly ctx: CommandContext,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return VIEW_TYPE_TVS_SIDEBAR;
	}

	override getDisplayText(): string {
		return "Trello Vault Sync";
	}

	override getIcon(): string {
		return "panel-right";
	}

	override async onOpen(): Promise<void> {
		this.render();
		const workspace = this.app?.workspace ?? this.ctx.app?.workspace;
		if (workspace && typeof this.registerEvent === "function") {
			this.registerEvent(
				workspace.on("layout-change", () => {
					if (!this.hasContent()) {
						this.render();
					}
				}),
			);
			this.registerEvent(
				workspace.on("active-leaf-change", (leaf) => {
					if (leaf === this.leaf && !this.hasContent()) {
						this.render();
					}
				}),
			);
		}
	}

	override onResize(): void {
		if (typeof (super.onResize as unknown) === "function") {
			super.onResize();
		}
		if (!this.hasContent()) {
			this.render();
		}
	}

	private hasContent(): boolean {
		if (typeof this.contentEl?.hasChildNodes === "function") {
			return this.contentEl.hasChildNodes();
		}
		return Boolean(this.contentEl?.children && this.contentEl.children.length > 0);
	}

	override async onClose(): Promise<void> {}

	/** Called after any settings save so a change made elsewhere (settings tab, palette toggle) shows up here. */
	refresh(): void {
		this.render();
	}

	/**
	 * Appends one journal row without rebuilding the whole view — `refresh()`
	 * would redraw all command buttons on every log line, which a large
	 * sync fires many times a second.
	 */
	appendJournalEntry(level: LogLevel, message: string): void {
		if (!this.journalEl) return;
		if (this.journalEmptyEl) {
			this.journalEmptyEl.remove();
			this.journalEmptyEl = null;
		}
		renderLogRow(this.journalEl, level, message, MAX_LOG_ROWS);
		this.updateJournalBadge();
	}

	private updateJournalBadge(): void {
		if (!this.journalCountBadgeEl) return;
		const count = this.journalEl ? this.journalEl.querySelectorAll(".tvs-panel__row").length : Math.min(this.ctx.journal.length, MAX_LOG_ROWS);
		this.journalCountBadgeEl.setText(String(count));
	}

	private openSettingsTab(): void {
		const app = this.ctx.app as AppWithSettingDialog;
		app.setting.open();
		app.setting.openTabById("trello-vault-sync");
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("tvs-sidebar");
		this.journalEl = null;
		this.journalEmptyEl = null;
		this.journalCountBadgeEl = null;
		this.commandsListEl = null;

		// Same predicate ctx.ready() uses, called directly (not through ready()) to
		// avoid its Notice side effect firing on every render.
		if (!hasCredentials(this.ctx.settings)) {
			this.renderNotReady(contentEl);
			return;
		}

		this.renderHeader(contentEl);
		this.renderQuickControls(contentEl);
		this.renderSearchAndNav(contentEl);
		this.renderCommandsContainer(contentEl);
		this.renderActivitySection(contentEl);
	}

	private renderHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: "tvs-sidebar__header" });

		const titleGroup = header.createDiv({ cls: "tvs-sidebar__title-group" });
		const iconEl = titleGroup.createSpan({ cls: "tvs-sidebar__title-icon" });
		setIcon(iconEl, "kanban-square");
		titleGroup.createEl("h3", { cls: "tvs-sidebar__title", text: "Trello Vault Sync" });

		const actions = header.createDiv({ cls: "tvs-sidebar__header-actions" });

		const refreshBtn = actions.createEl("button", {
			cls: "clickable-icon tvs-sidebar__icon-btn",
			attr: { "aria-label": "Refresh view", title: "Refresh", tabindex: "0" },
		});
		setIcon(refreshBtn, "rotate-cw");
		refreshBtn.addEventListener("click", () => this.render());

		const settingsBtn = actions.createEl("button", {
			cls: "clickable-icon tvs-sidebar__icon-btn",
			attr: { "aria-label": "Open settings", title: "Open settings", tabindex: "0" },
		});
		setIcon(settingsBtn, "settings");
		settingsBtn.addEventListener("click", () => this.openSettingsTab());
	}

	private renderQuickControls(root: HTMLElement): void {
		const card = root.createDiv({ cls: "tvs-sidebar__control-card" });

		const badgesRow = card.createDiv({ cls: "tvs-sidebar__status-row" });
		const readyBadge = badgesRow.createSpan({ cls: "tvs-badge tvs-badge--ok" });
		const readyIcon = readyBadge.createSpan({ cls: "tvs-badge__icon" });
		setIcon(readyIcon, "check-circle-2");
		readyBadge.createSpan({ text: "Ready" });

		const mappingsCount = this.ctx.settings.mappings.length;
		const mappingsBadge = badgesRow.createSpan({ cls: "tvs-badge tvs-badge--accent" });
		mappingsBadge.setText(`${mappingsCount} mapping${mappingsCount === 1 ? "" : "s"}`);

		const dryRunRow = card.createDiv({ cls: "tvs-sidebar__dryrun-row" });
		const labelGroup = dryRunRow.createDiv({ cls: "tvs-sidebar__dryrun-label-group" });
		labelGroup.createSpan({ cls: "tvs-sidebar__dryrun-label", text: "Dry run mode" });

		const modeBadge = labelGroup.createSpan({
			cls: `tvs-badge ${this.ctx.settings.dryRun ? "tvs-badge--warn" : ""}`,
			text: this.ctx.settings.dryRun ? "SIMULATION" : "LIVE",
		});

		new Setting(dryRunRow).addToggle((toggle) =>
			toggle.setValue(this.ctx.settings.dryRun).onChange((value) => {
				this.ctx.settings.dryRun = value;
				void this.ctx.saveSettings();
				modeBadge.setText(value ? "SIMULATION" : "LIVE");
				modeBadge.toggleClass("tvs-badge--warn", value);
			}),
		);
	}

	private renderSearchAndNav(root: HTMLElement): void {
		const filterContainer = root.createDiv({ cls: "tvs-sidebar__filter-container" });

		const searchBox = filterContainer.createDiv({ cls: "tvs-sidebar__search-box" });
		const searchIcon = searchBox.createSpan({ cls: "tvs-sidebar__search-icon" });
		setIcon(searchIcon, "search");

		const inputEl = searchBox.createEl("input", {
			cls: "tvs-sidebar__search-input",
			type: "search",
			attr: { placeholder: "Filter actions...", spellcheck: "false" },
		});
		inputEl.value = this.searchQuery;

		const clearBtn = searchBox.createSpan({
			cls: `tvs-sidebar__search-clear ${this.searchQuery ? "" : "is-hidden"}`,
			attr: { "aria-label": "Clear search", title: "Clear", role: "button", tabindex: "0" },
		});
		setIcon(clearBtn, "x");

		const doClear = () => {
			inputEl.value = "";
			this.searchQuery = "";
			clearBtn.addClass("is-hidden");
			this.renderCommandList();
			inputEl.focus();
		};

		clearBtn.addEventListener("click", doClear);
		clearBtn.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				doClear();
			}
		});

		inputEl.addEventListener("input", () => {
			this.searchQuery = inputEl.value.trim().toLowerCase();
			clearBtn.toggleClass("is-hidden", !this.searchQuery);
			this.renderCommandList();
		});

		const nav = filterContainer.createDiv({ cls: "tvs-sidebar__nav" });
		const categories: NavSection[] = ["All", ...ALL_SECTIONS];

		for (const cat of categories) {
			const count = cat === "All" ? COMMANDS.length : COMMANDS.filter((c) => c.section === cat).length;
			const btn = nav.createEl("button", {
				cls: `tvs-sidebar__tab-btn ${this.activeTab === cat ? "is-active" : ""}`,
				attr: { role: "tab", "aria-selected": String(this.activeTab === cat) },
			});
			btn.createSpan({ cls: "tvs-sidebar__tab-name", text: cat });
			btn.createSpan({ cls: "tvs-sidebar__tab-count", text: String(count) });

			btn.addEventListener("click", () => {
				this.activeTab = cat;
				nav.querySelectorAll(".tvs-sidebar__tab-btn").forEach((el) => {
					el.removeClass("is-active");
					el.setAttribute("aria-selected", "false");
				});
				btn.addClass("is-active");
				btn.setAttribute("aria-selected", "true");
				this.renderCommandList();
			});
		}
	}

	private renderCommandsContainer(root: HTMLElement): void {
		this.commandsListEl = root.createDiv({ cls: "tvs-sidebar__commands-container" });
		this.renderCommandList();
	}

	private renderCommandList(): void {
		if (!this.commandsListEl) return;
		this.commandsListEl.empty();

		const query = this.searchQuery;
		const activeTab = this.activeTab;

		const matches = COMMANDS.filter((cmd) => {
			const matchesCategory = activeTab === "All" || cmd.section === activeTab;
			if (!matchesCategory) return false;
			if (!query) return true;
			return (
				cmd.name.toLowerCase().includes(query) ||
				cmd.id.toLowerCase().includes(query) ||
				cmd.section.toLowerCase().includes(query)
			);
		});

		if (query) {
			const countBox = this.commandsListEl.createDiv({ cls: "tvs-sidebar__search-results-bar" });
			countBox.createSpan({
				cls: "tvs-sidebar__search-results-text",
				text: `Found ${matches.length} action${matches.length === 1 ? "" : "s"}`,
			});
		}

		if (matches.length === 0) {
			const emptyEl = this.commandsListEl.createDiv({ cls: "tvs-sidebar__empty-filter" });
			const iconEl = emptyEl.createSpan({ cls: "tvs-sidebar__empty-icon" });
			setIcon(iconEl, "search-x");
			emptyEl.createSpan({ cls: "tvs-sidebar__empty-text", text: "No actions match your filter." });
			const resetBtn = emptyEl.createEl("button", {
				cls: "tvs-sidebar__reset-btn",
				text: "Reset filters",
			});
			resetBtn.addEventListener("click", () => {
				this.searchQuery = "";
				this.activeTab = "All";
				this.render();
			});
			return;
		}

		if (activeTab === "All" && !query) {
			for (const section of ALL_SECTIONS) {
				const sectionCommands = matches.filter((c) => c.section === section);
				if (sectionCommands.length === 0) continue;

				const sectionBox = this.commandsListEl.createDiv({ cls: "tvs-sidebar__section" });
				const sectionHeader = sectionBox.createDiv({ cls: "tvs-sidebar__section-header" });
				sectionHeader.createSpan({ cls: "tvs-sidebar__section-title", text: section });
				sectionHeader.createSpan({ cls: "tvs-sidebar__section-count", text: String(sectionCommands.length) });

				const list = sectionBox.createDiv({ cls: "tvs-sidebar__action-list" });
				for (const cmd of sectionCommands) {
					this.renderActionItem(list, cmd);
				}
			}
		} else {
			const list = this.commandsListEl.createDiv({ cls: "tvs-sidebar__action-list" });
			for (const cmd of matches) {
				this.renderActionItem(list, cmd);
			}
		}
	}

	private renderActionItem(list: HTMLElement, cmd: CommandDescriptor): void {
		const actionEl = list.createDiv({
			cls: "tvs-sidebar__action",
			attr: {
				role: "button",
				tabindex: "0",
				"aria-label": `${cmd.name} (${cmd.section})`,
			},
		});

		const tone = getActionTone(cmd.id);
		const iconHolder = actionEl.createSpan({
			cls: `tvs-sidebar__action-icon tvs-sidebar__action-icon--${tone}`,
			attr: { tabindex: "-1" },
		});
		setIcon(iconHolder, cmd.icon);

		const body = actionEl.createDiv({ cls: "tvs-sidebar__action-body" });
		body.createSpan({ cls: "tvs-sidebar__action-title", text: cmd.name });

		if (this.activeTab === "All" && this.searchQuery) {
			body.createSpan({ cls: "tvs-sidebar__action-badge", text: cmd.section });
		}

		const arrow = actionEl.createSpan({ cls: "tvs-sidebar__action-arrow" });
		setIcon(arrow, "chevron-right");

		const triggerCmd = () => {
			void cmd.run(this.ctx);
		};

		actionEl.addEventListener("click", triggerCmd);
		actionEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				triggerCmd();
			}
		});
	}

	private renderActivitySection(root: HTMLElement): void {
		const activity = root.createDiv({ cls: "tvs-sidebar__activity-card" });
		const header = activity.createDiv({ cls: "tvs-sidebar__activity-header" });

		const titleGroup = header.createDiv({ cls: "tvs-sidebar__activity-title-group" });
		const iconEl = titleGroup.createSpan({ cls: "tvs-sidebar__activity-icon" });
		setIcon(iconEl, "activity");
		titleGroup.createSpan({ cls: "tvs-sidebar__activity-title", text: "Activity log" });

		this.journalCountBadgeEl = titleGroup.createSpan({
			cls: "tvs-sidebar__journal-count-badge",
			text: String(Math.min(this.ctx.journal.length, MAX_LOG_ROWS)),
		});

		const clearBtn = header.createEl("button", {
			cls: "clickable-icon tvs-sidebar__clear-btn",
			attr: { "aria-label": "Clear activity view", title: "Clear display" },
		});
		setIcon(clearBtn, "trash-2");
		clearBtn.addEventListener("click", () => {
			if (this.journalEl) {
				this.journalEl.empty();
				this.journalEmptyEl = this.journalEl.createDiv({
					cls: "tvs-sidebar__journal-empty",
					text: "No recent activity.",
				});
				this.updateJournalBadge();
			}
		});

		this.journalEl = activity.createDiv({ cls: "tvs-sidebar__journal" });

		if (this.ctx.journal.length === 0) {
			this.journalEmptyEl = this.journalEl.createDiv({
				cls: "tvs-sidebar__journal-empty",
				text: "No recent activity. Run an action to see output here.",
			});
		} else {
			this.journalEmptyEl = null;
			for (const entry of this.ctx.journal) {
				renderLogRow(this.journalEl, entry.level, entry.message, MAX_LOG_ROWS);
			}
		}
	}

	private renderNotReady(root: HTMLElement): void {
		const box = root.createDiv({ cls: "tvs-sidebar__not-ready" });

		const iconEl = box.createDiv({ cls: "tvs-sidebar__not-ready-icon" });
		setIcon(iconEl, "key-round");

		box.createEl("h4", { cls: "tvs-sidebar__not-ready-title", text: "Trello Credentials Required" });
		box.createEl("p", {
			cls: "tvs-sidebar__not-ready-desc",
			text: "Set your Trello API key and token in the plugin settings to enable synchronization, audits, and automation.",
		});

		const btn = box.createEl("button", {
			cls: "mod-cta tvs-sidebar__not-ready-btn",
		});
		const btnIcon = btn.createSpan({ cls: "tvs-sidebar__btn-icon" });
		setIcon(btnIcon, "settings");
		btn.createSpan({ text: "Open settings" });

		btn.addEventListener("click", () => this.openSettingsTab());
	}
}
