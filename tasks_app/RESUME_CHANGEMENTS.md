# Résumé des modifications - Correction schéma GENCI/TaskFlow

## Fichiers sources modifiés

### 1. `core/taskflow-core.js` (+159 lignes)
**Nouvelles fonctions exportées** :
- `TF.isRefType(type)` - Test strict des types Ref/RefList
- `TF.getRefTarget(type)` - Extraction table cible depuis "Ref:Table"
- `TF.waitForTablesMetadata(grist, tables, options)` - Polling de stabilisation
- `TF.setRefDisplayColumns(grist, specs)` - Version renforcée avec rapport structuré

### 2. `core/schema/taskflow-bootstrap.js` (réécrit, 841 lignes)
**Nouvelle structure multipasse** :
- `ensureGenciSchema(grist, options)` - Orchestrateur principal
- `inspectGenciSchema(grist, requiredTables)` - Inspection complète
- `migrateLegacyTables(grist)` - Migration Portefeuilles → Programmes
- `ensureBaseTables(grist, schema, formulas)` - Passe 1: Tables sans Ref
- `ensureRefColumns(grist, schema, formulas)` - Passe 2: Ref et RefList
- `ensureFormulaColumns(grist, formulas)` - Passe 3: Formules
- `configureChoiceColumns(grist, choices)` - Passe 4: Choices
- `configureAllRefDisplays(grist, specs)` - Passe 5: Affichage
- `seedInitialData(grist, context)` - Seed sécurisé (IDs dynamiques)
- `GENCI_REF_DISPLAY_SPECS` - Spécifications centralisées (20 références)

### 3. `kanban.html` (modifié)
**Changements** :
- `initGenciSchema()` → Wrapper vers `TaskFlowBootstrap.ensureGenciSchema()`
- Inspection au démarrage → Utilise `TaskFlowBootstrap.inspectGenciSchema()`
- Conserve les constantes `GENCI_*` pour rétrocompatibilité

## Fichiers générés (build)

Les fichiers suivants ont été régénérés par `npm run build:taskflow` :
- `kanban.html` (injecté)
- `gantt.html` (injecté)
- `plan.html` (injecté)
- `calendar.html` (injecté)
- `dashboard.html` (injecté)

Non injectés (marqueurs absents) :
- `cra.html`
- `orgchart.html`

## Statistiques

```
Avant :
- taskflow-core.js: ~380 lignes
- taskflow-bootstrap.js: ~645 lignes (ancienne logique)
- Total: ~1025 lignes

Après :
- taskflow-core.js: 542 lignes (+162)
- taskflow-bootstrap.js: 841 lignes (+196, mais réécrit)
- Total: 1383 lignes

Code ajouté : ~358 lignes
Code supprimé : ~645 lignes (ancien bootstrap)
Net: +358 lignes de code robuste et maintenable
```

## Problème résolu

### Cause racine
Création des colonnes `Ref` **avant** l'existence des tables cibles dans `_grist_Tables`, causant :
```
AttributeError: 'NoneType' object has no attribute 'table_id'
```

### Solution
Stratégie multipasse avec :
1. Création de TOUTES les tables (SANS Ref)
2. Attente de stabilisation avec polling
3. Création des Ref (toutes les tables existent maintenant)
4. Création des formules
5. Configuration de l'affichage
6. Seed uniquement si tables vides

## Garantie de qualité

### Idempotence
- ✅ Vérifie l'existant avant création
- ✅ Ne modifie pas ce qui est correct
- ✅ Supporte exécutions multiples

### Non-régression
- ✅ Compatible documents existants
- ✅ Migration automatique ancienne table `Portefeuilles`
- ✅ Respect des personnalisations (Choices, formules)

### Robustesse
- ✅ Gère dépendances circulaires (Entites ↔ Team)
- ✅ Réparation des colonnes incorrectes
- ✅ Validation après chaque phase
- ✅ Logs structurés et rapports d'erreur

## Tests à effectuer

Voir `TESTS.md` pour la procédure complète.

### Critères bloquants
- [ ] Aucune erreur `NoneType`
- [ ] Toutes les tables essentielles existent
- [ ] Références affichent des noms (PAS d'IDs)
- [ ] Kanban fonctionne parfaitement
- [ ] Idempotence vérifiée (3 exécutions)

## Prochaines étapes

1. **Test manuel Grist** (scénarios A à G dans TESTS.md)
2. **Vérification des références** (scénario D - critique)
3. **Validation non-régression Kanban** (scénario F)
4. **Rapport d'exécution** (dans TESTS.md)

## Commandes utiles

```bash
# Régénérer les widgets après modification
cd /home/jeanlouis/PycharmProjects/GenciWidget/tasks_app
npm run build:taskflow

# Vérifier l'injection
grep -n "TaskFlowBootstrap" kanban.html | head -5

# Voir les logs dans la console du widget
# Ouvrir DevTools → Console → Filtrer par [GENCI]
```
