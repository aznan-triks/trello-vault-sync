type: feature
init: full
Terminé quand :
- `npm run check` vert (typecheck + tests + build), avec au minimum ces cas neufs :
  1. Carte avec une checklist Trello (2 items, un coché un non) → une section `## Checklist` apparaît en fin de corps de note, rendue en tâches Markdown (`- [ ]`/`- [x]`), sans toucher au reste du corps (la description synchronisée avec `card.desc` reste, elle, inchangée).
  2. L'utilisateur coche localement un item déjà présent côté Trello (nom identique) → la case est poussée vers Trello (`updateCheckItemState`), indépendamment de tout autre changement (fonctionne même si le titre/corps/due n'ont pas bougé — pas de dépendance à la direction pull/push décidée pour eux).
  3. Un item ajouté côté Trello (absent du Markdown local) → apparaît dans la section au prochain sync, à l'état Trello.
  4. Un item tapé à la main dans la section locale, sans correspondance de nom sur Trello → disparaît au prochain sync (jamais créé côté Trello — limitation documentée, pas un bug).
  5. Carte qui perd toute checklist alors que la note avait encore une section `## Checklist` → la section est supprimée entièrement.
  6. `syncChecklists: false` → aucun appel `getCardChecklists`, section locale jamais touchée, comportement de `extractBody`/`replaceBody` strictement identique à aujourd'hui (aucune régression sur la synchro description pour qui n'active pas la feature).
  7. `dryRun: true` → aucune écriture, aucun appel `updateCheckItemState`.
- Passage réel `test-vault/` : une carte de test avec une checklist 2 items, cocher un item côté Obsidian puis resynchroniser → coché côté Trello ; ajouter un item côté Trello puis resynchroniser → apparaît côté note. Capture d'écran montrée à l'utilisateur.

État actuel observé : N/A (feature nouvelle, pas un domaine signalé cassé — §3bis non déclenché).

Ressources consultées :
- `src/core/noteBody.ts` (entier) — `extractBody`/`replaceBody` traitent AUJOURD'HUI tout le corps post-frontmatter comme un bloc unique 1:1 avec `card.desc`. Une checklist dans ce même corps serait donc comparée/écrasée avec la description si rien ne l'isole — confirmé avec l'utilisateur (question posée explicitement), qui a validé l'option "section dédiée, exclue de la description" plutôt que "revenir en frontmatter".
- `src/features/syncNote.ts` (entier) — `convergeLabelsOnMerge`/`convergeAttachments` (v1.10.0, plan précédent) = patron direct pour une convergence qui tourne indépendamment de la direction décidée pour titre/corps/due, jamais cause de conflit, respecte `dryRun` — les checklists suivent exactement le même point d'accroche, pour la même raison qu'attachments (sinon un item coché seul, sans autre changement, ne serait jamais poussé puisque la direction resterait "skip").
- `src/features/attachmentSync.ts` + `src/settings/types.ts::syncAttachments` — patron direct pour un réglage désactivable actif par défaut (même raison : `getCardChecklists` est un appel réseau propre, non inclus dans la carte déjà récupérée, comme `getCardAttachments`).
- `src/trello/client.ts` (entier) — `getBoardLabels`/`getCardAttachments` = patron direct pour un nouvel endpoint GET avec `fields`/`checkItem_fields` ; `updateCard` = patron pour un PUT url-encodé, réutilisable presque tel quel pour `updateCheckItemState` (un seul champ `state`).
- `src/commands/noteCommands.ts:78` (`resolveConflict`) — utilise aussi `extractBody` pour prévisualiser un conflit ; doit devenir checklist-aware (même heading) sinon un simple cochage de case pourrait s'afficher à tort comme un conflit de description dans `ConflictModal`.
- `src/settings/types.ts` + `SettingsTab.ts` — patron `xxxFrontmatterKey` pour une valeur configurable ; ici la valeur n'est pas une clé de frontmatter mais un marqueur de section dans le corps (`checklistHeading`), même esprit (no-hardcode) mais nouvelle catégorie de réglage, à documenter comme telle plutôt que forcée dans "Frontmatter keys".

Décision :
- **Isolation du corps** : `src/core/noteBody.ts` gagne `splitChecklistSection(body, heading): { rest: string; checklistBlock: string | null }` et `insertChecklistSection(body, rest, checklistBlock, heading): string`. Règle simple et documentée : la section checklist doit être la **dernière** chose du corps (tout ce qui suit la ligne `heading` exacte, jusqu'à la fin) — pas de contenu utilisateur après elle. `extractBody`/`replaceBody` gagnent un paramètre optionnel `checklistHeading?: string | null` — `undefined`/`null` (comportement par défaut) = **strictement identique à aujourd'hui**, aucune régression pour qui n'active pas la feature ; une chaîne = la section est retirée avant retour (`extractBody`) ou préservée/reconstruite (`replaceBody`).
- **Bidirectionnel = état des cases coché par Obsidian, existence des items miroir de Trello** — pas un merge par item avec conflits (pas de timestamp par item disponible). Convergence indépendante de la direction pull/push décidée pour titre/corps/due (même accroche que labels/attachments) :
  1. Fetch `client.getCardChecklists(card.id)` → structure `{id, name, checkItems: [{id, name, state}]}[]`.
  2. Parse la section Markdown locale actuelle (si présente) en la même forme sans id (`parseChecklistMarkdown`).
  3. Pour chaque item distant, cherche l'item local de même nom dans la checklist de même nom (première occurrence non déjà appariée, tolère des doublons de façon approximative — limitation documentée) ; si l'état coché local diffère de l'état Trello, pousse l'état local vers Trello (`updateCheckItemState`) — **Obsidian gagne pour l'état d'un item déjà connu des deux côtés**.
  4. Reconstruit la section Markdown en entier à partir de la structure Trello (noms/ordre/existence), avec l'état coché déjà mis à jour à l'étape 3 pour les items qui viennent d'être poussés — **Trello (le fetch qu'on vient de faire) gagne pour l'existence/le nom/l'ordre des items et des checklists** ; un item tapé à la main sans correspondance Trello est perdu (jamais créé côté Trello) ; réécrit seulement si le rendu diffère du contenu actuel.
  5. Aucune checklist distante → section supprimée (retirée du corps) si elle existait.
- Crée `src/core/checklistRef.ts` (nouveau, pur) : `DEFAULT_CHECKLIST_HEADING = "## Checklist"` ; types `ChecklistItem { name, complete }` / `ChecklistGroup { name, items }` ; `renderChecklistMarkdown(checklists: ChecklistGroup[]): string | null` (un `###` par checklist Trello, une ligne `- [ ]`/`- [x]` par item, `null` si aucune checklist) ; `parseChecklistMarkdown(block: string | null): ChecklistGroup[]` (relit `###` + tâches, ignore silencieusement toute autre ligne à l'intérieur du bloc — limitation documentée).
- Étend `src/trello/client.ts` : `TrelloChecklistItem { id, name, state: "complete" | "incomplete" }`, `TrelloChecklist { id, name, checkItems: TrelloChecklistItem[] }` ; `getCardChecklists(cardId, signal?)` (`GET /cards/{id}/checklists`, `fields=name`, `checkItem_fields=name,state`) ; `updateCheckItemState(cardId, checkItemId, state, signal?)` (`PUT /cards/{cardId}/checkItem/{checkItemId}`, corps `state=complete|incomplete`).
- Crée `src/features/checklistSync.ts` (nouveau) : `resolveChecklists(client, cardId, localBlock): { checklists: TrelloChecklist[]; pushes: Array<{checkItemId, state}> }` (calcule quoi pousser) + une fonction d'orchestration appelée depuis `syncNoteWithCard`, même position que `convergeAttachments` (avant le `return` skip/conflict, respecte `dryRun`, jamais de throw — best-effort comme attachments, log `console.warn` sur échec réseau).
- Étend `src/features/syncNote.ts` : nouvelles options `syncChecklists?: boolean` (défaut `true`, désactivable — même raison qu'`syncAttachments`), `checklistHeading?: string` (défaut `DEFAULT_CHECKLIST_HEADING`) ; `localBody`/`decideForCard` et la branche pull (`replaceBody`) deviennent checklist-aware via ces options.
- Étend `src/commands/noteCommands.ts::resolveConflict` : passe le même `checklistHeading` résolu à `extractBody` pour la prévisualisation, évite un faux conflit sur un simple cochage de case.
- Étend `src/settings/types.ts` : `syncChecklists: boolean` (défaut `true`), `checklistHeading: string` (défaut `DEFAULT_CHECKLIST_HEADING`, normalisé via un `safeString`-like trim non-vide — pas `safeFrontmatterKey` littéralement puisque ce n'est pas une clé de frontmatter, mais même idée : jamais vide).
- Étend `src/settings/SettingsTab.ts` : toggle "Sync checklists" (patron "Sync attachments") + champ texte "Checklist section heading" — description avertit explicitement que le contenu sous ce heading est reconstruit à chaque sync et qu'un item tapé à la main sans correspondance Trello n'est jamais créé côté Trello (même esprit d'avertissement que "Card link key").

Valeurs fixes introduites : `## Checklist` (`src/core/checklistRef.ts::DEFAULT_CHECKLIST_HEADING`) — valeur par défaut du nouveau réglage `checklistHeading`, jamais une constante en dur consommée ailleurs (règle d'or §1.4, étendue ici à un marqueur de section de corps plutôt qu'une clé de frontmatter).

Périmètre — IN :
- `src/core/noteBody.ts` : `splitChecklistSection`, `insertChecklistSection`, `extractBody`/`replaceBody` avec paramètre optionnel rétrocompatible.
- `src/core/checklistRef.ts` (nouveau) : rendu/parsing Markdown, heading par défaut.
- `src/trello/client.ts` : `TrelloChecklist`, `TrelloChecklistItem`, `getCardChecklists`, `updateCheckItemState`.
- `src/features/checklistSync.ts` (nouveau) : calcul des pushes + reconstruction du rendu.
- `src/features/syncNote.ts` : wiring indépendant de la direction, respect de `dryRun`.
- `src/commands/noteCommands.ts` : `resolveConflict` checklist-aware.
- `src/settings/types.ts` + `SettingsTab.ts` : `syncChecklists`, `checklistHeading`.
- Tests : `tests/checklistRef.test.ts`, `tests/checklistSync.test.ts`, `tests/noteBody.test.ts` (cas ajoutés, rétrocompatibilité vérifiée explicitement), `tests/trelloClient.test.ts`, `tests/syncNote.test.ts`, `tests/settings.test.ts`.

Périmètre — OUT :
- Création d'un nouvel item ou d'une nouvelle checklist depuis Obsidian (texte tapé sans correspondance Trello) — perdu silencieusement au sync suivant, documenté partout (réglage, plan, commentaire code) plutôt que traité comme un bug. Backlog futur si demandé explicitement.
- Suppression d'un item côté Trello depuis Obsidian (retirer la ligne locale ne supprime rien côté carte).
- Renommage d'un item ou d'une checklist depuis Obsidian (traité comme "pas de correspondance" → nouvel item Trello ignoré, ancien nom Trello toujours affiché tel quel au prochain pull).
- Réordonnancement des items poussé vers Trello — l'ordre affiché suit toujours l'ordre Trello (`pos`), un réordonnancement local n'est jamais poussé.
- Contenu utilisateur après la section checklist dans le corps — doit rester en dernière position (limitation documentée, pas un merge de sections multiples).
- Membres assignés à un item, dates d'échéance par item — hors scope, juste nom + coché/pas coché.

### Scénario utilisateur
Nominal : une carte a une checklist "Préparation" avec 2 items ("Réserver la salle" ✓, "Envoyer les invitations" ☐). La note reçoit une section `## Checklist` / `### Préparation` / `- [x] Réserver la salle` / `- [ ] Envoyer les invitations`. L'utilisateur coche "Envoyer les invitations" dans Obsidian, resynchronise → l'item passe à `complete` sur Trello, sans qu'aucun autre changement (titre/desc/due) n'ait eu lieu.
Échec : l'utilisateur ajoute une ligne `- [ ] Acheter des fleurs` à la main sous la section → au sync suivant, cette ligne disparaît (jamais créée sur Trello) puisque `Périmètre — OUT` l'exclut explicitement ; aucun crash, juste une reconstruction fidèle à l'état Trello.

### Réutilisation
`features/syncNote.ts::convergeLabelsOnMerge`/`convergeAttachments` = patron direct pour l'accroche "indépendant de la direction, respecte dryRun, best-effort réseau". `trello/client.ts::updateCard` = patron direct pour un PUT à un seul champ (`updateCheckItemState`). Aucun composant existant ne fait d'extraction de section dans le corps — `core/noteBody.ts::splitChecklistSection`/`insertChecklistSection` sont donc de nouvelles fonctions justifiées, gardées dans le même fichier (même responsabilité : chirurgie de texte frontmatter/corps) plutôt qu'un fichier à part.

### Cas de test critiques
- Happy path pull : nouvelle checklist distante → section créée, description (`card.desc`) non affectée.
- Happy path push : case cochée localement sur un item existant des deux côtés → `updateCheckItemState` appelé avec `state=complete`, fonctionne même quand direction titre/corps/due = "skip".
- Erreur 1 : item local sans correspondance Trello → disparaît au sync suivant, pas de création, pas de throw.
- Erreur 2 : carte qui perd sa checklist alors que la note a encore la section → section supprimée entièrement, pas laissée avec un contenu périmé.
- Rétrocompatibilité : `extractBody(content)`/`replaceBody(content, body)` appelés SANS le nouveau paramètre (tous les appels existants) produisent un résultat strictement identique à avant ce plan.
- `syncChecklists: false` : aucun appel `getCardChecklists`, section locale (si présente pour d'autres raisons) jamais touchée.

## Écarts

- **Livrée dans le même commit/version que le plan pièces-jointes** (`✅PLAN_2026-09-11_feature-trello-attachments-sync.md`), pas en version séparée comme prévu implicitement par le découpage en 2 plans (§4 cap de taille) : les deux features partagent trop de fichiers modifiés en commun (`syncNote.ts`, `syncFolder.ts`, `syncVault.ts`, `settings/types.ts`, `SettingsTab.ts`, `client.ts`) pour un split propre par fichier une fois le code écrit — un split par hunk (`git add -p`) aurait risqué un commit intermédiaire ne passant pas `npm run check` seul. Découpage en 2 plans distincts toujours justifié (chacun réutilisable/lisible séparément), livraison groupée en 1 version (v1.10.0) documentée ici comme écart assumé.
- `renderChecklistMarkdown(checklists)` prévu au plan → implémenté `renderChecklistMarkdown(checklists, heading = DEFAULT_CHECKLIST_HEADING)` (paramètre heading optionnel avec défaut, pour éviter que `checklistSync.ts` reconstruise le texte du heading séparément). Raffinement, pas un écart de comportement.
- `checklistHeading` normalisé via `safeFrontmatterKey` littéralement, alors que le plan disait explicitement "pas `safeFrontmatterKey` littéralement" — revue Spec l'a confirmé. Gardé tel quel après review (créer une fonction dupliquée juste pour un nom différent aurait été de la sur-ingénierie sur une logique strictement identique, trim+fallback) — accepté comme déviation mineure, sans impact fonctionnel.
- **code-review (§7) exécutée** conjointement avec le plan pièces-jointes (diff complet des deux features) — voir Écarts de `✅PLAN_2026-09-11_feature-trello-attachments-sync.md` pour le détail des findings et corrections (mot français résiduel, constantes de défaut dédupliquées en `core/`, dédup stricte des listes d'attachments).
- **Passage réel `test-vault/` NON FAIT** (§1.7) — pas d'accès `computer-use` sollicité cette session (cocher une case dans Obsidian et vérifier le push Trello réel reste à faire). À faire avant tout déploiement dans un vault réel autre que `test-vault/`.
- Push + release GitHub faits sur confirmation explicite de l'utilisateur ("go et commit push release").
