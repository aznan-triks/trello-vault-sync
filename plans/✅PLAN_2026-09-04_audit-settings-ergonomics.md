type: audit
init: light
Terminé quand : chaque comportement introduit par les sous-plans v1.5.0→v1.5.5 est classé explicitement — soit "réglage manquant, à ajouter" (avec la valeur par défaut proposée), soit "détail interne, justifié" (avec la raison) ; chaque champ de saisie ajouté dans `SettingsTab.ts`/`SidebarView.ts` sur la même période est classé "cohérent avec un patron existant" ou "saisie brute à corriger" ; le tout consigné dans `audits/AUDIT_settings-ergonomics.md`.
État actuel observé : demande utilisateur du 2026-09-04 — "il manque des paramètres pour tout ça [...] il faut toujours vérifier que tout est paramétrable et comme le reste (ergonomie etc)", déclenchée après coup sur `excludedFolders` (textarea brute corrigée en v1.5.5 en liste avec autocomplétion, alors que ç'aurait dû être fait dès le sous-plan 2/5). Nouvelle règle ajoutée à `CONTEXT.md` §8 (Hardcode étendu + nouveau bullet "Cohérence UI/ergonomie") — cet audit est le premier passage sous cette règle, sur le lot de fonctionnalités déjà livré.
Ressources consultées :
- `CONTEXT.md` §8 (règle étendue ce tour) — critères de classement : une valeur/un comportement qui pourrait raisonnablement varier selon l'utilisateur = candidat réglage ; une saisie brute sans réutilisation d'un patron existant (`VaultPathSuggest`, `TrelloPickerSuggest`, liste ligne-par-ligne + bouton suppression) = candidat ergonomie.
- `plans/PLAN_2026-09-04_feature-sidebar-view.md`, `*-excluded-folders.md`, `*-feature-logging.md`, `*-feature-audit-changes.md`, `*-feature-panel-colors.md` (les 5 sous-plans déjà livrés) — périmètre exact de ce qui a été introduit, à relire un par un pour ne rien manquer.
- `src/settings/types.ts` (`DEFAULT_SETTINGS`) — liste actuelle des réglages exposés, pour repérer par différence ce qui a été codé en dur à côté.
Décision : audit seul ce tour — aucune décision de fix avant validation utilisateur (§3bis).
Valeurs fixes introduites : 0 (audit, aucun code changé)
Périmètre — IN :
- Tous les fichiers touchés par les 5 sous-plans (`SidebarView.ts`, `SettingsTab.ts`, `ProgressPanel.ts`, `core/journal.ts`, `core/countSeverity.ts`, `core/auditAction.ts`, `trello/client.ts::getActions`, `features/auditChanges.ts`, `settings/types.ts`).
Périmètre — OUT :
- Le reste du plugin (sync note/dossier/coffre, résolution de conflit, mappings) — déjà audité et stable, pas concerné par le lot du 2026-09-04, sauf si l'audit y trouve un écart par ricochet (à signaler séparément si oui, pas à corriger ici).

### État cible
- Chaque nombre/seuil/limite introduit depuis v1.5.0 est soit dans `settings/types.ts`, soit justifié comme détail interne (protocole, constante non user-facing) — même critère que `CARD_FIELDS`/`RETRYABLE` déjà acceptés dans `client.ts`.
- Chaque champ de saisie de type "liste de chemins/identifiants" dans `SettingsTab.ts` utilise l'autocomplétion ou le patron liste+suppression déjà en place, sauf raison explicite.
- Aucune fonctionnalité des 5 sous-plans n'a un comportement figé que l'utilisateur ne peut ni voir ni changer alors qu'il aurait raisonnablement voulu le faire (ex. taille d'un historique, activation d'une coloration).

### Patterns à grep
- `grep -rn "const [A-Z_]* = " src/core/journal.ts src/core/countSeverity.ts src/ui/ProgressPanel.ts src/trello/client.ts src/features/auditChanges.ts` — recense toute constante module-level introduite depuis v1.5.0, à classer une par une.
- `grep -rn "addTextArea\|addText(" src/settings/SettingsTab.ts` — recense tous les champs de saisie texte du fichier, à comparer à ceux qui ont `VaultPathSuggest`/`TrelloPickerSuggest`/un patron liste+suppression.
- `grep -rn "MAX_LOG_ROWS" src/` — le journal persistant (sous-plan 3) réutilise cette constante pensée pour le panneau flottant éphémère ; à trancher explicitement si un usage distinct (journal multi-runs) mérite son propre plafond configurable.
- `grep -rn "PROBLEM_KEYS" src/core/countSeverity.ts` — classification fixe des compteurs "problème" ; à trancher si figée en code (légitime, comme `ICONS`) ou si l'utilisateur pourrait vouloir désactiver la coloration.

### Fichiers hors-scope
- `src/features/syncFolder.ts`, `syncVault.ts`, `syncNote.ts`, `auditLinks.ts`, `auditLocations.ts`, `linkNote.ts` — logique pré-existante, hors du lot du 2026-09-04, déjà couverte par les audits précédents (voir `NEXT_SESSION.md` Rappels actifs/Backlog).

## Écarts

Aucun. Audit exécuté intégralement, classification complète consignée dans `audits/AUDIT_settings-ergonomics.md` — aucun écart trouvé nécessitant un plan de fix (tous les comportements figés identifiés sont soit déjà configurables, soit explicitement justifiés comme détail interne). Pas de plan principal à écrire (§3bis étape 5 sans objet, aucune cause racine confirmée).
