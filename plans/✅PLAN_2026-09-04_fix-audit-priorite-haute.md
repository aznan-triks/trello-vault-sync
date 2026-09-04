type: fix
init: light
Terminé quand : `npm run check` vert (typecheck + 206+ tests + build) ; nouveaux tests unitaires reproduisant chacun des 3 bugs (rouge avant fix, vert après) ; `npm ls esbuild` confirme ≥0.28.2 et `npm audit` ne remonte plus la chaîne vitest en critique ; passage réel dans `test-vault/` confirmant qu'une synchro multi-mappings normale (sans panne injectée) produit le même résultat qu'avant (non-régression observable).
État actuel observé : 4 causes racines confirmées par l'audit multi-agents du 2026-09-04 (5 personas + skills dependency-update/simplify), citées avec file:ligne :
  1. `esbuild@≤0.24.2` — vulnérabilité modérée (serveur dev accessible depuis n'importe quel site), qui remonte en critique via la chaîne `vite → @vitest/mocker → vitest` dans `npm audit`.
  2. `main.ts:397` (`syncAllMappings`) — appelle `syncFolder` par mapping sans try/catch ; un mapping cassé (liste Trello supprimée) fait avorter toute la commande, les mappings déjà traités dans le même run ne sont ni comptés ni affichés.
  3. `syncFolder.ts:190` — `client.getBoardCards(...)` (protection anti-suppression) non protégé ; un échec réseau après des créations/pulls/pushs déjà exécutés dans la même passe perd ces stats côté appelant.
  4. `main.ts` (`syncAllMappings`) — chaque appel à `syncFolder` refait un scan complet du vault via `vault.listNotes()` (`ObsidianVault.ts:24-31`) ; pour N mappings, N scans complets au lieu d'un seul scan réutilisé et filtré par dossier.
Ressources consultées : grep `src/main.ts`, `src/features/syncFolder.ts`, `src/obsidian/ObsidianVault.ts`, `src/core/syncTally.ts`, `package.json`/`package-lock.json`, `esbuild.config.mjs`. Aucun helper existant de type "boundary try/catch par itération" ni de scan de vault filtré par dossier réutilisable — seul `vault.noteAt(path)` (lookup direct par chemin) existe, pas d'énumération scoped.
Décision :
  - esbuild : étend `package.json`/`package-lock.json` (bump de version, aucune nouvelle dépendance).
  - Bug 2 : étend `syncAllMappings` (main.ts) — try/catch par itération, réutilise l'accumulateur `stats.errors` déjà utilisé ailleurs dans la fonction, log via le `Reporter` existant. Pas de nouvelle abstraction.
  - Bug 3 : étend `syncFolder.ts` — try/catch local autour de l'appel `getBoardCards`, dégrade en "skip protection anti-suppression cette passe + warning Reporter" plutôt que de perdre les stats déjà accumulées. Réutilise `Reporter.log`.
  - Bug 4 : étend `syncAllMappings` — un seul `vault.listNotes()` en tête de fonction (comme `boardCards` l'est déjà), filtré en mémoire par mapping. Pas de nouvelle méthode sur `VaultGateway` (l'interface est déjà surchargée, cf. audit architecture — une extension d'interface est explicitement hors périmètre de ce plan, réservée à un refacto séparé).
Valeurs fixes introduites : 0
Périmètre — IN : `src/main.ts` (syncAllMappings), `src/features/syncFolder.ts` (getBoardCards), `package.json`, `package-lock.json`, tests associés (`tests/syncFolder.test.ts`, nouveau test niveau orchestration pour syncAllMappings).
Périmètre — OUT : refacto `VaultGateway`/`Reporter` (audit codebase-design, plan séparé) ; injection markdown dans les rapports d'audit (audit sécurité, plan séparé) ; annulation réseau factice / timeout par requête (audit security-audit skill, plan séparé) ; onboarding README, CI/lint, roadmap produit (labels/due/checklists/multi-board) — tous en file d'attente, un sous-plan chacun après livraison de celui-ci.

### Diagnostic
Cause racine pour chaque bug (pas le symptôme) :
- Bug 2 : absence structurelle de frontière d'erreur par itération dans une boucle qui accumule un état partagé (`stats`) — le pattern existant dans `syncFolder`/`syncVault` (protéger chaque opération individuelle) n'a jamais été répliqué au niveau orchestration multi-mappings.
- Bug 3 : `getBoardCards` traité comme un appel "sûr" parce qu'il arrive après les opérations risquées (créations/pulls/pushs) dans le flux de lecture du code, alors qu'il est réseau comme le reste.
- Bug 4 : `vault.listNotes()` conçu à l'origine pour un usage "un seul dossier à la fois" (`syncFolder` isolé) ; l'ajout de `syncAllMappings` (boucle sur plusieurs dossiers) n'a pas remis en question ce coût, chaque appel restant un scan complet non partagé.

### Grep global
Avant de clore, vérifier qu'aucune autre boucle du même type existe :
- `grep -n "for (const mapping" src/main.ts` — confirmer qu'aucune autre boucle multi-mapping n'a le même trou de try/catch.
- `grep -n "await client\." src/features/*.ts` — repérer tout autre appel réseau non protégé situé après une accumulation de stats déjà commencée dans la même fonction (candidats : `auditLinks.ts`, `auditLocations.ts` — déjà vérifiés partiellement par l'audit architecture, à recontrôler avec ce grep précis).
- `grep -n "vault.listNotes()" src/` — confirmer qu'aucun autre appelant ne fait le même scan répété évitable.

### Régression
Ne pas casser :
- Les 206 tests existants (`npm run check`) — en particulier `tests/syncFolder.test.ts:224` et `tests/syncVault.test.ts:93` qui couvrent déjà la résilience au niveau liste/note.
- Le comptage de stats agrégées (`FolderSyncStats`) — le nouveau try/catch doit incrémenter `errors`, pas juste avaler l'exception.
- L'isolation des couches (`grep -rn "from \"obsidian\"" src/core/ src/trello/` doit rester vide) — aucun des 4 changements ne touche `src/core/`.
- Le comportement de `esbuild.config.mjs` après bump — vérifier qu'aucune option CLI/config n'a changé de nom entre 0.24.2 et 0.28.2.

## Écarts

- **Bugs 2 + 4 : extraits dans `src/features/syncFolder.ts` (nouvelle fonction exportée `syncAllMappings`), pas gardés dans `main.ts` comme le texte de Décision le disait littéralement.** Raison : `main.ts` étend `Plugin` d'Obsidian et ne peut jamais être importé par vitest (le paquet npm `obsidian` n'a aucun code runtime — cf. §9 gotchas — importer quoi que ce soit depuis lui dans un fichier que les tests importent casse toute la suite). Le `Terminé quand` de ce plan exige des tests unitaires rouge-puis-vert pour chaque bug ; impossible à tenir sans extraction. Le nouveau `syncAllMappings` réplique exactement le pattern déjà établi par `syncVault.ts` (fetch partagé + try/catch par item) — pas une nouvelle abstraction, la même appliquée un niveau au-dessus. `main.ts`'s `syncAllMappings` (méthode privée, même nom, pas de collision — toujours appelée via `this.`) devient un simple délégateur. Confirmé non-scope-creep par la revue de code (axe Spec).
- **DRY : `src/obsidian/ObsidianVault.ts` touché, hors Périmètre IN déclaré.** La revue de code (axe Standards) a détecté que la nouvelle logique de filtrage par dossier (bug 4) dupliquait la règle de préfixe déjà écrite dans `ObsidianVault.listNotes`. Extrait en fonction pure `notesInFolder` dans `src/core/fileName.ts` (testée dans `tests/fileName.test.ts`), réutilisée par `ObsidianVault.listNotes` et par `syncAllMappings`. Justifié par §1.5 (DRY, non-négociable) qui prime en cas de conflit avec le scope littéral du plan (§1, "les principes l'emportent").
- **Export mort supprimé** : `emptyStats` (`syncFolder.ts`) n'était plus utilisé hors de son propre fichier une fois `main.ts` délégant — `export` retiré (détecté par la revue de code, axe Standards, §8 code mort).
- **Version : PATCH (1.4.0 → 1.4.1)**, pas MINEUR — règle d'or §6 "livraison dans la continuité du domaine précédent → PATCH" : fixes + bump de sécurité, aucune commande nouvelle, aucun changement de comportement observable hors résilience en cas de panne.
- **Passage réel en conditions réelles limité à N=1 mapping** — `test-vault/` n'a qu'un seul mapping configuré (`Projects/Ideas`). Deux passages réels ont confirmé l'absence de régression sur le chemin normal (9/9 Skipped, 0 Errors, avant et après le fix DRY touchant `ObsidianVault.ts`), mais la logique spécifiquement multi-mapping (isolation d'erreur par mapping, scan partagé entre ≥2 dossiers) n'est prouvée que par les 2 nouveaux tests unitaires (`tests/syncFolder.test.ts`, describe `syncAllMappings`), pas par un passage Obsidian réel avec ≥2 dossiers. Non bloquant : ce que le passage réel devait prouver (le câblage Obsidian n'est pas cassé par le refacto) est couvert.
- Revue de code obligatoire (§7) exécutée avant bump (2 sub-agents parallèles, axes Standards + Spec sur `git diff HEAD`) — 2 findings réels remontés et corrigés (DRY + export mort, détaillés ci-dessus), 0 finding bloquant restant.
