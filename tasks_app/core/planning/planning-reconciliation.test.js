/**
 * Tests unitaires pour Planning Reconciliation
 * 
 * Couvre les scénarios d'idempotence, verrouillage, conflits,
 * préservation des champs manuels, doublons et capacités.
 */

'use strict';

const { reconcileDailyEntries, makeEntryKey, areDifferent, findDuplicatesInArray } = require('./planning-reconciliation.js');

describe('Planning Reconciliation - Idempotence', () => {
  
  test('Deux exécutions avec mêmes données sont idempotentes', () => {
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 3.5,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null,
        feuille: null,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const desiredPlan = [
      {
        assignmentId: 1,
        taskId: 1,
        memberId: 1,
        date: '2026-07-01',
        plannedHours: 3.5,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const result1 = reconcileDailyEntries(existingEntries, desiredPlan);
    const result2 = reconcileDailyEntries(existingEntries, desiredPlan);
    
    expect(result1.creates.length).toBe(result2.creates.length);
    expect(result1.updates.length).toBe(result2.updates.length);
    expect(result1.deletes.length).toBe(result2.deletes.length);
    expect(result1.conflicts.length).toBe(result2.conflicts.length);
    
    expect(result1.updates.length).toBe(0);
    expect(result1.creates.length).toBe(0);
  });
});

describe('Planning Reconciliation - Verrouillage', () => {
  
  test('Ligne soumise ou validée n\'est jamais modifiée', () => {
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 2,
        actualHours: 0,
        sheetStatus: 'submitted',
        description: null,
        imputation: null,
        feuille: null,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      },
      {
        id: 2,
        assignmentId: 1,
        date: '2026-07-02',
        plannedHours: 3,
        actualHours: 0,
        sheetStatus: 'validated',
        description: null,
        imputation: null,
        feuille: null,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const desiredPlan = [
      {
        assignmentId: 1,
        taskId: 1,
        memberId: 1,
        date: '2026-07-01',
        plannedHours: 5,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      },
      {
        assignmentId: 1,
        taskId: 1,
        memberId: 1,
        date: '2026-07-02',
        plannedHours: 6,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const result = reconcileDailyEntries(existingEntries, desiredPlan);
    
    expect(result.updates.length).toBe(0);
    expect(result.conflicts.length).toBe(2);
    
    const conflictDates = result.conflicts.map(c => c.date);
    expect(conflictDates).toContain('2026-07-01');
    expect(conflictDates).toContain('2026-07-02');
  });
});

describe('Planning Reconciliation - Lignes avec réalisé', () => {
  
  test('Ligne avec réalisé mais plus de prévu est conservée avec plannedHours = 0', () => {
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 3.5,
        actualHours: 2,
        sheetStatus: null,
        description: 'Travail effectué',
        imputation: null,
        feuille: null,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const desiredPlan = [
      {
        assignmentId: 1,
        taskId: 1,
        memberId: 1,
        date: '2026-07-01',
        plannedHours: 0,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const result = reconcileDailyEntries(existingEntries, desiredPlan);
    
    expect(result.deletes.length).toBe(0);
    expect(result.updates.length).toBe(1);
    expect(result.updates[0].fields.plannedHours).toBe(0);
  });
});

describe('Planning Reconciliation - Suppression lignes vides', () => {
  
  test('Ligne vide et mutable devenue inutile peut être supprimée', () => {
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 0,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null,
        feuille: null,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const desiredPlan = [];
    
    const result = reconcileDailyEntries(existingEntries, desiredPlan);
    
    expect(result.deletes.length).toBe(1);
    expect(result.deletes[0].id).toBe(1);
    expect(result.deletes[0].reason).toBe('ENTRY_EMPTY_AND_MUTABLE');
  });

  test('Ligne avec description n\'est pas supprimée', () => {
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 0,
        actualHours: 0,
        sheetStatus: null,
        description: 'Note importante',
        imputation: null,
        feuille: null,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const desiredPlan = [];
    
    const result = reconcileDailyEntries(existingEntries, desiredPlan);
    
    expect(result.deletes.length).toBe(0);
    expect(result.updates.length).toBe(0);
  });

  test('Ligne avec imputation n\'est pas supprimée', () => {
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 0,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: 'PROJ-123',
        feuille: null,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const desiredPlan = [];
    
    const result = reconcileDailyEntries(existingEntries, desiredPlan);
    
    expect(result.deletes.length).toBe(0);
  });

  test('Ligne avec feuille n\'est pas supprimée', () => {
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 0,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null,
        feuille: 42,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const desiredPlan = [];
    
    const result = reconcileDailyEntries(existingEntries, desiredPlan);
    
    expect(result.deletes.length).toBe(0);
  });
});

describe('Planning Reconciliation - Conflits', () => {
  
  test('Deux lignes avec même clé produisent un conflit explicite', () => {
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 3,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null,
        feuille: null,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      },
      {
        id: 2,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 4,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null,
        feuille: null,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const desiredPlan = [];
    
    const result = reconcileDailyEntries(existingEntries, desiredPlan);
    
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].code).toBe('DUPLICATE_EXISTING_ENTRY');
    expect(result.conflicts[0].key).toBe('1:2026-07-01');
    expect(result.conflicts[0].entryIds).toEqual([1, 2]);
  });

  test('Doublon dans desiredPlan produit un conflit', () => {
    const existingEntries = [];
    
    const desiredPlan = [
      {
        assignmentId: 1,
        taskId: 1,
        memberId: 1,
        date: '2026-07-01',
        plannedHours: 3,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      },
      {
        assignmentId: 1,
        taskId: 1,
        memberId: 1,
        date: '2026-07-01',
        plannedHours: 4,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const result = reconcileDailyEntries(existingEntries, desiredPlan);
    
    expect(result.conflicts.some(c => c.code === 'DUPLICATE_DESIRED_ENTRY')).toBe(true);
  });

  test('Un conflit ne produit aucune autre opération sur la clé', () => {
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 3,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null,
        feuille: null,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      },
      {
        id: 2,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 4,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null,
        feuille: null,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const desiredPlan = [
      {
        assignmentId: 1,
        taskId: 1,
        memberId: 1,
        date: '2026-07-01',
        plannedHours: 5,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const result = reconcileDailyEntries(existingEntries, desiredPlan);
    
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.creates.length).toBe(0);
    expect(result.updates.length).toBe(0);
    expect(result.deletes.length).toBe(0);
  });
});

describe('Planning Reconciliation - Préservation champs manuels', () => {
  
  test('Les champs manuels sont toujours préservés', () => {
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 2,
        actualHours: 1.5,
        sheetStatus: null,
        description: 'Description manuelle',
        imputation: 'MANUAL-IMP',
        feuille: 10,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const desiredPlan = [
      {
        assignmentId: 1,
        taskId: 1,
        memberId: 1,
        date: '2026-07-01',
        plannedHours: 5,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const result = reconcileDailyEntries(existingEntries, desiredPlan);
    
    expect(result.updates.length).toBe(1);
    expect(result.updates[0].fields.plannedHours).toBe(5);
    expect(result.updates[0].fields.actualHours).toBeUndefined();
    expect(result.updates[0].fields.description).toBeUndefined();
    expect(result.updates[0].fields.imputation).toBeUndefined();
    expect(result.updates[0].fields.feuille).toBeUndefined();
  });
});

describe('Planning Reconciliation - Créations', () => {
  
  test('Nouvelle entrée du plan désiré est créée', () => {
    const existingEntries = [];
    
    const desiredPlan = [
      {
        assignmentId: 1,
        taskId: 1,
        memberId: 1,
        date: '2026-07-01',
        plannedHours: 3.5,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const result = reconcileDailyEntries(existingEntries, desiredPlan);
    
    expect(result.creates.length).toBe(1);
    expect(result.creates[0].assignmentId).toBe(1);
    expect(result.creates[0].date).toBe('2026-07-01');
    expect(result.creates[0].plannedHours).toBe(3.5);
  });
});

describe('Planning Reconciliation - Mises à jour', () => {
  
  test('Entrée existante avec écart de prévu est mise à jour', () => {
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 2,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null,
        feuille: null,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const desiredPlan = [
      {
        assignmentId: 1,
        taskId: 1,
        memberId: 1,
        date: '2026-07-01',
        plannedHours: 5,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const result = reconcileDailyEntries(existingEntries, desiredPlan);
    
    expect(result.updates.length).toBe(1);
    expect(result.updates[0].id).toBe(1);
    expect(result.updates[0].fields.plannedHours).toBe(5);
  });

  test('Mise à jour des capacités même si prévu identique', () => {
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 3.5,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null,
        feuille: null,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const desiredPlan = [
      {
        assignmentId: 1,
        taskId: 1,
        memberId: 1,
        date: '2026-07-01',
        plannedHours: 3.5,
        baseCapacityHours: 7,
        availableCapacityHours: 3.5
      }
    ];
    
    const result = reconcileDailyEntries(existingEntries, desiredPlan);
    
    expect(result.updates.length).toBe(1);
    expect(result.updates[0].fields.plannedHours).toBeUndefined();
    expect(result.updates[0].fields.availableCapacityHours).toBe(3.5);
  });
});

describe('Planning Reconciliation - Précision', () => {
  
  test('Différence exacte de 0,01h déclenche une mise à jour', () => {
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 3.5,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null,
        feuille: null,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const desiredPlan = [
      {
        assignmentId: 1,
        taskId: 1,
        memberId: 1,
        date: '2026-07-01',
        plannedHours: 3.51,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      }
    ];
    
    const result = reconcileDailyEntries(existingEntries, desiredPlan, { precisionHours: 0.01 });
    
    expect(result.updates.length).toBe(1);
    expect(result.updates[0].fields.plannedHours).toBe(3.51);
  });

  test('areDifferent compare exactement les centièmes', () => {
    expect(areDifferent(100, 100)).toBe(false);
    expect(areDifferent(100, 101)).toBe(true);
    expect(areDifferent(100, 99)).toBe(true);
    expect(areDifferent(0, 1)).toBe(true);
  });
});

describe('Planning Reconciliation - makeEntryKey', () => {
  
  test('Clé unique pour assignmentId + date', () => {
    expect(makeEntryKey(1, '2026-07-01')).toBe('1:2026-07-01');
    expect(makeEntryKey(1, '2026-07-02')).toBe('1:2026-07-02');
    expect(makeEntryKey(2, '2026-07-01')).toBe('2:2026-07-01');
  });
});

describe('Planning Reconciliation - findDuplicatesInArray', () => {
  
  test('Détecte les doublons avec une fonction clé', () => {
    const items = [
      { id: 1, key: 'a' },
      { id: 2, key: 'a' },
      { id: 3, key: 'b' }
    ];
    
    const result = findDuplicatesInArray(items, item => item.key);
    
    expect(result.hasDuplicates).toBe(true);
    expect(result.duplicates.length).toBe(1);
    expect(result.duplicates[0].key).toBe('a');
  });
});
