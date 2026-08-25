'use strict';

const RollingLoad = require('./rolling-load.js');

function assignment(overrides = {}) {
  return Object.assign({
    id: 1,
    tache: 10,
    membre: 2,
    heuresAllouees: 30,
    dateDebut: '2026-08-24',
    dateFin: '2027-06-30',
    modeRepartition: 'ponctuel',
    actif: true
  }, overrides);
}

function build(options = {}) {
  return RollingLoad.buildRollingLoadIndex({
    today: options.today || '2026-08-24',
    periods: options.periods || {
      granularity: 'month',
      keys: ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06']
    },
    assignments: options.assignments || [assignment()],
    tasks: [{ id: 10, dateDebut: '2026-08-24', dateEcheance: '2027-06-30' }],
    team: [{ id: 2, capaciteHebdo: 35, actif: true }],
    timeEntries: options.timeEntries || [],
    dailyCapacities: options.dailyCapacities || []
  });
}

describe('RollingLoad - demande glissante non plafonnée', () => {
  test('conserve exactement 30 h sur toute la fenêtre', () => {
    const result = build();
    const total = result.contributions.reduce((sum, item) => sum + item.hours, 0);

    expect(total).toBeCloseTo(30, 10);
    expect(result.assignments[1].totalFutureCapacityHours).toBe(223 * 7);
    expect(result.contributions[0].loadRatio).toBeCloseTo(30 / (223 * 7), 10);
  });

  test('augmente la pression quand la date courante avance', () => {
    const initial = build();
    const later = build({ today: '2027-02-24' });

    expect(later.contributions[0].loadRatio).toBeGreaterThan(initial.contributions[0].loadRatio);
    expect(later.assignments[1].remainingHours).toBe(30);
  });

  test('répartit 30 h sur deux semaines à 15 h par semaine', () => {
    const result = build({
      today: '2027-06-21',
      assignments: [assignment({ dateDebut: '2027-06-21', dateFin: '2027-07-02' })],
      periods: { granularity: 'week', keys: ['2027-W25', '2027-W26'] }
    });

    expect(result.contributions).toHaveLength(2);
    expect(result.contributions[0].hours).toBeCloseTo(15, 10);
    expect(result.contributions[1].hours).toBeCloseTo(15, 10);
    expect(result.contributions[0].loadRatio).toBeCloseTo(30 / 70, 10);
  });

  test('conserve une surcharge supérieure à 100 %', () => {
    const result = build({
      today: '2027-06-21',
      assignments: [assignment({ heuresAllouees: 80, dateDebut: '2027-06-21', dateFin: '2027-06-25' })],
      periods: { granularity: 'week', keys: ['2027-W25'] }
    });

    expect(result.contributions[0].hours).toBeCloseTo(80, 10);
    expect(result.contributions[0].loadRatio).toBeGreaterThan(2);
  });

  test('préserve une allocation minuscule de 0,02 h', () => {
    const result = build({ assignments: [assignment({ heuresAllouees: 0.02 })] });
    const total = result.contributions.reduce((sum, item) => sum + item.hours, 0);

    expect(total).toBeCloseTo(0.02, 12);
    expect(result.contributions.every(item => item.hours > 0)).toBe(true);
  });

  test('déduit immédiatement tout réalisé explicite, même brouillon', () => {
    const result = build({
      timeEntries: [{
        id: 50,
        assignmentId: 1,
        taskId: 10,
        memberId: 2,
        actualHours: 4,
        plannedHours: 0,
        sheetStatus: 'draft'
      }]
    });

    expect(result.assignments[1].actualHours).toBe(4);
    expect(result.assignments[1].remainingHours).toBe(26);
  });

  test('ne bloque pas lorsque le réalisé dépasse l’allocation', () => {
    const result = build({
      timeEntries: [{ assignmentId: 1, taskId: 10, memberId: 2, actualHours: 35, sheetStatus: 'validated' }]
    });

    expect(result.assignments[1].remainingHours).toBe(0);
    expect(result.assignments[1].overconsumedHours).toBe(5);
    expect(result.diagnostics.some(item => item.code === 'OVERCONSUMED_ASSIGNMENT')).toBe(true);
  });

  test('maintient le reste visible après l’échéance', () => {
    const result = build({
      today: '2027-07-05',
      periods: { granularity: 'week', keys: ['2027-W27'] }
    });

    expect(result.contributions[0].hours).toBe(30);
    expect(result.contributions[0].overdue).toBe(true);
    expect(result.diagnostics.some(item => item.code === 'OVERDUE_REMAINING_LOAD')).toBe(true);
  });
});
