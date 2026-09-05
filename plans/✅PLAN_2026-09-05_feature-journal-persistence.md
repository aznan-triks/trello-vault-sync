type: feature
init: full
Terminé quand : `npm run check` vert (typecheck + tests, dont un nouveau `tests/pluginData.test.ts` couvrant la migration legacy→nouveau format + build) ; un journal peuplé puis un redémarrage simulé (relecture de la donnée persistée) restitue les mêmes entrées ; un fichier `data.json` legacy (settings à plat, sans journal) continue de charger les réglages sans perte ni crash ; aucune régression sur les réglages existants (mappings/excludedFolders toujours normalisés) ; passage réel documenté dans `test-vault/` si l'accès écran redevient possible, sinon noté en Écarts (même blocage §10 que tous les sous-plans depuis le 2026-09-04).
État actuel observé : N/A — pas un bug, décision explicite de l'utilisateur (clarification 2026-09-05, feuille de route "changelog/locations/HTML") : le journal d'activité du panneau latéral vit uniquement en mémoire (`main.ts::journal`), perdu à chaque redémarrage d'Obsidian — `PLAN_2026-09-04_feature-logging.md` l'avait explicitement laissé ainsi ("pas un fichier"), décision maintenant réouverte et inversée par l'utilisateur.
Ressources consultées :
- `src/main.ts` (`onload`, `saveSettings`, `withJournal`, `journal: JournalEntry[]`) — seul endroit qui construit/mute le journal et appelle `loadData()`/`saveData()`.
- `src/settings/types.ts::normalizeSettings` — patron déjà en place pour tolérer un payload partiel/legacy sans jamais crasher (mappings/excludedFolders filtrés et défaultés plutôt que rejetés) ; même philosophie à réutiliser pour le journal plutôt que d'introduire un nouveau style de validation (Fail Fast §1.3 n'est pas appliqué à ce chargement précis dans le code existant — précédent déjà établi, pas une nouvelle exception).
- `src/core/journal.ts` (`LogLevel`, `JournalEntry`, `appendJournalEntry`) — types et plafond déjà en place, réutilisés tels quels.
- `src/obsidian/gateway.ts::Reporter` (`finish(outcome, summary): void`, synchrone) — la persistance doit rester fire-and-forget (`void this.persist()`) depuis `finish()`, même patron que d'autres callbacks non attendus ailleurs dans `main.ts` (ex. `addRibbonIcon` → `void this.activateSidebarView()`).
- Obsidian `Plugin.loadData()`/`saveData()` — écrit déjà `data.json` dans le dossier du plugin (fichier réel sur disque, exclu du dépôt et du déploiement, cf. CONTEXT.md §6) ; réutiliser ce mécanisme évite d'inventer un nouveau fichier ou une nouvelle note de coffre pour une information interne au plugin (le journal n'est pas un contenu que l'utilisateur édite ou consulte hors d'Obsidian, contrairement aux rapports d'audit qui vivent dans une note du coffre par choix explicite).
- Décision explicite : pas de nouveau réglage (toggle activer/désactiver la persistance) — l'utilisateur a demandé la persistance sans condition ; à revisiter seulement si une gêne réelle est signalée (même raisonnement que `MAX_LOG_ROWS`, cf. `audits/AUDIT_settings-ergonomics.md`).
Décision :
- Crée `src/core/pluginData.ts` (nouveau, pur, testable) : `normalizePersistedData(raw: unknown): { settingsRaw: unknown; journal: JournalEntry[] }` — détecte le nouveau format `{ settings, journal }` ; sinon traite `raw` entier comme les settings legacy (format actuel, à plat) avec un journal vide, sans jamais crasher. Filtre les entrées de journal malformées (message non-string, etc.) plutôt que de les rejeter en bloc.
- Étend `src/main.ts::onload()` : `const { settingsRaw, journal } = normalizePersistedData(await this.loadData())`, puis `this.settings = normalizeSettings(settingsRaw)`, `this.journal = journal`.
- Étend `src/main.ts` : nouvelle méthode privée `persist()` qui appelle `this.saveData({ settings: this.settings, journal: this.journal })` ; `saveSettings()` l'appelle à la place d'un `saveData(this.settings)` direct.
- Étend `src/main.ts::withJournal()` : le `finish` enveloppé appelle `base.finish(...)` puis `void this.persist()` — une écriture disque par commande terminée, pas une par ligne de log (évite une écriture à chaque `reporter.log()`, potentiellement des dizaines par synchro).
Valeurs fixes introduites : 0 — aucun nouveau seuil ; le plafond du journal reste `MAX_LOG_ROWS` (déjà justifié comme détail interne).
Périmètre — IN :
- Le journal (`main.ts::journal`) survit à un redémarrage d'Obsidian, persisté dans `data.json` du plugin aux côtés des réglages.
- Migration transparente d'un `data.json` existant (settings à plat, sans journal) — aucune perte de réglage.
Périmètre — OUT :
- Nouveau réglage pour activer/désactiver la persistance — YAGNI, voir Décision.
- Persistance dans une note du coffre (visible/éditable par l'utilisateur) — le journal reste un détail de fonctionnement interne, pas un livrable comme les rapports d'audit ; `data.json` du plugin suffit et évite de polluer le coffre.
- Changelog/comparatif d'emplacements — sous-plan 1/3 déjà livré (`✅PLAN_2026-09-05_feature-changelog-format.md`).
- Page HTML avec avatars — sous-plan 3/3, pas ce tour.

### Scénario utilisateur
- Nominal : l'utilisateur lance plusieurs synchros dans une session, ferme puis rouvre Obsidian — le panneau latéral affiche encore l'historique "Activity" de la session précédente au lieu de repartir vide.
- Échec : un `data.json` d'une version antérieure à ce sous-plan (settings à plat, pas de clé `journal`) — chargé sans erreur, réglages intacts, journal simplement vide (pas de perte, pas de crash).

### Réutilisation
Composant existant le plus proche : `normalizeSettings` (même philosophie de tolérance face à un payload partiel/legacy). Non étendu directement — `normalizeSettings` normalise la forme des réglages eux-mêmes, alors que `normalizePersistedData` doit d'abord décider QUELLE partie du payload brut sont les réglages (nouveau vs legacy) avant de la lui passer ; responsabilité différente, fonction séparée mais du même esprit.

### Cas de test critiques (`tests/pluginData.test.ts`, `core/pluginData.ts` pur)
1. Nouveau format `{ settings: {...}, journal: [{level:"info", message:"x"}] }` → `settingsRaw` et `journal` extraits tels quels (entrée valide conservée).
2. Format legacy à plat (`{ apiKey: "x", token: "y", ... }`, pas de clé `settings`) → `settingsRaw` = le payload entier, `journal` = `[]` — aucune perte de réglage.
3. Entrée de journal malformée (`message` absent ou non-string, `level` non-string) → filtrée, ne casse pas le reste du tableau.
4. `raw` = `undefined`/`null` (première installation) → `settingsRaw` défaultable par `normalizeSettings` en aval, `journal` = `[]`.

## Phases
1. TDD : `core/pluginData.ts::normalizePersistedData` (rouge → vert, `tests/pluginData.test.ts`).
2. Câblage `main.ts` : `onload()` (hydratation), `persist()`, `saveSettings()`, `withJournal()` (persistance sur `finish`).
3. `npm run check` + greps §8 + déploiement `test-vault/` + clôture (§5).

## Écarts

- **code-review (§7)** en 2 sous-agents parallèles. Spec : conforme, aucun écart (4 cas de test, câblage `main.ts`, une écriture par commande, aucun fichier hors périmètre, `saveSettings()` inchangé côté appelants). Standards : aucun finding bloquant ; 2 nitpicks — validation `level`/`message` en strings seulement (pas de vérification stricte des 10 valeurs `LogLevel`, mais cohérent avec le précédent déjà établi par `normalizeSettings`/`ConflictPolicy`, non corrigé) ; commentaire ajouté sur `void this.persist()` documentant le compromis (dernière écriture potentiellement perdue si le plugin est désactivé juste après un `finish()` — acceptable, journal best-effort).
- **Preuve visuelle (§10) toujours impossible** : `request_access` refusé, blocage transversal inchangé. Code + `npm run check` (290 tests) + déploiement `test-vault/` faits.
- Version bumpée en 1.5.7 (PATCH — continuité, pas de nouveau système visible). Le "Terminé quand" prévoyait explicitement ce blocage ("sinon noté en Écarts") — condition remplie, renommage `✅`. `push`/`commit`/`release` groupés en fin de feuille de route (1 sous-plan restant), pré-autorisés par l'utilisateur.
