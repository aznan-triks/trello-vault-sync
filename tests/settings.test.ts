import { describe, expect, test } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings, type PhantomNoteScope } from "../src/settings/types";

describe("normalizeSettings", () => {
	test("keeps a well-formed payload as is", () => {
		const settings = normalizeSettings({ ...DEFAULT_SETTINGS, marginSeconds: 30, maxRetries: 5 });
		expect(settings.marginSeconds).toBe(30);
		expect(settings.maxRetries).toBe(5);
	});

	test("falls back to the default when a numeric field is corrupted", () => {
		const settings = normalizeSettings({ marginSeconds: "soon" as unknown as number });
		expect(settings.marginSeconds).toBe(DEFAULT_SETTINGS.marginSeconds);
	});

	test("falls back to the default when a numeric field is NaN or non-finite", () => {
		expect(normalizeSettings({ marginSeconds: Number.NaN }).marginSeconds).toBe(
			DEFAULT_SETTINGS.marginSeconds,
		);
		expect(normalizeSettings({ baseDelayMs: Number.POSITIVE_INFINITY }).baseDelayMs).toBe(
			DEFAULT_SETTINGS.baseDelayMs,
		);
	});

	test("clamps a negative numeric field to zero instead of disabling the feature it guards", () => {
		expect(normalizeSettings({ marginSeconds: -30 }).marginSeconds).toBe(0);
	});

	test("clamps maxRetries so a corrupted value cannot hammer the Trello API", () => {
		expect(normalizeSettings({ maxRetries: 9999 }).maxRetries).toBe(10);
	});

	test("clamps baseDelayMs to a sane ceiling", () => {
		expect(normalizeSettings({ baseDelayMs: 10_000_000 }).baseDelayMs).toBe(60_000);
	});

	test("falls back to the default when a string field is not a string", () => {
		const settings = normalizeSettings({ apiKey: 12345 as unknown as string });
		expect(settings.apiKey).toBe(DEFAULT_SETTINGS.apiKey);
	});

	test("falls back a mapping's non-string fields individually", () => {
		const settings = normalizeSettings({
			mappings: [{ listId: 42, folder: null, templateName: {} } as never],
		});
		expect(settings.mappings[0]).toEqual({
			listId: "",
			folder: "",
			templateName: "",
			allowCreateOverride: "inherit",
			allowDeleteOverride: "inherit",
		});
	});

	test("falls back a mapping's corrupted or missing override fields to inherit", () => {
		const settings = normalizeSettings({
			mappings: [{ listId: "l1", folder: "F", templateName: "", allowCreateOverride: "maybe" } as never],
		});
		expect(settings.mappings[0]?.allowCreateOverride).toBe("inherit");
		expect(settings.mappings[0]?.allowDeleteOverride).toBe("inherit");
	});

	test("strips a leading slash from scope/reportPath so a folder match is never silently empty", () => {
		const settings = normalizeSettings({ scope: "/WoT", reportPath: "/WoT/Report.md" });
		expect(settings.scope).toBe("WoT");
		expect(settings.reportPath).toBe("WoT/Report.md");
	});

	test("normalizes changesHtmlPath the same way as reportPath", () => {
		const settings = normalizeSettings({ changesHtmlPath: "\\WoT\\Changes.html" });
		expect(settings.changesHtmlPath).toBe("WoT/Changes.html");
	});

	test("normalizes a mapping's folder the same way", () => {
		const settings = normalizeSettings({
			mappings: [{ listId: "l1", folder: "\\WoT\\85_Idées\\", templateName: "" }],
		});
		expect(settings.mappings[0]?.folder).toBe("WoT/85_Idées");
	});

	test("defaults excludedFolders to an empty list", () => {
		expect(normalizeSettings({}).excludedFolders).toEqual([]);
	});

	test("normalizes each excluded folder and drops empty entries", () => {
		const settings = normalizeSettings({ excludedFolders: ["\\Archive\\", "", "WoT/90_Fins/"] });
		expect(settings.excludedFolders).toEqual(["Archive", "WoT/90_Fins"]);
	});

	test("falls back to an empty list when excludedFolders is not an array", () => {
		expect(normalizeSettings({ excludedFolders: "Archive" as unknown as string[] }).excludedFolders).toEqual([]);
	});

	test("defaults ribbonCommandIds to the 5 built-in ribbon buttons", () => {
		expect(normalizeSettings({}).ribbonCommandIds).toEqual(DEFAULT_SETTINGS.ribbonCommandIds);
	});

	test("keeps an empty ribbonCommandIds as is — the user unchecked every ribbon button", () => {
		expect(normalizeSettings({ ribbonCommandIds: [] }).ribbonCommandIds).toEqual([]);
	});

	test("keeps a stale ribbonCommandIds entry — filtering an id no longer in COMMANDS happens at ribbon-build time, not here", () => {
		expect(normalizeSettings({ ribbonCommandIds: ["a-removed-command"] }).ribbonCommandIds).toEqual([
			"a-removed-command",
		]);
	});

	test("falls back to the default when ribbonCommandIds is not an array", () => {
		expect(normalizeSettings({ ribbonCommandIds: "sync-vault" as unknown as string[] }).ribbonCommandIds).toEqual(
			DEFAULT_SETTINGS.ribbonCommandIds,
		);
	});

	test("drops non-string entries from a corrupted ribbonCommandIds array", () => {
		expect(normalizeSettings({ ribbonCommandIds: ["sync-vault", 42, null] as never }).ribbonCommandIds).toEqual([
			"sync-vault",
		]);
	});

	test("defaults ribbonIconColors to empty object", () => {
		expect(normalizeSettings({}).ribbonIconColors).toEqual({});
	});

	test("normalizes ribbonIconColors and preserves valid hex colors", () => {
		const raw = {
			"sync-active-note": "#7c3aed",
			"open-sidebar": "#ff0000",
			"invalid-color": "not-a-color",
			"non-hex": "red",
		};
		expect(normalizeSettings({ ribbonIconColors: raw }).ribbonIconColors).toEqual({
			"sync-active-note": "#7c3aed",
			"open-sidebar": "#ff0000",
		});
	});

	test("falls back to empty object when ribbonIconColors is not an object", () => {
		expect(normalizeSettings({ ribbonIconColors: "invalid" as never }).ribbonIconColors).toEqual({});
		expect(normalizeSettings({ ribbonIconColors: [1, 2, 3] as never }).ribbonIconColors).toEqual({});
		expect(normalizeSettings({ ribbonIconColors: null as never }).ribbonIconColors).toEqual({});
	});

	test("migrates legacy settings by prepending open-sidebar when upgrading from older version", () => {
		// Older payload without ribbonIconColors and without open-sidebar in ribbonCommandIds
		const legacy = {
			ribbonCommandIds: ["sync-active-note", "sync-vault", "sync-all-mappings", "audit-links"],
		};
		const normalized = normalizeSettings(legacy);
		expect(normalized.ribbonCommandIds).toEqual([
			"open-sidebar",
			"sync-active-note",
			"sync-vault",
			"sync-all-mappings",
			"audit-links",
		]);
	});

	test("preserves customized ribbonCommandIds without open-sidebar when ribbonIconColors is present", () => {
		// New payload where user intentionally removed open-sidebar
		const current = {
			ribbonCommandIds: ["sync-active-note", "sync-vault"],
			ribbonIconColors: {},
		};
		const normalized = normalizeSettings(current);
		expect(normalized.ribbonCommandIds).toEqual(["sync-active-note", "sync-vault"]);
	});

	test("defaults labelsSyncMode to merge — the non-destructive choice", () => {
		expect(normalizeSettings({}).labelsSyncMode).toBe("merge");
	});

	test("keeps an explicit overwrite choice for labelsSyncMode", () => {
		expect(normalizeSettings({ labelsSyncMode: "overwrite" }).labelsSyncMode).toBe("overwrite");
	});

	test("falls back to merge when labelsSyncMode is corrupted", () => {
		expect(normalizeSettings({ labelsSyncMode: "delete-everything" as never }).labelsSyncMode).toBe("merge");
	});

	test("defaults every frontmatter key to its historical value", () => {
		const settings = normalizeSettings({});
		expect(settings.cardRefFrontmatterKey).toBe("trello_board_card_id");
		expect(settings.dueFrontmatterKey).toBe("trello_due");
		expect(settings.labelsFrontmatterKey).toBe("trello_labels");
	});

	test("keeps a trimmed custom frontmatter key", () => {
		const settings = normalizeSettings({
			cardRefFrontmatterKey: "  card_link  ",
			dueFrontmatterKey: "deadline",
			labelsFrontmatterKey: "tags_trello",
		});
		expect(settings.cardRefFrontmatterKey).toBe("card_link");
		expect(settings.dueFrontmatterKey).toBe("deadline");
		expect(settings.labelsFrontmatterKey).toBe("tags_trello");
	});

	test("falls back to the default when a frontmatter key is blank or not a string", () => {
		const settings = normalizeSettings({
			cardRefFrontmatterKey: "   ",
			dueFrontmatterKey: 42 as unknown as string,
		});
		expect(settings.cardRefFrontmatterKey).toBe("trello_board_card_id");
		expect(settings.dueFrontmatterKey).toBe("trello_due");
	});

	test("defaults syncAttachments to on", () => {
		expect(normalizeSettings({}).syncAttachments).toBe(true);
	});

	test("keeps an explicit syncAttachments: false", () => {
		expect(normalizeSettings({ syncAttachments: false }).syncAttachments).toBe(false);
	});

	test("defaults syncLinkedCards to on and keeps an explicit false", () => {
		expect(normalizeSettings({}).syncLinkedCards).toBe(true);
		expect(normalizeSettings({ syncLinkedCards: false }).syncLinkedCards).toBe(false);
	});

	test("defaults the attachment frontmatter keys to their historical values", () => {
		const settings = normalizeSettings({});
		expect(settings.attachmentsFrontmatterKey).toBe("trello_attachments");
		expect(settings.linkedCardsFrontmatterKey).toBe("trello_linked_cards");
	});

	test("keeps trimmed custom attachment frontmatter keys", () => {
		const settings = normalizeSettings({
			attachmentsFrontmatterKey: "  pj  ",
			linkedCardsFrontmatterKey: "cartes_liees",
		});
		expect(settings.attachmentsFrontmatterKey).toBe("pj");
		expect(settings.linkedCardsFrontmatterKey).toBe("cartes_liees");
	});

	test("falls back to the default when an attachment frontmatter key is blank or not a string", () => {
		const settings = normalizeSettings({
			attachmentsFrontmatterKey: "   ",
			linkedCardsFrontmatterKey: 42 as unknown as string,
		});
		expect(settings.attachmentsFrontmatterKey).toBe("trello_attachments");
		expect(settings.linkedCardsFrontmatterKey).toBe("trello_linked_cards");
	});

	test("defaults syncChecklists to on", () => {
		expect(normalizeSettings({}).syncChecklists).toBe(true);
	});

	test("keeps an explicit syncChecklists: false", () => {
		expect(normalizeSettings({ syncChecklists: false }).syncChecklists).toBe(false);
	});

	test("defaults checklistHeading to its historical value", () => {
		expect(normalizeSettings({}).checklistHeading).toBe("## Checklist");
	});

	test("keeps a trimmed custom checklistHeading", () => {
		expect(normalizeSettings({ checklistHeading: "  ## Tâches  " }).checklistHeading).toBe("## Tâches");
	});

	test("falls back to the default when checklistHeading is blank or not a string", () => {
		expect(normalizeSettings({ checklistHeading: "   " }).checklistHeading).toBe("## Checklist");
		expect(normalizeSettings({ checklistHeading: 42 as unknown as string }).checklistHeading).toBe(
			"## Checklist",
		);
	});

	test("defaults historyEnabled to on and historyMaxRuns to 20", () => {
		const settings = normalizeSettings({});
		expect(settings.historyEnabled).toBe(true);
		expect(settings.historyMaxRuns).toBe(20);
	});

	test("keeps an explicit historyEnabled: false", () => {
		expect(normalizeSettings({ historyEnabled: false }).historyMaxRuns).toBe(20);
		expect(normalizeSettings({ historyEnabled: false }).historyEnabled).toBe(false);
	});

	test("clamps historyMaxRuns so a corrupted value cannot grow data.json without bound", () => {
		expect(normalizeSettings({ historyMaxRuns: 999_999 }).historyMaxRuns).toBe(200);
	});

	test("falls back historyMaxRuns to the default when corrupted", () => {
		expect(normalizeSettings({ historyMaxRuns: "lots" as unknown as number }).historyMaxRuns).toBe(20);
	});

	test("fetches attachments and checklists together with the cards by default", () => {
		expect(normalizeSettings({}).fetchCardDetailsWithCards).toBe(true);
		expect(normalizeSettings({ fetchCardDetailsWithCards: false }).fetchCardDetailsWithCards).toBe(false);
	});

	test("defaults the cover/attachment-download settings", () => {
		const settings = normalizeSettings({});
		expect(settings.syncCardCover).toBe(true);
		expect(settings.coverFrontmatterKey).toBe("banner");
		expect(settings.downloadAttachments).toBe(false);
		expect(settings.attachmentsDestination).toBe("note-folder");
		expect(settings.attachmentsFolder).toBe("");
	});

	test("keeps an explicit global-folder destination and normalizes its folder", () => {
		const settings = normalizeSettings({ attachmentsDestination: "global-folder", attachmentsFolder: "\\Attachments\\" });
		expect(settings.attachmentsDestination).toBe("global-folder");
		expect(settings.attachmentsFolder).toBe("Attachments");
	});

	test("falls back attachmentsDestination to note-folder when corrupted", () => {
		expect(normalizeSettings({ attachmentsDestination: "somewhere-else" as never }).attachmentsDestination).toBe(
			"note-folder",
		);
	});

	test("falls back coverFrontmatterKey to the default when blank or not a string", () => {
		expect(normalizeSettings({ coverFrontmatterKey: "   " }).coverFrontmatterKey).toBe("banner");
		expect(normalizeSettings({ coverFrontmatterKey: 42 as unknown as string }).coverFrontmatterKey).toBe("banner");
	});

	test("defaults confirmForceSync to on", () => {
		expect(normalizeSettings({}).confirmForceSync).toBe(true);
	});

	test("keeps an explicit confirmForceSync: false", () => {
		expect(normalizeSettings({ confirmForceSync: false }).confirmForceSync).toBe(false);
	});

	test("defaults orphanCardFolder to empty and normalizes an explicit value", () => {
		expect(normalizeSettings({}).orphanCardFolder).toBe("");
		expect(normalizeSettings({ orphanCardFolder: "\\Projects\\" }).orphanCardFolder).toBe("Projects");
	});

	test("defaults phantomCardListId to empty and trims explicit value", () => {
		expect(normalizeSettings({}).phantomCardListId).toBe("");
		expect(normalizeSettings({ phantomCardListId: "  list-inbox  " }).phantomCardListId).toBe("list-inbox");
	});

	test("defaults phantomNotePreferFolderMapping to false and preserves explicit boolean", () => {
		expect(normalizeSettings({}).phantomNotePreferFolderMapping).toBe(false);
		expect(normalizeSettings({ phantomNotePreferFolderMapping: true }).phantomNotePreferFolderMapping).toBe(true);
	});

	test("defaults phantomNoteScope to all-unlinked and validates allowed values", () => {
		expect(normalizeSettings({}).phantomNoteScope).toBe("all-unlinked");
		expect(normalizeSettings({ phantomNoteScope: "phantom-only" }).phantomNoteScope).toBe("phantom-only");
		expect(normalizeSettings({ phantomNoteScope: "mapped-folders-only" }).phantomNoteScope).toBe("mapped-folders-only");
		expect(normalizeSettings({ phantomNoteScope: "invalid" as unknown as PhantomNoteScope }).phantomNoteScope).toBe("all-unlinked");
	});

	test("defaults every auto-sync setting", () => {
		const settings = normalizeSettings({});
		expect(settings.autoSyncEnabled).toBe(false);
		expect(settings.autoSyncOnInterval).toBe(true);
		expect(settings.autoSyncOnFocus).toBe(false);
		expect(settings.autoSyncOnStartup).toBe(false);
		expect(settings.autoSyncIntervalMinutes).toBe(15);
		expect(settings.autoSyncScopeMappings).toBe(true);
		expect(settings.autoSyncScopeVault).toBe(false);
		expect(settings.autoSyncMinIdleSeconds).toBe(60);
	});

	test("keeps an explicit autoSyncEnabled: true", () => {
		expect(normalizeSettings({ autoSyncEnabled: true }).autoSyncEnabled).toBe(true);
	});

	test("keeps every trigger toggle independent — any combination is valid, not an either/or", () => {
		const settings = normalizeSettings({ autoSyncOnInterval: false, autoSyncOnFocus: true, autoSyncOnStartup: true });
		expect(settings.autoSyncOnInterval).toBe(false);
		expect(settings.autoSyncOnFocus).toBe(true);
		expect(settings.autoSyncOnStartup).toBe(true);
	});

	test("keeps every scope toggle independent — both mapped folders and the whole vault can run in the same auto-sync", () => {
		const settings = normalizeSettings({ autoSyncScopeMappings: true, autoSyncScopeVault: true });
		expect(settings.autoSyncScopeMappings).toBe(true);
		expect(settings.autoSyncScopeVault).toBe(true);
	});

	test("clamps autoSyncIntervalMinutes and autoSyncMinIdleSeconds to their ceilings", () => {
		expect(normalizeSettings({ autoSyncIntervalMinutes: 999_999 }).autoSyncIntervalMinutes).toBe(1440);
		expect(normalizeSettings({ autoSyncMinIdleSeconds: 999_999 }).autoSyncMinIdleSeconds).toBe(3600);
	});

	test("defaults syncMembers to on and membersFrontmatterKey to its historical value", () => {
		const settings = normalizeSettings({});
		expect(settings.syncMembers).toBe(true);
		expect(settings.membersFrontmatterKey).toBe("trello_members");
	});

	test("keeps an explicit syncMembers: false", () => {
		expect(normalizeSettings({ syncMembers: false }).syncMembers).toBe(false);
	});

	test("falls back membersFrontmatterKey to the default when blank or not a string", () => {
		expect(normalizeSettings({ membersFrontmatterKey: "   " }).membersFrontmatterKey).toBe("trello_members");
		expect(normalizeSettings({ membersFrontmatterKey: 42 as unknown as string }).membersFrontmatterKey).toBe(
			"trello_members",
		);
	});

	test("defaults syncCustomFields to on and customFieldsFrontmatterKey to its historical value", () => {
		const settings = normalizeSettings({});
		expect(settings.syncCustomFields).toBe(true);
		expect(settings.customFieldsFrontmatterKey).toBe("trello_custom_fields");
	});

	test("keeps an explicit syncCustomFields: false", () => {
		expect(normalizeSettings({ syncCustomFields: false }).syncCustomFields).toBe(false);
	});

	test("falls back customFieldsFrontmatterKey to the default when blank or not a string", () => {
		expect(normalizeSettings({ customFieldsFrontmatterKey: "   " }).customFieldsFrontmatterKey).toBe(
			"trello_custom_fields",
		);
		expect(
			normalizeSettings({ customFieldsFrontmatterKey: 42 as unknown as string }).customFieldsFrontmatterKey,
		).toBe("trello_custom_fields");
	});

	test("defaults historyRevertTrelloWrites and confirmUndo to on", () => {
		const settings = normalizeSettings({});
		expect(settings.historyRevertTrelloWrites).toBe(true);
		expect(settings.confirmUndo).toBe(true);
	});

	test("keeps an explicit historyRevertTrelloWrites: false and confirmUndo: false", () => {
		expect(normalizeSettings({ historyRevertTrelloWrites: false }).historyRevertTrelloWrites).toBe(false);
		expect(normalizeSettings({ confirmUndo: false }).confirmUndo).toBe(false);
	});

	test("defaults maxBackoffDelayMs to 30000", () => {
		expect(normalizeSettings({}).maxBackoffDelayMs).toBe(30_000);
	});

	test("keeps an explicit maxBackoffDelayMs", () => {
		expect(normalizeSettings({ maxBackoffDelayMs: 5_000 }).maxBackoffDelayMs).toBe(5_000);
	});

	test("clamps maxBackoffDelayMs to its ceiling", () => {
		expect(normalizeSettings({ maxBackoffDelayMs: 10_000_000 }).maxBackoffDelayMs).toBe(300_000);
	});

	test("falls back maxBackoffDelayMs to the default when corrupted", () => {
		expect(normalizeSettings({ maxBackoffDelayMs: "slow" as unknown as number }).maxBackoffDelayMs).toBe(30_000);
	});

	test("defaults linkAuditReportPath, locationAuditReportPath and changesReportPath to empty", () => {
		const settings = normalizeSettings({});
		expect(settings.linkAuditReportPath).toBe("");
		expect(settings.locationAuditReportPath).toBe("");
		expect(settings.changesReportPath).toBe("");
	});

	test("normalizes audit report paths the same way as reportPath", () => {
		const settings = normalizeSettings({
			linkAuditReportPath: "\\Reports\\Links.md",
			locationAuditReportPath: "/Reports/Locations.md",
			changesReportPath: "\\Reports\\Changes.md",
		});
		expect(settings.linkAuditReportPath).toBe("Reports/Links.md");
		expect(settings.locationAuditReportPath).toBe("Reports/Locations.md");
		expect(settings.changesReportPath).toBe("Reports/Changes.md");
	});

	test("inherits legacy reportPath for linkAuditReportPath, locationAuditReportPath and changesReportPath when they are absent", () => {
		const settings = normalizeSettings({
			reportPath: "/WoT/LegacyReport.md",
		});
		expect(settings.linkAuditReportPath).toBe("WoT/LegacyReport.md");
		expect(settings.locationAuditReportPath).toBe("WoT/LegacyReport.md");
		expect(settings.changesReportPath).toBe("WoT/LegacyReport.md");
	});

	test("prefers explicit audit report paths over legacy reportPath", () => {
		const settings = normalizeSettings({
			reportPath: "Legacy.md",
			linkAuditReportPath: "ExplicitLinks.md",
			locationAuditReportPath: "ExplicitLocations.md",
			changesReportPath: "ExplicitChanges.md",
		});
		expect(settings.linkAuditReportPath).toBe("ExplicitLinks.md");
		expect(settings.locationAuditReportPath).toBe("ExplicitLocations.md");
		expect(settings.changesReportPath).toBe("ExplicitChanges.md");
	});

	test("defaults syncDescription, syncDue and syncLabels to true", () => {
		const settings = normalizeSettings({});
		expect(settings.syncDescription).toBe(true);
		expect(settings.syncDue).toBe(true);
		expect(settings.syncLabels).toBe(true);
	});

	test("keeps explicit false for syncDescription, syncDue and syncLabels", () => {
		const settings = normalizeSettings({
			syncDescription: false,
			syncDue: false,
			syncLabels: false,
		});
		expect(settings.syncDescription).toBe(false);
		expect(settings.syncDue).toBe(false);
		expect(settings.syncLabels).toBe(false);
	});

	test("defaults defaultTemplateName to empty and keeps a trimmed custom value", () => {
		expect(normalizeSettings({}).defaultTemplateName).toBe("");
		expect(normalizeSettings({ defaultTemplateName: "  Template Card  " }).defaultTemplateName).toBe(
			"Template Card",
		);
	});

	test("defaults preferLocalCover to false and keeps explicit boolean", () => {
		expect(normalizeSettings({}).preferLocalCover).toBe(false);
		expect(normalizeSettings({ preferLocalCover: true }).preferLocalCover).toBe(true);
		expect(normalizeSettings({ preferLocalCover: "true" as unknown as boolean }).preferLocalCover).toBe(false);
	});

	test("defaults coverLocalFormat to vault-path and accepts wikilink", () => {
		expect(normalizeSettings({}).coverLocalFormat).toBe("vault-path");
		expect(normalizeSettings({ coverLocalFormat: "wikilink" }).coverLocalFormat).toBe("wikilink");
		expect(normalizeSettings({ coverLocalFormat: "invalid" as unknown as "wikilink" }).coverLocalFormat).toBe(
			"vault-path",
		);
	});
});

