/* ============================================================================
 * time-entry-planning-service.test.js — Tests du service de planification
 * ============================================================================ */

const { 
  validateAssignment, 
  distributeHoursUniformly, 
  planAssignment,
  DISTRIBUTION_MODES
} = require('./time-entry-planning-service');

describe('Time Entry Planning Service - Validation', () => {
  const validAssignment = {
    id: 1,
    tache: 1,
    membre: 1,
    heuresAllouees: 35,
    dateDebut: 1783296000, // 01/09/2026
    dateFin: 1784505600,   // 12/09/2026
    modeRepartition: 'uniforme',
    actif: true
  };

  const context = {
    members: [{ id: 1, nom: 'Alice' }],
    tasks: [{ id: 1, titre: 'Test Task' }]
  };

  test('affectation valide', () => {
    const result = validateAssignment(validAssignment, context);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('affectation inactive', () => {
    const assignment = { ...validAssignment, actif: false };
    const result = validateAssignment(assignment, context);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'INACTIVE_ASSIGNMENT'
    }));
  });

  test('heures nulles', () => {
    const assignment = { ...validAssignment, heuresAllouees: 0 };
    const result = validateAssignment(assignment, context);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'ZERO_HOURS'
    }));
  });

  test('heures négatives', () => {
    const assignment = { ...validAssignment, heuresAllouees: -5 };
    const result = validateAssignment(assignment, context);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'INVALID_HOURS'
    }));
  });

  test('dates manquantes', () => {
    const assignment = { ...validAssignment, dateDebut: null };
    const result = validateAssignment(assignment, context);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'MISSING_DATES'
    }));
  });

  test('dateFin < dateDebut', () => {
    const assignment = { 
      ...validAssignment, 
      dateDebut: 1784505600,
      dateFin: 1783296000
    };
    const result = validateAssignment(assignment, context);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'INVALID_DATE_RANGE'
    }));
  });

  test('membre inexistant', () => {
    const assignment = { ...validAssignment, membre: 999 };
    const result = validateAssignment(assignment, context);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'MEMBER_NOT_FOUND'
    }));
  });

  test('tâche inexistante', () => {
    const assignment = { ...validAssignment, tache: 999 };
    const result = validateAssignment(assignment, context);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'TASK_NOT_FOUND'
    }));
  });

  test('mode personnalise (warning)', () => {
    const assignment = { ...validAssignment, modeRepartition: 'personnalise' };
    const result = validateAssignment(assignment, context);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'PERSONNALISE_MODE_NOT_IMPLEMENTED'
    }));
  });

  test('mode inconnu (warning)', () => {
    const assignment = { ...validAssignment, modeRepartition: 'inconnu' };
    const result = validateAssignment(assignment, context);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'UNKNOWN_DISTRIBUTION_MODE'
    }));
  });
});

describe('Time Entry Planning Service - Répartition uniforme', () => {
  test('35h sur 5 jours → 7h par jour', () => {
    const eligibleDays = [
      { date: '2026-09-01', capaciteDisponible: 7, capaciteTheorique: 7 },
      { date: '2026-09-02', capaciteDisponible: 7, capaciteTheorique: 7 },
      { date: '2026-09-03', capaciteDisponible: 7, capaciteTheorique: 7 },
      { date: '2026-09-04', capaciteDisponible: 7, capaciteTheorique: 7 },
      { date: '2026-09-05', capaciteDisponible: 7, capaciteTheorique: 7 }
    ];

    const result = distributeHoursUniformly(35, eligibleDays);

    expect(result.unallocatedHours).toBe(0);
    expect(Object.keys(result.planned).length).toBe(5);
    expect(result.planned['2026-09-01']).toBe(7);
    expect(result.planned['2026-09-02']).toBe(7);
    expect(result.planned['2026-09-03']).toBe(7);
    expect(result.planned['2026-09-04']).toBe(7);
    expect(result.planned['2026-09-05']).toBe(7);
  });

  test('10h sur 3 jours → 3,33 / 3,33 / 3,34', () => {
    const eligibleDays = [
      { date: '2026-09-01', capaciteDisponible: 7, capaciteTheorique: 7 },
      { date: '2026-09-02', capaciteDisponible: 7, capaciteTheorique: 7 },
      { date: '2026-09-03', capaciteDisponible: 7, capaciteTheorique: 7 }
    ];

    const result = distributeHoursUniformly(10, eligibleDays);

    expect(result.unallocatedHours).toBe(0);
    const total = Object.values(result.planned).reduce((sum, h) => sum + h, 0);
    expect(total).toBe(10);
    expect(result.planned['2026-09-01']).toBe(3.33);
    expect(result.planned['2026-09-02']).toBe(3.33);
    expect(result.planned['2026-09-03']).toBe(3.34);
  });

  test('capacité insuffisante', () => {
    const eligibleDays = [
      { date: '2026-09-01', capaciteDisponible: 7, capaciteTheorique: 7 },
      { date: '2026-09-02', capaciteDisponible: 7, capaciteTheorique: 7 }
    ];

    const result = distributeHoursUniformly(20, eligibleDays);

    expect(result.unallocatedHours).toBe(6); // 20 - 14 = 6
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'INSUFFICIENT_CAPACITY'
    }));
  });

  test('planification avec planning existant', () => {
    const eligibleDays = [
      { date: '2026-09-01', capaciteDisponible: 7, capaciteTheorique: 7 },
      { date: '2026-09-02', capaciteDisponible: 7, capaciteTheorique: 7 }
    ];

    const existingPlan = {
      '2026-09-01': 4 // Déjà 4h planifiées
    };

    const result = distributeHoursUniformly(10, eligibleDays, existingPlan);

    // Il reste 3h de capacité le 01/09 et 7h le 02/09 = 10h total
    expect(result.unallocatedHours).toBe(0);
    expect(result.planned['2026-09-01']).toBe(3); // 7 - 4 = 3
    expect(result.planned['2026-09-02']).toBe(7);
  });

  test('week-end exclu (capacité 0)', () => {
    const eligibleDays = [
      { date: '2026-09-05', capaciteDisponible: 0, capaciteTheorique: 0 }, // Samedi
      { date: '2026-09-06', capaciteDisponible: 0, capaciteTheorique: 0 }  // Dimanche
    ];

    const result = distributeHoursUniformly(10, eligibleDays);

    expect(result.unallocatedHours).toBe(10);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'NO_CAPACITY_AVAILABLE'
    }));
  });

  test('ordre déterministe', () => {
    const eligibleDays = [
      { date: '2026-09-03', capaciteDisponible: 7, capaciteTheorique: 7 },
      { date: '2026-09-01', capaciteDisponible: 7, capaciteTheorique: 7 },
      { date: '2026-09-02', capaciteDisponible: 7, capaciteTheorique: 7 }
    ];

    const result = distributeHoursUniformly(21, eligibleDays);

    expect(result.planned['2026-09-01']).toBe(7);
    expect(result.planned['2026-09-02']).toBe(7);
    expect(result.planned['2026-09-03']).toBe(7);
  });
});

describe('Time Entry Planning Service - planAssignment', () => {
  const assignment = {
    id: 1,
    tache: 1,
    membre: 1,
    heuresAllouees: 35,
    dateDebut: 1788220800, // 01/09/2026 (mardi)
    dateFin: 1788566400,   // 05/09/2026 (samedi)
    modeRepartition: 'uniforme',
    actif: true
  };

  const context = {
    members: [{ id: 1, nom: 'Alice' }],
    tasks: [{ id: 1, titre: 'Test Task' }],
    capacities: [
      { membre: 1, date: '2026-09-01', capaciteDisponible: 7, capaciteTheorique: 7, id: 1 },
      { membre: 1, date: '2026-09-02', capaciteDisponible: 7, capaciteTheorique: 7, id: 2 },
      { membre: 1, date: '2026-09-03', capaciteDisponible: 7, capaciteTheorique: 7, id: 3 },
      { membre: 1, date: '2026-09-04', capaciteDisponible: 7, capaciteTheorique: 7, id: 4 },
      { membre: 1, date: '2026-09-05', capaciteDisponible: 0, capaciteTheorique: 0, id: 5 }
    ],
    existingEntries: []
  };

  test('planification simple 35h sur 5 jours', () => {
    const result = planAssignment(assignment, context);

    // 4 jours ouvrés (mardi à vendredi)
    expect(result.plannedEntries.length).toBe(4);
    expect(result.unallocatedHours).toBe(7); // 7h non allouées (samedi = 0h)
    
    const total = result.plannedEntries.reduce((sum, e) => sum + e.heuresPrevues, 0);
    expect(total).toBe(28); // 35 - 7 (samedi) = 28h planifiées
  });

  test('affectation invalide', () => {
    const invalidAssignment = { ...assignment, actif: false };
    const result = planAssignment(invalidAssignment, context);

    expect(result.plannedEntries.length).toBe(0);
    expect(result.errors).toBeDefined();
  });

  test('affectation avec heures zéro', () => {
    const zeroAssignment = { ...assignment, heuresAllouees: 0 };
    const result = planAssignment(zeroAssignment, context);

    expect(result.plannedEntries.length).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'ZERO_HOURS'
    }));
  });
});

describe('Time Entry Planning Service - Conservation exacte', () => {
  test('10h sur 3 jours = exactement 10h', () => {
    const eligibleDays = [
      { date: '2026-09-01', capaciteDisponible: 7, capaciteTheorique: 7 },
      { date: '2026-09-02', capaciteDisponible: 7, capaciteTheorique: 7 },
      { date: '2026-09-03', capaciteDisponible: 7, capaciteTheorique: 7 }
    ];

    const result = distributeHoursUniformly(10, eligibleDays);
    const total = Object.values(result.planned).reduce((sum, h) => sum + h, 0);

    expect(Math.round(total * 100) / 100).toBe(10);
  });

  test('7h sur 3 jours = exactement 7h', () => {
    const eligibleDays = [
      { date: '2026-09-01', capaciteDisponible: 7, capaciteTheorique: 7 },
      { date: '2026-09-02', capaciteDisponible: 7, capaciteTheorique: 7 },
      { date: '2026-09-03', capaciteDisponible: 7, capaciteTheorique: 7 }
    ];

    const result = distributeHoursUniformly(7, eligibleDays);
    const total = Object.values(result.planned).reduce((sum, h) => sum + h, 0);

    expect(Math.round(total * 100) / 100).toBe(7);
  });
});
