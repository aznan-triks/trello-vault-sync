type: feature
init: full
Terminé quand : `npm run check` vert (typecheck strict + suite Vitest existante, aucune régression + build `main.js`) ET passage réel documenté dans `test-vault/` (icône ribbon ouvre le panneau dans la barre latérale droite par défaut, chacun des 11 boutons déclenche la même commande que son entrée dans la palette — vérifié un par un, pas juste au clic) ET checklist §10 de CONTEXT.md cochée avec capture d'écran montrée à l'utilisateur (thème dark/light, panneau ne recouvre pas un élément essentiel).
État actuel observé : N/A — feature, pas un domaine signalé cassé (§3bis ne s'applique pas).
Ressources consultées :
- `src/main.ts` (`registerCommands`/`registerRibbon`) : **11 commandes déclarées, 4 seulement ont une icône ribbon** (`sync-active-note` alias `refresh-cw`, `sync-vault` alias `kanban-square`, `sync-mapping` alias `folder-sync`, `audit-links` alias `search`). Les 7 autres (`pull-active-note`, `push-active-note`, `link-active-note`, `resolve-conflict`, `sync-all-mappings`, `audit-locations`, `toggle-dry-run`) ne sont accessibles que par la palette de commandes.
- `src/commands/{noteCommands,syncCommands,auditCommands}.ts` : chaque handler prend déjà `ctx: CommandContext` en seul paramètre — le panneau latéral peut appeler exactement les mêmes fonctions que `main.ts`, aucune logique dupliquée.
- `src/commands/context.ts` (`CommandContext`) : `ctx.ready()`, `ctx.run()`, `ctx.settings` déjà exposés — le panneau peut réutiliser l'état "credentials manquantes" sans réimplémenter la validation.
- `src/ui/ProgressPanel.ts` + `styles.css` : seul précédent de widget custom dans le plugin — même convention à suivre (classes `tvs-*`, variables CSS `--background-*`/`--text-*` du thème Obsidian, pas de couleur en dur).
- Legacy `trello_location_audit.js` (`[redacted]`, fourni en référence par l'utilisateur) : confirme que "Comparer avec Trello" = la commande `audit-locations` déjà portée dans `auditLocations.ts` — aucune logique manquante, seulement un accès UI manquant. Le panneau latéral referme ce point sans nouveau code métier.
Décision :
- Crée `src/ui/SidebarView.ts` — nouveau, aucun fichier existant ne couvre une vue persistante de barre latérale (`ProgressPanel` est un widget flottant éphémère, rôle différent).
- Étend `src/main.ts` : `registerView(VIEW_TYPE_TVS_SIDEBAR, ...)` + un ribbon icon pour l'ouvrir + détachement des leaves dans `onunload()`.
- Étend `styles.css` : nouvelles classes `tvs-sidebar__*`, même convention de variables que `tvs-panel__*`.
- Réutilise telles quelles les 11 fonctions de `src/commands/*.ts` — aucune n'est réécrite.
Valeurs fixes introduites : `VIEW_TYPE_TVS_SIDEBAR = "trello-vault-sync-sidebar"` — identifiant technique interne à l'API Obsidian (clé d'enregistrement de vue), pas une valeur de configuration utilisateur. Pas d'entrée `src/settings/types.ts` requise pour cette valeur précise (voir justification §1.8 : un identifiant technique n'est pas un "nombre/chemin/URL/seuil/délai/libellé configurable" au sens de la règle no-hardcode).
Périmètre — IN :
- `ItemView` Obsidian ouverte par défaut dans la barre latérale droite (`workspace.getRightLeaf(false)`), un ribbon icon dédié pour l'ouvrir/la révéler si déjà ouverte.
- Un bouton par commande existante (11), regroupés par section : **Note active** (sync / pull / push / link / resolve conflict), **Dossiers** (sync one mapping / sync all mappings), **Coffre** (sync all linked / audit links / audit locations), **Réglages** (toggle dry-run — affiché comme un switch synchronisé avec `ctx.settings.dryRun`, pas un bouton one-shot).
- État "credentials manquantes" : réutilise `ctx.ready()` — si non prêt, message clair + lien vers l'onglet réglages au lieu de boutons qui échoueraient silencieusement.
- Icônes Lucide cohérentes avec celles déjà choisies pour les ribbon icons existants (mêmes noms d'icône que `registerRibbon` quand une commande a déjà une icône assignée).
Périmètre — OUT :
- Pas de journal persistant dans le panneau à cette étape (sous-plan "logging" suivant, qui viendra étendre cette même vue).
- Pas de couleurs au-delà de ce que le thème Obsidian donne déjà par défaut (sous-plan "couleurs" suivant).
- Pas de bouton pour "Audit changes" (n'existe pas encore — sous-plan dédié, qui ajoutera son propre bouton dans la section Coffre à ce moment-là).
- Pas d'ouverture automatique au chargement du plugin (convention Obsidian : l'utilisateur ouvre la vue via le ribbon, comme les autres plugins).
- Pas de redesign de l'onglet réglages (sous-plan "couleurs" suivant).

### Scénario utilisateur

**Nominal** : l'utilisateur clique sur l'icône ribbon "Trello Vault Sync" → le panneau s'ouvre dans la barre latérale droite (ou se révèle s'il existe déjà, pas de doublon) → il voit les sections avec tous les boutons → il clique "Sync all mappings" → le comportement est identique à `Cmd/Ctrl+P → Sync every list with its folder` (même `ProgressPanel` flottant apparaît, même résultat).

**Échec** : credentials Trello absentes des réglages → le panneau affiche un état "Configurer Trello Vault Sync dans les réglages" au lieu de boutons actifs, cohérent avec `ctx.ready()` qui bloque déjà les commandes existantes (`new Notice` d'avertissement).

### Réutilisation

Composant existant le plus proche : `ProgressPanel` (`src/ui/ProgressPanel.ts`) pour la convention de code/CSS (classes `tvs-*`, variables de thème). Non réutilisé directement — `ProgressPanel` est un widget flottant `document.body.createDiv` détaché du cycle de vie Obsidian, alors qu'`ItemView` doit s'intégrer au `WorkspaceLeaf` (persistance entre sessions, layout sérialisé). Les deux coexistent : le panneau latéral déclenche les mêmes commandes qui ouvrent, elles, le `ProgressPanel` flottant pendant leur exécution.

### Cas de test critiques

Cette feature est de la plomberie UI pure (délégation à des commandes déjà testées) : `src/ui/*.ts` n'est jamais importé par `tests/` (§9 CONTEXT.md, package `obsidian` sans runtime), donc pas de test Vitest possible sur `SidebarView.ts` lui-même — seule la preuve d'exécution réelle documentée dans "Terminé quand" fait foi ici (§1.7). Aucune logique pure nouvelle n'est introduite (pas de nouveau module `core/`) : TDD (§7) n'a donc pas de cible applicable pour cette feature précise — écart justifié explicitement ici conformément à §1.8.

Vérification manuelle à documenter (remplace les cas de test automatisés) :
1. Panneau ouvert deux fois de suite via le ribbon → une seule instance, pas de doublon de leave.
2. Chaque bouton déclenche exactement la commande de même nom dans la palette (comparaison résultat à résultat).
3. Sans credentials → état bloquant affiché, aucun bouton ne lance de requête réseau.
4. Toggle dry-run dans le panneau ↔ reflète et modifie `ctx.settings.dryRun` (vérifié dans les deux sens : cocher dans le panneau change le réglage, changer le réglage dans l'onglet réglages met à jour le panneau si ouvert).

## Phases

1. Squelette `ItemView` : enregistrement (`registerView`), ribbon icon, ouverture/révélation dans la barre latérale droite, titre, détachement propre dans `onunload`.
2. Sections et 11 boutons câblés sur les commandes existantes + toggle dry-run synchronisé.
3. État "credentials manquantes" + vérification manuelle des 4 cas de test critiques + checklist §10.

## Écarts

- **Preuve visuelle (§10) impossible cette session** : `request_access` (computer-use) sur Obsidian a été **refusé par l'utilisateur** (`user_denied`). Aucune capture d'écran montrée, donc les 4 cas de test manuels du plan (doublon de leave, bouton = commande palette, blocage sans credentials, toggle dry-run bidirectionnel) et la checklist §10 (dark/light, chevauchement UI) restent **non vérifiés visuellement** — seulement par lecture de code. Le build est déployé dans `test-vault/.obsidian/plugins/trello-vault-sync/` (`npm run check` vert, 217 tests, build à jour), prêt pour une vérification manuelle dès qu'un accès écran (ou un retour de l'utilisateur lui-même dans Obsidian) est possible.
- **code-review (§7) exécutée en 2 sous-agents parallèles (Standards/Spec)** sur le diff non commité, comme prévu. 3 findings retenus et corrigés avant le bump :
  1. Duplication de la vérification credentials (`apiKey`/`token`) entre `ready()` et le panneau → extraite en `hasCredentials()` (`src/settings/types.ts`), réutilisée aux deux endroits.
  2. Duplication des 11 déclarations de commande (id/nom/icône) entre `main.ts` et `SidebarView` → extraite en `src/commands/registry.ts`, seule source, consommée par les deux.
  3. Lien manquant vers l'onglet réglages dans l'état "credentials manquantes" → bouton "Open settings" ajouté (`App.setting`, typé localement, pas de `any`).
- **TDD (§7) sans cible applicable** : justifié inline dans l'en-tête du plan (§ "Cas de test critiques") — aucune logique `core/` nouvelle, `src/ui/`/`src/commands/registry.ts` non importés par `tests/`.
- Version bumpée en 1.5.0 (MINEUR — nouvelle architecture UI persistante), v1.4.6 toujours en attente de push (voir NEXT_SESSION.md).

## Phases livrées

Phases 1 et 2 complètes (code + `npm run check` vert). Phase 3 partielle : l'état "credentials manquantes" est codé, mais la vérification manuelle des 4 cas de test et la checklist §10 n'ont **pas** pu être exécutées (accès écran refusé — voir Écarts). Pas de renommage `✅` : le "Terminé quand" du plan exige explicitement une preuve visuelle montrée à l'utilisateur, non satisfaite cette session.
