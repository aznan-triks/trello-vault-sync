# Trello Vault Sync

Two-way Trello sync, link auditing and card matching for Obsidian — built for a
worldbuilding vault where every note mirrors a card on a single board.

![status](https://img.shields.io/badge/status-personal%20project-orange)

It replaces a set of Templater user scripts driven by ribbon buttons: one plugin,
one credential pair, native commands, and a test suite.

This plugin was built for one specific vault, but the entire plugin — code, comments,
and everything you see inside Obsidian (commands, settings, the progress panel,
Notices, and the Markdown audit reports it writes into your notes) — is in English.
There is no language setting.

## Features

| Command | What it does |
| --- | --- |
| Sync active note | Pull or push automatically, based on which side changed last |
| Pull / push active note | Force one direction, ignoring timestamps |
| Link active note to a card | Fuzzy-matches the file name against the board and writes the id |
| Sync all linked notes | Walks the scope folder, one board request for the whole run |
| Sync a list with its folder | Mirrors one Trello list into one vault folder |
| Sync every list | Runs all configured list ↔ folder pairs |
| Audit links | Cards without notes, notes with broken ids, notes with no card |
| Audit locations | Table of where each linked note lives versus its Trello list |
| Toggle dry run | Plan everything, write nothing |

A note points at its card through a single frontmatter key:

```yaml
trello_board_card_id: "<boardId>;<cardId>"
```

A bare card id is accepted too. Unfilled `{{CARD_ID}}` template placeholders are
ignored rather than sent to the API.

## Install (manual — not on the community plugin store)

```bash
npm install
npm run check
```

Copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/trello-vault-sync/`, then enable the plugin in Obsidian's
Community Plugins settings.

For live development, `npm run dev` rebuilds `main.js` on save.

## Configuration

Everything lives in the plugin settings — **never in a vault note**.

- **API key / token** — a single pair, from <https://trello.com/app-key>. Stored in
  the plugin's own `data.json`, redacted from every error message and log line.
- **Board id** — the id in the board URL, or use the picker button next to the field to
  fuzzy-search your boards by name instead of hunting for the id.
- **Scope** — folder the vault-wide commands walk; empty means the whole vault.
- **Report note** — existing note the audits write into.
- **Arbitration** — newer wins (default), Obsidian always wins, or Trello always wins.
- **Clock margin** — below this gap the two sides count as simultaneous, and a real
  divergence is reported as a conflict instead of being resolved by a coin flip.
- **List ↔ folder mappings** — one row per pair, with the template used for new notes.
  Each list id also has a picker button to search the selected board's lists by name.
- **Create / delete** — creation is on by default. Deletion is off by default, only ever
  uses Obsidian's trash, and only fires for a card that left the *board*: a card dragged
  to another list leaves its note untouched and is reported as moved.

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
  features/   sync and audit engines, written against the interfaces
  ui/         progress panel, mapping picker
  settings/   settings shape and settings tab
```

`core/` never imports Obsidian, so the sync decisions, the folder planner and the
report builders run in plain Node under Vitest. `features/` depends on the
`VaultGateway` and `TrelloClient` interfaces, so the engines are exercised end to end
against an in-memory vault and a stubbed transport.

## Scripts

```bash
npm run check       # typecheck + tests + production build
npm test            # tests only
npm run build       # typecheck + production build
npm run dev         # watch build
```

## Notable differences from the scripts it replaces

- One credential pair instead of one per script, held in settings, never in a note.
- One board request per batch run instead of one request per note.
- Retry with exponential backoff on 429 and 5xx, instead of aborting the whole run.
- Frontmatter handled as YAML (or line-wise), never with `indexOf("---", 3)` — a `---`
  inside a YAML value no longer corrupts the note, and BOM/CRLF files are safe.
- Simultaneous divergence surfaces as a conflict instead of being silently skipped.
- Note deletion is opt-in, checks the whole board first, and uses Obsidian's trash
  rather than the system trash.
- Rename collisions get a ` (2)` suffix instead of failing.

## License

[MIT](LICENSE)
