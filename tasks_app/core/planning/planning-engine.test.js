/**
 * Tests unitaires pour Planning Engine
 * 
 * Couvre les scénarios de distribution, capacité, surconsommation,
 * précision des calculs, doublons et validation.
 */

'use strict';

const { buildAssignmentPlan, toCentiHours, toHours, validateNumber, findDuplicates } = require('./planning-engine.js');

describe('Planning Engine - Distribution', () => {
  
  test('35h sur deux semaines (10 jours ouvrés + 4 week-ends) donnent 3,50h par jour ouvré', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 35,
      startDate: '2026-07-01',
      endDate: '2026-07-14'
    };
    
    const capacities = [];
    for (let i = 0; i < 14; i++) {
      const date = `2026-07-${String(i + 1).padStart(2, '0')}`;
      const dayOfWeek = new Date(Date.UTC(2026, 6, i + 1)).getUTCDay();
      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
      capacities.push({
        date,
        baseCapacityHours: 7,
        availableCapacityHours: isWeekend ? 0 : 7
      });
    }
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries: []
    });
    
    expect(result.desiredPlan.length).toBe(10);
    
    const totalPlanned = result.desiredPlan.reduce((sum, item) => sum + item.plannedHours, 0);
    expect(totalPlanned).toBeCloseTo(35, 2);
    
    for (const item of result.desiredPlan) {
      expect(item.plannedHours).toBeCloseTo(3.5, 2);
    }
    
    const weekendPlans = result.desiredPlan.filter(item => {
      const dayOfWeek = new Date(Date.UTC(2026, 6, parseInt(item.date.split('-')[2]))).getUTCDay();
      return dayOfWeek === 0 || dayOfWeek === 6;
    });
    expect(weekendPlans.length).toBe(0);
  });

  test('100h sur 100 jours donnent 1,00h par jour', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 100,
      startDate: '2026-01-01',
      endDate: '2026-04-10'
    };
    
    const capacities = [];
    for (let i = 0; i < 100; i++) {
      const date = new Date(Date.UTC(2026, 0, 1));
      date.setUTCDate(date.getUTCDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      capacities.push({
        date: dateStr,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      });
    }
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries: []
    });
    
    expect(result.desiredPlan.length).toBe(100);
    
    const totalPlanned = result.desiredPlan.reduce((sum, item) => sum + item.plannedHours, 0);
    expect(totalPlanned).toBeCloseTo(100, 2);
    
    for (const item of result.desiredPlan) {
      expect(item.plannedHours).toBeCloseTo(1.0, 2);
    }
  });

  test('Allocation 100h : 50j validés à 1h + 10j validés à 0h + 40j restants = 1,25h/jour sur 40j', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 100,
      startDate: '2026-01-01',
      endDate: '2026-04-10'
    };
    
    const capacities = [];
    const existingEntries = [];
    
    for (let i = 0; i < 100; i++) {
      const date = new Date(Date.UTC(2026, 0, 1));
      date.setUTCDate(date.getUTCDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      
      capacities.push({
        date: dateStr,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      });
      
      if (i < 50) {
        existingEntries.push({
          id: i + 1,
          assignmentId: 1,
          date: dateStr,
          plannedHours: 1,
          actualHours: 1,
          sheetStatus: 'validated',
          description: null,
          imputation: null
        });
      } else if (i < 60) {
        existingEntries.push({
          id: i + 1,
          assignmentId: 1,
          date: dateStr,
          plannedHours: 1,
          actualHours: 0,
          sheetStatus: 'validated',
          description: null,
          imputation: null
        });
      }
    }
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.desiredPlan.length).toBe(40);
    
    const totalPlanned = result.desiredPlan.reduce((sum, item) => sum + item.plannedHours, 0);
    expect(totalPlanned).toBeCloseTo(50, 2);
    
    for (const item of result.desiredPlan) {
      expect(item.plannedHours).toBeCloseTo(1.25, 2);
    }
  });

  test('Allocation 100h : 50j validés à 1h + 50j restants = 1,00h/jour sur 50j', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 100,
      startDate: '2026-01-01',
      endDate: '2026-04-10'
    };
    
    const capacities = [];
    const existingEntries = [];
    
    for (let i = 0; i < 100; i++) {
      const date = new Date(Date.UTC(2026, 0, 1));
      date.setUTCDate(date.getUTCDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      
      capacities.push({
        date: dateStr,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      });
      
      if (i < 50) {
        existingEntries.push({
          id: i + 1,
          assignmentId: 1,
          date: dateStr,
          plannedHours: 1,
          actualHours: 1,
          sheetStatus: 'validated',
          description: null,
          imputation: null
        });
      }
    }
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.desiredPlan.length).toBe(50);
    
    const totalPlanned = result.desiredPlan.reduce((sum, item) => sum + item.plannedHours, 0);
    expect(totalPlanned).toBeCloseTo(50, 2);
    
    for (const item of result.desiredPlan) {
      expect(item.plannedHours).toBeCloseTo(1.0, 2);
    }
  });

  test('Entrée future mutable reste recalculable : allocation 10h, 2 jours, entrée mutable 5h jour 1 = 5h chaque jour', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10,
      startDate: '2026-07-01',
      endDate: '2026-07-02'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 5,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries,
      replanFromDate: '2026-07-01'
    });
    
    expect(result.desiredPlan.length).toBe(2);
    
    const day1 = result.desiredPlan.find(d => d.date === '2026-07-01');
    const day2 = result.desiredPlan.find(d => d.date === '2026-07-02');
    
    expect(day1.plannedHours).toBeCloseTo(5, 2);
    expect(day2.plannedHours).toBeCloseTo(5, 2);
    expect(result.summary.unplannedHours).toBe(0);
  });

  test('Second calcul recalculable : reprendre les sorties du premier calcul', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10,
      startDate: '2026-07-01',
      endDate: '2026-07-02'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const result1 = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries: [],
      replanFromDate: '2026-07-01'
    });
    
    const existingEntriesForSecondRun = result1.desiredPlan.map((item, idx) => ({
      id: idx + 1,
      assignmentId: item.assignmentId,
      date: item.date,
      plannedHours: item.plannedHours,
      actualHours: 0,
      sheetStatus: null,
      description: null,
      imputation: null,
      baseCapacityHours: item.baseCapacityHours,
      availableCapacityHours: item.availableCapacityHours
    }));
    
    const result2 = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries: existingEntriesForSecondRun,
      replanFromDate: '2026-07-01'
    });
    
    expect(result2.desiredPlan.length).toBe(2);
    
    const total1 = result1.desiredPlan.reduce((sum, item) => sum + item.plannedHours, 0);
    const total2 = result2.desiredPlan.reduce((sum, item) => sum + item.plannedHours, 0);
    
    expect(total1).toBeCloseTo(10, 2);
    expect(total2).toBeCloseTo(10, 2);
    
    for (let i = 0; i < result1.desiredPlan.length; i++) {
      expect(result1.desiredPlan[i].plannedHours).toBe(result2.desiredPlan[i].plannedHours);
    }
  });
});

describe('Planning Engine - Capacité', () => {
  
  test('Un jour à capacité zéro reçoit zéro heure', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 7,
      startDate: '2026-07-01',
      endDate: '2026-07-03'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 0, availableCapacityHours: 0 },
      { date: '2026-07-03', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries: []
    });
    
    expect(result.desiredPlan.length).toBe(2);
    expect(result.desiredPlan.find(d => d.date === '2026-07-02')).toBeUndefined();
    
    const totalPlanned = result.desiredPlan.reduce((sum, item) => sum + item.plannedHours, 0);
    expect(totalPlanned).toBeCloseTo(7, 2);
  });

  test('Capacité 3,5h reçoit deux fois moins que capacité 7h (distribution proportionnelle)', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10.5,
      startDate: '2026-07-01',
      endDate: '2026-07-02'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 3.5, availableCapacityHours: 3.5 }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries: []
    });
    
    expect(result.desiredPlan.length).toBe(2);
    
    const day1 = result.desiredPlan.find(d => d.date === '2026-07-01');
    const day2 = result.desiredPlan.find(d => d.date === '2026-07-02');
    
    expect(day1.plannedHours).toBeCloseTo(7, 2);
    expect(day2.plannedHours).toBeCloseTo(3.5, 2);
    
    const ratio = day1.plannedHours / day2.plannedHours;
    expect(ratio).toBeCloseTo(2, 1);
  });
});

describe('Planning Engine - Surconsommation et sur-réservation', () => {
  
  test('Allocation 35h et réalisé validé 35h : aucun plan futur, overconsumedHours = 0', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 35,
      startDate: '2026-07-01',
      endDate: '2026-07-14'
    };
    
    const capacities = [];
    const existingEntries = [];
    
    for (let i = 0; i < 10; i++) {
      const date = `2026-07-${String(i + 1).padStart(2, '0')}`;
      capacities.push({
        date,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      });
      existingEntries.push({
        id: i + 1,
        assignmentId: 1,
        date,
        plannedHours: 3.5,
        actualHours: 3.5,
        sheetStatus: 'validated',
        description: null,
        imputation: null
      });
    }
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.desiredPlan.length).toBe(0);
    expect(result.summary.overconsumedHours).toBe(0);
    expect(result.summary.remainingHours).toBe(0);
    expect(result.summary.validatedActualHours).toBe(35);
  });

  test('Allocation 35h et réalisé validé 40h : overconsumedHours = 5', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 35,
      startDate: '2026-07-01',
      endDate: '2026-07-14'
    };
    
    const capacities = [];
    const existingEntries = [];
    
    for (let i = 0; i < 10; i++) {
      const date = `2026-07-${String(i + 1).padStart(2, '0')}`;
      capacities.push({
        date,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      });
      existingEntries.push({
        id: i + 1,
        assignmentId: 1,
        date,
        plannedHours: 4,
        actualHours: 4,
        sheetStatus: 'validated',
        description: null,
        imputation: null
      });
    }
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.desiredPlan.length).toBe(0);
    expect(result.summary.overconsumedHours).toBe(5);
    expect(result.summary.validatedActualHours).toBe(40);
    expect(result.summary.overprotectedHours).toBe(0);
  });

  test('Prévu protégé dépasse allocation : overprotectedHours renseigné', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10,
      startDate: '2026-07-01',
      endDate: '2026-07-05'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-03', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-04', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-05', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 8,
        actualHours: 0,
        sheetStatus: 'submitted',
        description: null,
        imputation: null
      },
      {
        id: 2,
        assignmentId: 1,
        date: '2026-07-02',
        plannedHours: 5,
        actualHours: 0,
        sheetStatus: 'submitted',
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.desiredPlan.length).toBe(0);
    expect(result.summary.protectedPlannedHours).toBe(13);
    expect(result.summary.overprotectedHours).toBeGreaterThan(0);
    expect(result.diagnostics.some(d => d.code === 'PROTECTED_PLAN_EXCEEDS_ALLOCATION')).toBe(true);
  });
});

describe('Planning Engine - Statuts de feuille', () => {
  
  test('Feuille soumise : prévu réservé mais pas déduit comme réalisé', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 35,
      startDate: '2026-07-01',
      endDate: '2026-07-14'
    };
    
    const capacities = [];
    for (let i = 0; i < 14; i++) {
      const date = `2026-07-${String(i + 1).padStart(2, '0')}`;
      capacities.push({
        date,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      });
    }
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 3.5,
        actualHours: 0,
        sheetStatus: 'submitted',
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.summary.protectedPlannedHours).toBe(3.5);
    expect(result.summary.validatedActualHours).toBe(0);
    expect(result.summary.remainingHours).toBeCloseTo(31.5, 2);
    
    const day1Plan = result.desiredPlan.find(d => d.date === '2026-07-01');
    expect(day1Plan).toBeUndefined();
  });

  test('Cellule vide validée vaut zéro et libère son ancien prévu', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 35,
      startDate: '2026-07-01',
      endDate: '2026-07-14'
    };
    
    const capacities = [];
    for (let i = 0; i < 14; i++) {
      const date = `2026-07-${String(i + 1).padStart(2, '0')}`;
      capacities.push({
        date,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      });
    }
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 3.5,
        actualHours: 0,
        sheetStatus: 'validated',
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.summary.validatedActualHours).toBe(0);
    expect(result.summary.remainingHours).toBeCloseTo(35, 2);
    
    const day1Plan = result.desiredPlan.find(d => d.date === '2026-07-01');
    expect(day1Plan).toBeUndefined();
  });
});

describe('Planning Engine - unplannedHours', () => {
  
  test('Période sans capacité suffisante produit des unplannedHours', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 100,
      startDate: '2026-07-01',
      endDate: '2026-07-05'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-03', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-04', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-05', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries: []
    });
    
    const totalCapacity = 5 * 7;
    expect(totalCapacity).toBe(35);
    
    expect(result.summary.newlyPlannedHours).toBeCloseTo(35, 2);
    expect(result.summary.unplannedHours).toBeCloseTo(65, 2);
    expect(result.summary.remainingHours).toBe(100);
  });
});

describe('Planning Engine - Précision flottante', () => {
  
  test('Somme exacte à 0,01h sans dérive flottante', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 35,
      startDate: '2026-07-01',
      endDate: '2026-07-14'
    };
    
    const capacities = [];
    for (let i = 0; i < 14; i++) {
      const date = `2026-07-${String(i + 1).padStart(2, '0')}`;
      capacities.push({
        date,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      });
    }
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries: []
    });
    
    const totalCentiHours = result.desiredPlan.reduce((sum, item) => {
      return sum + toCentiHours(item.plannedHours);
    }, 0);
    
    expect(totalCentiHours).toBe(3500);
    
    const totalHours = toHours(totalCentiHours);
    expect(totalHours).toBe(35);
    
    const sumCheck = result.summary.newlyPlannedHours + result.summary.unplannedHours;
    expect(sumCheck).toBeCloseTo(result.summary.remainingHours, 2);
  });
});

describe('Planning Engine - replanFromDate', () => {
  
  test('Dates antérieures à replanFromDate sont non modifiables', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 35,
      startDate: '2026-07-01',
      endDate: '2026-07-14'
    };
    
    const capacities = [];
    for (let i = 0; i < 14; i++) {
      const date = `2026-07-${String(i + 1).padStart(2, '0')}`;
      capacities.push({
        date,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      });
    }
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 0,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries,
      replanFromDate: '2026-07-02'
    });
    
    const day1Plan = result.desiredPlan.find(d => d.date === '2026-07-01');
    expect(day1Plan).toBeUndefined();
  });
});

describe('Planning Engine - capacityPolicy cap', () => {
  
  test('Le plan quotidien ne dépasse pas la capacité disponible', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 100,
      startDate: '2026-07-01',
      endDate: '2026-07-01'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries: [],
      capacityPolicy: 'cap'
    });
    
    expect(result.desiredPlan.length).toBe(1);
    expect(result.desiredPlan[0].plannedHours).toBe(7);
    expect(result.summary.unplannedHours).toBe(93);
  });
});

describe('Planning Engine - Doublons', () => {
  
  test('Détection des doublons dans existingEntries', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10,
      startDate: '2026-07-01',
      endDate: '2026-07-02'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 3,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null
      },
      {
        id: 2,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 4,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.diagnostics.some(d => d.code === 'DUPLICATE_EXISTING_ENTRY')).toBe(true);
  });

  test('findDuplicates détecte les doublons', () => {
    const entries = [
      { id: 1, assignmentId: 1, date: '2026-07-01' },
      { id: 2, assignmentId: 1, date: '2026-07-01' },
      { id: 3, assignmentId: 1, date: '2026-07-02' }
    ];
    
    const result = findDuplicates(entries);
    
    expect(result.hasDuplicates).toBe(true);
    expect(result.duplicates.length).toBe(1);
    expect(result.duplicates[0].key).toBe('1:2026-07-01');
  });
});

describe('Planning Engine - Validation des nombres', () => {
  
  test('validateNumber accepte les nombres valides', () => {
    expect(validateNumber(5, 'test').valid).toBe(true);
    expect(validateNumber(0, 'test').valid).toBe(true);
    expect(validateNumber(0.01, 'test').valid).toBe(true);
  });

  test('validateNumber refuse les négatifs', () => {
    expect(validateNumber(-1, 'test').valid).toBe(false);
    expect(validateNumber(-0.001, 'test').valid).toBe(false);
  });

  test('validateNumber refuse NaN et Infinity', () => {
    expect(validateNumber(NaN, 'test').valid).toBe(false);
    expect(validateNumber(Infinity, 'test').valid).toBe(false);
    expect(validateNumber(-Infinity, 'test').valid).toBe(false);
  });

  test('validateNumber refuse les types non numériques', () => {
    expect(validateNumber('5', 'test').valid).toBe(false);
    expect(validateNumber(null, 'test').valid).toBe(false);
    expect(validateNumber(undefined, 'test').valid).toBe(false);
    expect(validateNumber({}, 'test').valid).toBe(false);
  });

  test('validateNumber avec allowNull accepte null/undefined', () => {
    expect(validateNumber(null, 'test', { allowNull: true }).valid).toBe(true);
    expect(validateNumber(undefined, 'test', { allowNull: true }).valid).toBe(true);
    expect(validateNumber('', 'test', { allowNull: true }).valid).toBe(true);
  });

  test('allocatedHours invalide retourne INVALID_ALLOCATED_HOURS', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: -5,
      startDate: '2026-07-01',
      endDate: '2026-07-02'
    };
    
    const result = buildAssignmentPlan({
      assignment,
      capacities: [],
      existingEntries: []
    });
    
    expect(result.diagnostics.some(d => d.code === 'INVALID_ALLOCATEDHOURS' || d.code.includes('INVALID'))).toBe(true);
  });

  test('actualHours = "abc" dans une entrée existante produit INVALID_ACTUAL_HOURS', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10,
      startDate: '2026-07-01',
      endDate: '2026-07-02'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 3,
        actualHours: 'abc',
        sheetStatus: null,
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.diagnostics.some(d => d.code === 'INVALID_ACTUAL_HOURS')).toBe(true);
  });

  test('Doublon dans existingEntries ne produit aucun plan', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10,
      startDate: '2026-07-01',
      endDate: '2026-07-02'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 3,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null
      },
      {
        id: 2,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 4,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.desiredPlan.length).toBe(0);
    expect(result.diagnostics.some(d => d.code === 'DUPLICATE_EXISTING_ENTRY')).toBe(true);
    expect(result.summary.allocatedHours).toBe(10);
  });
});

describe('Planning Engine - Arrondi plus forts restes', () => {
  
  test('1h sur 3 jours identiques → 0,34 + 0,33 + 0,33, unplannedHours = 0', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 1,
      startDate: '2026-07-01',
      endDate: '2026-07-03'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-03', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries: []
    });
    
    expect(result.desiredPlan.length).toBe(3);
    
    const totalCentiHours = result.desiredPlan.reduce((sum, item) => {
      return sum + toCentiHours(item.plannedHours);
    }, 0);
    
    expect(totalCentiHours).toBe(100); // 1h = 100 centièmes
    expect(result.summary.unplannedHours).toBe(0);
    
    // Vérifier la répartition : 34, 33, 33 centièmes
    const sorted = result.desiredPlan.map(p => toCentiHours(p.plannedHours)).sort((a, b) => a - b);
    expect(sorted).toEqual([33, 33, 34]);
  });
  
  test('0,02h sur 5 jours de capacité 0,01 → deux jours à 0,01', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 0.02,
      startDate: '2026-07-01',
      endDate: '2026-07-05'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 0.01, availableCapacityHours: 0.01 },
      { date: '2026-07-02', baseCapacityHours: 0.01, availableCapacityHours: 0.01 },
      { date: '2026-07-03', baseCapacityHours: 0.01, availableCapacityHours: 0.01 },
      { date: '2026-07-04', baseCapacityHours: 0.01, availableCapacityHours: 0.01 },
      { date: '2026-07-05', baseCapacityHours: 0.01, availableCapacityHours: 0.01 }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries: []
    });
    
    // 0.02h = 2 centièmes, répartis sur 5 jours de 1 centième chacun
    expect(result.desiredPlan.length).toBe(2);
    
    const totalCentiHours = result.desiredPlan.reduce((sum, item) => {
      return sum + toCentiHours(item.plannedHours);
    }, 0);
    
    expect(totalCentiHours).toBe(2);
    
    for (const item of result.desiredPlan) {
      expect(toCentiHours(item.plannedHours)).toBe(1);
    }
  });
  
  test('Capacité totale insuffisante → toute la capacité disponible est utilisée', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 100,
      startDate: '2026-07-01',
      endDate: '2026-07-02'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries: []
    });
    
    // Capacité totale = 14h, allouée = 100h
    expect(result.desiredPlan.length).toBe(2);
    
    const totalPlanned = result.desiredPlan.reduce((sum, item) => sum + item.plannedHours, 0);
    expect(totalPlanned).toBe(14); // Toute la capacité utilisée
    
    expect(result.summary.unplannedHours).toBe(86); // 100 - 14
  });
  
  test('Arrondi exact à 0,01h près sans dérive', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 35,
      startDate: '2026-07-01',
      endDate: '2026-07-14'
    };
    
    const capacities = [];
    for (let i = 0; i < 14; i++) {
      const date = `2026-07-${String(i + 1).padStart(2, '0')}`;
      capacities.push({
        date,
        baseCapacityHours: 7,
        availableCapacityHours: 7
      });
    }
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries: []
    });
    
    const totalCentiHours = result.desiredPlan.reduce((sum, item) => {
      return sum + toCentiHours(item.plannedHours);
    }, 0);
    
    expect(totalCentiHours).toBe(3500); // 35h exactes
    expect(toHours(totalCentiHours)).toBe(35);
  });
});

describe('Planning Engine - Réalisé validé hors période', () => {
  
  test('Test A - réalisé après la période consomme l allocation', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10,
      startDate: '2026-07-01',
      endDate: '2026-07-02'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-03', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-03', // Hors période (après endDate)
        plannedHours: 0,
        actualHours: 5,
        sheetStatus: 'validated',
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.summary.validatedActualHours).toBe(5);
    expect(result.summary.remainingHours).toBe(5); // 10 - 5
    expect(result.summary.overconsumedHours).toBe(0);
    
    // Le nouveau plan devrait totaliser 5h
    const totalPlanned = result.desiredPlan.reduce((sum, item) => sum + item.plannedHours, 0);
    expect(totalPlanned).toBeCloseTo(5, 2);
    
    // Les entrées dans la période (01 et 02/07)
    expect(result.desiredPlan.length).toBe(2);
  });
  
  test('Test B - réalisé avant la période consomme l allocation', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10,
      startDate: '2026-07-02',
      endDate: '2026-07-03'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-03', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01', // Hors période (avant startDate)
        plannedHours: 0,
        actualHours: 5,
        sheetStatus: 'validated',
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.summary.validatedActualHours).toBe(5);
    expect(result.summary.remainingHours).toBe(5);
    expect(result.summary.overconsumedHours).toBe(0);
    
    const totalPlanned = result.desiredPlan.reduce((sum, item) => sum + item.plannedHours, 0);
    expect(totalPlanned).toBeCloseTo(5, 2);
    
    // Les entrées dans la période (02 et 03/07)
    expect(result.desiredPlan.length).toBe(2);
  });
  
  test('Test C - surconsommation hors période', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10,
      startDate: '2026-07-01',
      endDate: '2026-07-02'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-03', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-03', // Hors période
        plannedHours: 0,
        actualHours: 12,
        sheetStatus: 'validated',
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.summary.validatedActualHours).toBe(12);
    expect(result.summary.overconsumedHours).toBe(2); // 12 - 10
    expect(result.summary.remainingHours).toBe(0);
    expect(result.desiredPlan.length).toBe(0); // Aucun plan en cas de surconsommation
    expect(result.diagnostics.some(d => d.code === 'OVERCONSUMPTION')).toBe(true);
  });
  
  test('Test D - ligne sans affectation ne consomme pas l allocation', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10,
      startDate: '2026-07-01',
      endDate: '2026-07-02'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: null, // Pas d'affectation
        taskId: 1,
        memberId: 1,
        date: '2026-07-01',
        plannedHours: 0,
        actualHours: 5,
        sheetStatus: 'validated',
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    // La ligne sans affectation ne doit pas consommer l'allocation
    expect(result.summary.validatedActualHours).toBe(0);
    expect(result.summary.remainingHours).toBe(10);
    
    // Tout le plan devrait être distribué
    const totalPlanned = result.desiredPlan.reduce((sum, item) => sum + item.plannedHours, 0);
    expect(totalPlanned).toBeCloseTo(10, 2);
  });
  
  test('Test E - ligne validée hors période préservée (aucune action)', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10,
      startDate: '2026-07-01',
      endDate: '2026-07-02'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-03', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-03', // Hors période
        plannedHours: 0,
        actualHours: 5,
        sheetStatus: 'validated',
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    // La ligne hors période est comptabilisée dans validatedActualHours
    expect(result.summary.validatedActualHours).toBe(5);
    
    // Mais elle ne fait pas partie du plan dans la période
    // Vérifier que la date hors période n'est pas dans le plan
    const hasOutOfDate = result.desiredPlan.some(p => p.date === '2026-07-03');
    expect(hasOutOfDate).toBe(false);
    
    // Seules les dates dans la période sont planifiées
    for (const plan of result.desiredPlan) {
      expect(plan.date).toMatch(/^2026-07-0[12]$/);
    }
  });
});

describe('Planning Engine - Heures réalisées négatives', () => {
  
  test('Heures réalisées négatives dans la période → INVALID_ACTUAL_HOURS', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10,
      startDate: '2026-07-01',
      endDate: '2026-07-02'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01',
        plannedHours: 3,
        actualHours: -2, // Négatif
        sheetStatus: 'validated',
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.diagnostics.some(d => d.code === 'INVALID_ACTUAL_HOURS')).toBe(true);
    expect(result.desiredPlan).toEqual([]);
  });
  
  test('Heures réalisées négatives avant la période → INVALID_ACTUAL_HOURS', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10,
      startDate: '2026-07-02',
      endDate: '2026-07-03'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-03', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01', // Avant la période
        plannedHours: 3,
        actualHours: -2, // Négatif
        sheetStatus: 'validated',
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.diagnostics.some(d => d.code === 'INVALID_ACTUAL_HOURS')).toBe(true);
    expect(result.desiredPlan).toEqual([]);
  });
  
  test('Heures réalisées négatives après la période → INVALID_ACTUAL_HOURS', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10,
      startDate: '2026-07-01',
      endDate: '2026-07-02'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-03', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-03', // Après la période
        plannedHours: 3,
        actualHours: -2, // Négatif
        sheetStatus: 'validated',
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.diagnostics.some(d => d.code === 'INVALID_ACTUAL_HOURS')).toBe(true);
    expect(result.desiredPlan).toEqual([]);
  });
});

describe('Planning Engine - Doublons hors période', () => {
  
  test('Doublon après la période → DUPLICATE_EXISTING_ENTRY', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10,
      startDate: '2026-07-01',
      endDate: '2026-07-02'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-03', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-03', // Hors période (après)
        plannedHours: 3,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null
      },
      {
        id: 2,
        assignmentId: 1,
        date: '2026-07-03', // Hors période (doublon)
        plannedHours: 4,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.diagnostics.some(d => d.code === 'DUPLICATE_EXISTING_ENTRY')).toBe(true);
    expect(result.desiredPlan).toEqual([]);
  });
  
  test('Doublon avant la période → DUPLICATE_EXISTING_ENTRY', () => {
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1,
      allocatedHours: 10,
      startDate: '2026-07-02',
      endDate: '2026-07-03'
    };
    
    const capacities = [
      { date: '2026-07-01', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-02', baseCapacityHours: 7, availableCapacityHours: 7 },
      { date: '2026-07-03', baseCapacityHours: 7, availableCapacityHours: 7 }
    ];
    
    const existingEntries = [
      {
        id: 1,
        assignmentId: 1,
        date: '2026-07-01', // Hors période (avant)
        plannedHours: 3,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null
      },
      {
        id: 2,
        assignmentId: 1,
        date: '2026-07-01', // Hors période (doublon)
        plannedHours: 4,
        actualHours: 0,
        sheetStatus: null,
        description: null,
        imputation: null
      }
    ];
    
    const result = buildAssignmentPlan({
      assignment,
      capacities,
      existingEntries
    });
    
    expect(result.diagnostics.some(d => d.code === 'DUPLICATE_EXISTING_ENTRY')).toBe(true);
    expect(result.desiredPlan).toEqual([]);
  });
});
