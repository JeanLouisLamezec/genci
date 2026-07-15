/**
 * Tests unitaires pour Timesheet Validator
 * 
 * Couvre les scénarios de validation de capacité, heures négatives,
 * doublons, précision, validation stricte des nombres et période de feuille.
 */

'use strict';

const { validateTimesheet, ERROR_CODES, isDateInTimesheetWeek } = require('./timesheet-validator.js');

describe('Timesheet Validator - Capacité valide', () => {
  
  test('Capacité 7h, total 7h : valide', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: 7 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.dailyTotals.length).toBe(1);
    expect(result.dailyTotals[0].totalHours).toBe(7);
    expect(result.dailyTotals[0].availableCapacityHours).toBe(7);
  });

  test('Capacité 7h, total 0h : valide', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: 0 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test('Capacité 0h, total 0h : valide', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: 0 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 0 }
      ]
    });
    
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });
});

describe('Timesheet Validator - Capacité dépassée', () => {
  
  test('Capacité 7h, total 7,01h : invalide', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: 7.01 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].code).toBe(ERROR_CODES.DAILY_CAPACITY_EXCEEDED);
    expect(result.errors[0].exceededBy).toBeCloseTo(0.01, 3);
  });

  test('Capacité 0h, total 0,01h : invalide', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: 0.01 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 0 }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].code).toBe(ERROR_CODES.DAILY_CAPACITY_EXCEEDED);
  });

  test('Capacité 7h, total 10h : invalide', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: 10 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].exceededBy).toBe(3);
  });
});

describe('Timesheet Validator - Somme de plusieurs tâches', () => {
  
  test('Le contrôle porte sur la somme de plusieurs tâches d\'une même journée', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: 4 },
        { taskId: 2, date: '2026-07-06', actualHours: 4 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].code).toBe(ERROR_CODES.DAILY_CAPACITY_EXCEEDED);
    expect(result.dailyTotals[0].totalHours).toBe(8);
  });

  test('Somme de 3 tâches = 7h sur capacité 7h : valide', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: 2 },
        { taskId: 2, date: '2026-07-06', actualHours: 3 },
        { taskId: 3, date: '2026-07-06', actualHours: 2 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(true);
    expect(result.dailyTotals[0].totalHours).toBe(7);
  });
});

describe('Timesheet Validator - Heures négatives', () => {
  
  test('Heure négative est refusée', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: -2 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].code).toBe(ERROR_CODES.NEGATIVE_ACTUAL_HOURS);
  });

  test('Heure négative parmi d\'autres entrées', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: 3 },
        { taskId: 2, date: '2026-07-06', actualHours: -1 },
        { taskId: 3, date: '2026-07-07', actualHours: 4 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 },
        { date: '2026-07-07', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].code).toBe(ERROR_CODES.NEGATIVE_ACTUAL_HOURS);
    expect(result.dailyTotals.length).toBe(2);
  });
});

describe('Timesheet Validator - Précision', () => {
  
  test('Précision de 0,01h est respectée', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: 3.55 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(true);
    expect(result.dailyTotals[0].totalHours).toBe(3.55);
  });

  test('Précision 0,01h : 7,00h sur 7h est valide', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: 7.00 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(true);
  });

  test('Précision 0,01h : 7,005h sur 7h est invalide (arrondi)', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: 7.005 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
  });
});

describe('Timesheet Validator - Doublons', () => {
  
  test('Deux entrées même tâche même date : doublon', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: 3 },
        { taskId: 1, date: '2026-07-06', actualHours: 4 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].code).toBe(ERROR_CODES.DUPLICATE_DAILY_ENTRY);
  });
});

describe('Timesheet Validator - Dates invalides', () => {
  
  test('Date invalide est rejetée', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-13-45', actualHours: 3 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].code).toBe(ERROR_CODES.INVALID_DATE);
  });

  test('Format de date incorrect', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '07-06-2026', actualHours: 3 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].code).toBe(ERROR_CODES.INVALID_DATE);
  });
});

describe('Timesheet Validator - Capacité manquante', () => {
  
  test('Capacité non définie pour une date', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-07', actualHours: 3 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].code).toBe(ERROR_CODES.MISSING_CAPACITY);
    expect(result.dailyTotals[0].availableCapacityHours).toBeNull();
  });
});

describe('Timesheet Validator - Entrées vides', () => {
  
  test('Aucune entrée : valide', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.dailyTotals.length).toBe(0);
  });

  test('Cellule absente ou vide vaut zéro', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: null },
        { taskId: 2, date: '2026-07-07', actualHours: undefined }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 },
        { date: '2026-07-07', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(true);
    expect(result.dailyTotals[0].totalHours).toBe(0);
    expect(result.dailyTotals[1].totalHours).toBe(0);
  });
});

describe('Timesheet Validator - Période de feuille', () => {
  
  test('Date dans la période lundi-vendredi : valide', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-08', actualHours: 3 }
      ],
      capacities: [
        { date: '2026-07-08', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(true);
  });

  test('Date hors période (week-end) : invalide par défaut', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-11', actualHours: 3 }
      ],
      capacities: [
        { date: '2026-07-11', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === ERROR_CODES.DATE_OUTSIDE_TIMESHEET_WEEK)).toBe(true);
  });

  test('Date hors période (semaine suivante) : invalide', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-13', actualHours: 3 }
      ],
      capacities: [
        { date: '2026-07-13', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === ERROR_CODES.DATE_OUTSIDE_TIMESHEET_WEEK)).toBe(true);
  });

  test('isDateInTimesheetWeek avec allowWeekend=true autorise samedi dans la semaine', () => {
    const result = isDateInTimesheetWeek('2026-07-10', '2026-07-06', { allowWeekend: true });
    expect(result.valid).toBe(true);
  });

  test('isDateInTimesheetWeek avec allowWeekend=true refuse date hors semaine', () => {
    const result = isDateInTimesheetWeek('2026-07-11', '2026-07-06', { allowWeekend: true });
    expect(result.valid).toBe(false);
  });
});

describe('Timesheet Validator - Validation stricte des nombres', () => {
  
  test('actualHours null est accepté comme zéro', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: null }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(true);
    expect(result.dailyTotals[0].totalHours).toBe(0);
  });

  test('actualHours NaN est refusé', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: NaN }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === ERROR_CODES.INVALID_ACTUAL_HOURS)).toBe(true);
  });

  test('actualHours chaîne est refusé', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: '3' }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === ERROR_CODES.INVALID_ACTUAL_HOURS)).toBe(true);
  });

  test('actualHours objet est refusé', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: {} }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: 7 }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === ERROR_CODES.INVALID_ACTUAL_HOURS)).toBe(true);
  });

  test('Capacité invalide est refusée', () => {
    const result = validateTimesheet({
      memberId: 1,
      weekStart: '2026-07-06',
      entries: [
        { taskId: 1, date: '2026-07-06', actualHours: 3 }
      ],
      capacities: [
        { date: '2026-07-06', availableCapacityHours: NaN }
      ]
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === ERROR_CODES.INVALID_ACTUAL_HOURS)).toBe(true);
  });
});

describe('Timesheet Validator - ERROR_CODES', () => {
  
  test('Les codes d\'erreur sont stables', () => {
    expect(ERROR_CODES.NEGATIVE_ACTUAL_HOURS).toBe('NEGATIVE_ACTUAL_HOURS');
    expect(ERROR_CODES.DAILY_CAPACITY_EXCEEDED).toBe('DAILY_CAPACITY_EXCEEDED');
    expect(ERROR_CODES.MISSING_CAPACITY).toBe('MISSING_CAPACITY');
    expect(ERROR_CODES.INVALID_DATE).toBe('INVALID_DATE');
    expect(ERROR_CODES.DUPLICATE_DAILY_ENTRY).toBe('DUPLICATE_DAILY_ENTRY');
    expect(ERROR_CODES.INVALID_ACTUAL_HOURS).toBe('INVALID_ACTUAL_HOURS');
    expect(ERROR_CODES.DATE_OUTSIDE_TIMESHEET_WEEK).toBe('DATE_OUTSIDE_TIMESHEET_WEEK');
  });
});
