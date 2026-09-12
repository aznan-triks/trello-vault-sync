import { Modal, Setting, type App } from "obsidian";
import { isUsableDestinationFolder } from "../core/orphanCardDestination";
import { renderConfirmActions } from "./confirmActions";
import { VaultPathSuggest } from "./VaultPathSuggest";

/**
 * Prompts for a destination folder when a card's list isn't mapped to one —
 * prefilled with a sensible default (the configured fallback, or blank),
 * editable via the same `VaultPathSuggest` autocompletion every other folder
 * field in this plugin uses (§8 UI consistency). Fail Fast: an empty folder
 * never creates anything, it just keeps the modal open.
 */
export class FolderPickerModal extends Modal {
	private value: string;

	constructor(
		app: App,
		private readonly folderCandidates: () => string[],
		defaultFolder: string,
		private readonly onPick: (folder: string) => void,
	) {
		super(app);
		this.value = defaultFolder;
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("tvs-confirm");
		contentEl.createEl("h3", { text: "Where should this note go?" });
		contentEl.createEl("p", { text: "This card's list isn't mapped to a folder — pick one." });

		new Setting(contentEl).setName("Folder").addText((text) => {
			text.setValue(this.value).onChange((value) => {
				this.value = value;
			});
			new VaultPathSuggest(this.app, text.inputEl, this.folderCandidates);
		});

		renderConfirmActions(
			contentEl,
			{
				label: "Create",
				cls: "mod-cta",
				onClick: () => {
					const folder = this.value.trim();
					if (!isUsableDestinationFolder(folder)) return;
					this.onPick(folder);
					this.close();
				},
			},
			() => this.close(),
		);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
