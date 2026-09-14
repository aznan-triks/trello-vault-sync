# Trello Vault Sync

Two-way Trello sync, link auditing and card matching for Obsidian — built for a
worldbuilding vault where every note mirrors a card on a single board.

![license](https://img.shields.io/badge/license-MIT-green)
![obsidian](https://img.shields.io/badge/Obsidian-%E2%89%A51.7.2-7c3aed)

It replaces a set of Templater user scripts driven by ribbon buttons: one plugin,
one credential pair, native commands, and a test suite.

This plugin was built for one specific vault, but the entire plugin — code, comments,
and everything you see inside Obsidian (commands, settings, the progress panel,
Notices, and the Markdown audit reports it writes into your notes) — is in English.
There is no language setting.

**Acknowledgements** — [nathonius's Trello plugin](https://github.com/nathonius/obsidian-trello)
is what first got my notes and Trello cards talking to each other, and using it is
part of what pushed me to build this one. Thanks for the inspiration.

## Features

Every command below is available both from the right sidebar panel and the
command palette.

### Active note

| Command | What it does |
| --- | --- |
| Sync active note | Pull or push automatically, based on which side changed last |
| Pull from Trello (active note) | Force-pull the note from its card, ignoring timestamps |
| Push to Trello (active note) | Force-push the note to its card, ignoring timestamps |
| Force pull (active note) | Same as "Pull from Trello (active note)", under an explicit "force" label |
| Force push (active note) | Same as "Push to Trello (active note)", under an explicit "force" label |
| Link active note to a card | Fuzzy-matches the file name against the board and writes the id |
| Link active note to a card (pick manually) | Search-and-pick modal over the board's cards — use it when the title match above picks the wrong card, or isn't close enough to fire |
| Resolve conflict (active note), side by side | Side-by-side view when both sides changed at once |
| Undo last sync for the active note | Reverts this note's part of the last recorded sync run |

### Folders

| Command | What it does |
| --- | --- |
| Sync a list with its folder | Mirrors one Trello list into one vault folder |
| Sync every list with its folder | Runs all configured list ↔ folder pairs |
| Force pull (mapped folder) | Pick a mapping, then overwrite every note in its folder from Trello, ignoring timestamps |
| Force push (mapped folder) | Pick a mapping, then overwrite every card from its folder's notes, ignoring timestamps |

### Vault

| Command | What it does |
| --- | --- |
| Sync all linked notes | Walks the scope folder, fetching the board's cards in one request |
| Force pull (vault) | Overwrite every linked note in scope from Trello, ignoring timestamps |
| Force push (vault) | Overwrite every linked card from scope's notes, ignoring timestamps |
| Create note from a Trello card | Adopt a card with no note yet — the inverse of linking an existing note to a card |
| Audit links (orphan cards and notes) | Cards without notes, notes with broken ids, notes with no card |
| Compare locations against Trello lists | Table of where each linked note lives versus its Trello list |
| Audit changes (Trello change log) | Trello board activity since the last run, grouped by day then by card, into the report note |
| Export change log as HTML | Standalone page of the same change log, each author's avatar embedded — works offline |
| Show sync history | Lists recorded sync runs, newest first |
| Undo last sync run | Reverts the last recorded run's writes |
| Undo a sync run (pick what to undo) | Pick any recorded run, then check exactly which of its writes to undo |

Plus **"Toggle dry-run mode"**, which flips the Dry run setting — a command in
the palette, and a switch at the top of the sidebar panel.

A note points at its card through a single frontmatter key:

```yaml
trello_board_card_id: "<boardId>;<cardId>"
```

A bare card id is accepted too. Unfilled `{{CARD_ID}}` template placeholders are
ignored rather than sent to the API.

You never need to type that value by hand: run **"Link active note to a card (pick
manually)"** and search the board's cards by name, or **"Link active note to a card"**
for automatic title-matching.

To find which note is linked to which Trello card, the plugin lists the vault's
markdown notes and checks each one's card-link frontmatter key across every
folder — used for vault sync, the link/location audits and moved-note detection;
it reads nothing outside the vault and sends only card-related data to Trello.

### Undo and cancellation

Every sync run is recorded (when Sync history is on), so it can be undone: the
last run, the last run for the active note, or any recorded run with individual
writes picked one by one. Undo reverts vault writes and, if enabled, the matching
Trello writes — it never overwrites something that changed on either side since
the run. The Cancel button on the progress panel stops a sync between requests,
but a request already sent to Trello can't be recalled mid-flight; undo can put
it back afterwards.

## Install

Install from Obsidian's **Settings → Community plugins → Browse**, then search
for "Trello Vault Sync".

You can also install manually: download `main.js`, `manifest.json` and
`styles.css` from a [GitHub release](https://github.com/aznan-triks/trello-vault-sync/releases),
and copy them into `<vault>/.obsidian/plugins/trello-vault-sync/`, then enable
the plugin in Obsidian's Community Plugins settings.

To build from source instead:

```bash
npm install
npm run check
```

For live development, `npm run dev` rebuilds `main.js` on save.

## Quickstart

1. **Get a Trello key and token** — open <https://trello.com/app-key>, copy the
   **Key**, then use the token-generation link on that same page to create a
   **Token** (Trello walks you through granting read/write access).
2. **Install the plugin** — see [Install](#install) above, then enable it in
   Obsidian's Community Plugins settings.
3. **Open the plugin settings**, paste the key and token into the *Trello
   connection* section, then fill **Board id** — start typing to search your
   boards by name instead of hunting for the id.
4. **Click "Test connection"** to confirm the key, the token and board access
   all work before syncing anything.
5. **Add one list ↔ folder mapping**, or link a single existing note first with
   **"Link active note to a card (pick manually)"**.
6. **Turn on Dry run**, then run **"Sync a list with its folder"** once —
   nothing is written, but the log shows exactly what would happen.
7. Happy with the plan? **Turn Dry run off** and run the same command for real.

## Configuration

Everything lives in the plugin settings — **never in a vault note**. Section
names below match the settings tab exactly.

- **Trello connection** — API key and token (a single pair, stored in the
  plugin's own `data.json`), board id with a name-search picker, and "Test
  connection".
- **Scope** — synced folder for the vault-wide commands (empty = whole vault),
  and folders excluded regardless of link state.
- **Audit output** — the report note the audits write into, and the path of the
  standalone HTML change log page.
- **Arbitration & safety** — who wins on conflict (newer side, Obsidian always,
  or Trello always), the clock margin before a divergence counts as a real
  conflict, Sync titles, Dry run, Create missing notes / Delete phantom notes
  (each overridable per mapping), Protect cards moved or archived elsewhere, and
  Confirm before a forced sync.
- **Labels** — merge vs. overwrite when the note's and the card's labels diverge.
- **Attachments** — Sync attachments (pull-only, into frontmatter), Download
  attachments (writes files into the vault, off by default), and where a
  download lands (same folder as the note, or one shared folder).
- **Checklists** — Sync checklists, mirroring the card's checklists as Markdown
  tasks under a configurable section heading.
- **Cover image** — Sync card cover into a frontmatter key (compatible with
  Pixelbanner), and which key it uses.
- **Members** — Sync a card's assigned members into frontmatter as readable
  names, and which key holds them.
- **Custom fields** — Sync a card's custom fields into one frontmatter object,
  keyed by each field's label.
- **Sync history** — the master toggle for recording runs, whether undo also
  reverts Trello writes, whether undoing asks for confirmation first, and how
  many runs are kept before the oldest is dropped.
- **Create note from a card** — fallback folder used by "Create note from a
  Trello card" when the card's list isn't mapped to one (empty = ask each time).
- **Auto-sync** — the master toggle, its triggers (on a timer, on focus, at
  startup), its scope (every mapped folder and/or the whole vault), the timer
  interval, and the minimum gap enforced between runs however they were
  triggered.
- **Trello list ↔ folder** — one row per list/folder pair, its note template,
  and per-mapping overrides for Create missing notes / Delete phantom notes.
- **Ribbon icons** — a toggle per command, choosing which ones get a button in
  Obsidian's left ribbon; every command stays available from the sidebar panel
  and the command palette regardless of this setting.
- **Advanced** — similarity threshold for automatic title-matching, retry
  tuning (retries, initial delay, request timeout, max retry wait), whether
  attachments and checklists are fetched together with the cards, the
  progress panel and its auto-close delay, and the frontmatter key used for
  each synced value (including the card-link key itself).

## Templates

A mapping's template may use `{{TITLE}}`, `{{DESCRIPTION}}`, `{{URL}}`, `{{CARD_ID}}`
and `{{BOARD_ID}}`. Unknown placeholders are left untouched. With no template, a new
note gets a minimal frontmatter and the card description.

`{{TITLE}}` and `{{DESCRIPTION}}` carry arbitrary Trello card text, so when either one
lands inside the frontmatter fence it is rendered as an auto-quoted, YAML-escaped
string — write `title: {{TITLE}}`, not `title: "{{TITLE}}"`, or the value ends up
double-quoted. `{{CARD_ID}}`/`{{BOARD_ID}}`/`{{URL}}` are Trello's own fixed-format
ids and are never escaped, so the default `"{{BOARD_ID}};{{CARD_ID}}"` pattern still
works as written.

## Architecture

```
src/
  core/       pure logic, no Obsidian and no network — where the tests live
  trello/     REST client with an injected transport, retry/backoff, secret redaction
  obsidian/   VaultGateway interface + the real Obsidian implementation
  features/   sync, audit and rollback engines, written against the interfaces
  ui/         sidebar view, progress panel, pickers and confirmation modals
  settings/   settings shape and settings tab
```

`core/` never imports Obsidian, so the sync decisions, the folder planner and the
report builders run in plain Node under Vitest. `features/` depends on the
`VaultGateway` and `TrelloClient` interfaces, so the engines are exercised end to end
against an in-memory vault and a stubbed transport.

## Scripts

```bash
npm run check         # typecheck + hardcode check + tests + production build
npm test               # tests only
npm run build          # typecheck + production build
npm run dev            # watch build
npm run check:hardcode # scans for hardcoded values that belong in settings
```

## Notable differences from the scripts it replaces

- One credential pair instead of one per script, held in settings, never in a note.
- The card list is fetched in one request per batch run instead of one per note,
  attachments and checklists included (unless "Fetch attachments and checklists
  with the cards" is turned off in Advanced).
- Retry with exponential backoff on 429 and 5xx, instead of aborting the whole run.
- Frontmatter handled as YAML (or line-wise), never with `indexOf("---", 3)` — a `---`
  inside a YAML value no longer corrupts the note, and BOM/CRLF files are safe.
- Simultaneous divergence surfaces as a conflict instead of being silently skipped.
- Note deletion is opt-in (globally or per mapping), can spare cards moved or
  archived elsewhere on the board, and always goes through Obsidian's own
  "Deleted files" setting — never a permanent delete.
- Rename collisions get a ` (2)` suffix instead of failing.
- Every sync run can be undone afterward, instead of being a one-way write.

## License

[MIT](LICENSE)
