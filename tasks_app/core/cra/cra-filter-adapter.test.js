/**
 * Tests unitaires pour CRA Filter Adapter
 * @see cra-filter-adapter.js pour l'implémentation
 * 
 * Usage: npm test -- cra-filter-adapter.test.js --runInBand
 */

const CraFilterAdapter = require('./cra-filter-adapter.js');

const {
  normalizeCraFilters,
  craFilterSignature,
  sameCraFilters,
  filterCraTasks
} = CraFilterAdapter;

// Données de test
const mockProjects = [
  { id: 1, nom: 'Projet 1', programme: 10, portefeuille: 100 },
  { id: 2, nom: 'Projet 2', programme: 20, portefeuille: 200 },
  { id: 3, nom: 'Projet 3', portefeuille: 300 } // pas de programme, juste portefeuille
];

const mockTasks = [
  { id: 50, titre: 'Tâche 50', projet: 1 },
  { id: 51, titre: 'Tâche 51', projet: 1 },
  { id: 52, titre: 'Tâche 52', projet: 2 },
  { id: 53, titre: 'Tâche 53', projet: 3 }
];

describe('normalizeCraFilters', () => {
  
  test('Test 1 — Normalisation avec nombres et doublons', () => {
    const result = normalizeCraFilters({
      assignee: [2, '2'],
      programme: [10],
      task: null
    });
    
    expect(result).toEqual({
      assignee: ['2'],
      team: [],
      project: [],
      programme: ['10'],
      task: []
    });
  });
  
  test('doit retourner un objet vide avec 5 clés pour input null', () => {
    const result = normalizeCraFilters(null);
    expect(result).toEqual({
      assignee: [],
      team: [],
      project: [],
      programme: [],
      task: []
    });
  });
  
  test('doit trier les valeurs pour signature stable', () => {
    const result = normalizeCraFilters({
      assignee: [3, 1, 2]
    });
    expect(result.assignee).toEqual(['1', '2', '3']);
  });
  
  test('doit éliminer null, undefined et chaînes vides', () => {
    const result = normalizeCraFilters({
      assignee: [1, null, '2', undefined, '', 3]
    });
    expect(result.assignee).toEqual(['1', '2', '3']);
  });
  
  test('doit être immuable', () => {
    const input = { assignee: [1, 2], project: [3] };
    const inputCopy = JSON.parse(JSON.stringify(input));
    normalizeCraFilters(input);
    expect(input).toEqual(inputCopy);
  });
});

describe('craFilterSignature', () => {
  
  test('Test 2 - Signature independante de l ordre', () => {
    const sig1 = craFilterSignature({ assignee: ['2', '1'] });
    const sig2 = craFilterSignature({ assignee: ['1', '2'] });
    expect(sig1).toBe(sig2);
  });
  
  test('doit produire la même signature pour des états équivalents', () => {
    const sig1 = craFilterSignature({
      assignee: [1, 2],
      programme: [10]
    });
    const sig2 = craFilterSignature({
      assignee: ['2', '1'],
      programme: ['10']
    });
    expect(sig1).toBe(sig2);
  });
  
  test('doit produire des signatures différentes pour des états différents', () => {
    const sig1 = craFilterSignature({ assignee: ['1'] });
    const sig2 = craFilterSignature({ assignee: ['2'] });
    expect(sig1).not.toBe(sig2);
  });
});

describe('sameCraFilters', () => {
  
  test('doit retourner true pour des filtres équivalents', () => {
    expect(sameCraFilters(
      { assignee: [1, 2] },
      { assignee: ['2', '1'] }
    )).toBe(true);
  });
  
  test('doit retourner false pour des filtres différents', () => {
    expect(sameCraFilters(
      { assignee: ['1'] },
      { assignee: ['2'] }
    )).toBe(false);
  });
});

describe('filterCraTasks', () => {
  
  test('Test 3 — Filtre par projet', () => {
    const result = filterCraTasks(
      mockTasks,
      { project: ['2'] },
      mockProjects
    );
    
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(52);
  });
  
  test('Test 4 — Filtre par programme', () => {
    const result = filterCraTasks(
      mockTasks,
      { programme: ['10'] },
      mockProjects
    );
    
    expect(result.length).toBe(2);
    expect(result.map(t => t.id)).toEqual([50, 51]);
  });
  
  test('Test 5 — Rétrocompatibilité portefeuille', () => {
    const result = filterCraTasks(
      mockTasks,
      { programme: ['300'] },
      mockProjects
    );
    
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(53);
  });
  
  test('Test 6 — Filtre par tâche', () => {
    const result = filterCraTasks(
      mockTasks,
      { task: ['50'] },
      mockProjects
    );
    
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(50);
  });
  
  test('Test 7 — Combinaison project + programme + task', () => {
    const result = filterCraTasks(
      mockTasks,
      {
        project: ['1', '2'],
        programme: ['10'],
        task: ['50', '52']
      },
      mockProjects
    );
    
    // Tâche 50: projet 1 (programme 10) ✓, task 50 ✓
    // Tâche 52: projet 2 (programme 20) ✗ (programme 10 requis)
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(50);
  });
  
  test('doit appliquer OR dans une catégorie', () => {
    const result = filterCraTasks(
      mockTasks,
      { project: ['1', '2'] },
      mockProjects
    );
    
    expect(result.length).toBe(3);
    expect(result.map(t => t.id)).toEqual([50, 51, 52]);
  });
  
  test('doit appliquer AND entre catégories', () => {
    const result = filterCraTasks(
      mockTasks,
      {
        project: ['1'],
        task: ['51']
      },
      mockProjects
    );
    
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(51);
  });
  
  test('doit exclure les tâches sans projet correspondant', () => {
    const tasksWithNull = [
      ...mockTasks,
      { id: 99, titre: 'Orpheline', projet: null }
    ];
    
    const result = filterCraTasks(
      tasksWithNull,
      { project: ['1'] },
      mockProjects
    );
    
    expect(result.find(t => t.id === 99)).toBeUndefined();
  });
  
  test('Test 8 — Ne pas filtrer par assignee/team', () => {
    const result = filterCraTasks(
      mockTasks,
      {
        assignee: ['999'],
        team: ['999']
      },
      mockProjects
    );
    
    expect(result.length).toBe(4);
  });
  
  test('doit gérer projects undefined', () => {
    const result = filterCraTasks(
      mockTasks,
      { programme: ['10'] },
      undefined
    );
    
    expect(result.length).toBe(0);
  });
  
  test('doit gérer tasks undefined', () => {
    const result = filterCraTasks(
      undefined,
      { project: ['1'] },
      mockProjects
    );
    
    expect(result.length).toBe(0);
  });
});

// Tests de broadcastCraFilters nécessitent un état global propre
// Ces tests sont couverts par les tests d'intégration CRA

describe('createCraFilterSynchronizer', () => {
  
  beforeEach(() => {
    // Mock CraPersonFilter in global scope
    global.CraPersonFilter = {
      applyPersonFilters: jest.fn((params) => ({
        visiblePersonIds: params.filters.assignee.length > 0 
          ? params.filters.assignee.map(Number)
          : [params.currentPersonId || 1],
        selectedPersonId: params.filters.assignee.length > 0
          ? Number(params.filters.assignee[0])
          : params.currentPersonId || 1,
        isEmptyDueToFilter: false
      }))
    };
  });
  
  afterEach(() => {
    delete global.CraPersonFilter;
  });
  
  test('Test 12 - Filtre externe ne diffuse pas', () => {
    let broadcastCalled = false;
    let applyExternalFiltersCalled = false;
    
    const mockS = {
      filters: {},
      team: [],
      selectedPersonId: null,
      visiblePersonIds: [],
      currentUserMemberId: null,
      me: null,
      meName: '',
      filterManager: {
        getState: () => ({ assignee: [], team: [], project: [], programme: [], task: [] }),
        applyExternalFilters: () => {
          applyExternalFiltersCalled = true;
        }
      }
    };
    
    const mockGrist = {
      setOptions: async () => {
        broadcastCalled = true;
      }
    };
    
    const onStateApplied = jest.fn();
    
    const sync = CraFilterAdapter.createCraFilterSynchronizer(mockS, mockGrist, {
      onStateApplied: onStateApplied
    });
    
    sync.applyExternalOptions({
      filters: { programme: ['10'] }
    });
    
    expect(applyExternalFiltersCalled).toBe(true);
    expect(broadcastCalled).toBe(false);
    expect(onStateApplied).not.toHaveBeenCalled();
  });
  
  test('Test 13 - Clear externe', () => {
    const mockS = {
      filters: { assignee: ['1'], team: ['10'] },
      team: [],
      selectedPersonId: null,
      visiblePersonIds: [],
      currentUserMemberId: null,
      me: null,
      meName: '',
      filterManager: {
        getState: () => ({ assignee: ['1'], team: ['10'], project: [], programme: [], task: [] }),
        applyExternalFilters: (filters) => {
          mockS.filters = filters;
        }
      }
    };
    
    const mockGrist = {
      setOptions: async () => {}
    };
    
    const sync = CraFilterAdapter.createCraFilterSynchronizer(mockS, mockGrist);
    
    sync.applyExternalOptions({
      filters: {}
    });
    
    expect(mockS.filters.assignee).toEqual([]);
    expect(mockS.filters.team).toEqual([]);
    expect(mockS.filters.project).toEqual([]);
    expect(mockS.filters.programme).toEqual([]);
    expect(mockS.filters.task).toEqual([]);
  });
  
  test("doit appliquer l'etat via applyCraFilterState avec callback", () => {
    const mockS = {
      filters: {},
      team: [
        { id: 1, nom: 'Alice' },
        { id: 2, nom: 'Bob' }
      ],
      selectedPersonId: 1,
      visiblePersonIds: [1],
      currentUserMemberId: null,
      me: 1,
      meName: 'Alice',
      filterManager: {
        getState: () => ({ assignee: [], team: [], project: [], programme: [], task: [] })
      }
    };
    
    const mockGrist = {
      setOptions: async () => {}
    };
    
    const onStateApplied = jest.fn();
    
    const sync = CraFilterAdapter.createCraFilterSynchronizer(mockS, mockGrist, {
      onStateApplied: onStateApplied
    });
    
    sync.applyCraFilterState(
      { assignee: ['2'] },
      { origin: 'local' }
    );
    
    expect(mockS.filters.assignee).toEqual(['2']);
    expect(mockS.visiblePersonIds).toEqual([2]);
    expect(mockS.selectedPersonId).toBe(2);
    expect(mockS.me).toBe(2);
    expect(mockS.meName).toBe('Bob');
    expect(onStateApplied).toHaveBeenCalledTimes(1);
    expect(onStateApplied).toHaveBeenCalledWith({
      filters: { assignee: ['2'], team: [], project: [], programme: [], task: [] },
      origin: 'local',
      visiblePersonIds: [2],
      selectedPersonId: 2
    });
  });
  
  test('doit avoir un etat de synchronisation propre a chaque instance', () => {
    const mockS1 = {
      filters: {},
      team: [],
      selectedPersonId: null,
      visiblePersonIds: [],
      currentUserMemberId: null,
      me: null,
      meName: '',
      filterManager: {
        getState: () => ({ assignee: [], team: [], project: [], programme: [], task: [] }),
        applyExternalFilters: () => {}
      }
    };
    
    const mockGrist = {
      setOptions: async () => {}
    };
    
    const sync1 = CraFilterAdapter.createCraFilterSynchronizer(mockS1, mockGrist);
    const sync2 = CraFilterAdapter.createCraFilterSynchronizer(mockS1, mockGrist);
    
    // Les deux instances doivent avoir des états différents
    expect(sync1).not.toBe(sync2);
  });
});
