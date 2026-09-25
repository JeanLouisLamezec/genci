'use strict';

const scale = require('./gantt-calendar-scale.js');

describe('GanttCalendarScale', () => {
  test('couvre toute une année civile normale et ses douze mois', () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2027, 0, 1);
    expect(scale.daysForCalendarMonths(start, 12)).toBe(365);
    expect(scale.countMonthCells(start, end)).toBe(12);
  });

  test('couvre les 366 jours d’une année bissextile', () => {
    expect(scale.daysForCalendarMonths(new Date(2028, 0, 1), 12)).toBe(366);
  });

  test('inclut le dernier mois lorsqu’une extension se termine en cours de mois', () => {
    expect(scale.countMonthCells(
      new Date(2026, 0, 1),
      new Date(2027, 0, 14)
    )).toBe(13);
  });

  test('aligne une fin partielle sur le mois suivant sans dépasser une frontière existante', () => {
    expect(scale.ceilMonthBoundary(new Date(2027, 0, 15))).toEqual(new Date(2027, 1, 1));
    expect(scale.ceilMonthBoundary(new Date(2027, 0, 1, 2))).toEqual(new Date(2027, 0, 1));
  });
});
