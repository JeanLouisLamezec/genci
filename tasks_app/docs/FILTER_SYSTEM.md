# TaskFlow - Système de Filtrage et Modèle de Données

> Documentation technique pour les développeurs et agents IA.  
> Dernière mise à jour : Juillet 2026  
> Version : TaskFlow v16

---

## 📚 Partie 1 : Modèle de Données et Nomenclature

### 1.1 Hiérarchie des Entités

```
Programmes (Portefeuilles)
    └── Projects
            └── Tasks
                    └── Actions (sous-tâches opérationnelles)
```

### 1.2 Tables et Relations

#### **Programmes** (anciennement "Portefeuilles")
- **Rôle** : Regroupement stratégique de projets (niveau N+1)
- **Table Grist** : `Programmes`
- **Colonnes** :
  - `nom` (Text) : Nom du programme
  - `couleur` (Text) : Couleur hexadécimale
  - `responsable` (Ref:Team) : Responsable du programme
  - `description` (Text) : Description
  - `actif` (Bool) : Statut d'activité

#### **Projects**
- **Rôle** : Conteneur de tâches, rattaché à un programme
- **Table Grist** : `Projects`
- **Colonnes** :
  - `nom` (Text)
  - `couleur` (Text)
  - `dateDebut`, `dateFin` (Date)
  - `responsable` (Ref:Team)
  - `actif` (Bool)
  - `programme` (Ref:Programmes) : **Lien vers le programme parent**
  - `portefeuille` (Ref:Programmes) : Ancien nom (rétrocompatible)

#### **Tasks**
- **Rôle** : Tâches principales (WBS - Work Breakdown Structure)
- **Table Grist** : `Tasks`
- **Colonnes clés** :
  - `titre`, `description` (Text)
  - `statut` (Choice) : État de la tâche (dynamique)
  - `priorite` (Choice) : Priorité (1-4)
  - `projet` (Ref:Projects) : Projet parent
  - `assignees` (RefList:Team) : Personnes assignées
  - `parentTask` (Ref:Tasks) : Tâche parente (hiérarchie WBS)
  - `charges` (Text JSON) : Répartition de charge `[{teamId, heures}]`
  - `dateCloture` (Date) : Date de clôture effective

#### **Actions**
- **Rôle** : Sous-tâches opérationnelles des Tasks (niveau feuille)
- **Table Grist** : `Actions`
- **Colonnes** :
  - `titre`, `description` (Text)
  - `task` (Ref:Tasks) : Tâche parente
  - `statut`, `priorite`, `assignee`, `estimationH`, `progression`
  - `ordre` (Int) : Ordre d'affichage

#### **Team** (Personnes)
- **Rôle** : Membres de l'équipe
- **Table Grist** : `Team`
- **Colonnes** :
  - `nom`, `email`, `role` (Choice)
  - `couleur` (Text) : Couleur de l'avatar
  - `entite` (Ref:Entites) : Équipe/rattachement
  - `capaciteHebdo` (Numeric) : Capacité hebdomadaire (heures)
  - `indispos` (Text JSON) : Indisponibilités `[{start, end, label}]`

#### **Entites** (Équipes)
- **Rôle** : Structure organisationnelle (services, directions)
- **Table Grist** : `Entites`
- **Colonnes** :
  - `nom` (Text)
  - `parent` (Ref:Entites) : Entité parente (hiérarchie)
  - `niveau` (Choice) : niveau (direction/service/equipe)
  - `chef` (Ref:Team) : Responsable de l'entité

### 1.3 Relations Clés

```javascript
// Programme → Projects
Programmes.id ← Projects.programme (Ref)

// Project → Tasks
Projects.id ← Tasks.projet (Ref)

// Task → Actions (1-n)
Tasks.id ← Actions.task (Ref)

// Task → Task (hiérarchie WBS)
Tasks.id ← Tasks.parentTask (Ref) - auto-référentiel

// Team → Tasks (n-n via RefList)
Team.id ∈ Tasks.assignees (RefList)

// Team → Actions (1-n)
Team.id ← Actions.assignee (Ref)

// Entites → Team (1-n)
Entites.id ← Team.entite (Ref)
```

### 1.4 Concepts Importants

#### **WBS (Work Breakdown Structure)**
- Les tâches peuvent avoir des sous-tâches via `parentTask`
- Une tâche "parente" (synthèse) regroupe des enfants
- Une tâche "feuille" (action) n'a pas d'enfants
- **Ne pas confondre** avec la table `Actions` qui est une entité séparée

#### **Charge vs Assignation**
- `assignees` : Liste des personnes sur une tâche (RefList)
- `charges` : Répartition précise des heures par personne (JSON)
- Si `charges` est vide, on estime : `estimationH / nb_assignees`

#### **Rétrocompatibilité**
- `Portefeuilles` → `Programmes` (table renommée)
- `Projects.portefeuille` → `Projects.programme` (colonne migrée)
- Le code supporte les DEUX noms via : `p.programme || p.portefeuille`

---

## 🔍 Partie 2 : Système de Filtrage Mutualisé

### 2.1 Architecture Générale

```
┌─────────────────────────────────────────────────────────────┐
│                    FilterManager (core)                      │
│  - Gestion centralisée des filtres                           │
│  - Interface UI commune (accordéons, checkboxes)             │
│  - Logique de filtrage générique                             │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
   ┌──────────┐         ┌──────────┐         ┌──────────┐
   │  Kanban  │         │  Gantt   │          │   Plan   │
   │ post-    │         │ post-    │          │ post-    │
   │ filter   │         │ filter   │          │ filter   │
   │ spécifique│        │ spécifique│         │ spécifique│
   └──────────┘         └──────────┘          └──────────┘
```

### 2.2 Filtres Disponibles

| Type | Cible | Source des données | Clé de filtre |
|------|-------|-------------------|---------------|
| **assignee** | Personnes | `Team` | `filters.assignee[]` |
| **team** | Équipes | `Entites` | `filters.team[]` |
| **project** | Projets | `Projects` | `filters.project[]` |
| **programme** | Programmes | `Programmes` (via Projects) | `filters.programme[]` |
| **task** | Tâches | `Tasks` | `filters.task[]` |

### 2.3 Implémentation du Filtre "Programme"

#### **2.3.1 Déclaration dans FilterManager**

```javascript
// core/filters/filter-manager.js
class FilterManager {
  constructor(options = {}) {
    this.filters = options.initialFilters || {
      assignee: [],
      team: [],
      project: [],
      programme: [],
      task: []
    };
  }
}
```

#### **2.3.2 Logique de Filtrage**

```javascript
// Filtre par programme (via projets) - rétrocompatible
if (this.filters.programme && this.filters.programme.length > 0) {
  result = result.filter(t => {
    const p = this.data.projects?.find(proj => proj.id === t.projet);
    if (!p) return false;
    const progId = p.programme || p.portefeuille; // rétrocompatible
    return progId != null && this.filters.programme.includes(String(progId));
  });
}
```

**Points clés** :
1. Le filtre s'applique aux **tâches**, pas directement aux programmes
2. On remonte du programme via le projet de la tâche
3. Support des deux noms de colonne (`programme` et `portefeuille`)
4. Comparaison en `String()` pour éviter les bugs type number/string

#### **2.3.3 Initialisation par Widget**

**Kanban** :
```javascript
// Déclaration
let programmes = [];

// Chargement
programmes = convertGristToRecords(
  await grist.docApi.fetchTable('Programmes')
);

// Initialisation FilterManager
filterManager.setData({
  team, entites, projects, programmes, tasks, actions
});

// UI containers
filterManager.initUI({
  assignee: document.getElementById('filterPersonContainer'),
  team: document.getElementById('filterTeamContainer'),
  project: document.getElementById('filterProjectContainer'),
  programme: document.getElementById('filterProgramContainer'), // NOUVEAU
  task: document.getElementById('filterTaskContainer')
}, filterPanel);
```

**Gantt** : Similaire à Kanban

**Plan de charge** :
```javascript
// Le Plan a une logique supplémentaire pour le groupement
function buildRows() {
  if (S.groupBy === 'programme') {
    const ps = {};
    for (const t of planTasks()) {  // planTasks() applique déjà les filtres
      const pk = progKeyOf(t);
      // Filtre supplémentaire : ne garder que les programmes sélectionnés
      const progFilter = S.filters?.programme || [];
      if (progFilter.length > 0 && !progFilter.includes(String(pk))) continue;
      
      if (!ps[pk]) { 
        const pf = progById(Number(pk)); 
        ps[pk] = { 
          label: pf ? pf.nom : 'Sans programme', 
          color: pf?.couleur || '#64748b', 
          mem: new Map() 
        }; 
      }
      for (const c of effCharges(t)) { 
        const m = teamById(c.teamId); 
        if (m) ps[pk].mem.set(m.id, m); 
      }
    }
    // ... construction des lignes
  }
}
```

### 2.4 Adaptation par Widget

#### **Kanban : Post-Filter pour Actions**

Le Kanban affiche des **Actions**, pas des Tasks. Le filtrage se fait en 2 temps :

```javascript
// 1. FilterManager filtre les Tasks
const filteredTasks = filterManager.filterTasks(allTasks);

// 2. Post-filter Kanban : garde les Actions liées aux Tasks filtrées
const kanbanPostFilter = (filteredTasks, config, allData) => {
  const { actions } = allData;
  const filteredTaskIds = new Set(filteredTasks.map(t => t.id));
  
  return actions.filter(a => {
    // La tâche parente doit être dans les tâches filtrées
    return a.task && filteredTaskIds.has(Number(a.task));
  });
};

filterManager.setPostFilter(kanbanPostFilter);
```

#### **Gantt : Filtrage Direct**

Le Gantt affiche des Tasks directement, aucun post-filter n'est nécessaire.

#### **Plan de Charge : Filtrage Complexe**

Le Plan a 3 niveaux de filtrage :

```javascript
// Niveau 1 : Filtres externes (broadcast Grist)
function planTasks() {
  let ts = S.includeDone ? S.tasks : S.tasks.filter(t => !isTerminal(t));
  
  // Filtres externes (onOptions)
  const f = S.extFilters;
  if (f?.programme?.length) {
    ts = ts.filter(t => {
      const p = S.projects?.find(proj => proj.id === t.projet);
      const progId = p?.programme || p?.portefeuille;
      return progId != null && f.programme.map(String).includes(String(progId));
    });
  }
  
  // Niveau 2 : Filtres locaux (FilterManager)
  if (S.filterManager) {
    ts = S.filterManager.filterTasks(ts);
  }
  
  return ts;
}

// Niveau 3 : Filtrage des lignes (buildRows)
function buildRows() {
  if (S.groupBy === 'programme') {
    // Les lignes sont construites depuis planTasks() déjà filtré
    // + filtre additionnel sur les programmes affichés
  }
}
```

### 2.5 Synchronisation Inter-Widgets

Les filtres sont synchronisés via l'API Grist :

```javascript
// Émission (quand un filtre change)
function broadcastFilters() {
  grist.widgetApi?.setOptions({ filters });
}

// Réception (dans chaque widget)
grist.onOptions((options) => {
  if (options?.filters) {
    filterManager.applyExternalFilters(options.filters);
    render();
  }
});
```

**Important** : Le Dashboard **ne diffuse pas** ses filtres (locaux uniquement) pour éviter les boucles de re-rendu.

---

## 🧪 Partie 3 : Tests et Validation

### 3.1 Tests Unitaires Recommandés

```javascript
// TODO: Créer un fichier tests/filter-manager.test.js

describe('FilterManager - Filtre Programme', () => {
  beforeEach(() => {
    mockData = {
      programmes: [
        { id: 1, nom: 'Programme A' },
        { id: 2, nom: 'Programme B' }
      ],
      projects: [
        { id: 1, nom: 'Projet 1', programme: 1 },
        { id: 2, nom: 'Projet 2', programme: 2 }
      ],
      tasks: [
        { id: 1, titre: 'Tâche 1', projet: 1 },
        { id: 2, titre: 'Tâche 2', projet: 2 }
      ]
    };
  });

  test('doit filtrer les tâches par programme', () => {
    const fm = new FilterManager({
      data: mockData,
      initialFilters: { programme: ['1'] }
    });
    
    const filtered = fm.filterTasks(mockData.tasks);
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe(1);
  });

  test('doit supporter la rétrocompatibilité portefeuille/programme', () => {
    mockData.projects[0].portefeuille = 1;
    delete mockData.projects[0].programme;
    
    const fm = new FilterManager({
      data: mockData,
      initialFilters: { programme: ['1'] }
    });
    
    const filtered = fm.filterTasks(mockData.tasks);
    expect(filtered.length).toBe(1);
  });

  test('doit gérer les programmes vides/null', () => {
    mockData.projects[0].programme = null;
    
    const fm = new FilterManager({
      data: mockData,
      initialFilters: { programme: ['1'] }
    });
    
    const filtered = fm.filterTasks(mockData.tasks);
    expect(filtered.length).toBe(0);
  });
});
```

### 3.2 Tests d'Intégration

```javascript
// TODO: tests/integration-filters.test.js

describe('Synchronisation inter-widgets', () => {
  test('les filtres programme doivent se propager du Kanban au Gantt', () => {
    // Simuler un setOptions depuis Kanban
    grist.widgetApi.setOptions({ 
      filters: { programme: [1] } 
    });
    
    // Vérifier que Gantt reçoit le filtre
    grist.onOptions((options) => {
      expect(options.filters.programme).toEqual([1]);
    });
  });
});
```

### 3.3 Tests Manuels

**Scénario 1 : Filtrage Kanban**
1. Ouvrir le widget Kanban
2. Cliquer sur "Filtres" → "Programmes"
3. Cocher "GENCI 2026 - Projets HPC"
4. **Attendu** : Seules les actions des tâches du projet "Simulateur quantique" apparaissent
5. Décocher le filtre
6. **Attendu** : Toutes les actions réapparaissent

**Scénario 2 : Filtrage Plan de Charge**
1. Ouvrir le widget Plan de Charge
2. Grouper par "Programme"
3. Filtrer sur "Programme Santé"
4. **Attendu** : 
   - Seule la section "GENCI 2026 - Projets Santé" est visible
   - Seules les personnes du projet "Santé IA" apparaissent
5. Changer le groupement à "Personne"
6. **Attendu** : Seules les personnes ayant des tâches dans le programme filtré sont listées

**Scénario 3 : Rétrocompatibilité**
1. Dans Grist, modifier manuellement un projet : `programme = null`, `portefeuille = 1`
2. Rafraîchir le widget
3. **Attendu** : Le filtre programme fonctionne toujours

---

## 🔄 Partie 4 : Refactoring et Améliorations

### 4.1 Problèmes Actuels

#### **4.1.1 Duplication de Logique**

Le filtre programme est implémenté à 3 endroits :
1. `FilterManager.filterTasks()` (générique)
2. `plan.html:planTasks()` (spécifique Plan)
3. `plan.html:buildRows()` (spécifique groupement)

**Risque** : Incohérence si un endroit est oublié lors d'une modification.

#### **4.1.2 Performance**

```javascript
// Dans buildRows() - Plan de charge
for (const t of planTasks()) {  // O(n)
  // ...
  if (S.filters.programme?.length) {
    // Vérification à chaque itération
  }
}

// Dans planTasks() - Plan de charge
if (S.filters.programme?.length) {
  ts = ts.filter(t => {
    const p = S.projects?.find(proj => proj.id === t.projet);  // O(m)
    // ...
  });
}
```

**Complexité** : O(n × m) où n = tâches, m = projets

#### **4.1.3 État Partagé Complexe**

```javascript
// Kanban a ses propres filtres
let filters = { assignee: [], team: [], project: [], programme: [], task: [] };

// FilterManager a ses propres filtres
this.filters = { ... };

// Plan a S.filters ET S.extFilters
S.filters = { ... };
S.extFilters = { ... };
```

**Risque** : Désynchronisation entre les états.

### 4.2 Propositions de Refactoring

#### **4.2.1 Centralisation Complète**

```javascript
// core/filters/filter-engine.js
class FilterEngine {
  constructor() {
    this.filters = {};
    this.data = {};
    this.strategies = new Map();
  }

  // Enregistrement de stratégies par type d'entité
  registerStrategy(entityType, filterFn) {
    this.strategies.set(entityType, filterFn);
  }

  // Filtrage générique
  apply(entityType, items) {
    const strategy = this.strategies.get(entityType);
    if (!strategy) return items;
    return strategy(items, this.filters, this.data);
  }

  // Filtres chaînés
  chain(entityType, items, ...filterKeys) {
    return filterKeys.reduce((result, key) => {
      return this.apply(entityType, result);
    }, items);
  }
}

// Utilisation
const engine = new FilterEngine();

engine.registerStrategy('programme', (tasks, filters, data) => {
  if (!filters.programme?.length) return tasks;
  
  // Cache des projets pour éviter les find() répétés
  const projectMap = new Map(
    data.projects.map(p => [p.id, p])
  );
  
  return tasks.filter(t => {
    const p = projectMap.get(t.projet);
    if (!p) return false;
    const progId = p.programme || p.portefeuille;
    return filters.programme.includes(String(progId));
  });
});

// Dans chaque widget
const filtered = engine.chain('tasks', allTasks, 
  'assignee', 'team', 'project', 'programme', 'task'
);
```

**Avantages** :
- ✅ Logique de filtrage en un seul endroit
- ✅ Stratégies testables unitairement
- ✅ Cache pour la performance
- ✅ Chaînage flexible

#### **4.2.2 Normalisation des IDs**

```javascript
// core/filters/normalizer.js
export class FilterNormalizer {
  static normalizeId(value) {
    if (value == null) return null;
    return String(value);
  }

  static normalizeArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(this.normalizeId).filter(Boolean);
  }

  static compare(a, b) {
    return this.normalizeId(a) === this.normalizeId(b);
  }
}

// Utilisation
const progId = FilterNormalizer.normalizeId(p.programme || p.portefeuille);
const matches = filters.programme.some(f => 
  FilterNormalizer.compare(f, progId)
);
```

**Avantages** :
- ✅ Plus de bugs de type number/string
- ✅ Code plus lisible
- ✅ Réutilisable partout

#### **4.2.3 État Unique de Vérité**

```javascript
// core/filters/filter-store.js
class FilterStore {
  constructor() {
    this.state = {
      assignee: [],
      team: [],
      project: [],
      programme: [],
      task: []
    };
    this.listeners = new Set();
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  update(updates) {
    Object.assign(this.state, updates);
    this.notify();
  }

  notify() {
    this.listeners.forEach(cb => cb(this.state));
  }

  // Synchronisation Grist
  syncWithGrist() {
    grist.onOptions((o) => {
      if (o?.filters) {
        this.update(o.filters);
      }
    });
  }

  broadcast() {
    grist.widgetApi?.setOptions({ filters: this.state });
  }
}

// Instance singleton
export const filterStore = new FilterStore();

// Dans chaque widget
import { filterStore } from 'core/filters/filter-store';

filterStore.subscribe((filters) => {
  render();
});

// Au changement
filterStore.update({ programme: [1, 2] });
filterStore.broadcast();
```

**Avantages** :
- ✅ État cohérent entre tous les widgets
- ✅ Plus de désynchronisation
- ✅ Pattern observable propre

### 4.3 Optimisations Performance

#### **4.3.1 Indexation des Projets**

```javascript
// Avant : O(n × m)
tasks.filter(t => {
  const p = projects.find(proj => proj.id === t.projet);
  return p?.programme === filterValue;
});

// Après : O(n) avec index
const projectIndex = new Map(
  projects.map(p => [p.id, p])
);

tasks.filter(t => {
  const p = projectIndex.get(t.projet);
  return p?.programme === filterValue;
});
```

#### **4.3.2 Memoization des Filtres**

```javascript
// core/filters/memoize.js
const memoize = (fn, keyFn) => {
  const cache = new Map();
  return (...args) => {
    const key = keyFn(...args);
    if (cache.has(key)) return cache.get(key);
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
};

// Utilisation
const filterTasks = memoize(
  (tasks, filters, data) => {
    // logique de filtrage coûteuse
  },
  (tasks, filters) => {
    return JSON.stringify({
      taskIds: tasks.map(t => t.id).sort(),
      filters
    });
  }
);
```

**Avantages** :
- ✅ Re-rendus évités si filtres inchangés
- ✅ Gain significatif sur gros datasets

---

## 📝 Checklist d'Implémentation Future

- [ ] Créer les tests unitaires FilterManager
- [ ] Implémenter FilterEngine pour centraliser la logique
- [ ] Ajouter FilterNormalizer pour les IDs
- [ ] Migrer vers FilterStore (état unique)
- [ ] indexer projects/programmes pour la performance
- [ ] Ajouter memoization sur filterTasks()
- [ ] Documenter les cas edge (programme null, portefeuille seul, etc.)
- [ ] Tests de charge avec 1000+ tâches

---

## 🔗 Références

- **Fichiers Core** :
  - `core/filters/filter-manager.js` : Classe principale
  - `core/filters/filter-styles.css` : Styles communs
- **Widgets** :
  - `kanban.html` : Lignes 1064, 1656, 1720, 1837
  - `gantt.html` : Lignes 1112, 3033, 3059, 3073
  - `plan.html` : Lignes 670, 704, 841, 1496
- **Documentation liée** :
  - `CLAUDE.md` : Vue d'ensemble TaskFlow
  - `CRA_FEUILLE_DE_TEMPS_SPEC.md` : Spécification feuille de temps

---

*Document généré pour faciliter la maintenance et l'évolution du système de filtrage TaskFlow.*
