# Corrections du Bootstrap TaskFlow — Juillet 2026

## Problèmes identifiés et corrigés

### 1. Perte des options de colonnes lors de la création

**Problème :**
```javascript
// ANCIEN CODE - BUG
var colSpecs = split.nonRef.map(function (c) {
    return { id: c.id, type: c.opts.type };
});
```

Perdait `isFormula`, `formula`, et toutes les autres options.

**Correction :**
```javascript
var colSpecs = split.nonRef.map(function (c) {
    return Object.assign({ id: c.id }, c.opts);
});
```

Préserve toutes les options : `isFormula`, `formula`, `widgetOptions`, etc.

### 2. Vérification incorrecte des références

**Problème :**
La fonction `configureReferenceDisplay()` vérifiait uniquement `visibleCol` mais pas la formule d'affichage.

```javascript
// ANCIEN CODE - BUG
if (visibleColId === visCol.id) {
    return true; // Consideré comme correct
}
```

**Correction :**
```javascript
var visibleColIsCorrect = (visibleColId === visCol.id);
var displayFormula = '$' + column + '.' + visibleColumn;
var displayCol = metadata.columnByRowId[displayColId];
var displayFormulaIsCorrect = displayCol && displayCol.formula === displayFormula;

if (visibleColIsCorrect && displayFormulaIsCorrect) {
    return true;
}
```

Vérifie MAINTENANT :
- Le `visibleCol`
- La formule de display (`$col.visibleColumn`)

### 3. Index `columnByRowId` manquant

**Problème :**
Impossible de vérifier la formule d'affichage car on ne pouvait pas retrouver une colonne par son ID.

**Correction :**
Ajouté dans `fetchMetadata()` :
```javascript
var columnByRowId = {};
for (var j = 0; j < columns.length; j++) {
    var col = columns[j];
    // ...
    columnByRowId[col.id] = col;
}

return {
    // ...
    columnByRowId: columnByRowId
};
```

### 4. Normalisation incorrecte des types Ref/RefList

**Problème :**
```javascript
// ANCIEN CODE - BUG
var expectedBase = expectedType.replace(/^RefList:/, 'Ref:');
var existingBase = existingType.replace(/^RefList:/, 'Ref:');
// Ref et RefList considérés comme compatibles
```

**Correction :**
```javascript
// Comparaison EXACTE
if (existingType !== expectedType) {
    conflicts.push({
        expected: expectedType,
        actual: existingType,
        expectedIsFormula: colDef.opts.isFormula || false
    });
}
```

`Ref:Team` et `RefList:Team` sont maintenant considérés comme DIFFÉRENTS.

### 5. Suppression de `addRefColumns()` inutile

La fonction `addRefColumns()` a été supprimée car elle dupliquait la logique de `addColumn()`.

La Phase 4 utilise maintenant directement `addColumn()` pour les colonnes Ref.

### 6. Suppression des délais artificiels

**Avant :**
```javascript
await addColumn(...);
await delay(50); // Délai artificiel
```

**Après :**
```javascript
await addColumn(...);
// Pas de délai artificiel
```

Les délais ont été supprimés du chemin normal. Seul un backoff exponentiel reste en cas de conflit de concurrence réel.

## Architecture corrigée

### Phase 1 : Création des tables (colonnes non-Ref uniquement)
```javascript
for (table of missingTables) {
    createTable(table); // Uniquement colonnes non-Ref
}
```

### Phase 2 : Ajout des colonnes Ref
```javascript
for (table of allTables) {
    for (col of refColumns) {
        if (!exists(col)) {
            addColumn(table, col);
        }
    }
}
```

### Phase 3 : Ajout des autres colonnes manquantes
```javascript
for (table of allTables) {
    for (col of missingNonRefColumns) {
        addColumn(table, col);
    }
}
```

### Phase 4 : Configuration des références
```javascript
for (refSpec of referenceDisplays) {
    configureReferenceDisplay(refSpec);
    // Vérifie visibleCol ET display formula
}
```

### Phase 5 : Initialisation des choix
```javascript
seedChoiceOptions('Tasks', 'statut', ...);
seedChoiceOptions('Tasks', 'type', ...);
seedChoiceOptions('Tasks', 'priorite', ...);
```

## Nouveau système de vérification du build

### Script `check-taskflow-build.js`

**Fonctionnement :**
1. Concatène les fichiers sources
2. Calcule le hash SHA-256
3. Extrait le code injecté de chaque widget
4. Compare les hash

**Usage :**
```bash
npm run check:taskflow-build
```

**Sortie attendue :**
```
✅ TOUS LES WIDGETS SONT À JOUR
```

**En cas d'échec :**
```
❌ CERTAINS WIDGETS NE SONT PAS À JOUR
Exécutez : npm run build:taskflow
```

## Commandes npm ajoutées

```json
{
  "scripts": {
    "build:taskflow": "node scripts/build-taskflow.js",
    "check:taskflow-build": "node scripts/check-taskflow-build.js"
  }
}
```

## Flux de travail recommandé

### Développement
```bash
# 1. Modifier les sources
edit core/schema/taskflow-bootstrap.js

# 2. Lancer le build
npm run build:taskflow

# 3. Vérifier
npm run check:taskflow-build

# 4. Tester dans Grist
```

### Validation avant commit
```bash
npm run build:taskflow && npm run check:taskflow-build
```

Doit afficher :
```
✅ TOUS LES WIDGETS SONT À JOUR
```

## Tests à réaliser

### Test 1 : Document vide
1. Créer un nouveau document Grist
2. Ajouter le widget Kanban
3. Vérifier les logs console :
   ```
   [TaskFlow Bootstrap] Phase 1: Test accès Grist
   [TaskFlow Bootstrap] Phase 2: Lecture métadonnées
   [TaskFlow Bootstrap] Phase 3: Création tables
   [TaskFlow Bootstrap] Phase 4: Ajout colonnes Ref
   [TaskFlow Bootstrap] Bootstrap terminé avec succès
   ```
4. Vérifier dans Grist :
   - Toutes les tables créées
   - Colonnes avec `isFormula: false` pour les données
   - Références configurées (visibleCol + display formula)

### Test 2 : Création d'une ligne Team
1. Dans la table `Team`, créer une nouvelle ligne
2. Remplir `nom`, `email`, `couleur`
3. **Attendu :** Aucune erreur
4. **Ancien bug :** `AttributeError 'NoneType' object has no attribute 'table_id'`

### Test 3 : Réouverture du widget
1. Quitter le Kanban
2. Revenir sur le Kanban
3. **Attendu :**
   - Aucun `applyUserActions` (schéma déjà installé)
   - Chargement rapide (< 500ms)
   - Pas de message "Initialisation du schéma"

### Test 4 : Vérification des références
1. Créer des lignes dans `Team`, `Projects`, `Tasks`
2. Dans les vues natives Grist, vérifier :
   - `Projects.responsable` affiche le nom (pas l'ID)
   - `Tasks.projet` affiche le nom du projet
   - `Tasks.assignees` affiche les noms des assignés

### Test 5 : Concurrence
1. Ouvrir Kanban ET Gantt simultanément
2. **Attendu :**
   - Aucune erreur "table already exists"
   - Un seul schéma créé
   - Les deux widgets fonctionnent

## Métriques de performance

### Première installation (document vide)
- **Nombre d'appels `applyUserActions`** : ~5-10 (regroupés)
- **Temps de bootstrap** : 2-5 secondes (création des tables)

### Réouverture (document installé)
- **Nombre d'appels `applyUserActions`** : 0 (lecture seule)
- **Temps de bootstrap** : < 500ms (vérification rapide)

## Fichiers modifiés

| Fichier | Changement |
|---------|------------|
| `core/schema/taskflow-bootstrap.js` | Correction `createTable()`, `configureReferenceDisplay()`, `findTypeConflicts()` |
| `core/schema/taskflow-schema.js` | Aucun (déjà correct) |
| `scripts/build-taskflow.js` | Aucun |
| `scripts/check-taskflow-build.js` | **NOUVEAU** |
| `package.json` | Ajout `check:taskflow-build` |
| `kanban.html` | Régénéré par le build |
| `gantt.html` | Régénéré par le build |
| `plan.html` | Régénéré par le build |
| `calendar.html` | Régénéré par le build |
| `dashboard.html` | Régénéré par le build |

## Prochaines étapes

1. **Tester sur une copie du document** `qxouJyDxtxYAxahJVJua6q`
2. **Vérifier l'absence d'erreur** lors de la création d'une ligne `Team`
3. **Créer la migration V2** pour réparer les documents existants
4. **Intégrer dans CRA** et `orgchart.html` (marqueurs manquants)

## Causes racines de l'erreur `NoneType.table_id`

L'erreur se produisait lorsque :

1. Une colonne `Ref:Entites` était créée dans `Team`
2. Mais la table `Entites` n'existait pas encore
3. Grist ne pouvait pas résoudre la référence → `NoneType`

**Solution :**
- Phase 1 : Créer TOUTES les tables (sans les colonnes Ref)
- Phase 2 : Créer les colonnes Ref (maintenant que toutes les tables existent)

Cette séquence garantit que toute référence pointe vers une table existante.
