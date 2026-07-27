/* ============================================================================
 * time-entry-planning-ponctuel.test.js — Tests ciblés mode PONCTUEL
 * ============================================================================ */

const { 
  planAssignment,
  DISTRIBUTION_MODES
} = require('./time-entry-planning-service');

// Helper explicite pour les timestamps
function unixDate(year, month, day) {
  return Date.UTC(year, month - 1, day) / 1000;
}

describe('Mode PONCTUEL - Équivalence avec UNIFORME', () => {
  const assignmentUniforme = {
    id: 1,
    tache: 6,
    membre: 1,
    heuresAllouees: 8,
    dateDebut: unixDate(2026, 7, 23),
    dateFin: unixDate(2026, 7, 24),
    modeRepartition: 'uniforme',
    actif: true
  };

  const assignmentPonctuel = {
    id: 2,
    tache: 6,
    membre: 1,
    heuresAllouees: 8,
    dateDebut: unixDate(2026, 7, 23),
    dateFin: unixDate(2026, 7, 24),
    modeRepartition: 'ponctuel',
    actif: true
  };

  const context = {
    members: [{ id: 1, nom: 'Jason' }],
    tasks: [{ id: 6, titre: 'Intervention juridique' }],
    capacities: [
      { id: 1, membre: 1, date: '2026-07-23', capaciteDisponible: 7, capaciteTheorique: 7 },
      { id: 2, membre: 1, date: '2026-07-24', capaciteDisponible: 7, capaciteTheorique: 7 }
    ],
    existingEntries: []
  };

  test('P1 — Mode ponctuel génère un prévisionnel sans erreurs', () => {
    const result = planAssignment(assignmentPonctuel, context);

    expect(result.errors || []).toHaveLength(0);
    expect(result.plannedEntries).toHaveLength(2);
  });

  test('P2 — Somme des heuresPrevues = 8h', () => {
    const result = planAssignment(assignmentPonctuel, context);

    const total = result.plannedEntries.reduce((sum, e) => sum + e.heuresPrevues, 0);
    expect(Math.round(total * 100) / 100).toBe(8);
  });

  test('P3 — unallocatedHours = 0', () => {
    const result = planAssignment(assignmentPonctuel, context);

    expect(result.unallocatedHours).toBe(0);
  });

  test('P4 — Toutes les lignes ont heures = null', () => {
    const result = planAssignment(assignmentPonctuel, context);

    result.plannedEntries.forEach(entry => {
      expect(entry.heures).toBeNull();
    });
  });

  test('P5 — affectation = ID de la TaskAssignment', () => {
    const result = planAssignment(assignmentPonctuel, context);

    result.plannedEntries.forEach(entry => {
      expect(entry.affectation).toBe(2);
    });
  });

  test('P6 — Dates comprises entre 23 et 24 juillet', () => {
    const result = planAssignment(assignmentPonctuel, context);

    const minDate = unixDate(2026, 7, 23);
    const maxDate = unixDate(2026, 7, 24);

    result.plannedEntries.forEach(entry => {
      expect(entry.date).toBeGreaterThanOrEqual(minDate);
      expect(entry.date).toBeLessThanOrEqual(maxDate);
    });
  });

  test('P7 — heuresPrevues > 0 sur chaque ligne', () => {
    const result = planAssignment(assignmentPonctuel, context);

    result.plannedEntries.forEach(entry => {
      expect(entry.heuresPrevues).toBeGreaterThan(0);
    });
  });

  test('P8 — Équivalence ponctuel vs uniforme par date', () => {
    const resultUniforme = planAssignment(assignmentUniforme, context);
    const resultPonctuel = planAssignment(assignmentPonctuel, context);

    const normalize = (entries) => entries
      .map(e => ({ date: e.date, heuresPrevues: e.heuresPrevues }))
      .sort((a, b) => a.date - b.date);

    const expected = normalize(resultUniforme.plannedEntries);
    const actual = normalize(resultPonctuel.plannedEntries);

    expect(actual).toEqual(expected);
  });

  test('P9 — Aucun warning PONCTUEL_NO_AUTO_PLANNING', () => {
    const result = planAssignment(assignmentPonctuel, context);

    const hasBadWarning = result.warnings.some(w => 
      w.code === 'PONCTUEL_NO_AUTO_PLANNING' || 
      w.code === 'PONCTUEL_NO_PLANNED_ENTRIES'
    );
    expect(hasBadWarning).toBe(false);
  });
});

describe('Mode PONCTUEL — Capacité insuffisante', () => {
  const assignmentUniforme20h = {
    id: 10,
    tache: 6,
    membre: 1,
    heuresAllouees: 20,
    dateDebut: unixDate(2026, 7, 23),
    dateFin: unixDate(2026, 7, 24),
    modeRepartition: 'uniforme',
    actif: true
  };

  const assignmentPonctuel20h = {
    id: 11,
    tache: 6,
    membre: 1,
    heuresAllouees: 20,
    dateDebut: unixDate(2026, 7, 23),
    dateFin: unixDate(2026, 7, 24),
    modeRepartition: 'ponctuel',
    actif: true
  };

  const contextLimited = {
    members: [{ id: 1, nom: 'Jason' }],
    tasks: [{ id: 6, titre: 'Intervention juridique' }],
    capacities: [
      { id: 1, membre: 1, date: '2026-07-23', capaciteDisponible: 7, capaciteTheorique: 7 },
      { id: 2, membre: 1, date: '2026-07-24', capaciteDisponible: 7, capaciteTheorique: 7 }
    ],
    existingEntries: []
  };

  test('P10 — Somme du prévu = 14h (capacité max)', () => {
    const resultPonctuel = planAssignment(assignmentPonctuel20h, contextLimited);
    const total = resultPonctuel.plannedEntries.reduce((sum, e) => sum + e.heuresPrevues, 0);
    expect(Math.round(total * 100) / 100).toBe(14);
  });

  test('P11 — unallocatedHours = 6', () => {
    const resultPonctuel = planAssignment(assignmentPonctuel20h, contextLimited);
    expect(resultPonctuel.unallocatedHours).toBe(6);
  });

  test('P12 — Aucune journée ne dépasse 7h', () => {
    const resultPonctuel = planAssignment(assignmentPonctuel20h, contextLimited);

    resultPonctuel.plannedEntries.forEach(entry => {
      expect(entry.heuresPrevues).toBeLessThanOrEqual(7);
    });
  });

  test('P13 — Équivalence uniforme vs ponctuel en capacité insuffisante', () => {
    const resultUniforme = planAssignment(assignmentUniforme20h, contextLimited);
    const resultPonctuel = planAssignment(assignmentPonctuel20h, contextLimited);

    const normalize = (entries) => entries
      .map(e => ({ date: e.date, heuresPrevues: e.heuresPrevues }))
      .sort((a, b) => a.date - b.date);

    expect(normalize(resultPonctuel.plannedEntries)).toEqual(normalize(resultUniforme.plannedEntries));
    expect(resultPonctuel.unallocatedHours).toBe(resultUniforme.unallocatedHours);
  });
});
