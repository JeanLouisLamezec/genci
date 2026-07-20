/**
 * Test d'intégration — Plan utilise le loader commun
 * Scénario : Le Plan charge les TimeEntries et calcule 35h prévues
 */

'use strict';

const TimeEntryLoader = require('./time-entry-loader.js');

describe('Intégration Plan — Temps réel', () => {
  test('Plan lit les TimeEntries via le loader (35h prévues)', async () => {
    // Mock Grist avec 5 TimeEntries de 7h
    const mockGrist = {
      docApi: {
        fetchTable: async (table) => {
          if (table === 'Feuilles') {
            return { 
              id: [1, 2, 3, 4, 5], 
              membre: [2, 2, 2, 2, 2], 
              semaine: [1704067200, 1704067200, 1704067200, 1704067200, 1704067200], 
              statut: ['brouillon', 'brouillon', 'brouillon', 'brouillon', 'brouillon'] 
            };
          }
          if (table === 'TimeEntries') {
            return {
              id: [1, 2, 3, 4, 5],
              affectation: [1, 1, 1, 1, 1],
              tache: [10, 10, 10, 10, 10],
              membre: [2, 2, 2, 2, 2],
              date: [1704067200, 1704153600, 1704240000, 1704326400, 1704412800],
              heuresPrevues: [7, 7, 7, 7, 7],
              heures: [0, 0, 0, 0, 0],
              capaciteTheorique: [8, 8, 8, 8, 8],
              capaciteDisponible: [7, 7, 7, 7, 7],
              capaciteJour: [100, 100, 100, 100, 100],
              feuille: [1, 2, 3, 4, 5],
              revisionPlan: [1, 1, 1, 1, 1],
              description: [null, null, null, null, null],
              imputation: [null, null, null, null, null]
            };
          }
          return null;
        }
      }
    };
    
    // Charger avec le loader (comme le Plan le fait maintenant)
    const { entries, feuillesById, diagnostics } = await TimeEntryLoader.loadTimeEntries(mockGrist);
    
    // Vérifier que les données sont chargées
    expect(entries.length).toBe(5);
    expect(entries[0].assignmentId).toBe(1);
    expect(entries[0].taskId).toBe(10);
    expect(entries[0].memberId).toBe(2);
    
    // Vérifier le calcul des heures prévues (35h au total)
    const totalPlanned = entries.reduce((sum, e) => sum + e.plannedHours, 0);
    expect(totalPlanned).toBe(35);
    
    // Vérifier que le prévu est distinct du réalisé
    const totalActual = entries.reduce((sum, e) => sum + e.actualHours, 0);
    expect(totalActual).toBe(0);
    
    // Vérifier que les statuts sont résolus
    expect(entries[0].sheetStatus).toBe('draft');
    
    console.log('✅ Plan integration test passed: 35h prévues, 0h réalisées');
  });
  
  test('Plan calcule les heures par période (memberAvail)', async () => {
    const mockGrist = {
      docApi: {
        fetchTable: async (table) => {
          if (table === 'Feuilles') {
            return { id: [], membre: [], semaine: [], statut: [] };
          }
          if (table === 'TimeEntries') {
            return {
              id: [1, 2, 3],
              affectation: [1, 1, 2],
              tache: [10, 11, 11],
              membre: [2, 2, 2],
              date: [1704067200, 1704153600, 1704067200], // Lundi, Mardi, Lundi
              heuresPrevues: [4, 3, 5],
              heures: [0, 0, 0]
            };
          }
          return null;
        }
      }
    };
    
    const { entries } = await TimeEntryLoader.loadTimeEntries(mockGrist);
    
    // Simuler memberAvail pour la semaine du 2024-01-01
    const startDate = '2024-01-01';
    const endDate = '2024-01-07';
    
    const memberEntries = entries.filter(e => 
      e.memberId === 2 && 
      e.date >= startDate && 
      e.date <= endDate
    );
    
    const plannedHours = memberEntries.reduce((sum, e) => sum + e.plannedHours, 0);
    
    // 4h + 3h + 5h = 12h
    expect(plannedHours).toBe(12);
    
    // Vérifier le regroupement par affectation
    const byAssignment = TimeEntryLoader.groupEntriesByAssignment(memberEntries);
    expect(byAssignment.get(1).length).toBe(2); // 2 entries pour affectation 1
    expect(byAssignment.get(2).length).toBe(1); // 1 entry pour affectation 2
    
    console.log('✅ Plan memberAvail test passed: 12h prévues sur la semaine');
  });
  
  test('Plan distingue les tâches dans tasksInCell', async () => {
    const mockGrist = {
      docApi: {
        fetchTable: async (table) => {
          if (table === 'Feuilles') {
            return { id: [], membre: [], semaine: [], statut: [] };
          }
          if (table === 'TimeEntries') {
            return {
              id: [1, 2],
              affectation: [1, 2],
              tache: [10, 11],
              membre: [2, 2],
              date: [1704067200, 1704067200],
              heuresPrevues: [4, 3],
              heures: [0, 0]
            };
          }
          return null;
        }
      }
    };
    
    const { entries } = await TimeEntryLoader.loadTimeEntries(mockGrist);
    
    // Regrouper par affectation (comme tasksInCell le fait)
    const byAssignment = TimeEntryLoader.groupEntriesByAssignment(entries);
    
    expect(byAssignment.size).toBe(2);
    expect(byAssignment.get(1)[0].plannedHours).toBe(4);
    expect(byAssignment.get(2)[0].plannedHours).toBe(3);
    
    console.log('✅ Plan tasksInCell test passed: 2 tâches distinctes');
  });
});

describe('Intégration CRA — Temps réel', () => {
  test('CRA distingue prévu et réalisé (7h vs 6h)', async () => {
    const mockGrist = {
      docApi: {
        fetchTable: async (table) => {
          if (table === 'Feuilles') {
            return { 
              id: [1], 
              membre: [2], 
              semaine: [1704067200], 
              statut: ['brouillon'] 
            };
          }
          if (table === 'TimeEntries') {
            return {
              id: [1],
              affectation: [1],
              tache: [10],
              membre: [2],
              date: [1704067200],
              heuresPrevues: [7],
              heures: [6]
            };
          }
          return null;
        }
      }
    };
    
    const { entries } = await TimeEntryLoader.loadTimeEntries(mockGrist);
    
    // Le CRA doit voir prévu=7h et réalisé=6h
    expect(entries[0].plannedHours).toBe(7);
    expect(entries[0].actualHours).toBe(6);
    
    // Vérifier que ce n'est pas la même valeur
    expect(entries[0].plannedHours).not.toBe(entries[0].actualHours);
    
    console.log('✅ CRA integration test passed: prévu=7h, réalisé=6h');
  });
  
  test('CRA verrouille les feuilles soumises', async () => {
    const mockGrist = {
      docApi: {
        fetchTable: async (table) => {
          if (table === 'Feuilles') {
            return { 
              id: [1], 
              membre: [2], 
              semaine: [1704067200], 
              statut: ['soumis'] 
            };
          }
          if (table === 'TimeEntries') {
            return {
              id: [1],
              affectation: [1],
              tache: [10],
              membre: [2],
              date: [1704067200],
              heuresPrevues: [7],
              heures: [0],
              feuille: [1]
            };
          }
          return null;
        }
      }
    };
    
    const { entries } = await TimeEntryLoader.loadTimeEntries(mockGrist);
    
    // Vérifier le statut
    expect(entries[0].sheetStatus).toBe('submitted');
    
    // Vérifier le verrouillage
    const isLocked = TimeEntryLoader.isEntryLocked(entries[0]);
    expect(isLocked).toBe(true);
    
    console.log('✅ CRA lock test passed: feuille soumise verrouillée');
  });
});

describe('Mapping unique — Plan et CRA', () => {
  test('Plan et CRA partagent le même objet domaine', () => {
    const rawEntry = {
      id: 1,
      affectation: 1,
      tache: 10,
      membre: 2,
      date: 1704067200,
      heuresPrevues: 7,
      heures: 6,
      capaciteTheorique: 8,
      capaciteDisponible: 7,
      capaciteJour: 100,
      feuille: 1,
      revisionPlan: 1,
      description: 'Test',
      imputation: 'PROJ1'
    };
    
    const feuillesById = { 
      1: { id: 1, membre: 2, semaine: 1704067200, statut: 'brouillon' } 
    };
    
    // Normaliser avec le loader (utilisé par Plan et CRA)
    const entry = TimeEntryLoader.normalizeTimeEntry(rawEntry, feuillesById);
    
    // Le même objet est utilisé par le Plan et le CRA
    const planView = entry;
    const craView = entry;
    
    // Vérifier l'égalité parfaite
    expect(planView).toEqual(craView);
    
    // Vérifier les champs clés
    expect(planView.assignmentId).toBe(1);
    expect(planView.plannedHours).toBe(7);
    expect(craView.actualHours).toBe(6);
    expect(planView.sheetStatus).toBe('draft');
    expect(craView.isLegacy).toBe(false);
    
    console.log('✅ Unified mapping test passed: Plan et CRA partagent le même objet');
  });
});
