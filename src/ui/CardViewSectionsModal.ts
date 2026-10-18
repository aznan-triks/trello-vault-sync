import { Modal, Setting, type App } from "obsidian";
import {
	CARD_VIEW_SECTION_LABELS,
	sectionOverride,
	setSectionOverride,
	type CardViewSection,
	type CardViewSettings,
	type SectionOverride,
} from "../core/cardViewModel";

const CHOICES: Record<SectionOverride, string> = { default: "Default", show: "Show", hide: "Hide" };

/** Which sections of the card view one card shows: the global choice ("Default"), or forced on or off for this card only. */
export class CardViewSectionsModal extends Modal {
	constructor(
		app: App,
		private readonly view: CardViewSettings,
		private readonly cardId: string,
		private readonly cardName: string,
		/** Persists the change and redraws the open card views. */
		private readonly save: () => Promise<void>,
	) {
		super(app);
	}

	override onOpen(): void {
		this.contentEl.addClass("tvs-card-view-sections");
		this.contentEl.createEl("h3", { text: "Sections for this card" });
		this.contentEl.createEl("p", {
			cls: "tvs-multi-select__hint",
			text: `"${this.cardName}" - Default follows the Card view settings. Other cards are not affected.`,
		});
		for (const section of this.view.sectionOrder) {
			new Setting(this.contentEl).setName(CARD_VIEW_SECTION_LABELS[section]).addDropdown((dropdown) =>
				dropdown
					.addOptions(CHOICES)
					.setValue(sectionOverride(this.view.perCard, this.cardId, section))
					.onChange((value) => {
						setSectionOverride(this.view.perCard, this.cardId, section as CardViewSection, value as SectionOverride);
						void this.save();
					}),
			);
		}
		new Setting(this.contentEl).addButton((button) =>
			button.setButtonText("Reset to defaults").onClick(() => {
				Reflect.deleteProperty(this.view.perCard, this.cardId);
				void this.save();
				this.close();
			}),
		);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
