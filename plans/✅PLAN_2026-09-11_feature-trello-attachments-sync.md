type: feature
init: full
Terminé quand :
- `npm run check` vert (typecheck + tests + build), avec au minimum ces cas neufs :
  1. Carte avec une pièce jointe URL classique (`isUpload: false`, pas un lien de carte Trello) → apparaît dans `trello_attachments`.
  2. Carte avec une pièce jointe "lien vers une autre carte" dont l'id résolu correspond à une note du coffre → `trello_linked_cards` reçoit `[[nom de la note trouvée]]`.
  3. Même cas mais sans note correspondante dans le coffre → `trello_linked_cards` reçoit `[[nom de la carte Trello]]` (placeholder).
  4. Carte sans aucune pièce jointe alors que la note a déjà `trello_attachments`/`trello_linked_cards` renseignés → les deux clés sont supprimées (pas laissées obsolètes).
  5. `dryRun: true` → aucune écriture frontmatter, juste rapporté.
- Passage réel `test-vault/` : une carte de test avec une pièce jointe URL + une pièce jointe "carte liée" (vers une carte ayant une note dans `test-vault/`), resynchroniser → les deux clés se remplissent correctement, capture d'écran montrée à l'utilisateur.

État actuel observé : N/A (feature nouvelle, pas un domaine signalé cassé — §3bis non déclenché).

Ressources consultées :
- `src/trello/client.ts` (entier) — `TrelloCard` n'a aucun champ attachment ; patron direct pour un nouvel endpoint : `getBoardLabels`/`getActions` (GET avec `fields`/params, `json<T>()`). `getCard(cardId)` accepte déjà un `id` Trello brut — l'API Trello accepte transparemment un shortLink à la place d'un id, donc réutilisable tel quel pour résoudre un shortLink d'attachment sans nouvelle méthode.
- `src/core/labelRef.ts` + `src/features/syncNote.ts` (`convergeLabelsOnMerge`, lignes 111-129 et 151-159) — patron direct pour une convergence qui tourne **indépendamment** de la direction pull/push décidée pour titre/corps/due, ne cause jamais de conflit, respecte `dryRun`. Les pièces-jointes suivent le même point d'accroche mais en pull-only (pas de merge deux sens, cf. Décision).
- `src/core/cardRef.ts` — `parseCardRef`/`formatCardRef` déjà la source unique pour comparer un id de carte ; réutilisé tel quel pour construire l'index carte→note, aucune nouvelle logique de comparaison d'id.
- `src/features/syncFolder.ts:273` (`syncAllMappings`) — `vault.listNotes("")` déjà appelé une fois pour tout le lot de mappings ; patron direct pour construire l'index carte→note une seule fois par run plutôt que par note.
- `src/obsidian/gateway.ts` — `VaultGateway.listNotes`/`readFrontmatter`/`writeFrontmatter` déjà génériques, aucune extension nécessaire.
- `src/settings/types.ts` + `SettingsTab.ts` — patron `cardRefFrontmatterKey`/`dueFrontmatterKey`/`labelsFrontmatterKey` (section "Frontmatter keys") = patron direct pour les 2 nouvelles clés.

Décision :
- **Sens de synchro : pull uniquement (Trello → note)**, décision prise faute d'usage identifié pour le sens inverse — ajouter un lien/wikilink à la main dans le frontmatter ne crée pas de pièce jointe Trello. Signalé explicitement ici (pas confirmé par une question dédiée à l'utilisateur comme pour les checklists) — à valider au go de ce plan.
- Étend `src/trello/client.ts` : nouveau type `TrelloAttachment { id: string; name: string; url: string; isUpload: boolean }` ; `ATTACHMENT_FIELDS = "name,url,isUpload"` ; nouvelle méthode `getCardAttachments(cardId, signal?)` (`GET /cards/{id}/attachments`, patron `getBoardLabels`).
- Crée `src/core/attachmentRef.ts` (nouveau, pur) : `DEFAULT_ATTACHMENTS_KEY = "trello_attachments"`, `DEFAULT_LINKED_CARDS_KEY = "trello_linked_cards"`, `parseAttachmentsRef`/`formatAttachmentsRef` et `parseLinkedCardsRef`/`formatLinkedCardsRef` (listes de chaînes, patron `labelRef` mais sans normalisation casse/tri — l'ordre suit celui renvoyé par Trello, dédup stricte) ; `CARD_LINK_URL_PATTERN` + `extractCardShortLink(url): string | null` (détecte une pièce jointe "lien vers une carte" via `https://trello.com/c/<shortLink>`) ; `formatWikilink(name): string`.
- Crée `src/features/attachmentSync.ts` (nouveau) :
  - `buildCardIndex(vault, cardRefKey): Map<string, NoteHandle>` — un seul passage `listNotes("")` + `readFrontmatter`, clé = `cardId` seul (id Trello globalement unique, `boardId` ignoré pour le matching).
  - `resolveAttachments(client, card, cardIndex): Promise<{ urls: string[]; linkedCards: string[] }>` — appelle `getCardAttachments`, sépare pièces jointes "lien de carte" (via `extractCardShortLink`) des autres ; pour chaque lien de carte, résout le shortLink en id réel via `client.getCard(shortLink)`, cherche dans `cardIndex` → `[[note.basename]]` si trouvé, sinon `[[${attachment.name}]]` (le nom de l'attachment "lien de carte" est déjà le nom de la carte Trello côté API).
  - `cardIndex` est construit **une seule fois par run** et threadé en paramètre optionnel à travers `syncAllMappings`/`syncVault`/le futur appel — si absent (cas note unique via `noteCommands.ts`), construit à la volée dans `syncNoteWithCard` (coût d'un `listNotes("")` supplémentaire, acceptable pour une synchro à une note).
- Étend `src/features/syncNote.ts` : `syncNoteWithCard` gagne un paramètre optionnel `cardIndex?: Map<string, NoteHandle>` et deux clés d'options (`attachmentsFrontmatterKey?`, `linkedCardsFrontmatterKey?`) ; convergence pièces-jointes appelée au même point que `convergeLabelsOnMerge` (avant les `return` skip/conflict), jamais un motif de conflit, respecte `dryRun`. Écrit `trello_attachments`/`trello_linked_cards` seulement si différent de l'existant (évite une écriture frontmatter à chaque sync si rien n'a changé) ; supprime les clés si les deux listes sont vides.
- Étend `src/settings/types.ts` : `attachmentsFrontmatterKey` (défaut `DEFAULT_ATTACHMENTS_KEY`), `linkedCardsFrontmatterKey` (défaut `DEFAULT_LINKED_CARDS_KEY`), normalisées via `safeFrontmatterKey` comme les 3 clés existantes.
- Étend `src/settings/SettingsTab.ts` : 2 champs de plus dans la section "Frontmatter keys", même patron que les 3 existants (label + description + defaut).

Valeurs fixes introduites : `trello_attachments` / `trello_linked_cards` (`src/core/attachmentRef.ts`) — valeurs par défaut des 2 nouvelles clés configurables, jamais des constantes en dur consommées ailleurs (règle d'or §1.4).

Périmètre — IN :
- `src/trello/client.ts` : `TrelloAttachment`, `ATTACHMENT_FIELDS`, `getCardAttachments`.
- `src/core/attachmentRef.ts` (nouveau) : clés frontmatter, parse/format, détection lien-de-carte, formatage wikilink.
- `src/features/attachmentSync.ts` (nouveau) : `buildCardIndex`, `resolveAttachments`.
- `src/features/syncNote.ts` : wiring pull-only, `cardIndex` optionnel threadé.
- `src/features/syncFolder.ts` (`syncAllMappings`) / `src/features/syncVault.ts` : construction de `cardIndex` une fois par run, passé aux appels de sync.
- `src/settings/types.ts` + `SettingsTab.ts` : 2 nouvelles clés configurables.
- Tests : `tests/core/attachmentRef.test.ts`, `tests/features/attachmentSync.test.ts`, cas ajoutés dans `tests/syncNote.test.ts`, `tests/trelloClient.test.ts`, `tests/settings.test.ts`.

Périmètre — OUT :
- Sens push (créer une pièce jointe Trello depuis un lien ajouté à la main en frontmatter) — aucun usage identifié, YAGNI ; à rouvrir si demandé.
- Téléchargement/embed local des fichiers uploadés (`isUpload: true`) — traités comme une URL parmi d'autres, jamais rapatriés dans le coffre.
- Échappement des caractères spéciaux (`[[`, `]]`, `|`) dans un nom de carte/note transformé en wikilink — cas limite non traité, à corriger si un nom réel le déclenche.
- Checklists → tâches — item distinct du backlog, plan séquentiel après livraison de celui-ci (§4 cap de taille), format déjà tranché (liste Markdown `- [ ]` dans le corps, bidirectionnel).

### Scénario utilisateur
Nominal : une carte Trello a une pièce jointe "Cahier des charges.pdf" (URL classique) et une pièce jointe qui pointe vers une autre carte "Idée business X" (elle-même déjà liée à une note du coffre). Une synchro fait apparaître `trello_attachments: [<url du pdf>]` et `trello_linked_cards: [[Idée business X]]` (wikilink cliquable vers la vraie note) dans le frontmatter.
Échec : la carte liée en pièce jointe n'a aucune note dans le coffre → `trello_linked_cards` reçoit `[[Idée business X]]` en placeholder texte (pas de crash, pas de note fantôme créée).

### Réutilisation
`core/labelRef.ts` = patron direct pour la paire parse/format d'une clé frontmatter liste. `features/syncNote.ts::convergeLabelsOnMerge` = patron direct pour une convergence indépendante de la direction pull/push, jamais cause de conflit. `core/cardRef.ts` reste l'unique source de vérité pour comparer un id de carte — `attachmentSync.ts` ne réimplémente aucune logique de parsing d'id, juste un index construit dessus.

### Cas de test critiques
- Happy path pièce jointe URL : `isUpload: false`, url non-Trello → ajoutée telle quelle à `trello_attachments`.
- Happy path lien de carte avec note trouvée : shortLink résolu → id réel → trouvé dans `cardIndex` → wikilink vers la note réelle.
- Erreur 1 : lien de carte sans note correspondante → wikilink placeholder par nom, jamais de throw, jamais de note créée.
- Erreur 2 : carte qui perd toutes ses pièces jointes alors que le frontmatter en avait → les deux clés sont supprimées, pas laissées avec une valeur périmée.
- Dry-run : aucune écriture, même quand le contenu calculé diffère de l'existant.

## Écarts

- **Découverte en cours d'implémentation, hors plan initial** : contrairement aux labels/due (déjà inclus dans la carte fetchée), les pièces-jointes nécessitent un appel réseau Trello séparé à chaque synchro de note. Question posée à l'utilisateur en direct → décision : réglage `syncAttachments` désactivable, **actif par défaut** (pas de toggle "rejeté" comme pour les labels — ici le coût réseau existe même à vide, ce n'est pas un no-op comme le mini-sync labels).
- `buildCardIndex(vault, cardRefKey)` prévu au plan → implémenté `buildCardIndex(vault, notes: NoteHandle[])` (pas de `cardRefKey` : réutilise `vault.getCardRef` qui encapsule déjà la clé configurée ; prend une liste de notes déjà scannée plutôt que de rescanner — partagée entre `syncAllMappings` et le futur module checklists). Déviation fonctionnellement équivalente, documentée ici plutôt que dans le plan lui-même.
- **code-review (§7) exécutée** (2 sous-agents Standards/Spec, sur le diff complet attachments+checklists puisque livrés dans la même session) — findings retenus et corrigés : mot français résiduel ("accroche") dans des commentaires `syncNote.ts`, comparaison trompeuse avec `protectionCheckFailed` (le `console.warn` n'a en réalité pas de parité avec son log+stats — commentaire corrigé pour citer le vrai précédent, `resolveLabelIds`), constantes `DEFAULT_SYNC_ATTACHMENTS`/`DEFAULT_SYNC_CHECKLISTS` dupliquées en dur dans `syncNote.ts` ET `settings/types.ts` → déplacées en source unique dans `core/attachmentRef.ts`/`core/checklistRef.ts` (pattern `DEFAULT_LABELS_SYNC_MODE`). Finding Spec confirmé et corrigé : dédup stricte des URLs/wikilinks manquante (`resolveAttachments`) → ajoutée (`pushUnique`), 2 tests neufs. Findings jugement/non bloquants laissés tels quels (documentés dans la review, pas dans ce fichier).
- **Passage réel `test-vault/` NON FAIT** (§1.7) — pas d'accès `computer-use` sollicité cette session. À faire avant tout déploiement dans un vault réel autre que `test-vault/`.
- Push + release GitHub faits sur confirmation explicite de l'utilisateur ("go et commit push release").
