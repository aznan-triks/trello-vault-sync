type: refacto
init: full
Terminé quand : `npm run check` vert (typecheck + tests + build) ET les 10 commandes + les 4 icônes ribbon testées une à une dans `test-vault/` sans régression observable (résultat documenté phase par phase dans ce plan)
État actuel observé : N/A — pas un domaine signalé cassé, refacto planifiée (backlog priorité moyenne, `NEXT_SESSION.md`)
Ressources consultées : `src/main.ts` (438 lignes, 12 responsabilités mélangées : lifecycle du plugin, câblage `addCommand`/`addRibbonIcon`, 4 builders d'options — `noteOptions`/`folderOptions`/`auditOptions`/`ready` —, `run()`/`panel()`/`activeNote()`, 10 handlers de commande) ; `src/features/syncFolder.ts` (pattern déjà établi : orchestration extraite dans `features/`, fonctions prenant gateway+client+options+reporter+signal) ; `src/obsidian/gateway.ts` (`Reporter`, `NoteHandle`) ; `src/settings/types.ts` (`TrelloVaultSyncSettings`) ; grep confirmant qu'aucun fichier de `tests/` n'importe `main.ts`
Décision : crée nouveau `src/commands/{context.ts, noteCommands.ts, syncCommands.ts, auditCommands.ts}` — aucun module existant n'isole le câblage des commandes ; `main.ts` reste le seul point d'entrée `addCommand`/`addRibbonIcon` (API Obsidian) mais délègue le corps de chaque handler
Valeurs fixes introduites : 0
Périmètre — IN : extraction des 10 handlers de commande + des builders d'options (`noteOptions`/`folderOptions`/`auditOptions`) + `activeNote()`/`ready()` vers `src/commands/`, `main.ts` réduit à lifecycle + câblage
Périmètre — OUT : tout changement de comportement observable (Notice, rapports, icônes) ; `ProgressPanel`/`ConflictModal`/`MappingSuggest` eux-mêmes (inchangés, seulement réutilisés) ; renommage de commande ou d'icône ribbon

### Invariants post-refacto
- Les 10 commandes produisent exactement les mêmes `Notice`/résumés qu'avant (aucune régression de comportement observable) — vérifié en vrai dans `test-vault/`, pas seulement par les tests unitaires (§1.7 CONTEXT.md)
- Les 4 icônes ribbon pointent vers les mêmes commandes qu'avant
- `src/commands/*.ts` ne sont importés par aucun fichier de `tests/` (même statut que `src/ui/*.ts`) — importer `"obsidian"` y reste donc sans risque pour la suite vitest (§9 CONTEXT.md)
- Ids et noms de commande (`this.addCommand({ id, name, ... })`) inchangés — pas de breaking change sur les raccourcis clavier déjà assignés par l'utilisateur

### Impact sur l'existant
- `main.ts` : ~438 lignes → cible < 150 lignes (lifecycle `onload`/`onunload`/`saveSettings` + `registerCommands()`/`registerRibbon()` + `client()` + implémentation de `CommandContext`)
- Aucun fichier de `tests/` à modifier (aucun test n'importe `main.ts` aujourd'hui, aucun n'importera `src/commands/`)
- 3 nouveaux fichiers dans `src/commands/` (+ `context.ts`)

### Aucun hardcode introduit
Confirmé — uniquement déplacement de code existant, aucune nouvelle valeur/chemin/seuil.

---

## Phases

**Phase 1 — `CommandContext`**
Définir l'interface `CommandContext` dans `src/commands/context.ts` : `app`, `vault`, `settings`, `client(reporter?)`, `run(title, body, opts?)`, `activeNote()`, `ready(needsBoard?)`, `noteOptions(force?)`, `folderOptions()`, `auditOptions()`, `saveSettings()`. `TrelloVaultSyncPlugin` l'implémente explicitement (`implements CommandContext` ou `satisfies`), aucun comportement changé.
Vérification : `npm run check` vert.

**Phase 2 — commandes note-level**
Extraire vers `src/commands/noteCommands.ts` (fonctions prenant `ctx: CommandContext`) : `sync-active-note`/`pull-active-note`/`push-active-note` (fonction `syncActive`), `link-active-note`, `resolve-conflict`, `toggle-dry-run`. `main.ts` appelle ces fonctions depuis `registerCommands()`.
Vérification : `npm run check` vert.

**Phase 3 — commandes sync/folder**
Extraire vers `src/commands/syncCommands.ts` : `sync-vault` (`syncAllLinked`), `sync-mapping` (`syncOneMapping` + `runMapping`), `sync-all-mappings`.
Vérification : `npm run check` vert.

**Phase 4 — commandes audit + nettoyage `main.ts`**
Extraire vers `src/commands/auditCommands.ts` : `audit-links`, `audit-locations`. Supprimer de `main.ts` les méthodes privées désormais inutilisées ; `registerRibbon()` pointe vers les fonctions extraites.
Vérification : `npm run check` vert + grep `private async` dans `main.ts` ne doit plus laisser de handler de commande (seuls lifecycle/câblage restent).

**Phase 5 — passage réel + livraison**
Test manuel dans `test-vault/` : les 10 commandes (palette) + les 4 icônes ribbon, un par un, résultat noté ici (commande → comportement observé). Puis §6 CONTEXT.md : bump version (PATCH — refacto pure), entrée `CHANGELOG.md`, revue de code (§7).
Vérification : `npm run check` vert + tableau de test manuel rempli ci-dessous + revue de code sans finding bloquant.

#### Résultats du passage réel (Phase 5)

Accès accordé par l'utilisateur dans une session suivante. Plugin rechargé (désactivé/réactivé) dans `test-vault/` pour charger `main.js` v1.4.4. Dry-run activé avant test pour ne rien écrire pour de vrai sur le board Trello de test. Chaque commande testée via la palette (`Ctrl+P`) ou son icône ribbon, sur les notes réelles du coffre de test (note "2", liée à une carte ; "Bienvenue", non liée).

| Commande / icône | Comportement observé |
|---|---|
| Sync active note (palette) | Notice "✅ Already up to date." — panneau "Sync — 2 (dry run)", 1/1 |
| Toggle dry-run mode | Notice "Dry-run mode disabled." puis "Dry-run mode enabled." (testé dans les deux sens) |
| Pull from Trello (active note) | Notice "✅ Pulled from Trello." |
| Push to Trello (active note) | Notice "✅ Pushed to Trello." |
| Resolve conflict (active note), side by side | Notice "No conflict on this note — nothing to resolve." |
| Link active note to a card (sur note non liée "Bienvenue") | Notice "No card close enough to the note's title." |
| Sync all linked notes (palette) | Panneau "Vault sync (dry run)" — grille de stats complète, "19 card(s) on the board, 0 linked note(s)" |
| Sync a list with its folder (palette) | `MappingSuggest` affiche "Projects/Ideas" → panneau "Sync — Projects/Ideas (dry run)", 9/9, "9 card(s) in the list" |
| Sync every list with its folder | Panneau "Sync all mappings (dry run)", 9/9, "1 folder(s) · +0 · ↓0 · ↑0 · ✕0" |
| Audit links (orphan cards and notes) | Notice "✅ 19 orphan card(s) · 0 phantom note(s) · 0 unlinked note(s)" |
| Compare locations against Trello lists | Notice "✅ 0 note(s) compared · 0 outside their expected list" (scope réduit au dossier "1", cohérent avec les réglages) |
| Icône ribbon "Sync active note" (sur note non liée) | Notice "✅ Note not linked — use \"Link active note to a card\"." — confirme le chemin d'erreur aussi |
| Icône ribbon "Sync all linked notes" | Identique au test palette ci-dessus |
| Icône ribbon "Sync a list with its folder" | Identique au test palette ci-dessus |
| Icône ribbon "Audit Trello links" | Identique au test palette ci-dessus |

**Aucune régression, aucune exception, aucun crash** sur les 10 commandes + 4 icônes. Build (`main.js`/`manifest.json`/`styles.css`) copié dans `test-vault/.obsidian/plugins/trello-vault-sync/`.

Revue de code obligatoire (§7) : 2 sub-agents Standards/Spec en parallèle.
- **Spec** : aucun écart de comportement — les 10 ids/noms de commande et les 4 icônes ribbon sont identiques caractère pour caractère à l'original, chaque handler reproduit le corps exact de la méthode d'origine.
- **Standards** : 2 violations dures trouvées et corrigées — (1) boucle `for (const [key, value] of Object.entries(stats)) reporter.count(...)` dupliquée 3x dans `syncCommands.ts` → extraite en un helper `reportStats()` ; (2) `runMapping` exporté sans consommateur hors fichier → export retiré. 2 points signalés comme jugement, non corrigés car comportement **préexistant** avant cette refacto, hors périmètre du plan (`resolveConflict` : `catch` sans `console.error`, et `ctx.client()` appelé sans reporter — les deux étaient déjà ainsi dans l'ancien `main.ts`) : reportés en backlog `NEXT_SESSION.md`.

## Écarts

- Cible chiffrée du plan "`main.ts` < 150 lignes" non atteinte : 249 lignes. `main.ts` ne contient plus que lifecycle + câblage + les builders/helpers partagés (`client`, `noteOptions`/`folderOptions`/`auditOptions`, `run`, `panel`, `activeNote`, `ready`) exposés via `CommandContext` — les déplacer plus loin aurait ajouté de l'indirection sans réduire le nombre de responsabilités (YAGNI), donc écart assumé plutôt que corrigé.
- §1.7 satisfait a posteriori : le premier passage avait été bloqué (accès à l'automatisation du bureau refusé), corrigé dans une session suivante après accord explicite de l'utilisateur — voir tableau Phase 5 ci-dessus.
