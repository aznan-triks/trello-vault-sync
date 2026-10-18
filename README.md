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
| Sync this note with its card | Reconcile the open note with its linked Trello card, in whichever direction the newest change points. |
| Update this note from its card | Overwrite the open note with the linked card's current content. |
| Update the card from this note | Overwrite the linked Trello card with the open note's current content. |
| Overwrite this note with its card | Pull from the linked card regardless of which side changed more recently. |
| Overwrite the card with this note | Push to the linked card regardless of which side changed more recently. |
| Link this note to the card with the same name | Find the best-matching Trello card by title and link it to the open note. |
| Link this note to a card I choose | Search Trello cards by name and link the one you pick to the open note. |
| Unlink this note from its card | Remove the Trello properties from the open note. The card and the note's text are left untouched. |
| Compare this note and its card side by side | Show the note and its card side by side when both changed, and choose which one wins. |
| Open the card view | Show the open note's Trello card in a side panel: read it, and edit it if editing is on. |
| Create a card from this note | Create a new Trello card from the open note and link it back. |
| Undo the last sync of this note | Revert the most recent sync write made to the open note. |

### Folders

| Command | What it does |
| --- | --- |
| Sync one folder with its list | Pick one list ↔ folder mapping and reconcile just that pair. |
| Sync every folder with its list | Reconcile every configured list ↔ folder mapping in one pass. |
| Update a folder's notes from its list | Pull a mapped folder's cards into its notes; a genuine conflict is reported, not overwritten. |
| Update a list's cards from its folder | Push a mapped folder's notes to their cards; a genuine conflict is reported, not overwritten. |
| Overwrite a folder's notes with its list | Pull every mapped folder from Trello regardless of which side changed more recently. |
| Overwrite a list's cards with its folder | Push every mapped folder to Trello regardless of which side changed more recently. |

### Vault

| Command | What it does |
| --- | --- |
| Open the sidebar | Open this panel — mostly useful from the command palette when the panel is closed. |
| Sync every linked note with its card | Reconcile every note in the vault that's already linked to a Trello card. |
| Update every linked note from its card | Pull every linked card into its note; a genuine conflict is reported, not overwritten. |
| Update every card from its linked note | Push every linked note to its card; a genuine conflict is reported, not overwritten. |
| Overwrite every linked note with its card | Pull every linked note in the vault from Trello regardless of which side changed more recently. |
| Overwrite every card with its linked note | Push every linked note in the vault to Trello regardless of which side changed more recently. |

### Create

| Command | What it does |
| --- | --- |
| Create a note from an unlinked card | Pick a Trello card with no linked note yet and create one for it. |
| Recreate the missing cards of notes | Pick a note with no linked Trello card yet and create one for it. |
| Create notes and cards from the link report | Create notes for the orphan cards and cards for the unlinked notes left unchecked in the link audit report — all of it, or one list or folder. |
| Create notes from the link report | Create notes only for the orphan cards left unchecked in the link audit report — all of them, or one list. |
| Create cards from the link report | Create Trello cards only for the unlinked notes left unchecked in the link audit report — all of them, or one folder. |

### Audit

| Command | What it does |
| --- | --- |
| Report unlinked cards and notes | Report Trello cards with no linked note, and notes with no linked card. |
| Open the link report | Open the note where "Report unlinked cards and notes" writes its report. |
| Report notes in the wrong folder | Report notes whose folder doesn't match their card's current Trello list. |
| Fetch the Trello change log | Report what changed on Trello since the last time this audit ran. |
| Export the change log as HTML | Write the Trello change log to a standalone HTML page in the vault. |

### History

| Command | What it does |
| --- | --- |
| Show the sync history | List past sync runs and what each one wrote. |
| Undo the last sync | Revert every write made by the most recent sync run. |
| Undo part of a past sync | Pick a past sync run and choose which of its writes to revert. |

Plus **"Turn test mode (dry-run) on or off"**, which flips the Dry run setting — a command in
the palette, and a switch at the top of the sidebar panel.

A note points at its card through a single frontmatter key:

```yaml
trello_board_card_id: "<boardId>;<cardId>"
```

A bare card id is accepted too. Unfilled `{{CARD_ID}}` template placeholders are
ignored rather than sent to the API.

You never need to type that value by hand: run **"Link this note to a card I choose"** and search the board's cards by name, or **"Link this note to the card with the same name"**
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
   **"Link this note to a card I choose"**.
6. **Turn on Dry run**, then run **"Sync one folder with its list"** once —
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
  conflict, Sync titles, Dry run, Create missing notes (overridable per
  mapping), adopting an unlinked note named like a card, and confirmations
  before a forced sync or an unlink.
- **When a card changes on Trello** — what a sync does with a note whose card
  was moved to another list (follow it to the matching folder, keep, trash),
  archived (remove the Trello properties — the default —, keep, move to an
  archive folder, trash) or deleted (remove the properties, keep, trash), the
  archive folder with its two options, and what happens to a card whose note
  you deleted (stop recreating it and list it under *Ignored cards*, archive
  the card, or recreate the note). Every change can be undone from the sync
  history.
- **Labels** — merge vs. overwrite when the note's and the card's labels diverge.
- **Labels to properties** — map a Trello label to a note property and value(s)
  (for example label *NPC* writes `type: npc`); scan the board's labels, then
  fill the key and values of each row. A label counts as present on the note
  when all its values are in the property.
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
  and per-mapping overrides for Create missing notes / "Never trash notes in this folder".
- **Ribbon icons** — a toggle per command, choosing which ones get a button in
  Obsidian's left ribbon; every command stays available from the sidebar panel
  and the command palette regardless of this setting.
- **Card view** — the side panel showing the Trello card of the open note
  (see below): which sections it shows and in which order, which fields can be
  edited, cache durations, comments loaded, date format and more.
- **Advanced** — similarity threshold for automatic title-matching, whether
  attachments and checklists are fetched together with the cards, the progress
  panel and its auto-close delay, the frontmatter key used for each synced
  value (including the card-link key itself and the optional
  `trello_plugin_note_id`), and a closed *Expert settings* block (network
  retries and timings, rarely changed values, report wording).

Every setting shows its default value; a changed one is marked and can be reset
with one click, and the top of the tab says how many differ from the defaults
(with a *Show only changed* filter). Sub-settings of a switch are hidden while
it is off.

### Card view

**"Open the card view"** opens a side panel that follows the open note and
shows its Trello card: cover, title, list, due date, labels, members,
description, checklists, attachments, custom fields and comments. One request
per card, reused for a configurable time, and none while the note is not linked
or the panel is hidden. With editing on (the default) you can change the title,
description, due date, list, labels, members, checklist items, comments, custom
fields, attach a link, and archive the card — but never delete a comment, an
item, an attachment or the card. The gear button chooses which sections one
particular card shows.

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
