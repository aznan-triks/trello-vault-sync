import { FuzzySuggestModal, type App } from "obsidian";
import type { ReportGroupSelection } from "../core/auditReportSelection";

export interface AuditReportGroupChoice {
	/** Shown in the picker, with the group's counts. */
	label: string;
	selection: ReportGroupSelection;
}

/** Picks which group of the link report ("All groups", one Trello list, one folder) to create from. */
export class AuditReportGroupPickerModal extends FuzzySuggestModal<AuditReportGroupChoice> {
	constructor(
		app: App,
		private readonly choices: AuditReportGroupChoice[],
		private readonly onPick: (choice: AuditReportGroupChoice) => void,
	) {
		super(app);
		this.setPlaceholder("Create from which part of the audit report?");
	}

	getItems(): AuditReportGroupChoice[] {
		return this.choices;
	}

	getItemText(choice: AuditReportGroupChoice): string {
		return choice.label;
	}

	onChooseItem(choice: AuditReportGroupChoice): void {
		this.onPick(choice);
	}
}
