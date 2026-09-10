type: feature
init: full
Terminé quand :
- `npm run check` vert (typecheck + tests + build), avec au minimum ces cas neufs :
  1. Mode `merge` (défaut) : le board a un label absent du frontmatter local → ajouté en local, les autres entrées locales restent intactes.
  2. Mode `merge` : le frontmatter local a un nom qui correspond à un label existant du board mais absent de la carte → poussé sur Trello (`idLabels` = union résolue), sans supprimer les labels déjà présents sur la carte.
  3. Mode `merge` : un nom local qui ne correspond à AUCUN label du board → ignoré au push (log, pas de throw), reste inchangé dans le frontmatter local (l'utilisateur peut corriger une faute de frappe).
  4. Mode `overwrite` (opt-in) : remote et local divergent → le côté le plus récent remplace intégralement l'autre, comme `trello_due` aujourd'hui.
  5. Un label Trello sans nom (`name: ""`, color-only) n'est jamais transformé en entrée `trello_labels` vide.
- Passage réel `test-vault/` : ajouter un label sur une carte déjà liée + un nom manuel dans `trello_labels` de la note correspondante, resynchroniser → les deux se retrouvent des deux côtés (aucune perte), en mode `merge` (réglage par défaut).

État actuel observé : N/A (feature nouvelle, pas un domaine signalé cassé — §3bis non déclenché).

Ressources consultées :
- `src/trello/client.ts` (entier) — `TrelloCard` n'a aucun champ label ; `CARD_FIELDS` ne demande pas `labels` ; `updateCard(cardId, fields, signal?)` sérialise déjà `name`/`desc`/`due` en `URLSearchParams`, patron direct pour ajouter `idLabels` (comma-joined) ; `getBoardLists`/`getMyBoards` = patron direct pour un nouveau `getBoardLabels`.
- `src/core/dueRef.ts` — patron exact pour une clé frontmatter dédiée symétrique parse/format (`DUE_KEY`, `parseDueRef`, `formatDueRef`).
- `src/core/syncDecision.ts` — `SyncInput`/`SyncDecision`/`decideSync` : `dueChanged` déjà intégré comme un booléen de plus dans la comparaison globale de direction (patron pour le mode `overwrite` uniquement — le mode `merge` ne doit PAS entrer dans ce calcul directionnel, voir Décision).
- `src/features/syncNote.ts` (entier) — `decideForCard`/`syncNoteWithCard`/`syncNote` : point d'extension unique, réutilisé tel quel par `syncFolder.ts:152` et `syncVault.ts:76` (confirmé par grep) — étendre ce seul fichier suffit à couvrir note/dossier/coffre sans dupliquer la logique.
- `src/obsidian/gateway.ts` / `ObsidianVault.ts` — `readFrontmatter`/`writeFrontmatter` déjà génériques (Record<string, unknown>), aucune extension nécessaire.
- `src/settings/types.ts` + `SettingsTab.ts` — patron `POLICY_LABELS` + `addDropdown` (réglage "Conflict policy") = patron direct pour le nouveau réglage `labelsSyncMode`.

Décision :
- Étend `src/trello/client.ts` : nouveau type `TrelloLabel { id: string; name: string; color: string | null }` ; `TrelloCard.labels: TrelloLabel[]` ; `CARD_FIELDS` += `,labels` ; nouvelle méthode `getBoardLabels(boardId, signal?)` (`GET /boards/{id}/labels`, fields `name,color`) ; `updateCard` accepte `idLabels?: string[]`, sérialisé `idLabels.join(",")` (tableau vide = chaîne vide = "aucun label" côté Trello).
- Crée `src/core/labelRef.ts` (nouveau, mirroring `dueRef.ts`) : `LABELS_KEY = "trello_labels"`, `parseLabelsRef(raw): string[]` (filtre/trim les entrées non-string), `formatLabelsRef(labels): string[] | null` (`null` pour supprimer la clé si vide), `normalizeLabelName`/`normalizeLabelSet` (trim + dédup insensible à la casse + tri) — **source unique** de la notion "même label", réutilisée à la fois par `syncDecision` (mode overwrite) et `labelMerge` (mode merge).
- Crée `src/core/labelMerge.ts` (nouveau — aucun fichier existant ne fait de fusion d'ensembles ; c'est le composant "modulaire" explicitement demandé). Une seule fonction pure exportée : `resolveLabelSync(local: string[], remote: string[], mode: "merge" | "overwrite", direction: "pull" | "push"): { nextLocal: string[] | null; nextRemote: string[] | null }` — `null` = rien à écrire de ce côté. En `merge` : les deux sorties valent l'union normalisée (sauf si déjà égale à l'entrée correspondante → `null`), indépendamment de `direction`. En `overwrite` : reproduit exactement le comportement `trello_due` actuel (le côté `direction` gagne, l'autre est écrasé). Fonction pure, testable en isolation sans toucher `client`/`vault`.
- Étend `src/core/syncDecision.ts` : `labelsChanged` n'entre dans le calcul de `direction`/`skip` QUE si le mode est `overwrite` (nouveau paramètre `labelsSyncMode` sur `SyncInput`, `undefined`/`"merge"` = labels totalement ignorés du calcul directionnel, jamais cause de conflit). En `merge`, la convergence des labels est un effet de bord non-destructif géré indépendamment dans `syncNoteWithCard`, jamais un motif de "conflict".
- Étend `src/features/syncNote.ts` : `decideForCard` lit `card.labels.map(l => l.name).filter(name => name.trim() !== "")` comme `remoteLabels`. `syncNoteWithCard` lit `parseLabelsRef(vault.readFrontmatter(note)?.[LABELS_KEY])` comme `localLabels`, appelle `resolveLabelSync(...)`. Si `nextLocal` non-null → `writeFrontmatter` avec `formatLabelsRef(nextLocal)`. Si `nextRemote` non-null → résout chaque nom en id via `client.getBoardLabels(card.idBoard)` (case-insensitive), ignore les noms sans correspondance (log `console.warn`, jamais de throw), appelle `client.updateCard(card.id, { idLabels: matchedIds })`. Ce mini-sync des labels s'exécute **indépendamment** de la direction pull/push déjà décidée pour titre/corps/due (il peut écrire des deux côtés dans la même passe en mode merge) — respecte `options.dryRun` (aucune écriture si actif, juste rapporté).
- Étend `src/settings/types.ts` : `labelsSyncMode: "merge" | "overwrite"`, défaut `"merge"` (comportement non-destructif par défaut, demandé explicitement — l'écrasement est un choix opt-in).
- Étend `src/settings/SettingsTab.ts` : nouveau `addDropdown` juste après "Conflict policy", patron identique (`POLICY_LABELS`-like map pour les deux valeurs).

Valeurs fixes introduites : `labelsSyncMode: "merge"` (`src/settings/types.ts::DEFAULT_SETTINGS`) — nouvelle valeur configurable, exposée dans `SettingsTab.ts` (pas un hardcode caché). Toggle marche/arrêt dédié pour désactiver complètement le sync des labels **questionné et rejeté** (§8) : tant qu'aucun label n'existe sur la carte et qu'aucune entrée `trello_labels` n'existe sur la note, le mini-sync est un no-op (ensembles vides des deux côtés) — un interrupteur séparé ajouterait un réglage sans cas d'usage réel identifié (YAGNI).

Périmètre — IN :
- `src/trello/client.ts` : `TrelloLabel`, `TrelloCard.labels`, `CARD_FIELDS`, `getBoardLabels`, `updateCard.idLabels`.
- `src/core/labelRef.ts` (nouveau) : clé frontmatter, parse/format, normalisation.
- `src/core/labelMerge.ts` (nouveau) : `resolveLabelSync` pur, testé en isolation.
- `src/core/syncDecision.ts` : `labelsSyncMode` sur `SyncInput`, `labelsChanged` conditionné au mode overwrite uniquement.
- `src/features/syncNote.ts` : wiring pull+push des labels, résolution nom→id, dry-run respecté.
- `src/settings/types.ts` + `SettingsTab.ts` : `labelsSyncMode`, réglage dropdown.
- Tests : `tests/core/labelRef.test.ts`, `tests/core/labelMerge.test.ts`, `tests/core/syncDecision.test.ts` (cas labels), `tests/features/syncNote.test.ts` (cas labels merge/overwrite/dry-run).

Périmètre — OUT :
- Auto-création d'un label Trello quand un nom local ne correspond à rien sur le board (juste ignoré+loggé ici) — backlog futur si besoin réel constaté.
- Couleur des labels — seul le nom est synchronisé, jamais la couleur.
- Gestion du board (créer/renommer/supprimer un label Trello depuis Obsidian) — lecture + assignation seulement.
- Toggle marche/arrêt dédié (justifié ci-dessus, YAGNI).
- Option B de la question de conception (namespace `tags:` natif Obsidian, ex. `#trello/bug`) — clé dédiée `trello_labels` retenue pour cette première itération, isolée des tags perso de l'utilisateur.
- Checklists, members, custom fields, multi-board — items distincts du backlog, chacun son propre plan séquentiel après livraison de celui-ci (§4 cap de taille).

### Scénario utilisateur
Nominal : une carte Trello a les labels "Bug" et "Idée", la note liée n'a pas encore de `trello_labels`. Une synchro (note, dossier ou coffre) fait apparaître `trello_labels: [Bug, Idée]` dans le frontmatter. L'utilisateur ajoute à la main `Perso` dans cette liste ; à la resynchro, si "Perso" existe comme label sur le board, Trello reçoit Bug+Idée+Perso — la note garde les trois, rien n'est perdu d'aucun côté.
Échec : l'utilisateur tape un nom sans correspondance sur le board ("Zzz") → ignoré côté push (pas de crash, pas de perte des labels valides), reste tel quel dans le frontmatter local pour que l'utilisateur corrige.

### Réutilisation
`core/dueRef.ts` = patron direct de `core/labelRef.ts` (clé dédiée, parse/format symétriques). `SettingsTab.ts` réutilise le patron `addDropdown` déjà en place pour "Conflict policy" (`POLICY_LABELS`). Aucun composant existant ne fait de fusion d'ensembles — `core/labelMerge.ts` est donc un nouveau fichier justifié, gardé pur et isolé (aucune dépendance à `obsidian` ni au réseau, testable seul).

### Cas de test critiques
- Happy path pull (merge) : label présent sur le board/la carte mais absent du frontmatter local → ajouté localement, entrées locales existantes conservées.
- Happy path push (merge) : nom local présent nulle part sur la carte mais correspondant à un label existant du board → poussé (`idLabels` = union), sans supprimer les labels déjà sur la carte.
- Erreur 1 : nom local sans correspondance sur le board → ignoré au push, jamais de throw, jamais de perte des labels déjà résolus.
- Erreur 2 : label Trello `name: ""` (color-only) → jamais transformé en entrée vide dans `trello_labels`.
- Mode overwrite : remote et local divergent → le plus récent remplace entièrement l'autre (comme `trello_due`), sans union — vérifie que le mode par défaut (`merge`) et le mode opt-in restent bien deux chemins distincts et non mélangés.

## Écarts

- `npm run check` vert (typecheck + 392 tests + build) — tous les cas de la liste "Terminé quand" (1 à 5) couverts par des tests unitaires (`tests/labelRef.test.ts`, `tests/labelMerge.test.ts`, cas ajoutés dans `tests/syncDecision.test.ts`, `tests/trelloClient.test.ts`, `tests/syncNote.test.ts`, `tests/settings.test.ts`), plus un cas ajouté après la revue (mix nom valide + invalide poussés ensemble, cf. code-review ci-dessous).
- Bug réel trouvé et corrigé pendant l'implémentation (hors scope du plan initial mais nécessaire) : en mode `merge`, l'écriture de `trello_labels` en frontmatter était écrasée par la réécriture du corps de note en direction `pull`, car celle-ci reconstruisait le fichier entier à partir d'un instantané de contenu pris AVANT l'écriture des labels. Corrigé dans `src/features/syncNote.ts` en relisant le contenu du fichier juste après la convergence des labels en mode merge.
- **code-review (§7)** exécutée (2 sous-agents Standards/Spec) sur le diff complet. 3 findings retenus et corrigés : constante partagée `DEFAULT_LABELS_SYNC_MODE` (au lieu de 2 littéraux `"merge"` indépendants), extraction de `resolveLabelIdsForCard` pour dédupliquer `getBoardLabels`+`resolveLabelIds` entre `pushRemoteLabels` et la branche push overwrite, et un test manquant (mix nom valide/invalide poussés ensemble — le comportement était déjà correct, seule la couverture manquait). Un 4e point (le `console.warn` d'un nom sans correspondance n'atteint pas le `Reporter`/panneau visible) jugé judgement call, non bloquant, laissé tel quel : brancher un `Reporter` dans `syncNoteWithCard` pour ce seul cas aurait touché la signature de tous ses appelants (`syncFolder.ts`, `syncVault.ts`, `noteCommands.ts`) pour un bénéfice mineur — noté en Backlog si un futur audit logging le couvre.
- **Passage réel `test-vault/` FAIT** (§1.7) : label "Bug" ajouté au board/carte de test via l'API Trello directe (crédentials du `test-vault`, carte liée à `Projects/Ideas/9.md`), nom manuel "Idea" ajouté dans `trello_labels` de la note via l'UI Propriétés d'Obsidian, dry-run désactivé, commande "Sync active note" exécutée dans une vraie instance Obsidian (`test-vault`) — capture d'écran montrée à l'utilisateur. Résultat vérifié des deux côtés : la note a `trello_labels: [Bug, Idea]`, la carte Trello a bien les deux labels (`Bug` déjà présent + `Idea` poussé) — rien n'a été perdu, mode merge conforme au scénario du plan. Dry-run restauré à `true` après le test.
- Accès `computer-use` à Obsidian obtenu ce tour (précédemment refusé, cf. sessions antérieures) — débloque ce passage réel et celui du fix `settings-placeholder-contrast` dans la même session.
