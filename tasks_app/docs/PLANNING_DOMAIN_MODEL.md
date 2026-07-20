# Planning Domain Model

## Vue d'ensemble

Ce document décrit le modèle de domaine pour la planification et la gestion des feuilles de temps dans TaskFlow. Il s'agit d'un noyau métier JavaScript pur, indépendant de Grist et du DOM, qui sera ultérieurement intégré aux widgets.

## Entités futures

### TaskAssignments (Affectations)

Table future qui remplacera progressivement le champ JSON `Tasks.charges`.

```
TaskAssignments
- id: int
- tache: Ref → Tasks
- membre: Ref → Team
- heuresAllouees: Numeric (en heures, précision 0,01)
- dateDebut: Date (YYYY-MM-DD)
- dateFin: Date (YYYY-MM-DD)
- modeRepartition: Choice (equal, proportional, manual)
- actif: Bool
```

**Rôle** : Définir l'allocation théorique d'un membre sur une tâche, avec une période et un volume d'heures.

### TimeEntries (Entrées de temps)

Table étendue pour séparer clairement prévu et réalisé.

```
TimeEntries
- id: int
- affectation: Ref → TaskAssignments
- date: Date (YYYY-MM-DD)
- heuresPrevues: Numeric (planifié par le moteur)
- heures: Numeric (réalisé saisi)
- capaciteTheorique: Numeric (capacité base du jour)
- capaciteDisponible: Numeric (capacité après congés/absences)
- feuille: Ref → Timesheets (feuille de temps parente)
- imputation: Text (code projet/centre de frais)
- description: Text
```

**Rôle** : Tracker quotidien du temps, avec une distinction nette entre ce qui était prévu et ce qui a été réellement fait.

## Concepts clés

### Prévu (Planned)

Les heures **prévues** représentent le plan théorique généré par le moteur de planification. Elles sont stockées dans `TimeEntries.heuresPrevues`.

**Caractéristiques** :
- Calculées automatiquement par `buildAssignmentPlan()`
- Réparties proportionnellement aux capacités disponibles
- Peuvent être modifiées par le moteur lors d'un replanification
- Servent de guide pour l'utilisateur

### Réalisé soumis (Submitted Actual)

Les heures **réalisées soumises** représentent le temps déclaré par l'utilisateur et soumis pour validation, mais pas encore validé.

**Caractéristiques** :
- Stockées dans `TimeEntries.heures` avec `sheetStatus = 'submitted'`
- Immuable : ne peut pas être modifié tant que la feuille est soumise
- Le `plannedHours` associé reste **réservé** (voir ci-dessous)
- N'est pas déduit de l'allocation comme du réalisé validé

### Réalisé validé (Validated Actual)

Les heures **réalisées validées** représentent le temps approuvé par le responsable.

**Caractéristiques** :
- Stockées dans `TimeEntries.heures` avec `sheetStatus = 'validated'`
- Consomme l'allocation : déduit des `heuresAllouees`
- Une cellule vide validée vaut **zéro heure**
- Irréversible (nécessite une note de correction pour modifier)

## Règles de verrouillage

### Statuts de feuille

| Statut | Modification du prévu | Modification du réalisé | Consomme allocation |
|--------|----------------------|------------------------|---------------------|
| `null` (brouillon) | Oui | Oui | Non |
| `draft` | Oui | Oui | Non |
| `submitted` | Non (réservé) | Non | Non |
| `validated` | Non | Non | Oui (heures réelles) |

### Règles détaillées

1. **Feuille soumise** :
   - Le champ `heures` est verrouillé
   - Le champ `heuresPrevues` reste réservé dans le plan
   - Ne peut être modifiée que par rejet/retour brouillon

2. **Feuille validée** :
   - Tous les champs sont verrouillés
   - Les `heures` réelles consomment l'allocation
   - Une cellule avec `heures = 0` libère le prévu précédemment réservé

3. **Période avant `replanFromDate`** :
   - Les heures prévues sont réservées et non modifiables
   - Sauf si la feuille est validée (auquel cas c'est le réalisé qui compte)

## Calcul du reste à faire

```
resteAFaire = heuresAllouees 
              - Σ(heures validées) 
              - Σ(prévu réservé des feuilles soumises)
              - Σ(prévu des périodes verrouillées non validées)
```

Le moteur calcule ce reste et le redistribue sur les dates futures disponibles.

## Conservation du prévu historique

Lorsqu'une feuille est validée avec des heures différentes du prévu :

- Le `heuresPrevues` original est **conservé** (historique)
- Le `heures` réel est enregistré
- La différence n'est pas redistribuée automatiquement
- L'utilisateur peut demander un replanification manuelle

**Exemple** :

| Date | Prévu | Réalisé validé | Statut |
|------|-------|----------------|--------|
| 01/07 | 3,5h | 4h | validated |
| 02/07 | 3,5h | 3h | validated |
| 03/07 | 3,5h | - | (futur) |

- Total alloué : 35h
- Réalisé validé : 7h
- Reste à planifier : 28h sur les dates futures

## Logique de capacité

### Capacité théorique vs disponible

- **capacitéTheorique** : Durée standard d'une journée (ex: 7h)
- **capacitéDisponible** : Capacité après déduction des congés, formations, etc.

Le moteur utilise **capacitéDisponible** pour la répartition.

### Règles de capacité

1. Une date avec `capacitéDisponible = 0` ne reçoit aucune heure
2. Le plan quotidien ne dépasse jamais la capacité disponible (`capacityPolicy: "cap"`)
3. La répartition est proportionnelle aux capacités disponibles

**Exemple de répartition proportionnelle** :

| Date | Capacité | Ratio | Heures allouées |
|------|----------|-------|-----------------|
| 01/07 | 7h | 2/3 | 2,33h |
| 02/07 | 3,5h | 1/3 | 1,17h |

Total : 3,5h répartis proportionnellement (7h vs 3,5h = ratio 2:1)

## Invariants du moteur

### Invariants de cohérence

1. **Somme des heures** :
   ```
   Σ(nouveau plan) + unplannedHours = resteAFaire
   ```

2. **Précision** :
   - Tous les calculs sont faits en centièmes d'heure (entiers)
   - Conversion finale en heures avec arrondi à 0,01h
   - Pas de dérive flottante

3. **Capacité** :
   ```
   ∀ date: plan[date] ≤ capacitéDisponible[date]
   ```

4. **Surconsommation** :
   - Si `Σ(réalisé validé) > heuresAllouees` :
     - Aucun plan futur n'est généré
     - `overconsumedHours = Σ(réalisé validé) - heuresAllouees`

### Invariants de réconciliation

1. **Idempotence** :
   - Deux exécutions avec mêmes données → mêmes opérations

2. **Préservation** :
   - Les champs manuels (description, imputation) ne sont jamais écrasés
   - Les lignes soumises/validées ne sont jamais modifiées

3. **Conflits explicites** :
   - Les doublons (même clé `assignmentId + date`) sont signalés
   - Aucune fusion silencieuse

## Intégration Grist future

### Architecture cible

```
┌─────────────────┐         ┌─────────────────┐
│   TaskAssignments│         │   TimeEntries   │
│                 │         │                 │
│ - id            │◄────────│ - affectation   │
│ - tache         │    1:N  │ - date          │
│ - membre        │         │ - heuresPrevues │
│ - heuresAllouees│         │ - heures        │
│ - dateDebut     │         │ - sheetStatus   │
│ - dateFin       │         │ - description   │
│ - modeRepartition        │ - imputation    │
└─────────────────┘         └─────────────────┘
```

### Flux de données

1. **Lecture** :
   ```javascript
   const assignments = await grist.docApi.fetchTable('TaskAssignments');
   const entries = await grist.docApi.fetchTable('TimeEntries');
   const capacities = await buildCapacitiesFromTeam(assignments.memberId);
   ```

2. **Calcul** :
   ```javascript
   const plan = buildAssignmentPlan({
     assignment,
     capacities,
     existingEntries: entries
   });
   
   const operations = reconcileDailyEntries(entries, plan.desiredPlan);
   ```

3. **Écriture** :
   ```javascript
   for (const create of operations.creates) {
     await grist.docApi.addRecord('TimeEntries', create);
   }
   for (const update of operations.updates) {
     await grist.docApi.updateRecord('TimeEntries', update.id, update.fields);
   }
   for (const del of operations.deletes) {
     await grist.docApi.removeRecord('TimeEntries', del.id);
   }
   ```

### Migration progressive

1. **Phase 1** (actuelle) :
   - Conserver `Tasks.charges` pour rétrocompatibilité
   - Nouveau noyau métier en parallèle

2. **Phase 2** :
   - Créer `TaskAssignments` en parallèle de `Tasks.charges`
   - Synchronisation bidirectionnelle

3. **Phase 3** :
   - Bascule complète vers `TaskAssignments`
   - Dépréciation de `Tasks.charges`

## API publique

### `buildAssignmentPlan(input)`

**Entrée** :
- `assignment` : Affectation avec id, taskId, memberId, allocatedHours, startDate, endDate
- `capacities` : Tableau de capacités par date
- `existingEntries` : Entrées existantes
- `replanFromDate` : Date de début de replanification (optionnel)
- `precisionHours` : Précision (défaut: 0,01)
- `capacityPolicy` : "cap" (défaut)

**Sortie** :
- `desiredPlan` : Tableau de nouvelles entrées planifiées
- `summary` : Totaux (allouées, validées, réservées, restantes, etc.)
- `diagnostics` : Messages d'avertissement

### `reconcileDailyEntries(existingEntries, desiredPlan, options)`

**Entrée** :
- `existingEntries` : Entrées existantes
- `desiredPlan` : Plan désiré
- `options.precisionHours` : Précision (défaut: 0,01)

**Sortie** :
- `creates` : Nouvelles entrées à créer
- `updates` : Entrées à mettre à jour
- `deletes` : Entrées à supprimer
- `conflicts` : Conflits détectés

### `validateTimesheet(input)`

**Entrée** :
- `memberId` : ID du membre
- `weekStart` : Date de début de semaine
- `entries` : Entrées de temps (taskId, date, actualHours)
- `capacities` : Capacités par date
- `precisionHours` : Précision (défaut: 0,01)

**Sortie** :
- `valid` : booléen
- `dailyTotals` : Totaux par jour
- `errors` : Erreurs de validation (avec codes stables)

## Codes d'erreur de validation

| Code | Description |
|------|-------------|
| `NEGATIVE_ACTUAL_HOURS` | Heures réalisées négatives |
| `DAILY_CAPACITY_EXCEEDED` | Total quotidien > capacité disponible |
| `MISSING_CAPACITY` | Capacité non définie pour une date |
| `INVALID_DATE` | Format de date invalide |
| `DUPLICATE_DAILY_ENTRY` | Deux entrées pour même tâche et date |

## Exemples de scénarios

### Scénario 1 : Distribution normale

- Allocation : 35h sur 10 jours ouvrés
- Capacité : 7h/jour
- Résultat : 3,50h/jour

### Scénario 2 : Avec réalisé validé

- Allocation : 100h
- 50 jours validés à 1h = 50h consommées
- 10 jours validés à 0h = 0h consommées
- 40 jours restants
- Résultat : 1,25h/jour sur les 40 jours

### Scénario 3 : Surconsommation

- Allocation : 35h
- Réalisé validé : 40h
- Résultat :
  - Aucun plan futur
  - `overconsumedHours = 5h`

### Scénario 4 : Capacité insuffisante

- Allocation : 100h
- Capacité totale disponible : 35h
- Résultat :
  - 35h planifiées
  - `unplannedHours = 65h`

## Notes d'implémentation

### UTC et dates

- Toutes les dates sont manipulées en UTC
- Format : `YYYY-MM-DD` (chaîne)
- Pas de dépendance au fuseau horaire local

### Précision numérique

- Calculs internes en **centièmes d'heure** (entiers)
- Conversion : `1h = 100 centièmes`
- Évite les erreurs d'arrondi flottant

### Déterminisme

- Aucune dépendance à `Date.now()`
- Aucune dépendance au fuseau horaire
- Mêmes entrées → mêmes sorties (reproductible)
