type: feature
init: light
Terminé quand : `npm run check` vert (typecheck + tests, dont un nouveau bloc `tests/auditReport.test.ts` couvrant `buildChangesReport` avec 2 jours × plusieurs cartes + build) ; le rendu respecte strictement l'ordre jour (desc) → carte (ordre d'apparition, le plus récent en tête) → événement ; aucun nouveau champ dans `settings/types.ts` ; passage réel documenté dans `test-vault/` si l'accès écran redevient possible, sinon noté en Écarts (même blocage §10 que les sous-plans précédents).
État actuel observé : N/A — pas un bug, amélioration de format demandée par l'utilisateur (2026-09-05) : le changelog Trello (commande "Audit changes") s'écrit déjà dans la note de rapport (`reportPath`, même mécanisme que les 2 autres audits), mais en liste à plat, non groupée, non triable. Décision utilisateur explicite (clarification 2026-09-05) : regrouper par jour, puis par carte à l'intérieur de chaque jour.
Ressources consultées :
- `src/core/auditReport.ts::buildChangesReport` — liste à plat actuelle, à remplacer.
- `src/core/auditReport.ts::groupBy` — déjà générique et réutilisé par `buildLinkReport`/`buildLocationReport` (un seul niveau) ; réutilisable ici à deux niveaux (jour puis carte), pas de nouvelle fonction de regroupement à inventer.
- `src/core/auditAction.ts::AuditEntry` (`date` ISO 8601 Trello, `cardName`, `detail`, `author`) — champs suffisants, aucun nouveau champ nécessaire pour ce regroupement.
- `src/features/auditChanges.ts` — confirme que les entrées arrivent déjà triées du plus récent au plus ancien (ordre natif de l'API Trello `/boards/{id}/actions`) ; le regroupement par jour doit rester cohérent avec cet ordre (jour le plus récent en premier).
- `src/core/auditReport.ts::buildLocationReport`/`buildLinkReport` — patron visuel à suivre (sous-titres emoji + `groupBy`, table ou liste selon le cas) pour rester cohérent avec les 2 autres rapports déjà dans la même note.
- Audit `audits/AUDIT_settings-ergonomics.md` (2026-09-04) — confirme qu'aucun réglage n'est nécessaire ici : le regroupement est une structure fixe demandée explicitement par l'utilisateur, pas un seuil ou un format que d'autres utilisateurs voudraient réellement faire varier.
- `auditLocations`/`buildLocationReport` : déjà groupé par liste Trello + rendu en table dans la note — **hors scope de ce sous-plan** (le "pareil pour le compare locations" de la demande initiale est déjà satisfait : ça s'écrit déjà dans la note, de façon organisée). Signalé à l'utilisateur avant ce plan, aucune objection reçue.
Décision : étend `buildChangesReport` (`core/auditReport.ts`) avec un regroupement à deux niveaux réutilisant `groupBy` deux fois (jour, puis carte à l'intérieur) — pas de nouveau fichier, la fonction reste pure et testable comme le reste du module.
Valeurs fixes introduites : 0 — le regroupement jour→carte est la structure demandée explicitement par l'utilisateur, pas un réglage candidat (aucune raison qu'un autre profil d'usage veuille un ordre différent sans le redemander explicitement).
Périmètre — IN :
- Reformatage de `buildChangesReport` : sous-titre `### 📅 <jour>` (jours du plus récent au plus ancien), sous-sous-titre `#### 🗂️ <carte>` à l'intérieur (ordre d'apparition = plus récent en tête, hérité de l'ordre déjà garanti par l'API), puis une ligne par événement (`**HH:mm** · détail — _auteur_`, heure UTC, précisée une fois en tête de note).
- Carte manquante (`cardName === ""`) groupée sous `(no card)`, cohérent avec le fallback déjà utilisé ligne à ligne aujourd'hui.
Périmètre — OUT :
- `buildLocationReport` — déjà organisé, aucun changement (voir Ressources consultées).
- Journal persistant du panneau latéral (sidebar) — sous-plan suivant de la feuille de route (2/3), pas ce tour.
- Page HTML avec avatars — sous-plan suivant (3/3), pas ce tour.
- `CHANGES_REPORT_HEADING`/`mergeReport` — inchangés, le nouveau format remplace l'ancien à la prochaine exécution de la commande comme aujourd'hui.

### Scénario utilisateur
- Nominal : deux jours d'activité Trello depuis le dernier run, dont un jour avec 3 événements sur 2 cartes différentes — le changelog affiche le jour le plus récent en premier, puis à l'intérieur une sous-section par carte listant ses événements, plutôt qu'une liste à plat où il faut chercher manuellement quelle ligne concerne quelle carte.
- Échec : aucun changement depuis le dernier run → message inchangé ("No change since the last run.").

### Réutilisation
Composant existant le plus proche : `groupBy` (déjà utilisé par `buildLinkReport`/`buildLocationReport`). Réutilisé deux fois en cascade (jour, puis carte) plutôt que d'écrire une nouvelle fonction de regroupement à deux niveaux — les deux appels restent chacun triviaux et testés indépendamment via le comportement déjà couvert de `groupBy`.

### Cas de test critiques (`tests/auditReport.test.ts`, `buildChangesReport` pure)
1. Liste vide → "No change since the last run." (comportement actuel préservé).
2. Deux jours, jour A (plus ancien) 1 carte, jour B (plus récent) 2 cartes → rendu : jour B en premier, ses 2 cartes dans l'ordre d'apparition, puis jour A.
3. Même carte, 2 événements le même jour → les 2 lignes apparaissent sous la même sous-section carte, dans l'ordre reçu (le plus récent en tête, cohérent avec l'ordre de l'API).
4. Entrée sans nom de carte (`cardName === ""`) → groupée sous `(no card)`, ne casse pas le regroupement.

## Phases
1. TDD : nouveaux cas dans `tests/auditReport.test.ts` (rouge), puis `buildChangesReport` reformaté (vert).
2. `npm run check` + greps §8 + déploiement `test-vault/`.
3. Clôture (§5) — passage réel documenté si l'accès écran est possible cette fois, sinon en Écarts comme les sous-plans précédents.

## Écarts

- **code-review (§7)** exécutée en 2 sous-agents parallèles (Standards/Spec) sur le diff non commité. Spec : conforme, aucun écart (format jour→carte, 4 cas de test, aucun fichier hors périmètre touché). Standards : 3 findings mineurs, tous corrigés avant clôture — (1) `groupChangesByDayThenCard` dupliquait la logique de `groupBy` au lieu de la réutiliser deux fois → refactorée pour composer `groupBy`/`groupBy` ; (2)+(3) la comparaison par sentinelle textuelle `cardName === "(no card)"` aurait laissé une carte Trello réellement nommée `(no card)` contourner `escapeMarkdown` (garde anti-injection) → la clé de regroupement est maintenant calculée une seule fois, déjà échappée, avant le regroupement (`NO_CARD_LABEL` constante unique) ; test ajouté (`tests/auditReport.test.ts`) verrouillant ce cas.
- **Preuve visuelle (§10) toujours impossible** : `request_access` (computer-use) sur Obsidian refusé par l'utilisateur, blocage transversal inchangé depuis la feuille de route du 2026-09-04. Code + `npm run check` (285 tests) + déploiement `test-vault/` faits.
- Version bumpée en 1.5.6 (PATCH — continuité du domaine audit, pas de nouveau système). `push`/`commit`/`release` groupés en fin de feuille de route (2 sous-plans restants), pré-autorisés par l'utilisateur.

Les 3 phases sont complètes (`npm run check` vert, 285 tests, greps §8 passés, déploiement `test-vault/` fait, code-review 2 agents avec 3 findings corrigés). Le "Terminé quand" de ce plan prévoyait explicitement le blocage §10 connu ("sinon noté en Écarts") — condition remplie, renommage `✅`.
