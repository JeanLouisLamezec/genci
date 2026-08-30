const periods = require('./time-periods');

describe('TaskFlowTimePeriods', () => {
  test.each([
    ['week', '2024-W20'],
    ['month', '2024-05'],
    ['quarter', '2024-Q2'],
    ['semester', '2024-H1'],
    ['year', '2024']
  ])('produit une clé %s stable', (granularity, expected) => {
    expect(periods.key(new Date('2024-05-15T00:00:00Z'), granularity)).toBe(expected);
  });

  test.each([
    ['quarter', '2024-Q2', '2024-04-01', '2024-07-01'],
    ['semester', '2024-H2', '2024-07-01', '2025-01-01'],
    ['year', '2024', '2024-01-01', '2025-01-01']
  ])('calcule les bornes exactes de %s', (granularity, key, start, end) => {
    const result = periods.bounds(key, granularity);
    expect(result.start.toISOString().slice(0, 10)).toBe(start);
    expect(result.end.toISOString().slice(0, 10)).toBe(end);
  });

  test('génère une plage de trimestres à cheval sur deux années', () => {
    expect(periods.range(new Date('2024-10-10T00:00:00Z'), 'quarter', 3)).toEqual([
      '2024-Q4', '2025-Q1', '2025-Q2'
    ]);
  });

  test('fournit les cinq horizons communs du Plan et du Gantt', () => {
    expect(periods.GRANULARITIES).toEqual(['week', 'month', 'quarter', 'semester', 'year']);
    expect(periods.defaultHorizon('year')).toBe(5);
  });
});
