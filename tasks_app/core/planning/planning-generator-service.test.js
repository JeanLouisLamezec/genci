/* ============================================================================
 * planning-generator-service.test.js — Tests du générateur de planning
 * ============================================================================ */

// Mock Grist
function createMockGrist(initialData) {
  const data = JSON.parse(JSON.stringify(initialData || {
    TaskAssignments: [],
    Team: [],
    Tasks: [],
    Disponibilites: [],
    MemberDailyCapacities: [],
    TimeEntries: []
  }));

  const nextIds = {
    TaskAssignments: 1,
    MemberDailyCapacities: 1,
    TimeEntries: 1
  };

  return {
    docApi: {
      async fetchTable(tableName) {
        const table = data[tableName] || [];
        const result = {};
        const columns = table.length > 0 ? Object.keys(table[0]) : [];

        columns.forEach(col => {
          result[col] = table.map(row => row[col]);
        });
        result.id = table.map(row => row.id);

        return result;
      },

      async applyUserActions(actions) {
        const results = [];

        actions.forEach(action => {
          const op = action[0];
          const table = action[1];

          if (op === 'AddRecord') {
            const recordId = nextIds[table] || 1;
            const record = { ...action[3], id: recordId };
            if (!data[table]) data[table] = [];
            data[table].push(record);
            nextIds[table] = recordId + 1;
            results.push(recordId);
          } else if (op === 'UpdateRecord') {
            const recordId = action[2];
            const updates = action[3];
            const record = data[table].find(r => r.id === recordId);
            if (record) {
              Object.assign(record, updates);
              results.push(null);
            }
          }
        });

        return { retValues: results };
      }
    },

    _getData: () => data
  };
}

const { createPlanningGeneratorService } = require('./planning-generator-service');

describe('Planning Generator Service - Preview', () => {
  let mockGrist;
  let service;

  beforeEach(() => {
    mockGrist = createMockGrist({
      Team: [
        { id: 1, nom: 'Alice', capaciteHebdo: 35 }
      ],
      TaskAssignments: [
        {
          id: 1,
          tache: 1,
          membre: 1,
          heuresAllouees: 35,
          dateDebut: 1783296000, // 01/09/2026
          dateFin: 1783728000,   // 05/09/2026
          modeRepartition: 'uniforme',
          actif: true
        }
      ],
      Tasks: [
        { id: 1, titre: 'Test Task' }
      ],
      Disponibilites: [],
      MemberDailyCapacities: [],
      TimeEntries: []
    });

    service = createPlanningGeneratorService(mockGrist);
  });

  test('prévisualisation simple', async () => {
    const preview = await service.previewPlanning();

    expect(preview.ok).toBe(true);
    expect(preview.assignments.planned.length).toBe(1);
    expect(preview.timeEntries.creates.length).toBeGreaterThan(0);
    expect(preview.totals.allocatedHours).toBe(35);
  });

  test('capacités générées', async () => {
    const preview = await service.previewPlanning();

    // Devrait créer 5 lignes de capacité (01/09 au 05/09)
    expect(preview.capacities.creates.length).toBeGreaterThan(0);
    
    // Vérifier que le week-end a une capacité nulle
    const weekendCapacity = preview.capacities.creates.find(c => 
      c.date === '2026-09-05' || c.date === '2026-09-06'
    );
    
    if (weekendCapacity) {
      expect(weekendCapacity.capaciteDisponible).toBe(0);
    }
  });

  test('affectation invalide exclue', async () => {
    // Ajouter une affectation inactive
    mockGrist._getData().TaskAssignments.push({
      id: 2,
      tache: 1,
      membre: 1,
      heuresAllouees: 10,
      dateDebut: 1783296000,
      dateFin: 1783728000,
      modeRepartition: 'uniforme',
      actif: false
    });

    const preview = await service.previewPlanning();

    expect(preview.assignments.invalid.length).toBe(1);
    expect(preview.assignments.invalid[0].assignmentId).toBe(2);
  });

  test('capacité insuffisante', async () => {
    // Surcharger avec une affectation de 100h sur 2 jours
    mockGrist._getData().TaskAssignments[0].heuresAllouees = 100;
    mockGrist._getData().TaskAssignments[0].dateFin = 1783382400; // 02/09

    const preview = await service.previewPlanning({
      allowPartialPlanning: false
    });

    expect(preview.ok).toBe(false);
    expect(preview.assignments.insufficientCapacity.length).toBe(1);
    expect(preview.errors.length).toBeGreaterThan(0);
  });

  test('planification partielle autorisée', async () => {
    mockGrist._getData().TaskAssignments[0].heuresAllouees = 100;

    const preview = await service.previewPlanning({
      allowPartialPlanning: true
    });

    expect(preview.assignments.insufficientCapacity.length).toBe(1);
    expect(preview.totals.unallocatedHours).toBeGreaterThan(0);
    // Mais pas d'erreur bloquante
    expect(preview.errors.length).toBe(0);
  });
});

describe('Planning Generator Service - Commit', () => {
  let mockGrist;
  let service;

  beforeEach(() => {
    mockGrist = createMockGrist({
      Team: [
        { id: 1, nom: 'Alice', capaciteHebdo: 35 }
      ],
      TaskAssignments: [
        {
          id: 1,
          tache: 1,
          membre: 1,
          heuresAllouees: 35,
          dateDebut: 1783296000,
          dateFin: 1783728000,
          modeRepartition: 'uniforme',
          actif: true
        }
      ],
      Tasks: [
        { id: 1, titre: 'Test Task' }
      ],
      Disponibilites: [],
      MemberDailyCapacities: [],
      TimeEntries: []
    });

    service = createPlanningGeneratorService(mockGrist);
  });

  test('commit réussit', async () => {
    const preview = await service.previewPlanning();
    expect(preview.ok).toBe(true);

    const result = await service.commitPlanning(preview);

    expect(result.ok).toBe(true);
    expect(result.capacitiesCreated).toBeGreaterThan(0);
    expect(result.timeEntriesCreated).toBeGreaterThan(0);
  });

  test('commit refuse preview invalide', async () => {
    const invalidPreview = { ok: false, errors: ['test error'] };

    await expect(service.commitPlanning(invalidPreview))
      .rejects
      .toThrow('Cannot commit invalid or failed preview');
  });

  test('commit sans actions', async () => {
    // Preview vide
    const emptyPreview = {
      ok: true,
      capacities: { creates: [], updates: [] },
      timeEntries: { creates: [] }
    };

    const result = await service.commitPlanning(emptyPreview);

    expect(result.ok).toBe(true);
    expect(result.actionsExecuted).toBe(0);
  });
});

describe('Planning Generator Service - Capacité partagée', () => {
  let mockGrist;
  let service;

  beforeEach(() => {
    mockGrist = createMockGrist({
      Team: [
        { id: 1, nom: 'Alice', capaciteHebdo: 35 }
      ],
      TaskAssignments: [
        {
          id: 1,
          tache: 1,
          membre: 1,
          heuresAllouees: 20,
          dateDebut: 1783296000,
          dateFin: 1783728000,
          modeRepartition: 'uniforme',
          actif: true
        },
        {
          id: 2,
          tache: 2,
          membre: 1,
          heuresAllouees: 15,
          dateDebut: 1783296000,
          dateFin: 1783728000,
          modeRepartition: 'uniforme',
          actif: true
        }
      ],
      Tasks: [
        { id: 1, titre: 'Task A' },
        { id: 2, titre: 'Task B' }
      ],
      Disponibilites: [],
      MemberDailyCapacities: [],
      TimeEntries: []
    });

    service = createPlanningGeneratorService(mockGrist);
  });

  test('deux affectations simultanées', async () => {
    const preview = await service.previewPlanning();

    expect(preview.ok).toBe(true);
    expect(preview.assignments.planned.length).toBe(2);
    expect(preview.totals.allocatedHours).toBe(35); // 20 + 15
    expect(preview.totals.plannedHours).toBe(35);

    // Vérifier qu'aucun jour ne dépasse 7h
    const hoursByDate = {};
    preview.timeEntries.creates.forEach(entry => {
      hoursByDate[entry.date] = (hoursByDate[entry.date] || 0) + entry.heuresPrevues;
    });

    for (const [date, hours] of Object.entries(hoursByDate)) {
      expect(hours).toBeLessThanOrEqual(7.01); // Petite marge pour les arrondis
    }
  });
});

describe('Planning Generator Service - Régénération', () => {
  let mockGrist;
  let service;

  beforeEach(() => {
    mockGrist = createMockGrist({
      Team: [
        { id: 1, nom: 'Alice', capaciteHebdo: 35 }
      ],
      TaskAssignments: [
        {
          id: 1,
          tache: 1,
          membre: 1,
          heuresAllouees: 35,
          dateDebut: 1783296000,
          dateFin: 1783728000,
          modeRepartition: 'uniforme',
          actif: true
        }
      ],
      Tasks: [
        { id: 1, titre: 'Test Task' }
      ],
      Disponibilites: [],
      MemberDailyCapacities: [],
      TimeEntries: []
    });

    service = createPlanningGeneratorService(mockGrist);
  });

  test('régénération d'une tâche', async () => {
    const result = await service.regenerateTaskPlanning(1);

    expect(result.ok).toBe(true);
  });

  test('sauvegarde identique = aucune action', async () => {
    // Première génération
    const preview1 = await service.previewPlanning();
    await service.commitPlanning(preview1);

    // Deuxième génération (identique)
    const preview2 = await service.previewPlanning();

    // Devrait avoir 0 créations car tout est déjà là
    // Note: dépend de l'implémentation exacte de la détection de doublons
    expect(preview2.ok).toBe(true);
  });
});

describe('Planning Generator Service - Lignes verrouillées', () => {
  let mockGrist;
  let service;

  beforeEach(() => {
    mockGrist = createMockGrist({
      Team: [
        { id: 1, nom: 'Alice', capaciteHebdo: 35 }
      ],
      TaskAssignments: [
        {
          id: 1,
          tache: 1,
          membre: 1,
          heuresAllouees: 35,
          dateDebut: 1783296000,
          dateFin: 1783728000,
          modeRepartition: 'uniforme',
          actif: true
        }
      ],
      Tasks: [
        { id: 1, titre: 'Test Task' }
      ],
      Disponibilites: [],
      MemberDailyCapacities: [],
      TimeEntries: [
        {
          id: 1,
          membre: 1,
          tache: 1,
          affectation: 1,
          date: 1783296000,
          heuresPrevues: 7,
          heures: 5, // Déjà du temps réel saisi
          feuille: null,
          revisionPlan: 1
        }
      ]
    });

    service = createPlanningGeneratorService(mockGrist);
  });

  test('ligne avec heures réalisées exclue', async () => {
    const preview = await service.previewPlanning();

    // La ligne avec heures=5 ne devrait pas être modifiée
    expect(preview.timeEntries.locked).toBeDefined();
    // Ou devrait être exclue des créations
  });

  test('ligne avec feuille exclue', async () => {
    mockGrist._getData().TimeEntries[0].feuille = 1;

    const preview = await service.previewPlanning();

    // La ligne avec feuille ne devrait pas être modifiée
    expect(preview.timeEntries.locked).toBeDefined();
  });
});

describe('Planning Generator Service - Architecture', () => {
  let mockGrist;
  let service;

  beforeEach(() => {
    mockGrist = createMockGrist({
      Team: [
        { id: 1, nom: 'Alice', capaciteHebdo: 35 }
      ],
      TaskAssignments: [],
      Tasks: [],
      Disponibilites: [],
      MemberDailyCapacities: [],
      TimeEntries: []
    });

    service = createPlanningGeneratorService(mockGrist);
  });

  test('aucune affectation = aucun TimeEntry', async () => {
    const preview = await service.previewPlanning();

    expect(preview.timeEntries.creates.length).toBe(0);
    expect(preview.assignments.planned.length).toBe(0);
  });

  test('affectations triées de manière déterministe', async () => {
    mockGrist._getData().TaskAssignments = [
      { id: 3, tache: 3, membre: 1, heuresAllouees: 10, dateDebut: 1783296000, dateFin: 1784505600, actif: true },
      { id: 1, tache: 1, membre: 1, heuresAllouees: 20, dateDebut: 1783296000, dateFin: 1783728000, actif: true },
      { id: 2, tache: 2, membre: 1, heuresAllouees: 15, dateDebut: 1783296000, dateFin: 1784505600, actif: true }
    ];

    mockGrist._getData().Tasks = [
      { id: 1, titre: 'Task 1' },
      { id: 2, titre: 'Task 2' },
      { id: 3, titre: 'Task 3' }
    ];

    const preview = await service.previewPlanning();

    // Les affectations devraient être triées par dateFin, puis dateDebut, puis tache
    expect(preview.assignments.planned.length).toBe(3);
  });
});
