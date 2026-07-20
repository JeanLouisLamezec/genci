/**
 * Tests pour Time Entry Loader
 */

'use strict';

const TimeEntryLoader = require('./time-entry-loader.js');

describe('Time Entry Loader - Normalisation', () => {
  test('normalise une TimeEntry avec tous les champs', () => {
    const raw = {
      id: 1,
      affectation: 5,
      tache: 10,
      membre: 2,
      date: 1704067200, // 2024-01-01
      heuresPrevues: 7,
      heures: 6,
      capaciteTheorique: 8,
      capaciteDisponible: 7,
      capaciteJour: 100,
      feuille: 3,
      revisionPlan: 1,
      description: 'Test',
      imputation: 'PROJ1'
    };
    
    const feuillesById = {
      3: { id: 3, membre: 2, semaine: 1704067200, statut: 'brouillon' }
    };
    
    const entry = TimeEntryLoader.normalizeTimeEntry(raw, feuillesById);
    
    expect(entry.id).toBe(1);
    expect(entry.assignmentId).toBe(5);
    expect(entry.taskId).toBe(10);
    expect(entry.memberId).toBe(2);
    expect(entry.date).toBe('2024-01-01');
    expect(entry.plannedHours).toBe(7);
    expect(entry.actualHours).toBe(6);
    expect(entry.baseCapacityHours).toBe(8);
    expect(entry.availableCapacityHours).toBe(7);
    expect(entry.capacityRecordId).toBe(100);
    expect(entry.sheetId).toBe(3);
    expect(entry.sheetStatus).toBe('draft');
    expect(entry.revisionPlan).toBe(1);
    expect(entry.description).toBe('Test');
    expect(entry.imputation).toBe('PROJ1');
    expect(entry.isLegacy).toBe(false);
  });
  
  test('normalise une TimeEntry legacy sans affectation', () => {
    const raw = {
      id: 2,
      affectation: null,
      tache: 10,
      membre: 2,
      date: 1704067200,
      heuresPrevues: 0,
      heures: 5,
      capaciteTheorique: 0,
      capaciteDisponible: 0,
      capaciteJour: null,
      feuille: null,
      revisionPlan: 0,
      description: null,
      imputation: null
    };
    
    const entry = TimeEntryLoader.normalizeTimeEntry(raw, {});
    
    expect(entry.assignmentId).toBe(null);
    expect(entry.isLegacy).toBe(true);
  });
  
  test('gère les statuts de feuille soumis et validé', () => {
    const raw = { id: 1, affectation: 5, tache: 10, membre: 2, date: 1704067200, heuresPrevues: 7, heures: 0, feuille: 3 };
    
    const feuillesById = {
      3: { id: 3, membre: 2, semaine: 1704067200, statut: 'soumis' }
    };
    
    let entry = TimeEntryLoader.normalizeTimeEntry(raw, feuillesById);
    expect(entry.sheetStatus).toBe('submitted');
    
    feuillesById[3].statut = 'valide';
    entry = TimeEntryLoader.normalizeTimeEntry(raw, feuillesById);
    expect(entry.sheetStatus).toBe('validated');
  });
});

describe('Time Entry Loader - Regroupements', () => {
  test('groupe par affectation', () => {
    const entries = [
      { id: 1, assignmentId: 5, memberId: 2, date: '2024-01-01', plannedHours: 7 },
      { id: 2, assignmentId: 5, memberId: 2, date: '2024-01-02', plannedHours: 7 },
      { id: 3, assignmentId: 6, memberId: 2, date: '2024-01-01', plannedHours: 4 }
    ];
    
    const map = TimeEntryLoader.groupEntriesByAssignment(entries);
    
    expect(map.size).toBe(2);
    expect(map.get(5).length).toBe(2);
    expect(map.get(6).length).toBe(1);
  });
  
  test('groupe par membre et date', () => {
    const entries = [
      { id: 1, assignmentId: 5, memberId: 2, date: '2024-01-01', plannedHours: 7 },
      { id: 2, assignmentId: 6, memberId: 2, date: '2024-01-01', plannedHours: 4 },
      { id: 3, assignmentId: 5, memberId: 2, date: '2024-01-02', plannedHours: 7 }
    ];
    
    const map = TimeEntryLoader.groupEntriesByMemberAndDate(entries);
    
    expect(map.size).toBe(2);
    expect(map.get('2:2024-01-01').length).toBe(2);
    expect(map.get('2:2024-01-02').length).toBe(1);
  });
});

describe('Time Entry Loader - Calculs', () => {
  test('calcule le total des heures prévues pour un membre', () => {
    const entries = [
      { id: 1, assignmentId: 5, memberId: 2, date: '2024-01-01', plannedHours: 7 },
      { id: 2, assignmentId: 5, memberId: 2, date: '2024-01-02', plannedHours: 7 },
      { id: 3, assignmentId: 6, memberId: 3, date: '2024-01-01', plannedHours: 4 }
    ];
    
    const total = TimeEntryLoader.sumPlannedHoursForMember(
      entries, 
      2, 
      '2024-01-01', 
      '2024-01-02'
    );
    
    expect(total).toBe(14);
  });
  
  test('calcule le total des heures réalisées', () => {
    const entries = [
      { id: 1, assignmentId: 5, memberId: 2, date: '2024-01-01', plannedHours: 7, actualHours: 6 },
      { id: 2, assignmentId: 5, memberId: 2, date: '2024-01-02', plannedHours: 7, actualHours: 8 }
    ];
    
    const total = TimeEntryLoader.sumActualHoursForMember(
      entries, 
      2, 
      '2024-01-01', 
      '2024-01-02'
    );
    
    expect(total).toBe(14);
  });
  
  test('calcule le total par affectation', () => {
    const entries = [
      { id: 1, assignmentId: 5, memberId: 2, date: '2024-01-01', plannedHours: 7 },
      { id: 2, assignmentId: 5, memberId: 2, date: '2024-01-02', plannedHours: 7 },
      { id: 3, assignmentId: 6, memberId: 2, date: '2024-01-01', plannedHours: 4 }
    ];
    
    const total = TimeEntryLoader.sumPlannedHoursForAssignment(entries, 5);
    
    expect(total).toBe(14);
  });
});

describe('Time Entry Loader - Helpers de date', () => {
  test('convertit timestamp Grist en ISO', () => {
    const result = TimeEntryLoader.gristDateToIso(1704067200);
    expect(result).toBe('2024-01-01');
  });
  
  test('convertit string ISO en timestamp Grist', () => {
    const result = TimeEntryLoader.isoToGristDate('2024-01-01');
    expect(result).toBe(1704067200);
  });
  
  test('normalise les statuts de feuille', () => {
    expect(TimeEntryLoader.normalizeSheetStatus('brouillon')).toBe('draft');
    expect(TimeEntryLoader.normalizeSheetStatus('soumis')).toBe('submitted');
    expect(TimeEntryLoader.normalizeSheetStatus('valide')).toBe('validated');
    expect(TimeEntryLoader.normalizeSheetStatus('draft')).toBe('draft');
    expect(TimeEntryLoader.normalizeSheetStatus('submitted')).toBe('submitted');
    expect(TimeEntryLoader.normalizeSheetStatus('validated')).toBe('validated');
  });
});

describe('Scénario 1 — Lecture commune', () => {
  test('Plan et CRA lisent les mêmes TimeEntries', () => {
    // Données : TaskAssignment Alice → Tâche A
    // 5 TimeEntries de 7h prévues, 0h réalisées
    const entries = [
      { id: 1, assignmentId: 1, taskId: 10, memberId: 2, date: '2024-01-01', plannedHours: 7, actualHours: 0 },
      { id: 2, assignmentId: 1, taskId: 10, memberId: 2, date: '2024-01-02', plannedHours: 7, actualHours: 0 },
      { id: 3, assignmentId: 1, taskId: 10, memberId: 2, date: '2024-01-03', plannedHours: 7, actualHours: 0 },
      { id: 4, assignmentId: 1, taskId: 10, memberId: 2, date: '2024-01-04', plannedHours: 7, actualHours: 0 },
      { id: 5, assignmentId: 1, taskId: 10, memberId: 2, date: '2024-01-05', plannedHours: 7, actualHours: 0 }
    ];
    
    // Plan : 35h prévues
    const planTotal = TimeEntryLoader.sumPlannedHoursForMember(entries, 2, '2024-01-01', '2024-01-05');
    expect(planTotal).toBe(35);
    
    // CRA : 7h prévues et 0h réalisée par jour
    const byDate = TimeEntryLoader.groupEntriesByMemberAndDate(entries);
    expect(byDate.get('2:2024-01-01')[0].plannedHours).toBe(7);
    expect(byDate.get('2:2024-01-01')[0].actualHours).toBe(0);
    
    // Même assignmentId, taskId, memberId
    entries.forEach(e => {
      expect(e.assignmentId).toBe(1);
      expect(e.taskId).toBe(10);
      expect(e.memberId).toBe(2);
    });
  });
});

describe('Scénario 2 — Saisie de réalisé', () => {
  test('CRA distingue prévu et réalisé', () => {
    // Données : heuresPrevues = 7, heures = 6
    const entries = [
      { id: 1, assignmentId: 1, taskId: 10, memberId: 2, date: '2024-01-01', plannedHours: 7, actualHours: 6 }
    ];
    
    // Plan : 7h prévues
    const planTotal = TimeEntryLoader.sumPlannedHoursForMember(entries, 2, '2024-01-01', '2024-01-01');
    expect(planTotal).toBe(7);
    
    // CRA : prévu 7h, réalisé 6h
    const entry = entries[0];
    expect(entry.plannedHours).toBe(7);
    expect(entry.actualHours).toBe(6);
  });
});

describe('Scénario 3 — Plusieurs tâches pour un membre', () => {
  test('Plan calcule capacité restante avec multi-tâches', () => {
    // Tâche A : 4h prévues lundi, Tâche B : 3h prévues lundi
    // Capacité lundi : 7h
    const entries = [
      { id: 1, assignmentId: 1, taskId: 10, memberId: 2, date: '2024-01-01', plannedHours: 4, actualHours: 0 },
      { id: 2, assignmentId: 2, taskId: 11, memberId: 2, date: '2024-01-01', plannedHours: 3, actualHours: 0 }
    ];
    
    // Plan membre : 7h prévues
    const total = TimeEntryLoader.sumPlannedHoursForMember(entries, 2, '2024-01-01', '2024-01-01');
    expect(total).toBe(7);
    
    // Capacité restante : 0h
    const capacity = 7;
    const remaining = capacity - total;
    expect(remaining).toBe(0);
    
    // CRA : deux lignes correctement rattachées à leurs affectations
    const byAssignment = TimeEntryLoader.groupEntriesByAssignment(entries);
    expect(byAssignment.get(1).length).toBe(1);
    expect(byAssignment.get(2).length).toBe(1);
    expect(byAssignment.get(1)[0].plannedHours).toBe(4);
    expect(byAssignment.get(2)[0].plannedHours).toBe(3);
  });
});

describe('Scénario 4 — Statut de feuille', () => {
  test('Ligne CRA verrouillée avec statut soumis', () => {
    const raw = {
      id: 1,
      affectation: 1,
      tache: 10,
      membre: 2,
      date: 1704067200,
      heuresPrevues: 7,
      heures: 0,
      feuille: 3
    };
    
    const feuillesById = {
      3: { id: 3, membre: 2, semaine: 1704067200, statut: 'soumis' }
    };
    
    const entry = TimeEntryLoader.normalizeTimeEntry(raw, feuillesById);
    
    // sheetStatus = submitted
    expect(entry.sheetStatus).toBe('submitted');
    
    // Ligne considérée comme verrouillée
    const isLocked = entry.sheetStatus === 'submitted' || entry.sheetStatus === 'validated';
    expect(isLocked).toBe(true);
    
    // Prévu toujours visible
    expect(entry.plannedHours).toBe(7);
  });
});

describe('Scénario 5 — Ligne legacy sans affectation', () => {
  test('TimeEntry sans affectation non rattachée arbitrairement', () => {
    const raw = {
      id: 1,
      affectation: null,
      tache: 10,
      membre: 2,
      date: 1704067200,
      heuresPrevues: 0,
      heures: 5,
      feuille: null
    };
    
    const entry = TimeEntryLoader.normalizeTimeEntry(raw, {});
    
    // La ligne n'est pas silencieusement rattachée à une affectation arbitraire
    expect(entry.assignmentId).toBe(null);
    
    // Un diagnostic legacy explicite est produit
    expect(entry.isLegacy).toBe(true);
  });
});

describe('Helper isEntryLocked', () => {
  test('détecte une entrée verrouillée (soumise)', () => {
    const entry = { sheetStatus: 'submitted' };
    expect(TimeEntryLoader.isEntryLocked(entry)).toBe(true);
  });
  
  test('détecte une entrée verrouillée (validée)', () => {
    const entry = { sheetStatus: 'validated' };
    expect(TimeEntryLoader.isEntryLocked(entry)).toBe(true);
  });
  
  test('détecte une entrée modifiable (brouillon)', () => {
    const entry = { sheetStatus: 'draft' };
    expect(TimeEntryLoader.isEntryLocked(entry)).toBe(false);
  });
  
  test('gère les entrées sans statut', () => {
    const entry = { sheetStatus: null };
    expect(TimeEntryLoader.isEntryLocked(entry)).toBe(false);
  });
  
  test('gère les entrées undefined', () => {
    expect(TimeEntryLoader.isEntryLocked(null)).toBe(false);
    expect(TimeEntryLoader.isEntryLocked(undefined)).toBe(false);
  });
});
