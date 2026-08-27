# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
