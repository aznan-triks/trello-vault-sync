# AUDIT — settings-ergonomics (2026-09-04)

Source : `plans/PLAN_2026-09-04_audit-settings-ergonomics.md`. Périmètre : les 5 sous-plans v1.5.0→v1.5.5 (`SidebarView.ts`, `SettingsTab.ts`, `ProgressPanel.ts`, `core/journal.ts`, `core/countSeverity.ts`, `core/auditAction.ts`, `trello/client.ts::getActions`, `features/auditChanges.ts`, `settings/types.ts`).

## Constantes module-level introduites depuis v1.5.0

| Constante | Fichier | Classement | Raison |
|---|---|---|---|
| `ACTIONS_PAGE_LIMIT = "1000"` | `trello/client.ts:88` | **Détail interne, justifié** | Plafond de pagination Trello (protocole), même statut que `CARD_FIELDS`/`RETRYABLE` déjà acceptés dans ce fichier. Justifié explicitement dans `PLAN_2026-09-04_feature-audit-changes.md` ("pas dans settings/types.ts"). |
| `MAX_LOG_ROWS = 60` | `ui/ProgressPanel.ts:18` | **Détail interne, justifié (borderline)** | Partagée entre le panneau flottant éphémère (60 lignes largement suffisant pour une synchro) et le journal persistant de la sidebar (accumule sur plusieurs runs). `PLAN_2026-09-04_feature-logging.md` a explicitement posé la question et tranché "YAGNI tant que MAX_LOG_ROWS suffit ; à revisiter seulement si demandé" — processus §8 respecté (question posée + réponse justifiée), pas juste codé en dur sans réflexion. Pas de signal utilisateur de friction réelle à ce jour → pas de réglage à ajouter maintenant, à rouvrir seulement si demandé. |
| `PROBLEM_KEYS` (Set) | `core/countSeverity.ts:10` | **Détail interne, justifié** | Classification finie de clés de compteur, même statut que `COUNT_LABELS`/`ICONS` déjà non-configurables. `PLAN_2026-09-04_feature-panel-colors.md` le justifie explicitement ("ensemble fini nommé dans le code, pas un seuil numérique"). Pas de toggle pour désactiver la coloration : aucune demande utilisateur en ce sens, cohérent avec le fait que le thème dark/light s'applique déjà automatiquement sans réglage dédié — pas ajouté (YAGNI). |
| `VIEW_TYPE_TVS_SIDEBAR` | `ui/SidebarView.ts:19` | **Détail interne, justifié** | Identifiant technique de l'API Obsidian (clé d'enregistrement de vue), pas une valeur utilisateur. Justifié explicitement dans `PLAN_2026-09-04_feature-sidebar-view.md` (§1.8). |
| `auditChangesCursor` | `settings/types.ts` | **Détail interne, justifié** | Curseur de pagination interne (bookkeeping), pas un champ visible — justifié explicitement dans `PLAN_2026-09-04_feature-audit-changes.md` ("pas de nouveau champ visible nécessaire"). |

## Champs de saisie de `SettingsTab.ts` (13 `addText`, 0 `addTextArea`)

| Champ | Ligne | Patron réutilisé | Classement |
|---|---|---|---|
| API key | 79 | Valeur secrète unique — aucun patron liste/chemin applicable | Cohérent |
| Token | 93 | Valeur secrète unique | Cohérent |
| Board id | 111 | `TrelloPickerSuggest` | Cohérent |
| Synced folder (scope) | 160 | `VaultPathSuggest` | Cohérent |
| Excluded folders (par ligne) | 180 | `VaultPathSuggest` + bouton suppression | Cohérent (corrigé en v1.5.5, ex-textarea) |
| Report note | 216 | `VaultPathSuggest` | Cohérent |
| Clock margin (seconds) | 250 | Numérique — aucun patron applicable | Cohérent |
| Mapping → Trello list | 336 | `TrelloPickerSuggest` | Cohérent |
| Mapping → Folder | 363 | `VaultPathSuggest` | Cohérent |
| Mapping → Note template | 374 | `VaultPathSuggest` | Cohérent |
| Retries | 420 | Numérique | Cohérent |
| Initial delay (ms) | 431 | Numérique | Cohérent |
| Auto-close (seconds) | 451 | Numérique | Cohérent |

Aucun `addTextArea` restant dans le fichier — confirmé par grep, la correction v1.5.5 (`excludedFolders`) a éliminé la seule occurrence.

## Comportements figés vérifiés contre l'état cible

- Chaque nombre/seuil introduit depuis v1.5.0 est soit dans `settings/types.ts` (aucun nouveau seuil numérique introduit sur la période), soit justifié comme détail interne (tableau ci-dessus).
- Chaque champ liste/chemin/identifiant utilise l'autocomplétion ou le patron liste+suppression — confirmé, aucune saisie brute restante.
- Aucune fonctionnalité des 5 sous-plans n'a de comportement figé non voulu : `showPanel`, `panelAutoCloseSeconds`, `dryRun`, `excludedFolders` sont tous configurables ; le seul point borderline (`MAX_LOG_ROWS` partagé) a déjà été explicitement soupesé et justifié dans son plan d'origine, pas glissé sous le tapis.

## Conclusion

**Aucun écart nécessitant un fix.** Tout comportement figé identifié depuis v1.5.0 est soit déjà configurable, soit explicitement justifié comme détail interne (avec la raison documentée dans le sous-plan d'origine ou ci-dessus). Pas de plan de fix à écrire.
