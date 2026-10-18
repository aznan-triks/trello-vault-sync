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
| Baseline | 2026-10-19 | 194 | 194 | 194 read on the registry page; measured against v1.24.0, not re-checked after 1.24.1 |
| 1 Week | 2026-10-26 | 300+ | _TBD_ | Follow up after Reddit & Discord posts |
| 1 Month | 2026-11-19 | 600+ | _TBD_ | Evaluate organic growth and first reviews |

---

## 1. Subreddit Promotion Guidelines & Etiquette

**Read this before posting.** These rules were checked on 2026-10-19: Reddit's own rule pages
(`/about/rules/`) return a login wall or HTTP 403 to every fetcher available here, so the quotes
below come from third-party pages that reproduce them verbatim, with their read date. Treat them as
a warning list, not as authority: open each subreddit's sidebar yourself on the day you post.

| Subreddit | What the rules actually say |
|---|---|
| **r/ObsidianMD** | *"Don't shill. If you are just here to advertise your product, don't."* Under "No slop": *"If your first and only post is to promote your project (vibe-coded or otherwise), you will be immediately banned."* Same rule: *"Don't post AI-generated content, it will be removed."* Posting is limited to approved users. **A first-and-only promotional post from the author's account is an immediate ban** — this is the single biggest risk here, and no flair saves it. |
| **r/PKMS** | *"You may post about systems/programs you have created, but not if it reads like an ad."* Promotional posts belong in the monthly "Self promotion" thread; blatant ads and one-line app posts are removed. |
| **r/worldbuilding** | *"We allow non-disruptive advertising… Ads should be able to demonstrate some relevance and usefulness to the community."* The binding constraint is the context rule: a post must carry worldbuilding context. A bare tool announcement fails it. *"AI content is not appropriate for our community."* |
| **r/Trello** | No rule text could be verified. Do not post there without reading the sidebar rules, or ask the moderators first. |

Consequences for these drafts: no emoji, no superlatives, say plainly that you are the author, link
the repository and the community-plugin page directly, and **participate in the subreddit before
posting** — the drafts are ready, the account history is the missing part.

---

## 2. Reddit Post Drafts

### A. r/ObsidianMD

**Post Title:**
> [Plugin] Trello Vault Sync: Two-way sync, interactive card side panel, and safe conflict arbitration

**Body:**

Hi everyone,

I built **Trello Vault Sync** to solve a persistent friction in my workflow: using Trello on mobile for quick task and board organization, while doing my actual deep work and writing inside an Obsidian vault.

While plugins like nathonius's classic Trello plugin laid great groundwork, I needed **bidirectional synchronization** with a **native side panel view** where I can inspect and edit cards directly inside Obsidian.

Here is what the plugin does:

1. **Interactive Card View (Sidebar)**:
   - Follows your currently open note in real time.
   - Shows cover image, due dates, checklists, members, custom fields, and comments.
   - **Everything is editable live**: check tasks off, update due dates, add comments, or archive the card without opening a browser.

2. **True Two-Way Synchronization**:
   - Works at note scope, folder ↔ list mapping, or vault-wide.
   - Smart arbitration: automatically resolves changes based on the newest edit timestamp, or surfaces a side-by-side conflict modal when both sides changed simultaneously.
   - Note deletions go to Obsidian's trash rather than being erased, and file modification dates (`mtime`) are preserved so a cleanup doesn't look like an edit.

3. **Undoable sync history**:
   - Every sync run is recorded. Hit **"Undo the last sync"** to roll back the notes it wrote, and the Trello writes it made when Trello rollback is enabled.

4. **Nothing to configure to start**:
   - You only need your Trello API Key/Token (from `trello.com/app-key`) and to pick your board with an inline search picker. Default settings work out of the box.

What it does not do: it syncs one board per vault (the board you pick in settings), it needs network access to Trello, it never deletes a card, comment, checklist item or attachment on Trello, and it does not make Trello work offline.

- **Install via Obsidian**: Settings → Community plugins → Browse → search `Trello Vault Sync`
- **Plugin page**: https://community.obsidian.md/plugins/trello-vault-sync
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
- **Safe Cleanup**: If you stop syncing a specific property or archive a card, leftover properties are removed from the note, and deletions go to the trash.

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

Hope this helps anyone looking to connect their boards to a local Markdown knowledge base!

---

## 3. Obsidian Community Channels (Discord & Forum)

### Discord (`#plugin-releases` / `#plugin-showcase`)

```
**Trello Vault Sync** is now available in Community Plugins.

Two-way Trello synchronization, an interactive card sidebar panel, and conflict handling for Obsidian.

**Key features:**
- **Interactive Card View**: view and edit the linked card (checklists, due date, description, comments) inside Obsidian's sidebar.
- **Two-way sync**: active note, folder ↔ list mapping, or whole vault.
- **Safe by design**: conflict detection modal, notes moved to the trash rather than erased, undoable sync history.
- **Nothing to configure to start**: connect your board and sync your first note in a few minutes.

Search **Trello Vault Sync** in Obsidian Community Plugins.
GitHub: https://github.com/aznan-triks/trello-vault-sync
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

> Subject: Would you try Trello Vault Sync and tell me what breaks?
>
> Hi [Name],
>
> I published an Obsidian plugin, Trello Vault Sync: it links a note to a Trello card and syncs the newer side into the other.
> https://community.obsidian.md/plugins/trello-vault-sync
>
> You use both tools, so your read counts. Twenty minutes and one linked note is enough; where you got stuck is the useful part. A review only if you keep using it.
>
> One question: when you link a note by title, does it pick the right card?

*Note française, à l'attention de l'auteur (ne pas envoyer) :* ce message est écrit pour être envoyé par vous, depuis votre compte, à des personnes que vous connaissez réellement. Ne le copiez pas à des inconnus, n'échangez pas de reviews, n'utilisez pas plusieurs comptes : les règles Reddit et Obsidian sur les avis fabriqués ou sollicités contre rétribution s'appliquent, et une review retirée coûte plus qu'une absence de review. Deux ou trois destinataires suffisent.

---

## 5. Before publishing

```
[ ] card-view-demo.gif exists, under 1 MB, in docs/media/, embedded at the top of each
    post (it does not exist yet: only card-view-preview.svg is there)
[x] 1.24.1 validated in test-vault/ (plan A) — 3 defects fixed, no blocking bug open
[ ] each subreddit's rules re-read the same day, by hand, from the logged-in account
[ ] r/ObsidianMD: the account has real, recent, non-promotional history in the sub
[ ] r/worldbuilding: post rewritten as a world post, with worldbuilding context
[ ] r/Trello: rules read, or the moderators asked
[ ] download baseline re-read from the community page the same day (194 is author-supplied,
    measured against 1.24.0)
[ ] links checked: community page + README anchor; no obsidian:// URI in a web post
[ ] no superlatives, no emoji, the "what it does not do" paragraph kept
[ ] each post published once, from the author's account, with the disclosure "I wrote it"
```
