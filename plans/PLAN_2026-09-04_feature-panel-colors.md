type: feature
init: full
Terminé quand : `npm run check` vert (typecheck + tests, dont `tests/countSeverity.test.ts` couvrant `countSeverity()`, + build) ; grep `tvs-panel__row--info\|tvs-panel__row--skip` dans `styles.css` montre une règle de couleur pour les deux ; grep `tvs-panel__count-value--` montre 3 règles (`ok`/`warn`/`error`) ; déploiement dans `test-vault/.obsidian/plugins/trello-vault-sync/` fait.
État actuel observé : N/A (pas de bug — dernier sous-plan de la feuille de route du 2026-09-04, polish final)
Ressources consultées :
- `styles.css` (relu intégralement) — sur les 10 niveaux de `LogLevel` (`core/journal.ts`), 8 ont déjà une règle de couleur d'icône (`pull`/`adopt`→accent, `push`/`create`→vert, `rename`/`warn`→orange, `error`/`delete`→rouge). Seuls **`info` et `skip`** n'en ont aucune — corrige l'estimation "5 niveaux" de `NEXT_SESSION.md` (écrite avant re-vérification ; celle-ci confirme 2, pas 5).
- `trello_location_audit.js` (panneau legacy, référencé par `NEXT_SESSION.md` — `[redacted]`, lu en référence seulement, jamais copié ni utilisé comme terrain de test) — patron de coloration confirmé : `LOG_COLORS` (`ok`→vert, `error`→rouge, `warn`→orange, `info`→texte normal, pas de couleur distinctive) pour les lignes de log, et `setVal(key, val, color)` pour les compteurs — `misplaced` coloré **dynamiquement** selon sa valeur (vert si 0, orange si > 0), pas par une règle CSS statique par clé.
- `src/ui/ProgressPanel.ts` (`ICONS`, `COUNT_LABELS`, `count()`) — tous les niveaux de log et toutes les clés de compteur réellement émises recensées : `reporter.count()` appelé avec `created/adopted/pulled/pushed/skipped/renamed/conflicts/phantoms/moved/deleted/duplicates/unlinked/errors` (`syncFolder.ts`/`syncVault.ts`, via `syncCommands.ts::reportStats`) et `orphanCards/unlinkedNotes/comparedNotes/misplaced/changes` (`auditCommands.ts`).
- `src/settings/SettingsTab.ts` (relu intégralement) — **déjà** organisé en sections visuelles groupées avec `.setHeading()` : "Trello connection" (credentials), "Scope", "Sync behaviour" (sync), "Trello list ↔ folder" (mappings), "Advanced" (avancé). Confirmé par `git log --follow` : structure en place depuis `v1.0.1`/`v1.2.1`/`v1.3.0`, avant même le début de la feuille de route du 2026-09-04. Rien à refaire ici — la demande de `NEXT_SESSION.md` est déjà satisfaite.
Décision :
- Étend `styles.css` : 2 règles de couleur d'icône manquantes (`info` → `--text-normal`, `skip` → `--text-faint`, patron directement inspiré de `LOG_COLORS.info` du legacy).
- Crée `src/core/countSeverity.ts` (nouveau, pur, testable) : classification des clés de compteur en "problème" (0 = vert rassurant, > 0 = orange/rouge) vs "neutre" (jamais coloré, garde `--text-accent` déjà en place) — logique équivalente au `setVal(key, val, color)` conditionnel du legacy, mais généralisée aux clés réellement utilisées par ce plugin (le legacy n'en avait que 2 : `notes`/`misplaced`).
- Étend `src/ui/ProgressPanel.ts::count()` : applique la classe de sévérité retournée par `countSeverity()` sur `.tvs-panel__count-value`.
- Étend `styles.css` : 3 règles `.tvs-panel__count-value--{ok,warn,error}` (vert/orange/rouge).
- **Ne touche pas** `src/settings/SettingsTab.ts` — déjà conforme, cf. Ressources consultées.
Valeurs fixes introduites : 0 (la classification des clés de compteur est un ensemble fini nommé dans le code, pas un seuil numérique — cohérent avec `COUNT_LABELS` déjà non-configurable dans `settings/types.ts`)
Périmètre — IN :
- Couleur d'icône `info`/`skip` dans le panneau de progression (et donc le journal du panneau latéral, qui réutilise `renderLogRow`/les mêmes classes CSS depuis le sous-plan 3).
- Coloration dynamique des compteurs du panneau de progression (vert/orange/rouge selon la clé et la valeur).
Périmètre — OUT :
- Réorganisation de `SettingsTab.ts` — déjà faite, aucun changement nécessaire (cf. Ressources consultées).
- Coloration des compteurs dans `SidebarView.ts` — n'affiche aucun compteur (seulement des boutons + le journal), rien à colorer.
- Vérification visuelle §10 dans Obsidian — bloquée (`request_access` refusé, cf. NEXT_SESSION.md), code + `npm run check` + déploiement `test-vault/` seulement.

### Scénario utilisateur
- Nominal : une synchro se termine avec 2 erreurs — le compteur "errors" apparaît en rouge au lieu de la couleur neutre actuelle, immédiatement visible sans lire le journal en détail ; une "Audit links" sans aucun orphelin affiche son compteur "orphan cards" en vert.
- Échec : N/A (changement purement visuel, aucun nouveau chemin d'erreur).

### Réutilisation
Composant existant le plus proche : `ProgressPanel.count()` (déjà l'unique point d'écriture des compteurs). Étendu sur place plutôt que dupliqué. `countSeverity()` nouveau car aucune fonction existante ne classe les clés de compteur par sévérité.

### Cas de test critiques (`tests/countSeverity.test.ts`, `core/countSeverity.ts` pur)
- `errors` : 0 → `"ok"`, > 0 → `"error"`.
- Une clé "problème" (`conflicts`, `phantoms`, `unlinked`, `duplicates`, `orphanCards`, `unlinkedNotes`, `misplaced`) : 0 → `"ok"`, > 0 → `"warn"`.
- Une clé neutre (`created`, `pushed`, `changes`, etc.) : toujours `"neutral"`, quelle que soit la valeur.
- Une clé inconnue (jamais émise par le code actuel) : `"neutral"` par défaut — ne jamais planter sur une clé imprévue.

## Phases livrées

- `core/countSeverity.ts` (`countSeverity`) — TDD rouge→vert, 19 tests (`test.each` sur les clés problème/neutres).
- `styles.css` : 2 règles de ligne (`info`/`skip`) + 3 règles de compteur (`--ok`/`--warn`/`--error`).
- `ui/ProgressPanel.ts::count()` applique la classe de sévérité.
- `SettingsTab.ts` confirmé déjà conforme — non touché (conforme au Périmètre OUT).
- Revue Standards/Spec (2 sous-agents) : aucun finding dur ; 1 point relevé (déploiement `test-vault/` périmé au moment de la revue) — corrigé avant clôture.
- `npm run check` vert (279 tests). Version 1.5.4 (PATCH — continuité, polish visuel). Déployé dans `test-vault/.obsidian/plugins/trello-vault-sync/`.
- **Non ✅** : vérification visuelle §10 impossible (`request_access` toujours refusé) — changement purement visuel (couleurs du panneau).

## Feuille de route 2026-09-04 — les 5 sous-plans sont clos

Sidebar (1.5.0) · blacklist dossier (1.5.1) · logging (1.5.2) · audit changes (1.5.3) · couleurs (1.5.4). Tous en `## Phases livrées`, aucun `✅` — bloqués sur la même preuve visuelle §10 (`request_access` refusé). Prochaine étape : push/tag/release groupé (1.4.6 → 1.5.4), en attente de confirmation utilisateur.
