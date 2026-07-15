# Corrections - Création et validation des colonnes Ref

## Problème résolu

Lors de la première installation sur un document Grist neuf, les colonnes `Ref` n'étaient pas créées ou n'étaient pas visibles dans les métadonnées au moment de la validation :

```text
missingColumns:
- Entites.parent
- Entites.chef
- Team.entite
- Team.responsable
- Programmes.responsable
- Projects.programme
```

## Corrections appliquées

### 1. Renforcement de `waitForTablesMetadata()` (taskflow-core.js)

**Fichier** : `core/taskflow-core.js`  
**Lignes** : 81-133

**Changements** :
- Vérifie maintenant que `fetchTable(tableId)` réussit pour chaque table
- Retourne `{ success, missing, unavailable, attempts }`
- Distingue les tables manquantes des tables non disponibles

**Avant** :
```js
if (missing.length === 0) {
    await delay(300);
    return { success: true, missing: [] };
}
```

**Après** :
```js
if (missing.length === 0 && unavailable.length === 0) {
    await delay(300);
    return { 
        success: true, 
        missing: [],
        unavailable: [],
        attempts: attempt + 1
    };
}
```

### 2. Retry des erreurs transitoires dans `addColumn()` (taskflow-bootstrap.js)

**Fichier** : `core/schema/taskflow-bootstrap.js`  
**Lignes** : 333-359

**Changements** :
- Détecte les erreurs transitoires Grist :
  - `NoneType`
  - `table_id`
  - `table not found`
  - `unknown table`
  - `invalid table`
- Réessaie avec délai progressif : `300 * (retryCount + 1)` ms
- Relance l'erreur après `maxRetries`

**Avant** :
```js
if (msg.indexOf('already exists') !== -1 && retryCount < maxRetries) {
    await delay(200 * (retryCount + 1));
    return addColumn(grist, tableId, colDef, retryCount + 1);
}
```

**Après** :
```js
var isTransientError = 
    msg.indexOf('already exists') !== -1 ||
    msg.indexOf('NoneType') !== -1 ||
    msg.indexOf('table_id') !== -1 ||
    msg.indexOf('table not found') !== -1 ||
    msg.indexOf('unknown table') !== -1 ||
    msg.indexOf('invalid table') !== -1;

if (isTransientError && retryCount < maxRetries) {
    await delay(300 * (retryCount + 1));
    return addColumn(grist, tableId, colDef, retryCount + 1);
}
```

### 3. Nouvelle fonction `waitForReferenceColumns()` (taskflow-bootstrap.js)

**Fichier** : `core/schema/taskflow-bootstrap.js`  
**Lignes** : 448-515

**Fonction** : Attend que toutes les colonnes `Ref` soient visibles avec leur type correct

**Vérifications** :
- Toutes les colonnes `Ref` du schéma sont présentes dans `_grist_Tables_column`
- Le type de chaque colonne correspond au type attendu (`Ref:TargetTable`)
- Retry avec délai progressif (20 tentatives max)

**Retour** :
```js
{
    success: true/false,
    missing: [],         // Colonnes absentes
    invalid: [],         // Colonnes avec type incorrect
    attempts: number
}
```

### 4. Synchronisation explicite après la passe 2 (taskflow-bootstrap.js)

**Fichier** : `core/schema/taskflow-bootstrap.js`  
**Lignes** : 903-927

**Changements** :
- Appel de `waitForReferenceColumns()` immédiatement après `ensureRefColumns()`
- Arrêt de l'initialisation si la synchronisation échoue
- Log détaillé des tentatives

**Code ajouté** :
```js
// Synchronisation des colonnes Ref
log('Synchronisation des colonnes Ref...');
var refSync = await waitForReferenceColumns(grist, SCHEMA, options.formulasMap || {}, {
    maxAttempts: 20,
    baseDelay: 200
});

if (!refSync.success) {
    result.errors.push({
        phase: 'ref-sync',
        error: refSync.error,
        attempts: refSync.attempts
    });
    result.success = false;
    return result;
}

log('Références stabilisées après ' + refSync.attempts + ' tentatives');
```

### 5. Échec bloquant si la passe Ref échoue (taskflow-bootstrap.js)

**Fichier** : `core/schema/taskflow-bootstrap.js`  
**Lignes** : 896-902

**Changement** :
- Les erreurs de `phase2` ne sont plus de simples warnings
- Arrêt immédiat de l'initialisation avec `return result`

**Avant** :
```js
if (phase2.errors.length > 0) {
    result.warnings.push({ phase: 'refs', errors: phase2.errors });
}
```

**Après** :
```js
if (phase2.errors.length > 0) {
    result.errors.push({
        phase: 'refs',
        errors: phase2.errors
    });
    result.success = false;
    log('Échec création des colonnes Ref, arrêt de l\'initialisation');
    return result;
}
```

### 6. Délai et relecture avant validation (taskflow-bootstrap.js)

**Fichier** : `core/schema/taskflow-bootstrap.js`  
**Lignes** : 946-953

**Changements** :
- Délai de 300ms avant validation finale
- Relecture des métadonnées fraîches
- Affichage systématique des warnings dans la console

**Code ajouté** :
```js
// Délai de stabilisation avant validation
await delay(300);

// Relire les métadonnées fraîches
metadata = await loadSchemaMetadata(grist);
```

**Dans `initGenciSchema()` (kanban.html)** :
```js
if (result.warnings && result.warnings.length > 0) {
    console.warn('[GENCI] Warnings:', result.warnings);
}
```

## Résultat du build

```bash
npm run build:taskflow

🔨 Build TaskFlow...
📄 Lecture des fichiers core...
   4 fichiers lus, 95905 octets
📝 Injection dans kanban.html...
📝 Injection dans gantt.html...
📝 Injection dans plan.html...
📝 Injection dans calendar.html...
📝 Injection dans dashboard.html...
✅ Build terminé: 5/7 widgets mis à jour
```

## Vérifications dans le HTML généré

```bash
# Nouvelle fonction de synchronisation
grep -n "function waitForReferenceColumns" kanban.html
# → Ligne 2071

# Synchronisation après passe 2
grep -n "Synchronisation des colonnes Ref" kanban.html
# → Lignes 2532-2533

# Affichage des warnings
grep -n "console.warn.*Warnings" kanban.html
# → Ligne 3184
```

## Tests à effectuer

### Test 1 — Document Grist neuf

**Scénario** :
1. Créer un nouveau document Grist vierge
2. Ouvrir le widget Kanban
3. Observer l'initialisation automatique

**Résultats attendus** :
```text
[GENCI schema] Démarrage initialisation...
[GENCI schema] Phase 1: Création tables...
[GENCI tables] Création table: Competences (4 colonnes)
[GENCI tables] Création table: Entites (5 colonnes)
[GENCI tables] Création table: Team (10 colonnes)
...
[GENCI schema] Phase 2: Colonnes Ref...
[GENCI refs] Ajout colonne: Entites.parent (Ref:Entites)
[GENCI refs] Ajout colonne: Entites.chef (Ref:Team)
...
[GENCI sync] Synchronisation des colonnes Ref (18 colonnes)...
[GENCI sync] Toutes les colonnes Ref sont présentes et correctes
[GENCI sync] Références stabilisées après X tentatives
[GENCI schema] Vérification finale...
[GENCI schema] Initialisation terminée (XXXXms)
Schéma GENCI prêt
```

**Vérifications** :
- ✅ Aucune erreur `NoneType`
- ✅ Les 6 colonnes critiques existent :
  - `Entites.parent`
  - `Entites.chef`
  - `Team.entite`
  - `Team.responsable`
  - `Programmes.responsable`
  - `Projects.programme`
- ✅ Les types sont corrects (`Ref:TargetTable`)
- ✅ La validation passe sans `missingColumns`

### Test 2 — Changement de vue et retour

**Scénario** :
1. Après initialisation réussie (Test 1)
2. Quitter la vue Kanban
3. Revenir au Kanban

**Résultats attendus** :
```text
[Kanban] Checking if schema exists...
[Kanban] ✓ Schéma GENCI déjà initialisé et valide
[Kanban] → Schema already initialized, skip init
```

**Vérifications** :
- ✅ Aucun message `[GENCI schema] Démarrage initialisation...`
- ✅ Aucune nouvelle création de tables
- ✅ Aucune nouvelle création de colonnes
- ✅ Le Kanban se charge directement

## Fichiers modifiés

| Fichier | Lignes modifiées | Changement principal |
|---------|------------------|----------------------|
| `core/taskflow-core.js` | 81-133 | `waitForTablesMetadata()` renforcé |
| `core/schema/taskflow-bootstrap.js` | 333-359 | `addColumn()` avec retry transitoire |
| `core/schema/taskflow-bootstrap.js` | 448-515 | `waitForReferenceColumns()` (nouveau) |
| `core/schema/taskflow-bootstrap.js` | 896-927 | Synchronisation après passe 2 |
| `core/schema/taskflow-bootstrap.js` | 946-953 | Délai avant validation |
| `kanban.html` (généré) | 2071+ | Fonctions injectées |
| `kanban.html` (généré) | 2532+ | Appel synchronisation |
| `kanban.html` (généré) | 3184 | Affichage warnings |

## Prochaines étapes

1. **Tester sur document neuf** dans Grist
2. **Vérifier les 6 colonnes critiques** dans `_grist_Tables_column`
3. **Tester l'idempotence** (changement de vue et retour)
4. **Reporter toute erreur** dans `phase2.errors` ou `ref-sync`

## Limites de cette correction

Cette correction ne traite PAS encore :
- ❌ Le seed des données de démonstration
- ❌ Les migrations `Portefeuilles` → `Programmes`
- ❌ La validation avancée des `visibleCol`
- ❌ L'écriture dans `TaskFlow_Meta`
- ❌ La fusion des définitions du schéma
- ❌ La suppression de l'ancien `ensureSchema()`

Ces points feront l'objet de corrections ultérieures.
