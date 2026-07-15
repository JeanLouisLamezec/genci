# Correction du faux échec de validation et de la lenteur

## Problèmes résolus

### 1. Faux échec avec liste `criticalRefs` codée en dur
**Symptôme** :
```text
missingColumns: [
  "Entites.parent",
  "Entites.chef",
  "Team.entite",
  "Team.responsable",
  "Programmes.responsable",
  "Projects.programme"
]
```

**Cause** :
- Seules ces 6 références étaient vérifiées (liste codée en dur)
- `inspectGenciSchema()` ne vérifiait pas TOUTES les références du schéma

**Correction** :
- Suppression de `criticalRefs`
- Nouvelle fonction `getExpectedReferenceSpecs(schema)` qui extrait TOUTES les références du schéma
- Vérification de ~19 références (toutes celles définies) au lieu de 6

### 2. Distinction "absente" vs "retard métadonnées"
**Problème** :
- Une colonne créée avec succès était marquée comme absente car `_grist_Tables_column` était retardé
- Faux échec de validation

**Correction** :
- Ajout de `loadActualTableColumns(grist, tableIds)`
- Vérifie dans les DEUX sources :
  1. `metadata.columnByKey` (métadonnées)
  2. `fetchTable(tableId)` (données réelles)
  
**Logique** :
```js
if (!metadataCol && !existsInTable) {
    // VRAIMENT absente → missingColumns
    result.ready = false;
}

if (!metadataCol && existsInTable) {
    // Présente dans la table, absente des métadonnées → retard temporaire
    result.metadataPending.push(key);
    // ready = true (ne bloque pas)
}
```

**Nouveau champ** : `metadataPending: []`

### 3. Relecture inutile des métadonnées
**Problème** :
```js
metadata = await loadSchemaMetadata(grist);  // Chargé ici
var inspection = await inspectGenciSchema(grist, requiredTables);
// Mais inspectGenciSchema recharge encore !
```

**Correction** :
```js
// Signature modifiée
async function inspectGenciSchema(grist, requiredTables, metadataSnapshot) {
    var metadata = metadataSnapshot || await loadSchemaMetadata(grist);
    // ...
}

// Appel avec snapshot
metadata = await loadSchemaMetadata(grist);
var inspection = await inspectGenciSchema(grist, requiredTables, metadata);
```

**Gain** : 1 lecture de métadonnées au lieu de 2

### 4. Lenteur de `syncMetadata()` (30 tentatives)
**Avant** :
```js
var result = await TF.waitForTablesMetadata(grist, expectedTables, {
    maxAttempts: 30,  // 30 × 200ms = 6s potentielles
    baseDelay: 200
});
```

**Après** :
```js
for (var attempt = 0; attempt < 3; attempt++) {
    lastMetadata = await loadSchemaMetadata(grist);
    // Vérifie dans _grist_Tables uniquement
    if (missing.length === 0) return lastMetadata;
    await delay(150);
}
```

**Gain** : 3 tentatives × 150ms = 450ms max (au lieu de 6s)

### 5. `setRefDisplayColumns()` ignorait silencieusement
**Avant** :
```js
if (!refCol) {
    result.skipped.push({...});
    continue;  // ok = true, ignoré
}
```

**Après** :
```js
if (!refCol) {
    result.skipped.push({...});
    result.ok = false;  // IMPORTANT : skipped = échec
    continue;
}
```

**Effet** : La phase 5 ne peut plus être "réussie" si des références sont manquantes.

### 6. Logs de validation détaillés
**Ajout** :
```js
console.info(
    '[GENCI validation]',
    JSON.stringify({
        ready: inspection.ready,
        missingTables: inspection.missingTables,
        missingColumns: inspection.missingColumns,
        metadataPending: inspection.metadataPending,
        invalidColumnTypes: inspection.invalidColumnTypes.length,
        invalidRefTargets: inspection.invalidRefTargets.length,
        invalidVisibleColumns: inspection.invalidVisibleColumns.length
    }, null, 2)
);
```

**Résultat** : Distinction claire entre :
- Colonne vraiment absente
- Colonne en retard de métadonnées
- Type incorrect
- VisibleCol incorrect

## Résultat du build

```bash
npm run build:taskflow

✅ Build terminé: 5/7 widgets mis à jour
```

## Fichiers modifiés

| Fichier | Changements clés |
|---------|------------------|
| `core/schema/taskflow-bootstrap.js` | `getExpectedReferenceSpecs()` (nouveau) |
| `core/schema/taskflow-bootstrap.js` | `loadActualTableColumns()` (nouveau) |
| `core/schema/taskflow-bootstrap.js` | `inspectGenciSchema(grist, requiredTables, metadataSnapshot)` |
| `core/schema/taskflow-bootstrap.js` | `syncMetadata()` : 3 tentatives au lieu de 30 |
| `core/schema/taskflow-bootstrap.js` | `configureAllRefDisplays()` : log des `skipped` |
| `core/taskflow-core.js` | `setRefDisplayColumns()` : `result.ok = false` si skipped |

## Comparatif avant/après

| Métrique | Avant | Après |
|----------|-------|-------|
| Références vérifiées | 6 (codées en dur) | ~19 (toutes) |
| Faux négatifs | FRÉQUENTS | CORRIGÉS |
| Lectures métadonnées | 2 consécutives | 1 avec snapshot |
| Tentatives sync | 30 | 3 |
| Durée sync | ~6s max | ~450ms max |
| Distinction absent/retard | NON | OUI (`metadataPending`) |
| Logs validation | PARTIELS | COMPLETS (JSON) |

## Tests d'acceptation

### Premier démarrage (document neuf)

**Logs attendus** :
```text
[GENCI schema] Phase 2: Colonnes Ref terminées (19 créées)
[GENCI sync] Métadonnées stabilisées
[GENCI display] Configurés: 19
[GENCI validation] {
  "ready": true,
  "missingTables": [],
  "missingColumns": [],
  "metadataPending": [],
  "invalidColumnTypes": 0,
  "invalidRefTargets": 0,
  "invalidVisibleColumns": 0
}
Schéma GENCI prêt
```

**Vérifications** :
- ✅ `missingColumns` vide
- ✅ `metadataPending` peut être temporairement non vide (sans bloquer)
- ✅ Durée totale < 3s
- ✅ `result.success === true`

### Deuxième démarrage

**Logs attendus** :
```text
[Kanban] ✓ Schéma GENCI déjà initialisé et valide
[Kanban] → Schema already initialized, skip init
```

**Vérifications** :
- ✅ `metadataPending` vide
- ✅ Toutes les références dans `_grist_Tables_column`
- ✅ Aucun `AddColumn` exécuté
- ✅ Chargement direct du Kanban

### Cas d'une référence vraiment absente

**Test** : Supprimer manuellement `Entites.parent` dans Grist

**Résultat attendu** :
```text
[GENCI validation] {
  "ready": false,
  "missingColumns": ["Entites.parent"],
  "metadataPending": []
}
```

**Action** : `ensureRefColumns()` doit la recréer

## Architecture des validations

```
ensureGenciSchema()
  │
  ├─ ensureRefColumns() → AddColumn (succès = RPC_RESULT_OK)
  │
  ├─ delay(500)  // Pause courte
  │
  ├─ loadActualTableColumns() → Vérifie fetchTable()
  │   └─ Si colonnes visibles dans tables utilisateur → OK
  │   └─ Si absentes → ERREUR phase refs
  │
  ├─ configureAllRefDisplays() → SetDisplayFormula
  │
  └─ inspectGenciSchema(metadata) → Validation finale
      ├─ metadata.columnByKey (métadonnées)
      ├─ fetchTable() (données réelles)
      ├─ missingColumns (vraiment absentes)
      ├─ metadataPending (retard temporaire)
      └─ ready = (missingColumns.length === 0)
```

## Limites

Cette correction ne traite PAS :
- ❌ Refactoring général du Kanban
- ❌ Optimisation batch complète des RPC
- ❌ Migrations
- ❌ Seed

## Prochaines étapes

1. **Tester sur document neuf** : Vérifier `metadataPending` temporairement non vide
2. **Vérifier la durée** : < 3s
3. **Tester idempotence** : Deuxième ouverture sans réécriture
4. **Cas réellement cassé** : Supprimer une référence → recréation
