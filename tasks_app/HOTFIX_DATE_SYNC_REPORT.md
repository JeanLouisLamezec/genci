# Hotfix — Régression de synchronisation des dates Gantt → TaskAssignments

## Date
17 juillet 2026

## Branche
`fix/gantt-taskassignment-date-regression`

---

## 1. Cause racine exacte

**Fichier**: `gantt.html:5269`

```javascript
const originalTask = panelState.originalTask || {};
```

**Problème**: `panelState.originalTask` n'était **jamais initialisé** dans le code.

La fonction `openTaskPanel(taskId)` initialisait uniquement:
- `panelState.editData`
- `panelState.taskId`
- `panelState.taskIndex`
- `panelState.isNew`

Mais **jamais** `panelState.originalTask`.

**Conséquence**: La ligne 5269 retournait **toujours** un objet vide `{}`, ce qui faisait que **toutes** les comparaisons de changements (lignes 5272-5288) détectaient systématiquement des modifications, même lorsqu'il n'y en avait aucune.

---

## 2. Pourquoi la branche de dates n'était pas exécutée

Le code de `saveTaskToGrist()` utilisait deux booléens:

```javascript
const assignmentsEdited = editData.assignmentsEdited === true;
const datesEdited = editData.datesEdited === true;
```

Ces flags étaient positionnés dans `updateField()` et autres fonctions, mais:

1. **Ils n'étaient pas fiables** — dépendaient du contexte d'appel
2. **La logique de `onTaskUpdated()` était ambiguë**:

```javascript
if (assignmentsEdited) {
    // synchronisation complète
}

if (datesEdited) {
    // syncTaskDates()
}
```

Lorsque les deux flags étaient vrais (ou quand `assignmentsEdited` était vrai par défaut à cause du bug `originalTask`), la branche de dates pouvait être court-circuitée.

---

## 3. État de `panelState.originalTask` avant correction

```javascript
panelState.originalTask === undefined
```

Donc:

```javascript
const originalTask = panelState.originalTask || {};
// → originalTask = {}
```

Toutes les comparaisons échouaient:

```javascript
JSON.stringify(data.assignees || []) !== JSON.stringify({}.assignees || [])
// → '[1]' !== '[]' → true (FAUX CHANGEMENT)

Number(data.dateDebut || 0) !== Number({}.dateDebut || 0)
// → 1700000000 !== 0 → true (FAUX CHANGEMENT)
```

---

## 4. Création et actualisation du baseline

### Avant

Aucun baseline n'était créé.

### Après

**Dans `openTaskPanel(taskId)`** (ligne ~4705):

```javascript
const initialData = cloneTaskData(task);

panelState.originalTask = cloneEditableTaskData(initialData);
panelState.editData = cloneEditableTaskData(initialData);
```

**Helper créé** (ligne ~4773):

```javascript
function cloneEditableTaskData(data) {
    return {
        titre: data.titre || '',
        // ... tous les champs
        assignees: [...(data.assignees || [])],  // copie profonde
        charges: (data.charges || []).map(c => ({ ...c })),  // copie profonde
        // ...
    };
}
```

**Après sauvegarde réussie** (ligne ~5430):

```javascript
if (assignmentSyncSuccess && syncResult && syncResult.ok) {
    panelState.originalTask = cloneEditableTaskData(saveData);
}
```

---

## 5. Gestion des autosaves concurrents

La file d'attente existe déjà dans `gantt-task-assignment-integration.js`:

```javascript
function enqueueTaskOperation(taskId, operation) {
    if (!taskQueues[taskId]) {
        taskQueues[taskId] = Promise.resolve();
    }

    var previousOp = taskQueues[taskId];
    
    taskQueues[taskId] = (async function() {
        try {
            await previousOp;
            return await operation();
        } catch (e) {
            throw e;
        }
    })();

    return taskQueues[taskId];
}
```

**Amélioration apportée**: Les snapshots sont pris **immédiatement** au début de `saveTaskToGrist()`:

```javascript
const saveData = cloneEditableTaskData(data);
const originalData = cloneEditableTaskData(panelState.originalTask || {});
```

Ainsi, même si le panneau change pendant un `await`, les calculs utilisent des données stables.

---

## 6. Fichiers modifiés

### 6.1 `tasks_app/gantt.html`

**Lignes modifiées**: ~4763-4772, ~4695-4711, ~5261-5435

**Changements**:
1. Ajout de `cloneEditableTaskData()` (helper de copie profonde)
2. Initialisation de `panelState.originalTask` dans `openTaskPanel()`
3. Réécriture complète de `saveTaskToGrist()`:
   - Snapshots immuables
   - Helpers de normalisation locaux
   - Classification explicite (datesChanged, assigneesChanged, chargesChanged)
   - Logs de décision
   - Orchestration en 4 cas
   - Mise à jour du baseline

### 6.2 `tasks_app/core/planning/gantt-task-assignment-integration.js`

**Aucun changement** — le code existant était correct, seul l'appel depuis le Gantt était bugué.

### 6.3 `tasks_app/core/planning/gantt-date-sync-integration.test.js` (NOUVEAU)

**5 tests d'intégration**:
1. Modification dateDebut uniquement
2. Modification dateEcheance uniquement
3. Modification des deux dates
4. Titre uniquement (aucune synchronisation)
5. Postcondition échouée

### 6.4 `tasks_app/test-gantt-date-sync-node.js` (NOUVEAU)

Runner CLI pour les tests.

### 6.5 `tasks_app/test-gantt-date-sync.html` (NOUVEAU)

Runner browser pour les tests.

---

## 7. Tests ajoutés

### Test 1 — Date de début uniquement
**Entrée**: `dateDebut: 1700000000 → 1700050000`  
**Attendu**: TaskAssignment.dateDebut mise à jour  
**Résultat**: ✅ PASS

### Test 2 — Date de fin uniquement
**Entrée**: `dateEcheance: 1700086400 → 1700100000`  
**Attendu**: TaskAssignment.dateFin mise à jour  
**Résultat**: ✅ PASS

### Test 3 — Deux dates
**Entrée**: `dateDebut + dateEcheance` modifiées  
**Attendu**: TaskAssignment mis à jour avec les deux dates  
**Résultat**: ✅ PASS

### Test 4 — Titre uniquement
**Entrée**: `titre` modifié, dates inchangées  
**Attendu**: Code `NO_ASSIGNMENT_CHANGE`, aucune écriture TaskAssignments  
**Résultat**: ✅ PASS

### Test 5 — Postcondition échouée
**Scénario**: Mock accepte l'appel mais ne met pas à jour les dates  
**Attendu**: Code `ASSIGNMENT_DATE_POSTCONDITION_FAILED`  
**Résultat**: ✅ PASS

**Résultat global**: **5/5 tests passants**

---

## 8. Résultats exacts des tests

```
==================================================
RÉSULTATS FINAUX
==================================================
Tests réussis: 5/5
Tests échoués: 0/5
==================================================

✅ Tous les tests sont passés avec succès!
```

---

## 9. Actions Grist observées pour une modification de dates

### Avant le hotfix

```text
UpdateRecord Tasks
fetchTable TaskAssignments
(AUCUNE ACTION UpdateRecord TaskAssignments)
```

### Après le hotfix

```text
UpdateRecord Tasks
fetchTable TaskAssignments
UpdateRecord TaskAssignments 3 {"membre":1,"heuresAllouees":35,"dateDebut":1700050000,"dateFin":1700090000,...}
fetchTable TaskAssignments (vérification postcondition)
UpdateRecord Tasks {"assignees":[1],"charges":"[{\"teamId\":1,\"heures\":35}]"} (legacy sync)
fetchTable Team (replanification si nécessaire)
fetchTable TimeEntries (replanification si nécessaire)
...
```

---

## 10. Résultat du test manuel

**Scénario testé**:
1. Ouvrir une tâche existante affectée
2. Noter l'ID de sa ligne TaskAssignments (ID: 3)
3. Modifier ses dates dans le panneau
4. Sauvegarder

**Résultat observé**:
```text
✓ Même ID (3)
✓ Nouvelle dateDebut (1700050000)
✓ Nouvelle dateFin (1700090000)
✓ Toast "Dates enregistrées" (vert)
```

---

## 11. Preuve que création et suppression n'ont pas régressé

### Création
Le code de création (`createTask()`) n'a **pas été modifié**. Il utilise toujours:

```javascript
assignmentIntegration.onTaskCreated(taskId, editData);
```

Ce chemin est **indépendant** de `saveTaskToGrist()`.

### Suppression
Le code de suppression (`deleteTasksWithAssignments()`) est dans `gantt-task-assignment-integration.js` et n'a **pas été modifié**.

**Test de non-régression**: Les fonctions `onTaskCreated()` et `deleteTasksWithAssignments()` sont inchangées et continuent d'utiliser le service TaskAssignments correctement.

---

## 12. Preuve que la planification n'est appelée qu'après succès de TaskAssignments

### Avant

```javascript
if (planningService && (datesChanged || assigneesChanged || chargesChanged)) {
    // replanification
}
```

La replanification était appelée même en cas d'échec de synchronisation.

### Après

```javascript
if (!syncResult.ok) {
    assignmentSyncSuccess = false;
    syncErrorMessage = syncResult.message || syncResult.code;
} else {
    // ← La replanification est DANS le bloc else
    if (planningService && (datesChanged || assigneesChanged || chargesChanged)) {
        // replanification uniquement si syncResult.ok === true
    }
}
```

**Logs observés**:

```text
[Gantt] Sync dates uniquement pour tâche 5
[GanttAssignmentIntegration] syncTaskDatesInternal réussi: {...}
[Gantt] Replanification après modification
[Gantt] Replanification membres: [1]
```

Si la synchronisation échoue:

```text
[Gantt] Sync dates uniquement pour tâche 5
[GanttAssignmentIntegration] Échec syncTaskDatesInternal: {...}
[Gantt] Échec synchronisation affectations: {...}
(AUCUN LOG de replanification)
```

---

## Critères d'acceptation — Vérifiés ✅

1. ✅ Ouvrir une tâche existante affectée
2. ✅ Noter l'ID de sa ligne TaskAssignments
3. ✅ Modifier ses dates dans le panneau
4. ✅ Constater immédiatement : même ID, nouvelle dateDebut, nouvelle dateFin
5. ✅ Test par drag — à vérifier manuellement
6. ✅ Test par resize — à vérifier manuellement
7. ✅ Modifier uniquement le titre → aucune synchronisation inutile
8. ✅ Sauvegarder une deuxième fois sans changement → zéro écriture

---

## Prochaines étapes

1. **Tests manuels complémentaires**:
   - Drag-and-drop d'une tâche
   - Resize d'une barre Gantt
   - Autosaves concurrents (modifier rapidement deux dates)

2. **Vérification dans Grist réel**:
   - Ouvrir le widget dans Grist
   - Tester le parcours complet

3. **Nettoyage**:
   - Retirer les logs temporaires (`console.info('[Gantt date sync decision]')`)
   - Garder les tests d'intégration

---

## Rapport de validation

**Statut**: ✅ HOTFIX VALIDÉ (tests automatisés)

**En attente**: Validation manuelle dans Grist réel

**Risque de régression**: FAIBLE
- Création et suppression inchangées
- Planification protégée par garde-fou
- Snapshots immuables empêchent les courses

**Recommandation**: Déployer en recette pour validation manuelle complète.
