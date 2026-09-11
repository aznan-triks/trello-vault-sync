# PLAN — Fix des 3 errors du code review v1.10.1

```
type: fix
init: light
Terminé quand :
  - `grep -n "detachLeavesOfType" src/main.ts` → aucun résultat
  - `grep -rn "\.style\." src/` → aucun résultat
  - `node -p "require('./manifest.json').minAppVersion"` → 1.7.2, et `versions.json` contient une entrée `"1.10.2": "1.7.2"`
  - `npm run check` au vert (typecheck + tests + build + check:hardcode), sortie montrée
État actuel observé : 3 errors confirmées par lecture directe du code —
  (1) `src/main.ts:44` appelle `this.app.workspace.detachLeavesOfType(VIEW_TYPE_TVS_SIDEBAR)` dans `onunload()` ;
  (2) `manifest.json` déclare `minAppVersion: "1.5.0"` alors que le code compile contre `obsidian@^1.7.2`
      et utilise `Workspace.revealLeaf` en version asynchrone (`await`, async depuis 1.7.2),
      `Vault.getAllFolders` (`SettingsTab.ts:70`) et `FileManager.processFrontMatter` (`ObsidianVault.ts:55`) ;
  (3) `src/ui/ProgressPanel.ts:158` et `:174` assignent `this.barEl.style.transform` en direct.
Ressources consultées : `src/main.ts`, `manifest.json`, `versions.json`, `package.json`,
  `src/settings/SettingsTab.ts`, `src/obsidian/ObsidianVault.ts`, `src/ui/ProgressPanel.ts`, `styles.css`,
  `node_modules/obsidian/obsidian.d.ts` (présence de `setCssProps`, `revealLeaf: Promise<void>`, `getAllFolders`).
Décision : réutilise le patron CSS existant `.tvs-panel__bar` (variable CSS custom au lieu de style inline) ;
  supprime l'appel `detachLeavesOfType` (Obsidian nettoie lui-même les vues enregistrées via `registerView`) ;
  aligne `minAppVersion` sur la version d'API réellement utilisée. Aucun nouveau module.
Valeurs fixes introduites : 0 (la variable CSS `--tvs-progress-scale` est un détail d'implémentation
  interne du rendu de la barre, pas un réglage utilisateur — cf. §8 "Hardcode").
Périmètre — IN : les 3 errors uniquement + bump de version 1.10.2 + CHANGELOG + NEXT_SESSION.
Périmètre — OUT : les 9 warnings et les 3 recommendations du même rapport (dont `getSettingDefinitions()`,
  `FileManager.trashFile()`, `window.setTimeout`, `built-modules`) — tour suivant.
```

### Diagnostic (cause racine, pas le symptôme)

1. **Detach en `onunload`** — le plugin détache manuellement ses leaves à la décharge. Obsidian gère déjà
   le cycle de vie des vues enregistrées par `registerView` ; le détacher à la main laisse une référence
   au leaf et casse la restauration de layout au rechargement du plugin. Cause racine : cleanup redondant
   hérité d'un patron d'exemple obsolète, pas un besoin réel.
2. **`minAppVersion` périmé** — le manifest n'a jamais été bumpé alors que les dépendances d'API ont avancé
   (`obsidian@^1.7.2` dans `package.json` depuis plusieurs versions). Cause racine : `minAppVersion` traité
   comme une constante figée au lieu d'un reflet de l'API consommée.
3. **Style inline sur la barre de progression** — la progression est pilotée par `transform: scaleX(...)`
   écrit directement sur l'élément. Cause racine : le ratio est une donnée dynamique, mais elle a été
   injectée en style plutôt qu'en variable CSS, ce qui rend la règle non surchargeable par un thème.

### Grep global (même bug cherché ailleurs)

- `grep -rn "detachLeavesOfType" src/` → doit être vide après fix.
- `grep -rn "\.style\." src/` → doit être vide après fix (2 occurrences aujourd'hui, toutes dans `ProgressPanel.ts`).
- `grep -rn "setAttr(\"style\"\|cssText" src/` → doit rester vide (aucune autre voie d'injection de style).

### Régression (comportement voisin à ne pas casser)

- La barre de progression doit toujours s'animer de 0 → 1 pendant une synchro et se figer à 1 à `finish()`
  (transition CSS 0.2s conservée, couleurs done/aborted/error inchangées).
- Le panneau latéral doit toujours s'ouvrir, se révéler sans doublon (`activateSidebarView`) et survivre
  à un rechargement du plugin.
- `npm run check:hardcode` (isolation des couches) doit rester au vert : `styles.css` et `ProgressPanel.ts`
  restent dans `src/ui/`, aucune nouvelle importation.

---

## Phase 1 — Error 1 : `detachLeavesOfType` en `onunload`

`src/main.ts`, méthode `onunload()` (l. 42-45) :

```ts
	override onunload(): void {
		this.activePanel?.destroy();
	}
```

Supprimer uniquement la ligne `this.app.workspace.detachLeavesOfType(VIEW_TYPE_TVS_SIDEBAR);`.
`this.activePanel?.destroy()` reste (c'est du DOM propre au plugin, pas un leaf Obsidian).
Si `VIEW_TYPE_TVS_SIDEBAR` devient un import inutilisé dans `main.ts`, **vérifier d'abord** — il est aussi
utilisé par `registerView`, `refreshSidebarViews` et `activateSidebarView`, donc l'import doit rester.

## Phase 2 — Error 2 : `minAppVersion`

1. `manifest.json` : `"minAppVersion": "1.5.0"` → `"1.7.2"`.
2. `manifest.json` : `"version": "1.10.1"` → `"1.10.2"`.
3. `package.json` : `"version": "1.10.1"` → `"1.10.2"` (les deux restent synchronisés, §6).
4. `versions.json` : ajouter en dernière entrée `"1.10.2": "1.7.2"`. Ne pas retoucher les entrées
   historiques (elles décrivent la compatibilité des versions déjà publiées).

## Phase 3 — Error 3 : styles inline dans `ProgressPanel`

`styles.css`, règle `.tvs-panel__bar` : remplacer `transform: scaleX(0);` par
`transform: scaleX(var(--tvs-progress-scale, 0));` (le reste de la règle inchangé, commentaire au-dessus conservé).

`src/ui/ProgressPanel.ts` :
- l. 158 (`finish()`) : `this.barEl.style.transform = "scaleX(1)";`
  → `this.barEl.setCssProps({ "--tvs-progress-scale": "1" });`
- l. 174 (`renderProgress()`) : `this.barEl.style.transform = \`scaleX(${ratio})\`;`
  → `this.barEl.setCssProps({ "--tvs-progress-scale": String(ratio) });`

`setCssProps` est l'API sanctionnée d'Obsidian pour une valeur dynamique (présente dans
`node_modules/obsidian/obsidian.d.ts` l. 106/118) — elle écrit une propriété custom, pas une règle de style,
et laisse donc la règle CSS du thème maîtresse de la manière dont le ratio est rendu.

## Phase 4 — Vérification et livraison

1. `npm run check` — montrer la sortie complète (§7 `verification-before-completion`).
2. Les 3 greps de la section "Grep global" — montrer les sorties (vides attendues).
3. `CHANGELOG.md` : entrée `## [1.10.2] - 2026-09-11`, section `Fixed`, format deux voix
   (Humanisé + Technique, en anglais) pour les 3 items.
4. `NEXT_SESSION.md` : mettre à jour "État courant" + remplacer le bloc "Dernière session".
5. `CODE_REVIEW_FINDINGS_v1.10.1.md` : marquer les 3 errors comme traitées (ne pas supprimer le fichier,
   il porte encore les warnings/recommendations du tour suivant).

## Écarts

- **TDD (`CONTEXT.md` §7) non appliqué** : les 3 corrections touchent le manifeste, le cycle de vie
  du plugin et le rendu CSS — aucune n'est exerçable par la suite vitest (`src/ui/`, `src/main.ts` et
  `manifest.json` ne sont pas importables par les tests, cf. §9 : le package `obsidian` n'a pas de
  code runtime). Vérification par greps objectifs (section "Grep global") + `npm run check` au vert.
- **Exécution déléguée à un sous-agent** (haiku), à la demande explicite de l'utilisateur ; gates de
  validation levées pour cette session (« je lève les gates »). Diff relu intégralement par la session
  principale avant commit.
- **Passage réel dans Obsidian non fait** (§1.7) : la restauration du panneau latéral après rechargement
  et le rendu de la barre de progression n'ont pas été observés dans un vault. À vérifier au prochain
  déploiement `test-vault/`.
- Warnings et recommendations du même rapport volontairement hors scope (cf. `Périmètre — OUT`).
