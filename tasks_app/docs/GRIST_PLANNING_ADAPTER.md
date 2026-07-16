# Grist Planning Adapter

## Vue d'ensemble

Ce document décrit l'adaptateur Grist pour la planification et le CRA. Il fait le lien entre le noyau métier pur (`planning-engine.js`, `planning-reconciliation.js`) et l'API Grist.

## Schéma v2

### Tables nouvelles ou modifiées

#### TaskAssignments (nouvelle)

Table centrale du nouveau modèle de données.

```
TaskAssignments
- id                  (auto, primaire)
- tache               Ref:Tasks
- membre              Ref:Team
- heuresAllouees      Numeric
- dateDebut           Date
- dateFin             Date
- modeRepartition     Choice (proportionnelle, egale, manuelle)
- actif               Bool
- commentaire         Text
```

**Clé logique** : `tache + membre` (unicité métier à contrôler par le service)

#### TimeEntries (étendu)

Nouvelles colonnes ajoutées :

```
TimeEntries (nouvelles colonnes)
- affectation         Ref:TaskAssignments
- heuresPrevues       Numeric
- capaciteTheorique   Numeric
- capaciteDisponible  Numeric
- feuille             Ref:Feuilles
- revisionPlan        Int
```

**Colonnes conservées** (rétrocompatibilité) :

```
- membre              Ref:Team
- tache               Ref:Tasks
- date                Date
- heures              Numeric
- imputation          Text
- description         Text
```

**Clé logique** : `affectation + date`

### Références configurées

```javascript
{ table: 'TaskAssignments', column: 'tache', targetTable: 'Tasks', visibleColumn: 'titre' }
{ table: 'TaskAssignments', column: 'membre', targetTable: 'Team', visibleColumn: 'nom' }
{ table: 'TimeEntries', column: 'affectation', targetTable: 'TaskAssignments', visibleColumn: 'tache' }
{ table: 'TimeEntries', column: 'feuille', targetTable: 'Feuilles', visibleColumn: 'semaine' }
```

## Mapping Grist ↔ Domaine

### TaskAssignments

| Grist | Domaine | Type | Notes |
|-------|---------|------|-------|
| `id` | `id` | number | ID Grist |
| `tache` | `taskId` | number | Ref vers Tasks |
| `membre` | `memberId` | number | Ref vers Team |
| `heuresAllouees` | `allocatedHours` | number | Heures totales |
| `dateDebut` | `startDate` | string | ISO YYYY-MM-DD |
| `dateFin` | `endDate` | string | ISO YYYY-MM-DD |
| `modeRepartition` | `distributionMode` | string | Choice |
| `actif` | `active` | boolean | Bool |

### TimeEntries

| Grist | Domaine | Type | Notes |
|-------|---------|------|-------|
| `id` | `id` | number | ID Grist |
| `affectation` | `assignmentId` | number | Ref vers TaskAssignments |
| `tache` | `taskId` | number | Rétrocompatibilité |
| `membre` | `memberId` | number | Rétrocompatibilité |
| `date` | `date` | string | ISO YYYY-MM-DD |
| `heuresPrevues` | `plannedHours` | number | Prévision |
| `heures` | `actualHours` | number | Réalisé |
| `capaciteTheorique` | `baseCapacityHours` | number | Capacité base |
| `capaciteDisponible` | `availableCapacityHours` | number | Capacité dispo |
| `feuille` | `sheetId` | number | Ref vers Feuilles |
| `revisionPlan` | `planRevision` | number | Compteur de révisions |

## Conversion des dates

### Grist vers ISO

Grist stocke les dates comme **secondes Unix UTC**.

```javascript
function gristDateToIso(value) {
  if (typeof value === 'number') {
    const date = new Date(value * 1000);
    return formatDateUTC(date); // 'YYYY-MM-DD'
  }
  // ... gère aussi les strings ISO et objets Date
}
```

**Exemple** :

```
Grist: 1719792000 (secondes)
ISO:   '2024-07-01'
```

### ISO vers Grist

```javascript
function isoToGristDate(value) {
  const date = parseDateUTC(value); // 'YYYY-MM-DD' → Date UTC
  return Math.floor(date.getTime() / 1000); // secondes Unix
}
```

**Important** :

- Toutes les manipulations se font en UTC
- Aucun fuseau horaire local n'intervient
- Le format `YYYY-MM-DD` est le standard du domaine

## Normalisation des statuts

Les statuts de feuilles dans Grist peuvent être en français ou en anglais.

### Mapping complet

| Grist (FR) | Grist (EN) | Domaine |
|------------|------------|---------|
| `brouillon` | `draft` | `draft` |
| `soumis` | `submitted` | `submitted` |
| `valide` | `validated` | `validated` |
| `rejete` | `rejected` | `draft` |

### Fonction de normalisation

```javascript
normalizeSheetStatus(status)
// Retourne: 'draft' | 'submitted' | 'validated' | null
```

**Comportement** :

- `null`, `undefined`, `''` → `null`
- Valeurs inconnues → `null`
- Insensible à la casse

## Construction des capacités

### Algorithme

```javascript
buildMemberDailyCapacities({
  member,           // { capaciteHebdo: number }
  availabilities,   // [{ dateDebut, dateFin, dispo }]
  startDate,        // ISO YYYY-MM-DD
  endDate,          // ISO YYYY-MM-DD
  defaultWeeklyCapacityHours: 35
})
```

**Règles** :

1. **Capacité quotidienne de base** :
   ```
   baseCapacity = capaciteHebdo / 5
   ```

2. **Week-ends** :
   ```
   baseCapacity = 0 (samedi et dimanche)
   ```

3. **Disponibilités** :
   ```
   availableCapacity = baseCapacity × ratio_dispo
   ```
   - `dispo = 0` → absent
   - `dispo = 0.5` → 50%
   - `dispo = 1` → 100%

4. **Chevauchement** :
   - Prendre le **ratio minimum** si plusieurs disponibilités couvrent la même date

5. **Arrondi** :
   - À 0,01 h près (centièmes d'heure)

### Exemple

```javascript
member = { capaciteHebdo: 35 }
availabilities = [
  { dateDebut: '2024-07-01', dateFin: '2024-07-03', dispo: 0.5 }
]

Résultat :
[
  { date: '2024-07-01', baseCapacityHours: 7, availableCapacityHours: 3.5 },
  { date: '2024-07-02', baseCapacityHours: 7, availableCapacityHours: 3.5 },
  { date: '2024-07-03', baseCapacityHours: 7, availableCapacityHours: 3.5 },
  { date: '2024-07-04', baseCapacityHours: 7, availableCapacityHours: 7 },
  { date: '2024-07-05', baseCapacityHours: 7, availableCapacityHours: 7 }
]
```

## Diagnostics bloquants

### Codes bloquants

Un diagnostic est **bloquant** s'il :

1. Commence par un préfixe bloquant :
   - `MISSING_*`
   - `INVALID_*`
   - `DUPLICATE_*`

2. Ou est dans la liste explicite :
   - `PROTECTED_PLAN_EXCEEDS_ALLOCATION`

### Liste complète

| Code | Bloquant | Description |
|------|----------|-------------|
| `MISSING_ASSIGNMENT` | ✅ | Affectation introuvable |
| `INVALID_ALLOCATED_HOURS` | ✅ | Heures allouées invalides |
| `INVALID_PLANNED_HOURS` | ✅ | Heures prévues invalides |
| `INVALID_ACTUAL_HOURS` | ✅ | Heures réelles invalides |
| `INVALID_CAPACITY` | ✅ | Capacité invalide |
| `DUPLICATE_EXISTING_ENTRY` | ✅ | Doublon détecté |
| `PROTECTED_PLAN_EXCEEDS_ALLOCATION` | ✅ | Prévu protégé > allocation |
| `FULLY_CONSUMED` | ❌ | Allocation entièrement consommée |
| `OVERCONSUMPTION` | ❌ | Réalisé > allocation (information) |
| `UNPLANNED_HOURS` | ❌ | Heures non planifiables |
| `NO_DISTRIBUTABLE_DATES` | ❌ | Aucune date disponible |
| `DEFAULT_CAPACITY_USED` | ❌ | Capacité par défaut utilisée |

### Vérification

```javascript
isBlockingDiagnostic(diagnostic)
// Retourne: boolean
```

## Transformation du diff en actions Grist

### Créations

```javascript
['AddRecord', 'TimeEntries', null, {
  affectation: assignmentId,
  tache: taskId,
  membre: memberId,
  date: isoToGristDate(date),
  heuresPrevues: plannedHours,
  heures: 0,
  capaciteTheorique: baseCapacityHours,
  capaciteDisponible: availableCapacityHours,
  revisionPlan: 1,
  description: null,
  imputation: null
}]
```

### Mises à jour

```javascript
['UpdateRecord', 'TimeEntries', rowId, {
  heuresPrevues: newPlannedHours,
  capaciteTheorique: newBaseCapacity,
  capaciteDisponible: newAvailableCapacity,
  revisionPlan: { $add: 1 }
}]
```

**Champs exclus des mises à jour automatiques** :

- `heures` (réalisé)
- `description`
- `imputation`
- `feuille`
- `membre`
- `tache`

### Suppressions

```javascript
['RemoveRecord', 'TimeEntries', rowId]
```

Seulement si la ligne est :
- Mutable (non soumise/validée)
- Sans réalisé
- Sans description
- Sans imputation
- Sans feuille

## Stratégie d'idempotence

### Principe

Deux exécutions successives avec les mêmes données doivent produire le **même état final**.

### Mécanismes

1. **Réconciliation idempotente** :
   - `reconcileDailyEntries` compare l'existant et le désiré
   - Ne produit des actions que si écart détecté
   - Précision de 0,01 h pour éviter les mises à jour inutiles

2. **Migration idempotente** :
   - Vérifie l'existence des tables/colonnes avant création
   - Ne recrée pas ce qui existe déjà
   - Met à jour `TaskFlow_Meta.schemaVersion` après succès

3. **Mock Grist** :
   - Permet de tester l'idempotence sans Grist réel
   - Simule les réponses de l'API Grist

### Test d'idempotence

```javascript
// Première exécution
const result1 = await reconcileAssignmentPlan(grist, assignmentId);
await grist.applyUserActions(result1.actions);

// Deuxième exécution
const result2 = await reconcileAssignmentPlan(grist, assignmentId);

// result2.actions devrait être vide
expect(result2.actions.length).toBe(0);
```

## Backfill futur de Tasks.charges

### État actuel

`Tasks.charges` contient encore l'ancien format JSON :

```json
[
  { "teamId": 12, "heures": 35 }
]
```

### Migration future (hors périmètre de ce lot)

Un script de backfill contrôlé sera exécuté lors de l'intégration des widgets :

1. **Lire** `Tasks.charges` pour chaque tâche
2. **Créer** des `TaskAssignments` correspondantes :
   ```javascript
   {
     tache: taskId,
     membre: charge.teamId,
     heuresAllouees: charge.heures,
     dateDebut: task.dateDebut,
     dateFin: task.dateEcheance,
     modeRepartition: 'proportionnelle',
     actif: true
   }
   ```
3. **Conserver** `Tasks.charges` en lecture seule pour rétrocompatibilité
4. **Basculer** progressivement les widgets vers `TaskAssignments`

### Précautions

- Ne pas supprimer `Tasks.charges` immédiatement
- Synchroniser bidirectionnellement pendant la transition
- Journaliser toutes les créations pour audit

## API publique

### Fonctions exportées

```javascript
// Conversion des dates
gristDateToIso(value)
isoToGristDate(value)

// Normalisation des statuts
normalizeSheetStatus(status)

// Construction des capacités
buildMemberDailyCapacities(input)

// Chargement du contexte
loadAssignmentContext(grist, assignmentId, options)

// Services de planification
planAssignment(grist, assignmentId, options)
reconcileAssignmentPlan(grist, assignmentId, options)
reconcileTaskPlan(grist, taskId, options)

// Utilitaires
isBlockingDiagnostic(diagnostic)
diffToGristActions(diff, assignment, capacities)
```

### Options communes

```javascript
{
  dryRun: false,              // Simulation sans écriture
  replanFromDate: null,       // Date de début de replanification
  precisionHours: 0.01,       // Précision en heures
  capacityPolicy: 'cap',      // Politique de capacité
  activeOnly: true            // Ignorer les affectations inactives
}
```

## Exemple d'utilisation complet

```javascript
const { reconcileAssignmentPlan } = require('./grist-planning-adapter.js');

async function replanify(grist, assignmentId) {
  // Mode simulation d'abord
  const preview = await reconcileAssignmentPlan(grist, assignmentId, {
    dryRun: true
  });
  
  if (!preview.success) {
    console.error('Erreur:', preview.error);
    return;
  }
  
  console.log('Actions prévues:', preview.actions.length);
  console.log('Diagnostics:', preview.diagnostics);
  
  // Appliquer si OK
  const result = await reconcileAssignmentPlan(grist, assignmentId, {
    dryRun: false
  });
  
  console.log('Actions exécutées:', result.actionsExecuted);
}
```

## Tests

### Lancer les tests

```bash
cd tasks_app
npm test
```

### Fichiers de test

- `core/grist/grist-planning-adapter.test.js` - Tests de l'adaptateur
- `core/schema/taskflow-migrations.test.js` - Tests des migrations
- `core/grist/mock-grist.js` - Mock Grist pour les tests

### Couverture

Les tests couvrent :

- Conversion des dates (6 tests)
- Normalisation des statuts (4 tests)
- Construction des capacités (6 tests)
- Réconciliation (14 tests)
- Diagnostics bloquants (7 tests)
- Transformation du diff (3 tests)

## Notes d'implémentation

### Concurrence

L'adaptateur ne gère pas la concurrence distribuée. Pour éviter les conflits :

1. **Relire** les données avant de calculer le diff
2. **Appliquer** le diff dans un seul batch Grist
3. **Bloquer** en cas de conflit détecté

### Sécurité

- Ne jamais écrire `heures` automatiquement
- Ne jamais modifier une ligne soumise/validée
- Vérifier les diagnostics bloquants avant écriture

### Performance

- Charger toutes les tables en parallèle
- Utiliser des Maps pour les recherches rapides
- Limiter le nombre d'actions Grist (batch unique)
