type: feature
init: light
Terminé quand : `npm run check` vert (typecheck strict + suite Vitest existante + nouveaux tests `excludeFolders`/`syncVault`/`auditLinks`/`auditLocations` avec exclusion, aucune régression + build `main.js`) ET greps §8 passés ET build déployé dans `test-vault/` (passage réel documenté si l'accès écran redevient possible cette session, sinon noté en Écarts comme pour le sous-plan 1 — accès refusé constaté, blocage transversal consigné dans NEXT_SESSION.md).
État actuel observé : N/A — feature, pas un domaine signalé cassé (§3bis ne s'applique pas).
Ressources consultées :
- `src/core/fileName.ts` (`notesInFolder`) : filtre par préfixe déjà utilisé par les deux gateways — même forme exacte nécessaire pour l'exclusion, mais structurellement inverse (garder un préfixe vs retirer plusieurs préfixes) → fonction sœur, pas une extension de `notesInFolder`.
- `src/obsidian/gateway.ts` (`VaultGateway.listNotes(folder)`) : unique point d'interface, implémenté à l'identique par `ObsidianVault.ts` et `tests/fakes.ts` (`FakeVault`) via `notesInFolder`.
- `src/features/syncVault.ts`, `auditLinks.ts`, `auditLocations.ts` : les 3 call-sites `vault.listNotes(options.scope / target.scope)` — portée déjà validée par l'utilisateur dans `NEXT_SESSION.md` (feuille de route, sous-plan 2).
- `src/features/syncFolder.ts` (`vault.listNotes(mapping.folder)` l.99, `vault.listNotes("")` l.261) : **hors scope** — un mapping dossier↔liste est une cible 1:1 déjà choisie explicitement par l'utilisateur, le blacklist n'a pas vocation à créer un trou dedans ; `NEXT_SESSION.md` ne liste que syncVault/auditLinks/auditLocations.
- `src/features/auditShared.ts` (`AuditOptions`) : partagé par les deux audits, seul endroit à étendre pour eux deux à la fois.
- `src/settings/types.ts` (`TrelloVaultSyncSettings`, `normalizeSettings`, `normalizeVaultPath`) : où vit toute valeur configurable (§1.4).
- `src/settings/SettingsTab.ts` (`renderScope`, champ "Synced folder") : voisin naturel du nouveau champ.
Décision :
- Étend `src/core/fileName.ts` : nouvelle fonction pure `excludeFolders(handles, excluded)`, sœur de `notesInFolder`, testée Vitest.
- Étend `VaultGateway.listNotes(folder, excludedFolders?)` (interface `obsidian/gateway.ts`, implémentations `ObsidianVault.ts` et `tests/fakes.ts`) — un seul point d'implémentation par gateway.
- Étend `settings/types.ts` : `excludedFolders: string[]` dans `TrelloVaultSyncSettings`/`DEFAULT_SETTINGS`/`normalizeSettings` (chaque entrée passée par `normalizeVaultPath`, entrées vides filtrées).
- Étend `features/syncVault.ts` (`VaultSyncScope`) et `features/auditShared.ts` (`AuditOptions`) : `excludedFolders: string[]`, threadé jusqu'à `vault.listNotes()`.
- Étend `commands/syncCommands.ts` (`syncAllLinked`) et `main.ts` (`auditOptions()`) pour peupler ce champ depuis `ctx.settings.excludedFolders`.
- Étend `settings/SettingsTab.ts` `renderScope()` : nouveau champ `addTextArea` (un dossier par ligne), juste après "Synced folder".
- Réutilise `notesInFolder` tel quel, aucune modification.
Valeurs fixes introduites : 0.
Périmètre — IN :
- Nouveau réglage `excludedFolders: string[]`, éditable dans l'onglet réglages (section Scope).
- Exclusion appliquée à `syncVault` (Sync all linked notes), `auditLinks`, `auditLocations`.
- Une note dont le chemin commence par `<dossier exclu>/` est ignorée par ces 3 opérations.
Périmètre — OUT :
- `syncFolder`/`syncAllMappings` (mapping dossier↔liste explicite) — voir justification ci-dessus.
- Pas d'autocomplete façon `VaultPathSuggest` pour ce champ — un `textarea` simple, une ligne = un dossier (KISS).
- Pas de validation d'existence du dossier à la saisie (même garantie que "Synced folder" aujourd'hui).

### Scénario utilisateur

**Nominal** : l'utilisateur ajoute "Archive" dans les dossiers exclus → "Sync all linked notes" et les deux audits ignorent désormais toute note sous `Archive/`, même liée à une carte.

**Échec** : liste vide (défaut) → comportement strictement identique à avant ce sous-plan, aucune régression.

### Réutilisation

Composant existant le plus proche : `notesInFolder` (filtre par préfixe). Non étendu directement — inversion structurelle du filtre (garder un préfixe vs en retirer plusieurs), donc fonction sœur avec sa propre signature.

### Cas de test critiques

1. `excludeFolders(handles, ["Archive"])` retire toute entrée sous `Archive/`, garde le reste.
2. `excludedFolders` vide → identité, aucun filtrage.
3. Dossier exclu qui ne matche aucune note → aucun effet, pas d'erreur.
4. Intégration (`syncVault`) : note sous un dossier exclu et liée à une carte → absente des stats, ni pull ni push, pas de régression sur les notes hors exclusion.

## Phases

1. TDD core : `excludeFolders` (`core/fileName.ts` + test rouge→vert) ; `settings/types.ts` (`excludedFolders` + normalisation + test si applicable).
2. `VaultGateway.listNotes(folder, excludedFolders?)` : interface, `ObsidianVault`, `FakeVault` ; puis TDD features (`syncVault`, `auditLinks`, `auditLocations` avec cas d'exclusion).
3. Threading couche commande (`syncCommands`, `main.ts` `auditOptions()`) + UI réglages (`SettingsTab.renderScope`) + `npm run check` + greps §8 + déploiement `test-vault/` + clôture (§5).

## Écarts

- **Preuve visuelle (§10) toujours impossible** : même blocage transversal que le sous-plan 1 (`request_access` Obsidian refusé). Le champ "Excluded folders" dans l'onglet réglages n'a pas été vérifié à l'écran (sauvegarde/rechargement, thème dark/light). Code + `npm run check` (228 tests, +11 vs sous-plan 1) + déploiement `test-vault/` faits.
- **code-review (§7)** : 2 sous-agents Standards/Spec. 1 finding retenu et corrigé (duplication de la normalisation `folder → prefix` entre `notesInFolder` et `excludeFolders`, extraite en `folderPrefix()`). 2 findings notés comme judgement calls acceptés sans changement : léger chaînage `excludeFolders(notesInFolder(...))` dans `ObsidianVault.listNotes` (lisibilité jugée suffisante, deux règles pures composées) ; `syncAllLinked` continue d'assembler `VaultSyncScope` en littéral inline plutôt que via un nouveau builder `ctx.*Options()` (cohérent avec le fait qu'aucun builder de ce genre n'existait déjà pour ce cas précis — ajouter une abstraction pour un seul appelant aurait été de la Speculative Generality).
- Spec review : aucun écart trouvé (couverture complète des 4 cas de test, aucun scope creep dans `syncFolder`/`syncAllMappings`).
- Version bumpée en 1.5.1 (PATCH — extension d'un domaine existant, pas de nouvelle commande).

## Phases livrées

Phases 1, 2 et 3 complètes en code (`npm run check` vert, greps §8 passés, déploiement `test-vault/` fait). Pas de renommage `✅` : la vérification manuelle du champ réglages (sauvegarde/rechargement, dark/light) reste non prouvée visuellement — même blocage que le sous-plan 1.

## Clôture (2026-09-11)

Renommé `✅` rétroactivement : `excludedFolders` confirmé présent et câblé dans le code actuel (`settings/types.ts`, `SettingsTab.ts`, `syncVault.ts`, `auditLinks.ts`, `auditLocations.ts`, `auditShared.ts` — grep fait). La preuve visuelle stricte du "Terminé quand" (dark/light, sauvegarde/rechargement du champ réglages) n'a toujours pas été montrée à l'utilisateur explicitement pour ce champ précis — écart résiduel, mais le fichier plan restait orphelin depuis 3 sessions alors que le domaine (Scope/Settings) a depuis été revérifié visuellement à plusieurs reprises (v1.9.0-1.9.2). Fermé sur confirmation explicite de l'utilisateur (2026-09-11, "fais les écarts, débrouille-toi").
