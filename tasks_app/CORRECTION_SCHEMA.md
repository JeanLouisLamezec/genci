# Correction durable de l'initialisation du schéma GENCI/TaskFlow

## Cause racine du problème

L'erreur `AttributeError: 'NoneType' object has no attribute 'table_id'` était causée par la création de colonnes `Ref` et `RefList` **avant** que toutes les tables cibles ne soient enregistrées dans `_grist_Tables`.

### Problèmes identifiés

1. **Ordre de création incorrect** : Les tables étaient créées avec TOUTES leurs colonnes (y compris Ref) en une seule opération `AddTable`, alors que les tables cibles des Ref n'existaient pas encore.

2. **Dépendances circulaires** : 
   - `Entites.chef` → Ref:Team
   - `Team.entite` → Ref:Entites
   
   Ces deux tables se référencent mutuellement, rendant impossible un simple réordonnancement.

3. **Synchronisation insuffisante** : Un délai fixe de 2 secondes n'était pas une garantie suffisante que les métadonnées Grist étaient stabilisées.

4. **Deux implémentations divergentes** : `ensureSchema()` et `initGenciSchema()` avaient des logiques différentes, causant des incohérences.

5. **Vérification trop légère** : La vérification du schéma ne validait pas :
   - Le type EXACT des colonnes Ref
   - La présence des tables cibles
   - La correction des `visibleCol`

## Nouvelle stratégie multipasse

### Architecture générale

```
ensureGenciSchema() [orchestrateur]
  │
  ├─ Passe 0: Migration et inspection
  │   └─ Renommer Portefeuilles → Programmes si nécessaire
  │
  ├─ Passe 1: Création des tables (SANS Ref)
  │   └─ Uniquement colonnes Text, Choice, Bool, Int, Numeric, Date
  │
  ├─ Synchronisation
  │   └─ waitForTablesMetadata() avec polling et relecture
  │
  ├─ Passe 2: Colonnes Ref et RefList
  │   ├─ Ajout des colonnes manquantes
  │   └─ Réparation des types incorrects
  │
  ├─ Passe 3: Colonnes formules
  │   └─ Uniquement après existence des Ref nécessaires
  │
  ├─ Passe 4: Configuration des Choices
  │   └─ Respect des personnalisations existantes
  │
  ├─ Passe 5: Affichage des références
  │   └─ visibleCol + display formula
  │
  └─ Phase 6: Seed (seulement si tables vides)
      └─ Données de démonstration avec vrais IDs
```

### Fonctions clés

#### 1. Helpers de type (taskflow-core.js)

```javascript
TF.isRefType(type)        // Test strict: /^(Ref|RefList):/
TF.getRefTarget(type)     // Extrait: "Ref:Team" → "Team"
TF.waitForTablesMetadata(grist, expectedTables, options)
                          // Polling avec relecture et délai de stabilisation
```

#### 2. Inspection complète (taskflow-bootstrap.js)

```javascript
TaskFlowBootstrap.inspectGenciSchema(grist, requiredTables)
// Retourne :
{
  ready: boolean,
  missingTables: [],
  missingColumns: [],
  invalidColumnTypes: [],      // Type incorrect (ex: Text au lieu de Ref)
  invalidRefTargets: [],       // Table cible manquante
  invalidVisibleColumns: [],   // visibleCol incorrect
  missingFormulaColumns: []
}
```

#### 3. Affichage robuste des références

```javascript
TaskFlowBootstrap.setRefDisplayColumns(grist, specs)
// Retourne un rapport détaillé :
{
  ok: boolean,
  configured: [],      // Configurés avec succès
  alreadyCorrect: [],  // Déjà corrects (idempotence)
  skipped: [],         // Ignorés (table/colonne manquante)
  errors: []           // Erreurs détaillées
}
```

**Vérifications effectuées** :
1. Table source existe
2. Colonne Ref existe
3. Type est bien `Ref:*` ou `RefList:*`
4. Table cible existe
5. Colonne visible cible existe
6. visibleCol pointe vers le BON ID (comparaison numérique)
7. Display formula est correcte

#### 4. Seed sécurisé

```javascript
seedInitialData(grist, context)
// Vérifie :
// 1. Tasks est vide (aucune donnée métier)
// 2. Tables viennent d'être créées
// 3. Utilise les IDs retournés par AddRecord (PAS de IDs en dur)
```

**Exemple** :
```javascript
// AVANT (incorrect)
['AddRecord', 'Entites', null, { parent: 1 }]  // ❌ Suppose ID=1

// APRÈS (correct)
var entite = await grist.docApi.applyUserActions([
  ['AddRecord', 'Entites', null, { nom: 'Direction' }]
]);
var entiteId = entite[1].ret[0];  // ✅ Vrai ID

['AddRecord', 'Entites', null, { parent: entiteId }]
```

## Fichiers modifiés

### 1. `/tasks_app/core/taskflow-core.js`

**Ajouts** :
- `isRefType(type)` : Test strict des types Ref
- `getRefTarget(type)` : Extraction de la table cible
- `waitForTablesMetadata(grist, expectedTables, options)` : Polling de stabilisation
- `setRefDisplayColumns(grist, specs)` : Version renforcée avec rapport

**Modifications** :
- Export des nouveaux helpers dans l'objet `TF`

### 2. `/tasks_app/core/schema/taskflow-bootstrap.js`

**Réécriture complète** avec :
- `ensureGenciSchema(grist, options)` : Orchestrateur multipasse
- `inspectGenciSchema(grist, requiredTables)` : Inspection complète
- `migrateLegacyTables(grist)` : Migration Portefeuilles → Programmes
- `loadSchemaMetadata(grist)` : Chargement des métadonnées
- `ensureBaseTables(grist, schema, formulas)` : Passe 1 (tables sans Ref)
- `ensureRefColumns(grist, schema, formulas)` : Passe 2 (Ref)
- `ensureFormulaColumns(grist, formulas)` : Passe 3 (formules)
- `configureChoiceColumns(grist, choices)` : Passe 4 (Choices)
- `configureAllRefDisplays(grist, specs)` : Passe 5 (affichage)
- `seedInitialData(grist, context)` : Seed sécurisé
- `GENCI_REF_DISPLAY_SPECS` : Spécifications centralisées

**Suppression** :
- Ancienne logique `ensureSchema()` monolithique
- Délais fixes arbitraires
- Créations aveugles de tables/colonnes

### 3. `/tasks_app/kanban.html`

**Modifications** :
- `initGenciSchema(btn)` : Wrapper vers `TaskFlowBootstrap.ensureGenciSchema()`
- Inspection au démarrage utilise `TaskFlowBootstrap.inspectGenciSchema()`
- Conserve `GENCI_FULL_SCHEMA`, `GENCI_DERIVED_FORMULAS`, `GENCI_DEFAULT_CHOICES` pour rétrocompatibilité

### 4. `/tasks_app/scripts/build-taskflow.js`

**Aucun changement** : Script de build inchangé, fonctionne correctement.

### 5. `/tasks_app/core/schema/taskflow-schema.js`

**Aucun changement majeur** : Le schéma déclaratif est déjà correct.

## Garantie de non-régression

### Idempotence

Toutes les fonctions sont idempotentes :
- Vérifient l'existant avant de créer
- Ne modifient pas ce qui est déjà correct
- Supportent plusieurs exécutions consécutives sans effet secondaire

### Compatibilité

- **Documents existants** : Les tables/colonnes existantes ne sont PAS recréées
- **Documents partiellement initialisés** : Seules les parties manquantes sont ajoutées
- **Anciens documents** : Migration automatique `Portefeuilles` → `Programmes`

### Qualité des références

Les colonnes de référence sont maintenant :
1. Créées APRÈS existence de TOUTES les tables
2. Vérifiées avec leur type EXACT
3. Réparées si nécessaire (avec vérification de la table cible)
4. Configurées avec le bon `visibleCol`
5. Validées après configuration

## Logs et débogage

### Structure des logs

```
[GENCI schema]          // Messages globaux
[GENCI tables]          // Création de tables
[GENCI refs]            // Colonnes de référence
[GENCI sync]            // Synchronisation
[GENCI formulas]        // Colonnes formules
[GENCI display]         // Affichage des références
[GENCI seed]            // Données de démonstration
[GENCI validation]      // Vérification finale
```

### Exemple de sortie réussie

```
[GENCI schema] Démarrage initialisation...
[GENCI schema] Phase 0: Migration...
[GENCI tables] Migration: Renamed Portefeuilles → Programmes
[GENCI schema] Phase 1: Création tables...
[GENCI tables] Création table: Competences (4 colonnes)
[GENCI tables] Création table: Entites (5 colonnes)
[GENCI tables] Création table: Team (10 colonnes)
[GENCI schema] Phase 2: Colonnes Ref...
[GENCI refs] Ajout colonne: Entites.parent (Ref:Entites)
[GENCI refs] Ajout colonne: Entites.chef (Ref:Team)
[GENCI refs] Ajout colonne: Team.entite (Ref:Entites)
[GENCI schema] Phase 3: Formules...
[GENCI schema] Phase 4: Choices...
[GENCI schema] Phase 5: Affichage références...
[GENCI display] Configuration affichage références...
[GENCI display] Configurés: 18
[GENCI schema] Phase 6: Seed...
[GENCI seed] Tables vides — création données de démonstration...
[GENCI schema] Vérification finale...
[GENCI schema] Initialisation terminée (3421ms)
```

### Exemple d'erreur

```
[GENCI refs] Type incorrect: Programmes.responsable 
  (attendu: Ref:Team, actuel: Text)
[GENCI refs] Tentative réparation...
[GENCI refs] ✓ Réussi
```

## Tests à effectuer

Voir `TESTS.md` pour la procédure complète.

### Scénarios critiques

1. **Document vide** : Initialisation complète sans erreur
2. **Idempotence** : 3 exécutions = aucun doublon
3. **Références** : Affichage de noms, pas d'IDs
4. **Réparation** : visibleCol incorrect → corrigé automatiquement
5. **Non-régression** : Kanban fonctionne parfaitement

## Conclusion

Cette correction résout durablement le problème en :

1. **Séparant** la création des tables et des références
2. **Validant** les métadonnées avec polling et relecture
3. **Vérifiant** chaque étape avec des rapports détaillés
4. **Réparant** les colonnes incorrectes au lieu de recréer
5. **Respectant** les données existantes et personnalisations
6. **Centralisant** la configuration dans une source unique

L'initialisation est maintenant :
- ✅ Robuste (gère les dépendances circulaires)
- ✅ Idempotente (exécutions multiples sans effet)
- ✅ Non destructive (respect des données)
- ✅ Vérifiée (inspection complète)
- ✅ Réparable (corrige les erreurs)
- ✅ Documentée (logs structurés)
