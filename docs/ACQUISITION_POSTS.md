# Acquisition & Launch Posts — Trello Vault Sync

> **Instructions for the author:**
> - These posts are prepared for **you to publish under your own name / account**.
> - Always attach the demonstration visual (`docs/media/card-view-preview.svg` or `card-view-demo.gif`) at the top of the post or as media attachment.
> - Ensure you check each subreddit's flair and self-promotion rules before clicking submit (summaries provided below).

---

## Baseline Community Stats (2026-10-18 / 2026-10-19)

- **Total Community Downloads:** `194`
- **Store Status:** Listed on Obsidian Community Plugins (`trello-vault-sync`)
- **Repository:** [https://github.com/aznan-triks/trello-vault-sync](https://github.com/aznan-triks/trello-vault-sync)
- **Obsidian Store Link:** `obsidian://show-plugin?id=trello-vault-sync`

| Checkpoint | Target Date | Target Downloads | Measured Downloads | Notes / Key Feedback |
|---|---|---|---|---|
| Baseline | 2026-10-19 | 194 | 194 | Store release v1.24.0 live |
| 1 Week | 2026-10-26 | 300+ | _TBD_ | Follow up after Reddit & Discord posts |
| 1 Month | 2026-11-19 | 600+ | _TBD_ | Evaluate organic growth and first reviews |

---

## 1. Subreddit Promotion Guidelines & Etiquette

- **r/ObsidianMD**:
  - Flair required: `Plugin` or `Showcase`.
  - Self-promotion rule: Must declare yourself as the developer clearly. Provide direct GitHub and Community Plugin links. No URL shorteners, no affiliate links.
  - Tone: Technical, helpful, community-focused, and appreciative of the ecosystem.
- **r/PKMS** (Personal Knowledge Management Systems):
  - Focus on workflow: How bridging mobile task boards (Trello) with deep linked markdown notes solves friction without vendor lock-in.
  - Avoid feature-dumping; emphasize personal workflow clarity.
- **r/worldbuilding**:
  - Emphasize character/location/quest cards mapped to extensive world bible notes.
  - Focus on visual organization of factions, timelines, and lore notes.
- **r/Trello**:
  - Focus on local offline backup, markdown formatting, and bidirectional syncing with an external knowledge graph.

---

## 2. Reddit Post Drafts

### A. r/ObsidianMD

**Post Title:**
> [Plugin] Trello Vault Sync: Two-way sync, interactive card side panel, and safe conflict arbitration

**Body:**

Hi everyone,

I built **Trello Vault Sync** to solve a persistent friction in my workflow: using Trello on mobile for quick task and board organization, while doing my actual deep work and writing inside an Obsidian vault.

While plugins like nathonius's classic Trello plugin laid great groundwork, I needed a solution with **bidirectional synchronization**, **offline safety**, and **a native side panel view** where I can inspect and edit cards directly inside Obsidian.

Here is what the plugin does:

1. **Interactive Card View (Sidebar)**:
   - Follows your currently open note in real time.
   - Shows cover image, due dates, checklists, members, custom fields, and comments.
   - **Everything is editable live**: check tasks off, update due dates, add comments, or archive the card without opening a browser.

2. **True Two-Way Synchronization**:
   - Works at note scope, folder ↔ list mapping, or vault-wide.
   - Smart arbitration: automatically resolves changes based on the newest edit timestamp, or surfaces a side-by-side conflict modal when both sides changed simultaneously.
   - Never loses your work: note deletions are sent to Obsidian's trash (never permanently destroyed), and file modification dates (`mtime`) are preserved to prevent phantom sync loops.

3. **100% Undoable**:
   - Every sync run is recorded. Hit **"Undo the last sync"** to roll back any write to your notes and Trello cards.

4. **Zero Setup to Start**:
   - You only need your Trello API Key/Token (from `trello.com/app-key`) and to pick your board with an inline search picker. Default settings work out of the box.

- **Install via Obsidian**: Settings → Community plugins → Browse → search `Trello Vault Sync`
- **GitHub**: https://github.com/aznan-triks/trello-vault-sync

I'd love to hear your feedback, bug reports, and workflow ideas!

---

### B. r/PKMS

**Post Title:**
> Bridging Trello & Obsidian: Bidirectional sync with interactive card views and zero data lock-in

**Body:**

Hi all,

One of the classic PKMS dilemmas is the tension between **fast mobile capture / board-based task management** (like Trello) and **deep networked thought** (like Obsidian).

Many of us end up duplicating data manually or relying on clunky one-way webhooks that break markdown formatting.

I released an open-source community plugin for Obsidian called **Trello Vault Sync** to bridge this gap:

- **Local-first & standard Markdown**: Your notes stay pure markdown with YAML frontmatter. No proprietary database layers.
- **Interactive Sidebar Card View**: Displays your Trello card alongside your open note, allowing you to check checklist items, update deadlines, and inspect attachments without context switching.
- **Two-way Reconcile**: Sync an active note or an entire folder of notes with a Trello list. Clock drifts and simultaneous edits are safely detected with visual diff conflict resolution.
- **Rollback History**: Any batch sync or note update can be completely undone with a single command.

If your workflow involves moving between Trello boards and a local Markdown vault, give it a try. Available directly in Obsidian's Community Plugin directory.

- Community Plugin: `Trello Vault Sync`
- Repo: https://github.com/aznan-triks/trello-vault-sync

Feedback and thoughts on your personal sync setup are very welcome!

---

### C. r/worldbuilding

**Post Title:**
> Tool: Sync your Trello worldbuilding boards directly into Obsidian notes (two-way sync + card sidebar)

**Body:**

Fellow worldbuilders,

If you organize your campaigns, factions, locations, and NPC rosters on Trello boards, but write your extensive lore, history, and interconnected wikis inside Obsidian, keeping them in sync can be tedious.

I built **Trello Vault Sync** (free and open source, available in the Obsidian community plugin browser):

- **Every card mirrors a lore note**: Map lists (e.g. "Kingdoms", "NPCs", "Plot Hooks") to vault folders.
- **Interactive Card Side Panel**: When reading a lore note in Obsidian, the right sidebar automatically loads the matching Trello card with its cover art, checklist quest goals, status tags, and comments.
- **Safe Two-Way Sync**: Tweak an NPC's description or mark a quest stage complete on Trello mobile, and sync it right into your Obsidian note (or vice-versa).
- **Safe Cleanup**: If you stop syncing a specific property or archive a card, your notes are never corrupted or permanently deleted.

Available now in Obsidian Settings → Community plugins (search for `Trello Vault Sync`).

GitHub: https://github.com/aznan-triks/trello-vault-sync

---

### D. r/Trello

**Post Title:**
> Two-way sync your Trello cards with Obsidian Markdown notes (open-source plugin)

**Body:**

Hi r/Trello!

For anyone using Obsidian alongside Trello, I created an open-source Obsidian plugin called **Trello Vault Sync**.

It lets you:
- Pair Trello lists with local Markdown folders.
- View and edit cards directly in Obsidian's sidebar (edit descriptions, tick checklists, adjust due dates, post comments).
- Run bidirectional syncs where newest changes win, backed by a full undo history and conflict detection.

Direct link to repo and documentation: https://github.com/aznan-triks/trello-vault-sync
It can be installed directly from Obsidian's Community Plugins tab.

Hope this helps anyone looking to connect their boards to an offline Markdown knowledge base!

---

## 3. Obsidian Community Channels (Discord & Forum)

### Discord (`#plugin-releases` / `#plugin-showcase`)

```
**Trello Vault Sync** is now available in Community Plugins! 🚀

Two-way Trello synchronization, interactive card sidebar panel, and safe conflict handling for Obsidian.

✨ **Key Features:**
• **Interactive Card View**: View & edit the linked card (checklists, due date, description, comments) right inside Obsidian's sidebar.
• **Two-way sync**: Active note, folder ↔ list mapping, or whole vault.
• **Safe by design**: Conflict detection modal, safe trash handling, 100% undoable sync history.
• **Zero config needed to start**: Connect your board and sync your first note in under 5 minutes.

📥 Search **Trello Vault Sync** in Obsidian Community Plugins.
🔗 GitHub: https://github.com/aznan-triks/trello-vault-sync
```

### Obsidian Official Forum (Category: Plugins / Share & Showcase)

```markdown
**Title:** [Plugin] Trello Vault Sync — Two-way sync, interactive card sidebar, and safe conflict resolution

Hello Obsidian community,

I'm happy to announce that **Trello Vault Sync** is available on the Community Plugins store.

### Why Trello Vault Sync?
Many users track high-level tasks, agile sprints, or mobile capture in Trello, while keeping long-form notes and knowledge networks inside Obsidian. Trello Vault Sync connects them smoothly without locking you into proprietary formats.

### Highlights:
- **Interactive Card View in Sidebar**: Inspect card covers, toggle checklists, edit due dates and descriptions directly in Obsidian.
- **True Bidirectional Sync**: Reconcile notes and cards with intelligent timestamp resolution and visual conflict comparison.
- **Safety First**: Non-destructive operations, automatic note cleanup when settings change (with file mtime preservation), and complete rollback history.

Install via **Obsidian Settings → Community plugins → Browse → Trello Vault Sync**.
Full documentation & source: https://github.com/aznan-triks/trello-vault-sync
```

---

## 4. Direct Early-User Review Request Template

*(Send via private message / email to 2–3 genuine contacts who already use Obsidian and Trello)*

> Subject: Quick favor: trying out my new Obsidian + Trello sync plugin?
>
> Hi [Name],
>
> I just published a new plugin to Obsidian's Community store called **Trello Vault Sync** (https://github.com/aznan-triks/trello-vault-sync). It provides two-way syncing and an interactive card view sidebar so you can view and edit your Trello cards directly inside Obsidian.
>
> Since I know you use both tools, I would love your authentic take on it. Could you test installing it (Settings → Community plugins → search "Trello Vault Sync") and let me know:
> 1. Was the initial connection and first note sync intuitive?
> 2. How does the sidebar Card View feel in your day-to-day workflow?
>
> If you find it helpful, leaving a review or feedback on GitHub / Obsidian forum would mean the world to me. Thanks so much!
