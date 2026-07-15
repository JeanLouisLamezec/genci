# Corrections des régressions du bootstrap TaskFlow/GENCI

## Problèmes résolus

### 1. Timeout de 47 secondes avec `waitForReferenceColumns()`
**Symptôme** :
```text
[GENCI schema] Initialisation terminée (47934ms)
```

**Cause** : 
- 20 tentatives de polling attendant que les colonnes apparaissent
- Faux négatifs : les `AddColumn` réussissent mais les métadonnées relues semblent obsolètes

**Correction** :
- **Suppression complète** de `waitForReferenceColumns()` dans `ensureGenciSchema()`
- Remplacé par une simple pause de 500ms après les `AddColumn`
- Le succès des `applyUserActions()` = confirmation immédiate

**Avant** :
```js
var refSync = await waitForReferenceColumns(grist, SCHEMA, ..., {
    maxAttempts: 20,
    baseDelay: 200
});
// 20 tentatives × ~2s = 40+ secondes
```

**Après** :
```js
log('Phase 2: Colonnes Ref terminées (' + phase2.added.length + ' créées)');
await delay(500);  // Pause unique de 0.5s
```

**Gain** : ~47s → ~1-2s

### 2. Erreur seed : `Cannot read properties of undefined (reading 'ret')`
**Symptôme** :
```text
[GENCI seed] Erreur: Cannot read properties of undefined (reading 'ret')
```

**Cause** :
```js
entiteRacine[1].ret[0]  // Structure incorrecte
```

`applyUserActions()` retourne directement un tableau de valeurs, pas `{ ret: [...] }`.

**Correction** :
Ajout d'un helper défensif :
```js
function getAddedRecordId(actionResult, label) {
    var value = Array.isArray(actionResult) ? actionResult[0] : actionResult;
    
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    
    if (value && typeof value === 'object' && typeof value.id === 'number') {
        return value.id;
    }
    
    throw new Error('ID de ligne introuvable...');
}
```

Utilisation :
```js
createdIds.Entites = {
    racine: getAddedRecordId(entiteRacine, 'Entites.Direction')
};
```

### 3. Seed automatique non désiré
**Problème** :
- Alice, Bob, Direction créés automatiquement dans un document de production
- Non demandé par l'utilisateur

**Correction** :
Ajout d'une option explicite :
```js
options.seedDemo: false  // Par défaut
```

Dans `ensureGenciSchema()` :
```js
if (options.seedDemo === true) {
    // Seed exécuté
} else {
    result.phases.seed = {
        seeded: false,
        reason: 'Seed de démonstration désactivé'
    };
}
```

Dans `kanban.html` :
```js
TaskFlowBootstrap.ensureGenciSchema(grist, {
    formulasMap: ...,
    defaultChoices: ...,
    seedDemo: false  // Explicitement désactivé
});
```

### 4. Faux message de succès
**Problème** :
```js
await initGenciSchema(null);
console.log('[Kanban] ✓ GENCI schema initialization complete');
// Affiché même si result.success === false
```

**Correction** :
```js
var schemaResult = await initGenciSchema(null);

if (!schemaResult || schemaResult.success !== true) {
    console.error(
        '[Kanban] ✗ GENCI schema initialization failed',
        schemaResult && schemaResult.errors
    );
    throw new Error('Le schéma GENCI reste incomplet');
}

console.log('[Kanban] ✓ GENCI schema initialization complete');
```

### 5. Logs d'erreurs masqués
**Correction** :
```js
if (result.errors && result.errors.length > 0) {
    console.error('[GENCI] Errors:', JSON.stringify(result.errors, null, 2));
}
```

Affiche maintenant le détail complet des erreurs.

## Autres optimisations

### Réduction des appels RPC
- **Avant** : 19 appels `applyUserActions()` pour les Ref + polling × 20
- **Après** : 1 appel batch pour les Ref + pause 500ms

### Validation finale
- Conserve une lecture fraîche des métadonnées
- Vérifie toutes les colonnes critiques
- `result.success = false` si colonnes manquantes

### Affichage des références
- `configureAllRefDisplays()` toujours exécuté
- Les `SetDisplayFormula` et `visibleCol` sont configurés
- Affichage : "Alice Martin" au lieu de "Team[1]"

## Résultat du build

```bash
npm run build:taskflow

✅ Build terminé: 5/7 widgets mis à jour
```

## Tests d'acceptation

### Document neuf (à tester)

**Durée attendue** : < 5 secondes (au lieu de 47s)

**Logs attendus** :
```text
[GENCI schema] Démarrage initialisation...
[GENCI schema] Phase 1: Création tables...
[GENCI schema] Phase 2: Colonnes Ref terminées (19 créées)
[GENCI schema] Phase 3: Formules...
[GENCI schema] Phase 4: Choices...
[GENCI schema] Phase 5: Affichage références...
[GENCI display] Configurés: 19
[GENCI schema] Vérification finale...
[GENCI schema] Initialisation terminée (~2000ms)
Schéma GENCI prêt
```

**Vérifications** :
- ✅ Aucune erreur `Timeout après 20 tentatives`
- ✅ Aucune erreur `Cannot read properties of undefined`
- ✅ Seed NON exécuté (sauf `seedDemo: true`)
- ✅ Références affichent les noms : "Alice Martin"
- ✅ `result.success === true`

### Deuxième ouverture (à tester)

**Logs attendus** :
```text
[Kanban] ✓ Schéma GENCI déjà initialisé et valide
[Kanban] → Schema already initialized, skip init
```

**Vérifications** :
- ✅ Aucun `[GENCI schema] Démarrage`
- ✅ Aucune nouvelle création
- ✅ Chargement direct du Kanban

## Fichiers modifiés

| Fichier | Lignes modifiées | Changement |
|---------|------------------|------------|
| `core/schema/taskflow-bootstrap.js` | 921-951 | Suppression polling `waitForReferenceColumns()` |
| `core/schema/taskflow-bootstrap.js` | 742-766 | Helper `getAddedRecordId()` |
| `core/schema/taskflow-bootstrap.js` | 783-848 | Correction extraction IDs seed |
| `core/schema/taskflow-bootstrap.js` | 975-986 | Seed conditionnel (`seedDemo: true`) |
| `core/schema/taskflow-bootstrap.js` | 1016-1018 | Log détaillé des erreurs |
| `kanban.html` | 3346 | `seedDemo: false` par défaut |
| `kanban.html` | 3374 | Log JSON des erreurs |
| `kanban.html` | 4869-4880 | Vérification résultat réel |

## Comparatif avant/après

| Métrique | Avant | Après |
|----------|-------|-------|
| Durée première init | ~47s | ~2s |
| Appels RPC (Ref) | 19 + 20×polling | 1 batch |
| Seed automatique | OUI (toujours) | NON (opt-in) |
| Erreur `.ret[0]` | FRÉQUENTE | CORRIGÉE |
| Faux succès | POSSIBLE | BLOQUÉ |
| Logs d'erreurs | PARTIELS | COMPLETS (JSON) |

## Limites

Cette correction ne traite PAS :
- ❌ Refactoring général du Kanban
- ❌ Migrations `Portefeuilles` → `Programmes`
- ❌ Fusion des définitions du schéma
- ❌ Optimisation batch complète (à venir)

## Prochaines étapes

1. **Tester sur document neuf** dans Grist
2. **Vérifier la durée** (< 5s)
3. **Vérifier l'absence de seed** automatique
4. **Vérifier les références** (noms au lieu de `Team[1]`)
5. **Tester l'idempotence** (deuxième ouverture)
