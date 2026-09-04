import { ItemView, Setting, type App, type WorkspaceLeaf } from "obsidian";
import type { CommandContext } from "../commands/context";
import { COMMANDS, type CommandSection } from "../commands/registry";
import { hasCredentials } from "../settings/types";

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

const SECTIONS: CommandSection[] = ["Active note", "Folders", "Vault"];

/**
 * Persistent sidebar counterpart to the command palette: one button per
 * existing command, delegating to the same `src/commands/*.ts` handlers
 * (same `ProgressPanel` shows up while a command runs).
 */
export class SidebarView extends ItemView {
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

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("tvs-sidebar");

		// Same predicate ctx.ready() uses, called directly (not through ready()) to
		// avoid its Notice side effect firing on every render.
		if (!hasCredentials(this.ctx.settings)) {
			this.renderNotReady(contentEl);
			return;
		}

		for (const section of SECTIONS) {
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
