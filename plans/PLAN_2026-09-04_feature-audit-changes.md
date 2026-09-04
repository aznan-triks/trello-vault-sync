type: feature
init: full
Terminé quand : `npm run check` vert (typecheck + tests, dont `tests/auditAction.test.ts` couvrant `describeAction()` sur chaque type d'action porté + `tests/auditChanges.test.ts` couvrant l'engine, + build) ; `npm run check` inclut déjà les greps d'isolation en CI locale, mais §8 (isolation core/trello/features, résidu français, `catch` avalés) revérifié manuellement avant le bump ; déploiement dans `test-vault/.obsidian/plugins/trello-vault-sync/` fait.
État actuel observé : N/A (pas de bug signalé — feature de la feuille de route du 2026-09-04, spec fournie par l'utilisateur : `prompt-audit-log-plugin.md` + `Code.gs` + `dashboard.html`, extraits de `files (1).zip`, Downloads)
Ressources consultées :
- `prompt-audit-log-plugin.md` (spec utilisateur) — découpage archi déjà écrit : `core/` fonction pure `describeAction(action): AuditEntry | null`, `trello/` méthode `getActions(boardId, { since?, before? })` réutilisant le retry déjà en place, `features/` nouvel engine même forme que les audits existants écrivant dans le Report note configuré, curseur `since` (dernier action id) persisté dans les settings sans nouveau champ visible, `ui/` rien de neuf (réutilise panneau + panneau latéral existants).
- `Code.gs::describeAction_()` (proto Apps Script fourni en référence) — le mapping old→new à porter : `updateCard` (name/desc/closed/idList/due/idMembers), `createCard`, `deleteCard`, `addAttachmentToCard`, `deleteAttachmentFromCard`, `commentCard`, `addMemberToCard`, `removeMemberFromCard`, `createChecklist`, `updateCheckItemStateOnCard`, défaut → `null` (action ignorée). Tous les messages sont en français dans le proto → traduits en anglais (§0 CONTEXT.md, aucune exception).
- `Code.gs::writeRow()` — assemble la ligne (date, auteur, carte, liste, type, détail) à partir de l'action + du détail de `describeAction_()` ; porté en un seul `describeAction()` qui retourne l'`AuditEntry` complet ou `null`, comme demandé explicitement par la spec (signature `describeAction(action): AuditEntry | null`), pas la séparation à deux fonctions du proto.
- `Code.gs::backfillHistory()` / webhook (`doGet`/`doPost`/`setupWebhook`) — explicitement hors scope par la spec ("le reste — webhook public / Google Sheets — ne s'applique pas ici"), et `dashboard.html` hors scope aussi (Google Sheets).
- `src/trello/client.ts` (`TrelloCard`, `TrelloList`, `TrelloBoard`, `json<T>()`, retry/backoff déjà en place) — `getActions()` suit exactement le même patron que `getBoardLists`/`getListCards`.
- `src/core/syncDecision.ts` (`SyncInput`) — précédent confirmé : `core/` définit ses propres types structurels (jamais un import direct d'un type `trello/`), pour rester découplé. `TrelloAction` sera donc défini dans `core/auditAction.ts`, pas dans `trello/client.ts` ; `trello/client.ts` importera le type depuis `core/` pour `getActions()` (même sens de dépendance que `src/obsidian/gateway.ts` import déjà `CardRef` depuis `core/cardRef.ts`, et `trello/client.ts` importe déjà `errorMessage` depuis `core/`).
- `src/features/auditLinks.ts` / `auditLocations.ts` (fonctions, pas des classes) — patron exact de l'engine : `(vault, client, options, reporter, signal) => Promise<Result>`, écrit via `requireReportNote` + `mergeReport` (tous deux réutilisés tels quels, génériques).
- `src/core/auditReport.ts` (`buildLinkReport`, `buildLocationReport`, `mergeReport`, `escapeMarkdown` privée) — `buildChangesReport()` ajouté au même fichier, réutilise `mergeReport` sans modification ; `escapeMarkdown` exportée (au lieu de dupliquée) pour être réutilisée par le nouveau builder.
- `src/commands/auditCommands.ts` / `registry.ts` — patron exact de `runLinkAudit`/`runLocationAudit` et de l'entrée `audit-locations` dans `COMMANDS` (section "Vault" — le "Coffre" de la spec utilisateur est le mot français informel pour cette section anglaise déjà existante, pas une nouvelle section à créer).
- `src/settings/types.ts` (`DEFAULT_SETTINGS`, `normalizeSettings`, `safeString`) — `auditChangesCursor` ajouté comme les autres champs, mais **sans** champ dans `SettingsTab.ts` (spec : "pas de nouveau champ visible nécessaire").
- `tests/fakes.ts` (`clientFor`, `routedTransport`) — `clientFor` étendu avec un 3e paramètre optionnel `actions` (route `/boards/board/actions`), pas de nouvelle fonction.
Décision :
- Crée `src/core/auditAction.ts` (nouveau, pur) : `TrelloAction` (forme structurelle locale, pas importée de `trello/`), `AuditEntry`, `describeAction()`. Raison nouveau : aucun module existant ne couvre le mapping action Trello → entrée de journal.
- Étend `src/trello/client.ts` : `getActions(boardId, { since?, before? })`, même patron que `getBoardLists`. Pas de pagination automatique (`before` en boucle façon `backfillHistory()`) — hors scope, YAGNI : la commande est un polling manuel périodique, pas un backfill complet ; si le nombre d'actions dépasse la limite d'une page, l'utilisateur relance la commande (le curseur a déjà avancé).
- Crée `src/features/auditChanges.ts` (nouveau, fonction — pas de classe malgré le nom "AuditChangesEngine" de la spec, qui décrit juste "même forme que les engines existants", tous des fonctions).
- Étend `src/core/auditReport.ts` : `buildChangesReport()` + `CHANGES_REPORT_HEADING`, `escapeMarkdown` exportée.
- Étend `src/commands/auditCommands.ts` : `runChangesAudit()`, gère le curseur (`ctx.settings.auditChangesCursor`, avancé seulement si `!ctx.settings.dryRun`, comme demandé).
- Étend `src/commands/registry.ts` : commande `audit-changes`, section "Vault" (bouton panneau latéral automatique, réutilise le mécanisme du sous-plan 1 — rien de neuf côté `ui/`).
- Étend `src/settings/types.ts` : `auditChangesCursor: string` (curseur interne, pas de champ `SettingsTab.ts`).
Valeurs fixes introduites : `auditChangesCursor: ""` (défaut, curseur jamais lancé) — 1 seule, cohérente avec le reste de `DEFAULT_SETTINGS`. Pas de nouveau seuil numérique (la limite de page Trello reste une constante de protocole non utilisateur, comme `CARD_FIELDS`/`RETRYABLE` déjà dans `client.ts`, pas dans `settings/types.ts`).
Périmètre — IN :
- `describeAction()` portant fidèlement (traduit en anglais) tous les cas de `Code.gs::describeAction_()`.
- `getActions()` (une page, `filter=all`, `since`/`before` optionnels).
- Nouvelle commande "Audit changes" (bouton palette + panneau latéral, section Vault), écrivant dans le Report note existant.
- Curseur `since` persisté, avancé seulement hors dry-run.
Périmètre — OUT :
- Webhook temps réel (`doGet`/`doPost`/`setupWebhook`) — explicitement exclu par la spec.
- Google Sheets / `dashboard.html` — explicitement exclu par la spec.
- Pagination multi-pages automatique (`backfillHistory()`-style) — YAGNI, cf. Décision.
- Nouveau champ visible dans `SettingsTab.ts` pour le curseur — explicitement exclu par la spec.
- Vérification visuelle §10 dans Obsidian — bloquée (`request_access` refusé, cf. NEXT_SESSION.md), code + `npm run check` + déploiement `test-vault/` seulement.

### Scénario utilisateur
- Nominal : l'utilisateur lance "Audit changes" depuis le panneau latéral ou la palette — le Report note reçoit une section "Change Log" listant les modifications de cartes depuis le dernier run (créations, déplacements, pièces jointes, membres, checklists…), le curseur avance pour que le prochain run ne rejoue pas ces entrées.
- Échec : aucune action depuis le dernier run → section "Change Log" avec un message "aucun changement" explicite (pas de section vide silencieuse) ; Report note non configuré → même erreur explicite que les deux audits existants (`requireReportNote` réutilisé tel quel).

### Réutilisation
Composant existant le plus proche : `auditLocations()` (même forme exacte : `vault, client, options, reporter, signal → Promise<Result>`, `requireReportNote` + `mergeReport`). Réutilisé par calque du patron, pas par appel direct (le domaine — historique Trello — ne recoupe aucune logique déjà écrite, donc pas d'extraction commune au-delà de ce qui existe déjà : `requireReportNote`, `mergeReport`, `escapeMarkdown`).

### Cas de test critiques
- `tests/auditAction.test.ts` (pur, `core/auditAction.ts`) : chaque branche de `describeAction()` — chacun des types portés retourne le bon `detail` (traduit) ; un `updateCard` avec un champ `old` non suivi retourne `null` ; un type d'action non mappé (défaut) retourne `null`.
- `tests/auditChanges.test.ts` (`features/auditChanges.ts`, via `FakeVault` + `clientFor` étendu) : écrit les entrées valides dans le Report note (fusion via heading, comme les deux audits existants) ; une action dont `describeAction()` retourne `null` n'apparaît pas dans le rapport et n'est pas comptée ; `since` transmis dans la requête quand le curseur n'est pas vide ; le curseur retourné (`cursor`) est l'id de l'action la plus récente, `null` si aucune action ; annulation (signal déjà `aborted`) arrête la boucle de collecte sans lancer d'exception ; Report note manquant → erreur explicite (même comportement que `auditLinks`/`auditLocations`).
- Hors couverture unitaire (cohérent avec le reste de `src/commands/`, jamais testé dans `tests/`) : le gel du curseur en dry run (`runChangesAudit`) — vérifié par lecture de code, pas par test automatisé.

## Phases livrées

- `core/auditAction.ts` (`TrelloAction`, `AuditEntry`, `describeAction`) — TDD rouge→vert, 20 tests, port fidèle de `describeAction_()` (11 cas + défaut), traduit en anglais.
- `trello/client.ts::getActions()` (`filter=all`, `since`/`before` optionnels, pas de pagination auto — YAGNI documenté).
- `core/auditReport.ts::buildChangesReport()` + `CHANGES_REPORT_HEADING`, `escapeMarkdown` exportée (réutilisée, pas dupliquée).
- `features/auditChanges.ts` (engine, même forme que `auditLinks`/`auditLocations`) — TDD rouge→vert, 8 tests (`tests/auditChanges.test.ts`, `clientFor` étendu avec `actions`).
- `commands/auditCommands.ts::runChangesAudit()` (gel du curseur en dry run), `commands/registry.ts` (commande `audit-changes`, section Vault → bouton panneau latéral automatique), `settings/types.ts::auditChangesCursor` (interne, sans champ `SettingsTab.ts`).
- Revue Standards/Spec (2 sous-agents) : aucun finding dur ; 2 judgement calls appliqués (`yieldPeriodically` ajouté dans la boucle de collecte pour cohérence avec les autres engines ; `??` → `||` sur la due date pour coller exactement au proto `Code.gs`).
- `npm run check` vert (260 tests). Version 1.5.3 (PATCH — continuité du domaine audit, pas de nouveau système). Déployé dans `test-vault/.obsidian/plugins/trello-vault-sync/`.
- **Non ✅** : vérification visuelle §10 impossible (`request_access` toujours refusé) — le changement ajoute un bouton au panneau latéral existant.
