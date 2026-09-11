type: feature
init: full
Terminé quand : `npm run check` vert (typecheck + tests, dont un nouveau `tests/journal.test.ts` couvrant `appendJournalEntry`, + build) ; grep `catch (error) {` sur `TrelloPickerSuggest.ts` et `SettingsTab.ts` montre `console.error("[trello-vault-sync]", error);` dans les deux blocs ; grep global des `catch` restants (§8) ne montre aucun bloc sans `console.error`/`reporter.log`/re-throw ; déploiement dans `test-vault/.obsidian/plugins/trello-vault-sync/` fait.
État actuel observé : N/A (pas de bug signalé — feature de logging planifiée dans la feuille de route du 2026-09-04, cf. NEXT_SESSION.md)
Ressources consultées :
- `src/ui/TrelloPickerSuggest.ts:33-36` et `src/settings/SettingsTab.ts:144-148` — les 2 `catch` déjà identifiés sans `console.error` (juste un `Notice`).
- `src/main.ts:186-196` (`run()`) — pattern déjà établi : `console.error("[trello-vault-sync]", error)` en plus du `Notice` et du `reporter.log("error", …)`.
- `src/trello/client.ts:184,206` — 2 autres `catch` grepés, tous deux re-throw (direct ou après boucle de retry) → conformes, hors scope.
- `src/features/syncFolder.ts`, `src/features/syncVault.ts` — `catch` déjà couverts par `reporter.log("error", …)` (visible dans le panneau) → conformes, hors scope.
- `src/ui/ProgressPanel.ts` (`log()`, `ICONS`, `MAX_LOG_ROWS`) — rendu d'une ligne de log déjà écrit une fois ; à extraire pour réutilisation plutôt que dupliqué dans le panneau latéral.
- `src/obsidian/gateway.ts` (`Reporter`, union de `LogLevel` inline) — le point d'entrée unique de tout log (`reporter.log(level, message)`).
- `src/main.ts` (`panel()`) — seul endroit qui construit un `Reporter` (`ProgressPanel` ou `silentReporter`) ; point d'accroche naturel pour peupler le journal sans toucher `src/features/`.
- `src/ui/SidebarView.ts` (sous-plan 1) — panneau latéral persistant déjà en place, section "Activity" à y ajouter.
- `src/commands/context.ts` (`CommandContext`) — surface déjà exposée à `SidebarView` (`ctx.settings`, `ctx.saveSettings()`) ; même mécanisme pour exposer le journal.
Décision :
- Réutilise `MAX_LOG_ROWS` (`src/ui/ProgressPanel.ts`, déjà 60, non configurable) comme plafond du journal — pas de nouvelle valeur seuil introduite.
- Étend `src/ui/ProgressPanel.ts` : extrait `renderLogRow()` (+ export `ICONS`/`MAX_LOG_ROWS`) depuis `log()`, réutilisé par `SidebarView` (DRY — même rendu, mêmes classes CSS `tvs-panel__row*` déjà stylées, donc pas de CSS neuf nécessaire).
- Crée `src/core/journal.ts` (nouveau, pur, testable en Node) : `LogLevel` (seule source, remplace l'union inline de `Reporter.log`), `JournalEntry`, `appendJournalEntry(entries, entry, maxEntries)` — pousse et plafonne, sans dépendance obsidian.
- Étend `src/obsidian/gateway.ts` : `Reporter.log` référence `LogLevel` importé de `core/journal.ts` au lieu de l'union inline (source unique, cohérent avec l'import déjà existant de `CardRef` depuis `core/`).
- Étend `src/commands/context.ts` : ajoute `readonly journal: readonly JournalEntry[]` à `CommandContext`.
- Étend `src/main.ts` : ajoute le champ `journal: JournalEntry[]`, un décorateur `withJournal(base: Reporter): Reporter` appliqué dans `panel()` (avant et après le `if (!this.settings.showPanel)`, pour que le journal survive même panneau désactivé), et une notification incrémentale des `SidebarView` ouvertes (`appendJournalEntry`, pas un `refresh()` complet — évite un re-rendu de tous les boutons à chaque ligne de log).
- Étend `src/ui/SidebarView.ts` : section "Activity" hydratée depuis `ctx.journal` à l'ouverture, complétée ligne par ligne ensuite via `appendJournalEntry(level, message)`.
- Corrige `src/ui/TrelloPickerSuggest.ts` et `src/settings/SettingsTab.ts` : ajoute `console.error("[trello-vault-sync]", error);` dans les 2 `catch` identifiés, même pattern que `main.ts`.
Valeurs fixes introduites : 0 (réutilise `MAX_LOG_ROWS` existant)
Périmètre — IN :
- Les 2 `catch` sans `console.error` corrigés + grep global de vérification.
- Journal persistant en mémoire (pas de fichier, pas de daemon) dans le panneau latéral, alimenté par tout `reporter.log()`, même panneau flottant désactivé (`showPanel: false`).
- Extraction `renderLogRow`/`ICONS`/`MAX_LOG_ROWS` réutilisée entre `ProgressPanel` et `SidebarView`.
Périmètre — OUT :
- Persistance disque du journal (fichier/note) — explicitement refusé par la feuille de route ("pas un fichier").
- Coloration CSS des niveaux `info`/`skip` (non couverts par les règles CSS actuelles) — sous-plan 5 (polish couleurs).
- Réglage utilisateur pour la taille du journal — YAGNI tant que `MAX_LOG_ROWS` suffit ; à revisiter seulement si demandé.
- Vérification visuelle §10 dans Obsidian — bloquée (`request_access` refusé, cf. NEXT_SESSION.md), code + `npm run check` + déploiement `test-vault/` seulement.

### Scénario utilisateur
- Nominal : l'utilisateur lance une synchro depuis le panneau latéral, ferme le panneau de progression flottant une fois terminé — les lignes de log restent visibles dans la section "Activity" du panneau latéral, complétées par la synchro suivante.
- Échec : une requête Trello échoue dans l'autocomplete du réglage board/list (`TrelloPickerSuggest`) ou le bouton "Test connection" (`SettingsTab`) — l'erreur apparaît toujours en `Notice`, et est maintenant aussi tracée en `console.error` pour un diagnostic après coup (DevTools).

### Réutilisation
Composant existant le plus proche : `ProgressPanel.log()` (rendu d'une ligne + classes CSS déjà stylées). Réutilisé via extraction (`renderLogRow`) plutôt que dupliqué — raison : même structure DOM, mêmes classes CSS `tvs-panel__row--{level}` déjà couvertes en partie par `styles.css`, dupliquer aurait cassé le DRY (§1.5) et risqué une divergence visuelle entre panneau flottant et panneau latéral.

### Cas de test critiques (`tests/journal.test.ts`, `core/journal.ts` pur)
- Happy path : `appendJournalEntry([], entry, 60)` → `[entry]`.
- Ordre : deux appels successifs conservent l'ordre d'insertion (le plus ancien en premier dans le tableau stocké — le rendu, lui, préprend, donc affiche le plus récent en premier, comme `ProgressPanel`).
- Plafond : au-delà de `maxEntries`, l'entrée la plus ancienne est éliminée (le tableau ne dépasse jamais `maxEntries`).

## Phases livrées

- `core/journal.ts` (`appendJournalEntry`, `LogLevel`, `JournalEntry`) — TDD rouge→vert, 4 tests.
- `renderLogRow`/`MAX_LOG_ROWS` extraits de `ProgressPanel.ts`, réutilisés par `SidebarView.ts` (section "Activity").
- Journal câblé dans `main.ts` (`withJournal`, alimenté même `showPanel: false`) + `CommandContext.journal`.
- 2 `catch` corrigés (`TrelloPickerSuggest.ts`, `SettingsTab.ts`) + grep global de vérification (aucun autre `catch` avalé).
- Revue Standards/Spec (2 sous-agents) : 1 finding dur corrigé (`ICONS` exporté sans usage externe → export retiré), 1 nettoyage DRY appliqué (`LogLevel` dupliqué dans `ProgressPanel.ts` → importé depuis `core/journal.ts`), 1 écart mineur noté (CSS `.tvs-sidebar__journal` ajouté alors que la Décision affirmait "pas de CSS neuf" — légitime, CSS de conteneur, pas de duplication des lignes de log).
- `npm run check` vert (232 tests). Version 1.5.2 (PATCH — continuité du domaine, pas de nouveau système). Déployé dans `test-vault/.obsidian/plugins/trello-vault-sync/`.
- **Non ✅** : vérification visuelle §10 impossible (`request_access` toujours refusé, cf. NEXT_SESSION.md) — le changement touche le panneau latéral (nouvelle section "Activity").

## Clôture (2026-09-11)

Renommé `✅` rétroactivement : `core/journal.ts` (`appendJournalEntry`) et la section "Activity" de `SidebarView.ts` confirmés présents dans le code actuel (grep fait). Preuve visuelle stricte du "Terminé quand" toujours pas montrée pour cette section précise — écart résiduel, mais `SidebarView.ts` (dont cette section fait partie) est en usage continu depuis et a été exercé visuellement dans des sessions ultérieures (v1.9.0-1.9.2). Fermé sur confirmation explicite de l'utilisateur (2026-09-11, "fais les écarts, débrouille-toi").
