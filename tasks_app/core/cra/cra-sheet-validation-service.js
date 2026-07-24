/**
 * CRA Sheet Validation Service - Service transactionnel pour le workflow des feuilles de temps
 *
 * Ce service centralise toutes les transitions du workflow CRA :
 * - soumettre une feuille
 * - retirer une soumission
 * - valider une feuille
 * - rejeter une feuille
 * - ouvrir une correction manager
 * - revalider une feuille après correction
 *
 * CONTRAT DE SÉCURITÉ :
 * 1. Double lecture avant écriture pour détecter les changements concurrents
 * 2. Aucune confiance dans les données fournies par l'appelant
 * 3. Validation fonctionnelle obligatoire avant validation/revalidation
 * 4. Toutes les actions dans un seul applyUserActions()
 * 5. Vérification post-écriture des préconditions
 *
 * @module core/cra/cra-sheet-validation-service
 */

'use strict';

const workflow = require('./cra-sheet-workflow');
const timesheetValidator = require('../timesheets/timesheet-validator');

// ============================================================================
// CONSTANTES : CODES D'ERREUR
// ============================================================================

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
  TIME_ENTRY_SCOPE_INCOMPLETE: 'TIME_ENTRY_SCOPE_INCOMPLETE'
};

// ============================================================================
// HELPERS : VALIDATION DES PARAMÈTRES
// ============================================================================

/**
 * Valide les paramètres communs à toutes les commandes
 * @param {Object} params - Paramètres à valider
 * @returns {{ valid: boolean, code?: string, reason?: string }}
 */
function validateCommonParams(params) {
  const { grist, sheetId, actorMemberId } = params || {};

  if (!grist || !grist.docApi || !grist.docApi.fetchTable || !grist.docApi.applyUserActions) {
    return {
      valid: false,
      code: SERVICE_ERROR_CODES.GRIST_API_UNAVAILABLE,
      reason: 'API Grist indisponible'
    };
  }

  const sheetIdNum = Number(sheetId);
  if (!Number.isInteger(sheetIdNum) || sheetIdNum <= 0) {
    return {
      valid: false,
      code: SERVICE_ERROR_CODES.SHEET_ID_INVALID,
      reason: 'sheetId doit être un entier strictement positif'
    };
  }

  const actorIdNum = Number(actorMemberId);
  if (!Number.isInteger(actorIdNum) || actorIdNum <= 0) {
    return {
      valid: false,
      code: SERVICE_ERROR_CODES.ACTOR_NOT_IDENTIFIED,
      reason: 'actorMemberId doit être un entier strictement positif'
    };
  }

  return { valid: true };
}

/**
 * Valide un timestamp Unix pour les opérations d'écriture
 * @param {*} nowUnixSeconds - Timestamp à valider
 * @returns {{ valid: boolean, code?: string, value?: number }}
 */
function validateTimestamp(nowUnixSeconds) {
  const check = workflow.validateUnixTimestamp(nowUnixSeconds);
  if (!check.valid) {
    return {
      valid: false,
      code: 'INVALID_NOW_UNIX_SECONDS',
      reason: 'Timestamp Unix invalide'
    };
  }
  return { valid: true, value: check.value };
}

// ============================================================================
// HELPERS : CONVERSION DES DONNÉES GRIST
// ============================================================================

/**
 * Convertit les données colonnaires Grist en tableau de lignes
 * @param {Object} columnarData - Données colonnaires
 * @returns {Array} Tableau de lignes
 */
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
// CHARGEMENT DU SNAPSHOT
// ============================================================================

/**
 * Charge un snapshot complet du workflow pour une feuille
 * @param {Object} grist - API Grist
 * @param {number} sheetId - ID de la feuille
 * @returns {Promise<{
 *   team: Array,
 *   sheets: Array,
 *   sheet: Object|null,
 *   timeEntries: Array,
 *   fingerprint: string
 * }>}
 */
async function loadWorkflowSnapshot(grist, sheetId) {
  const [teamData, sheetsData, entriesData] = await Promise.all([
    grist.docApi.fetchTable('Team'),
    grist.docApi.fetchTable('Feuilles'),
    grist.docApi.fetchTable('TimeEntries')
  ]);

  const team = columnarToRows(teamData);
  const sheets = columnarToRows(sheetsData);
  const allEntries = columnarToRows(entriesData);

  const normalizedSheetId = workflow.normalizeMemberId(sheetId);
  const sheet = sheets.find(s => workflow.normalizeMemberId(s.id) === normalizedSheetId) || null;

  if (!sheet) {
    const error = new Error('Feuille non trouvée');
    error.code = SERVICE_ERROR_CODES.SHEET_NOT_FOUND;
    throw error;
  }

    const sheetMemberId = workflow.normalizeMemberId(sheet.membre);
    const sheetWeekIso = workflow.getWeekStartIso(sheet.semaine);

    const timeEntries = allEntries.filter(e => {
      const entrySheetId = workflow.normalizeMemberId(e.feuille);
      return entrySheetId === normalizedSheetId;
    });

    const otherEntries = allEntries.filter(e => {
      const entryMemberId = workflow.normalizeMemberId(e.membre);
      const entrySheetId = workflow.normalizeMemberId(e.feuille);
      const entryWeekIso = workflow.getWeekStartIso(e.date);

      return (
        entryMemberId === sheetMemberId &&
        entryWeekIso === sheetWeekIso &&
        (entrySheetId === null || entrySheetId !== normalizedSheetId)
      );
    });

  timeEntries.sort((a, b) => {
    const idA = workflow.normalizeMemberId(a.id) || 0;
    const idB = workflow.normalizeMemberId(b.id) || 0;
    return idA - idB;
  });

  const fingerprint = buildFingerprint(sheet, timeEntries);

  return {
    team,
    sheets,
    sheet,
    timeEntries,
    allMemberWeekEntries: otherEntries,
    fingerprint
  };
}

/**
 * Construit une empreinte déterministe de l'état
 * @param {Object} sheet - Feuille
 * @param {Array} timeEntries - TimeEntries
 * @returns {string} Empreinte JSON
 */
function buildFingerprint(sheet, timeEntries) {
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
    heures: e.heures,
    heuresPrevues: e.heuresPrevues
  }));

  return JSON.stringify({
    sheet: sheetData,
    timeEntries: entriesData
  });
}

// ============================================================================
// VALIDATION FONCTIONNELLE
// ============================================================================

/**
 * Appelle le validateur fonctionnel pour une feuille
 * @param {Object} snapshot - Snapshot du workflow
 * @returns {{ valid: boolean, errors: Array, warnings: Array }}
 */
function callFunctionalValidator(snapshot) {
  const { sheet, timeEntries, team } = snapshot;

  const sheetMemberId = workflow.normalizeMemberId(sheet.membre);
  const member = team.find(m => workflow.normalizeMemberId(m.id) === sheetMemberId);

  if (!member) {
    const error = new Error('Membre non trouvé');
    error.code = SERVICE_ERROR_CODES.TIMESHEET_VALIDATOR_UNAVAILABLE;
    throw error;
  }

  const weekStartIso = workflow.getWeekStartIso(sheet.semaine);
  if (!weekStartIso) {
    const error = new Error('Semaine invalide');
    error.code = SERVICE_ERROR_CODES.TIMESHEET_VALIDATION_ERROR;
    throw error;
  }

  const entries = timeEntries.map(e => ({
    taskId: workflow.normalizeMemberId(e.tache),
    date: workflow.gristDateToIso(e.date),
    actualHours: e.heures
  })).filter(e => e.date !== null && e.taskId !== null);

  const uniqueDates = [...new Set(entries.map(e => e.date).filter(d => d !== null))];
  const capacities = uniqueDates.map(date => ({
    date,
    availableCapacityHours: 35
  }));

  try {
    const result = timesheetValidator.validateTimesheet({
      memberId: sheetMemberId,
      weekStart: weekStartIso,
      entries,
      capacities,
      options: {
        allowWeekend: false
      }
    });

    return {
      valid: result.valid,
      errors: result.errors || [],
      warnings: []
    };
  } catch (e) {
    const error = new Error('Erreur du validateur');
    error.code = SERVICE_ERROR_CODES.TIMESHEET_VALIDATION_ERROR;
    error.originalError = e;
    throw error;
  }
}

// ============================================================================
// APPLICATION DES ACTIONS
// ============================================================================

/**
 * Applique des actions Grist de manière transactionnelle
 * @param {Object} grist - API Grist
 * @param {Array} actions - Actions à appliquer
 * @returns {Promise<Array>} Résultats
 */
async function applyWorkflowActions(grist, actions) {
  if (!actions || actions.length === 0) {
    const error = new Error('Aucune action à appliquer');
    error.code = SERVICE_ERROR_CODES.WORKFLOW_APPLY_FAILED;
    throw error;
  }

  try {
    const results = await grist.docApi.applyUserActions(actions);
    return results;
  } catch (e) {
    const error = new Error('Échec de l\'application des actions');
    error.code = SERVICE_ERROR_CODES.WORKFLOW_APPLY_FAILED;
    error.originalError = e;
    error.message = e.message || error.message;
    throw error;
  }
}

// ============================================================================
// VÉRIFICATION POST-ÉCRITURE
// ============================================================================

/**
 * Vérifie le résultat d'une transition après écriture
 * @param {Object} grist - API Grist
 * @param {number} sheetId - ID de la feuille
 * @param {string} expectedStatus - Statut attendu
 * @param {Object} expectedFields - Champs attendus
 * @returns {Promise<{ valid: boolean, reason?: string }>}
 */
async function verifyTransitionResult(grist, sheetId, expectedStatus, expectedFields = {}) {
  const sheetsData = await grist.docApi.fetchTable('Feuilles');
  const sheets = columnarToRows(sheetsData);

  const normalizedSheetId = workflow.normalizeMemberId(sheetId);
  const sheet = sheets.find(s => workflow.normalizeMemberId(s.id) === normalizedSheetId);

  if (!sheet) {
    return {
      valid: false,
      reason: 'Feuille non trouvée après écriture'
    };
  }

  const actualStatus = workflow.normalizeSheetStatus(sheet.statut);
  const expectedNormalizedStatus = workflow.normalizeSheetStatus(expectedStatus);

  if (actualStatus !== expectedNormalizedStatus) {
    return {
      valid: false,
      reason: `Statut incorrect: attendu ${expectedNormalizedStatus}, obtenu ${actualStatus}`
    };
  }

  for (const [field, expectedValue] of Object.entries(expectedFields)) {
    const actualValue = sheet[field];
    const normalizedActual = workflow.normalizeMemberId(actualValue);
    const normalizedExpected = workflow.normalizeMemberId(expectedValue);

    if (normalizedActual !== normalizedExpected) {
      return {
        valid: false,
        reason: `Champ ${field} incorrect: attendu ${expectedValue}, obtenu ${actualValue}`
      };
    }
  }

  return { valid: true };
}

// ============================================================================
// COMMANDE : SOUMISSION
// ============================================================================

/**
 * Soumet une feuille de temps
 * @param {Object} params - Paramètres
 * @param {Object} params.grist - API Grist
 * @param {number} params.actorMemberId - ID de l'acteur
 * @param {number} params.sheetId - ID de la feuille
 * @param {number} params.nowUnixSeconds - Timestamp actuel
 * @returns {Promise<Object>} Résultat de la transition
 */
async function submitSheet(params) {
  const { grist, actorMemberId, sheetId, nowUnixSeconds } = params || {};

  const validation = validateCommonParams({ grist, sheetId, actorMemberId });
  if (!validation.valid) {
    return {
      success: false,
      code: validation.code,
      reason: validation.reason,
      sheetId,
      transition: 'submit'
    };
  }

  const timestampCheck = validateTimestamp(nowUnixSeconds);
  if (!timestampCheck.valid) {
    return {
      success: false,
      code: timestampCheck.code,
      reason: timestampCheck.reason,
      sheetId,
      transition: 'submit'
    };
  }

  try {
    const snapshot1 = await loadWorkflowSnapshot(grist, sheetId);
    const { team, sheets, sheet, timeEntries } = snapshot1;

    const actorId = workflow.normalizeMemberId(actorMemberId);
    const sheetMemberId = workflow.normalizeMemberId(sheet.membre);

    if (actorId !== sheetMemberId) {
      return {
        success: false,
        code: 'NOT_SHEET_OWNER',
        reason: 'Seul le propriétaire de la feuille peut la soumettre',
        sheetId,
        transition: 'submit'
      };
    }

    if (snapshot1.allMemberWeekEntries && snapshot1.allMemberWeekEntries.length > 0) {
      return {
        success: false,
        code: SERVICE_ERROR_CODES.TIME_ENTRY_SCOPE_INCOMPLETE,
        reason: 'Entrées hors scope détectées',
        sheetId,
        transition: 'submit',
        diagnostics: { otherEntriesCount: snapshot1.allMemberWeekEntries.length }
      };
    }

    const buildResult = workflow.buildSubmissionActions({
      actorMemberId,
      sheet,
      team,
      sheets,
      timeEntries,
      nowUnixSeconds: timestampCheck.value
    });

    if (!buildResult.allowed || !buildResult.can) {
      return {
        success: false,
        code: buildResult.code,
        reason: buildResult.reason,
        sheetId,
        transition: 'submit',
        actions: buildResult.actions || []
      };
    }

    const snapshot2 = await loadWorkflowSnapshot(grist, sheetId);
    const fingerprint1 = snapshot1.fingerprint;
    const fingerprint2 = snapshot2.fingerprint;

    let finalActions = buildResult.actions;

    if (fingerprint1 !== fingerprint2) {
      const rebuildResult = workflow.buildSubmissionActions({
        actorMemberId,
        sheet: snapshot2.sheet,
        team: snapshot2.team,
        sheets: snapshot2.sheets,
        timeEntries: snapshot2.timeEntries,
        nowUnixSeconds: timestampCheck.value
      });

      if (!rebuildResult.allowed || !rebuildResult.can) {
        return {
          success: false,
          code: SERVICE_ERROR_CODES.WORKFLOW_STATE_CHANGED,
          reason: 'État modifié pendant la transaction',
          sheetId,
          transition: 'submit',
          before: snapshot1,
          after: snapshot2
        };
      }

      finalActions = rebuildResult.actions;
    }

    await applyWorkflowActions(grist, finalActions);

    const verifyResult = await verifyTransitionResult(grist, sheetId, 'soumis', {
      responsableValidation: workflow.getDirectManagerId(sheetMemberId, snapshot2.team),
      soumisPar: actorId
    });

    if (!verifyResult.valid) {
      return {
        success: false,
        code: SERVICE_ERROR_CODES.WORKFLOW_POSTCONDITION_FAILED,
        reason: verifyResult.reason,
        sheetId,
        transition: 'submit',
        diagnostics: { verificationFailed: true }
      };
    }

    return {
      success: true,
      code: 'OK',
      sheetId,
      transition: 'submit',
      actions: finalActions,
      appliedActions: finalActions.length,
      before: snapshot1,
      after: snapshot2,
      summary: buildResult.summary
    };
  } catch (e) {
    if (e.code === SERVICE_ERROR_CODES.SHEET_NOT_FOUND) {
      return {
        success: false,
        code: e.code,
        reason: e.message,
        sheetId,
        transition: 'submit'
      };
    }

    return {
      success: false,
      code: e.code || SERVICE_ERROR_CODES.WORKFLOW_APPLY_FAILED,
      reason: e.message,
      sheetId,
      transition: 'submit',
      diagnostics: { error: e.message }
    };
  }
}

// ============================================================================
// COMMANDE : RETRAIT
// ============================================================================

/**
 * Retire une soumission de feuille
 * @param {Object} params - Paramètres
 * @param {Object} params.grist - API Grist
 * @param {number} params.actorMemberId - ID de l'acteur
 * @param {number} params.sheetId - ID de la feuille
 * @returns {Promise<Object>} Résultat de la transition
 */
async function withdrawSheet(params) {
  const { grist, actorMemberId, sheetId } = params || {};

  const validation = validateCommonParams({ grist, sheetId, actorMemberId });
  if (!validation.valid) {
    return {
      success: false,
      code: validation.code,
      reason: validation.reason,
      sheetId,
      transition: 'withdraw'
    };
  }

  try {
    const snapshot1 = await loadWorkflowSnapshot(grist, sheetId);
    const { sheets, sheet } = snapshot1;

    const buildResult = workflow.buildWithdrawActions({
      actorMemberId,
      sheet,
      sheets
    });

    if (!buildResult.allowed || !buildResult.can) {
      return {
        success: false,
        code: buildResult.code,
        reason: buildResult.reason,
        sheetId,
        transition: 'withdraw',
        actions: buildResult.actions || []
      };
    }

    const snapshot2 = await loadWorkflowSnapshot(grist, sheetId);

    if (snapshot1.fingerprint !== snapshot2.fingerprint) {
      const rebuildResult = workflow.buildWithdrawActions({
        actorMemberId,
        sheet: snapshot2.sheet,
        sheets: snapshot2.sheets
      });

      if (!rebuildResult.allowed || !rebuildResult.can) {
        return {
          success: false,
          code: SERVICE_ERROR_CODES.WORKFLOW_STATE_CHANGED,
          reason: 'État modifié pendant la transaction',
          sheetId,
          transition: 'withdraw',
          before: snapshot1,
          after: snapshot2
        };
      }
    }

    await applyWorkflowActions(grist, buildResult.actions);

    const verifyResult = await verifyTransitionResult(grist, sheetId, 'brouillon');

    if (!verifyResult.valid) {
      return {
        success: false,
        code: SERVICE_ERROR_CODES.WORKFLOW_POSTCONDITION_FAILED,
        reason: verifyResult.reason,
        sheetId,
        transition: 'withdraw',
        diagnostics: { verificationFailed: true }
      };
    }

    return {
      success: true,
      code: 'OK',
      sheetId,
      transition: 'withdraw',
      actions: buildResult.actions,
      appliedActions: buildResult.actions.length,
      before: snapshot1,
      after: snapshot2,
      summary: buildResult.summary
    };
  } catch (e) {
    if (e.code === SERVICE_ERROR_CODES.SHEET_NOT_FOUND) {
      return {
        success: false,
        code: e.code,
        reason: e.message,
        sheetId,
        transition: 'withdraw'
      };
    }

    return {
      success: false,
      code: e.code || SERVICE_ERROR_CODES.WORKFLOW_APPLY_FAILED,
      reason: e.message,
      sheetId,
      transition: 'withdraw',
      diagnostics: { error: e.message }
    };
  }
}

// ============================================================================
// COMMANDE : VALIDATION
// ============================================================================

/**
 * Valide une feuille de temps
 * @param {Object} params - Paramètres
 * @param {Object} params.grist - API Grist
 * @param {number} params.actorMemberId - ID de l'acteur
 * @param {number} params.sheetId - ID de la feuille
 * @param {number} params.nowUnixSeconds - Timestamp actuel
 * @returns {Promise<Object>} Résultat de la transition
 */
async function validateSheet(params) {
  const { grist, actorMemberId, sheetId, nowUnixSeconds } = params || {};

  const validation = validateCommonParams({ grist, sheetId, actorMemberId });
  if (!validation.valid) {
    return {
      success: false,
      code: validation.code,
      reason: validation.reason,
      sheetId,
      transition: 'validate'
    };
  }

  const timestampCheck = validateTimestamp(nowUnixSeconds);
  if (!timestampCheck.valid) {
    return {
      success: false,
      code: timestampCheck.code,
      reason: timestampCheck.reason,
      sheetId,
      transition: 'validate'
    };
  }

  try {
    const snapshot1 = await loadWorkflowSnapshot(grist, sheetId);

    let validationResult;
    try {
      validationResult = callFunctionalValidator(snapshot1);
    } catch (e) {
      return {
        success: false,
        code: e.code || SERVICE_ERROR_CODES.TIMESHEET_VALIDATION_ERROR,
        reason: e.message,
        sheetId,
        transition: 'validate'
      };
    }

    if (!validationResult.valid) {
      return {
        success: false,
        code: SERVICE_ERROR_CODES.TIMESHEET_VALIDATION_FAILED,
        reason: 'Validation fonctionnelle échouée',
        sheetId,
        transition: 'validate',
        validation: validationResult
      };
    }

    const buildResult = workflow.buildValidationAction({
      actorMemberId,
      sheet: snapshot1.sheet,
      sheets: snapshot1.sheets,
      validationResult,
      nowUnixSeconds: timestampCheck.value
    });

    if (!buildResult.allowed || !buildResult.can) {
      return {
        success: false,
        code: buildResult.code,
        reason: buildResult.reason,
        sheetId,
        transition: 'validate',
        actions: buildResult.actions || []
      };
    }

    const snapshot2 = await loadWorkflowSnapshot(grist, sheetId);

    if (snapshot1.fingerprint !== snapshot2.fingerprint) {
      const rebuildResult = workflow.buildValidationAction({
        actorMemberId,
        sheet: snapshot2.sheet,
        sheets: snapshot2.sheets,
        validationResult,
        nowUnixSeconds: timestampCheck.value
      });

      if (!rebuildResult.allowed || !rebuildResult.can) {
        return {
          success: false,
          code: SERVICE_ERROR_CODES.WORKFLOW_STATE_CHANGED,
          reason: 'État modifié pendant la transaction',
          sheetId,
          transition: 'validate',
          before: snapshot1,
          after: snapshot2
        };
      }
    }

    await applyWorkflowActions(grist, buildResult.actions);

    const expectedManager = workflow.getExpectedValidationManagerId(snapshot2.sheet);
    const verifyResult = await verifyTransitionResult(grist, sheetId, 'valide', {
      validePar: expectedManager
    });

    if (!verifyResult.valid) {
      return {
        success: false,
        code: SERVICE_ERROR_CODES.WORKFLOW_POSTCONDITION_FAILED,
        reason: verifyResult.reason,
        sheetId,
        transition: 'validate',
        diagnostics: { verificationFailed: true }
      };
    }

    return {
      success: true,
      code: 'OK',
      sheetId,
      transition: 'validate',
      actions: buildResult.actions,
      appliedActions: buildResult.actions.length,
      before: snapshot1,
      after: snapshot2,
      validation: validationResult,
      summary: buildResult.summary
    };
  } catch (e) {
    if (e.code === SERVICE_ERROR_CODES.SHEET_NOT_FOUND) {
      return {
        success: false,
        code: e.code,
        reason: e.message,
        sheetId,
        transition: 'validate'
      };
    }

    return {
      success: false,
      code: e.code || SERVICE_ERROR_CODES.WORKFLOW_APPLY_FAILED,
      reason: e.message,
      sheetId,
      transition: 'validate',
      diagnostics: { error: e.message }
    };
  }
}

// ============================================================================
// COMMANDE : REJET
// ============================================================================

/**
 * Rejette une feuille de temps
 * @param {Object} params - Paramètres
 * @param {Object} params.grist - API Grist
 * @param {number} params.actorMemberId - ID de l'acteur
 * @param {number} params.sheetId - ID de la feuille
 * @param {string} params.rejectReason - Motif de rejet
 * @returns {Promise<Object>} Résultat de la transition
 */
async function rejectSheet(params) {
  const { grist, actorMemberId, sheetId, rejectReason } = params || {};

  const validation = validateCommonParams({ grist, sheetId, actorMemberId });
  if (!validation.valid) {
    return {
      success: false,
      code: validation.code,
      reason: validation.reason,
      sheetId,
      transition: 'reject'
    };
  }

  if (!rejectReason || String(rejectReason).trim() === '') {
    return {
      success: false,
      code: 'MISSING_REJECT_REASON',
      reason: 'Motif de rejet requis',
      sheetId,
      transition: 'reject'
    };
  }

  try {
    const snapshot1 = await loadWorkflowSnapshot(grist, sheetId);

    const buildResult = workflow.buildRejectionAction({
      actorMemberId,
      sheet: snapshot1.sheet,
      sheets: snapshot1.sheets,
      rejectReason
    });

    if (!buildResult.allowed || !buildResult.can) {
      return {
        success: false,
        code: buildResult.code,
        reason: buildResult.reason,
        sheetId,
        transition: 'reject',
        actions: buildResult.actions || []
      };
    }

    const snapshot2 = await loadWorkflowSnapshot(grist, sheetId);

    if (snapshot1.fingerprint !== snapshot2.fingerprint) {
      const rebuildResult = workflow.buildRejectionAction({
        actorMemberId,
        sheet: snapshot2.sheet,
        sheets: snapshot2.sheets,
        rejectReason
      });

      if (!rebuildResult.allowed || !rebuildResult.can) {
        return {
          success: false,
          code: SERVICE_ERROR_CODES.WORKFLOW_STATE_CHANGED,
          reason: 'État modifié pendant la transaction',
          sheetId,
          transition: 'reject',
          before: snapshot1,
          after: snapshot2
        };
      }
    }

    await applyWorkflowActions(grist, buildResult.actions);

    const verifyResult = await verifyTransitionResult(grist, sheetId, 'rejete');

    if (!verifyResult.valid) {
      return {
        success: false,
        code: SERVICE_ERROR_CODES.WORKFLOW_POSTCONDITION_FAILED,
        reason: verifyResult.reason,
        sheetId,
        transition: 'reject',
        diagnostics: { verificationFailed: true }
      };
    }

    return {
      success: true,
      code: 'OK',
      sheetId,
      transition: 'reject',
      actions: buildResult.actions,
      appliedActions: buildResult.actions.length,
      before: snapshot1,
      after: snapshot2,
      summary: buildResult.summary
    };
  } catch (e) {
    if (e.code === SERVICE_ERROR_CODES.SHEET_NOT_FOUND) {
      return {
        success: false,
        code: e.code,
        reason: e.message,
        sheetId,
        transition: 'reject'
      };
    }

    return {
      success: false,
      code: e.code || SERVICE_ERROR_CODES.WORKFLOW_APPLY_FAILED,
      reason: e.message,
      sheetId,
      transition: 'reject',
      diagnostics: { error: e.message }
    };
  }
}

// ============================================================================
// COMMANDE : CORRECTION MANAGER
// ============================================================================

/**
 * Ouvre une correction manager
 * @param {Object} params - Paramètres
 * @param {Object} params.grist - API Grist
 * @param {number} params.actorMemberId - ID de l'acteur
 * @param {number} params.sheetId - ID de la feuille
 * @param {string} params.correctionReason - Motif de correction
 * @returns {Promise<Object>} Résultat de la transition
 */
async function openManagerCorrection(params) {
  const { grist, actorMemberId, sheetId, correctionReason } = params || {};

  const validation = validateCommonParams({ grist, sheetId, actorMemberId });
  if (!validation.valid) {
    return {
      success: false,
      code: validation.code,
      reason: validation.reason,
      sheetId,
      transition: 'open_correction'
    };
  }

  if (!correctionReason || String(correctionReason).trim() === '') {
    return {
      success: false,
      code: 'MISSING_CORRECTION_REASON',
      reason: 'Motif de correction requis',
      sheetId,
      transition: 'open_correction'
    };
  }

  try {
    const snapshot1 = await loadWorkflowSnapshot(grist, sheetId);

    const buildResult = workflow.buildOpenManagerCorrectionActions({
      actorMemberId,
      sheet: snapshot1.sheet,
      sheets: snapshot1.sheets,
      correctionReason
    });

    if (!buildResult.allowed || !buildResult.can) {
      return {
        success: false,
        code: buildResult.code,
        reason: buildResult.reason,
        sheetId,
        transition: 'open_correction',
        actions: buildResult.actions || []
      };
    }

    const snapshot2 = await loadWorkflowSnapshot(grist, sheetId);

    if (snapshot1.fingerprint !== snapshot2.fingerprint) {
      const rebuildResult = workflow.buildOpenManagerCorrectionActions({
        actorMemberId,
        sheet: snapshot2.sheet,
        sheets: snapshot2.sheets,
        correctionReason
      });

      if (!rebuildResult.allowed || !rebuildResult.can) {
        return {
          success: false,
          code: SERVICE_ERROR_CODES.WORKFLOW_STATE_CHANGED,
          reason: 'État modifié pendant la transaction',
          sheetId,
          transition: 'open_correction',
          before: snapshot1,
          after: snapshot2
        };
      }
    }

    await applyWorkflowActions(grist, buildResult.actions);

    const verifyResult = await verifyTransitionResult(grist, sheetId, 'correction_manager');

    if (!verifyResult.valid) {
      return {
        success: false,
        code: SERVICE_ERROR_CODES.WORKFLOW_POSTCONDITION_FAILED,
        reason: verifyResult.reason,
        sheetId,
        transition: 'open_correction',
        diagnostics: { verificationFailed: true }
      };
    }

    return {
      success: true,
      code: 'OK',
      sheetId,
      transition: 'open_correction',
      actions: buildResult.actions,
      appliedActions: buildResult.actions.length,
      before: snapshot1,
      after: snapshot2,
      summary: buildResult.summary
    };
  } catch (e) {
    if (e.code === SERVICE_ERROR_CODES.SHEET_NOT_FOUND) {
      return {
        success: false,
        code: e.code,
        reason: e.message,
        sheetId,
        transition: 'open_correction'
      };
    }

    return {
      success: false,
      code: e.code || SERVICE_ERROR_CODES.WORKFLOW_APPLY_FAILED,
      reason: e.message,
      sheetId,
      transition: 'open_correction',
      diagnostics: { error: e.message }
    };
  }
}

// ============================================================================
// COMMANDE : REVALIDATION
// ============================================================================

/**
 * Revalide une feuille après correction
 * @param {Object} params - Paramètres
 * @param {Object} params.grist - API Grist
 * @param {number} params.actorMemberId - ID de l'acteur
 * @param {number} params.sheetId - ID de la feuille
 * @param {number} params.nowUnixSeconds - Timestamp actuel
 * @returns {Promise<Object>} Résultat de la transition
 */
async function revalidateSheet(params) {
  const { grist, actorMemberId, sheetId, nowUnixSeconds } = params || {};

  const validation = validateCommonParams({ grist, sheetId, actorMemberId });
  if (!validation.valid) {
    return {
      success: false,
      code: validation.code,
      reason: validation.reason,
      sheetId,
      transition: 'revalidate'
    };
  }

  const timestampCheck = validateTimestamp(nowUnixSeconds);
  if (!timestampCheck.valid) {
    return {
      success: false,
      code: timestampCheck.code,
      reason: timestampCheck.reason,
      sheetId,
      transition: 'revalidate'
    };
  }

  try {
    const snapshot1 = await loadWorkflowSnapshot(grist, sheetId);

    let validationResult;
    try {
      validationResult = callFunctionalValidator(snapshot1);
    } catch (e) {
      return {
        success: false,
        code: e.code || SERVICE_ERROR_CODES.TIMESHEET_VALIDATION_ERROR,
        reason: e.message,
        sheetId,
        transition: 'revalidate'
      };
    }

    if (!validationResult.valid) {
      return {
        success: false,
        code: SERVICE_ERROR_CODES.TIMESHEET_VALIDATION_FAILED,
        reason: 'Validation fonctionnelle échouée',
        sheetId,
        transition: 'revalidate',
        validation: validationResult
      };
    }

    const buildResult = workflow.buildRevalidationActions({
      actorMemberId,
      sheet: snapshot1.sheet,
      sheets: snapshot1.sheets,
      validationResult,
      nowUnixSeconds: timestampCheck.value
    });

    if (!buildResult.allowed || !buildResult.can) {
      return {
        success: false,
        code: buildResult.code,
        reason: buildResult.reason,
        sheetId,
        transition: 'revalidate',
        actions: buildResult.actions || []
      };
    }

    const snapshot2 = await loadWorkflowSnapshot(grist, sheetId);

    if (snapshot1.fingerprint !== snapshot2.fingerprint) {
      const rebuildResult = workflow.buildRevalidationActions({
        actorMemberId,
        sheet: snapshot2.sheet,
        sheets: snapshot2.sheets,
        validationResult,
        nowUnixSeconds: timestampCheck.value
      });

      if (!rebuildResult.allowed || !rebuildResult.can) {
        return {
          success: false,
          code: SERVICE_ERROR_CODES.WORKFLOW_STATE_CHANGED,
          reason: 'État modifié pendant la transaction',
          sheetId,
          transition: 'revalidate',
          before: snapshot1,
          after: snapshot2
        };
      }
    }

    await applyWorkflowActions(grist, buildResult.actions);

    const expectedManager = workflow.getExpectedValidationManagerId(snapshot2.sheet);
    const verifyResult = await verifyTransitionResult(grist, sheetId, 'valide', {
      validePar: expectedManager
    });

    if (!verifyResult.valid) {
      return {
        success: false,
        code: SERVICE_ERROR_CODES.WORKFLOW_POSTCONDITION_FAILED,
        reason: verifyResult.reason,
        sheetId,
        transition: 'revalidate',
        diagnostics: { verificationFailed: true }
      };
    }

    return {
      success: true,
      code: 'OK',
      sheetId,
      transition: 'revalidate',
      actions: buildResult.actions,
      appliedActions: buildResult.actions.length,
      before: snapshot1,
      after: snapshot2,
      validation: validationResult,
      summary: buildResult.summary
    };
  } catch (e) {
    if (e.code === SERVICE_ERROR_CODES.SHEET_NOT_FOUND) {
      return {
        success: false,
        code: e.code,
        reason: e.message,
        sheetId,
        transition: 'revalidate'
      };
    }

    return {
      success: false,
      code: e.code || SERVICE_ERROR_CODES.WORKFLOW_APPLY_FAILED,
      reason: e.message,
      sheetId,
      transition: 'revalidate',
      diagnostics: { error: e.message }
    };
  }
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

module.exports = {
  submitSheet,
  withdrawSheet,
  validateSheet,
  rejectSheet,
  openManagerCorrection,
  revalidateSheet,
  loadWorkflowSnapshot,
  verifyTransitionResult,
  buildFingerprint,
  callFunctionalValidator,
  SERVICE_ERROR_CODES
};
