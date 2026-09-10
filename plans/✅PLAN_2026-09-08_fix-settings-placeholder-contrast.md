type: fix
init: light
Terminé quand :
- `npm run check` vert (typecheck + tests + build) — aucune logique testable en Vitest pour ce changement (CSS pur, voir Écart TDD ci-dessous, `tests/` n'importe jamais `obsidian` et le rendu CSS ne s'exécute pas en Node).
- Passage réel `test-vault/` : un champ vide des réglages (ex. "Board id") affiche son placeholder visiblement grisé/italique, distinct d'une valeur réellement tapée, en thème clair ET en thème sombre d'Obsidian (§10). Capture d'écran montrée à l'utilisateur.

État actuel observé : aucune cause fonctionnelle — absence de style. `styles.css` ne contenait, avant ce plan, aucune règle ciblant `::placeholder`. Les 10 champs texte de `src/settings/SettingsTab.ts` (API key, token, idBoard, Projects, Archive, 2 chemins de rapport, idList, Projects/Ideas, Trello Card) dépendaient donc entièrement du rendu par défaut du thème Obsidian actif de l'utilisateur, qui ne distingue pas assez visuellement une suggestion d'une valeur tapée. Hypothèse écartée par grep : ce n'est pas une collision valeur=placeholder (`src/settings/types.ts::DEFAULT_SETTINGS` confirme que les 10 champs concernés partent tous d'une chaîne vide, jamais de la même valeur que leur placeholder).

Ressources consultées :
- `styles.css` (entier avant modification) — aucune règle `::placeholder` ; classes de scoping déjà en place pour des besoins voisins mais partiels : `.tvs-secret` (police monospace sur API key/token), `.tvs-mapping` (bordure des lignes de mapping/dossiers exclus) — aucune classe n'englobait tout `containerEl` de l'onglet réglages.
- `src/settings/SettingsTab.ts` — `grep -n "setPlaceholder" src/` → 10 occurrences dans ce fichier (listées ci-dessus), toutes suivies de `.setValue(...)` sur un champ dont le défaut est une chaîne vide.
- `src/settings/types.ts::DEFAULT_SETTINGS` — confirmé : `apiKey`, `token`, `boardId`, `scope`, `reportPath`, `changesHtmlPath`, `auditChangesCursor` tous `""` ; `excludedFolders`/`mappings` tous `[]` (donc chaque ligne de mapping part de champs `""` également).
- `grep -n "setPlaceholder" src/` complet → 2 occurrences hors périmètre : `src/ui/CardPickerModal.ts:17` et `src/ui/MappingSuggest.ts:12`, toutes deux des champs de recherche de `SuggestModal` (invite ponctuelle, pas un réglage persistant) — UX différente du symptôme signalé (réglages), écartées explicitement (voir Périmètre OUT).

Décision :
- Étend `src/settings/SettingsTab.ts::display()` : ajoute `containerEl.addClass("tvs-settings")`, même patron que `tvs-mapping`/`tvs-secret` déjà en place — un point de scoping unique pour tout l'onglet, pour que la règle CSS ne touche jamais les réglages d'un autre plugin ou d'Obsidian lui-même.
- Étend `styles.css` : nouvelle règle `.tvs-settings input::placeholder { color: var(--text-faint); font-style: italic; }` — réutilise une variable de thème déjà utilisée ailleurs dans le fichier (`--text-faint` déjà présent sur `.tvs-panel__row--skip .tvs-panel__icon`), respecte donc le thème clair/sombre sans valeur codée en dur.
- Aucun nouveau fichier, aucune nouvelle classe par champ — un seul point de scoping suffit car les 10 champs concernés sont tous des `<input>` sous `containerEl`.

Valeurs fixes introduites : 0 — `var(--text-faint)` et `font-style: italic` sont des tokens de thème/valeurs CSS standards, pas des paramètres susceptibles de varier par utilisateur.

Périmètre — IN :
- `src/settings/SettingsTab.ts` : une ligne (`containerEl.addClass("tvs-settings")` dans `display()`).
- `styles.css` : une règle (`.tvs-settings input::placeholder`).
- Les 10 champs placeholder de l'onglet réglages listés ci-dessus.

Périmètre — OUT :
- `src/ui/CardPickerModal.ts` et `src/ui/MappingSuggest.ts` — placeholders de modales de sélection ponctuelles (`SuggestModal`), pas des réglages persistants ; symptôme signalé concernait spécifiquement l'onglet réglages.
- Contenu textuel des placeholders eux-mêmes — déjà générique (§9), non modifié.
- Tout item du backlog produit (labels/checklists/members/custom fields/multi-board, cf. revue externe du 2026-09-08) — sans rapport avec ce fix cosmétique.
- Validation test-vault des 3 features précédemment livrées (due-date, cancellation/timeout, ribbon) — déjà suivie séparément dans `NEXT_SESSION.md` § Écarts, non affectée par ce plan.

### Diagnostic
Cause racine confirmée : absence de règle CSS `::placeholder` propre au plugin, pas un défaut fonctionnel. Le contraste insuffisant vient entièrement du style par défaut du thème Obsidian actif chez l'utilisateur, jamais renforcé par le plugin lui-même.

### Grep global
`grep -n "setPlaceholder" src/` → 10 occurrences dans le périmètre (`SettingsTab.ts`) + 2 hors périmètre justifiées (`CardPickerModal.ts`, `MappingSuggest.ts`). Aucune autre occurrence ailleurs dans `src/`.

### Régression
- `.tvs-secret input { font-family: var(--font-monospace); }` doit continuer de s'appliquer sans conflit à la police du texte réellement tapé dans API key/token — seule la pseudo-classe `::placeholder` de ces mêmes champs devient italique, la valeur tapée reste non-italique et monospace.
- La nouvelle classe `tvs-settings` ne doit rien changer visuellement ailleurs (`ProgressPanel`, `SidebarView`, `ConflictModal`) — elle scope uniquement `containerEl` de `TrelloVaultSyncSettingsTab`, jamais réutilisée ni référencée par un autre composant `src/ui/`.

## Phases livrées

Implémentation complète (code, pas de test Vitest applicable), exécutée le 2026-09-08 :
- `src/settings/SettingsTab.ts:35` — `containerEl.addClass("tvs-settings")` ajouté en tête de `display()`.
- `styles.css` — règle `.tvs-settings input::placeholder { color: var(--text-faint); font-style: italic; }` ajoutée juste après `.tvs-secret input`.
- `npm run check` vert : typecheck OK, 344 tests passés (aucun test neuf requis, changement CSS pur), build esbuild production OK.

## Écarts

- **Passage réel `test-vault/` FAIT** (accès `computer-use` à Obsidian obtenu ce tour). Vérifié sur le champ "Change log HTML page" (vide) vs "Report note" (valeur réelle déjà renseignée) : le placeholder s'affiche grisé et en italique, visuellement distinct d'une valeur tapée, en thème **clair** et **sombre** — capture d'écran montrée à l'utilisateur pour chacun. Aucune régression observée sur `.tvs-secret` (police monospace inchangée sur API key/token) ni sur les autres composants `src/ui/`.
- **Écart TDD (justifié inline, §1.8)** : `superpowers:test-driven-development` (§7) ne s'applique pas au sens strict — aucune logique à tester en Vitest pour une règle CSS pure ; la preuve de correction est visuelle (§10), faite ci-dessus.
