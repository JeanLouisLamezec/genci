# Correction de la régression `waitForReferenceColumns()`

## Problème résolu

**Symptômes** :
```text
[GENCI] Errors: {
    phase: 'ref-sync',
    error: 'Timeout après 20 tentatives',
    attempts: 20
}
```

Et les références Grist affichaient à nouveau :
```text
Team[1]
Tasks[1]
```

au lieu des noms/titres.

## Causes identifiées

1. **Arrêt prématuré de l'initialisation** :
   - `ref-sync` en échec provoquait un `return result` immédiat
   - La phase `configureAllRefDisplays()` n'était jamais atteinte
   - Les `SetDisplayFormula` et `visibleCol` n'étaient pas configurés

2. **Synchronisation trop stricte** :
   - `waitForReferenceColumns()` échouait si les types n'étaient pas parfaits
   - Confondait "colonne absente" et "type incorrect"
   - N'enregistrait pas les dernières valeurs de `missing` et `invalid`

## Corrections appliquées

### 1. `waitForReferenceColumns()` - Correction du synchroniseur

**Fichier** : `core/schema/taskflow-bootstrap.js`  
**Lignes** : 448-527

**Changements** :

**a) Distinction existence/type** :
```js
// Avant : échec si missing OU invalid
if (missing.length === 0 && invalid.length === 0) {
    return { success: true, ... };
}

// Après : succès si colonnes existent (types vérifiés séparément)
if (missing.length === 0) {
    return {
        success: true,
        missing: [],
        invalid: invalid,  // Types incorrects retournés mais ne bloquent pas
        attempts: attempt + 1
    };
}
```

**b) Conservation des dernières valeurs** :
```js
var lastMissing = [];
var lastInvalid = [];

// À chaque tentative
lastMissing = missing.slice();
lastInvalid = invalid.slice();

// Retour en cas de timeout
return {
    success: false,
    error: 'Timeout après ' + attempt + ' tentatives',
    attempts: attempt,
    missing: lastMissing,  // Détail des colonnes manquantes
    invalid: lastInvalid   // Détail des types incorrects
};
```

**c) Logging amélioré** :
```js
if (missing.length > 0) {
    log('[GENCI sync] Colonnes Ref manquantes: ' + missing.join(', '));
}
// Types incorrects logués séparément
if (invalid.length > 0) {
    log('[GENCI sync] Types incorrects détectés (seront réparés): ' + invalid.length);
}
```

### 2. `ensureGenciSchema()` - Non-interruption avant l'affichage

**Fichier** : `core/schema/taskflow-bootstrap.js`  
**Lignes** : 921-941

**Changement** :
```js
// AVANT : Arrêt immédiat
if (!refSync.success) {
    result.errors.push({ phase: 'ref-sync', ... });
    result.success = false;
    return result;  // ❌ configureAllRefDisplays() jamais atteint
}

// APRÈS : Warning et poursuite
if (!refSync.success) {
    result.warnings.push({
        phase: 'ref-sync',
        error: refSync.error,
        attempts: refSync.attempts,
        missing: refSync.missing || [],
        invalid: refSync.invalid || []
    });
    
    log('[GENCI sync] Synchronisation incomplète, poursuite de la configuration des références');
}

// La phase suivante est TOUJOURS exécutée
var phase5 = await configureAllRefDisplays(grist, GENCI_REF_DISPLAY_SPECS);
```

**Résultat** :
- `configureAllRefDisplays()` est maintenant TOUJOURS appelé
- Les `SetDisplayFormula` et `visibleCol` sont configurés même si certaines colonnes manquent
- La validation finale décidera si le schéma est réellement prêt

### 3. Validation finale préservée

**Fichier** : `core/schema/taskflow-bootstrap.js`  
**Lignes** : 987-1016

Aucun changement : la validation finale reste stricte :
- Vérifie l'existence des colonnes obligatoires
- Vérifie les types
- Vérifie les `visibleCol`
- `result.success = false` si colonnes manquantes

La différence : l'affichage des références est maintenant tenté même avec des warnings.

## Résultat du build

```bash
npm run build:taskflow

✅ Build terminé: 5/7 widgets mis à jour
```

**Vérifications dans le HTML** :
- ✅ Ligne ~2540 : `if (!refSync.success)` avec warning (pas de `return`)
- ✅ Ligne ~2547 : `log('[GENCI sync] Synchronisation incomplète, poursuite...')`
- ✅ Ligne ~2557 : `configureAllRefDisplays()` toujours appelé

## Tests à effectuer

### Test 1 — Document existant (régression)

**Scénario** :
1. Ouvrir le document Grist actuel
2. Menu "Plus" → "Initialiser le schéma GENCI"
3. Observer les logs console

**Résultats attendus** :
```text
[GENCI schema] Phase 2: Colonnes Ref...
[GENCI sync] Synchronisation des colonnes Ref...
[GENCI sync] Toutes les colonnes Ref sont présentes (X tentatives)
[GENCI schema] Phase 5: Affichage références...
[GENCI display] Configurés: X
[GENCI schema] Initialisation terminée
Schéma GENCI prêt
```

**Vérifications dans Grist** (vues natives) :
- ✅ `Programmes.responsable` → "Alice Martin" (PAS "Team[1]")
- ✅ `Projects.programme` → "Transformation Digitale" (PAS "Programmes[1]")
- ✅ `Entites.chef` → "Alice Martin"
- ✅ `Actions.assignee` → "Alice Martin"
- ✅ `Tasks.projet` → "Projet Alpha"

### Test 2 — Document neuf

**Scénario** :
1. Nouveau document Grist vierge
2. Ouvrir Kanban
3. Initialisation automatique

**Résultats attendus** :
```text
[GENCI sync] Toutes les colonnes Ref sont présentes (X tentatives)
[GENCI sync] Types incorrects détectés (seront réparés): 0
[GENCI display] Configurés: 18
Schéma GENCI prêt
```

**Vérifications** :
- ✅ Toutes les colonnes Ref créées
- ✅ Tous les `visibleCol` configurés
- ✅ Affichages humains : noms/titres au lieu de `Table[1]`

### Test 3 — Idempotence

**Scénario** :
1. Après initialisation réussie
2. Quitter la vue Kanban
3. Revenir

**Résultats attendus** :
```text
[Kanban] ✓ Schéma GENCI déjà initialisé et valide
[Kanban] → Schema already initialized, skip init
```

**Vérifications** :
- ✅ Aucun nouveau `[GENCI schema] Démarrage`
- ✅ Aucune nouvelle configuration d'affichage
- ✅ Les références restent lisibles

## Rapport attendu après test

À remplir après exécution dans Grist :

### Références dans `missing` :
```
[Liste des colonnes manquantes, ex: Entites.parent]
```

### Références dans `invalid` :
```
[Liste des types incorrects, ex: {key: "Team.entite", expected: "Ref:Entites", actual: "Text"}]
```

### Pourquoi le synchroniseur arrivait au timeout :
```
[Explication : colonnes manquantes ou types incorrects ?]
```

### Phase d'affichage exécutée :
- [ ] OUI : `configureAllRefDisplays()` atteint
- [ ] NON : bloqué avant

### Valeurs `Team[1]` :
- [ ] DISPARUES : remplacées par les noms
- [ ] PRÉSENTES : problème persistant

## Limites de cette correction

Cette correction ne traite QUE :
- ✅ Non-interruption avant `configureAllRefDisplays()`
- ✅ Synchronisation moins stricte (existence vs type)
- ✅ Conservation des détails d'erreur

Ne traite PAS :
- ❌ Seed des données
- ❌ Migrations
- ❌ TaskFlow_Meta
- ❌ Refactoring général du Kanban
- ❌ Fusion des définitions du schéma

## Fichiers modifiés

| Fichier | Lignes | Changement |
|---------|--------|------------|
| `core/schema/taskflow-bootstrap.js` | 448-527 | `waitForReferenceColumns()` réécrit |
| `core/schema/taskflow-bootstrap.js` | 921-941 | Non-interruption avant affichage |
| `kanban.html` (généré) | ~2540 | Code injecté |

## Conclusion

La phase d'affichage des références est maintenant **garantie** d'être exécutée, même avec des warnings de synchronisation. Les libellés humains (`Alice Martin` au lieu de `Team[1]`) devraient être restaurés.
