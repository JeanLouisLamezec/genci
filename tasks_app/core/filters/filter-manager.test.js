/**
 * Tests unitaires pour FilterManager - TaskFlow
 * @see filter-manager.js pour l'implémentation
 * 
 * Usage: npm test
 */

// Mock data pour les tests
const mockData = {
  programmes: [
    { id: 1, nom: 'GENCI 2026 - HPC', couleur: '#6366f1', actif: true },
    { id: 2, nom: 'GENCI 2026 - Santé', couleur: '#6366ce', actif: true }
  ],
  projects: [
    { id: 1, nom: 'Simulateur quantique', programme: 1, portefeuille: 1 },
    { id: 2, nom: 'Santé IA', programme: 2, portefeuille: 2 }
  ],
  team: [
    { id: 1, nom: 'Alice', entite: 1 },
    { id: 2, nom: 'Bob', entite: 1 },
    { id: 3, nom: 'Claire', entite: 2 }
  ],
  entites: [
    { id: 1, nom: 'Direction Technique' },
    { id: 2, nom: 'Direction Santé' }
  ],
  tasks: [
    { id: 1, titre: 'Dev Backend', projet: 1, assignees: ['L', 1, 2] },
    { id: 2, titre: 'ML Model', projet: 2, assignees: ['L', 3] },
    { id: 3, titre: 'Tests QA', projet: 1, assignees: ['L', 2] }
  ]
};

// Helper pour créer une instance FilterManager
function createFilterManager(overrides = {}) {
  return new FilterManager({
    data: mockData,
    initialFilters: {
      assignee: [],
      team: [],
      project: [],
      programme: [],
      task: []
    },
    onChange: () => {},
    onBroadcast: () => {},
    effCharges: () => [],
    teamById: (id) => mockData.team.find(m => m.id === id),
    ...overrides
  });
}

// Import FilterManager (doit être après la définition de mockData et createFilterManager)
const { FilterManager } = require('./filter-manager.js');

// Suite de tests
describe('FilterManager - Filtre Programme', () => {
  
  test('doit filtrer les tâches par programme ID 1', () => {
    const fm = createFilterManager({
      initialFilters: { 
        assignee: [], 
        team: [], 
        project: [], 
        programme: ['1'], 
        task: [] 
      }
    });
    
    const filtered = fm.filterTasks(mockData.tasks);
    
    expect(filtered.length).toBe(2); // Tâches 1 et 3 (projet 1)
    expect(filtered.map(t => t.id)).toEqual([1, 3]);
  });

  test('doit filtrer les tâches par programme ID 2', () => {
    const fm = createFilterManager({
      initialFilters: { 
        assignee: [], 
        team: [], 
        project: [], 
        programme: ['2'], 
        task: [] 
      }
    });
    
    const filtered = fm.filterTasks(mockData.tasks);
    
    expect(filtered.length).toBe(1); // Tâche 2 (projet 2)
    expect(filtered[0].id).toBe(2);
  });

  test('doit retourner toutes les tâches si aucun filtre programme', () => {
    const fm = createFilterManager({
      initialFilters: { 
        assignee: [], 
        team: [], 
        project: [], 
        programme: [], 
        task: [] 
      }
    });
    
    const filtered = fm.filterTasks(mockData.tasks);
    expect(filtered.length).toBe(3);
  });

  test('doit gérer la rétrocompatibilité (portefeuille seul)', () => {
    const dataRetro = {
      ...mockData,
      projects: [
        { id: 1, nom: 'Projet 1', portefeuille: 1 }, // pas de programme
        { id: 2, nom: 'Projet 2', programme: 2 }
      ]
    };
    
    const fm = createFilterManager({
      data: dataRetro,
      initialFilters: { programme: ['1'] }
    });
    
    const filtered = fm.filterTasks(mockData.tasks);
    expect(filtered.length).toBe(2); // Tâches du projet 1
  });

  test('doit gérer programme ET portefeuille (priorité à programme)', () => {
    const dataBoth = {
      ...mockData,
      projects: [
        { id: 1, nom: 'Projet 1', programme: 1, portefeuille: 2 } // différents!
      ]
    };
    
    const fm = createFilterManager({
      data: dataBoth,
      initialFilters: { programme: ['1'] }
    });
    
    const filtered = fm.filterTasks([mockData.tasks[0]]);
    expect(filtered.length).toBe(1); // Utilise programme=1, pas portefeuille=2
  });

  test('doit exclure les tâches sans projet', () => {
    const tasksNoProject = [
      ...mockData.tasks,
      { id: 99, titre: 'Orpheline', projet: null }
    ];
    
    const fm = createFilterManager({
      initialFilters: { programme: ['1'] }
    });
    
    const filtered = fm.filterTasks(tasksNoProject);
    expect(filtered.find(t => t.id === 99)).toBeUndefined();
  });

  test('doit exclure les tâches avec projet sans programme', () => {
    const dataNoProg = {
      ...mockData,
      projects: [
        { id: 1, nom: 'Projet 1' }, // pas de programme/portefeuille
        { id: 2, nom: 'Projet 2', programme: 2 }
      ]
    };
    
    const fm = createFilterManager({
      data: dataNoProg,
      initialFilters: { programme: ['2'] }
    });
    
    const filtered = fm.filterTasks(mockData.tasks);
    expect(filtered.length).toBe(1); // Seulement tâche 2
  });

  test('doit combiner filtre programme + assignee', () => {
    const fm = createFilterManager({
      initialFilters: { 
        assignee: ['1'], // Alice
        programme: ['1'] 
      }
    });
    
    const filtered = fm.filterTasks(mockData.tasks);
    
    // Tâche 1: projet 1 (programme 1) + assignee 1 (Alice) ✓
    // Tâche 3: projet 1 (programme 1) + assignee 2 (Bob) ✗
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe(1);
  });

  test('doit combiner filtre programme + team', () => {
    const fm = createFilterManager({
      initialFilters: { 
        team: ['2'], // Direction Santé
        programme: ['2'] 
      }
    });
    
    const filtered = fm.filterTasks(mockData.tasks);
    
    // Tâche 2: projet 2 (programme 2) + assignee 3 (entite 2) ✓
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe(2);
  });

  test('doit gérer les IDs en string et number', () => {
    const fm = createFilterManager({
      initialFilters: { 
        programme: ['1'] // string pour matcher
      }
    });
    
    const filtered = fm.filterTasks(mockData.tasks);
    expect(filtered.length).toBe(2);
  });
});

describe('FilterManager - Gestion des erreurs', () => {
  
  test('doit gérer this.filters[type] undefined', () => {
    const fm = createFilterManager({
      initialFilters: {} // pas de programme
    });
    
    // Ne doit pas lancer d'erreur
    expect(() => {
      fm._handleCheckboxChange('programme', '1', true);
    }).not.toThrow();
    
    expect(fm.filters.programme).toEqual(['1']);
  });

  test('doit gérer data.projects undefined', () => {
    const fm = createFilterManager({
      data: { ...mockData, projects: undefined },
      initialFilters: { programme: ['1'] }
    });
    
    const filtered = fm.filterTasks(mockData.tasks);
    expect(filtered.length).toBe(0); // Tous exclus car pas de projects
  });

  test('doit gérer une tâche sans champ projet', () => {
    const tasks = [{ id: 1, titre: 'Test' }]; // pas de projet
    
    const fm = createFilterManager({
      initialFilters: { programme: ['1'] }
    });
    
    const filtered = fm.filterTasks(tasks);
    expect(filtered.length).toBe(0);
  });

  test('doit gérer filters.programme non initialisé dans _updateUIFromState', () => {
    const fm = createFilterManager({
      initialFilters: {}
    });
    
    // Mock UI
    fm.ui = {
      programme: {
        header: { querySelector: () => ({ textContent: '', style: { display: '' } }) },
        checkboxContainer: { querySelectorAll: () => [] }
      }
    };
    
    // Ne doit pas lancer d'erreur
    expect(() => {
      fm._updateUIFromState();
    }).not.toThrow();
  });
});

describe('FilterManager - Synchronisation UI', () => {
  
  test('doit initialiser toutes les sections UI', () => {
    const fm = createFilterManager();
    
    // Mock DOM elements
    const containers = {
      assignee: document.createElement('div'),
      team: document.createElement('div'),
      project: document.createElement('div'),
      programme: document.createElement('div'),
      task: document.createElement('div')
    };
    
    fm.initUI(containers, document.createElement('div'));
    
    expect(fm.ui.assignee).toBeDefined();
    expect(fm.ui.team).toBeDefined();
    expect(fm.ui.project).toBeDefined();
    expect(fm.ui.programme).toBeDefined(); // NOUVEAU
    expect(fm.ui.task).toBeDefined();
  });

  test('doit mettre à jour le compteur de filtres', () => {
    const fm = createFilterManager({
      initialFilters: { programme: ['1', '2'] }
    });
    
    expect(fm.getActiveFilterCount()).toBe(2);
  });

  test('doit clear tous les filtres', () => {
    const fm = createFilterManager({
      initialFilters: { 
        assignee: ['1'], 
        programme: ['2'] 
      }
    });
    
    fm.clearAll();
    
    expect(fm.filters.programme).toEqual([]);
    expect(fm.filters.assignee).toEqual([]);
    expect(fm.getActiveFilterCount()).toBe(0);
  });

  test('doit appliquer les filtres externes', () => {
    const fm = createFilterManager();
    
    fm.applyExternalFilters({
      programme: [1, 2],
      assignee: [1]
    });
    
    // Les IDs sont normalisés en chaînes
    expect(fm.filters.programme).toEqual(['1', '2']);
    expect(fm.filters.assignee).toEqual(['1']);
  });
});

describe('FilterManager - Post-Filter (Kanban)', () => {
  
  test('doit filtrer les actions via post-filter', () => {
    const fm = createFilterManager({
      data: {
        ...mockData,
        actions: [
          { id: 1, titre: 'Action 1', task: 1 },
          { id: 2, titre: 'Action 2', task: 2 },
          { id: 3, titre: 'Action 3', task: 3 }
        ]
      },
      initialFilters: { programme: ['1'] }
    });
    
    // Post-filter Kanban
    const kanbanPostFilter = (filteredTasks, config, allData) => {
      const { actions } = allData;
      const filteredTaskIds = new Set(filteredTasks.map(t => t.id));
      return actions.filter(a => filteredTaskIds.has(Number(a.task)));
    };
    
    fm.setPostFilter(kanbanPostFilter);
    
    const result = fm.filterTasks(mockData.tasks);
    expect(result.length).toBe(2); // Actions 1 et 3 (tasks 1 et 3)
  });
});

describe('FilterManager - setData', () => {
  
  test('doit mettre a jour les donnees et reconstruire l UI', () => {
    const fm = createFilterManager();
    
    const newData = {
      programmes: [
        { id: 3, nom: 'Nouveau Programme' }
      ],
      team: mockData.team,
      entites: mockData.entites,
      projects: mockData.projects,
      tasks: mockData.tasks
    };
    
    // Mock UI complete avec header
    const createSection = () => ({
      header: {
        querySelector: () => ({ textContent: '', style: { display: '' } })
      },
      checkboxContainer: document.createElement('div')
    });
    
    fm.ui = {
      assignee: createSection(),
      team: createSection(),
      project: createSection(),
      programme: createSection(),
      task: createSection()
    };
    
    fm.setData(newData);
    
  // Vérifier que l'UI a été reconstruite
  expect(fm.ui.programme.checkboxContainer.innerHTML).toContain('Nouveau Programme');
});

// Import normalizeFilters pour les tests
const { normalizeFilters } = require('./filter-manager.js');

// ============================================================================
// TESTS: normalizeFilters
// ============================================================================
describe('normalizeFilters - Fonction pure', () => {
  
  test('doit retourner un objet vide avec 5 clés pour input null/undefined', () => {
    expect(normalizeFilters(null)).toEqual({
      assignee: [], team: [], project: [], programme: [], task: []
    });
    expect(normalizeFilters(undefined)).toEqual({
      assignee: [], team: [], project: [], programme: [], task: []
    });
    expect(normalizeFilters({})).toEqual({
      assignee: [], team: [], project: [], programme: [], task: []
    });
  });

  test('doit convertir les nombres en chaînes', () => {
    const input = { assignee: [1, 2, 3], team: [4], project: [5] };
    const result = normalizeFilters(input);
    expect(result.assignee).toEqual(['1', '2', '3']);
    expect(result.team).toEqual(['4']);
    expect(result.project).toEqual(['5']);
  });

  test('doit gérer un mélange de nombres et chaînes', () => {
    const input = { assignee: [1, '2', 3, '4'], project: ['5', 6] };
    const result = normalizeFilters(input);
    expect(result.assignee).toEqual(['1', '2', '3', '4']);
    expect(result.project).toEqual(['5', '6']);
  });

  test('doit éliminer les doublons', () => {
    const input = { assignee: [1, '1', 2, '2', 1], project: ['5', 5, '5'] };
    const result = normalizeFilters(input);
    expect(result.assignee).toEqual(['1', '2']);
    expect(result.project).toEqual(['5']);
  });

  test('doit éliminer null, undefined et chaînes vides', () => {
    const input = { assignee: [1, null, '2', undefined, '', 3], team: [null] };
    const result = normalizeFilters(input);
    expect(result.assignee).toEqual(['1', '2', '3']);
    expect(result.team).toEqual([]);
  });

  test('doit conserver les 5 clés même si absentes de l input', () => {
    const input = { assignee: [1], custom: [999] };
    const result = normalizeFilters(input);
    expect(result).toHaveProperty('assignee');
    expect(result).toHaveProperty('team');
    expect(result).toHaveProperty('project');
    expect(result).toHaveProperty('programme');
    expect(result).toHaveProperty('task');
    expect(result.custom).toBeUndefined();
  });

  test('doit être immuable (ne pas modifier l entrée)', () => {
    const input = { assignee: [1, 2], project: [3] };
    const inputCopy = JSON.parse(JSON.stringify(input));
    normalizeFilters(input);
    expect(input).toEqual(inputCopy);
  });

  test('doit filtrer programme et task', () => {
    const input = { 
      programme: [1, '2', 3], 
      task: ['10', 11],
      assignee: [5]
    };
    const result = normalizeFilters(input);
    expect(result.programme).toEqual(['1', '2', '3']);
    expect(result.task).toEqual(['10', '11']);
    expect(result.assignee).toEqual(['5']);
  });
});

// ============================================================================
// TEST: Contrat de type - IDs en chaînes
// ============================================================================
describe('FilterManager - Contrat de type (IDs en chaînes)', () => {
  
  test('le filtre assignee expose des IDs en chaînes', () => {
    const fm = createFilterManager({
      initialFilters: { assignee: [2] }
    });
    
    expect(fm.getState().assignee).toEqual(['2']);
  });
  
  test('le filtre team expose des IDs en chaînes', () => {
    const fm = createFilterManager({
      initialFilters: { team: [10] }
    });
    
    expect(fm.getState().team).toEqual(['10']);
  });
  
  test('applyExternalFilters normalise les IDs en chaînes', () => {
    const fm = createFilterManager();
    
    fm.applyExternalFilters({
      assignee: [1, 2],
      team: [10, '20']
    });
    
    expect(fm.filters.assignee).toEqual(['1', '2']);
    expect(fm.filters.team).toEqual(['10', '20']);
  });
});

// ============================================================================
// TESTS: removeValue
// ============================================================================
describe('FilterManager - removeValue', () => {
  
  test('doit retirer une valeur existante', () => {
    const fm = createFilterManager({
      initialFilters: { assignee: ['1', '2', '3'], team: [], project: [], programme: [], task: [] }
    });
    
    const removed = fm.removeValue('assignee', '2');
    
    expect(removed).toBe(true);
    expect(fm.filters.assignee).toEqual(['1', '3']);
  });

  test('doit retirer une valeur même si l ID est un nombre', () => {
    const fm = createFilterManager({
      initialFilters: { assignee: ['1', '2', '3'], team: [], project: [], programme: [], task: [] }
    });
    
    const removed = fm.removeValue('assignee', 2);
    
    expect(removed).toBe(true);
    expect(fm.filters.assignee).toEqual(['1', '3']);
  });

  test('doit retourner false si la valeur est absente', () => {
    const fm = createFilterManager({
      initialFilters: { assignee: ['1', '3'], team: [], project: [], programme: [], task: [] }
    });
    
    const removed = fm.removeValue('assignee', '2');
    
    expect(removed).toBe(false);
    expect(fm.filters.assignee).toEqual(['1', '3']); // Inchangé
  });

  test('ne doit JAMAIS ajouter une valeur absente (pas de toggle)', () => {
    const fm = createFilterManager({
      initialFilters: { assignee: ['1', '3'], team: [], project: [], programme: [], task: [] }
    });
    
    fm.removeValue('assignee', '999');
    
    expect(fm.filters.assignee).toEqual(['1', '3']); // Doit rester inchangé
  });

  test('doit fonctionner avec programme', () => {
    const fm = createFilterManager({
      initialFilters: { assignee: [], team: [], project: [], programme: ['1', '2', '3'], task: [] }
    });
    
    fm.removeValue('programme', '2');
    
    expect(fm.filters.programme).toEqual(['1', '3']);
  });

  test('doit fonctionner avec task', () => {
    const fm = createFilterManager({
      initialFilters: { assignee: [], team: [], project: [], programme: [], task: ['10', '20'] }
    });
    
    fm.removeValue('task', '10');
    
    expect(fm.filters.task).toEqual(['20']);
  });
});

// ============================================================================
// TESTS: Origine des changements (local vs external)
// ============================================================================
describe('FilterManager - Origine des changements', () => {
  
  test('changement local doit appeler onChange avec origin="local"', () => {
    let lastOrigin = null;
    const fm = createFilterManager({
      onChange: (filters, origin) => { lastOrigin = origin; }
    });
    
    fm.setState({ assignee: ['1'] }, { origin: 'local', broadcast: false });
    expect(lastOrigin).toBe('local');
  });

  test('changement externe doit appeler onChange avec origin="external"', () => {
    let lastOrigin = null;
    const fm = createFilterManager({
      onChange: (filters, origin) => { lastOrigin = origin; }
    });
    
    fm.applyExternalFilters({ assignee: ['1', '2'] });
    expect(lastOrigin).toBe('external');
  });

  test('changement externe ne doit PAS appeler onBroadcast', () => {
    let broadcastCalled = false;
    const fm = createFilterManager({
      onBroadcast: () => { broadcastCalled = true; }
    });
    
    fm.applyExternalFilters({ assignee: ['1', '2'] });
    expect(broadcastCalled).toBe(false);
  });

  test('setState avec origin="external" ne doit pas diffuser', () => {
    let broadcastCalled = false;
    const fm = createFilterManager({
      onBroadcast: () => { broadcastCalled = true; }
    });
    
    fm.setState({ assignee: ['1'] }, { origin: 'external', broadcast: false });
    expect(broadcastCalled).toBe(false);
  });
});

// ============================================================================
// TESTS: Intégration - Synchronisation entre widgets
// ============================================================================
describe('Integration - Synchronisation de filtres', () => {
  
  test('scénario complet: Widget A -> Grist -> Widget B', () => {
    // Widget A
    let broadcastFromA = null;
    const widgetA = createFilterManager({
      onBroadcast: (filters) => { broadcastFromA = filters; }
    });
    
    // Widget A applique un filtre local
    widgetA.setState({ programme: ['1', '2'], project: ['5'] }, { origin: 'local' });
    
    // Vérifier que la diffusion contient les IDs en chaînes
    expect(broadcastFromA).not.toBeNull();
    expect(broadcastFromA.programme).toEqual(['1', '2']);
    expect(broadcastFromA.project).toEqual(['5']);
    
    // Widget B reçoit les filtres
    const widgetB = createFilterManager();
    widgetB.applyExternalFilters(broadcastFromA);
    
    // Vérifier que Widget B a les mêmes filtres
    expect(widgetB.filters.programme).toEqual(['1', '2']);
    expect(widgetB.filters.project).toEqual(['5']);
  });

  test('Widget B ne doit pas rediffuser après réception externe', () => {
    let broadcastCount = 0;
    const widgetB = createFilterManager({
      onBroadcast: () => { broadcastCount++; }
    });
    
    // Réception d'un filtre externe
    widgetB.applyExternalFilters({ programme: ['1'], assignee: ['3'] });
    
    // Aucune diffusion ne doit avoir eu lieu
    expect(broadcastCount).toBe(0);
  });

  test('Effacer tout doit aboutir à 5 tableaux vides', () => {
    const fm = createFilterManager({
      initialFilters: { 
        assignee: ['1', '2'], 
        team: ['3'], 
        project: ['4'], 
        programme: ['5'], 
        task: ['6'] 
      }
    });
    
    fm.clearAll();
    
    expect(fm.filters).toEqual({
      assignee: [],
      team: [],
      project: [],
      programme: [],
      task: []
    });
  });

  test('removeFilterChip scénario: suppression depuis les chips', () => {
    const fm = createFilterManager({
      initialFilters: { 
        assignee: ['1'], 
        programme: ['10', '20'], 
        project: ['5'] 
      }
    });
    
    // Simulation de removeFilterChip('programme', '10')
    fm.removeValue('programme', '10');
    
    expect(fm.filters.programme).toEqual(['20']);
    expect(fm.filters.assignee).toEqual(['1']); // Inchangé
    expect(fm.filters.project).toEqual(['5']); // Inchangé
  });
});
});
