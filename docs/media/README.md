# Media Assets & Demo GIF Guidelines

This directory contains visual documentation assets for **Trello Vault Sync**.

## Assets

| File | Type | Description |
|---|---|---|
| `card-view-preview.svg` | Vector diagram | Dark-theme illustration showing Obsidian note side-by-side with the Card View side panel. |
| `card-view-demo.gif` | Animated GIF | Live recording showing the Card View following the active note and editing a field. |
| `note-sync-demo.gif` | Animated GIF | Live recording showing note linking and the first sync with visual feedback. |

## Recording Specifications for Demo GIFs

To keep the repository fast to clone and ensure crisp rendering in the Obsidian community plugin browser and GitHub README:

1. **Size Budget**: Strict maximum of **1 MB** per GIF (target: 600–900 KB).
2. **Resolution**: 800 × 500 px or 720 × 450 px (maintain high DPI text legibility without oversized dimensions).
3. **Framerate**: 12 to 15 fps (smooth enough for UI transitions, compact file size).
4. **Theme**: Obsidian Default Dark Theme or Minimal Dark.
5. **Tool recommendation**: [ScreenToGif](https://www.screentogif.com/) (Windows) or [LICEcap](https://www.cockos.com/licecap/).

### Scenario 1: `card-view-demo.gif` (Duration: ~5–7 seconds)
- **Start**: Obsidian open with an active markdown note linked to a Trello card. The Card View panel is open in the right sidebar.
- **Action 1**: Switch to another note. Show the Card View panel instantly updating its cover banner, title, due date, and checklists to reflect the new note.
- **Action 2**: Click a checkbox in the Card View checklist. The item marks complete and immediately syncs to Trello.
- **End**: Clean pause on the updated card view.

### Scenario 2: `note-sync-demo.gif` (Duration: ~4–6 seconds)
- **Start**: A note open in Obsidian.
- **Action 1**: Open command palette (`Ctrl+P`), trigger **"Sync this note with its card"**.
- **Action 2**: The subtle progress notice appears, showing successful bidirectional sync.
- **End**: Frontmatter timestamp / status updated.
