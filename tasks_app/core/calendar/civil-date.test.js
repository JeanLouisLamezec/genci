'use strict';

const calendar = require('./civil-date.js');

describe('calendrier civil Temporal', () => {
  test('passe l’heure d’hiver sans déplacer le lundi', () => {
    expect(calendar.addDays('2026-10-12', 7)).toBe('2026-10-19');
    expect(calendar.addDays('2026-10-19', 7)).toBe('2026-10-26');
  });

  test('gère les années bissextiles et refuse les dates impossibles', () => {
    expect(calendar.addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(calendar.addDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(calendar.parseIsoDate('2026-02-29')).toBe(null);
  });

  test('calcule le lundi ISO sans manipuler une durée en heures', () => {
    expect(calendar.startOfIsoWeek('2026-10-25')).toBe('2026-10-19');
    expect(calendar.startOfIsoWeek('2026-10-26')).toBe('2026-10-26');
  });

  test('convertit minuit Europe/Paris vers le même jour civil Grist', () => {
    const epochMs = calendar.epochMsAtLocalMidnight('2026-10-26');
    expect(calendar.isoDateFromEpochMs(epochMs)).toBe('2026-10-26');
    expect(calendar.isoDateFromGrist(epochMs / 1000)).toBe('2026-10-26');
  });

  test('conserve le jour Grist historique autour du changement d’heure', () => {
    const sundayEpochMs = calendar.epochMsAtLocalMidnight('2026-10-25');
    expect(calendar.isoDateFromGrist(sundayEpochMs / 1000)).toBe('2026-10-25');
    expect(calendar.startOfIsoWeek(calendar.isoDateFromGrist(sundayEpochMs / 1000)))
      .toBe('2026-10-19');
  });
});
