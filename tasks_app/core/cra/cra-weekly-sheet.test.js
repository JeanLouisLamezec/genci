/**
 * Tests unitaires pour cra-weekly-sheet.js
 *
 * Couverture :
 * 1. Aucune feuille existante
 * 2. Une feuille unique existante
 * 3. Deux feuilles pour le même membre et la même semaine
 * 4. Feuille d'un autre membre ignorée
 * 5. Feuille d'une autre semaine ignorée
 * 6. IDs sous forme de nombre et chaîne numérique
 * 7. Semaine invalide
 * 8. Entrée sans feuille à rattacher
 * 9. Entrée déjà correctement rattachée
 * 10. Entrée liée à une autre feuille
 * 11. Entrée d'un autre membre ignorée
 * 12. Entrée d'une autre semaine ignorée
 * 13. Ordre déterministe des actions
 * 14. Aucune mutation des tableaux reçus
 */

'use strict';

const {
  normalizeMemberId,
  getWeekStartIso,
  resolveWeeklySheetState,
  buildWeeklySheetCreation,
  findEntriesForMemberWeek,
  buildOrphanEntryLinkPlan,
  buildSheetCreationActions,
  buildEntryLinkActions,
  buildEnsureWeeklySheetActions
} = require('./cra-weekly-sheet');

// ============================================================================
// TESTS : normalizeMemberId
// ============================================================================

describe('normalizeMemberId', () => {
  test('devrait accepter un nombre entier positif', () => {
    expect(normalizeMemberId(20)).toBe(20);
    expect(normalizeMemberId(1)).toBe(1);
    expect(normalizeMemberId(999999)).toBe(999999);
  });

  test('devrait accepter une chaîne numérique positive', () => {
    expect(normalizeMemberId('20')).toBe(20);
    expect(normalizeMemberId('1')).toBe(1);
  });

  test('devrait rejeter null et undefined', () => {
    expect(normalizeMemberId(null)).toBe(null);
    expect(normalizeMemberId(undefined)).toBe(null);
    expect(normalizeMemberId('')).toBe(null);
  });

  test('devrait rejeter zéro', () => {
    expect(normalizeMemberId(0)).toBe(null);
    expect(normalizeMemberId('0')).toBe(null);
  });

  test('devrait rejeter les nombres négatifs', () => {
    expect(normalizeMemberId(-1)).toBe(null);
    expect(normalizeMemberId('-5')).toBe(null);
  });

  test('devrait rejeter les nombres flottants', () => {
    expect(normalizeMemberId(3.14)).toBe(null);
    expect(normalizeMemberId('2.5')).toBe(null);
  });

  test('devrait rejeter les chaînes non numériques', () => {
    expect(normalizeMemberId('abc')).toBe(null);
    expect(normalizeMemberId('20a')).toBe(null);
  });
});

// ============================================================================
// TESTS : getWeekStartIso
// ============================================================================

describe('getWeekStartIso', () => {
  test('devrait retourner le lundi pour un lundi', () => {
    // Lundi 21 juillet 2025
    const result = getWeekStartIso('2025-07-21');
    expect(result).toBe('2025-07-21');
  });

  test('devrait retourner le lundi pour un mardi', () => {
    // Mardi 22 juillet 2025 → Lundi 21
    const result = getWeekStartIso('2025-07-22');
    expect(result).toBe('2025-07-21');
  });

  test('devrait retourner le lundi pour un dimanche', () => {
    // Dimanche 20 juillet 2025 → Lundi 14
    const result = getWeekStartIso('2025-07-20');
    expect(result).toBe('2025-07-14');
  });

  test('devrait gérer un timestamp Grist (secondes)', () => {
    // Lundi 21 juillet 2025 00:00:00 UTC = 1753056000 secondes
    const timestamp = 1753056000;
    const result = getWeekStartIso(timestamp);
    expect(result).toBe('2025-07-21');
  });

  test('devrait retourner null pour une date invalide', () => {
    expect(getWeekStartIso(null)).toBe(null);
    expect(getWeekStartIso(undefined)).toBe(null);
    expect(getWeekStartIso('')).toBe(null);
    expect(getWeekStartIso('invalid')).toBe(null);
  });
});

// ============================================================================
// TESTS : resolveWeeklySheetState
// ============================================================================

describe('resolveWeeklySheetState', () => {
  const mockSheets = [
    { id: 1, membre: 20, semaine: 1753056000, statut: 'brouillon' }, // Lundi 21 juillet 2025
    { id: 2, membre: 21, semaine: 1753056000, statut: 'brouillon' }, // Autre membre
    { id: 3, membre: 20, semaine: 1753660800, statut: 'brouillon' }  // Autre semaine (28 juillet)
  ];

  test('devrait retourner CREATION_REQUIRED si aucune feuille', () => {
    const result = resolveWeeklySheetState({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheets: []
    });

    expect(result.status).toBe('CREATION_REQUIRED');
    expect(result.sheet).toBe(null);
    expect(result.sheetId).toBe(null);
    // CORRECTION : semaine doit être un timestamp Grist (secondes), pas une chaîne ISO
    expect(result.creationFields).toEqual({
      membre: 20,
      semaine: 1753048800,  // Lundi 21 juillet 2025 00:00:00 locale en secondes
      statut: 'brouillon',
      revisionValidation: 0
    });
  });

  test('devrait retourner FOUND si une feuille unique existe', () => {
    const result = resolveWeeklySheetState({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheets: mockSheets
    });

    expect(result.status).toBe('FOUND');
    expect(result.sheet).toEqual(mockSheets[0]);
    expect(result.sheetId).toBe(1);
    expect(result.creationFields).toBe(null);
  });

  test('devrait retourner DUPLICATE_WEEKLY_SHEET si plusieurs feuilles', () => {
    const duplicateSheets = [
      { id: 1, membre: 20, semaine: 1753056000, statut: 'brouillon' },
      { id: 4, membre: 20, semaine: 1753056000, statut: 'soumis' }
    ];

    const result = resolveWeeklySheetState({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheets: duplicateSheets
    });

    expect(result.status).toBe('DUPLICATE_WEEKLY_SHEET');
    expect(result.sheet).toBe(null);
    expect(result.sheetId).toBe(null);
    expect(result.duplicates).toHaveLength(2);
  });

  test('devrait ignorer les feuilles d\'un autre membre', () => {
    const result = resolveWeeklySheetState({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheets: mockSheets
    });

    // Ne devrait trouver que la feuille du membre 20, pas celle du 21
    expect(result.status).toBe('FOUND');
    expect(result.sheet.id).toBe(1);
  });

  test('devrait ignorer les feuilles d\'une autre semaine', () => {
    const result = resolveWeeklySheetState({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheets: mockSheets
    });

    // Ne devrait trouver que la feuille de la semaine du 21, pas celle du 28
    expect(result.status).toBe('FOUND');
    expect(result.sheet.id).toBe(1);
  });

  test('devrait accepter les IDs comme nombres et chaînes', () => {
    const sheetsWithStringIds = [
      { id: '1', membre: '20', semaine: 1753056000, statut: 'brouillon' }
    ];

    const result = resolveWeeklySheetState({
      memberId: '20',
      weekStartIso: '2025-07-21',
      sheets: sheetsWithStringIds
    });

    expect(result.status).toBe('FOUND');
    expect(result.sheetId).toBe(1);
  });

  test('devrait retourner INVALID_MEMBER_ID si membre invalide', () => {
    const result = resolveWeeklySheetState({
      memberId: null,
      weekStartIso: '2025-07-21',
      sheets: mockSheets
    });

    expect(result.status).toBe('INVALID_MEMBER_ID');
    expect(result.reason).toBe('INVALID_MEMBER_ID');
  });

  test('devrait retourner INVALID_WEEK si semaine invalide', () => {
    const result = resolveWeeklySheetState({
      memberId: 20,
      weekStartIso: null,
      sheets: mockSheets
    });

    expect(result.status).toBe('INVALID_WEEK');
    expect(result.reason).toBe('INVALID_WEEK');

    const result2 = resolveWeeklySheetState({
      memberId: 20,
      weekStartIso: 'invalid',
      sheets: mockSheets
    });

    expect(result2.status).toBe('INVALID_WEEK');
  });
});

// ============================================================================
// TESTS : buildWeeklySheetCreation
// ============================================================================

describe('buildWeeklySheetCreation', () => {
  test('devrait construire les champs de création valides', () => {
    const result = buildWeeklySheetCreation({
      memberId: 20,
      weekStartIso: '2025-07-21'
    });

    // CORRECTION : semaine doit être un timestamp Grist (secondes)
    expect(result).toEqual({
      membre: 20,
      semaine: 1753048800,  // Lundi 21 juillet 2025 00:00:00 locale en secondes
      statut: 'brouillon',
      revisionValidation: 0
    });
  });

  test('devrait retourner null si membre invalide', () => {
    const result = buildWeeklySheetCreation({
      memberId: null,
      weekStartIso: '2025-07-21'
    });

    expect(result).toBe(null);
  });

  test('devrait retourner null si semaine invalide', () => {
    const result = buildWeeklySheetCreation({
      memberId: 20,
      weekStartIso: null
    });

    expect(result).toBe(null);
  });
});

// ============================================================================
// TESTS : findEntriesForMemberWeek
// ============================================================================

describe('findEntriesForMemberWeek', () => {
  const mockEntries = [
    { id: 101, membre: 20, date: 1753056000, heures: 2 }, // Lundi 21
    { id: 102, membre: 20, date: 1753142400, heures: 3 }, // Mardi 22
    { id: 103, membre: 21, date: 1753056000, heures: 1 }, // Autre membre
    { id: 104, membre: 20, date: 1753660800, heures: 4 }, // Autre semaine
    { id: 105, membre: 20, date: 1753228800, heures: 0 }  // Mercredi 23
  ];

  test('devrait retourner les entrées du membre pour cette semaine', () => {
    const result = findEntriesForMemberWeek({
      memberId: 20,
      weekStartIso: '2025-07-21',
      entries: mockEntries
    });

    expect(result).toHaveLength(3);
    expect(result.map(e => e.id)).toEqual([101, 102, 105]);
  });

  test('devrait ignorer les entrées d\'un autre membre', () => {
    const result = findEntriesForMemberWeek({
      memberId: 20,
      weekStartIso: '2025-07-21',
      entries: mockEntries
    });

    const ids = result.map(e => e.id);
    expect(ids).not.toContain(103); // Entrée du membre 21
  });

  test('devrait ignorer les entrées d\'une autre semaine', () => {
    const result = findEntriesForMemberWeek({
      memberId: 20,
      weekStartIso: '2025-07-21',
      entries: mockEntries
    });

    const ids = result.map(e => e.id);
    expect(ids).not.toContain(104); // Entrée de l'autre semaine
  });

  test('devrait retourner un tableau vide si aucun paramètre', () => {
    expect(findEntriesForMemberWeek({})).toEqual([]);
    expect(findEntriesForMemberWeek({ memberId: 20 })).toEqual([]);
    expect(findEntriesForMemberWeek({ memberId: 20, weekStartIso: '2025-07-21' })).toEqual([]);
  });
});

// ============================================================================
// TESTS : buildOrphanEntryLinkPlan
// ============================================================================

describe('buildOrphanEntryLinkPlan', () => {
  const mockEntriesWithConflict = [
    { id: 101, membre: 20, date: 1753056000, heures: 2, feuille: null },     // Orpheline
    { id: 102, membre: 20, date: 1753142400, heures: 3, feuille: 50 },        // Déjà liée à la bonne feuille
    { id: 103, membre: 20, date: 1753228800, heures: 1, feuille: 99 },        // Liée à une autre feuille
    { id: 104, membre: 21, date: 1753056000, heures: 2, feuille: null },      // Autre membre
    { id: 105, membre: 20, date: 1753056000, heures: 0, feuille: null }       // Orpheline
  ];

  const mockEntriesWithoutConflict = [
    { id: 101, membre: 20, date: 1753056000, heures: 2, feuille: null },     // Orpheline
    { id: 102, membre: 20, date: 1753142400, heures: 3, feuille: 50 },        // Déjà liée à la bonne feuille
    { id: 104, membre: 21, date: 1753056000, heures: 2, feuille: null },      // Autre membre
    { id: 105, membre: 20, date: 1753056000, heures: 0, feuille: null }       // Orpheline
  ];

  test('devrait identifier les entrées à rattacher', () => {
    const result = buildOrphanEntryLinkPlan({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheetId: 50,
      entries: mockEntriesWithoutConflict
    });

    expect(result.valid).toBe(true);
    expect(result.links).toHaveLength(2);
    expect(result.links).toEqual([
      { entryId: 101, sheetId: 50 },
      { entryId: 105, sheetId: 50 }
    ]);
  });

  test('devrait identifier les entrées déjà rattachées', () => {
    const result = buildOrphanEntryLinkPlan({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheetId: 50,
      entries: mockEntriesWithoutConflict
    });

    expect(result.preserved).toHaveLength(1);
    expect(result.preserved).toEqual([
      { entryId: 102, sheetId: 50 }
    ]);
  });

  test('devrait identifier les conflits (liée à une autre feuille)', () => {
    const result = buildOrphanEntryLinkPlan({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheetId: 50,
      entries: mockEntriesWithConflict
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toEqual({
      entryId: 103,
      reason: 'TIME_ENTRY_ALREADY_LINKED_TO_OTHER_SHEET',
      currentSheetId: 99,
      targetSheetId: 50
    });
  });

  test('devrait être invalide en cas de conflit', () => {
    const result = buildOrphanEntryLinkPlan({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheetId: 50,
      entries: mockEntriesWithConflict
    });

    expect(result.valid).toBe(false);
  });

  test('devrait ignorer les entrées d\'un autre membre', () => {
    const result = buildOrphanEntryLinkPlan({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheetId: 50,
      entries: mockEntriesWithConflict
    });

    const allEntryIds = [
      ...result.links.map(l => l.entryId),
      ...result.preserved.map(p => p.entryId),
      ...result.conflicts.map(c => c.entryId)
    ];

    expect(allEntryIds).not.toContain(104); // Entrée du membre 21
  });

  test('devrait être valide sans conflit si toutes les entrées sont orphelines', () => {
    const orphanEntries = [
      { id: 101, membre: 20, date: 1753056000, heures: 2, feuille: null },
      { id: 102, membre: 20, date: 1753142400, heures: 3, feuille: null }
    ];

    const result = buildOrphanEntryLinkPlan({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheetId: 50,
      entries: orphanEntries
    });

    expect(result.valid).toBe(true);
    expect(result.conflicts).toHaveLength(0);
    expect(result.links).toHaveLength(2);
  });

  test('devrait être valide sans conflit si toutes les entrées sont déjà rattachées', () => {
    const linkedEntries = [
      { id: 101, membre: 20, date: 1753056000, heures: 2, feuille: 50 },
      { id: 102, membre: 20, date: 1753142400, heures: 3, feuille: 50 }
    ];

    const result = buildOrphanEntryLinkPlan({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheetId: 50,
      entries: linkedEntries
    });

    expect(result.valid).toBe(true);
    expect(result.conflicts).toHaveLength(0);
    expect(result.links).toHaveLength(0);
    expect(result.preserved).toHaveLength(2);
  });
});

// ============================================================================
// TESTS : buildSheetCreationActions
// ============================================================================

describe('buildSheetCreationActions', () => {
  test('devrait construire une action AddRecord valide', () => {
    const creationFields = {
      membre: 20,
      semaine: '2025-07-21',
      statut: 'brouillon',
      revisionValidation: 0
    };

    const result = buildSheetCreationActions(creationFields);

    expect(result).toEqual([
      ['AddRecord', 'Feuilles', null, creationFields]
    ]);
  });

  test('devrait retourner un tableau vide si pas de champs', () => {
    expect(buildSheetCreationActions(null)).toEqual([]);
    expect(buildSheetCreationActions(undefined)).toEqual([]);
  });
});

// ============================================================================
// TESTS : buildEntryLinkActions
// ============================================================================

describe('buildEntryLinkActions', () => {
  test('devrait construire des actions UpdateRecord triées par ID', () => {
    const links = [
      { entryId: 103, sheetId: 50 },
      { entryId: 101, sheetId: 50 },
      { entryId: 102, sheetId: 50 }
    ];

    const result = buildEntryLinkActions(links);

    expect(result).toEqual([
      ['UpdateRecord', 'TimeEntries', 101, { feuille: 50 }],
      ['UpdateRecord', 'TimeEntries', 102, { feuille: 50 }],
      ['UpdateRecord', 'TimeEntries', 103, { feuille: 50 }]
    ]);
  });

  test('devrait retourner un tableau vide si pas de liens', () => {
    expect(buildEntryLinkActions(null)).toEqual([]);
    expect(buildEntryLinkActions([])).toEqual([]);
  });
});

// ============================================================================
// TESTS : buildEnsureWeeklySheetActions
// ============================================================================

describe('buildEnsureWeeklySheetActions', () => {
  const mockSheets = [];
  const mockEntries = [
    { id: 101, membre: 20, date: 1753056000, heures: 2, feuille: null },
    { id: 102, membre: 20, date: 1753142400, heures: 3, feuille: null }
  ];

  test('devrait créer une feuille si aucune n\'existe', () => {
    const result = buildEnsureWeeklySheetActions({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheets: mockSheets,
      entries: [],
      linkOrphanEntries: false
    });

    expect(result.created).toBe(true);
    expect(result.sheetId).toBe(null); // Sera connu après exécution
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0][0]).toBe('AddRecord');
    expect(result.actions[0][1]).toBe('Feuilles');
    expect(result.error).toBe(null);
  });

  test('devrait retourner l\'ID si la feuille existe déjà', () => {
    const existingSheets = [
      { id: 50, membre: 20, semaine: 1753056000, statut: 'brouillon' }
    ];

    const result = buildEnsureWeeklySheetActions({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheets: existingSheets,
      entries: [],
      linkOrphanEntries: false
    });

    expect(result.created).toBe(false);
    expect(result.sheetId).toBe(50);
    expect(result.actions).toHaveLength(0);
    expect(result.error).toBe(null);
  });

  test('devrait rattacher les entrées orphelines si demandé', () => {
    const existingSheets = [
      { id: 50, membre: 20, semaine: 1753056000, statut: 'brouillon' }
    ];

    const result = buildEnsureWeeklySheetActions({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheets: existingSheets,
      entries: mockEntries,
      linkOrphanEntries: true
    });

    expect(result.created).toBe(false);
    expect(result.sheetId).toBe(50);
    expect(result.actions).toHaveLength(2); // 2 UpdateRecord pour les entrées
    expect(result.actions[0][0]).toBe('UpdateRecord');
    expect(result.actions[0][1]).toBe('TimeEntries');
    expect(result.linkPlan).not.toBe(null);
    expect(result.linkPlan.links).toHaveLength(2);
  });

  test('devrait échouer en cas de doublon', () => {
    const duplicateSheets = [
      { id: 50, membre: 20, semaine: 1753056000, statut: 'brouillon' },
      { id: 51, membre: 20, semaine: 1753056000, statut: 'soumis' }
    ];

    const result = buildEnsureWeeklySheetActions({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheets: duplicateSheets,
      entries: [],
      linkOrphanEntries: false
    });

    expect(result.error).toBe('DUPLICATE_WEEKLY_SHEET');
    expect(result.actions).toHaveLength(0);
  });

  test('devrait échouer en cas de conflit de rattachement', () => {
    const existingSheets = [
      { id: 50, membre: 20, semaine: 1753056000, statut: 'brouillon' }
    ];

    const conflictingEntries = [
      { id: 101, membre: 20, date: 1753056000, heures: 2, feuille: 99 } // Liée à une autre feuille
    ];

    const result = buildEnsureWeeklySheetActions({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheets: existingSheets,
      entries: conflictingEntries,
      linkOrphanEntries: true
    });

    expect(result.error).toBe('ENTRY_LINK_CONFLICT');
    expect(result.conflicts).not.toBe(undefined);
  });

  test('devrait retourner une erreur si membre invalide', () => {
    const result = buildEnsureWeeklySheetActions({
      memberId: null,
      weekStartIso: '2025-07-21',
      sheets: mockSheets
    });

    expect(result.error).toBe('INVALID_MEMBER_ID');
  });

  test('devrait retourner une erreur si semaine invalide', () => {
    const result = buildEnsureWeeklySheetActions({
      memberId: 20,
      weekStartIso: null,
      sheets: mockSheets
    });

    expect(result.error).toBe('INVALID_WEEK');
  });
});

// ============================================================================
// TESTS : NON-MUTATION
// ============================================================================

describe('Non-mutation des tableaux reçus', () => {
  test('buildOrphanEntryLinkPlan ne devrait pas muter les entrées', () => {
    const entries = [
      { id: 101, membre: 20, date: 1753056000, heures: 2, feuille: null }
    ];

    const entriesCopy = JSON.parse(JSON.stringify(entries));

    buildOrphanEntryLinkPlan({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheetId: 50,
      entries
    });

    expect(entries).toEqual(entriesCopy);
  });

  test('resolveWeeklySheetState ne devrait pas muter les feuilles', () => {
    const sheets = [
      { id: 1, membre: 20, semaine: 1753056000, statut: 'brouillon' }
    ];

    const sheetsCopy = JSON.parse(JSON.stringify(sheets));

    resolveWeeklySheetState({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheets
    });

    expect(sheets).toEqual(sheetsCopy);
  });

  test('buildEntryLinkActions ne devrait pas muter les liens', () => {
    const links = [
      { entryId: 103, sheetId: 50 },
      { entryId: 101, sheetId: 50 }
    ];

    const linksCopy = JSON.parse(JSON.stringify(links));

    buildEntryLinkActions(links);

    expect(links).toEqual(linksCopy);
  });
});

// ============================================================================
// TESTS : ORDRE DÉTERMINISTE
// ============================================================================

describe('Ordre déterministe des actions', () => {
  test('buildEntryLinkActions devrait trier par entryId', () => {
    const links = [
      { entryId: 105, sheetId: 50 },
      { entryId: 101, sheetId: 50 },
      { entryId: 103, sheetId: 50 },
      { entryId: 102, sheetId: 50 }
    ];

    const result = buildEntryLinkActions(links);

    expect(result.map(a => a[2])).toEqual([101, 102, 103, 105]);
  });

  test('buildOrphanEntryLinkPlan devrait trier les liens par entryId', () => {
    const entries = [
      { id: 105, membre: 20, date: 1753056000, heures: 2, feuille: null },
      { id: 101, membre: 20, date: 1753056000, heures: 3, feuille: null },
      { id: 103, membre: 20, date: 1753056000, heures: 1, feuille: null }
    ];

    const result = buildOrphanEntryLinkPlan({
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheetId: 50,
      entries
    });

    expect(result.links.map(l => l.entryId)).toEqual([101, 103, 105]);
  });
});
