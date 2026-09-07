type: refacto
init: full
Terminé quand :
- `npm run check` vert (typecheck strict + suite Vitest existante sans régression + build `main.js`).
- `grep -n "getCardRef\|setCardRef\|readTemplate" src/obsidian/gateway.ts` ne retourne plus aucune ligne à l'intérieur du bloc `interface VaultGateway { ... }` (ces 3 signatures vivent désormais dans des interfaces séparées du même fichier ou d'un fichier voisin).
- `grep -rn "from \"obsidian\"" src/core/ src/trello/` reste vide (invariant §1.2/§8, non touché par ce refacto mais à reconfirmer).
- `grep -rln "getCardRef\|setCardRef" src/features src/commands` retourne exactement les 7 fichiers déjà identifiés (`syncVault.ts`, `syncNote.ts`, `syncFolder.ts`, `linkNote.ts`, `auditLocations.ts`, `auditLinks.ts`, `noteCommands.ts`) et chacun compile en typant son paramètre `vault`/`ctx.vault` avec la nouvelle interface `CardRefStore` (seule ou combinée), jamais avec l'ancien `VaultGateway` monolithique.
- `grep -n "readTemplate" src/features/syncFolder.ts` compile avec le paramètre typé `TemplateResolver`, seul fichier de `src/features/` à référencer cette interface.
- Les 3 fichiers qui n'utilisent que l'IO générique (`auditChanges.ts`, `exportChangesHtml.ts`, `auditShared.ts`) gardent une signature `vault: VaultGateway` inchangée — preuve que l'isolation type-level fonctionne (ils ne "voient" plus `CardRef`/template dans leur propre signature).
- `tests/fakes.ts` (`FakeVault`) compile en implémentant les 3 interfaces (`implements VaultGateway, CardRefStore, TemplateResolver`) sans modification du comportement des tests existants (aucun test rouge).
État actuel observé :
- `src/obsidian/gateway.ts:20-37` — l'interface `VaultGateway` mélange 3 responsabilités confirmées par lecture directe du fichier (lignes vérifiées à jour) :
  1. IO fichier générique : `listNotes`, `noteAt`, `read`, `write`, `rename`, `create`, `trash`, `exists`.
  2. Concept métier Trello : `getCardRef(note): CardRef | null` (ligne 26) et `setCardRef(note, ref: CardRef): Promise<void>` (ligne 28) — `CardRef` (défini dans `src/core/cardRef.ts`) fuite dans une interface censée être indépendante du domaine.
  3. Résolution de gabarit : `readTemplate(name): Promise<string | null>` (ligne 36).
- Cause racine : l'interface a été conçue en recopiant les besoins concrets des features (sync/link) au lieu d'isoler une abstraction "vault" indépendante du domaine — quiconque veut de l'IO fichier pur hérite aussi du concept Trello et de la résolution de gabarit.
- Implémentation concrète unique aujourd'hui : `src/obsidian/ObsidianVault.ts` (une seule classe, `implements VaultGateway`) — `getCardRef`/`setCardRef` lisent/écrivent via `app.metadataCache`/`app.fileManager.processFrontMatter` (lignes 38-48), `readTemplate` cherche un fichier par nom (lignes 81-88). Fake en mémoire équivalente : `tests/fakes.ts` (`FakeVault`, lignes 55/61/104).
- Consommateurs recensés par grep (13 fichiers matchant `VaultGateway`, détail en `### Impact sur l'existant`).
- Besoin proche confirmé (plan roadmap due-date, en cours de cadrage en parallèle par un autre agent) : un futur ajout doit pouvoir lire/écrire n'importe quel champ de frontmatter générique — donc ce refacto introduit la primitive générique correspondante dans `VaultGateway` dès maintenant, sans implémenter la feature due-date elle-même.
Ressources consultées :
- `src/obsidian/gateway.ts` (interface actuelle, lue en entier).
- `src/obsidian/ObsidianVault.ts` (implémentation réelle, lue en entier) — `getCardRef`/`setCardRef` utilisent déjà exactement le mécanisme (`metadataCache.getFileCache(...).frontmatter` / `fileManager.processFrontMatter`) qu'une primitive générique de frontmatter devrait exposer : aucune nouvelle mécanique Obsidian à inventer.
- `src/core/cardRef.ts` (`CardRef`, `CARD_REF_KEY`, `parseCardRef`, `formatCardRef`) — logique pure déjà isolée du vault, réutilisable telle quelle par la nouvelle interface `CardRefStore`.
- `tests/fakes.ts` (`FakeVault`) — fake en mémoire à faire implémenter les 3 interfaces séparées (fichier `tests/`, non modifié par ce plan, impact seulement documenté).
- `src/commands/context.ts` (`CommandContext.vault: VaultGateway`) — point de câblage unique entre `main.ts` (une seule instance `ObsidianVault`) et tous les handlers de commande.
- `src/main.ts` — `TrelloVaultSyncPlugin implements CommandContext`, champ `vault!: ObsidianVault` : une seule instance concrète, jamais recréée par feature — confirme qu'un split en interfaces (sans split en classes) ne touche pas le câblage.
- Grep `VaultGateway` dans `src/` → 13 fichiers ; grep `getCardRef|setCardRef|readTemplate` dans `src/` → 7 fichiers consommateurs + les 2 fichiers de définition/implémentation (`gateway.ts`, `ObsidianVault.ts`).
Décision :
- Étend `src/obsidian/gateway.ts` : découpe l'unique interface `VaultGateway` en 3 interfaces dans le même fichier (pas de nouveau fichier — 3 interfaces courtes et étroitement liées, un fichier séparé par interface serait une fragmentation gratuite pour ~5 lignes chacune) :
  1. `VaultGateway` (généraliste, réduite) : `listNotes`, `noteAt`, `read`, `write`, `rename`, `create`, `trash`, `exists`, **plus** deux nouvelles méthodes génériques de frontmatter demandées par le besoin due-date proche : `readFrontmatter(note): Record<string, unknown> | null` et `writeFrontmatter(note, mutate: (frontmatter: Record<string, unknown>) => void): Promise<void>`. Ce sont exactement les deux primitives qu'`ObsidianVault` utilise déjà en interne pour `getCardRef`/`setCardRef` (`metadataCache.getFileCache` / `fileManager.processFrontMatter`) — les exposer génériquement ne duplique rien de nouveau, ça nomme un mécanisme qui existe déjà.
  2. `CardRefStore` (nouvelle, concept métier Trello) : `getCardRef(note): CardRef | null`, `setCardRef(note, ref: CardRef): Promise<void>` — signatures identiques à aujourd'hui, seulement déplacées hors de `VaultGateway`.
  3. `TemplateResolver` (nouvelle, résolution de gabarit) : `readTemplate(name): Promise<string | null>` — signature identique, déplacée hors de `VaultGateway`.
- Étend `src/obsidian/ObsidianVault.ts` : `implements VaultGateway, CardRefStore, TemplateResolver` (une seule classe continue de porter les 3 rôles à l'exécution — pas de 3 classes séparées : la ressource sous-jacente est le même `App` Obsidian, créer 3 objets pour 3 interfaces serait de la sur-ingénierie sans bénéfice, le bénéfice recherché est la séparation au niveau des *types* consommés par les features, pas au niveau des instances). `getCardRef`/`setCardRef` peuvent rester implémentés tels quels, ou être ré-exprimés en termes de `readFrontmatter`/`writeFrontmatter` (DRY, écart d'implémentation à trancher en exécution, sans impact sur la signature publique ni sur le "Terminé quand").
- Étend `src/commands/context.ts` : `CommandContext.vault` passe de `VaultGateway` à `VaultGateway & CardRefStore & TemplateResolver` — seul endroit où le type composite apparaît, parce que `ctx.vault` sert des handlers aux besoins hétérogènes (ex. `noteCommands.ts` a besoin de `CardRefStore`, d'autres non). Alternative rejetée : exposer 3 propriétés séparées (`ctx.vault`, `ctx.cardRefs`, `ctx.templates`) sur `CommandContext` — rejetée par YAGNI/KISS, ça forcerait à modifier tous les appels `ctx.vault.xxx` existants pour un bénéfice nul (un seul point de câblage, un seul objet concret derrière).
- Étend les signatures de fonctions dans les 7 fichiers `src/features/`+`src/commands/` qui utilisent `getCardRef`/`setCardRef`/`readTemplate` : chaque paramètre `vault: VaultGateway` devient `vault: VaultGateway & CardRefStore` (5 fichiers : `syncVault.ts`, `syncNote.ts`, `linkNote.ts`, `auditLocations.ts`, `auditLinks.ts`) ou `vault: VaultGateway & CardRefStore & TemplateResolver` (1 fichier : `syncFolder.ts`, seul à utiliser les 3). `noteCommands.ts` ne déclare pas son propre paramètre `vault` — il consomme `ctx.vault` déjà typé au niveau de `CommandContext`, donc aucun changement de signature locale, seulement bénéficiaire du changement dans `context.ts`.
- Réutilise sans modification `src/core/cardRef.ts` (`CardRef`, `parseCardRef`, `formatCardRef`, `CARD_REF_KEY`) — aucune logique pure à toucher, seulement son point d'entrée dans l'interface vault change de nom d'interface porteuse.
- Aucune nouvelle classe, aucun nouveau fichier : le split reste dans `gateway.ts` (types) + `ObsidianVault.ts`/`tests/fakes.ts` (implémentations, `tests/` hors périmètre d'exécution de ce plan mais son impact est documenté) + les 6 fichiers appelants dont la signature de paramètre se resserre.
Valeurs fixes introduites : 0 — refacto structurel, aucune nouvelle constante, seuil, chemin ou libellé.
Périmètre — IN :
- Découpage de `VaultGateway` en `VaultGateway` (IO générique + nouvelle primitive frontmatter générique) / `CardRefStore` / `TemplateResolver` dans `src/obsidian/gateway.ts`.
- Mise à jour de `ObsidianVault.ts` pour implémenter les 3 interfaces.
- Mise à jour des signatures des 6 fichiers appelants (`syncVault.ts`, `syncNote.ts`, `syncFolder.ts`, `linkNote.ts`, `auditLocations.ts`, `auditLinks.ts`) + du type `CommandContext.vault` dans `context.ts`.
- Ajout des méthodes génériques `readFrontmatter`/`writeFrontmatter` sur `VaultGateway` (signature + implémentation dans `ObsidianVault.ts`), sans les brancher sur une quelconque feature due-date.
Périmètre — OUT :
- La feature due-date (lecture/écriture de la date d'échéance Trello en frontmatter) — plan séparé, à écrire une fois celui-ci livré. Ce plan se limite à fournir la primitive générique dont elle aura besoin.
- Tout renommage de `trello_board_card_id` (interdit, §9 CONTEXT.md).
- Toute réécriture du contenu de `getCardRef`/`setCardRef`/`readTemplate` au-delà de leur déplacement d'interface (garder le comportement observable identique — voir Invariants).
- `tests/fakes.ts` — fichier sous `tests/`, hors du périmètre d'exécution de cette tâche (ce plan documente son impact mais ne le modifie pas ; sa mise à jour fait partie de l'exécution future du plan, pas de sa rédaction).
- Labels→tags, checklists→tâches, multi-board et tout autre item du backlog roadmap (`NEXT_SESSION.md`) : hors scope, non liés à ce refacto.

### Invariants post-refacto

- Comportement observable de `getCardRef`/`setCardRef`/`readTemplate` strictement identique (mêmes entrées → mêmes sorties, mêmes effets de bord sur le vault) — seul le nom de l'interface qui les déclare change, pas leur corps.
- `CARD_REF_KEY = "trello_board_card_id"` inchangé (règle §9, non négociable).
- Toute note existante dans un coffre réel continue de se résoudre en `CardRef` de la même façon (aucune migration de données requise, c'est un refacto de types compile-time).
- `src/core/` et `src/trello/` n'importent toujours jamais `"obsidian"` (invariant §1.2/§8, ce refacto touche seulement `src/obsidian/`, `src/features/`, `src/commands/`).
- `src/features/` continue de dépendre uniquement d'interfaces (`VaultGateway`/`CardRefStore`/`TemplateResolver`/`TrelloClient`), jamais de `TFile`/`App` directement.
- Aucune commande, aucun libellé UI, aucun réglage visible dans `SettingsTab.ts` ne change — refacto invisible pour l'utilisateur final du plugin.

### Impact sur l'existant

Fichiers matchant `VaultGateway` ou l'un des 3 membres déplacés (13 au total, tous recensés par grep) :

| Fichier | Usage actuel | Impact |
|---|---|---|
| `src/obsidian/gateway.ts` | définit `VaultGateway` (20-37) | découpé en 3 interfaces + 2 nouvelles méthodes frontmatter génériques |
| `src/obsidian/ObsidianVault.ts` | `implements VaultGateway`, porte les 3 responsabilités | `implements VaultGateway, CardRefStore, TemplateResolver` ; ajoute `readFrontmatter`/`writeFrontmatter` |
| `src/features/syncVault.ts` (ligne 55) | `vault.getCardRef(note)` | paramètre `vault: VaultGateway` → `VaultGateway & CardRefStore` |
| `src/features/syncNote.ts` (ligne 110) | `vault.getCardRef(note)` | idem |
| `src/features/syncFolder.ts` (lignes 105, 125, 142) | `getCardRef`, `readTemplate`, `setCardRef` | paramètre → `VaultGateway & CardRefStore & TemplateResolver` (seul fichier à cumuler les 3) |
| `src/features/linkNote.ts` (lignes 25, 33, 44) | `getCardRef`, `setCardRef` | paramètre → `VaultGateway & CardRefStore` |
| `src/features/auditLocations.ts` (ligne 44) | `vault.getCardRef(note)` | idem |
| `src/features/auditLinks.ts` (ligne 45) | `vault.getCardRef(note)` | idem |
| `src/commands/noteCommands.ts` (ligne 80) | `ctx.vault.getCardRef(note)` | aucun changement local — bénéficie du nouveau type de `CommandContext.vault` |
| `src/commands/context.ts` (ligne 17) | `readonly vault: VaultGateway` | type → `VaultGateway & CardRefStore & TemplateResolver` |
| `src/features/auditChanges.ts` (lignes 4, 30) | `vault: VaultGateway` (IO générique seulement) | **aucun changement** — confirme l'isolation |
| `src/features/exportChangesHtml.ts` (lignes 5, 40) | `vault: VaultGateway` (IO générique seulement) | **aucun changement** |
| `src/features/auditShared.ts` (lignes 1, 15) | `vault: VaultGateway` (IO générique seulement) | **aucun changement** |
| `src/settings/types.ts` (ligne 100) | mention en commentaire uniquement | **aucun changement** (pas un import réel) |
| `src/main.ts` (lignes 13, 24, 35) | `vault!: ObsidianVault`, `implements CommandContext` | **aucun changement** — une seule instance concrète satisfait déjà les 3 interfaces |
| `tests/fakes.ts` (`FakeVault`, lignes 8, 55, 61, 104) | `implements VaultGateway`, porte les 3 responsabilités | hors périmètre d'exécution de ce plan (dossier `tests/`) — à mettre à jour en `implements VaultGateway, CardRefStore, TemplateResolver` au moment de l'exécution, sinon la suite Vitest ne compile plus |

### Aucun hardcode introduit

Confirmé : ce plan ne définit aucun nombre, chemin, URL, seuil, délai ou libellé nouveau. Les deux méthodes ajoutées (`readFrontmatter`/`writeFrontmatter`) sont des signatures d'interface, pas des valeurs de configuration — rien à ajouter dans `src/settings/types.ts`.

## Phases

1. `src/obsidian/gateway.ts` : découper `VaultGateway` en `VaultGateway` (IO + 2 nouvelles méthodes frontmatter génériques) / `CardRefStore` / `TemplateResolver`.
2. `src/obsidian/ObsidianVault.ts` : `implements` les 3 interfaces, ajouter `readFrontmatter`/`writeFrontmatter`, vérifier `tsc --noEmit`.
3. Mettre à jour les 6 signatures de fonctions `src/features/*.ts` + `CommandContext.vault` dans `src/commands/context.ts`.
4. `tests/fakes.ts` (`FakeVault`) : `implements` les 3 interfaces (nécessaire pour que la suite Vitest compile — pas une extension de périmètre, une conséquence directe des phases 1-3).
5. `npm run check` vert + greps de `Terminé quand` exécutés et confirmés.

## Écarts

Aucun. Toutes les phases (1 à 5) ont été livrées telles que décrites.

Décision d'exécution prise sur le point explicitement laissé ouvert par le plan (§ Décision, point 2) :
`getCardRef`/`setCardRef` dans `ObsidianVault.ts` ont été ré-exprimés en termes de `readFrontmatter`/`writeFrontmatter` (DRY), plutôt que laissés dans leur implémentation directe via `metadataCache`/`fileManager`. Comportement observable identique (même mécanisme sous-jacent, juste factorisé) — confirmé par la suite Vitest restée verte (316/316) sans modification.

Écart mineur non anticipé par le plan : `tests/syncFolder.ts` contient une classe `CountingVault extends FakeVault` (non listée dans "Impact sur l'existant" ni dans le périmètre déclaré de `tests/fakes.ts`). Elle hérite automatiquement de `readFrontmatter`/`writeFrontmatter` de `FakeVault` sans modification nécessaire — aucune ligne touchée dans `tests/syncFolder.ts`, simple confirmation que l'héritage suffit.

Vérifications finales :
- `npm run check` : vert (`tsc --noEmit` sans erreur, 28 fichiers de test / 316 tests passés, build esbuild production réussi).
- Les 5 greps du plan (`Terminé quand`) confirmés conformes, y compris l'isolation des 3 fichiers IO générique (`auditChanges.ts`, `exportChangesHtml.ts`, `auditShared.ts`) qui gardent `vault: VaultGateway` inchangé.
