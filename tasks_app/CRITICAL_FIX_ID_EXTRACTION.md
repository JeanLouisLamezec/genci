# Correction critique — Récupération des IDs créés dans Grist

## Diagnostic

### Cause racine identifiée

Le Gantt créait correctement la tâche :
```text
AddRecord Tasks → ID 4
```

Mais **ne synchronisait PAS** les `TaskAssignments` car :

```javascript
var taskId = createResults && createResults[0] ? createResults[0] : null;
```

Or Grist retourne :
```javascript
{
  retValues: [4]  // et NON PAS [4] directement
}
```

Donc :
```javascript
createResults[0] === undefined
taskId === null
```

Et la condition échouait :
```javascript
if (taskId && assignmentIntegration) {
  // JAMAIS EXÉCUTÉ ❌
}
```

## Corrections appliquées

### 1. Helper robuste dans le Gantt

```javascript
function getCreatedRecordId(result, actionIndex = 0) {
    // Format Grist standard : { retValues: [ID] }
    if (result && Array.isArray(result.retValues)) {
        const value = result.retValues[actionIndex];
        if (Number.isInteger(value) && value > 0) {
            return value;
        }
    }
    
    // Compatibilité mocks/wrappers
    if (Array.isArray(result)) {
        const value = result[actionIndex];
        if (Number.isInteger(value) && value > 0) {
            return value;
        }
    }
    
    // Autres formats possibles
    if (Number.isInteger(result) && result > 0) {
        return result;
    }
    
    if (result && Number.isInteger(result.id) && result.id > 0) {
        return result.id;
    }
    
    throw new Error(
        'Impossible de récupérer l\'ID créé : ' +
        JSON.stringify(result)
    );
}
```

### 2. Utilisation dans `createTask()`

```javascript
var createResults = await grist.docApi.applyUserActions([
    ['AddRecord', 'Tasks', null, pruneTaskRecord(record)]
]);

var taskId = getCreatedRecordId(createResults);

console.log('[Gantt] Task créée', {
    taskId: taskId,
    createResults: createResults,
    integrationAvailable: Boolean(assignmentIntegration)
});

if (!assignmentIntegration) {
    throw new Error('TaskAssignment integration non disponible');
}

var syncResult = await assignmentIntegration.onTaskCreated(taskId, data);

if (!syncResult.ok) {
    showToast('Tâche créée mais affectations non synchronisées', 'error');
    await loadAllData();
    return;
}
```

### 3. Correction dans le service

```javascript
var actionResults = await grist.docApi.applyUserActions(actions);

// Format Grist : { retValues: [ID1, ID2, ...] }
var retValues = actionResults && actionResults.retValues 
    ? actionResults.retValues 
    : actionResults;

if (!Array.isArray(retValues)) {
    retValues = [];
}

actions.forEach(function(action, index) {
    if (action[0] === 'AddRecord' && action[1] === 'TaskAssignments') {
        if (retValues[index] != null && 
            Number.isInteger(retValues[index]) && 
            retValues[index] > 0) {
            createdIds.push(retValues[index]);
        }
    }
});
```

## Logs attendus après correction

### Scénario de création

```text
[Gantt] Task créée {
  taskId: 4,
  createResults: { retValues: [4] },
  integrationAvailable: true
}

[Gantt] Synchronisation TaskAssignments {
  ok: true,
  createdIds: [5],
  actionsExecuted: 2
}
```

### Séquence Grist

```text
1. AddRecord Tasks → { retValues: [4] }
2. fetchTable TaskAssignments → []
3. fetchTable Tasks → { id: [1,2,3,4], ... }
4. fetchTable Team → { id: [1,2], ... }
5. AddRecord TaskAssignments → { retValues: [5] }
6. UpdateRecord Tasks → { retValues: [null] }
```

## Résultat attendu dans Grist

### Table `TaskAssignments`

Pour la tâche `test 4` :

| id | tache | membre | heuresAllouees | dateDebut | dateFin | modeRepartition | actif | commentaire |
|----|-------|--------|----------------|-----------|---------|-----------------|-------|-------------|
| 5  | 4     | 1      | 40             | 1784419200 | 1784891056 | uniforme | true | |

### Table `Tasks`

| id | titre | assignees | charges |
|----|-------|-----------|---------|
| 4  | test 4 | [1] | `[{"teamId":1,"heures":40}]` |

## Fichiers modifiés

1. **`gantt.html`** (lignes ~5538-5580)
   - Ajout de `getCreatedRecordId()`
   - Correction de `createTask()`
   - Logs de débogage ajoutés

2. **`core/planning/task-assignment-service.js`** (lignes ~565-585)
   - Correction extraction IDs avec `retValues`
   - Validation renforcée

## Test de validation

### Étapes

1. **Créer une tâche dans le Gantt**
   - Titre : "test 4"
   - Assigné : Alice (ID=1)
   - Charge : 40h
   - Dates : 01/09/2026 → 05/09/2026

2. **Vérifier les logs console**
   ```text
   [Gantt] Task créée { taskId: 4, ... }
   [Gantt] Synchronisation TaskAssignments { ok: true, ... }
   ```

3. **Vérifier `TaskAssignments` dans Grist**
   - 1 ligne créée avec `tache = 4`

4. **Vérifier `Tasks` dans Grist**
   - `assignees = [1]`
   - `charges = [{"teamId":1,"heures":40}]`

### Critères de succès

- ✅ `taskId` correctement extrait (non null)
- ✅ `assignmentIntegration.onTaskCreated()` appelé
- ✅ 1 ligne dans `TaskAssignments`
- ✅ `Tasks.assignees` et `Tasks.charges` mis à jour
- ✅ Logs de synchronisation visibles

## Impact

Cette correction est **critique** : sans elle, **aucune affectation n'était créée** lors de la création d'une tâche, rendant toute la passe 3 inopérante.

Avec cette correction :
- Les créations de tâches synchronisent correctement les affectations
- Les IDs créés sont correctement trackés
- Le service retourne des `createdIds` précis
- L'idempotence peut fonctionner correctement

## Prochaine étape

**Tester manuellement dans Grist** avec le widget rebuildé :

1. Ouvrir le Gantt
2. Créer une tâche avec assigné et charge
3. Vérifier qu'une ligne apparaît dans `TaskAssignments`
4. Si OK → la passe 3.1 est validée
5. Si KO → analyser les logs console

---

**Date :** 17 juillet 2026  
**Statut :** ✅ Correction appliquée, en attente de test manuel  
**Fichiers rebuildés :** `gantt.html` injecté avec les corrections
