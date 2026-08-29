# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
