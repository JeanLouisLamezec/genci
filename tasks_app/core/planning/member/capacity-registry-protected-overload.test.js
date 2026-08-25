'use strict';

const {
  createCapacityRegistry,
  materializedAssignmentsOnly
} = require('./member-planning-orchestrator.js');

describe('MemberPlanningOrchestrator - affectations virtuelles', () => {
  test('exclut les affectations ponctuelles de la planification matérielle', () => {
    const assignments = materializedAssignmentsOnly([
      { id: 1, modeRepartition: 'ponctuel' },
      { id: 2, modeRepartition: 'uniforme' },
      { id: 3 }
    ]);

    expect(assignments.map(assignment => assignment.id)).toEqual([2, 3]);
  });
});

describe('CapacityRegistry - surcharge protégée', () => {
  test('une feuille historique de 10 h sur 7 h ne bloque pas sans nouveau prévu', () => {
    const capacity = createCapacityRegistry({
      memberId: 1,
      dateFrom: '2026-07-20',
      dateTo: '2026-07-20',
      capacities: [{
        membre: 1,
        date: '2026-07-20',
        capaciteTheorique: 7,
        capaciteDisponible: 7
      }],
      protectedHoursByDate: { '2026-07-20': 10 }
    });

    expect(capacity.verifyPostcondition()).toEqual({ valid: true, violations: [] });
  });

  test('un nouveau prévu qui aggrave la surcharge reste détecté', () => {
    const capacity = createCapacityRegistry({
      memberId: 1,
      dateFrom: '2026-07-20',
      dateTo: '2026-07-20',
      capacities: [{
        membre: 1,
        date: '2026-07-20',
        capaciteTheorique: 7,
        capaciteDisponible: 7
      }],
      protectedHoursByDate: { '2026-07-20': 10 }
    });
    capacity.registry['2026-07-20'].plannedHours = 2;

    const result = capacity.verifyPostcondition();
    expect(result.valid).toBe(false);
    expect(result.violations[0].protectedExcess).toBe(3);
    expect(result.violations[0].excess).toBe(2);
  });
});
