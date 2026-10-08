'use strict';

const {
  canonicalKey,
  normalizeDailyUnavailabilityRows,
  reconcileDailyUnavailabilities
} = require('./daily-unavailability-normalizer.js');

describe('Daily Unavailability Normalizer', () => {
  test('refuse de développer une ancienne plage sans horizon explicite', () => {
    const result = normalizeDailyUnavailabilityRows([{
      id: 7,
      membre: 3,
      dateDebut: '2026-09-01',
      dateFin: '2026-09-30',
      dispo: 0,
      type: 'conge'
    }]);

    expect(result.facts).toEqual([]);
    expect(result.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'HORIZON_REQUIRED_FOR_LEGACY_RANGE' })
    ]));
  });

  test('développe et borne une plage historique en faits journaliers déterministes', () => {
    const result = normalizeDailyUnavailabilityRows([{
      id: 7,
      membre: ['L', 3],
      dateDebut: '2026-09-01',
      dateFin: '2026-09-05',
      dispo: 0.5,
      type: 'conge',
      commentaire: 'Congés payés',
      sourceUpdatedAt: 1798761600
    }], {
      horizonStart: '2026-09-03',
      horizonEnd: '2026-09-04'
    });

    expect(result.rejected).toEqual([]);
    expect(result.facts).toHaveLength(2);
    expect(result.facts.map(fact => fact.date)).toEqual(['2026-09-03', '2026-09-04']);
    expect(result.facts[0]).toMatchObject({
      membre: 3,
      dispo: 0.5,
      origine: 'manuel',
      integration: 'manuel',
      externalKey: 'daily:manuel:3:2026-09-03',
      actif: true
    });
    expect(JSON.parse(result.facts[0].externalRefs)).toEqual(['legacy:7']);
  });

  test('fusionne par membre, date et intégration en conservant le ratio le plus restrictif', () => {
    const result = normalizeDailyUnavailabilityRows([
      {
        id: 1,
        membre: 3,
        date: '2026-09-10',
        dispo: 0.5,
        type: 'conge',
        commentaire: 'Congés',
        origine: 'logiciel_metier',
        integration: 'sirh',
        externalKey: 'leave-am'
      },
      {
        id: 2,
        membre: 3,
        date: '2026-09-10',
        dispo: 0,
        type: 'maladie',
        commentaire: 'Arrêt',
        origine: 'logiciel_metier',
        integration: 'sirh',
        externalKey: 'leave-pm'
      }
    ]);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({
      membre: 3,
      date: '2026-09-10',
      dispo: 0,
      type: 'maladie',
      integration: 'sirh'
    });
    expect(result.facts[0].commentaire).toBe('Arrêt — Congés');
    expect(JSON.parse(result.facts[0].externalRefs)).toEqual(['leave-am', 'leave-pm']);
  });

  test('réconcilie un déplacement sans créer de congé fantôme', () => {
    const currentRows = [{
      id: 9,
      membre: 3,
      date: '2026-09-21',
      dispo: 0,
      type: 'conge',
      commentaire: 'Congés',
      origine: 'logiciel_metier',
      integration: 'sirh',
      externalKey: 'daily:sirh:3:2026-09-21',
      externalRefs: '["leave-1"]',
      actif: true,
      sourceUpdatedAt: 1
    }];
    const desired = [{
      membre: 3,
      date: '2026-09-28',
      dispo: 0,
      type: 'conge',
      commentaire: 'Congés',
      origine: 'logiciel_metier',
      integration: 'sirh',
      externalKey: 'daily:sirh:3:2026-09-28',
      externalRefs: '["leave-1"]',
      actif: true,
      sourceUpdatedAt: 2
    }];

    const result = reconcileDailyUnavailabilities(currentRows, desired, {
      integration: 'sirh',
      scopeStart: '2026-09-01',
      scopeEnd: '2026-09-30',
      nowUnixSeconds: 3
    });

    expect(result.success).toBe(true);
    expect(result.creates).toHaveLength(1);
    expect(result.creates[0]).toMatchObject({ membre: 3, date: 1790553600, actif: true });
    expect(result.deactivations).toEqual([{ id: 9, fields: { actif: false, sourceUpdatedAt: 3 } }]);
    expect(result.updates).toEqual([]);
  });

  test('signale les doublons existants plutôt que de choisir une ligne arbitrairement', () => {
    const rows = [
      { id: 1, membre: 3, date: '2026-09-21', integration: 'sirh', actif: true },
      { id: 2, membre: 3, date: '2026-09-21', integration: 'sirh', actif: false }
    ];
    const result = reconcileDailyUnavailabilities(rows, [], {
      integration: 'sirh',
      scopeStart: '2026-09-21',
      scopeEnd: '2026-09-21'
    });

    expect(result.success).toBe(false);
    expect(result.conflicts).toEqual([{
      code: 'DUPLICATE_CURRENT_DAILY_FACT',
      key: canonicalKey(3, '2026-09-21', 'sirh'),
      ids: [1, 2]
    }]);
  });

  test('reste idempotent quand la source ne fournit pas d’horodatage', () => {
    const desired = [{
      membre: 3,
      date: '2026-09-21',
      dispo: 0.5,
      type: 'conge',
      commentaire: 'Congés',
      origine: 'logiciel_metier',
      integration: 'sirh',
      externalKey: 'daily:sirh:3:2026-09-21',
      externalRefs: '["leave-1"]',
      actif: true,
      sourceUpdatedAt: null
    }];
    const currentRows = [{
      id: 7,
      membre: 3,
      date: '2026-09-21',
      dispo: 0.5,
      type: 'conge',
      commentaire: 'Congés',
      origine: 'logiciel_metier',
      integration: 'sirh',
      externalKey: 'daily:sirh:3:2026-09-21',
      externalRefs: '["leave-1"]',
      actif: true,
      sourceUpdatedAt: 100
    }];

    const result = reconcileDailyUnavailabilities(currentRows, desired, {
      integration: 'sirh',
      scopeStart: '2026-09-21',
      scopeEnd: '2026-09-21',
      nowUnixSeconds: 999
    });

    expect(result).toMatchObject({ success: true, creates: [], updates: [], deactivations: [], unchanged: [7] });
  });
});
