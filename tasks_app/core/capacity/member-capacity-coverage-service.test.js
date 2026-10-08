'use strict';

const { createMockGrist } = require('../grist/mock-grist.js');
const {
  mergeCoverageIntervals,
  findMissingCoverageIntervals,
  planMemberCapacityCoverage,
  ensureMemberCapacityCoverage
} = require('./member-capacity-coverage-service.js');

describe('Member Capacity Coverage Service', () => {
  test('fusionne les intervalles qui se touchent', () => {
    expect(mergeCoverageIntervals([
      { start: '2026-07-06', end: '2026-07-08' },
      { start: '2026-07-09', end: '2026-07-10' },
      { start: '2026-07-20', end: '2026-07-21' }
    ])).toEqual([
      { start: '2026-07-06', end: '2026-07-10' },
      { start: '2026-07-20', end: '2026-07-21' }
    ]);
  });

  test('calcule seulement la partie non couverte', () => {
    expect(findMissingCoverageIntervals([
      { start: '2026-07-06', end: '2026-07-08' }
    ], { start: '2026-07-07', end: '2026-07-12' })).toEqual([
      { start: '2026-07-09', end: '2026-07-12' }
    ]);
  });

  test('matérialise uniquement les jours ouvrés et étend la couverture', () => {
    const plan = planMemberCapacityCoverage([{
      id: 1,
      membre: 4,
      dateDebut: '2026-07-06',
      dateFin: '2026-07-08'
    }], 4, '2026-07-07', '2026-07-12', { nowUnixSeconds: 100 });

    expect(plan.success).toBe(true);
    expect(plan.missingIntervals).toEqual([{ start: '2026-07-09', end: '2026-07-12' }]);
    expect(plan.capacityRecords).toEqual([
      { membre: 4, date: 1783555200 },
      { membre: 4, date: 1783641600 }
    ]);
    expect(plan.coverageActions).toEqual([['UpdateRecord', 'MemberCapacityCoverage', 1, {
      dateDebut: 1783296000,
      dateFin: 1783814400,
      updatedAt: 100
    }]]);
  });

  test('fusionne un trou de couverture sans écrire les jours déjà couverts', () => {
    const plan = planMemberCapacityCoverage([
      { id: 5, membre: 4, dateDebut: '2026-07-06', dateFin: '2026-07-07' },
      { id: 6, membre: 4, dateDebut: '2026-07-09', dateFin: '2026-07-10' }
    ], 4, '2026-07-06', '2026-07-10', { nowUnixSeconds: 100 });

    expect(plan.capacityRecords).toEqual([{ membre: 4, date: 1783468800 }]);
    expect(plan.coverageActions).toEqual([
      ['UpdateRecord', 'MemberCapacityCoverage', 5, {
        dateDebut: 1783296000,
        dateFin: 1783641600,
        updatedAt: 100
      }],
      ['RemoveRecord', 'MemberCapacityCoverage', 6]
    ]);
  });

  test('applique une couverture une seule fois puis devient une opération vide', async () => {
    const mockGrist = createMockGrist({
      initialData: {
        MemberCapacityCoverage: [],
        MemberDailyCapacities: []
      }
    });

    const first = await ensureMemberCapacityCoverage(mockGrist, 4, '2026-07-06', '2026-07-12', {
      nowUnixSeconds: 100
    });
    expect(first.success).toBe(true);
    expect(first.capacityRecords).toHaveLength(5);
    expect((await mockGrist.fetchTable('MemberDailyCapacities')).id).toHaveLength(5);
    expect((await mockGrist.fetchTable('MemberCapacityCoverage')).id).toHaveLength(1);

    const second = await ensureMemberCapacityCoverage(mockGrist, 4, '2026-07-06', '2026-07-12', {
      nowUnixSeconds: 101
    });
    expect(second.success).toBe(true);
    expect(second.actionsExecuted).toBe(0);
    expect((await mockGrist.fetchTable('MemberDailyCapacities')).id).toHaveLength(5);
  });
});
