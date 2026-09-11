import {
	Notice,
	PluginSettingTab,
	type App,
	type ButtonComponent,
	type Setting,
	type SettingDefinitionItem,
} from "obsidian";
import type TrelloVaultSyncPlugin from "../main";
import { ALL_SECTIONS, COMMANDS } from "../commands/registry";
import { DEFAULT_ATTACHMENTS_KEY, DEFAULT_LINKED_CARDS_KEY } from "../core/attachmentRef";
import { DEFAULT_CARD_REF_KEY } from "../core/cardRef";
import { DEFAULT_CHECKLIST_HEADING } from "../core/checklistRef";
import { DEFAULT_DUE_KEY } from "../core/dueRef";
import { errorMessage } from "../core/errorMessage";
import { DEFAULT_LABELS_KEY } from "../core/labelRef";
import type { LabelSyncMode } from "../core/labelMerge";
import type { ConflictPolicy } from "../core/syncDecision";
import { TrelloPickerSuggest, type IdName } from "../ui/TrelloPickerSuggest";
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

/**
 * One settings row. `render` receives a `Setting` that already carries the row's
 * name and description, and fills in the control.
 */
interface SettingRow {
	name: string;
	desc?: string | DocumentFragment;
	/** Rows with no name (a lone button, a paragraph of guidance) are noise in the settings search. */
	searchable?: boolean;
	render: (setting: Setting) => void;
}

/** A heading and the rows under it. */
interface SettingGroupSpec {
	heading?: string;
	cls?: string;
	rows: SettingRow[];
}

export class TrelloVaultSyncSettingsTab extends PluginSettingTab {
	private listNames = new Map<string, string>();
	private boardName: string | null = null;

	constructor(
		app: App,
		private readonly plugin: TrelloVaultSyncPlugin,
	) {
		super(app, plugin);
	}

	/**
	 * The whole tab, declared rather than drawn: Obsidian renders these groups
	 * itself and indexes every named row for its settings search. This is the only
	 * render path — `display()` is not implemented, which is why `manifest.json`
	 * requires Obsidian 1.13.
	 */
	override getSettingDefinitions(): SettingDefinitionItem[] {
		return this.groups().map((group) => ({
			type: "group" as const,
			...(group.heading === undefined ? {} : { heading: group.heading }),
			...(group.cls === undefined ? {} : { cls: group.cls }),
			items: group.rows.map((row) => ({
				name: row.name,
				...(row.desc === undefined ? {} : { desc: row.desc }),
				...(row.searchable === undefined ? {} : { searchable: row.searchable }),
				// Obsidian hands over a two-argument signature; the row only needs the Setting.
				render: (setting: Setting) => this.renderRow(row, setting),
			})),
		}));
	}

	/** Applies a row's name and description, then its own body. */
	private renderRow(row: SettingRow, setting: Setting): void {
		setting.setName(row.name);
		if (row.desc !== undefined) setting.setDesc(row.desc);
		row.render(setting);
	}

	/** A row that is only a paragraph of guidance: no name, and out of the settings search. */
	private note(desc: string): SettingRow {
		return { name: "", desc, searchable: false, render: () => undefined };
	}

	private groups(): SettingGroupSpec[] {
		return [
			this.credentialsGroup(),
			this.scopeGroup(),
			this.behaviourGroup(),
			...this.mappingGroups(),
			this.ribbonGroup(),
			this.advancedGroup(),
			this.frontmatterKeysGroup(),
		];
	}

	private save(): Promise<void> {
		return this.plugin.saveSettings();
	}

	/**
	 * Re-reads the definitions and redraws the tab. Needed whenever the *structure*
	 * changes (a mapping or an excluded folder added/removed, a picked board or list
	 * renaming a row's description) — `refreshDomState()` would only re-evaluate
	 * visibility and disabled state.
	 */
	private refresh(): void {
		this.update();
	}

	/**
	 * Picking a board or a list rewrites the row's own description (it shows the
	 * resolved name), so it needs a structural refresh, not just a value write.
	 */
	private applyPickedBoard(board: IdName): void {
		this.plugin.settings.boardId = board.id;
		this.boardName = board.name;
		void this.save();
		this.refresh();
	}

	private applyPickedList(mapping: { listId: string }, list: IdName): void {
		mapping.listId = list.id;
		void this.save();
		this.refresh();
	}

	/** `onClick` expects a synchronous handler, so the round trip lives here and is fired with `void`. */
	private async testConnection(button: ButtonComponent): Promise<void> {
		button.setDisabled(true);
		try {
			const lists = await this.plugin.client().getBoardLists(this.plugin.settings.boardId);
			this.listNames = new Map(lists.map((list) => [list.id, list.name]));
			new Notice(`✅ Connected — ${lists.length} list(s) on the board.`);
			this.refresh();
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

	private credentialsGroup(): SettingGroupSpec {
		return {
			heading: "Trello connection",
			rows: [
				this.note(
					"A single key/token pair for every command. It is stored in the plugin's own " +
						"settings (data.json) — never copy it into a vault note.",
				),
				{
					name: "API key",
					desc: createFragment((el) => {
						el.createEl("a", {
							text: "https://trello.com/app-key",
							href: "https://trello.com/app-key",
							attr: { target: "_blank", rel: "noopener" },
						});
					}),
					render: (setting) =>
						setting.setClass("tvs-secret").addText((text) =>
							text
								.setPlaceholder("API key")
								.setValue(this.plugin.settings.apiKey)
								.onChange((value) => {
									this.plugin.settings.apiKey = value.trim();
									void this.save();
								}),
						),
				},
				{
					name: "Token",
					desc: "Personal token generated from the page above.",
					render: (setting) =>
						setting.setClass("tvs-secret").addText((text) => {
							text.inputEl.type = "password";
							text
								.setPlaceholder("token")
								.setValue(this.plugin.settings.token)
								.onChange((value) => {
									this.plugin.settings.token = value.trim();
									void this.save();
								});
						}),
				},
				{
					name: "Board id",
					desc: this.boardName
						? `→ ${this.boardName}`
						: "The id that appears in the Trello board's URL. Start typing to see your boards by name.",
					render: (setting) =>
						setting.addText((text) => {
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
						}),
				},
				{
					name: "Test connection",
					desc: "Checks the key, the token, and access to the board.",
					render: (setting) =>
						setting.addButton((button) =>
							button.setButtonText("Test").onClick(() => {
								void this.testConnection(button);
							}),
						),
				},
			],
		};
	}

	private scopeGroup(): SettingGroupSpec {
		const rows: SettingRow[] = [
			{
				name: "Synced folder",
				desc: "Restricts the vault-wide commands to this folder. Empty = the whole vault.",
				render: (setting) =>
					setting.addText((text) => {
						text
							.setPlaceholder("Projects")
							.setValue(this.plugin.settings.scope)
							.onChange((value) => {
								this.plugin.settings.scope = normalizeVaultPath(value.trim());
								void this.save();
							});
						new VaultPathSuggest(this.app, text.inputEl, () => this.folderCandidates());
					}),
			},
			{
				name: "Excluded folders",
				desc: "Folders skipped by vault-wide sync and audits — even a linked note under one of them is left alone.",
				render: () => undefined,
			},
		];

		this.plugin.settings.excludedFolders.forEach((folder, index) => {
			rows.push({
				name: "",
				searchable: false,
				render: (setting) =>
					setting
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
									this.refresh();
								}),
						),
			});
		});

		rows.push(
			{
				name: "",
				searchable: false,
				render: (setting) =>
					setting.addButton((button) =>
						button
							.setButtonText("Add a folder")
							.setCta()
							.onClick(() => {
								this.plugin.settings.excludedFolders.push("");
								void this.save();
								this.refresh();
							}),
					),
			},
			{
				name: "Report note",
				desc: "Path of the note the audits write their report into. It must already exist.",
				render: (setting) =>
					setting.addText((text) => {
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
					}),
			},
			{
				name: "Change log HTML page",
				desc:
					'Path of the standalone HTML page "Export change log as HTML" writes into — ' +
					"created if missing, overwritten if it already exists.",
				render: (setting) =>
					setting.addText((text) => {
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
					}),
			},
		);

		return { heading: "Scope", rows };
	}

	private behaviourGroup(): SettingGroupSpec {
		return {
			heading: "Sync behaviour",
			rows: [
				{
					name: "Arbitration",
					desc: "Who wins when both the note and the card changed.",
					render: (setting) =>
						setting.addDropdown((dropdown) => {
							for (const [value, label] of Object.entries(POLICY_LABELS)) dropdown.addOption(value, label);
							dropdown.setValue(this.plugin.settings.policy).onChange((value) => {
								this.plugin.settings.policy = value as ConflictPolicy;
								void this.save();
							});
						}),
				},
				{
					name: "Labels sync",
					desc: "How the note's labels (Labels key, below) and the card's assigned labels reconcile when they diverge.",
					render: (setting) =>
						setting.addDropdown((dropdown) => {
							for (const [value, label] of Object.entries(LABELS_SYNC_MODE_LABELS))
								dropdown.addOption(value, label);
							dropdown.setValue(this.plugin.settings.labelsSyncMode).onChange((value) => {
								this.plugin.settings.labelsSyncMode = value as LabelSyncMode;
								void this.save();
							});
						}),
				},
				{
					name: "Sync attachments",
					desc:
						"Pulls the card's attachments into the note's frontmatter (Attachments key/Linked cards key, " +
						"below) — a plain url in one, a wikilink to the linked card's own note (or a placeholder " +
						"by name) in the other. Pull-only. Costs one extra Trello request per note synced.",
					render: (setting) =>
						setting.addToggle((toggle) =>
							toggle.setValue(this.plugin.settings.syncAttachments).onChange((value) => {
								this.plugin.settings.syncAttachments = value;
								void this.save();
							}),
						),
				},
				{
					name: "Sync checklists",
					desc:
						"Mirrors the card's checklists as Markdown tasks under the checklist section (Checklist section " +
						"heading, below), always the last thing in the note. Checking a box in Obsidian pushes that " +
						"state to Trello even when nothing else changed; which items/checklists exist always follows " +
						"Trello — an item typed by hand with no match on the card is dropped, never created there. " +
						"Costs one extra Trello request per note synced.",
					render: (setting) =>
						setting.addToggle((toggle) =>
							toggle.setValue(this.plugin.settings.syncChecklists).onChange((value) => {
								this.plugin.settings.syncChecklists = value;
								void this.save();
							}),
						),
				},
				{
					name: "Checklist section heading",
					desc:
						"The exact line marking where the checklist section starts in a note's body — must be the last " +
						"thing in the body. ⚠️ The section under this heading is rebuilt from Trello on every sync; " +
						"changing this key doesn't move an existing section written under the old heading.",
					render: (setting) =>
						setting.addText((text) =>
							text.setValue(this.plugin.settings.checklistHeading).onChange((value) => {
								this.plugin.settings.checklistHeading = safeFrontmatterKey(
									value,
									DEFAULT_CHECKLIST_HEADING,
								);
								void this.save();
							}),
						),
				},
				{
					name: "Clock margin (seconds)",
					desc:
						"Below this gap, both sides are considered simultaneous: the divergence is " +
						"reported as a conflict instead of being resolved by a coin flip.",
					render: (setting) =>
						setting.addText((text) =>
							text.setValue(String(this.plugin.settings.marginSeconds)).onChange((value) => {
								const parsed = Number.parseInt(value, 10);
								this.plugin.settings.marginSeconds = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
								void this.save();
							}),
						),
				},
				{
					name: "Sync titles",
					desc: "Renames the note from the card's title, and vice versa.",
					render: (setting) =>
						setting.addToggle((toggle) =>
							toggle.setValue(this.plugin.settings.syncTitle).onChange((value) => {
								this.plugin.settings.syncTitle = value;
								void this.save();
							}),
						),
				},
				{
					name: "Dry run",
					desc: "Computes and shows everything that would be done, without writing anything.",
					render: (setting) =>
						setting.addToggle((toggle) =>
							toggle.setValue(this.plugin.settings.dryRun).onChange((value) => {
								this.plugin.settings.dryRun = value;
								void this.save();
							}),
						),
				},
				{
					name: "Create missing notes",
					desc: "Creates a note for every card with no local match, during a list sync.",
					render: (setting) =>
						setting.addToggle((toggle) =>
							toggle.setValue(this.plugin.settings.allowCreate).onChange((value) => {
								this.plugin.settings.allowCreate = value;
								void this.save();
							}),
						),
				},
				{
					name: "Delete phantom notes",
					desc:
						"⚠️ Destructive: trashes the note whose card left the list. Off by default — " +
						"such notes are simply reported.",
					render: (setting) =>
						setting.addToggle((toggle) =>
							toggle.setValue(this.plugin.settings.allowDelete).onChange((value) => {
								this.plugin.settings.allowDelete = value;
								void this.save();
							}),
						),
				},
			],
		};
	}

	/**
	 * One group per mapping, because a settings group cannot nest another one:
	 * each mapping keeps its own heading and its `.tvs-mapping` frame, as before.
	 */
	private mappingGroups(): SettingGroupSpec[] {
		const intro: SettingGroupSpec = {
			heading: "Trello list ↔ folder",
			rows: [
				this.note(
					"Each row pairs a board list with a vault folder, and the note template used for " +
						"creations. Replaces the dedicated per-folder scripts.",
				),
			],
		};

		const mappings = this.plugin.settings.mappings.map((mapping, index): SettingGroupSpec => {
			const resolvedName = this.listNames.get(mapping.listId);
			return {
				cls: "tvs-mapping",
				rows: [
					{
						name: `Mapping ${index + 1}`,
						searchable: false,
						render: (setting) =>
							setting.addExtraButton((button) =>
								button
									.setIcon("trash")
									.setTooltip("Remove")
									.onClick(() => {
										this.plugin.settings.mappings.splice(index, 1);
										void this.save();
										this.refresh();
									}),
							),
					},
					{
						name: "Trello list",
						desc: resolvedName
							? `→ ${resolvedName}`
							: "Paste the list id from the Trello board URL. Start typing to see this board's lists by name.",
						render: (setting) =>
							setting.addText((text) => {
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
										const lists = await this.plugin
											.client()
											.getBoardLists(this.plugin.settings.boardId);
										this.listNames = new Map(lists.map((list) => [list.id, list.name]));
										return lists;
									},
									(list) => {
										this.applyPickedList(mapping, list);
									},
								);
							}),
					},
					{
						name: "Folder",
						desc: "Vault folder synced with this Trello list.",
						render: (setting) =>
							setting.addText((text) => {
								text
									.setPlaceholder("Projects/Ideas")
									.setValue(mapping.folder)
									.onChange((value) => {
										mapping.folder = normalizeVaultPath(value.trim());
										void this.save();
									});
								new VaultPathSuggest(this.app, text.inputEl, () => this.folderCandidates());
							}),
					},
					{
						name: "Note template",
						desc: "Note used as the template for new notes created from this list; empty = a plain description.",
						render: (setting) =>
							setting.addText((text) => {
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
							}),
					},
				],
			};
		});

		const addButton: SettingGroupSpec = {
			rows: [
				{
					name: "",
					searchable: false,
					render: (setting) =>
						setting.addButton((button) =>
							button
								.setButtonText("Add a mapping")
								.setCta()
								.onClick(() => {
									this.plugin.settings.mappings.push({ listId: "", folder: "", templateName: "" });
									void this.save();
									this.refresh();
								}),
						),
				},
			],
		};

		return [intro, ...mappings, addButton];
	}

	private ribbonGroup(): SettingGroupSpec {
		const rows: SettingRow[] = [this.note("Choose which commands get a button in Obsidian's left ribbon.")];

		for (const section of ALL_SECTIONS) {
			for (const command of COMMANDS.filter((c) => c.section === section)) {
				rows.push({
					name: command.name,
					render: (setting) =>
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
						),
				});
			}
		}

		return { heading: "Ribbon icons", rows };
	}

	private advancedGroup(): SettingGroupSpec {
		return {
			heading: "Advanced",
			rows: [
				{
					name: "Similarity threshold",
					desc: "Minimum score (0 to 1) to automatically match a note to a card.",
					render: (setting) =>
						setting.addSlider((slider) =>
							slider
								.setLimits(0.1, 1, 0.05)
								.setValue(this.plugin.settings.similarityThreshold)
								.onChange((value) => {
									this.plugin.settings.similarityThreshold = value;
									void this.save();
								}),
						),
				},
				{
					name: "Retries",
					desc: "Number of retries after a 429 response or a server error.",
					render: (setting) =>
						setting.addText((text) =>
							text.setValue(String(this.plugin.settings.maxRetries)).onChange((value) => {
								const parsed = Number.parseInt(value, 10);
								this.plugin.settings.maxRetries = safeNonNegativeNumber(parsed, 0, MAX_RETRIES_CEILING);
								void this.save();
							}),
						),
				},
				{
					name: "Initial delay (ms)",
					desc: "Wait before the first retry; it doubles on every subsequent attempt.",
					render: (setting) =>
						setting.addText((text) =>
							text.setValue(String(this.plugin.settings.baseDelayMs)).onChange((value) => {
								const parsed = Number.parseInt(value, 10);
								this.plugin.settings.baseDelayMs = safeNonNegativeNumber(
									parsed,
									0,
									BASE_DELAY_MS_CEILING,
								);
								void this.save();
							}),
						),
				},
				{
					name: "Request timeout (ms)",
					desc: "How long to wait for a single Trello response before treating it as a failed attempt.",
					render: (setting) =>
						setting.addText((text) =>
							text.setValue(String(this.plugin.settings.requestTimeoutMs)).onChange((value) => {
								const parsed = Number.parseInt(value, 10);
								this.plugin.settings.requestTimeoutMs = safeNonNegativeNumber(
									parsed,
									0,
									REQUEST_TIMEOUT_MS_CEILING,
								);
								void this.save();
							}),
						),
				},
				{
					name: "Show the progress panel",
					desc: "Floating panel with live progress while a sync runs. Off: the sync still runs, just silently.",
					render: (setting) =>
						setting.addToggle((toggle) =>
							toggle.setValue(this.plugin.settings.showPanel).onChange((value) => {
								this.plugin.settings.showPanel = value;
								void this.save();
							}),
						),
				},
				{
					name: "Auto-close (seconds)",
					desc: "0 keeps the panel open until closed manually.",
					render: (setting) =>
						setting.addText((text) =>
							text
								.setValue(String(this.plugin.settings.panelAutoCloseSeconds))
								.onChange((value) => {
									const parsed = Number.parseInt(value, 10);
									this.plugin.settings.panelAutoCloseSeconds =
										Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
									void this.save();
								}),
						),
				},
			],
		};
	}

	private frontmatterKeysGroup(): SettingGroupSpec {
		return {
			heading: "Frontmatter keys",
			rows: [
				{
					name: "Due date key",
					desc: "Frontmatter property that carries the card's due date.",
					render: (setting) =>
						setting.addText((text) =>
							text.setValue(this.plugin.settings.dueFrontmatterKey).onChange((value) => {
								this.plugin.settings.dueFrontmatterKey = safeFrontmatterKey(value, DEFAULT_DUE_KEY);
								void this.save();
							}),
						),
				},
				{
					name: "Labels key",
					desc: "Frontmatter property that carries the card's labels.",
					render: (setting) =>
						setting.addText((text) =>
							text.setValue(this.plugin.settings.labelsFrontmatterKey).onChange((value) => {
								this.plugin.settings.labelsFrontmatterKey = safeFrontmatterKey(
									value,
									DEFAULT_LABELS_KEY,
								);
								void this.save();
							}),
						),
				},
				{
					name: "Attachments key",
					desc: "Frontmatter property that carries the card's plain attachment urls.",
					render: (setting) =>
						setting.addText((text) =>
							text.setValue(this.plugin.settings.attachmentsFrontmatterKey).onChange((value) => {
								this.plugin.settings.attachmentsFrontmatterKey = safeFrontmatterKey(
									value,
									DEFAULT_ATTACHMENTS_KEY,
								);
								void this.save();
							}),
						),
				},
				{
					name: "Linked cards key",
					desc: "Frontmatter property that carries a wikilink for each attachment pointing to another Trello card.",
					render: (setting) =>
						setting.addText((text) =>
							text.setValue(this.plugin.settings.linkedCardsFrontmatterKey).onChange((value) => {
								this.plugin.settings.linkedCardsFrontmatterKey = safeFrontmatterKey(
									value,
									DEFAULT_LINKED_CARDS_KEY,
								);
								void this.save();
							}),
						),
				},
				{
					name: "Card link key",
					desc:
						"Frontmatter property that links a note to its card — every command depends on it. " +
						"⚠️ Changing this on a vault that already has linked notes orphans every one of them " +
						"until their frontmatter is updated to the new key too.",
					render: (setting) =>
						setting.addText((text) =>
							text.setValue(this.plugin.settings.cardRefFrontmatterKey).onChange((value) => {
								this.plugin.settings.cardRefFrontmatterKey = safeFrontmatterKey(
									value,
									DEFAULT_CARD_REF_KEY,
								);
								void this.save();
							}),
						),
				},
			],
		};
	}
}
