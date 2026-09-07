import { ItemView, Setting, type App, type WorkspaceLeaf } from "obsidian";
import type { CommandContext } from "../commands/context";
import { ALL_SECTIONS, COMMANDS } from "../commands/registry";
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

/**
 * Persistent sidebar counterpart to the command palette: one button per
 * existing command, delegating to the same `src/commands/*.ts` handlers
 * (same `ProgressPanel` shows up while a command runs).
 */
export class SidebarView extends ItemView {
	/** Set by `render()` while the view is ready — null while `renderNotReady()` shows instead. */
	private journalEl: HTMLElement | null = null;

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
	}

	override async onClose(): Promise<void> {}

	/** Called after any settings save so a change made elsewhere (settings tab, palette toggle) shows up here. */
	refresh(): void {
		this.render();
	}

	/**
	 * Appends one journal row without rebuilding the whole view — `refresh()`
	 * would redraw all 11 command buttons on every log line, which a large
	 * sync fires many times a second.
	 */
	appendJournalEntry(level: LogLevel, message: string): void {
		if (!this.journalEl) return;
		renderLogRow(this.journalEl, level, message, MAX_LOG_ROWS);
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("tvs-sidebar");
		this.journalEl = null;

		// Same predicate ctx.ready() uses, called directly (not through ready()) to
		// avoid its Notice side effect firing on every render.
		if (!hasCredentials(this.ctx.settings)) {
			this.renderNotReady(contentEl);
			return;
		}

		for (const section of ALL_SECTIONS) {
			new Setting(contentEl).setName(section).setHeading();
			for (const command of COMMANDS.filter((c) => c.section === section)) {
				new Setting(contentEl)
					.setName(command.name)
					.addButton((button) => button.setIcon(command.icon).onClick(() => void command.run(this.ctx)));
			}
		}

		new Setting(contentEl).setName("Settings").setHeading();
		new Setting(contentEl)
			.setName("Dry run")
			.setDesc("Plan every change without writing anything.")
			.addToggle((toggle) =>
				toggle.setValue(this.ctx.settings.dryRun).onChange(async (value) => {
					this.ctx.settings.dryRun = value;
					await this.ctx.saveSettings();
				}),
			);

		new Setting(contentEl).setName("Activity").setHeading();
		this.journalEl = contentEl.createDiv({ cls: "tvs-sidebar__journal" });
		// Oldest first in storage, so hydrating in stored order — each row
		// prepended in turn — ends up newest-first, matching appendJournalEntry().
		for (const entry of this.ctx.journal) renderLogRow(this.journalEl, entry.level, entry.message, MAX_LOG_ROWS);
	}

	private renderNotReady(root: HTMLElement): void {
		root.createEl("p", {
			cls: "tvs-sidebar__empty",
			text: "Set your Trello API key and token in the plugin settings to use these commands.",
		});
		new Setting(root).addButton((button) =>
			button.setButtonText("Open settings").onClick(() => {
				const app = this.ctx.app as AppWithSettingDialog;
				app.setting.open();
				app.setting.openTabById("trello-vault-sync");
			}),
		);
	}
}
