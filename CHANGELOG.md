# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.12.0] — 2026-09-12

### Changed

- **Plain**: ⚠️ The plugin now requires Obsidian 1.13 or newer. That is the
  version whose settings API it is built on — declaring anything older was a
  promise it could not keep.
  **Technical**: `manifest.json`.minAppVersion `1.7.2` → `1.13.0`, clearing
  the analyzer's `obsidianmd/no-unsupported-api` error. The 1.7–1.12 fallback
  added in v1.11.0 is gone: `display()` and its group walker are removed, so
  `getSettingDefinitions()` is the tab's only render path and `update()` is
  called unguarded.
- **Plain**: The slider in the settings shows its value inline now, the way
  Obsidian shows every other slider.
  **Technical**: the deprecated `setDynamicTooltip()` call is gone — 1.13
  renders the value next to the slider on its own.
- **Plain**: Saving a setting no longer makes the interface wait for the write
  to land on disk.
  **Technical**: every settings handler is synchronous and fires the persist
  with `void this.save()`, instead of handing an `async` callback to a
  component property typed to return nothing (36 sites in `SettingsTab.ts`,
  plus the sidebar's Dry-run toggle found by the same grep). "Test connection"
  keeps its round trip in a private async method.

### Fixed

- **Plain**: When a sync is cancelled, what the plugin reports internally is
  now always a real error object, so nothing downstream can mistake it for a
  plain value.
  **Technical**: `src/obsidian/transport.ts` rejects with `abortError(signal)`
  — the signal's own reason when it is an `Error`, otherwise a new `Error`
  carrying it as `cause`.
- **Plain**: Timers now belong to the window the plugin is actually running
  in, which matters if you tear a pane out into its own window.
  **Technical**: `src/core/asyncUtil.ts` and `src/trello/client.ts` call
  `timers.setTimeout`, resolved once to `window` under Obsidian and to
  `globalThis` under the Node test run — `core/` and `trello/` must stay
  importable outside Obsidian.

## [1.11.0] — 2026-09-11

### Added

- **Plain**: On Obsidian 1.13 and newer, every plugin setting now shows up in
  Obsidian's own settings search — type "checklist" or "token" in the search
  box and the matching rows are found, instead of having to scroll the tab.
  **Technical**: `src/settings/SettingsTab.ts` implements
  `getSettingDefinitions()` (Obsidian 1.13+), which Obsidian renders and
  indexes itself. Rows with no name (lone buttons, guidance paragraphs) are
  marked `searchable: false` so they stay out of the index.

### Changed

- **Plain**: The settings tab was rebuilt around a single description of its
  own content. Nothing moves, nothing is renamed — it just stops being
  written twice.
  **Technical**: the tab is now one list of groups and rows
  (`SettingGroupSpec`/`SettingRow`), consumed by two render paths:
  `getSettingDefinitions()` on 1.13+, and `display()` (deliberately kept, as
  Obsidian's own typings recommend, for 1.7–1.12) which walks the very same
  groups. Each row's body lives once. Each mapping becomes its own group
  keeping its `.tvs-mapping` frame, since a settings group cannot nest
  another. `minAppVersion` stays `1.7.2`: no new requirement, the new API is
  additive.
- **Plain**: Anything that rebuilds the settings tab (picking a board or a
  list, adding or removing a row, testing the connection) now refreshes both
  render paths.
  **Technical**: those call sites go through `refresh()`, which calls
  `update()` — guarded, since it only exists from 1.13 on — before
  `display()`.

## [1.10.3] — 2026-09-11

### Changed

- **Plain**: Deleting a note during a sync now follows whatever you chose in
  Obsidian's own "Deleted files" setting, instead of always using the vault
  trash. It stays recoverable either way.
  **Technical**: `src/obsidian/ObsidianVault.ts::trash` uses
  `FileManager.trashFile()` instead of the older `Vault.trash(file, false)`,
  the API Obsidian now sanctions for honouring the user's preference. The
  guard that only deletes once a card has left the *board* is unchanged.
- **Plain**: One fewer third-party package in the build — nothing changes for
  you, there is just less to go wrong.
  **Technical**: `esbuild.config.mjs` reads Node's own `builtinModules` from
  `node:module` (and also marks the `node:`-prefixed spellings external)
  instead of depending on `builtin-modules`, now dropped from
  `devDependencies`.

### Fixed

- **Plain**: Picking a board or a list from the autocomplete in the settings
  now saves through a path that cannot silently drop the save.
  **Technical**: `src/settings/SettingsTab.ts` no longer hands an `async`
  lambda to `TrelloPickerSuggest.onPick` (typed `(item) => void`, so the
  returned promise was discarded): both call sites now call
  `void this.applyPickedBoard(...)` / `void this.applyPickedList(...)`,
  the same shape as `void runMapping(...)` in the commands layer.
- **Plain**: Internal type-safety and linting cleanups — no visible change.
  **Technical**: `src/core/fileName.ts` strips ASCII control characters by
  code point (`stripControlChars`) instead of a regex holding literal control
  characters, pinned by a new test in `tests/fileName.test.ts`;
  `src/core/similarity.ts` initialises its cost row with `.fill(0)` and drops
  all three `as number` assertions; `src/commands/syncCommands.ts::reportStats`
  takes the stats record itself under a `T extends Record<keyof T, number>`
  constraint instead of untyped `Object.entries` pairs;
  `ObsidianVault.writeFrontmatter` converts Obsidian's `any` frontmatter
  parameter once, explicitly, at the boundary.

## [1.10.2] — 2026-09-11

### Fixed

- **Plain**: The sidebar panel now comes back exactly where you left it after
  the plugin is reloaded or updated, instead of sometimes vanishing from the
  layout.
  **Technical**: `src/main.ts::onunload` no longer calls
  `Workspace.detachLeavesOfType(VIEW_TYPE_TVS_SIDEBAR)` — Obsidian already
  tears down views registered through `registerView`, and detaching them by
  hand kept a reference to the dead leaf and broke workspace restoration.
- **Plain**: The plugin now states honestly which Obsidian version it needs,
  so anyone on an older release is told up front instead of hitting a crash.
  **Technical**: `manifest.json`.minAppVersion `1.5.0` → `1.7.2`, matching the
  API actually used (`obsidian@^1.7.2`: awaited `Workspace.revealLeaf`,
  `Vault.getAllFolders`, `FileManager.processFrontMatter`); `versions.json`
  gains `"1.10.2": "1.7.2"`.
- **Plain**: The progress bar is now styled entirely by the stylesheet, so a
  theme or a custom snippet can restyle it.
  **Technical**: `src/ui/ProgressPanel.ts` replaces the two direct
  `barEl.style.transform` assignments with
  `setCssProps({ "--tvs-progress-scale": … })`; `styles.css`'s
  `.tvs-panel__bar` reads `transform: scaleX(var(--tvs-progress-scale, 0))`.
  `grep -rn "\.style\." src/` is now empty.

## [1.10.1] — 2026-09-11

### Changed

- **Plain**: Nothing changes for anyone using the plugin — this only
  strengthens an internal safety check so a Trello property name (like
  `trello_attachments`) can never again get hardcoded somewhere it shouldn't
  be, the way `trello_labels` briefly was before v1.9.1.
  **Technical**: `npm run check` now runs `scripts/check-hardcode.mjs` (new),
  which fails the build if a `"trello_xxx"` string literal appears anywhere
  outside its single `DEFAULT_..._KEY` definition in `src/core/`, or if
  `src/core/`/`src/trello/` import `"obsidian"`, or `src/features/` touches
  `TFile`/`app.vault`/`app.workspace` — automates two of the manual
  `CONTEXT.md` §8 grep checks instead of relying on remembering to run them.

## [1.10.0] — 2026-09-11

### Added

- **Plain**: A card's attachments now sync into a note's frontmatter — plain
  links in one property, and a clickable reference to any attachment that
  points at another Trello card in another. If that other card already has
  its own note in the vault, the reference points straight to it; otherwise
  it shows the card's name as a placeholder. Both properties, and the whole
  feature, are configurable in Settings — on by default, but it does cost one
  extra request to Trello per note synced.
  **Technical**: `src/trello/client.ts` (`TrelloAttachment`, `getCardAttachments`,
  `ATTACHMENT_FIELDS`) ; `src/core/attachmentRef.ts` (new: frontmatter keys,
  parse/format, `extractCardShortLink`, `formatWikilink`) ;
  `src/features/attachmentSync.ts` (new: `buildCardIndex` — one vault-wide
  card-id→note scan, shared once per run by `syncFolder`/`syncAllMappings`/
  `syncVault` — and `resolveAttachments`, exact-match deduped) ; wired into
  `src/features/syncNote.ts::convergeAttachments`, independent of the
  pull/push direction decided for title/body/due (never a cause of conflict,
  respects `dryRun`, best-effort on a network failure — logged, never
  thrown). New settings `syncAttachments` (default `true`),
  `attachmentsFrontmatterKey`/`linkedCardsFrontmatterKey` (defaults
  `trello_attachments`/`trello_linked_cards`).
- **Plain**: Trello checklists now show up as a checkbox list at the end of
  the note. Ticking a box in Obsidian pushes that change to Trello right
  away, even if nothing else on the note changed; an item added or renamed on
  Trello shows up the same way on the next sync. A box typed by hand with no
  matching Trello item is not created there — it's dropped on the next sync,
  by design, not a bug. Configurable in Settings — on by default, one extra
  request to Trello per note synced.
  **Technical**: `src/trello/client.ts` (`TrelloChecklist`/`TrelloChecklistItem`,
  `getCardChecklists`, `updateCheckItemState`) ; `src/core/checklistRef.ts`
  (new: `renderChecklistMarkdown`/`parseChecklistMarkdown`) ;
  `src/core/noteBody.ts` gains `splitChecklistSection`/`insertChecklistSection`
  and an optional `checklistHeading` parameter on `extractBody`/`replaceBody`
  — omitted (the default), behavior is byte-for-byte identical to before this
  change, so the description sync every other feature relies on is
  unaffected ; `src/features/checklistSync.ts` (new: `resolveChecklists` —
  matches items by (checklist name, item name), Obsidian wins an already-known
  item's checked state, Trello wins which items/checklists exist) ; wired
  into `syncNote.ts::convergeChecklists` (same independent-of-direction,
  best-effort hook point as attachments) and
  `noteCommands.ts::resolveConflict` (checklist-aware, so a checkbox-only
  change never shows up as a false conflict). New settings `syncChecklists`
  (default `true`), `checklistHeading` (default `## Checklist`, must be the
  last thing in the note's body).

## [1.9.2] — 2026-09-11

### Fixed

- **Plain**: Three settings had no explanation of what they do — "Folder" and
  "Note template" in each Trello list ↔ folder mapping, and "Show the
  progress panel". All three now have a description, like every other
  setting.
  **Technical**: Added `.setDesc(...)` to the three `Setting` instances in
  `src/settings/SettingsTab.ts::renderMappings`/`renderAdvanced`. Audited all
  37 `Setting` instances in the file; these were the only ones missing a
  description among fields that take a value (list-item rows under an
  already-described section, and one-shot action buttons, are exempt).

## [1.9.1] — 2026-09-11

### Changed

- **Plain**: The three frontmatter properties the plugin reads and writes
  (the one linking a note to its card, plus the due-date and labels ones) are
  now all editable in Settings → Frontmatter keys, instead of being fixed
  names baked into the plugin. Nothing changes for existing vaults — the
  defaults are exactly the old fixed names. Changing the card-link key on a
  vault that already has linked notes will make them look unlinked until
  their frontmatter is updated to match; the settings field says so.
  **Technical**: `CARD_REF_KEY`/`DUE_KEY`/`LABELS_KEY` renamed to
  `DEFAULT_CARD_REF_KEY`/`DEFAULT_DUE_KEY`/`DEFAULT_LABELS_KEY` in
  `core/cardRef.ts`/`dueRef.ts`/`labelRef.ts` — the only fixed thing left is
  the default value, never used directly by the sync logic anymore. New
  settings `cardRefFrontmatterKey`/`dueFrontmatterKey`/`labelsFrontmatterKey`,
  each normalized to a non-empty string (`safeFrontmatterKey`, reused by both
  `normalizeSettings` and the settings-tab inputs) threaded through
  `NoteSyncOptions`/`FolderSyncOptions` into `syncNote.ts`/`syncFolder.ts`
  (including `template.ts`'s `templateMissingCardRefKey`, now parameterized),
  and into `ObsidianVault.ts` via a constructor-injected `() => string`
  accessor rather than a settings-object dependency. This closes a no-hardcode
  gap the user flagged mid-session on `trello_labels` and generalized to all
  three keys, plus a new §1.4 rule in `CONTEXT.md` so it doesn't recur.

## [1.9.0] — 2026-09-11

### Added

- **Plain**: Trello labels now sync with a note's `trello_labels` frontmatter.
  By default nothing is ever lost — a label added on either side is added to
  the other on the next sync, never removed just because it's missing from
  one. A stricter "last writer wins" mode is available for anyone who wants
  the card's/note's labels to fully replace the other side instead.
  **Technical**: `src/core/labelRef.ts` (`LABELS_KEY = "trello_labels"`,
  `parseLabelsRef`/`formatLabelsRef`, case-insensitive
  `normalizeLabelSet`/`sameLabelSet`) and `src/core/labelMerge.ts`
  (`resolveLabelSync`, pure `merge`/`overwrite` split) mirror the `trello_due`
  pattern; `TrelloLabel`/`TrelloCard.labels`/`getBoardLabels`/
  `updateCard.idLabels` added to `src/trello/client.ts`; wired into
  `src/features/syncNote.ts` (label convergence in `merge` mode runs
  independently of the pull/push direction decided for title/body/due, never
  a cause of conflict — `src/core/syncDecision.ts`'s `labelsChanged` only
  applies in `overwrite` mode); new `labelsSyncMode` setting (`merge`
  default), dropdown in `SettingsTab.ts` next to "Arbitration". A local name
  with no match on the board is dropped on push without throwing and without
  losing the labels that did resolve; a color-only Trello label is never
  turned into an empty frontmatter entry.

### Fixed

- **Plain**: Empty settings fields (API key, board id, report note path…) now
  show their example text visibly greyed out and in italics, so it's obvious
  it's a placeholder and not something you already typed — in both light and
  dark Obsidian themes.
  **Technical**: `containerEl.addClass("tvs-settings")` in
  `SettingsTab.ts::display()`; `.tvs-settings input::placeholder { color:
  var(--text-faint); font-style: italic; }` in `styles.css`.

## [1.8.0] — 2026-09-08

### Added

- **Plain**: Notes now track their Trello due date in a `trello_due`
  frontmatter field — any due date set or cleared on the card is reflected in
  the note on the next pull; a date edited locally is pushed back to Trello on
  the next push. Always on for a linked note, no setting to toggle it.
  **Technical**: `src/core/dueRef.ts` (`DUE_KEY = "trello_due"`,
  `parseDueRef`/`formatDueRef`, pure functions mirroring `cardRef.ts`), read
  and written from `src/features/syncNote.ts` through the generic
  `VaultGateway.readFrontmatter`/`writeFrontmatter` (no dedicated
  `getDueDate`/`setDueDate` methods); `TrelloCard.due` added to
  `src/trello/client.ts`; `syncDecision.dueChanged` flag wired in
  `src/features/syncNote.ts`.

- **Plain**: A network call that hangs or takes longer than the configured
  timeout now actually stops waiting, instead of stalling the sync
  indefinitely — you set the per-request ceiling in the settings.
  **Technical**: `Transport` signature extended with optional
  `signal?: AbortSignal`; `TrelloClient.send` (in `src/trello/client.ts`)
  combines a per-request timeout with the command-level cancel signal via
  `AbortSignal.any`; `obsidianTransport` and `obsidianDownloadBinary`
  (in `src/obsidian/transport.ts`) honour it via `Promise.race`. New setting
  `requestTimeoutMs` (default 30 000 ms). Structural note: `requestUrl` has no
  native abort — the race stops waiting on this side; the underlying socket may
  still complete inside Obsidian.

- **Plain**: You can now choose which commands get a button in Obsidian's left
  ribbon, from a new "Ribbon icons" section in the plugin settings — a change
  applies immediately, no restart needed. Every command stays available from
  the sidebar panel and the command palette either way.
  **Technical**: New setting `ribbonCommandIds: string[]` (default:
  `sync-active-note`, `sync-vault`, `sync-all-mappings`, `audit-links`) in
  `src/settings/types.ts`. `SettingsTab.renderRibbon()` renders one toggle per
  `commands/registry.ts` entry. `main.ts`'s hardcoded `RIBBON_COMMAND_IDS`
  replaced by `rebuildRibbon()`, called on load and after every
  `saveSettings()`; a stale id (a command removed since the setting was saved)
  is skipped rather than treated as an error, unlike the old dev-time constant.

### Changed

- **Plain**: Under the hood, the plugin's vault interface was split into three
  focused contracts — no change visible to you, but keeps each part easier to
  test and extend without touching the others.
  **Technical**: `VaultGateway` in `src/obsidian/gateway.ts` split into three
  interfaces: `VaultGateway` (file I/O + generic `readFrontmatter`/
  `writeFrontmatter`), `CardRefStore` (`getCardRef`/`setCardRef`),
  `TemplateResolver` (`readTemplate`). `ObsidianVault` implements all three;
  `CommandContext.vault` typed as the intersection of the three.

- **Plain**: A small internal helper that describes the outcome of a single-note
  sync was moved to a testable location — no behavior change.
  **Technical**: `describeSyncOutcome()` extracted into `src/core/syncTally.ts`;
  `tests/noteCommands.test.ts` (which imported `src/commands/` and broke the
  `obsidian`-import isolation rule) removed; `tests/syncTally.test.ts` now
  covers the extracted function directly.

---

## [1.7.0] — 2026-09-05

### Added

- New command "Link active note to a card (pick manually)": fuzzy-search
  modal over the configured board's cards, for when the existing
  title-matching link command picks the wrong card or refuses to fire (no
  match close enough). Reuses `getBoardCards` and the existing
  `trello_board_card_id` write path — no new Trello API calls.

## [1.6.0] — 2026-09-05

### Added

- New command "Export change log as HTML": a standalone HTML page of the
  Trello change log, each author's avatar downloaded once and embedded
  (works offline, one self-contained file). Independent of "Audit changes" —
  it never advances the change-log cursor, so generating the page doesn't
  consume entries the Markdown audit would otherwise report next. New
  setting: the page's destination path (`Change log HTML page`).

## [1.5.7] — 2026-09-05

### Changed

- The sidebar's activity journal now survives an Obsidian restart — written
  into the plugin's own `data.json` alongside the settings (once per
  finished command, not per log line), instead of living in memory only.
  An existing `data.json` from an earlier version keeps loading normally.

## [1.5.6] — 2026-09-05

### Changed

- Trello change log ("Audit changes" report): entries are now grouped by day
  (most recent first), then by card within each day, instead of one flat
  list — makes it easy to scan everything that happened to a specific card,
  or everything that happened on a specific day. Times are shown in UTC.

## [1.5.5] — 2026-09-04

### Changed

- "Excluded folders" setting: replaced the one-folder-per-line textarea with
  a row per folder (autocomplete via `VaultPathSuggest`, a "Remove" button
  per row, an "Add a folder" button) — same editing pattern already used for
  Trello list ↔ folder mappings, instead of typing raw paths by hand.

## [1.5.4] — 2026-09-04

### Added

- Color coding for the progress panel: the two log levels that had no icon
  color yet (`info`, `skip`) now do, and every counter (`errors`,
  `conflicts`, `orphan cards`, …) turns green when clean, orange or red once
  it flags something needing attention. `countSeverity()`
  (`src/core/countSeverity.ts`, unit-tested) decides which counters are
  "problem counts" versus routine action counts.

## [1.5.3] — 2026-09-04

### Added

- "Audit changes" command: logs Trello board activity (`/boards/{id}/actions`)
  into the Report note, same as "Audit links" and "Audit locations". Only
  changes since the last run are fetched (a cursor — the last processed
  action id — is persisted internally, no new settings-tab field). Dry run
  reports without advancing the cursor.
- `describeAction()` (`src/core/auditAction.ts`, unit-tested): maps a Trello
  action to a human-readable change-log entry — card renames, description
  edits, archive/unarchive, list moves, due date changes, member changes,
  attachments, comments, checklists. Unmapped action types are skipped to
  keep the log readable.
- `TrelloClient.getActions()`.

## [1.5.2] — 2026-09-04

### Added

- Persistent in-memory activity journal ("Activity" section in the sidebar
  view): every `Reporter.log()` call is recorded even with the floating
  panel disabled (`showPanel: false`), and survives that panel closing.
  Hydrated from history on open, then appended row by row — no full sidebar
  re-render on each log line. `appendJournalEntry()` (`src/core/journal.ts`,
  unit-tested) caps the history, dropping the oldest entry first.
- `renderLogRow()` extracted from `ProgressPanel` and shared with the
  sidebar's journal — one row renderer, one set of CSS classes.

### Fixed

- The two remaining silent `catch` blocks (`TrelloPickerSuggest.ts`,
  `SettingsTab.ts`) now also log to `console.error`, matching the pattern
  already used everywhere else (`main.ts`).

## [1.5.1] — 2026-09-04

### Added

- `excludedFolders` setting (Scope section, one folder per line): folders
  skipped by "Sync all linked notes", "Audit links" and "Compare locations
  against Trello", regardless of link state. Does not affect the per-folder
  mapping commands (`syncFolder`/`syncAllMappings`), which target an explicit
  1:1 folder chosen by the user.
- `excludeFolders()` in `src/core/fileName.ts`, the blacklist counterpart to
  `notesInFolder()`; `VaultGateway.listNotes()` gained an optional second
  parameter implementing it once per gateway (`ObsidianVault`, `FakeVault`).

## [1.5.0] — 2026-09-04

### Added

- Persistent sidebar view (`SidebarView`, right sidebar by default, opened via
  a new ribbon icon) with a button for every command, grouped into "Active
  note" / "Folders" / "Vault" sections, plus a dry-run switch synced with the
  setting in both directions. Missing credentials show a blocking message
  with an "Open settings" button instead of buttons that would fail silently.
- `src/commands/registry.ts`: single source of truth for command
  id/name/icon, consumed by both the command palette (`main.ts`) and the
  sidebar — replaces 11 separately-declared `addCommand` calls.
- `hasCredentials()` in `src/settings/types.ts`: the pure key/token check
  shared by `ctx.ready()` and the sidebar's render gate.

## [1.4.6] — 2026-09-04

### Changed

- Extracted `errorMessage(e: unknown)` into `src/core/errorMessage.ts` and
  replaced the duplicated `(error as Error).message` cast at 10 call sites
  across 6 files (`syncFolder.ts`, `syncVault.ts`, `main.ts`,
  `SettingsTab.ts`, `client.ts`, `TrelloPickerSuggest.ts`). No behavior
  change for an actual `Error` instance; a non-`Error` thrown value now
  stringifies via `String(e)` instead of reading `undefined` off the unsafe
  cast.

## [1.4.5] — 2026-09-04

### Fixed

- `resolveConflict` now runs through the same `ctx.run()` path as every
  other command — the progress panel shows while its Trello call is in
  flight, a failure gets logged via the shared error path
  (`console.error`), and the rate-limit reporter is passed to the client
  so a retry backoff shows up in the panel instead of looking stalled.
  Previously it built its own client without a reporter and swallowed
  errors with a bare `Notice`.

## [1.4.4] — 2026-09-04

### Changed

- `main.ts` (438 lines, 12 mixed responsibilities) split into a thin
  plugin-lifecycle/wiring layer plus `src/commands/{context,noteCommands,
  syncCommands,auditCommands}.ts` — each command's body now lives next to
  the others of its kind instead of inside the `Plugin` subclass. No
  behavior change (command ids, names, ribbon icons and notices are
  unchanged); a duplicated stats-reporting loop found across the extracted
  file was consolidated into one helper.

## [1.4.3] — 2026-09-04

### Changed

- `AuditOptions` and `requireReportNote` moved out of `auditLinks.ts` into a
  new `auditShared.ts` — `auditLocations.ts` no longer imports from a
  sibling feature file it has nothing to do with (hidden coupling flagged by
  the 2026-09-04 audit). No behavior change.

## [1.4.2] — 2026-09-04

### Security

- Trello card names are now escaped before being embedded in generated audit
  reports (link report, location report). A card name containing `]` or `(`
  — editable by anyone with access to the shared Trello board — could
  previously break the markdown link syntax the plugin builds and inject an
  arbitrary link (hidden URL, spoofing).

## [1.4.1] — 2026-09-04

### Fixed

- "Sync every list with its folder" no longer aborts the whole run when one
  mapping fails (e.g. its Trello list was deleted) — the failing mapping is
  now counted as an error and the mappings after it still run.
- A network failure while checking whether a card just moved to another
  Trello list (the check that stops the plugin from wrongly deleting a note)
  no longer loses the create/pull/push counts already gathered earlier in
  the same folder sync — it now keeps every note that pass instead of
  guessing, and reports the failure as an error.
- "Sync every list with its folder" now scans the vault once for all
  mappings instead of once per mapping.

### Security

- Bumped `esbuild` (dev-only) to 0.28.2 and `vitest` to 4.1.11, closing a
  moderate advisory that escalated to critical through the
  vite → @vitest/mocker → vitest chain. `npm audit` is clean.

## [1.4.0] — 2026-09-03

### Added

- New command: "Resolve conflict (active note), side by side" — when a note
  and its card both changed since the last sync, this shows the local body
  and the Trello card description next to each other and lets you pick
  which side to keep, instead of guessing and force-pulling/force-pushing
  blind.
- Cancelling an in-flight multi-note sync or audit now actually stops it.
  The progress panel's × becomes a working Cancel button once there is
  something to cancel (any multi-item command); clicking it stops the run
  before the next note/card/mapping, shows "Cancelling…", then reports
  "Aborted". Single-note commands (sync/push/pull/link active note) keep no
  cancel button — cancelling a single already-in-flight request could only
  misreport a change that actually landed as "Cancelled".
- The plugin now warns once per folder mapping if its configured note
  template has no `trello_board_card_id` frontmatter key — notes created
  from it would otherwise never link back to their card.

### Changed

- Audit commands ("Audit links", "Compare locations against Trello lists")
  yield to the UI periodically while scanning, so the progress panel keeps
  repainting on a very large vault instead of freezing until the scan ends.
- `requireReportNote` now looks up the configured report note directly
  instead of scanning every note in the vault to find it.

### Fixed

- `tests/linkNote.test.ts` split out of `tests/audit.test.ts` (no behavior
  change, easier to find and extend).

## [1.3.1] — 2026-09-02

### Changed

- The board/list picker button (a separate click that opened a searchable
  list) is now inline autocomplete: matching names drop down as you type
  directly in the id field, fetched once per field-focus. Applies to board
  id and each mapping's Trello list id.
- The same inline-autocomplete pattern now also covers every vault-path
  field — synced folder, report note, mapping folder, mapping note
  template — suggesting existing folders/notes as you type.
- The settings tab no longer jumps back to the top on every change (picking
  a board/list, adding or removing a mapping); it restores the scroll
  position after redrawing.

## [1.3.0] — 2026-08-31

### Added

- The board id and each mapping's Trello list id can now be picked from a
  live, searchable list instead of typed by hand — a picker button next to
  each field fetches the current boards (or, for a list, the selected
  board's lists) fresh from Trello and lets you fuzzy-search by name.
  Finding a raw board/list id in Trello's UI was tedious; the raw id field
  is still there and still works on its own, this is additive.

### Changed

- Settings-tab placeholder examples that used to be the developer's own
  personal Obsidian vault folder and file names (meaningless to anyone else
  using the plugin) are now generic (`Projects`, `Projects/Ideas`,
  `Trello Card`, `Projects/Trello Sync Report.md`).

## [1.2.1] — 2026-08-30

A second structured pass in the same audit style as 1.2.0 — a five-persona
council (UX/UI, Obsidian API, QA/reliability, performance, security) filed
findings independently, a synthesis pass deduped and ranked them, and each
surviving item was re-verified against the actual code before being fixed.
16 findings survived verification; all 16 are fixed here, plus a few small
extras folded in along the way.

### Fixed

- A note's frontmatter could be silently destroyed on the next pull: the
  parser only recognized a closing `---` fence with no trailing characters,
  so a fence with trailing whitespace (common from editor auto-formatting)
  made the whole file — YAML included — look like a bodyless note. The next
  pull then overwrote the entire file with the card's description, losing
  the `trello_board_card_id` link and every other frontmatter field with no
  error and no trash/undo path. Fences with trailing spaces or tabs are now
  recognized correctly.
- A card whose title contains a character Obsidian forbids in file names
  (`* " \ / < > : | ?`), a trailing period, or is over 120 characters would
  never match its own note's sanitized file name — so on every push, the
  plugin overwrote the *real* Trello card title with the sanitized filename,
  permanently mangling it. Title comparison is now sanitization-aware.
- An exact timestamp tie between a note and its card (both changed, same
  millisecond) was mislabeled `local-newer` instead of being reported as a
  conflict.
- A card title or description landing inside a custom template's frontmatter
  fence could corrupt or inject into the YAML block (a colon-space, a
  leading `#`, an embedded quote or newline). `{{TITLE}}`/`{{DESCRIPTION}}`
  are now YAML-escaped when they land inside the frontmatter fence;
  `{{CARD_ID}}`/`{{BOARD_ID}}`/`{{URL}}` are untouched since they're
  Trello's own safe fixed-format ids and the shipped default template
  hand-quotes them together.
- Archiving a card on Trello (not deleting it) got its note trashed the same
  as a genuinely deleted card, when "delete phantom notes" was on — the
  board-cards check only asked for visible cards, which excludes archived
  ones by default. Archived cards are now fetched and kept, logged
  separately from a genuine deletion.
- A vault path typed or pasted with a leading slash or a backslash (scope,
  report note path, a mapping's folder) silently matched zero notes instead
  of failing — "sync every list with its folder" would then mass-create
  duplicate notes for every card with no warning. Paths are now normalized
  both live in the settings tab and when settings are loaded.
- "Sync every list with its folder" issued one full board-cards request per
  mapping instead of one for the whole run, when "delete phantom notes" was
  on — wasteful against Trello's rate limit on larger mapping sets. The
  board is now fetched once and shared across every mapping in the run.
- "Sync active note" showed a raw internal token (`within-margin`,
  `remote-newer`…) in the panel log instead of a human-readable line, and a
  genuine conflict logged at the same level as routine info instead of a
  warning. It now goes through the same formatting the bulk sync commands
  already use.
- A rate-limit or server-error retry wait was invisible in the progress
  panel — the sync just appeared to stall for however long the backoff
  took. Each retry now logs what's happening and how long the wait is.
- The retry backoff delay had no ceiling of its own: a corrupted or
  aggressively-tuned `maxRetries`/`baseDelayMs` combination could produce a
  single wait of several hours, and — combined with the concurrent-sync
  guard added in 1.2.0 — would wedge every other command in the plugin for
  that whole duration. A backoff wait is now capped independently of
  `maxRetries`/`baseDelayMs`. Trello's `Retry-After` response header is now
  read and honored when present, instead of always falling back to the
  exponential formula.
- A transport-level failure (a DNS hiccup, a dropped connection) was fatal
  on the very first attempt, while the same underlying transience showed as
  an HTTP 5xx/429 got retried up to `maxRetries` times. Both now go through
  the same retry budget.
- A corrupted `data.json` with a non-string value in a text setting (API
  key, token, board id, scope, report path, or a mapping's list id/folder/
  template name) passed straight through to crash later, deep in unrelated
  code, with an unclear error. Every string setting now falls back to a
  safe default instead.
- The Retries and Initial-delay-ms fields in the settings tab accepted any
  value while the plugin was running, bypassing the same ceiling
  `normalizeSettings` already enforces at load — a live edit could produce
  the multi-hour-wedge scenario above without even restarting the plugin.
  The settings tab now enforces the identical bound live.
- Auto-linking a note to a card ("Link active note to a card") could
  spuriously match a short or generic note name against any card whose
  title merely contained that word as a substring, reporting a false 90%
  confidence. The containment heuristic now requires a whole-word match —
  the legitimate "Sagondo (brouillon)" → "Sagondo" case still works.
- The floating progress panel lived entirely outside Obsidian's plugin
  lifecycle: disabling or reloading the plugin while a panel was still open
  (or configured to stay open) left an orphaned DOM node behind with no
  owner left to remove it. The panel is now torn down on unload.
- A mapping's Trello-list field never actually showed the list name
  resolved by "Test connection" — the placeholder it relied on is invisible
  whenever the field already has a value, which is the only case where
  showing a name would help. The resolved name is now shown as a caption
  under the field.
- `sanitizeFileName` truncated a very long title by UTF-16 code unit rather
  than Unicode code point, which could split an emoji's surrogate pair in
  two and produce an unwritable file name. It now truncates on a code-point
  boundary.
- The "created" log line for a new note showed the raw card title even when
  the actual file written used a sanitized name (e.g. a Windows-reserved
  device name prefixed with `_`) — the panel and the file on disk disagreed
  silently. The log line now shows the name actually written when it
  differs.

### Changed

- Renamed the "Delete orphan notes" toggle to "Delete phantom notes" — it
  controls `allowDelete`/`phantomNotes`, not orphan cards; the old name
  named the wrong side of the relationship.
- "Unlinked Trello cards" in the link-audit report is now "Orphan Trello
  cards", matching the vocabulary the progress panel and the rest of the
  report already use — "unlinked" was naming both directions of the
  card/note relationship in the same document.
- Removed an unused `WeakMap<TFile, NoteHandle>` cache from `ObsidianVault`
  — write-only, nothing ever read it.
- The API key field's help link is now a real clickable link instead of
  plain text.

## [1.2.0] — 2026-08-30

A structured pass — five independent reviews (security/fail-fast, architecture,
Obsidian UX, reliability, fresh-eyes) read the codebase and each filed findings;
this release resolves the ones confirmed by re-reading the actual code.

### Fixed

- A card with a missing or unreadable `dateLastActivity` no longer silently
  produces a `NaN` timestamp that made the sync engine guess a direction with
  no clue it was guessing. It now throws a clear error instead, naming the
  card and the bad value.
- Two commands can no longer run at the same time. Previously, starting a
  second sync while one was still running silently destroyed the first
  sync's progress panel — the first sync kept writing to the vault in the
  background with no visible feedback, and the two runs could race on the
  same notes. A sync now refuses to start while another is in flight
  (a Notice explains why) instead of racing silently.
- The progress panel's × button no longer implies it can cancel a running
  sync — there was no actual cancellation behind it, so closing the panel
  mid-run just hid a sync that kept going. The button is now hidden until
  the run has actually finished.
- "Sync every list with its folder" now reports live counters to the
  progress panel, the same way every other sync command does — previously
  it tracked only 4 of the ~10 stat fields and never updated the panel at
  all.
- A Trello card titled a Windows-reserved device name (`CON`, `PRN`, `AUX`,
  `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`) no longer produces an unwritable file
  path; the file name is now prefixed with `_`.
- A hand-edited or corrupted `data.json` can no longer disable the
  conflict-detection safety margin by turning it into `NaN`, nor push
  `maxRetries`/`baseDelayMs` past a sane bound and turn a "bounded retry"
  into a fast loop against Trello's rate limiter. Every numeric setting is
  now validated and clamped when the plugin loads.
- A duplicate note claiming a card another note in the same folder already
  claims is now counted and logged as a warning instead of being silently
  dropped. A folder-synced note with no card id at all is now counted too.

### Changed

- Removed `FolderPair.targetPath` and `FolderPair.needsLocalRename` from the
  folder planner — confirmed dead: nothing in the codebase read either
  field.
- The renamed/pulled/pushed/conflicts/skipped tally that was duplicated
  almost verbatim between `syncVault` and `syncFolder` now lives in one
  shared helper (`core/syncTally.ts`).
- The "fetch board lists + cards, index list names by id" logic duplicated
  between the two audit commands now lives in one shared helper
  (`features/boardIndex.ts`).

## [1.1.0] — 2026-08-28

### Changed

- The entire plugin is now English-only. Every user-facing string — command names,
  ribbon tooltips, the settings tab, the progress panel, Notices, and the Markdown
  audit reports written into notes — is English. The vault this plugin was originally
  built for is French, and an earlier release kept those strings in French; that
  design call is reversed here.
- Report timestamps switch from a French date format to an unambiguous `en-CA`
  (`YYYY-MM-DD, HH:mm:ss`) one.

## [1.0.1] — 2026-08-28

### Fixed

- Three progress-panel counters (`reportLinks`/`reportLocations`) used a French string as
  their internal key instead of the English key the rest of the codebase uses to look up
  a display label — harmless in practice, but inconsistent.
- `TrelloClient` and `ObsidianVault` — the transport and file-access layers, meant to stay
  independent of any display language — threw French error messages. They now throw in
  English. Trade-off accepted: a network failure or a missing credential now surfaces an
  English Notice inside an otherwise French UI; every other user-facing string (commands,
  settings, progress panel, audit reports) stays French.

## [1.0.0] — 2026-08-27

First release. Replaces eight Templater user scripts (`trello_sync`,
`trello_auto_sync`, `trello_batch_sync`, `trello_folder_sync`,
`trello_folder_sync_alternatif`, `trello_audit`, `trello_location_audit`,
`trello_active_note_linker`) driven by Commander ribbon buttons.

### Added

- Ten native commands and four ribbon icons; Templater and Commander are no longer
  needed for Trello work.
- A single Trello credential pair in the plugin settings, with a connection test.
- Configurable list ↔ folder mappings, replacing the two hard-coded folder scripts.
- Conflict arbitration policy (newer wins / Obsidian wins / Trello wins).
- Dry-run mode, and a command to toggle it.
- Retry with exponential backoff on 429 and 5xx responses.
- Audit reports written to a configured note, preserving previously ticked boxes.
- 150 unit and integration tests over the pure logic and the sync engines.

### Changed

- Batch sync fetches the board once instead of once per note.
- Frontmatter is parsed line-wise (and written through Obsidian's own YAML round-trip),
  so a `---` inside a value, a BOM, or CRLF endings no longer corrupt a note.
- A divergence inside the clock margin is reported as a conflict instead of skipped.
- Rename collisions are resolved with a ` (2)` suffix instead of failing.
- One shared progress panel, styled from `styles.css`, instead of eight inline copies.

### Fixed

- A note is no longer deleted when its card was merely dragged to another list: the
  board is consulted first, and such a note is reported as moved instead.
- The progress total no longer counts creations or deletions the current settings
  forbid, so the bar reaches 100%.
- A missing report-note setting now says so, instead of reporting an empty path.

### Security

- Credentials are stored only in the plugin's `data.json`, never in a vault note, and
  are redacted from error messages and logs — including from a transport-level failure,
  whose message would otherwise carry the full URL with the key and token in it.
