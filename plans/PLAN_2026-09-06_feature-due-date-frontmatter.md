type: feature
init: full
Terminé quand : `npm run check` vert (typecheck strict + suite Vitest existante + nouveaux tests, build `main.js`) ET greps §8 passés (isolation des couches, pas de hardcode, pas de résidu français) ET passage réel documenté sur `test-vault/` (pull d'une carte avec/sans due date, édition manuelle du frontmatter puis push) — fichiers de test nouveaux/modifiés listés ci-dessous, pas de formulation vague type "les tests passent".
- Nouveau : `tests/dueRef.test.ts`
- Modifiés : `tests/trelloClient.test.ts`, `tests/syncDecision.test.ts`, `tests/syncNote.test.ts`, `tests/fakes.ts` (aide de test, pas une suite en soi)
État actuel observé : N/A — feature, pas un domaine signalé cassé (§3bis ne s'applique pas).
Ressources consultées :
- `src/trello/client.ts:85` (`CARD_FIELDS = "name,desc,url,dateLastActivity,idBoard,idList,closed"`) et `:32-41` (`TrelloCard`) : confirmé, ni l'un ni l'autre ne porte `due` aujourd'hui.
- `src/trello/client.ts:178-190` (`updateCard(cardId, fields: { name?, desc? })`) : construit un `URLSearchParams` en n'ajoutant que les champs `!== undefined` — patron direct à étendre pour `due`.
- `src/obsidian/gateway.ts:20-37` (`VaultGateway`) : confirmé, aucune méthode frontmatter générique — seulement `getCardRef`/`setCardRef` (lignes 26-28), spécifiques à `trello_board_card_id`.
- `src/obsidian/ObsidianVault.ts:38-48` : `getCardRef` lit `metadataCache.getFileCache(...).frontmatter`, `setCardRef` écrit via `app.fileManager.processFrontMatter` (round-trip YAML propre, pas de chirurgie de texte) — patron à reproduire pour le due date.
- `tests/fakes.ts:55-70` (`FakeVault`) : `getCardRef`/`setCardRef` en mémoire via `splitFrontmatter` + regex ligne dédiée — patron à reproduire côté double de test.
- `src/core/cardRef.ts` : `CARD_REF_KEY` (constante), `parseCardRef`/`formatCardRef` (fonctions pures testées isolément) — composant existant le plus proche pour une nouvelle clé frontmatter.
- `src/core/noteBody.ts` (`splitFrontmatter`) : traitement ligne par ligne obligatoire (§9) — jamais `indexOf("---")`, un `---` peut apparaître dans une valeur YAML ou après un BOM/CRLF.
- `src/core/syncDecision.ts:9-66` (`SyncInput`/`SyncDecision`/`decideSync`) : une seule direction (pull/push/skip/conflict) dérivée de `bodyChanged`/`titleChanged` combinés — pas de mécanisme par-champ séparé.
- `src/features/syncNote.ts:31-101` (`decideForCard`/`syncNoteWithCard`) : lit le body local, appelle `decideSync`, puis pull = écrit note + renomme optionnellement, push = `client.updateCard({ desc, name? })` — patron diff-et-pousse à étendre au lieu d'en inventer un nouveau.
- `plans/` (glob `PLAN_2026-09-06*`, `*vaultgateway*`) : aucun fichier trouvé au moment de la rédaction — le refacto `VaultGateway` (split des 3 responsabilités + primitive frontmatter générique) est en cours de rédaction en parallèle par un autre agent, pas encore livré.
- `src/settings/types.ts` : aucun réglage existant ne couvre le due date ; confirmé qu'ajouter un toggle serait une décision à part (traité ci-dessous, §8).

⚠️ **Dépendance d'ordonnancement (bloquante pour l'exécution, pas pour la rédaction)** : ce plan doit s'exécuter **après** `plans/PLAN_2026-09-06_refacto-vaultgateway-split.md` (ou son équivalent une fois nommé), pour que la lecture/écriture du frontmatter due date utilise la primitive générique que ce refacto doit produire. Si ce plan est exécuté **avant** ce refacto, il doit ajouter une méthode étroite `getDueDate`/`setDueDate` sur `VaultGateway`, au patron exact de `getCardRef`/`setCardRef` (ci-dessus) — avec un remaniement quasi certain à prévoir une fois la primitive générique disponible, à consigner dans `NEXT_SESSION.md` comme dette connue.

Décision :
- Crée nouveau `src/core/dueRef.ts` : `DUE_KEY = "trello_due"`, `parseDueRef(raw: unknown): string | null`, `formatDueRef(due: string | null): string | null` — mêmes fonctions pures et même forme que `cardRef.ts`, testées isolément (`tests/dueRef.test.ts`). Raison de ne pas étendre `cardRef.ts` directement : clé et sémantique distinctes (référence de carte vs date), un fichier séparé garde chaque module à une responsabilité (§1.2).
- Étend `src/trello/client.ts` : `TrelloCard.due: string | null` ; `CARD_FIELDS` gagne `,due` ; `updateCard(cardId, fields: { name?, desc?, due?: string | null })` — `due` suit le patron `!== undefined` déjà en place (`undefined` = champ non touché, `null` = effacer, chaîne = fixer), symétrique à la lecture/écriture du côté note.
- Étend `VaultGateway` (`src/obsidian/gateway.ts`) : `getDueDate(note): string | null`, `setDueDate(note, due: string | null): Promise<void>` — cf. dépendance d'ordonnancement ci-dessus pour le statut définitif de cette méthode (narrow vs primitive générique).
- Étend `ObsidianVault.ts` : `getDueDate` via `metadataCache.getFileCache(...).frontmatter?.[DUE_KEY]` + `parseDueRef` ; `setDueDate` via `processFrontMatter` (supprime la clé si `due` est `null`, l'écrit sinon) — même patron que `getCardRef`/`setCardRef`.
- Étend `tests/fakes.ts` (`FakeVault`) : mêmes deux méthodes via `splitFrontmatter` + regex dédiée, au patron de `getCardRef`/`setCardRef` existants.
- Étend `src/core/syncDecision.ts` : `SyncInput` gagne `localDue: string | null`, `remoteDue: string | null` ; `SyncDecision` gagne `dueChanged: boolean` (`localDue !== remoteDue`, normalisé : chaîne vide/absente ≡ `null`) ; `dueChanged` entre dans le test `!bodyChanged && !titleChanged && !dueChanged` qui décide `skip` — aucune nouvelle direction, le due date suit exactement le même arbitrage pull/push/conflict que aujourd'hui.
- Étend `src/features/syncNote.ts` : `decideForCard` reçoit `localDue` (lu via `vault.getDueDate(note)` avant l'appel, dans `syncNoteWithCard`) ; pull écrit `vault.setDueDate(note, card.due)` ; push ajoute `due: localDue` à l'objet `fields` passé à `client.updateCard` quand `decision.dueChanged`.
- Pas de nouveau réglage togglable (type `syncDueDate: boolean`) dans `src/settings/types.ts` — questionné explicitement (§8) : le due date suit le régime de `desc` (toujours synchronisé dès qu'une note est liée), pas celui de `syncTitle` (qui a un toggle parce qu'un renommage de fichier a un effet de bord sur le système de fichiers ; une valeur de frontmatter n'en a pas). `Valeurs fixes introduites : 0`.
- Nom de clé frontmatter : `trello_due` (pas `due` seul) — un `due:` frontmatter nu est une convention déjà répandue dans l'écosystème Obsidian (plugins de gestion de tâches/projets type Tasks, Dataview-driven kanban, periodic notes) ; `trello_due` évite toute collision silencieuse avec un autre plugin de l'utilisateur et reste cohérent avec le préfixe déjà utilisé par `trello_board_card_id`.
- Stockage tel quel (pas de reformatage) : la chaîne ISO 8601 renvoyée par Trello est écrite et relue sans transformation — comparaison par égalité de chaîne dans `dueChanged`, cohérent avec KISS et avec le fait que Trello fait déjà foi sur le format.
Valeurs fixes introduites : 0.
Périmètre — IN :
- Pull : `card.due` (présent ou `null`) synchronisé vers le frontmatter `trello_due` de la note liée, y compris l'effacement de la clé quand `card.due` redevient `null`.
- Push : `trello_due` du frontmatter, quand modifié localement, poussé vers le champ `due` de la carte via `updateCard`, y compris l'envoi explicite de `due: null` pour effacer une date côté Trello.
- Extension symétrique de `decideSync`/`syncNoteWithCard` (même mécanisme que titre/corps), pas de nouveau chemin de synchro.
Périmètre — OUT :
- Labels → tags (prochain incrément de la feuille de route, explicitement hors de cet incrément).
- `dueComplete` (case "terminé" de Trello) et `dueReminder` (rappel) — seul le champ `due` lui-même est couvert.
- Tout réglage UI (pas de champ dans `SettingsTab.ts`, pas de toggle) — comportement toujours actif dès qu'une note est liée, cf. Décision.
- Toute conversion de fuseau horaire ou reformatage d'affichage de la date — stockage tel quel uniquement.
- Exécution avant le refacto `VaultGateway` sans la méthode narrow de repli documentée ci-dessus — voir Dépendance d'ordonnancement.

### Scénario utilisateur

**Nominal** : une carte Trello a une due date. À la prochaine synchro (pull), le frontmatter de la note liée reçoit `trello_due: "<ISO 8601 exact>"`. L'utilisateur modifie ensuite cette date directement dans le frontmatter Obsidian ; à la synchro suivante (push, carte plus ancienne que la note), la nouvelle date est écrite sur la carte Trello via `updateCard`.

**Échec** : l'utilisateur tape une date mal formée dans `trello_due` (ex. `"pas une date"`), puis une synchro push est déclenchée. `client.updateCard` envoie la valeur telle quelle ; l'API Trello la rejette (4xx) et lève une `TrelloError` déjà gérée par le pipeline existant (secrets masqués, message clair) — pas d'écriture partielle, pas de nouvelle validation ajoutée côté plugin (Fail Fast, §1.3, cohérent avec le fait qu'aucun champ n'est validé côté client aujourd'hui, y compris `name`/`desc`).

### Réutilisation

Composant existant le plus proche : `src/core/cardRef.ts` (clé de frontmatter dédiée + parse/format purs, testés isolément) pour `dueRef.ts` ; `src/features/syncNote.ts`/`src/core/syncDecision.ts` (diff-et-pousse titre/corps) pour l'intégration du due date dans la même décision de synchro. Aucun nouveau mécanisme de synchro créé — extension des structures existantes (`SyncInput`, `SyncDecision`, `fields` de `updateCard`).

### Cas de test critiques

1. Happy path : `card.due` fixé, note pas encore synchronisée → pull écrit `trello_due` avec la chaîne ISO exacte (aucun reformatage) ; frontmatter local modifié ensuite → push envoie ce due date via `updateCard`.
2. Effacement côté Trello : `card.due` redevient `null` alors que la note porte encore un `trello_due` d'une synchro précédente → pull retire la clé au lieu de laisser une date périmée.
3. Conflit : `trello_due` local ET `card.due` remote changent tous les deux dans la fenêtre `marginMs` → `dueChanged` seul suffit à déclencher `direction: "conflict"` (comme `bodyChanged`/`titleChanged` aujourd'hui), sans code de conflit spécifique au due date.
4. Push d'une date mal formée : `trello_due` local contient une chaîne non-ISO → `updateCard` la transmet telle quelle, l'API Trello répond en erreur, `TrelloError` remonte sans écriture partielle (cf. Scénario utilisateur — Échec).

## Phases

1. TDD core : `src/core/dueRef.ts` (+ `tests/dueRef.test.ts`) ; `src/trello/client.ts` (`TrelloCard.due`, `CARD_FIELDS`, `updateCard` avec `due?: string | null`) + `tests/trelloClient.test.ts`.
2. `VaultGateway.getDueDate`/`setDueDate` (interface) ; implémentations `ObsidianVault.ts` et `tests/fakes.ts` (`FakeVault`).
3. TDD intégration : `src/core/syncDecision.ts` (`localDue`/`remoteDue`/`dueChanged`) + `tests/syncDecision.test.ts` ; `src/features/syncNote.ts` (`decideForCard`, pull/push) + `tests/syncNote.test.ts`.
4. `npm run check` + greps §8 + déploiement `test-vault/` + passage réel documenté (pull avec/sans due date, édition manuelle puis push, cas d'erreur de format) + clôture (§5).

## Phases livrées

- Phase 1 (TDD core) : livrée. `src/core/dueRef.ts` (`DUE_KEY`, `parseDueRef`, `formatDueRef`) + `tests/dueRef.test.ts` (6 tests) ; `src/trello/client.ts` (`TrelloCard.due: string | null`, `CARD_FIELDS` + `,due`, `updateCard` avec `due?: string | null`) + `tests/trelloClient.test.ts` (6 tests neufs).
- Phase 2 (accès frontmatter) : livrée, mais sans code neuf — voir Écarts. Le refacto `VaultGateway` déjà mergé fournissait `readFrontmatter`/`writeFrontmatter` génériques sur `ObsidianVault` et `FakeVault` ; aucune méthode `getDueDate`/`setDueDate` n'a été ajoutée.
- Phase 3 (TDD intégration) : livrée. `src/core/syncDecision.ts` (`SyncInput.localDue`/`remoteDue`, `SyncDecision.dueChanged`, normalisation chaîne vide ≡ `null`) + `tests/syncDecision.test.ts` (6 tests neufs) ; `src/features/syncNote.ts` (`decideForCard` reçoit `localDue`, pull écrit/efface `trello_due` via `writeFrontmatter` quand `dueChanged`, push ajoute `due` aux `fields` quand `dueChanged`) + `tests/syncNote.test.ts` (6 tests neufs) ; `src/commands/noteCommands.ts` mis à jour au même patron pour `resolveConflict`.
- Effet de bord de plomberie (hors périmètre du plan, nécessaire pour que `npm run check` compile) : `src/core/folderPlan.ts` — `PlannedCard` (interface locale, sous-ensemble du type `TrelloCard` pour le planificateur de dossier) a gagné un champ `due: string | null` requis, sinon `src/features/syncFolder.ts` ne type-checkait plus (il passe un `PlannedCard` là où `syncNoteWithCard` attend maintenant un `TrelloCard` complet). Aucune nouvelle logique introduite — alignement de type pur. `tests/folderPlan.test.ts` mis à jour en conséquence (`due: null` sur la fixture `card()`).
- Phase 4 (`npm run check` + greps + passage réel `test-vault/`) : partiellement livrée. `npm run check` vert (typecheck + 337 tests / 29 fichiers + build `main.js`) ; greps `from "obsidian"` (src/core, src/trello) et résidu français (src/) vides. Le passage réel sur `test-vault/` (pull/push d'une carte avec due date dans un vrai Obsidian) n'a **pas** été fait — voir Écarts.

## Écarts

- **Interface due-date adaptée au refacto `VaultGateway` déjà mergé** : le plan original (rédigé avant que le refacto soit livré) prescrivait `VaultGateway.getDueDate(note)`/`setDueDate(note, due)`, au patron étroit de `getCardRef`/`setCardRef`. Le refacto ayant livré une primitive générique `readFrontmatter`/`writeFrontmatter` sur `VaultGateway` avant l'exécution de ce plan, la lecture/écriture du due date passe directement par cette primitive générique, appelée depuis `src/features/syncNote.ts` (et `src/commands/noteCommands.ts` pour `resolveConflict`) plutôt que par une méthode dédiée sur `VaultGateway`. Comportement inchangé (pull écrit `trello_due`, push le lit, stockage tel quel) ; c'est la forme de l'interface qui diffère de ce que le plan proposait. Décidé et documenté explicitement, pas une réinterprétation silencieuse.
- **Passage réel `test-vault/` non fait** : la vérification manuelle dans un vrai vault Obsidian (pull d'une carte avec/sans due date, édition manuelle du frontmatter, push, cas d'erreur de format) n'a pas été exécutée — l'agent qui a livré ce plan n'a pas accès à Obsidian. Reste à faire par un humain avant de considérer le "Terminé quand" du plan comme satisfait dans son intégralité. Le fichier n'est donc pas renommé avec le préfixe ✅.
