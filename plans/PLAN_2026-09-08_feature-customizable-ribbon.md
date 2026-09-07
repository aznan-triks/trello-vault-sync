type: feature
init: light (contexte déjà chargé cette session — CONTEXT.md, NEXT_SESSION.md, grep ciblé registry.ts/main.ts/settings/types.ts/SettingsTab.ts)
Terminé quand : `npm run check` vert (typecheck + tests incluant la normalisation de `ribbonCommandIds`) ; réglages → nouvelle section "Ribbon icons" avec une case à cocher par commande ; passage réel dans `test-vault/` documenté (cocher/décocher change le ruban après sauvegarde, sans redémarrage).
État actuel observé : N/A (nouvelle fonctionnalité, pas un domaine cassé)
Ressources consultées : `src/commands/registry.ts` (COMMANDS, source unique) ; `src/main.ts:25,277-284` (RIBBON_COMMAND_IDS figé, registerRibbon()) ; `src/settings/types.ts` (forme des réglages) ; `src/settings/SettingsTab.ts` (patron `addToggle` déjà utilisé pour Advanced/Behaviour, réutilisé tel quel)
Décision : étend `TrelloVaultSyncSettings` (nouveau champ `ribbonCommandIds: string[]`) ; étend `SettingsTab.ts` (nouvelle section, une case à cocher par commande de `COMMANDS`, groupée par section) ; étend `main.ts` (`registerRibbon()`/nouveau `rebuildRibbon()` lisant `settings.ribbonCommandIds`, appelé aussi après chaque `saveSettings()`)
Valeurs fixes introduites : `ribbonCommandIds: string[]`, défaut = `["sync-active-note", "sync-vault", "sync-all-mappings", "audit-links"]` (les 4 actuels, `sync-mapping` → `sync-all-mappings` sur demande explicite) — dans `src/settings/types.ts`
Périmètre — IN : réglage persisté, UI à cocher, reconstruction du ruban sans redémarrage
Périmètre — OUT : réordonnancement drag-and-drop (ordre = ordre du registry, filtré) ; personnalisation des icônes elles-mêmes

### Scénario utilisateur
- Nominal : coche "Push to Trello (active note)", décoche "Audit links" dans réglages → sauvegarde → ruban mis à jour immédiatement.
- Échec : aucune commande cochée → seul le bouton fixe d'ouverture du panneau latéral reste, pas de crash.

### Réutilisation
- Patron `addToggle` (déjà dans `SettingsTab.ts`/`SidebarView.ts`) réutilisé tel quel — pas de nouveau composant UI.

### Cas de test critiques
- Happy path : 2 ids valides dans `ribbonCommandIds` → 2 boutons + bouton fixe.
- Erreur 1 : id qui n'existe plus dans `COMMANDS` (settings d'une version antérieure) → filtré silencieusement dans `registerRibbon`/`rebuildRibbon`, pas de crash (changement de comportement assumé : l'ancien `RIBBON_COMMAND_IDS` figé throwait sur un id inconnu car c'était une erreur de dev ; un `ribbonCommandIds` piloté par l'utilisateur doit tolérer un id devenu obsolète).
- Erreur 2 : `ribbonCommandIds` absent/corrompu (pas un tableau, réglages v1.7.0 existants) dans `normalizeSettings` → retombe sur le défaut. Un tableau vide (`[]`, l'utilisateur a tout décoché) n'est PAS une valeur corrompue et doit être conservé tel quel.

## Phases livrées

Implémentation complète (code + tests), exécutée le 2026-09-08 :

- `src/settings/types.ts` : `ribbonCommandIds: string[]` (défaut `["sync-active-note", "sync-vault", "sync-all-mappings", "audit-links"]`), normalisation dans `normalizeSettings` (tableau non-tableau → défaut ; entrées non-string filtrées ; tableau vide conservé tel quel — pas traité comme corrompu).
- `src/commands/registry.ts` : `ALL_SECTIONS: CommandSection[]` exporté (voir Écarts — ajouté après coup, hors périmètre initial de ce plan).
- `src/settings/SettingsTab.ts` : `renderRibbon()`, une case à cocher (`addToggle`) par commande de `COMMANDS`, groupée par `ALL_SECTIONS`.
- `src/main.ts` : `RIBBON_COMMAND_IDS` retiré ; `rebuildRibbon()` (retire les icônes configurables trackées, recrée depuis `settings.ribbonCommandIds`, filtre silencieusement un id absent de `COMMANDS`) ; appelé depuis `registerRibbon()` (chargement) et `saveSettings()` (après toute sauvegarde de réglages).
- `tests/settings.test.ts` : 5 tests neufs sur `ribbonCommandIds` (défaut, tableau vide conservé, id obsolète conservé par `normalizeSettings` — filtré seulement à la construction du ruban —, fallback si non-tableau, entrées non-string filtrées).
- `npm run check` vert (typecheck + 344 tests + build) ; greps §8 (isolation, résidu français, référence morte à `RIBBON_COMMAND_IDS`) tous conformes.

## Écarts

- **`ALL_SECTIONS` extrait dans `registry.ts`, hors périmètre initial de ce plan** — la revue de code (Standards axis) a signalé que `SettingsTab.renderRibbon()` dupliquait littéralement la constante `SECTIONS`/le filtre par section déjà présents dans `src/ui/SidebarView.ts` (§8, duplication). Corrigé en extrayant une constante unique `ALL_SECTIONS` dans `commands/registry.ts`, consommée par les deux fichiers — `SidebarView.ts` modifié en conséquence bien que hors du scope initialement décrit par ce plan.
- **CHANGELOG.md corrigé après une première rédaction erronée** — l'entrée "due date" du CHANGELOG (feature d'un autre plan, `PLAN_2026-09-06_feature-due-date-frontmatter.md`) avait été rédigée avec une clé de frontmatter (`trello_due_date`) et un réglage (`dueDateField`) qui n'existent pas dans le code réellement livré (clé réelle : `trello_due`, aucun réglage). Repéré par la revue de code (axes Standards et Spec, indépendamment) et corrigé.
- **Passage réel `test-vault/` non fait** — même limite que les 2 autres plans livrés cette session (`PLAN_2026-09-06_feature-due-date-frontmatter.md`, `PLAN_2026-09-06_fix-cancellation-timeout.md`) : pas d'accès à une instance Obsidian dans cette session. Cocher/décocher une commande dans "Ribbon icons" et vérifier que le ruban se met à jour sans redémarrer reste à valider par un humain. Le fichier n'est donc pas renommé avec le préfixe ✅.
