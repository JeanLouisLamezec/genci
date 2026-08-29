/**
 * CRA Sheet Validation Service - Service transactionnel pour le workflow des feuilles de temps
 *
 * CONTRAT DE SÉCURITÉ :
 * 1. Double lecture systématique avant écriture
 * 2. TOUTES les décisions sont re-construites depuis le snapshot 2 si changement
 * 3. La validation fonctionnelle est re-exécutée sur snapshot 2 si changement
 * 4. L'empreinte inclut : feuille, timeEntries, allMemberWeekEntries, directManagerId
 * 5. Capacités réelles depuis MemberDailyCapacities
 * 6. Vérification post-écriture complète avec snapshot 3 (après écriture)
 * 7. Le champ `after` retourné est TOUJOURS le snapshot 3
 *
 * @module core/cra/cra-sheet-validation-service
 */

'use strict';

const workflow = require('./cra-sheet-workflow');
const timesheetValidator = require('../../timesheets/timesheet-validator');
const weeklySheet = require('./cra-weekly-sheet');

const SERVICE_ERROR_CODES = {
  GRIST_API_UNAVAILABLE: 'GRIST_API_UNAVAILABLE',
  ACTOR_NOT_IDENTIFIED: 'ACTOR_NOT_IDENTIFIED',
  SHEET_ID_INVALID: 'SHEET_ID_INVALID',
  SHEET_NOT_FOUND: 'SHEET_NOT_FOUND',
  TIMESHEET_VALIDATOR_UNAVAILABLE: 'TIMESHEET_VALIDATOR_UNAVAILABLE',
  TIMESHEET_VALIDATION_ERROR: 'TIMESHEET_VALIDATION_ERROR',
  TIMESHEET_VALIDATION_FAILED: 'TIMESHEET_VALIDATION_FAILED',
  WORKFLOW_STATE_CHANGED: 'WORKFLOW_STATE_CHANGED',
  WORKFLOW_APPLY_FAILED: 'WORKFLOW_APPLY_FAILED',
  WORKFLOW_POSTCONDITION_FAILED: 'WORKFLOW_POSTCONDITION_FAILED',
  TIME_ENTRY_SCOPE_INCOMPLETE: 'TIME_ENTRY_SCOPE_INCOMPLETE',
  WEEKLY_SHEET_DUPLICATE: 'WEEKLY_SHEET_DUPLICATE',
  WEEKLY_SHEET_CREATE_FAILED: 'WEEKLY_SHEET_CREATE_FAILED',
  WEEKLY_SHEET_POSTCONDITION_FAILED: 'WEEKLY_SHEET_POSTCONDITION_FAILED',
  WEEKLY_SHEET_INVALID_MEMBER: 'WEEKLY_SHEET_INVALID_MEMBER',
  WEEKLY_SHEET_INVALID_WEEK: 'WEEKLY_SHEET_INVALID_WEEK',
  WEEKLY_SHEET_NO_ENTRIES: 'WEEKLY_SHEET_NO_ENTRIES'
};

// ============================================================================
// VERROUILLAGE LOCAL (concurrence intra-widget)
// ============================================================================

const weeklySheetLocks = new Map();

function acquireWeeklySheetLock(memberId, weekStartIso) {
  const key = `${memberId}:${weekStartIso}`;
  if (weeklySheetLocks.has(key)) {
    return false;
  }
  weeklySheetLocks.set(key, true);
  return true;
}

function releaseWeeklySheetLock(memberId, weekStartIso) {
  const key = `${memberId}:${weekStartIso}`;
  weeklySheetLocks.delete(key);
}

function clearWeeklySheetLocks() {
  weeklySheetLocks.clear();
}

// ============================================================================
// HELPERS
// ============================================================================

function validateCommonParams(params) {
  const { grist, sheetId, actorMemberId } = params || {};

  if (!grist || !grist.docApi || !grist.docApi.fetchTable || !grist.docApi.applyUserActions) {
    return { valid: false, code: SERVICE_ERROR_CODES.GRIST_API_UNAVAILABLE };
  }

  const normalizedSheetId = workflow.normalizeMemberId(sheetId);
  if (normalizedSheetId === null) {
    return { valid: false, code: SERVICE_ERROR_CODES.SHEET_ID_INVALID };
  }

  const normalizedActorId = workflow.normalizeMemberId(actorMemberId);
  if (normalizedActorId === null) {
    return { valid: false, code: SERVICE_ERROR_CODES.ACTOR_NOT_IDENTIFIED };
  }

  return { valid: true, sheetId: normalizedSheetId, actorId: normalizedActorId };
}

function validateTimestamp(nowUnixSeconds) {
  const check = workflow.validateUnixTimestamp(nowUnixSeconds);
  if (!check.valid) {
    return { valid: false, code: 'INVALID_NOW_UNIX_SECONDS' };
  }
  return { valid: true, value: check.value };
}

function columnarToRows(columnarData) {
  if (!columnarData || Array.isArray(columnarData)) return columnarData || [];
  const cols = Object.keys(columnarData);
  if (!cols.length) return [];
  const n = (columnarData[cols[0]] && columnarData[cols[0]].length) || 0;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const rec = {};
    for (const col of cols) {
      rec[col] = columnarData[col][i];
    }
    rows.push(rec);
  }
  return rows;
}

// ============================================================================
// SERVICE : ENSUREWEEKLYSHEET
// ============================================================================

/**
 * Assure l'existence d'une feuille hebdomadaire pour un membre et une semaine
 *
 * CONTRAT :
 * 1. Idempotent : plusieurs appels = même résultat
 * 2. Verrouillage local par clé memberId:weekStartIso
 * 3. Relecture post-création pour vérifier l'unicité
 * 4. Stratégie de repli : refetch + recherche si AddRecord ne retourne pas l'ID
 * 5. Bloque en cas de doublon détecté
 *
 * @param {Object} params - Paramètres
 * @param {Object} params.grist - API Grist
 * @param {number} params.memberId - ID du membre
 * @param {string} params.weekStartIso - Date de début de semaine (YYYY-MM-DD)
 * @param {Array} params.sheets - Snapshot des feuilles (optionnel, sera rechargé si absent)
 * @param {Array} params.entries - Snapshot des TimeEntries (optionnel)
 * @param {boolean} params.createOnlyWhenEntriesExist - Ne créer que si des entrées existent
 * @returns {Object} { success, created, sheet, sheetId, error, code }
 */
async function ensureWeeklySheet(params) {
  const { grist, memberId, weekStartIso, sheets, entries, createOnlyWhenEntriesExist = false } = params || {};

  // 1. Valider les paramètres de base
  if (!grist || !grist.docApi || !grist.docApi.fetchTable || !grist.docApi.applyUserActions) {
    return {
      success: false,
      created: false,
      sheet: null,
      sheetId: null,
      error: 'GRIST_API_UNAVAILABLE',
      code: SERVICE_ERROR_CODES.GRIST_API_UNAVAILABLE
    };
  }

  const normalizedMemberId = weeklySheet.normalizeMemberId(memberId);
  if (normalizedMemberId === null) {
    return {
      success: false,
      created: false,
      sheet: null,
      sheetId: null,
      error: 'INVALID_MEMBER_ID',
      code: SERVICE_ERROR_CODES.WEEKLY_SHEET_INVALID_MEMBER
    };
  }

  if (!weekStartIso || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartIso)) {
    return {
      success: false,
      created: false,
      sheet: null,
      sheetId: null,
      error: 'INVALID_WEEK',
      code: SERVICE_ERROR_CODES.WEEKLY_SHEET_INVALID_WEEK
    };
  }

  // 2. Vérifier le verrou local (concurrence intra-widget)
  if (!acquireWeeklySheetLock(normalizedMemberId, weekStartIso)) {
    return {
      success: false,
      created: false,
      sheet: null,
      sheetId: null,
      error: 'OPERATION_PENDING',
      code: 'WEEKLY_SHEET_LOCKED'
    };
  }

  try {
    // 3. Charger les feuilles si non fournies
    let allSheets = sheets;
    if (!allSheets) {
      const sheetsData = await grist.docApi.fetchTable('Feuilles');
      allSheets = columnarToRows(sheetsData);
    }

    // 4. Résoudre l'état de la feuille
    const resolution = weeklySheet.resolveWeeklySheetState({
      memberId: normalizedMemberId,
      weekStartIso,
      sheets: allSheets
    });

    if (resolution.status === 'FOUND') {
      // Feuille déjà existante → succès immédiat
      return {
        success: true,
        created: false,
        sheet: resolution.sheet,
        sheetId: resolution.sheetId,
        error: null,
        code: 'OK'
      };
    }

    if (resolution.status === 'DUPLICATE_WEEKLY_SHEET') {
      // Doublon → échec bloquant
      return {
        success: false,
        created: false,
        sheet: null,
        sheetId: null,
        error: 'DUPLICATE_WEEKLY_SHEET',
        code: SERVICE_ERROR_CODES.WEEKLY_SHEET_DUPLICATE,
        duplicates: resolution.duplicates
      };
    }

    if (resolution.status === 'CREATION_REQUIRED') {
      // 5. Vérifier si des entrées existent (si createOnlyWhenEntriesExist = true)
      if (createOnlyWhenEntriesExist) {
        let allEntries = entries;
        if (!allEntries) {
          const entriesData = await grist.docApi.fetchTable('TimeEntries');
          allEntries = columnarToRows(entriesData);
        }

        const memberWeekEntries = weeklySheet.findEntriesForMemberWeek({
          memberId: normalizedMemberId,
          weekStartIso,
          entries: allEntries
        });

        if (memberWeekEntries.length === 0) {
          // Aucune entrée → ne pas créer de feuille vide
          return {
            success: false,
            created: false,
            sheet: null,
            sheetId: null,
            error: 'NO_ENTRIES_TO_ATTACH',
            code: SERVICE_ERROR_CODES.WEEKLY_SHEET_NO_ENTRIES
          };
        }
      }

      // 6. Créer la feuille
      const creationActions = weeklySheet.buildSheetCreationActions(resolution.creationFields);
      
      let addResult;
      try {
        addResult = await grist.docApi.applyUserActions(creationActions);
      } catch (e) {
        return {
          success: false,
          created: false,
          sheet: null,
          sheetId: null,
          error: 'ADD_RECORD_FAILED',
          code: SERVICE_ERROR_CODES.WEEKLY_SHEET_CREATE_FAILED,
          details: e.message
        };
      }

      // 7. Récupérer l'ID créé
      // Stratégie 1 : Essayer d'extraire l'ID du retour de applyUserActions
      // Le format typique est : { id: [123] } pour un AddRecord
      let createdSheetId = null;
      if (addResult && addResult.id && Array.isArray(addResult.id) && addResult.id.length > 0) {
        createdSheetId = weeklySheet.normalizeMemberId(addResult.id[0]);
      }

      // 8. Relecture post-création pour vérifier l'unicité
      const refreshSheetsData = await grist.docApi.fetchTable('Feuilles');
      const refreshSheets = columnarToRows(refreshSheetsData);

      const postResolution = weeklySheet.resolveWeeklySheetState({
        memberId: normalizedMemberId,
        weekStartIso,
        sheets: refreshSheets
      });

      if (postResolution.status === 'DUPLICATE_WEEKLY_SHEET') {
        // Doublon détecté après création (concurrence inter-clients)
        return {
          success: false,
          created: false,
          sheet: null,
          sheetId: null,
          error: 'DUPLICATE_AFTER_CREATE',
          code: SERVICE_ERROR_CODES.WEEKLY_SHEET_DUPLICATE,
          duplicates: postResolution.duplicates
        };
      }

      if (postResolution.status !== 'FOUND') {
        // Feuille introuvable après création → postcondition échouée
        return {
          success: false,
          created: false,
          sheet: null,
          sheetId: null,
          error: 'POSTCONDITION_FAILED',
          code: SERVICE_ERROR_CODES.WEEKLY_SHEET_POSTCONDITION_FAILED
        };
      }

      // Succès : feuille créée et vérifiée
      return {
        success: true,
        created: true,
        sheet: postResolution.sheet,
        sheetId: postResolution.sheetId,
        error: null,
        code: 'OK'
      };
    }

    // Cas inattendu
    return {
      success: false,
      created: false,
      sheet: null,
      sheetId: null,
      error: 'UNEXPECTED_RESOLUTION_STATUS',
      code: 'WEEKLY_SHEET_UNKNOWN_ERROR',
      status: resolution.status
    };

  } finally {
    // 9. Libérer le verrou
    releaseWeeklySheetLock(normalizedMemberId, weekStartIso);
  }
}

// ============================================================================
// SNAPSHOT
// ============================================================================

async function loadWorkflowSnapshot(grist, sheetId) {
  const [teamData, sheetsData, entriesData, capacitiesData] = await Promise.all([
    grist.docApi.fetchTable('Team'),
    grist.docApi.fetchTable('Feuilles'),
    grist.docApi.fetchTable('TimeEntries'),
    grist.docApi.fetchTable('MemberDailyCapacities')
  ]);

  const team = columnarToRows(teamData);
  const sheets = columnarToRows(sheetsData);
  const allEntries = columnarToRows(entriesData);
  const allCapacities = columnarToRows(capacitiesData);

  const normalizedSheetId = workflow.normalizeMemberId(sheetId);
  const sheet = sheets.find(s => workflow.normalizeMemberId(s.id) === normalizedSheetId) || null;

  if (!sheet) {
    const error = new Error('Feuille non trouvée');
    error.code = SERVICE_ERROR_CODES.SHEET_NOT_FOUND;
    throw error;
  }

  const sheetMemberId = workflow.normalizeMemberId(sheet.membre);
  const sheetWeekIso = workflow.getWeekStartIso(sheet.semaine);

  // TimeEntries rattachées à CETTE feuille
  const timeEntries = allEntries.filter(e => {
    const entrySheetId = workflow.normalizeMemberId(e.feuille);
    return entrySheetId === normalizedSheetId;
  });

  // TOUTES les entrées du membre pour cette semaine (pour détecter hors scope)
  const allMemberWeekEntries = allEntries.filter(e => {
    const entryMemberId = workflow.normalizeMemberId(e.membre);
    const entryWeekIso = workflow.getWeekStartIso(e.date);
    return entryMemberId === sheetMemberId && entryWeekIso === sheetWeekIso;
  });

  // Capacités du membre pour cette semaine
  const weekDates = [];
  const monday = new Date(sheetWeekIso);
  for (let i = 0; i < 5; i++) {
    const date = new Date(monday);
    date.setUTCDate(date.getUTCDate() + i);
    weekDates.push(workflow.formatDateUTC(date));
  }

  const memberCapacities = allCapacities.filter(cap => {
    const capMemberId = workflow.normalizeMemberId(cap.membre);
    const capDate = workflow.gristDateToIso(cap.date);
    return capMemberId === sheetMemberId && weekDates.includes(capDate);
  }).map(cap => ({
    id: workflow.normalizeMemberId(cap.id),
    membre: workflow.normalizeMemberId(cap.membre),
    date: workflow.gristDateToIso(cap.date),
    capaciteDisponible: cap.capaciteDisponible,
    capaciteTheorique: cap.capaciteTheorique
  }));

  // Manager direct actuel
  const directManagerId = workflow.getDirectManagerId(sheetMemberId, team);

  timeEntries.sort((a, b) => {
    const idA = workflow.normalizeMemberId(a.id) || 0;
    const idB = workflow.normalizeMemberId(b.id) || 0;
    return idA - idB;
  });

  const fingerprint = buildFingerprint(sheet, timeEntries, allMemberWeekEntries, directManagerId, memberCapacities);

  return {
    team,
    sheets,
    sheet,
    timeEntries,
    allMemberWeekEntries,
    memberCapacities,
    directManagerId,
    fingerprint
  };
}

function buildFingerprint(sheet, timeEntries, allMemberWeekEntries, directManagerId, memberCapacities) {
  const sheetData = {
    id: workflow.normalizeMemberId(sheet.id),
    membre: workflow.normalizeMemberId(sheet.membre),
    semaine: sheet.semaine,
    statut: sheet.statut,
    responsableValidation: workflow.normalizeMemberId(sheet.responsableValidation),
    soumisPar: workflow.normalizeMemberId(sheet.soumisPar),
    dateSoumission: sheet.dateSoumission,
    revisionValidation: workflow.normalizeRevision(sheet.revisionValidation),
    validePar: workflow.normalizeMemberId(sheet.validePar),
    dateValidation: sheet.dateValidation,
    motifRejet: sheet.motifRejet,
    motifCorrection: sheet.motifCorrection
  };

  const entriesData = timeEntries.map(e => ({
    id: workflow.normalizeMemberId(e.id),
    membre: workflow.normalizeMemberId(e.membre),
    date: e.date,
    feuille: workflow.normalizeMemberId(e.feuille),
    tache: workflow.normalizeMemberId(e.tache),
    heures: e.heures,
    heuresPrevues: e.heuresPrevues
  }));

  // Hash des entrées HORS scope (même membre/semaine mais pas sur cette feuille)
  const otherEntries = allMemberWeekEntries.filter(e => {
    const entrySheetId = workflow.normalizeMemberId(e.feuille);
    return entrySheetId === null || entrySheetId !== workflow.normalizeMemberId(sheet.id);
  });
  const otherEntriesHash = otherEntries
    .map(e => workflow.normalizeMemberId(e.id) || 0)
    .sort((a, b) => a - b)
    .join(',');

  // Hash des capacités avec distinction entre null/'' et 0
  const capacitiesHash = (memberCapacities || [])
    .map(c => `${c.date}:${capacityFingerprintValue(c.capaciteDisponible)}:${capacityFingerprintValue(c.capaciteTheorique)}`)
    .sort()
    .join('|');

  return JSON.stringify({
    sheet: sheetData,
    timeEntries: entriesData,
    otherEntriesCount: otherEntries.length,
    otherEntriesHash,
    capacitiesHash,
    directManagerId
  });
}

function capacityFingerprintValue(value) {
  const normalized = normalizeCapacityValue(value);
  return normalized === null ? 'missing' : normalized;
}

// ============================================================================
// VALIDATION FONCTIONNELLE
// ============================================================================

async function loadRealCapacities(grist, memberId, weekStartIso) {
  try {
    const capacitiesData = await grist.docApi.fetchTable('MemberDailyCapacities');
    const capacities = columnarToRows(capacitiesData);

    const weekDates = [];
    const monday = new Date(weekStartIso);
    for (let i = 0; i < 5; i++) {
      const date = new Date(monday);
      date.setUTCDate(date.getUTCDate() + i);
      weekDates.push(workflow.formatDateUTC(date));
    }

    const memberCapacities = capacities.filter(cap => {
      const capMemberId = workflow.normalizeMemberId(cap.membre);
      const capDate = workflow.gristDateToIso(cap.date);
      return capMemberId === memberId && weekDates.includes(capDate);
    });

    return memberCapacities.map(cap => {
      const available = normalizeCapacityValue(cap.capaciteDisponible);
      const theoretical = normalizeCapacityValue(cap.capaciteTheorique);

      if (available === null && theoretical === null) {
        return {
          date: workflow.gristDateToIso(cap.date),
          availableCapacityHours: null,
          error: 'MISSING_CAPACITY'
        };
      }

      return {
        date: workflow.gristDateToIso(cap.date),
        availableCapacityHours: available !== null ? available : theoretical
      };
    });
  } catch (e) {
    return [];
  }
}

function normalizeCapacityValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }
  return number;
}

async function callFunctionalValidator(snapshot, grist) {
  const { sheet, timeEntries, memberCapacities } = snapshot;
  const sheetMemberId = workflow.normalizeMemberId(sheet.membre);
  const weekStartIso = workflow.getWeekStartIso(sheet.semaine);

  if (!weekStartIso) {
    return { 
      valid: false, 
      errors: [{ code: 'WEEK_INVALID', message: 'Semaine invalide' }], 
      warnings: [],
      isTechnicalError: false
    };
  }

  // Convertir les timeEntries pour le validateur
  const entries = [];
  for (const e of timeEntries) {
    const taskId = workflow.normalizeMemberId(e.tache);
    const date = workflow.gristDateToIso(e.date);

    // Une entrée sans tâche ou date valide est une erreur bloquante
    if (taskId === null) {
      return { 
        valid: false, 
        errors: [{ code: 'TASK_ID_INVALID', message: 'TimeEntry sans tâche valide' }], 
        warnings: [],
        isTechnicalError: false
      };
    }
    if (date === null) {
      return { 
        valid: false, 
        errors: [{ code: 'DATE_INVALID', message: 'TimeEntry sans date valide' }], 
        warnings: [],
        isTechnicalError: false
      };
    }

    entries.push({ taskId, date, actualHours: e.heures });
  }

  // Utiliser les capacités du snapshot (déjà chargées)
  const capacities = (memberCapacities || []).map(cap => {
    const available = normalizeCapacityValue(cap.capaciteDisponible);
    const theoretical = normalizeCapacityValue(cap.capaciteTheorique);

    if (available === null && theoretical === null) {
      return {
        date: cap.date,
        availableCapacityHours: null,
        error: 'MISSING_CAPACITY'
      };
    }

    return {
      date: cap.date || workflow.gristDateToIso(cap.date),
      availableCapacityHours: available !== null ? available : theoretical
    };
  });

  // Vérifier si des capacités sont manquantes
  const missingCapacity = capacities.find(c => c.availableCapacityHours === null);
  if (missingCapacity) {
    return {
      valid: false,
      errors: [{
        code: 'MISSING_CAPACITY',
        message: `Capacité manquante pour le ${missingCapacity.date}`,
        date: missingCapacity.date
      }],
      warnings: [],
      isTechnicalError: false
    };
  }

  try {
    if (!timesheetValidator || !timesheetValidator.validateTimesheet) {
      return {
        valid: false,
        errors: [{
          code: 'TIMESHEET_VALIDATOR_UNAVAILABLE',
          message: 'Validateur indisponible'
        }],
        warnings: [],
        isTechnicalError: true
      };
    }

    const result = timesheetValidator.validateTimesheet({
      memberId: sheetMemberId,
      weekStart: weekStartIso,
      entries,
      capacities,
      options: { allowWeekend: false }
    });

    return { 
      valid: result.valid, 
      errors: result.errors || [], 
      warnings: [],
      isTechnicalError: false
    };
  } catch (e) {
    return {
      valid: false,
      errors: [{
        code: 'TIMESHEET_VALIDATOR_ERROR',
        message: e.message || 'Erreur technique du validateur'
      }],
      warnings: [],
      isTechnicalError: true
    };
  }
}

// ============================================================================
// APPLICATION
// ============================================================================

async function applyWorkflowActions(grist, actions) {
  if (!actions || actions.length === 0) {
    throw Object.assign(new Error('Aucune action à appliquer'), { code: SERVICE_ERROR_CODES.WORKFLOW_APPLY_FAILED });
  }
  return await grist.docApi.applyUserActions(actions);
}

// ============================================================================
// VÉRIFICATION POST-ÉCRITURE
// ============================================================================

async function verifyTransitionResult(grist, sheetId, expectedStatus, expectedFields = {}) {
  const sheetsData = await grist.docApi.fetchTable('Feuilles');
  const sheets = columnarToRows(sheetsData);
  const normalizedSheetId = workflow.normalizeMemberId(sheetId);
  const sheet = sheets.find(s => workflow.normalizeMemberId(s.id) === normalizedSheetId);

  if (!sheet) {
    return { valid: false, reason: 'Feuille non trouvée après écriture', actual: null };
  }

  const actualStatus = workflow.normalizeSheetStatus(sheet.statut);
  const expectedNormalizedStatus = workflow.normalizeSheetStatus(expectedStatus);

  if (actualStatus !== expectedNormalizedStatus) {
    return { valid: false, reason: `Statut incorrect: attendu ${expectedNormalizedStatus}, obtenu ${actualStatus}`, actual: sheet };
  }

  for (const [field, expectedValue] of Object.entries(expectedFields)) {
    const actualValue = sheet[field];

    if (field === 'revisionValidation') {
      const actualRev = workflow.normalizeRevision(actualValue);
      const expectedRev = workflow.normalizeRevision(expectedValue);
      if (actualRev !== expectedRev) {
        return { valid: false, reason: `Champ ${field} incorrect: attendu ${expectedValue}, obtenu ${actualValue}`, actual: sheet };
      }
    } else if (field === 'dateSoumission' || field === 'dateValidation') {
      if (actualValue !== expectedValue) {
        return { valid: false, reason: `Champ ${field} incorrect: attendu ${expectedValue}, obtenu ${actualValue}`, actual: sheet };
      }
    } else if (field === 'motifRejet' || field === 'motifCorrection') {
      if (String(actualValue || '') !== String(expectedValue || '')) {
        return { valid: false, reason: `Champ ${field} incorrect: attendu "${expectedValue}", obtenu "${actualValue}"`, actual: sheet };
      }
    } else {
      const normalizedActual = workflow.normalizeMemberId(actualValue);
      const normalizedExpected = workflow.normalizeMemberId(expectedValue);
      if (normalizedActual !== normalizedExpected) {
        return { valid: false, reason: `Champ ${field} incorrect: attendu ${expectedValue}, obtenu ${actualValue}`, actual: sheet };
      }
    }
  }

  return { valid: true, actual: sheet };
}

// ============================================================================
// HELPER TRANSACTIONNEL CENTRAL
// ============================================================================

/**
 * Exécute une transition avec le protocole complet :
 * snapshot1 → décision1 → validation1 → snapshot2 → comparaison
 * → (si changement) re-validation2 + re-décision2 → application → snapshot3 → vérification
 */
async function executeTransition(params) {
  const {
    grist,
    sheetId,
    actorId,
    buildDecision,
    validateFunctional,
    verifyPostWrite,
    transitionName,
    userContext = null
  } = params;

  try {
    // === SNAPSHOT 1 ===
    const snapshot1 = await loadWorkflowSnapshot(grist, sheetId);

    // === VALIDATION 1 (si applicable) ===
    let validation1 = null;
    if (validateFunctional) {
      validation1 = await validateFunctional(snapshot1, grist);
      
      // Erreur technique (validateur absent, crash, etc.)
      if (validation1.isTechnicalError) {
        return {
          success: false,
          code: SERVICE_ERROR_CODES.TIMESHEET_VALIDATOR_UNAVAILABLE,
          reason: validation1.errors?.[0]?.message || 'Erreur technique du validateur',
          sheetId,
          transition: transitionName,
          diagnostics: { validatorError: validation1.errors }
        };
      }
      
      if (!validation1.valid) {
        return {
          success: false,
          code: SERVICE_ERROR_CODES.TIMESHEET_VALIDATION_FAILED,
          reason: 'Validation fonctionnelle échouée',
          sheetId,
          transition: transitionName,
          validation: validation1
        };
      }
    }

    // === DÉCISION 1 ===
    const decisionContext1 = { ...userContext, validationResult: validation1 };
    const decision1 = buildDecision(snapshot1, decisionContext1);

    if (!decision1.allowed || !decision1.can) {
      return {
        success: false,
        code: decision1.code,
        reason: decision1.reason,
        sheetId,
        transition: transitionName,
        actions: decision1.actions || []
      };
    }

    // === SNAPSHOT 2 ===
    const snapshot2 = await loadWorkflowSnapshot(grist, sheetId);

    // === COMPARAISON ET RE-CONSTRUCTION ===
    let finalDecision = decision1;
    let finalValidation = validation1;

    if (snapshot1.fingerprint !== snapshot2.fingerprint) {
      // RE-VALIDATION 2 (si applicable) - AVANT la re-décision
      if (validateFunctional) {
        finalValidation = await validateFunctional(snapshot2, grist);
        
        // Erreur technique
        if (finalValidation.isTechnicalError) {
          return {
            success: false,
            code: SERVICE_ERROR_CODES.TIMESHEET_VALIDATOR_UNAVAILABLE,
            reason: finalValidation.errors?.[0]?.message || 'Erreur technique du validateur',
            sheetId,
            transition: transitionName,
            before: snapshot1,
            after: snapshot2,
            diagnostics: { validatorError: finalValidation.errors }
          };
        }
        
        if (!finalValidation.valid) {
          return {
            success: false,
            code: SERVICE_ERROR_CODES.TIMESHEET_VALIDATION_FAILED,
            reason: 'Validation fonctionnelle échouée après changement d\'état',
            sheetId,
            transition: transitionName,
            validation: finalValidation,
            before: snapshot1,
            after: snapshot2
          };
        }
      }

      // RE-DÉCISION 2 - avec la re-validation
      const decisionContext2 = { ...userContext, validationResult: finalValidation };
      finalDecision = buildDecision(snapshot2, decisionContext2);

      if (!finalDecision.allowed || !finalDecision.can) {
        return {
          success: false,
          code: SERVICE_ERROR_CODES.WORKFLOW_STATE_CHANGED,
          reason: 'État modifié pendant la transaction - transition non autorisée',
          sheetId,
          transition: transitionName,
          before: snapshot1,
          after: snapshot2
        };
      }
    }

    // === APPLICATION ===
    await applyWorkflowActions(grist, finalDecision.actions);

    // === SNAPSHOT 3 (POST-ÉCRITURE) ===
    const snapshot3 = await loadWorkflowSnapshot(grist, sheetId);

    // === VÉRIFICATION ===
    const verifyResult = await verifyPostWrite(snapshot3, finalDecision, finalValidation, userContext);
    if (!verifyResult.valid) {
      return {
        success: false,
        code: SERVICE_ERROR_CODES.WORKFLOW_POSTCONDITION_FAILED,
        reason: verifyResult.reason,
        sheetId,
        transition: transitionName,
        diagnostics: { verificationFailed: true },
        before: snapshot1,
        after: snapshot3
      };
    }

    // === SUCCÈS ===
    return {
      success: true,
      code: 'OK',
      sheetId,
      transition: transitionName,
      actions: finalDecision.actions,
      appliedActions: finalDecision.actions.length,
      before: snapshot1,
      after: snapshot3,
      validation: finalValidation,
      summary: finalDecision.summary || {}
    };
  } catch (e) {
    if (e.code === SERVICE_ERROR_CODES.SHEET_NOT_FOUND) {
      return { success: false, code: e.code, reason: e.message, sheetId, transition: transitionName };
    }
    return {
      success: false,
      code: e.code || SERVICE_ERROR_CODES.WORKFLOW_APPLY_FAILED,
      reason: e.message,
      sheetId,
      transition: transitionName,
      diagnostics: { error: e.message }
    };
  }
}

// ============================================================================
// COMMANDES
// ============================================================================

async function submitSheet(params) {
  const { grist, actorMemberId, actorIsAdmin = false, sheetId, nowUnixSeconds } = params || {};
  const validation = validateCommonParams({ grist, sheetId, actorMemberId });
  if (!validation.valid) return { success: false, code: validation.code, sheetId, transition: 'submit' };

  const timestampCheck = validateTimestamp(nowUnixSeconds);
  if (!timestampCheck.valid) return { success: false, code: timestampCheck.code, sheetId, transition: 'submit' };

  return executeTransition({
    grist,
    sheetId,
    actorId: validation.actorId,
    transitionName: 'submit',
    userContext: { actorMemberId, actorIsAdmin, nowUnixSeconds: timestampCheck.value },
    buildDecision: (snapshot, context) => {
      const { actorMemberId, nowUnixSeconds } = context;

      // Vérifier TIME_ENTRY_SCOPE_INCOMPLETE sur CE snapshot
      const otherEntries = snapshot.allMemberWeekEntries.filter(e => {
        const entrySheetId = workflow.normalizeMemberId(e.feuille);
        return entrySheetId === null || entrySheetId !== workflow.normalizeMemberId(snapshot.sheet.id);
      });

      if (otherEntries.length > 0) {
        return {
          allowed: false,
          can: false,
          code: SERVICE_ERROR_CODES.TIME_ENTRY_SCOPE_INCOMPLETE,
          reason: 'Entrées hors scope détectées',
          actions: [],
          diagnostics: { otherEntriesCount: otherEntries.length }
        };
      }

      return workflow.buildSubmissionActions({
        actorMemberId,
        actorIsAdmin: context.actorIsAdmin,
        sheet: snapshot.sheet,
        team: snapshot.team,
        sheets: snapshot.sheets,
        timeEntries: snapshot.timeEntries,
        nowUnixSeconds
      });
    },
    validateFunctional: null,
    verifyPostWrite: (snapshot, decision, validation, userContext) => {
      const sheet = snapshot.sheet;
      if (sheet.dateSoumission == null || sheet.dateSoumission === '') {
        return { valid: false, reason: 'dateSoumission non renseigné', actual: sheet };
      }

      const sheetId = workflow.normalizeMemberId(sheet.id);

      // Vérifier qu'aucune entrée du membre/semaine n'est hors scope
      const outOfScope = snapshot.allMemberWeekEntries.filter(entry => {
        const entrySheetId = workflow.normalizeMemberId(entry.feuille);
        return entrySheetId !== sheetId;
      });

      if (outOfScope.length > 0) {
        return {
          valid: false,
          reason: `${outOfScope.length} entrée(s) hors scope détectée(s) après soumission`,
          actual: sheet,
          diagnostics: { outOfScopeCount: outOfScope.length }
        };
      }

      // Vérifier que toutes les entrées de la feuille ont des heures explicites
      const missingActual = snapshot.timeEntries.filter(entry => {
        return !workflow.hasExplicitActual(entry);
      });

      if (missingActual.length > 0) {
        return {
          valid: false,
          reason: `${missingActual.length} entrée(s) sans heures explicites`,
          actual: sheet,
          diagnostics: { missingActualCount: missingActual.length }
        };
      }

      const expectedManagerId = decision.summary?.managerId;
      const expectedDateSoumission = userContext?.nowUnixSeconds;
      return verifyTransitionResult(grist, snapshot.sheet.id, 'soumis', {
        responsableValidation: expectedManagerId,
        soumisPar: userContext?.actorMemberId,
        dateSoumission: expectedDateSoumission
      });
    }
  });
}

async function withdrawSheet(params) {
  const { grist, actorMemberId, actorIsAdmin = false, sheetId } = params || {};
  const validation = validateCommonParams({ grist, sheetId, actorMemberId });
  if (!validation.valid) return { success: false, code: validation.code, sheetId, transition: 'withdraw' };

  return executeTransition({
    grist,
    sheetId,
    actorId: validation.actorId,
    transitionName: 'withdraw',
    userContext: { actorMemberId, actorIsAdmin },
    buildDecision: (snapshot, context) => {
      return workflow.buildWithdrawActions({
        actorMemberId: context.actorMemberId,
        actorIsAdmin: context.actorIsAdmin,
        sheet: snapshot.sheet,
        sheets: snapshot.sheets
      });
    },
    validateFunctional: null,
    verifyPostWrite: (snapshot, decision) => {
      const sheet = snapshot.sheet;
      if (sheet.responsableValidation != null) {
        return { valid: false, reason: 'responsableValidation non effacé', actual: sheet };
      }
      if (sheet.soumisPar != null) {
        return { valid: false, reason: 'soumisPar non effacé', actual: sheet };
      }
      if (sheet.dateSoumission != null) {
        return { valid: false, reason: 'dateSoumission non effacée', actual: sheet };
      }
      return verifyTransitionResult(grist, snapshot.sheet.id, 'brouillon');
    }
  });
}

async function validateSheet(params) {
  const { grist, actorMemberId, actorIsAdmin = false, sheetId, nowUnixSeconds } = params || {};
  const validation = validateCommonParams({ grist, sheetId, actorMemberId });
  if (!validation.valid) return { success: false, code: validation.code, sheetId, transition: 'validate' };

  const timestampCheck = validateTimestamp(nowUnixSeconds);
  if (!timestampCheck.valid) return { success: false, code: timestampCheck.code, sheetId, transition: 'validate' };

  return executeTransition({
    grist,
    sheetId,
    actorId: validation.actorId,
    transitionName: 'validate',
    userContext: { actorMemberId, actorIsAdmin, nowUnixSeconds: timestampCheck.value },
    buildDecision: (snapshot, context) => {
      return workflow.buildValidationAction({
        actorMemberId: context.actorMemberId,
        actorIsAdmin: context.actorIsAdmin,
        sheet: snapshot.sheet,
        sheets: snapshot.sheets,
        validationResult: context.validationResult,
        nowUnixSeconds: context.nowUnixSeconds
      });
    },
    validateFunctional: callFunctionalValidator,
    verifyPostWrite: (snapshot, decision, validation, userContext) => {
      const sheet = snapshot.sheet;
      if (sheet.dateValidation == null || sheet.dateValidation === '') {
        return { valid: false, reason: 'dateValidation non renseigné', actual: sheet };
      }
      const expectedManager = workflow.normalizeMemberId(userContext?.actorMemberId);
      const expectedRevision = decision.summary?.revision;
      const expectedDateValidation = userContext?.nowUnixSeconds;
      return verifyTransitionResult(grist, snapshot.sheet.id, 'valide', {
        validePar: expectedManager,
        revisionValidation: expectedRevision,
        dateValidation: expectedDateValidation
      });
    }
  });
}

async function rejectSheet(params) {
  const { grist, actorMemberId, actorIsAdmin = false, sheetId, rejectReason } = params || {};
  const validation = validateCommonParams({ grist, sheetId, actorMemberId });
  if (!validation.valid) return { success: false, code: validation.code, sheetId, transition: 'reject' };

  if (!rejectReason || String(rejectReason).trim() === '') {
    return { success: false, code: 'MISSING_REJECT_REASON', sheetId, transition: 'reject' };
  }

  return executeTransition({
    grist,
    sheetId,
    actorId: validation.actorId,
    transitionName: 'reject',
    userContext: { actorMemberId, actorIsAdmin, rejectReason },
    buildDecision: (snapshot, context) => {
      return workflow.buildRejectionAction({
        actorMemberId: context.actorMemberId,
        actorIsAdmin: context.actorIsAdmin,
        sheet: snapshot.sheet,
        sheets: snapshot.sheets,
        rejectReason: context.rejectReason
      });
    },
    validateFunctional: null,
    verifyPostWrite: (snapshot, decision, validation, userContext) => {
      const expectedMotifRejet = userContext?.rejectReason?.trim();
      return verifyTransitionResult(grist, snapshot.sheet.id, 'rejete', {
        motifRejet: expectedMotifRejet
      });
    }
  });
}

async function openManagerCorrection(params) {
  const { grist, actorMemberId, actorIsAdmin = false, sheetId, correctionReason } = params || {};
  const validation = validateCommonParams({ grist, sheetId, actorMemberId });
  if (!validation.valid) return { success: false, code: validation.code, sheetId, transition: 'open_correction' };

  if (!correctionReason || String(correctionReason).trim() === '') {
    return { success: false, code: 'MISSING_CORRECTION_REASON', sheetId, transition: 'open_correction' };
  }

  return executeTransition({
    grist,
    sheetId,
    actorId: validation.actorId,
    transitionName: 'open_correction',
    userContext: { actorMemberId, actorIsAdmin, correctionReason },
    buildDecision: (snapshot, context) => {
      return workflow.buildOpenManagerCorrectionActions({
        actorMemberId: context.actorMemberId,
        actorIsAdmin: context.actorIsAdmin,
        sheet: snapshot.sheet,
        sheets: snapshot.sheets,
        correctionReason: context.correctionReason
      });
    },
    validateFunctional: null,
    verifyPostWrite: (snapshot, decision, validation, userContext) => {
      const expectedMotifCorrection = userContext?.correctionReason?.trim();
      return verifyTransitionResult(grist, snapshot.sheet.id, 'correction_manager', {
        motifCorrection: expectedMotifCorrection
      });
    }
  });
}

async function revalidateSheet(params) {
  const { grist, actorMemberId, actorIsAdmin = false, sheetId, nowUnixSeconds } = params || {};
  const validation = validateCommonParams({ grist, sheetId, actorMemberId });
  if (!validation.valid) return { success: false, code: validation.code, sheetId, transition: 'revalidate' };

  const timestampCheck = validateTimestamp(nowUnixSeconds);
  if (!timestampCheck.valid) return { success: false, code: timestampCheck.code, sheetId, transition: 'revalidate' };

  return executeTransition({
    grist,
    sheetId,
    actorId: validation.actorId,
    transitionName: 'revalidate',
    userContext: { actorMemberId, actorIsAdmin, nowUnixSeconds: timestampCheck.value },
    buildDecision: (snapshot, context) => {
      return workflow.buildRevalidationActions({
        actorMemberId: context.actorMemberId,
        actorIsAdmin: context.actorIsAdmin,
        sheet: snapshot.sheet,
        sheets: snapshot.sheets,
        validationResult: context.validationResult,
        nowUnixSeconds: context.nowUnixSeconds
      });
    },
    validateFunctional: callFunctionalValidator,
    verifyPostWrite: (snapshot, decision, validation, userContext) => {
      const expectedManager = workflow.normalizeMemberId(userContext?.actorMemberId);
      const expectedRevision = decision.summary?.revision;
      const expectedDateValidation = userContext?.nowUnixSeconds;
      return verifyTransitionResult(grist, snapshot.sheet.id, 'valide', {
        validePar: expectedManager,
        revisionValidation: expectedRevision,
        dateValidation: expectedDateValidation
      });
    }
  });
}

async function updateManagerActual(params) {
  const { grist, actorMemberId, actorIsAdmin = false, sheetId, timeEntryId, hours } = params || {};
  const validation = validateCommonParams({ grist, sheetId, actorMemberId });
  if (!validation.valid) return { success: false, code: validation.code, sheetId, transition: 'update_manager_actual' };

  // Validation des paramètres spécifiques
  const normalizedTimeEntryId = workflow.normalizeMemberId(timeEntryId);
  if (normalizedTimeEntryId === null) {
    return {
      success: false,
      code: 'TIME_ENTRY_ID_INVALID',
      sheetId,
      transition: 'update_manager_actual'
    };
  }

  if (hours === null || hours === undefined || hours === '') {
    return {
      success: false,
      code: 'ACTUAL_HOURS_INVALID',
      sheetId,
      transition: 'update_manager_actual'
    };
  }

  const numericHours = Number(hours);
  if (!Number.isFinite(numericHours) || numericHours < 0) {
    return {
      success: false,
      code: 'ACTUAL_HOURS_INVALID',
      sheetId,
      transition: 'update_manager_actual'
    };
  }

  try {
    // === SNAPSHOT 1 ===
    const snapshot1 = await loadWorkflowSnapshot(grist, sheetId);

    // === VÉRIFICATION 1 ===
    const timeEntry = snapshot1.timeEntries.find(e => {
      return workflow.normalizeMemberId(e.id) === normalizedTimeEntryId;
    });

    if (!timeEntry) {
      return {
        success: false,
        code: 'TIME_ENTRY_NOT_FOUND',
        sheetId,
        transition: 'update_manager_actual',
        diagnostics: { searchedId: normalizedTimeEntryId }
      };
    }

    // Vérifier que la TimeEntry appartient bien à cette feuille
    const entrySheetId = workflow.normalizeMemberId(timeEntry.feuille);
    const contextSheetId = workflow.normalizeMemberId(sheetId);
    if (entrySheetId !== contextSheetId) {
      return {
        success: false,
        code: 'TIME_ENTRY_SHEET_MISMATCH',
        sheetId,
        transition: 'update_manager_actual',
        diagnostics: { entrySheetId, contextSheetId }
      };
    }

    // === DÉCISION 1 ===
    const decision1 = workflow.buildManagerActualUpdateAction({
      actorMemberId,
      actorIsAdmin,
      sheet: snapshot1.sheet,
      timeEntry,
      hours: numericHours
    });

    if (!decision1.allowed || !decision1.can) {
      return {
        success: false,
        code: decision1.code,
        reason: decision1.reason,
        sheetId,
        transition: 'update_manager_actual',
        actions: decision1.actions || []
      };
    }

    // === SNAPSHOT 2 ===
    const snapshot2 = await loadWorkflowSnapshot(grist, sheetId);

    // === COMPARAISON ET RE-CONSTRUCTION ===
    let finalDecision = decision1;

    if (snapshot1.fingerprint !== snapshot2.fingerprint) {
      // Re-charger la TimeEntry depuis snapshot 2
      const timeEntry2 = snapshot2.timeEntries.find(e => {
        return workflow.normalizeMemberId(e.id) === normalizedTimeEntryId;
      });

      if (!timeEntry2) {
        return {
          success: false,
          code: 'WORKFLOW_STATE_CHANGED',
          reason: 'TimeEntry introuvable après changement d\'état',
          sheetId,
          transition: 'update_manager_actual',
          before: snapshot1,
          after: snapshot2
        };
      }

      // Re-vérifier l'appartenance à la feuille
      const entrySheetId2 = workflow.normalizeMemberId(timeEntry2.feuille);
      if (entrySheetId2 !== contextSheetId) {
        return {
          success: false,
          code: 'WORKFLOW_STATE_CHANGED',
          reason: 'TimeEntry déplacée vers une autre feuille',
          sheetId,
          transition: 'update_manager_actual',
          before: snapshot1,
          after: snapshot2
        };
      }

      // Re-construire la décision avec snapshot 2
      finalDecision = workflow.buildManagerActualUpdateAction({
        actorMemberId,
        actorIsAdmin,
        sheet: snapshot2.sheet,
        timeEntry: timeEntry2,
        hours: numericHours
      });

      if (!finalDecision.allowed || !finalDecision.can) {
        return {
          success: false,
          code: 'WORKFLOW_STATE_CHANGED',
          reason: 'État modifié pendant la transaction - transition non autorisée',
          sheetId,
          transition: 'update_manager_actual',
          before: snapshot1,
          after: snapshot2
        };
      }
    }

    // === APPLICATION ===
    await applyWorkflowActions(grist, finalDecision.actions);

    // === SNAPSHOT 3 (POST-ÉCRITURE) ===
    const snapshot3 = await loadWorkflowSnapshot(grist, sheetId);

    // === VÉRIFICATION ===
    const timeEntry3 = snapshot3.timeEntries.find(e => {
      return workflow.normalizeMemberId(e.id) === normalizedTimeEntryId;
    });

    if (!timeEntry3) {
      return {
        success: false,
        code: 'WORKFLOW_POSTCONDITION_FAILED',
        reason: 'TimeEntry introuvable après écriture',
        sheetId,
        transition: 'update_manager_actual',
        before: snapshot1,
        after: snapshot3
      };
    }

    // Vérifier que les heures ont été correctement mises à jour
    const actualHours = timeEntry3.heures;
    const normalizedActual = actualHours === null || actualHours === undefined || actualHours === ''
      ? null
      : Number(actualHours);

    if (normalizedActual !== numericHours) {
      return {
        success: false,
        code: 'WORKFLOW_POSTCONDITION_FAILED',
        reason: `Heures incorrectes : attendu ${numericHours}, obtenu ${actualHours}`,
        sheetId,
        transition: 'update_manager_actual',
        before: snapshot1,
        after: snapshot3,
        diagnostics: { expectedHours: numericHours, actualHours }
      };
    }

    // Vérifier que revisionValidation n'a PAS été incrémentée
    const rev1 = workflow.normalizeRevision(snapshot1.sheet.revisionValidation);
    const rev3 = workflow.normalizeRevision(snapshot3.sheet.revisionValidation);
    if (rev3 !== rev1) {
      return {
        success: false,
        code: 'WORKFLOW_POSTCONDITION_FAILED',
        reason: `revisionValidation modifiée : était ${rev1}, est ${rev3}`,
        sheetId,
        transition: 'update_manager_actual',
        before: snapshot1,
        after: snapshot3,
        diagnostics: { expectedRevision: rev1, actualRevision: rev3 }
      };
    }

    // === SUCCÈS ===
    return {
      success: true,
      code: 'OK',
      sheetId,
      transition: 'update_manager_actual',
      actions: finalDecision.actions,
      appliedActions: finalDecision.actions.length,
      before: snapshot1,
      after: snapshot3,
      summary: finalDecision.summary || {}
    };
  } catch (e) {
    if (e.code === workflow.SERVICE_ERROR_CODES?.SHEET_NOT_FOUND) {
      return { success: false, code: e.code, reason: e.message, sheetId, transition: 'update_manager_actual' };
    }
    return {
      success: false,
      code: e.code || 'WORKFLOW_APPLY_FAILED',
      reason: e.message,
      sheetId,
      transition: 'update_manager_actual',
      diagnostics: { error: e.message }
    };
  }
}

// ============================================================================
// EXPORT
// ============================================================================

module.exports = {
  submitSheet,
  withdrawSheet,
  validateSheet,
  rejectSheet,
  openManagerCorrection,
  revalidateSheet,
  updateManagerActual,
  ensureWeeklySheet,
  loadWorkflowSnapshot,
  verifyTransitionResult,
  buildFingerprint,
  callFunctionalValidator,
  executeTransition,
  SERVICE_ERROR_CODES,
  // Helpers de verrouillage (exportés pour les tests)
  acquireWeeklySheetLock,
  releaseWeeklySheetLock,
  clearWeeklySheetLocks
};
