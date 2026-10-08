'use strict';

const { createMockGrist } = require('../grist/mock-grist.js');
const {
  planLegacyUnavailabilityMigration,
  migrateLegacyUnavailabilities
} = require('./legacy-unavailability-migration-service.js');

describe('Legacy Unavailability Migration Service', () => {
  test('prévisualise puis remplace intégralement une ancienne plage', () => {
    const plan = planLegacyUnavailabilityMigration([{
      id: 10,
      membre: 4,
      type: 'conge',
      dateDebut: '2026-09-21',
      dateFin: '2026-09-23',
      dispo: 0,
      commentaire: 'Congés annuels'
    }], {
      horizonStart: '2026-09-01',
      horizonEnd: '2026-09-30',
      nowUnixSeconds: 100
    });

    expect(plan.success).toBe(true);
    expect(plan.summary).toEqual({ creates: 3, updates: 0, deactivations: 1, legacyRetained: 0 });
    expect(plan.actions.filter(action => action[0] === 'AddRecord')).toHaveLength(3);
    expect(plan.actions).toContainEqual(['UpdateRecord', 'Disponibilites', 10, {
      actif: false,
      sourceUpdatedAt: 100
    }]);
  });

  test('conserve active une plage seulement partiellement couverte', () => {
    const plan = planLegacyUnavailabilityMigration([{
      id: 10,
      membre: 4,
      type: 'conge',
      dateDebut: '2026-09-21',
      dateFin: '2026-10-05',
      dispo: 0
    }], {
      horizonStart: '2026-09-01',
      horizonEnd: '2026-09-30',
      nowUnixSeconds: 100
    });

    expect(plan.success).toBe(true);
    expect(plan.summary).toEqual({ creates: 10, updates: 0, deactivations: 0, legacyRetained: 1 });
    expect(plan.actions.some(action => action[0] === 'UpdateRecord' && action[2] === 10)).toBe(false);
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'LEGACY_RANGE_PARTIALLY_CONVERTED', id: 10 })
    ]));
  });

  test('bloque toute écriture lorsqu’une plage active est invalide', () => {
    const plan = planLegacyUnavailabilityMigration([
      { id: 10, membre: 4, dateDebut: '2026-09-21', dateFin: '2026-09-21', dispo: 0 },
      { id: 11, membre: 4, dateDebut: '2026-09-25', dateFin: '2026-09-24', dispo: 0 }
    ], {
      horizonStart: '2026-09-01',
      horizonEnd: '2026-09-30'
    });

    expect(plan).toMatchObject({
      success: false,
      error: { code: 'LEGACY_UNAVAILABILITY_VALIDATION_FAILED' },
      actions: []
    });
    expect(plan.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 11 })
    ]));
  });

  test('exécute de façon idempotente uniquement hors dry-run', async () => {
    const mockGrist = createMockGrist({
      initialData: {
        Disponibilites: [{
          id: 10,
          membre: 4,
          type: 'conge',
          dateDebut: '2026-09-21',
          dateFin: '2026-09-21',
          dispo: 0,
          commentaire: 'Congés annuels'
        }]
      }
    });
    const options = {
      horizonStart: '2026-09-01',
      horizonEnd: '2026-09-30',
      nowUnixSeconds: 100
    };

    const preview = await migrateLegacyUnavailabilities(mockGrist, options);
    expect(preview.dryRun).toBe(true);
    expect((await mockGrist.fetchTable('Disponibilites')).id).toHaveLength(1);

    const execution = await migrateLegacyUnavailabilities(mockGrist, Object.assign({}, options, { dryRun: false }));
    expect(execution.success).toBe(true);
    expect(execution.actionsExecuted).toBe(2);

    const after = await mockGrist.fetchTable('Disponibilites');
    expect(after.id).toHaveLength(2);
    expect(after.actif).toEqual([false, true]);
    expect(after.date[1]).toBe(1789948800);

    const rerun = await migrateLegacyUnavailabilities(mockGrist, Object.assign({}, options, { dryRun: false }));
    expect(rerun.success).toBe(true);
    expect(rerun.actionsExecuted).toBe(0);
  });
});
