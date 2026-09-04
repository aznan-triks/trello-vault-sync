type: fix
init: light
Terminé quand : resolveConflict passe par ctx.run() (comme syncActive/linkActive) ; npm run check vert ; passage réel test-vault (note en conflit + note sans conflit + note non liée) sans régression.
État actuel observé : try/catch manuel dans resolveConflict — pas de console.error, ctx.client() sans reporter (main.ts:169 vs noteCommands.ts:76-78).
Ressources consultées : noteCommands.ts (syncActive/linkActive comme patron), main.ts (ctx.run, chemin d'erreur unifié).
Décision : étend resolveConflict pour utiliser ctx.run — aucun nouveau fichier/fonction.
Valeurs fixes introduites : 0
Périmètre — IN : noteCommands.ts::resolveConflict uniquement.
Périmètre — OUT : TrelloPickerSuggest.ts / SettingsTab.ts (catches différents, hors ctx.run, non signalés dans le backlog).

### Diagnostic
Cause racine : `resolveConflict` a été écrit avant l'extraction `src/commands/` avec son propre wrapper, jamais aligné sur le patron `ctx.run` que les autres commandes suivent.

### Grep global
`grep -n "catch (error)" src/` — 2 autres occurrences sans `console.error` trouvées (`TrelloPickerSuggest.ts`, `SettingsTab.ts`), toutes deux hors `ctx.run`/réseau de commande (suggestions de réglages), donc hors périmètre — non signalées dans le backlog.

### Régression
Le modal de conflit s'ouvre toujours bien ; `syncActive` déclenché depuis le modal fonctionne (déjà couvert par son propre `ctx.run`).

Pas de test unitaire possible (fichier exclu de `tests/` — importe `obsidian`, cf. §9 CONTEXT.md) : validation par passage réel uniquement.

## Écarts

- `npm run check` vert (214 tests, typecheck, build) — confirmé.
- Passage réel dans `test-vault/` fait pour 2 des 3 cas prévus : note non liée (`Bienvenue.md` → "Not linked to a Trello card.") et note liée sans conflit (`Projects/Ideas/2.md` → panneau "Check conflict — 2" + "No conflict on this note — nothing to resolve."). Les deux confirment que `ctx.run`/`client(reporter)` fonctionnent après le changement.
- Cas "conflit réel" **non reproduit** : la fixture `Projects/Ideas/1.md` (prévue pour ça, cf. note du 2026-09-03) ne déclenche plus de conflit — écart de mtime entre la note locale et la carte Trello sorti de la marge configurée depuis la session précédente. Forcer un nouveau conflit aurait exigé de modifier la carte Trello via l'API en dehors de ce fix, jugé hors périmètre sans accord explicite. Le code du branchement `conflict` (ouverture de `ConflictModal`) est inchangé par ce fix — seulement déplacé dans le callback `ctx.run` — donc le risque résiduel est faible, mais ce n'est pas une preuve d'exécution réelle du chemin conflit.
