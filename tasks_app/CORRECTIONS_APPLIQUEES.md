# Corrections appliquées à l'initialisation TaskFlow/GENCI

## 1. Cause exacte de l'erreur `TF non chargé`

**Problème** : 
```js
const TF = (function () { ... })();
```
déclare une constante locale mais n'exporte PAS vers `global` ou `window`.

Le bootstrap fait :
```js
var TF = global.TF;  // undefined !
```

**Correction** :
Ajouté à la fin de `taskflow-core.js` :
```js
if (typeof globalThis !== 'undefined') {
    globalThis.TF = TF;
}
```

Cela exporte explicitement `TF` dans le contexte global, fonctionnant dans :
- Navigateurs (`window.TF`)
- Tests hors navigateur (`global.TF`)
- Tout environnement supportant `globalThis`

---

## 2. Fichiers sources modifiés

### 2.1 `core/taskflow-core.js`
**Modifications** :
1. Ajout `globalThis.TF = TF;` après l'IIFE
2. Ajout `delay()` dans les exports de TF
3. `seedStatusChoices()` retourne maintenant un objet structuré :
   ```js
   { ok: true/false, changed: true/false, reason/error: ... }
   ```

### 2.2 `core/schema/taskflow-bootstrap.js`
**Corrections structurelles** :

1. **Fonction `normalizeColumnDefinition()`** :
   - Normalise les colonnes avant création
   - Lit correctement `column.opts.type` au lieu de `column.type`
   - Utilisée dans `createTable()` et `addColumn()`

2. **Variables `log` renommées** :
   - `migrateLegacyTables()` : `var log` → `var migrationEntries`
   - `seedInitialData()` : `var log` → `var seedEntries`
   - Évite de masquer la fonction `log()`

3. **`createTable()` corrigée** :
   - Utilise `normalizeColumnDefinition()`
   - Valide les colonnes avant appel Grist
   - Vérifie `id` et `type` présents

4. **`ensureBaseTables()` améliorée** :
   - Ne crée PLUS les formules en passe 1
   - `split.nonRef` uniquement (pas `.concat(split.formula)`)
   - Complète les tables existantes avec colonnes manquantes
   - Retourne `{ created, columnsAdded, invalidTypes, errors }`

5. **`addColumn()`** :
   - Utilise `normalizeColumnDefinition()`
   - Lit correctement le type depuis `opts`

6. **`configureChoiceColumns()`** :
   - Utilise le retour structuré de `seedStatusChoices()`
   - Vérifie `seedResult.ok && seedResult.changed`

7. **`bootstrapComplete`** :
   - `bootstrapComplete = result.success === true;`
   - Pas `true` si échec ou validation partielle

### 2.3 `core/schema/taskflow-migrations.js`
**Aucun changement** - Les migrations factices sont inoffensives tant qu'elles ne sont pas exécutées.

---

## 3. Anciennes fonctions supprimées ou neutralisées

**Dans `kanban.html` (partie non générée)** :
- L'ancien `ensureSchema()` inline est maintenant un wrapper vers `TaskFlowBootstrap.ensureGenciSchema()`
- L'inspection utilise `TaskFlowBootstrap.inspectGenciSchema()`
- Plus d'appel direct à l'ancien initialiseur dangereux

**Dans le bootstrap** :
- Plus de création de tables avec Ref immédiates
- Plus de formules créées avant les Ref
- Plus de variables `log` masquant la fonction

---

## 4. Résultats du build

```bash
npm run build:taskflow

🔨 Build TaskFlow...
📄 Lecture des fichiers core...
   4 fichiers lus, 89515 octets
📝 Injection dans kanban.html...
📝 Injection dans gantt.html...
📝 Injection dans plan.html...
📝 Injection dans calendar.html...
📝 Injection dans dashboard.html...
✅ Build terminé: 5/7 widgets mis à jour
```

**Vérifications dans le HTML généré** :
- ✅ `globalThis.TF = TF;` présent (ligne 1238)
- ✅ Apparaît AVANT `var TF = global.TF;` (ligne 1618)
- ✅ `delay` exporté dans TF
- ✅ Pas de tableau local `log` masquant la fonction
- ✅ `normalizeColumnDefinition()` utilisée
- ✅ Ancien `ensureSchema()` n'est plus appelé directement

---

## 5. Tests à effectuer manuellement dans Grist

### Test 1 — Chargement du widget
**Document** : N'importe quel document Grist

**Vérifications console** :
```js
window.TF  // Doit retourner l'objet TaskFlow
window.TASKFLOW_SCHEMA  // Doit exister
window.TaskFlowBootstrap  // Doit exister
```

**Erreurs à ne PAS voir** :
- `TF non chargé`
- `delay is not defined`
- `log is not a function`

### Test 2 — Document vide
**Document** : Nouveau document Grist vierge

**Résultats attendus** :
- ✅ Toutes les tables créées
- ✅ Colonnes simples créées en premier
- ✅ AUCUNE erreur `NoneType table_id`
- ✅ Références créées APRÈS stabilisation
- ✅ Formules créées APRÈS références
- ✅ Kanban se charge

### Test 3 — Références lisibles
**Pré-requis** : Créer Alice Martin dans Team

**Vérifications** (vues natives Grist, PAS widgets) :
- ✅ `Programmes.responsable` → "Alice Martin"
- ✅ `Projects.responsable` → "Alice Martin"
- ✅ `Entites.chef` → "Alice Martin"
- ✅ `Team.responsable` → "Alice Martin"
- ✅ `Actions.assignee` → "Alice Martin"

**À ne PAS voir** :
- `Team[1]`
- `1`
- `[object Object]`

### Test 4 — Document partiellement initialisé
**Document** : Document avec certaines tables manquantes

**Résultats attendus** :
- ✅ Seules les parties manquantes sont ajoutées
- ✅ Données existantes conservées
- ✅ Aucune table recréée

### Test 5 — Idempotence
**Action** : Lancer "Initialiser le schéma GENCI" 3 fois

**Résultats attendus** :
- ✅ Aucune erreur
- ✅ Aucune table en double
- ✅ Aucune colonne en double
- ✅ Aucun seed en double
- ✅ 3ème lancement : "Déjà configuré"

### Test 6 — Non-régression Kanban
**Vérifications** :
- ✅ Chargement des Actions
- ✅ Création Action
- ✅ Association à Tâche
- ✅ Assignation à personne
- ✅ Drag-and-drop
- ✅ Modification statut
- ✅ Rechargement données
- ✅ Filtres fonctionnent

---

## 6. Points nécessitant test manuel Grist

Les tests suivants NE PEUVENT PAS être automatisés sans accès à un serveur Grist réel :

1. **Test de l'erreur `NoneType table_id`** :
   - Nécessite un document Grist vierge
   - Vérifier que l'erreur N'APPARAÎT PLUS

2. **Vérification des métadonnées Grist** :
   - Table `_grist_Tables` : toutes les tables présentes
   - Table `_grist_Tables_column` :
     - Types corrects pour les Ref
     - `visibleCol` correctement configuré
     - `displayCol` avec formule correcte

3. **Migration `Portefeuilles` → `Programmes`** :
   - Nécessite un ancien document avec table `Portefeuilles`
   - Vérifier renommage automatique

4. **Performance réelle** :
   - Temps d'initialisation sur document vide
   - Temps d'initialisation sur document existant
   - Impact sur l'UI pendant l'initialisation

---

## 7. Résumé des correctifs appliqués

| Problème | Correction | Fichier |
|----------|-----------|---------|
| `TF` non exporté | `globalThis.TF = TF;` | `taskflow-core.js` |
| `delay()` manquant | Exporté dans TF | `taskflow-core.js` |
| `seedStatusChoices()` sans retour | Retour structuré `{ok, changed, reason}` | `taskflow-core.js` |
| Variables `log` masquant fonction | Renommées `migrationEntries`, `seedEntries` | `taskflow-bootstrap.js` |
| `createTable()` lit mal les colonnes | `normalizeColumnDefinition()` | `taskflow-bootstrap.js` |
| Formules créées avant Ref | Passe 1 : `split.nonRef` uniquement | `taskflow-bootstrap.js` |
| Tables existantes non complétées | Ajout colonnes manquantes | `taskflow-bootstrap.js` |
| `bootstrapComplete = true` toujours | `bootstrapComplete = result.success === true` | `taskflow-bootstrap.js` |
| `configureChoiceColumns()` ignore retour | Utilise `seedResult.ok && seedResult.changed` | `taskflow-bootstrap.js` |

---

## 8. Prochaines étapes

1. **Ouvrir Grist** avec un document de test
2. **Exécuter les tests 1 à 6** ci-dessus
3. **Remplir le rapport** dans `TESTS.md`
4. **Signaler tout échec** pour correction supplémentaire

---

## 9. Commandes utiles

```bash
# Régénérer après modification
cd /home/jeanlouis/PycharmProjects/GenciWidget/tasks_app
npm run build:taskflow

# Vérifier l'export TF
grep -n "globalThis.TF = TF" kanban.html

# Vérifier l'ordre
grep -n "globalThis.TF\|var TF = global" kanban.html

# Vérifier delay
grep -n "delay: delay" kanban.html

# Vérifier normaliseur
grep -n "normalizeColumnDefinition" kanban.html | head -3
```

---

**Statut** : ✅ Corrections appliquées et build généré  
**Prêt pour** : Tests manuels dans Grist  
**Fichiers modifiés** : 2 sources (`taskflow-core.js`, `taskflow-bootstrap.js`)  
**Fichiers générés** : 5 widgets HTML mis à jour
