# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
