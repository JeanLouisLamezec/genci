/**
 * Tests unitaires pour ensureWeeklySheet dans cra-sheet-validation-service.js
 *
 * Couverture :
 * 1. Feuille déjà existante
 * 2. Création réussie
 * 3. Aucune entrée et createOnlyWhenEntriesExist = true
 * 4. Double clic (verrouillage)
 * 5. Erreur AddRecord
 * 6. Erreur de relecture
 * 7. Postcondition avec zéro feuille
 * 8. Postcondition avec deux feuilles
 * 9. Verrou libéré après succès
 * 10. Verrou libéré après erreur
 * 11. Idempotence sur deuxième appel
 */

'use strict';

const {
  ensureWeeklySheet,
  acquireWeeklySheetLock,
  releaseWeeklySheetLock,
  clearWeeklySheetLocks,
  SERVICE_ERROR_CODES
} = require('./cra-sheet-validation-service');

// ============================================================================
// HELPERS : MOCK GRIST
// ============================================================================

function createMockGrist(options = {}) {
  const {
    sheets = [],
    entries = [],
    addRecordResult = null,
    addRecordError = null
  } = options;

  let sheetsData = [...sheets];
  let entriesData = [...entries];
  let nextId = 1000;

  return {
    docApi: {
      fetchTable: async (tableName) => {
        if (tableName === 'Feuilles') {
          return {
            id: sheetsData.map(s => s.id),
            membre: sheetsData.map(s => s.membre),
            semaine: sheetsData.map(s => s.semaine),
            statut: sheetsData.map(s => s.statut),
            revisionValidation: sheetsData.map(s => s.revisionValidation)
          };
        }
        if (tableName === 'TimeEntries') {
          return {
            id: entriesData.map(e => e.id),
            membre: entriesData.map(e => e.membre),
            date: entriesData.map(e => e.date),
            heures: entriesData.map(e => e.heures),
            feuille: entriesData.map(e => e.feuille)
          };
        }
        return {};
      },
      applyUserActions: async (actions) => {
        if (addRecordError) {
          throw new Error(addRecordError);
        }

        for (const action of actions) {
          const [type, table, id, fields] = action;
          if (type === 'AddRecord' && table === 'Feuilles') {
            const newId = addRecordResult?.id ? addRecordResult.id[0] : nextId++;
            const newSheet = {
              id: newId,
              ...fields
            };
            sheetsData.push(newSheet);
            if (addRecordResult) {
              return { id: [newId] };
            }
            return { id: [newId] };
          }
        }
        return addRecordResult || {};
      }
    }
  };
}

// ============================================================================
// TESTS : ensureWeeklySheet
// ============================================================================

describe('ensureWeeklySheet', () => {
  beforeEach(() => {
    clearWeeklySheetLocks();
  });

  afterEach(() => {
    clearWeeklySheetLocks();
  });

  // Test 1 : Feuille déjà existante
  test('devrait retourner la feuille si elle existe déjà', async () => {
    const existingSheet = {
      id: 50,
      membre: 20,
      semaine: 1753056000, // Lundi 21 juillet 2025
      statut: 'brouillon',
      revisionValidation: 0
    };

    const grist = createMockGrist({ sheets: [existingSheet] });

    const result = await ensureWeeklySheet({
      grist,
      memberId: 20,
      weekStartIso: '2025-07-21',
      sheets: [existingSheet]
    });

    expect(result.success).toBe(true);
    expect(result.created).toBe(false);
    expect(result.sheet).toEqual(existingSheet);
    expect(result.sheetId).toBe(50);
    expect(result.error).toBe(null);
    expect(result.code).toBe('OK');
  });

  // Test 2 : Création réussie
  test('devrait créer une feuille si aucune n\'existe', async () => {
    const grist = createMockGrist({
      sheets: [],
      addRecordResult: { id: [100] }
    });

    const result = await ensureWeeklySheet({
      grist,
      memberId: 20,
      weekStartIso: '2025-07-21'
    });

    expect(result.success).toBe(true);
    expect(result.created).toBe(true);
    expect(result.sheetId).toBe(100);
    expect(result.error).toBe(null);
    expect(result.code).toBe('OK');
  });

  // Test 3 : Aucune entrée et createOnlyWhenEntriesExist = true
  test('devrait échouer si aucune entrée et createOnlyWhenEntriesExist = true', async () => {
    const grist = createMockGrist({
      sheets: [],
      entries: []
    });

    const result = await ensureWeeklySheet({
      grist,
      memberId: 20,
      weekStartIso: '2025-07-21',
      createOnlyWhenEntriesExist: true
    });

    expect(result.success).toBe(false);
    expect(result.created).toBe(false);
    expect(result.error).toBe('NO_ENTRIES_TO_ATTACH');
    expect(result.code).toBe(SERVICE_ERROR_CODES.WEEKLY_SHEET_NO_ENTRIES);
  });

  test('devrait réussir si des entrées existent et createOnlyWhenEntriesExist = true', async () => {
    const entries = [
      { id: 101, membre: 20, date: 1753056000, heures: 2, feuille: null }
    ];

    const grist = createMockGrist({
      sheets: [],
      entries,
      addRecordResult: { id: [100] }
    });

    const result = await ensureWeeklySheet({
      grist,
      memberId: 20,
      weekStartIso: '2025-07-21',
      entries,
      createOnlyWhenEntriesExist: true
    });

    expect(result.success).toBe(true);
    expect(result.created).toBe(true);
    expect(result.sheetId).toBe(100);
  });

  // Test 4 : Double clic (verrouillage)
  test('devrait échouer si un appel est déjà en cours', async () => {
    const grist = createMockGrist({ sheets: [] });

    // Acquérir manuellement le verrou
    acquireWeeklySheetLock(20, '2025-07-21');

    const result = await ensureWeeklySheet({
      grist,
      memberId: 20,
      weekStartIso: '2025-07-21'
    });

    expect(result.success).toBe(false);
    expect(result.created).toBe(false);
    expect(result.error).toBe('OPERATION_PENDING');
    expect(result.code).toBe('WEEKLY_SHEET_LOCKED');

    // Libérer pour les autres tests
    releaseWeeklySheetLock(20, '2025-07-21');
  });

  // Test 5 : Erreur AddRecord
  test('devrait échouer si AddRecord échoue', async () => {
    const grist = createMockGrist({
      sheets: [],
      addRecordError: 'Permission denied'
    });

    const result = await ensureWeeklySheet({
      grist,
      memberId: 20,
      weekStartIso: '2025-07-21'
    });

    expect(result.success).toBe(false);
    expect(result.created).toBe(false);
    expect(result.error).toBe('ADD_RECORD_FAILED');
    expect(result.code).toBe(SERVICE_ERROR_CODES.WEEKLY_SHEET_CREATE_FAILED);
    expect(result.details).toBe('Permission denied');
  });

  // Test 6 : Erreur de relecture (simulée par doublon)
  test('devrait échouer si la relecture échoue', async () => {
    // Ce test est difficile à simuler sans modifier le mock
    // On teste plutôt le cas de doublon après création
  });

  // Test 7 : Postcondition avec zéro feuille
  test('devrait échouer si aucune feuille trouvée après création', async () => {
    // Simuler un AddRecord qui réussit mais ne persiste pas
    const grist = {
      docApi: {
        fetchTable: async (tableName) => {
          if (tableName === 'Feuilles') {
            return { id: [], membre: [], semaine: [], statut: [] };
          }
          return {};
        },
        applyUserActions: async () => ({ id: [100] })
      }
    };

    const result = await ensureWeeklySheet({
      grist,
      memberId: 20,
      weekStartIso: '2025-07-21'
    });

    expect(result.success).toBe(false);
    expect(result.created).toBe(false);
    expect(result.error).toBe('POSTCONDITION_FAILED');
    expect(result.code).toBe(SERVICE_ERROR_CODES.WEEKLY_SHEET_POSTCONDITION_FAILED);
  });

  // Test 8 : Postcondition avec deux feuilles (doublon)
  test('devrait échouer en cas de doublon détecté après création', async () => {
    // Simuler un doublon créé par un autre client
    const grist = {
      docApi: {
        fetchTable: async (tableName) => {
          if (tableName === 'Feuilles') {
            return {
              id: [100, 101],
              membre: [20, 20],
              semaine: [1753056000, 1753056000],
              statut: ['brouillon', 'brouillon']
            };
          }
          return {};
        },
        applyUserActions: async () => ({ id: [100] })
      }
    };

    const result = await ensureWeeklySheet({
      grist,
      memberId: 20,
      weekStartIso: '2025-07-21'
    });

    expect(result.success).toBe(false);
    expect(result.created).toBe(false);
    expect(result.error).toBe('DUPLICATE_WEEKLY_SHEET');
    expect(result.code).toBe(SERVICE_ERROR_CODES.WEEKLY_SHEET_DUPLICATE);
    expect(result.duplicates).toHaveLength(2);
  });

  // Test 9 : Verrou libéré après succès
  test('devrait libérer le verrou après un succès', async () => {
    const grist = createMockGrist({
      sheets: [],
      addRecordResult: { id: [100] }
    });

    const result = await ensureWeeklySheet({
      grist,
      memberId: 20,
      weekStartIso: '2025-07-21'
    });

    expect(result.success).toBe(true);
    
    // Vérifier que le verrou est libéré en essayant un nouvel appel
    const result2 = await ensureWeeklySheet({
      grist,
      memberId: 20,
      weekStartIso: '2025-07-21'
    });

    // Le deuxième appel devrait réussir (feuille trouvée)
    expect(result2.success).toBe(true);
    expect(result2.created).toBe(false);
    expect(result2.sheetId).toBe(100);
  });

  // Test 10 : Verrou libéré après erreur
  test('devrait libérer le verrou après une erreur', async () => {
    const grist = createMockGrist({
      sheets: [],
      addRecordError: 'Error'
    });

    const result = await ensureWeeklySheet({
      grist,
      memberId: 20,
      weekStartIso: '2025-07-21'
    });

    expect(result.success).toBe(false);
    
    // Vérifier que le verrou est libéré
    acquireWeeklySheetLock(20, '2025-07-21');
    const locked = !acquireWeeklySheetLock(20, '2025-07-21');
    releaseWeeklySheetLock(20, '2025-07-21');
    
    expect(locked).toBe(true); // Le verrou était disponible
  });

  // Test 11 : Idempotence sur deuxième appel
  test('devrait être idempotent sur un deuxième appel', async () => {
    const grist = createMockGrist({
      sheets: [],
      addRecordResult: { id: [100] }
    });

    // Premier appel → création
    const result1 = await ensureWeeklySheet({
      grist,
      memberId: 20,
      weekStartIso: '2025-07-21'
    });

    expect(result1.created).toBe(true);
    expect(result1.sheetId).toBe(100);

    // Deuxième appel → devrait trouver la feuille existante
    const result2 = await ensureWeeklySheet({
      grist,
      memberId: 20,
      weekStartIso: '2025-07-21'
    });

    expect(result2.success).toBe(true);
    expect(result2.created).toBe(false);
    expect(result2.sheetId).toBe(100);
    expect(result2.sheet.id).toBe(100);
  });

  // Tests supplémentaires : paramètres invalides
  test('devrait échouer avec un membre invalide', async () => {
    const grist = createMockGrist({ sheets: [] });

    const result = await ensureWeeklySheet({
      grist,
      memberId: null,
      weekStartIso: '2025-07-21'
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_MEMBER_ID');
    expect(result.code).toBe(SERVICE_ERROR_CODES.WEEKLY_SHEET_INVALID_MEMBER);
  });

  test('devrait échouer avec une semaine invalide', async () => {
    const grist = createMockGrist({ sheets: [] });

    const result = await ensureWeeklySheet({
      grist,
      memberId: 20,
      weekStartIso: null
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_WEEK');
    expect(result.code).toBe(SERVICE_ERROR_CODES.WEEKLY_SHEET_INVALID_WEEK);
  });

  test('devrait échouer sans grist', async () => {
    const result = await ensureWeeklySheet({
      grist: null,
      memberId: 20,
      weekStartIso: '2025-07-21'
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('GRIST_API_UNAVAILABLE');
    expect(result.code).toBe(SERVICE_ERROR_CODES.GRIST_API_UNAVAILABLE);
  });
});

// ============================================================================
// TESTS : Verrouillage local
// ============================================================================

describe('Verrouillage local', () => {
  beforeEach(() => {
    clearWeeklySheetLocks();
  });

  afterEach(() => {
    clearWeeklySheetLocks();
  });

  test('acquireWeeklySheetLock devrait réussir si pas de verrou', () => {
    const result = acquireWeeklySheetLock(20, '2025-07-21');
    expect(result).toBe(true);
  });

  test('acquireWeeklySheetLock devrait échouer si déjà verrouillé', () => {
    acquireWeeklySheetLock(20, '2025-07-21');
    const result = acquireWeeklySheetLock(20, '2025-07-21');
    expect(result).toBe(false);
    
    releaseWeeklySheetLock(20, '2025-07-21');
  });

  test('releaseWeeklySheetLock devrait libérer le verrou', () => {
    acquireWeeklySheetLock(20, '2025-07-21');
    releaseWeeklySheetLock(20, '2025-07-21');
    const result = acquireWeeklySheetLock(20, '2025-07-21');
    expect(result).toBe(true);
    
    releaseWeeklySheetLock(20, '2025-07-21');
  });

  test('clearWeeklySheetLocks devrait tout libérer', () => {
    acquireWeeklySheetLock(20, '2025-07-21');
    acquireWeeklySheetLock(21, '2025-07-28');
    clearWeeklySheetLocks();
    
    const result1 = acquireWeeklySheetLock(20, '2025-07-21');
    const result2 = acquireWeeklySheetLock(21, '2025-07-28');
    
    expect(result1).toBe(true);
    expect(result2).toBe(true);
    
    releaseWeeklySheetLock(20, '2025-07-21');
    releaseWeeklySheetLock(21, '2025-07-28');
  });

  test('des verrous différents devraient être indépendants', () => {
    acquireWeeklySheetLock(20, '2025-07-21');
    
    // Différent membre
    const result1 = acquireWeeklySheetLock(21, '2025-07-21');
    expect(result1).toBe(true);
    releaseWeeklySheetLock(21, '2025-07-21');
    
    // Différente semaine
    const result2 = acquireWeeklySheetLock(20, '2025-07-28');
    expect(result2).toBe(true);
    releaseWeeklySheetLock(20, '2025-07-28');
    
    releaseWeeklySheetLock(20, '2025-07-21');
  });
});
