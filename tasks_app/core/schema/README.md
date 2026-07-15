# TaskFlow Bootstrap — Nouvelle Architecture

## Vue d'ensemble

Ce dossier contient le système **unifié** d'initialisation et de migration du schéma de données TaskFlow.

### Problèmes résolus

1. **Duplication** : Chaque widget avait sa propre fonction `ensureSchema()`
2. **Concurrence** : Deux widgets ouverts simultanément pouvaient entrer en conflit
3. **Ordre d'ouverture** : Le Kanban devait être ouvert en premier
4. **État partiel** : Une fermeture prématurée laissait le schéma incomplet
5. **Références mal configurées** : `visibleCol` et `displayCol` non vérifiés

### Solution

Un **bootstrap unique** qui :
- Est **idempotent** (peut être appelé plusieurs fois sans effet secondaire)
- Est **résistant à la concurrence** (gère les conflits "table already exists")
- **Vérifie** le schéma réel et calcule la différence
- **Configure** correctement toutes les références
- **Écrit** la version installée seulement après succès complet

---

## Fichiers

### `taskflow-schema.js`

**Source de vérité déclarative du schéma.**

Contient :
- `SCHEMA_VERSION` : version courante (à incrémenter à chaque changement)
- `TABLE_ORDER` : ordre de création des tables
- `TABLES` : définition complète de chaque table et colonne
- `REFERENCE_DISPLAYS` : configuration de l'affichage humain des références
- `DEFAULT_STATUSES` : statuts par défaut pour les colonnes Choice

**Exemple d'ajout d'une colonne :**
```javascript
Tasks: {
  columns: [
    // ... colonnes existantes
    { id: 'nouvelleColonne', opts: dataColumn('Text') }
  ]
}
```

### `taskflow-bootstrap.js`

**API unique d'initialisation.**

Fonction principale : `TaskFlowBootstrap.ensureSchema(grist, options)`

Algorithme :
1. Attend que Grist soit accessible
2. Lit les métadonnées (`_grist_Tables`, `_grist_Tables_column`)
3. Calcule les tables manquantes
4. Crée les tables manquantes (dans l'ordre)
5. Relit les métadonnées
6. Calcule les colonnes manquantes
7. Crée les colonnes manquantes
8. Vérifie les conflits de type
9. Configure les références (visibleCol + display formula)
10. Initialise les choix par défaut (Choice)
11. Vérifie le schéma final
12. Écrit `schemaVersion` dans `TaskFlow_Meta`

**Résistant à la concurrence :**
- Utilise un mutex en mémoire (`bootstrapPromise`)
- Réessaie en cas de conflit "already exists"
- Relit les métadonnées après chaque action

### `taskflow-migrations.js`

**Migrations versionnées.**

Pour faire évoluer le schéma sans casser les documents existants :

```javascript
var MIGRATIONS = [
  {
    version: 2,
    name: 'add-planning-columns',
    description: 'Ajoute les colonnes de plan de charge',
    run: async function(grist, metadata) {
      // Implémentation
      return { success: true, message: 'Migration appliquée' };
    }
  }
];
```

Chaque migration doit être :
- **Idempotente** : réexécutable sans effet secondaire
- **Non destructive** : ne supprime jamais de données
- **Testable** : peut être testée indépendamment

---

## Utilisation dans les widgets

### Initialisation standard

```javascript
async function initWidget() {
  // 1. Déclarer l'accès requis
  grist.ready({ requiredAccess: 'full' });
  
  // 2. Afficher un état de chargement
  renderInitializingState();
  
  try {
    // 3. Exécuter le bootstrap (créé par le build)
    await TF.ensureSchema(grist);
    
    // 4. Charger les données
    await loadAllData();
    
    // 5. Enregistrer les listeners
    grist.onRecords(() => loadAllData());
    
    // 6. Rendu final
    render();
  } catch (error) {
    // 7. Gestion d'erreur
    renderSchemaError(error);
  }
}
```

### Sérialisation des rechargements

```javascript
let reloadRunning = false;
let reloadPending = false;

function requestReload() {
  reloadPending = true;
  void runReloadLoop();
}

async function runReloadLoop() {
  if (reloadRunning) return;
  reloadRunning = true;
  try {
    while (reloadPending) {
      reloadPending = false;
      await loadAllData();
    }
  } finally {
    reloadRunning = false;
  }
}
```

---

## Build

Le script `scripts/build-taskflow.js` injecte le code partagé dans tous les widgets.

**Commande :**
```bash
npm run build:taskflow
```

**Fichiers injectés :**
1. `core/taskflow-core.js`
2. `core/schema/taskflow-schema.js`
3. `core/schema/taskflow-bootstrap.js`
4. `core/schema/taskflow-migrations.js`

**Marqueurs dans les HTML :**
```html
<!-- Début injection -->
// <taskflow-core> -- GENERE par scripts/build-taskflow.js, NE PAS EDITER ICI
... code injecté ...
// </taskflow-core>
<!-- Fin injection -->
```

---

## Tests

### Scénarios à tester

1. **Document vide** : Ouvrir un widget sur un document Grist vide
   - Toutes les tables sont créées
   - Toutes les références sont configurées
   - Le widget fonctionne

2. **Document partiel** : Tables créées mais colonnes manquantes
   - Le bootstrap complète uniquement ce qui manque
   - Aucune donnée n'est écrasée

3. **Concurrence** : Ouvrir Kanban + Gantt simultanément
   - Aucune erreur "table already exists"
   - Schéma final correct

4. **Interruption** : Fermer le widget pendant le bootstrap
   - Rouvrir un autre widget
   - L'installation reprend et aboutit

5. **Lecture seule** : Utilisateur sans droits d'écriture
   - Message clair si schéma incomplet
   - Fonctionne en lecture si schéma déjà installé

6. **Références** : Supprimer le `visibleCol` d'une référence
   - Le bootstrap répare la configuration

---

## Critères d'acceptation

- [ ] N'importe quel widget peut être ouvert en premier
- [ ] Le Kanban n'est plus un prérequis
- [ ] Toutes les définitions sont centralisées
- [ ] Les colonnes ont explicitement `isFormula: false`
- [ ] Le bootstrap est idempotent
- [ ] Résiste à deux widgets lancés simultanément
- [ ] Une interruption laisse un état récupérable
- [ ] Les références affichent des noms (pas des IDs)
- [ ] `visibleCol` ET la display formula sont vérifiés
- [ ] Les données existantes ne sont pas modifiées
- [ ] Les choix personnalisés ne sont pas écrasés
- [ ] Les anciens initialiseurs locaux sont supprimés
- [ ] Les listeners Grist ne démarrent qu'après le bootstrap
- [ ] Les rechargements sont sérialisés
- [ ] Les erreurs de permissions sont visibles
- [ ] Pas de mode démo intempestif

---

## Migration depuis l'ancien système

### Étapes

1. **Créer les fichiers de bootstrap** (déjà fait)
2. **Lancer le build** : `npm run build:taskflow`
3. **Tester chaque widget** individuellement
4. **Supprimer les anciens `ensureSchema()`** dans les widgets
5. **Tester la concurrence** (ouvrir 2 widgets)
6. **Vérifier les références** dans Grist (vues natives)

### Code à supprimer (après migration)

Dans chaque widget :
- `TASKFLOW_SCHEMA` local (remplacé par le global)
- `ensureSchema()` locale
- `GENCI_FULL_SCHEMA` (intégré au bootstrap)
- `GENCI_REF_CONFIGS` (intégré au bootstrap)
- `needsReferenceRepair()` (géré par le bootstrap)
- `setRefDisplayColumns()` calls (géré par le bootstrap)
- `seedStatusChoices()` calls (géré par le bootstrap)

---

## Dépannage

### Le bootstrap échoue avec "table already exists"

**Cause** : Conflit de concurrence ou schéma partiellement créé.

**Solution** : Le bootstrap réessaie automatiquement. Si l'erreur persiste :
1. Rafraîchir la page
2. Vérifier les logs console
3. Ouvrir un seul widget à la fois

### Les références affichent des IDs au lieu des noms

**Cause** : `visibleCol` ou `displayCol` mal configuré.

**Solution** :
1. Vérifier que le bootstrap s'est exécuté complètement
2. Chercher `[TaskFlow Bootstrap] Configuration référence` dans la console
3. Si erreur, vérifier que la table cible et la colonne visible existent

### Mode démo qui se déclenche intempestivement

**Cause** : Timeout ou erreur de chargement interprétée comme "hors Grist".

**Solution** :
1. Vérifier que `grist.ready()` réussit
2. Augmenter le timeout de démo
3. Ne basculer en démo que si `window.self === window.top`

---

## Références

- [Grist API](https://support.getgrist.com/api/)
- [Grist Data Model](https://support.getgrist.com/data-model/)
- [Grist Access Rules](https://support.getgrist.com/access-rules/)
