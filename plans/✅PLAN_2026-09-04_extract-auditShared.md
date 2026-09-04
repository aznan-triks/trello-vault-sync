type: refacto
init: light
Terminé quand : `npm run check` vert (typecheck + tests + build) ; grep "from \"./auditLinks\"" dans auditLocations.ts vide (plus d'import croisé) ; `AuditOptions`/`requireReportNote` n'existent plus dans auditLinks.ts. Pas de passage réel test-vault requis — aucun fichier src/obsidian/ ou main.ts touché (§1.7).
État actuel observé : N/A — dette technique connue (backlog audit 5-personas 2026-09-04), pas un domaine signalé cassé.
Ressources consultées : auditLinks.ts (AuditOptions, requireReportNote), auditLocations.ts (import croisé), grep global confirmant 0 usage externe.
Décision : crée src/features/auditShared.ts — AuditOptions + requireReportNote n'appartiennent ni à auditLinks ni à auditLocations.
Valeurs fixes introduites : 0
Périmètre — IN : déplacer AuditOptions + requireReportNote vers auditShared.ts ; mettre à jour les imports dans auditLinks.ts et auditLocations.ts.
Périmètre — OUT : main.ts / extraction src/commands/ (backlog séparé) ; tout changement de comportement des audits.

## Écarts

- Plan présenté et validé (go) inline dans le chat plutôt que rédigé en fichier avant exécution — écrit rétroactivement ici pour la traçabilité. Aucune conséquence : le go a été donné explicitement avant tout code, et l'exécution suit exactement le périmètre validé.
- Revue de code (§7) : 2 sub-agents Standards/Spec en parallèle (skill `code-review`, diff `git diff` faute de commit de référence propre au chantier) — aucun finding bloquant sur les deux axes.
- `npm run check` vert (18 fichiers de test, 214 tests, build `main.js` OK).
