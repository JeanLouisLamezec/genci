# Tests du schéma GENCI/TaskFlow

## Procédure de test manuel Grist

### Scénario A — Document totalement vide

**Objectif** : Vérifier l'initialisation complète depuis zéro

**Étapes** :
1. Créer un nouveau document Grist vierge
2. Ouvrir le widget Kanban
3. Observer l'initialisation automatique

**Résultats attendus** :
- [ ] Aucune erreur `NoneType` ou `AttributeError`
- [ ] Toutes les tables créées : Team, Programmes, Entites, Projects, Tasks, Actions, KanbanSteps, etc.
- [ ] Les colonnes Ref créées APRÈS les tables (pas d'erreur Sandbox)
- [ ] Les formules créées APRÈS les Ref
- [ ] Les Choices configurés avec couleurs
- [ ] Données de démonstration créées UNE fois
- [ ] Le Kanban s'affiche correctement
- [ ] Console : logs `[GENCI schema]` et `[GENCI tables]` visibles

### Scénario B — Initialisation répétée

**Objectif** : Vérifier l'idempotence

**Étapes** :
1. Document déjà initialisé (scénario A terminé)
2. Menu "Plus" → "Initialiser le schéma GENCI"
3. Répéter 3 fois

**Résultats attendus** :
- [ ] Aucune erreur à chaque exécution
- [ ] Aucune table en double
- [ ] Aucune colonne en double
- [ ] Aucune donnée de démonstration en double
- [ ] Aucun statut en double
- [ ] Toast : "Schéma GENCI prêt" avec durée rapide (<500ms)
- [ ] Console : "Déjà configuré" pour les références

### Scénario C — Document partiellement initialisé

**Objectif** : Vérifier la réparation ciblée

**Étapes** :
1. Document avec Team et Projects existants
2. Tasks manquant
3. Entites.chef manquant
4. Lancer l'initialisation

**Résultats attendus** :
- [ ] Seule la table Tasks manquante est créée
- [ ] Seule la colonne Entites.chef est ajoutée
- [ ] Données existantes intactes
- [ ] Colonnes correctes non recréées

### Scénario D — Affichage des références

**Objectif** : Vérifier que les références affichent des libellés lisibles

**Pré-requis** :
- Créer dans Team : Alice Martin, Bob Durant, Claire Bernard
- Créer dans Programmes : Transformation Digitale
- Créer dans Projects : Projet Alpha
- Créer dans Entites : Direction, Développement

**Étapes** :
1. Ouvrir les vues natives Grist (pas les widgets)
2. Vérifier chaque colonne de référence

**Résultats attendus** (dans les cellules Grist, PAS les widgets) :
- [ ] `Programmes.responsable` → "Alice Martin" (PAS "Team[1]" ou "1")
- [ ] `Projects.responsable` → "Alice Martin"
- [ ] `Projects.programme` → "Transformation Digitale"
- [ ] `Entites.chef` → "Alice Martin"
- [ ] `Entites.parent` → "Direction"
- [ ] `Team.entite` → "Développement"
- [ ] `Team.responsable` → "Alice Martin"
- [ ] `Tasks.projet` → "Projet Alpha"
- [ ] `Tasks.assignees` → "Alice Martin,Bob Durant" (noms, pas IDs)
- [ ] `Actions.task` → Titre de la tâche
- [ ] `Actions.assignee` → "Alice Martin"

**Vérification technique** :
- [ ] Dans `_grist_Tables_column`, colonne `Programmes.responsable` :
  - `visibleCol` pointe vers `Team.nom` (vérifier l'ID)
  - `displayCol` contient une formule : `$responsable.nom`

### Scénario E — Création d'Entité

**Objectif** : Vérifier les références circulaires

**Étapes** :
1. Créer Entité racine : "Direction" (parent vide)
2. Créer Entité enfant : "Développement" (parent = Direction)
3. Sélectionner un chef : "Alice Martin"
4. Modifier ensuite le parent : mettre "Direction" → "Développement" → "Direction"
5. Modifier le chef : Alice → Bob → Alice
6. Recharger la page

**Résultats attendus** :
- [ ] Aucune erreur serveur "NoneType"
- [ ] Références conservées après rechargement
- [ ] Noms lisibles dans les menus déroulants
- [ ] Hiérarchie exploitable (formule ancêtres fonctionne)

### Scénario F — Non-régression Kanban

**Objectif** : Vérifier que toutes les fonctionnalités existent

**Étapes** :
1. Créer une Tâche : "Tâche test"
2. Créer une Action liée : "Action test"
3. Assigner Alice Martin
4. Modifier statut : À faire → En cours
5. Modifier priorité : Normale → Élevée
6. Modifier progression : 0% → 50%
7. Drag-and-drop l'Action vers "En revue"
8. Renommer une étape du Kanban
9. Réordonner les étapes
10. Recharger la page

**Résultats attendus** :
- [ ] Tâche créée avec projet et assignees
- [ ] Action créée avec task et assignee
- [ ] Statut, priorité, progression modifiés
- [ ] Drag-and-drop fonctionne
- [ ] Étapes renommées persistées
- [ ] Ordre des étapes persisté
- [ ] Après rechargement : toutes les données sont là
- [ ] Filtres fonctionnent
- [ ] Couleurs des statuts correctes
- [ ] Aucune erreur JavaScript (console)
- [ ] Aucune erreur Grist (serveur)

### Scénario G — Réparation du visibleCol

**Objectif** : Vérifier la réparation des références

**Pré-requis** : Document avec Programmes.responsable mal configuré

**Étapes** :
1. Dans Grist, aller dans `_grist_Tables_column`
2. Trouver la ligne de `Programmes.responsable`
3. Mettre `visibleCol` à `null` ou une valeur incorrecte
4. Recharger le widget Kanban
5. Menu "Plus" → "Initialiser le schéma GENCI"

**Résultats attendus** :
- [ ] La colonne est détectée comme incorrecte
- [ ] `visibleCol` est remis sur `Team.nom`
- [ ] "Alice Martin" est de nouveau affiché
- [ ] Aucune donnée de Programme perdue
- [ ] Toast : "Schéma GENCI prêt" ou "Schéma GENCI réparé"

## Tests automatisés (à implémenter)

```javascript
// Test 1 : Helpers de type
console.assert(TF.isRefType('Ref:Team') === true);
console.assert(TF.isRefType('RefList:Team') === true);
console.assert(TF.isRefType('Text') === false);
console.assert(TF.isRefType('Choice') === false);

// Test 2 : Extraction de cible
console.assert(TF.getRefTarget('Ref:Team') === 'Team');
console.assert(TF.getRefTarget('RefList:Tasks') === 'Tasks');
console.assert(TF.getRefTarget('Text') === null);

// Test 3 : waitForTablesMetadata
async function testWaitForTables() {
    var result = await TF.waitForTablesMetadata(grist, ['Team', 'Tasks'], {
        maxAttempts: 10,
        baseDelay: 100
    });
    console.assert(result.success === true);
    console.assert(result.missing.length === 0);
}

// Test 4 : Inspection du schéma
async function testInspectSchema() {
    var inspection = await TaskFlowBootstrap.inspectGenciSchema(grist, [
        'Team', 'Programmes', 'Entites', 'Projects', 'Tasks', 'Actions'
    ]);
    console.assert(inspection.ready === true);
    console.assert(inspection.missingTables.length === 0);
    console.assert(inspection.invalidColumnTypes.length === 0);
}

// Test 5 : setRefDisplayColumns avec rapport
async function testRefDisplay() {
    var result = await TF.setRefDisplayColumns(grist, [
        { table: 'Programmes', column: 'responsable', visibleColId: 'nom' }
    ]);
    console.assert(result.ok === true);
    console.assert(result.configured.length >= 0);
    console.assert(result.errors.length === 0);
}
```

## Critères d'acceptation

### Critères bloquants (doivent TOUS passer)
- [ ] Aucune erreur `AttributeError: 'NoneType' object has no attribute 'table_id'`
- [ ] Toutes les tables essentielles existent après initialisation
- [ ] Toutes les colonnes Ref ont le bon type
- [ ] Toutes les références affichent des libellés lisibles (PAS d'IDs bruts)
- [ ] Le Kanban fonctionne (création, modification, drag-and-drop)
- [ ] Idempotence : 3 exécutions = aucune erreur, aucun doublon

### Critères importants
- [ ] Logs structurés `[GENCI schema]`, `[GENCI tables]`, etc.
- [ ] Rapports d'erreur détaillés dans la console
- [ ] Réparation ciblée (ne recrée pas ce qui existe)
- [ ] Seed uniquement sur tables vides
- [ ] Compatible avec documents existants

### Critères secondaires
- [ ] Toasts informatifs
- [ ] Durée d'initialisation < 5 secondes
- [ ] Messages d'erreur clairs en cas d'échec

## Rapport d'exécution

Date : ___________
Testeur : ___________

| Scénario | Résultat | Observations |
|----------|----------|--------------|
| A        | ☐ Pass ☐ Fail | |
| B        | ☐ Pass ☐ Fail | |
| C        | ☐ Pass ☐ Fail | |
| D        | ☐ Pass ☐ Fail | |
| E        | ☐ Pass ☐ Fail | |
| F        | ☐ Pass ☐ Fail | |
| G        | ☐ Pass ☐ Fail | |

**Problèmes rencontrés** :



**Correctifs appliqués** :


