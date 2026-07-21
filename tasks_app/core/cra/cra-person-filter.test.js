/**
 * Tests unitaires pour CRA Person Filter
 * @see cra-person-filter.js pour l'implémentation
 * 
 * Usage: npm test -- cra-person-filter.test.js --runInBand
 */

const {
  hasActivePersonFilter,
  computeVisiblePersonIds,
  resolveDefaultPersonIds,
  applyPersonFilters
} = require('./cra-person-filter.js');

// Données de test
const mockTeam = [
  { id: 1, nom: 'Alice', entite: 10 },
  { id: 2, nom: 'Bob', entite: 20 },
  { id: 3, nom: 'Claire', entite: 10 },
  { id: 4, nom: 'David', entite: null }
];

describe('hasActivePersonFilter', () => {
  
  test('doit retourner false sans filtres', () => {
    expect(hasActivePersonFilter({ assignee: [], team: [] })).toBe(false);
    expect(hasActivePersonFilter({})).toBe(false);
    expect(hasActivePersonFilter(null)).toBe(false);
    expect(hasActivePersonFilter(undefined)).toBe(false);
  });
  
  test('doit retourner true avec filtre assignee', () => {
    expect(hasActivePersonFilter({ assignee: ['1'], team: [] })).toBe(true);
    expect(hasActivePersonFilter({ assignee: ['1', '2'], team: [] })).toBe(true);
  });
  
  test('doit retourner true avec filtre team', () => {
    expect(hasActivePersonFilter({ assignee: [], team: ['10'] })).toBe(true);
  });
  
  test('doit retourner true avec les deux filtres', () => {
    expect(hasActivePersonFilter({ assignee: ['1'], team: ['10'] })).toBe(true);
  });
});

describe('computeVisiblePersonIds - Fonction pure', () => {
  
  test('Test 1 — Personne avec filtre chaîne', () => {
    const result = computeVisiblePersonIds(
      mockTeam,
      { assignee: ['2'], team: [] }
    );
    expect(result).toEqual([2]);
  });
  
  test('Test 2 — Personne avec filtre numérique', () => {
    const result = computeVisiblePersonIds(
      mockTeam,
      { assignee: [2], team: [] }
    );
    expect(result).toEqual([2]);
  });
  
  test('Test 3 — Filtre équipe', () => {
    const result = computeVisiblePersonIds(
      mockTeam,
      { assignee: [], team: ['20'] }
    );
    expect(result).toEqual([2]);
  });
  
  test('Test 4 — Plusieurs personnes (OR)', () => {
    const result = computeVisiblePersonIds(
      mockTeam,
      { assignee: ['1', '2'], team: [] }
    );
    expect(result).toEqual([1, 2]);
  });
  
  test('Test 5 — Combinaison personne + équipe (AND)', () => {
    const result = computeVisiblePersonIds(
      mockTeam,
      { assignee: ['1', '2'], team: ['10'] }
    );
    expect(result).toEqual([1]);
  });
  
  test('Test 6 — Aucun résultat', () => {
    const result = computeVisiblePersonIds(
      mockTeam,
      { assignee: ['999'], team: [] }
    );
    expect(result).toEqual([]);
  });
  
  test('Test 7 — Aucun filtre', () => {
    const result = computeVisiblePersonIds(
      mockTeam,
      { assignee: [], team: [] }
    );
    expect(result).toEqual([1, 2, 3, 4]);
  });
  
  test('Test 8 — Personne sans entité', () => {
    const teamWithoutEntity = [
      { id: 3, nom: 'Test', entite: null }
    ];
    
    const withFilter = computeVisiblePersonIds(
      teamWithoutEntity,
      { assignee: [], team: ['10'] }
    );
    expect(withFilter).toEqual([]);
    
    const withoutFilter = computeVisiblePersonIds(
      teamWithoutEntity,
      { assignee: [], team: [] }
    );
    expect(withoutFilter).toEqual([3]);
  });
  
  test('Test 9 — Immutabilité', () => {
    const teamCopy = JSON.parse(JSON.stringify(mockTeam));
    const filtersCopy = JSON.parse(JSON.stringify({ assignee: ['1'], team: ['10'] }));
    
    computeVisiblePersonIds(mockTeam, filtersCopy);
    
    expect(mockTeam).toEqual(teamCopy);
    expect(filtersCopy).toEqual({ assignee: ['1'], team: ['10'] });
  });
  
  test('doit gérer team undefined', () => {
    const result = computeVisiblePersonIds(undefined, { assignee: ['1'], team: [] });
    expect(result).toEqual([]);
  });
  
  test('doit gérer filters undefined', () => {
    const result = computeVisiblePersonIds(mockTeam, undefined);
    expect(result).toEqual([1, 2, 3, 4]);
  });
  
  test('doit gérer plusieurs équipes (OR)', () => {
    const result = computeVisiblePersonIds(
      mockTeam,
      { assignee: [], team: ['10', '20'] }
    );
    expect(result).toEqual([1, 2, 3]);
  });
  
  test('doit convertir les IDs en chaînes pour comparaison', () => {
    const result = computeVisiblePersonIds(
      mockTeam,
      { assignee: ['1', '3'], team: ['10'] }
    );
    expect(result).toEqual([1, 3]);
  });
});

describe('resolveDefaultPersonIds', () => {
  
  test('doit优先iser l utilisateur Grist connecté', () => {
    const result = resolveDefaultPersonIds(
      mockTeam,
      2,
      [1],
      3
    );
    expect(result).toEqual([3]);
  });
  
  test('doit utiliser la personne sélectionnée si valide', () => {
    const result = resolveDefaultPersonIds(
      mockTeam,
      2,
      [1],
      null
    );
    expect(result).toEqual([2]);
  });
  
  test('doit utiliser la personne précédente si encore valide', () => {
    const result = resolveDefaultPersonIds(
      mockTeam,
      null,
      [2],
      null
    );
    expect(result).toEqual([2]);
  });
  
  test('doit fallback vers la première personne', () => {
    const result = resolveDefaultPersonIds(
      mockTeam,
      null,
      [],
      null
    );
    expect(result).toEqual([1]);
  });
  
  test('doit retourner [] si team est vide', () => {
    const result = resolveDefaultPersonIds(
      [],
      null,
      [],
      null
    );
    expect(result).toEqual([]);
  });
  
  test('doit ignorer une personne sélectionnée invalide', () => {
    const result = resolveDefaultPersonIds(
      mockTeam,
      999,
      [],
      null
    );
    expect(result).toEqual([1]);
  });
});

describe('applyPersonFilters - Intégration', () => {
  
  test('doit afficher une personne filtrée', () => {
    const result = applyPersonFilters({
      team: mockTeam,
      filters: { assignee: ['2'], team: [] },
      currentPersonId: 1,
      previousVisibleIds: [1, 2, 3],
      currentUserMemberId: null
    });
    
    expect(result.visiblePersonIds).toEqual([2]);
    expect(result.selectedPersonId).toBe(2);
    expect(result.isEmptyDueToFilter).toBe(false);
  });
  
  test('doit détecter un état vide dû aux filtres', () => {
    const result = applyPersonFilters({
      team: mockTeam,
      filters: { assignee: ['999'], team: [] },
      currentPersonId: 1,
      previousVisibleIds: [1],
      currentUserMemberId: null
    });
    
    expect(result.visiblePersonIds).toEqual([]);
    expect(result.selectedPersonId).toBe(null);
    expect(result.isEmptyDueToFilter).toBe(true);
  });
  
  test('doit appliquer le comportement par défaut sans filtre', () => {
    const result = applyPersonFilters({
      team: mockTeam,
      filters: { assignee: [], team: [] },
      currentPersonId: null,
      previousVisibleIds: [],
      currentUserMemberId: null
    });
    
    expect(result.visiblePersonIds.length).toBeGreaterThan(0);
    expect(result.isEmptyDueToFilter).toBe(false);
  });
  
  test('doit combiner personne + équipe (AND)', () => {
    const result = applyPersonFilters({
      team: mockTeam,
      filters: { assignee: ['1', '3'], team: ['10'] },
      currentPersonId: null,
      previousVisibleIds: [],
      currentUserMemberId: null
    });
    
    expect(result.visiblePersonIds).toEqual([1, 3]);
    expect(result.selectedPersonId).toBe(1);
    expect(result.isEmptyDueToFilter).toBe(false);
  });
  
  test('doit préserver currentPersonId si valide', () => {
    const result = applyPersonFilters({
      team: mockTeam,
      filters: { assignee: ['1', '3'], team: [] },
      currentPersonId: 3,
      previousVisibleIds: [],
      currentUserMemberId: null
    });
    
    expect(result.visiblePersonIds).toEqual([1, 3]);
    expect(result.selectedPersonId).toBe(3);
    expect(result.isEmptyDueToFilter).toBe(false);
  });
});

describe('Scénarios d intégration', () => {
  
  test('Scénario A — FilterManager vers CRA', () => {
    const filters = { assignee: ['2'], team: [], project: [], programme: [], task: [] };
    
    const result = applyPersonFilters({
      team: mockTeam,
      filters,
      currentPersonId: 1,
      previousVisibleIds: [1],
      currentUserMemberId: null
    });
    
    expect(result.visiblePersonIds).toEqual([2]);
    expect(result.selectedPersonId).toBe(2);
  });
  
  test('Scénario B — Aucun résultat', () => {
    const filters = { assignee: ['999'], team: [], project: [], programme: [], task: [] };
    
    const result = applyPersonFilters({
      team: mockTeam,
      filters,
      currentPersonId: 1,
      previousVisibleIds: [1],
      currentUserMemberId: null
    });
    
    expect(result.visiblePersonIds).toEqual([]);
    expect(result.isEmptyDueToFilter).toBe(true);
  });
  
  test('Scénario C — Effacer les filtres', () => {
    const filters = { assignee: [], team: [], project: [], programme: [], task: [] };
    
    const result = applyPersonFilters({
      team: mockTeam,
      filters,
      currentPersonId: null,
      previousVisibleIds: [],
      currentUserMemberId: null
    });
    
    expect(result.visiblePersonIds.length).toBeGreaterThan(0);
    expect(result.isEmptyDueToFilter).toBe(false);
  });
  
  test('Scénario D — Reload avec filtre actif', () => {
    const filters = { assignee: ['2'], team: [], project: [], programme: [], task: [] };
    
    const result = applyPersonFilters({
      team: mockTeam,
      filters,
      currentPersonId: 2,
      previousVisibleIds: [2],
      currentUserMemberId: null
    });
    
    expect(result.visiblePersonIds).toEqual([2]);
    expect(result.selectedPersonId).toBe(2);
  });
  
  test('Scénario E — Filtre externe avec IDs numériques', () => {
    const filters = { assignee: [2], team: [10], project: [], programme: [], task: [] };
    
    const result = applyPersonFilters({
      team: mockTeam,
      filters,
      currentPersonId: 1,
      previousVisibleIds: [1],
      currentUserMemberId: null
    });
    
    expect(result.visiblePersonIds).toEqual([]);
    expect(result.isEmptyDueToFilter).toBe(true);
  });
});
