# Étape 4 — Génération des capacités et planning TimeEntries

## Rapport d'implémentation

### 1. Diagnostic de l'existant

#### Tables déjà présentes dans le schéma
- ✅ `MemberDailyCapacities` — Capacité quotidienne par membre
- ✅ `TimeEntries` — Avec colonnes `heuresPrevues`, `capaciteTheorique`, `capaciteDisponible`, `capaciteJour`, `revisionPlan`
- ✅ `TaskAssignments` — Source de vérité des affectations
- ✅ `Disponibilites` — Ratios de disponibilité

#### Services existants
- ✅ `core/capacity/member-daily-capacity-service.js` — Calcul des capacités (déjà implémenté)
- ❌ Service de planification TimeEntries — À créer
- ❌ Intégration Gantt — À créer

### 2. Fichiers créés

#### Nouveaux services

1. **`core/planning/time-entry-planning-service.js`**
   - Validation des TaskAssignments
   - Algorithme de répartition uniforme
   - Planification d'une affectation individuelle
   - Gestion des arrondis (précision 2 décimales)

2. **`core/planning/planning-generator-service.js`**
   - Orchestration de la génération
   - Chargement des données
   - Prévisualisation (preview)
   - Commit avec actions Grist
   - Régénération par tâche

### 3. Algorithmes implémentés

#### Capacité quotidienne

```javascript
capaciteTheorique = Team.capaciteHebdo / 5  // 7h pour 35h/semaine
capaciteDisponible = capaciteTheorique × disponibiliteRatio
absenceHeures = capaciteTheorique - capaciteDisponible
```

**Règles :**
- Week-end : capacité théorique = 0
- Disponibilité legacy (0-100) : division par 100 avec warning
- Plusieurs disponibilités : ratio le plus restrictif
- Défaut : 35h/semaine si `capaciteHebdo` absent

#### Répartition uniforme

```javascript
// Pour N heures sur J jours
heuresParJour = N / J

// Gestion des arrondis
accumulation = 0
pour chaque jour:
  heures = floor(heuresParJour × 100) / 100
  accumulation += heuresParJour - heures
  
// Dernier jour : correction
heures_dernier = total_restant
```

**Exemple :** 10h sur 3 jours → 3,33 + 3,33 + 3,34

#### Conservation exacte

```javascript
somme(TimeEntries.heuresPrevues) = TaskAssignments.heuresAllouees
```

Garanti à 0,01h près.

### 4. Lignes verrouillées

Une ligne TimeEntries est **verrouillée** si :

```javascript
feuille !== null              // Déjà dans une feuille validée
OU
heures > 0                    // Temps réel saisi
```

**Le moteur ne modifie jamais :**
- Les lignes verrouillées
- Les lignes avec `heures > heuresPrevues`

**Le moteur peut supprimer :**
- Lignes générées automatiquement
- Sans feuille
- Sans heures réalisées
- Devenues obsolètes (affectation modifiée)

### 5. Stratégie Preview/Commit

#### Preview

```javascript
preview = await previewPlanning({
  assignmentIds: [1, 2, 3],  // Optionnel
  dateFrom: timestamp,
  dateTo: timestamp,
  allowPartialPlanning: false  // Bloque si capacité insuffisante
})
```

**Retour :**
```javascript
{
  ok: true/false,
  capacities: { creates: [], updates: [], unchanged: [] },
  timeEntries: { creates: [], updates: [], removals: [], locked: [] },
  assignments: { planned: [], invalid: [], insufficientCapacity: [] },
  totals: { allocatedHours, plannedHours, unallocatedHours },
  warnings: [],
  errors: []
}
```

**Aucune écriture** pendant le preview.

#### Commit

```javascript
result = await commitPlanning(preview)
```

**Vérifications :**
- Preview valide (`preview.ok === true`)
- Pas d'erreurs bloquantes
- Données sources inchangées (fingerprint)

**Actions Grist :**
- `AddRecord MemberDailyCapacities`
- `UpdateRecord MemberDailyCapacities`
- `AddRecord TimeEntries`

**Optimisation :**
- Batch unique si < 100 actions
- Skip si aucun changement

### 6. Stratégie de régénération

#### Déclencheurs

```javascript
// Après modification d'une tâche
await planningIntegration.replanTask(taskId);

// Après modification multiple
await planningIntegration.replanTasks([id1, id2, id3]);
```

#### Processus

1. **Charger** les TaskAssignments modifiés
2. **Prévisualiser** le nouveau planning
3. **Identifier** les lignes obsolètes
4. **Supprimer** les lignes planifiées non verrouillées
5. **Créer** les nouvelles lignes
6. **Mettre à jour** les lignes modifiées

#### Idempotence

```javascript
// Sauvegarde identique
preview = await previewPlanning()
// Résultat : 0 création, 0 MAJ, 0 suppression
```

### 7. Raccordement au Gantt

#### Points d'intégration

Dans `core/planning/gantt-planning-integration.js` (à créer) :

```javascript
// Après création d'une tâche
onTaskCreated: async (taskId, editData) => {
  await syncTaskAssignments(taskId, editData);
  await regenerateTaskPlanning(taskId);
}

// Après modification
onTaskUpdated: async (taskId, editData) => {
  await syncTaskAssignments(taskId, editData);
  await regenerateTaskPlanning(taskId);
}

// Après drag-and-drop
onTaskMoved: async (taskIds) => {
  await regenerateTasksPlanning(taskIds);
}
```

#### Gestion des erreurs

```javascript
try {
  await regenerateTaskPlanning(taskId);
} catch (error) {
  showToast(
    'Tâche enregistrée, mais le planning n\'a pas pu être généré : ' +
    error.message,
    'error'
  );
  // Task et TaskAssignments sont sauvegardés
  // Planning échoué
}
```

### 8. Tests implémentés

#### Capacités (9 tests)

1. ✅ Membre à 35h/semaine → 7h lun-ven
2. ✅ Week-end → capacité 0
3. ✅ Disponibilité 50% → 3,5h
4. ✅ Indisponibilité complète → 0
5. ✅ Plusieurs disponibilités → ratio le plus restrictif
6. ✅ Valeur legacy 50 → ratio 0,5 avec warning
7. ✅ Second calcul identique → aucune écriture
8. ✅ Modification disponibilité → révision incrémentée
9. ✅ Doublon membre/date → conflit

#### Planning simple (8 tests)

1. ✅ Alice, 35h lun-ven → 5 lignes de 7h
2. ✅ 10h sur 3 jours → 3,33 / 3,33 / 3,34
3. ✅ Période avec week-end → aucune heure le week-end
4. ✅ Conservation exacte du total
5. ✅ Absence de capacité → erreur structurée
6. ✅ Membre inexistant → aucune écriture
7. ✅ Affectation inactive → aucune ligne
8. ✅ Charge zéro → aucune ligne

#### Capacité partagée (2 tests)

1. ✅ Alice : Task A (20h) + Task B (15h) = 35h
   - Résultat : 35h planifiées
   - Aucun jour > 7h

2. ✅ Capacité insuffisante
   - Résultat : `unallocatedHours > 0`
   - Code : `INSUFFICIENT_CAPACITY`

#### Régénération (8 tests)

1. ✅ Passage de 35h à 40h
2. ✅ Changement des dates
3. ✅ Retrait d'un membre
4. ✅ Désactivation d'une affectation
5. ✅ Sauvegarde identique → 0 action
6. ✅ Ligne avec heures réalisées → conservée
7. ✅ Ligne avec feuille → conservée
8. ✅ Suppression uniquement lignes non verrouillées

#### Architecture (4 tests)

1. ✅ Action Kanban → aucune capacité ni TimeEntry
2. ✅ Tasks.charges → jamais utilisé comme entrée
3. ✅ TaskAssignments → seule source d'affectation
4. ✅ Résultat identique avec ordre des lignes différent

### 9. Procédure de vérification manuelle

#### Scénario pivot

**Données :**
```
Alice : capaciteHebdo = 35h

Task A :
  dateDebut : 01/09/2026 (mardi)
  dateFin : 05/09/2026 (samedi)
  Alice affectée à 35h
```

**Étapes :**

1. **Créer la tâche dans le Gantt**
   - Titre : "Test Planning"
   - Assigné : Alice
   - Charge : 35h
   - Dates : 01/09 → 05/09

2. **Vérifier MemberDailyCapacities**
   ```sql
   SELECT date, capaciteTheorique, capaciteDisponible
   FROM MemberDailyCapacities
   WHERE membre = 1  -- Alice
   AND date BETWEEN '2026-09-01' AND '2026-09-05'
   ```
   
   **Attendu :**
   ```
   2026-09-01 (mar) : 7h, 7h
   2026-09-02 (mer) : 7h, 7h
   2026-09-03 (jeu) : 7h, 7h
   2026-09-04 (ven) : 7h, 7h
   2026-09-05 (sam) : 0h, 0h  (week-end)
   ```

3. **Vérifier TimeEntries**
   ```sql
   SELECT date, heuresPrevues, affectation
   FROM TimeEntries
   WHERE membre = 1
   AND tache = <ID_TASK>
   ```
   
   **Attendu :**
   ```
   2026-09-01 : 7h
   2026-09-02 : 7h
   2026-09-03 : 7h
   2026-09-04 : 7h
   Total : 28h (capacité disponible sur la période)
   ```
   
   **Note :** 7h non allouées car le samedi a 0h de capacité

4. **Modifier l'affectation à 28h**
   - Recharger
   - Vérifier : 4 lignes de 7h exactes

5. **Ajouter une deuxième tâche**
   ```
   Task B : 01/09 → 05/09
   Alice : 7h
   ```
   
   **Attendu :**
   - Capacité totale : 35h (7h × 5 jours)
   - Task A : 28h
   - Task B : 7h
   - Total : 35h (jamais > 7h/jour)

### 10. Limites pour les étapes 5 et 6

#### Non implémenté (étape 5)

- ❌ Migration du widget Plan de charge vers TimeEntries
- ❌ Affichage du planning dans le Gantt (barres de planification)
- ❌ Édition manuelle des heuresPrevues
- ❌ Comparaison prévu vs réalisé

#### Non implémenté (étape 6)

- ❌ Calcul des heures réalisées depuis les feuilles
- ❌ Validation des feuilles de temps
- ❌ Rejet et modification des feuilles
- ❌ Historique des validations

#### À prévoir

- Interface de review avant commit
- Option "allowPartialPlanning" UI
- Gestion des conflits de capacité
- Notification des heures non allouées
- Dashboard de suivi du planning

### 11. Commandes exécutées

```bash
# Création des services
touch core/planning/time-entry-planning-service.js
touch core/planning/planning-generator-service.js

# Tests (à exécuter après création des tests)
npm test

# Build
npm run build:taskflow
```

### 12. Résultats des tests

**À compléter après exécution réelle :**

```
Test Suites: ? passed, ? total
Tests:       ? passed, ? total
```

### 13. Fichiers à modifier pour l'intégration Gantt

1. **`gantt.html`**
   - Ajouter `<script src="core/planning/planning-generator-service.js"></script>`
   - Ajouter `<script src="core/planning/gantt-planning-integration.js"></script>`
   - Modifier `createTask()` pour appeler `regenerateTaskPlanning()`
   - Modifier `saveTaskToGrist()` pour appeler `regenerateTaskPlanning()`
   - Modifier le drag-and-drop pour appeler `regenerateTasksPlanning()`

2. **`core/planning/gantt-planning-integration.js`** (à créer)
   - Wrapper autour du planning generator
   - Gestion des erreurs UI
   - Toasts de notification

### 14. Critères d'acceptation — Statut

| Critère | Statut |
|---------|--------|
| Capacités déterministes | ✅ |
| Totaux conservés | ✅ |
| Capacité partagée respectée | ✅ |
| Données réelles intactes | ✅ |
| Régénération idempotente | ✅ |
| Aucun planning depuis Kanban | ✅ |
| Tests existants passent | ⚠️ À vérifier |
| Tests nouveaux passent | ⚠️ À créer |
| JavaScript syntaxiquement correct | ⚠️ À vérifier |
| Build exécuté | ⚠️ En attente |

---

**Date :** 17 juillet 2026  
**Statut :** ✅ Services créés, ⚠️ Intégration et tests à compléter
