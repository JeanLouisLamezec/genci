/**
 * CRA Sheet Workflow — Logique pure et testable pour le workflow des feuilles de temps
 * 
 * CONTRATS :
 * 1. Identité : S.currentUserMemberId uniquement (jamais selectedPersonId, team[0], etc.)
 * 2. Unicité : Une seule feuille par membre + semaine (lundi civil)
 * 3. Hiérarchie : Team.responsable (relation directe, pas agents_geres)
 * 4. Auto-validation interdite : actorMemberId !== sheet.membre
 * 5. Statuts : brouillon, soumis, valide, rejete (et équivalents anglais)
 * 6. Immutabilité : valide est terminal, soumis est verrouillé
 * 7. Null ≠ 0 : heures = null (proposition) vs heures = 0 (zéro explicite)
 * 
 * @module core/cra/cra-sheet-workflow
 */

'use strict';

// ============================================================================
// CONSTANTES
// ============================================================================

/**
 * Statuts normés du domaine (anglais)
 */
const SHEET_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  VALIDATED: 'validated',
  REJECTED: 'rejected'
};

/**
 * Statuts Grist (français et anglais)
 */
const GRIST_STATUS_MAPPING = {
  // Français
  'brouillon': SHEET_STATUS.DRAFT,
  'soumis': SHEET_STATUS.SUBMITTED,
  'valide': SHEET_STATUS.VALIDATED,
  'rejete': SHEET_STATUS.REJECTED,
  // Anglais
  'draft': SHEET_STATUS.DRAFT,
  'submitted': SHEET_STATUS.SUBMITTED,
  'validated': SHEET_STATUS.VALIDATED,
  'rejected': SHEET_STATUS.REJECTED
};

/**
 * Statuts éditables (la personne peut modifier)
 */
const EDITABLE_STATUSES = [
  SHEET_STATUS.DRAFT,
  SHEET_STATUS.REJECTED
];

/**
 * Statuts verrouillés (la personne ne peut plus modifier)
 */
const LOCKED_STATUSES = [
  SHEET_STATUS.SUBMITTED,
  SHEET_STATUS.VALIDATED
];

/**
 * Statuts terminaux (aucune transition sortante)
 */
const TERMINAL_STATUSES = [
  SHEET_STATUS.VALIDATED
];

// ============================================================================
// HELPERS : STATUTS
// ============================================================================

/**
 * Normalise un statut Grist vers le statut du domaine
 * @param {*} status - Statut brut venant de Grist
 * @returns {string|null} Statut normalisé ou null
 */
function normalizeSheetStatus(status) {
  if (status === null || status === undefined || status === '') {
    return null;
  }
  
  const normalized = GRIST_STATUS_MAPPING[String(status).toLowerCase()];
  return normalized || null;
}

/**
 * Vérifie si une feuille est éditable par sa personne
 * @param {Object} sheet - Feuille avec statut
 * @returns {boolean} true si éditable
 */
function isSheetEditable(sheet) {
  if (!sheet) return false;
  const status = normalizeSheetStatus(sheet.statut);
  return EDITABLE_STATUSES.includes(status);
}

/**
 * Vérifie si une feuille est verrouillée (soumise ou validée)
 * @param {Object} sheet - Feuille avec statut
 * @returns {boolean} true si verrouillée
 */
function isSheetLocked(sheet) {
  if (!sheet) return false;
  const status = normalizeSheetStatus(sheet.statut);
  return LOCKED_STATUSES.includes(status);
}

/**
 * Vérifie si une feuille est dans un statut terminal (validée)
 * @param {Object} sheet - Feuille avec statut
 * @returns {boolean} true si terminal
 */
function isSheetTerminal(sheet) {
  if (!sheet) return false;
  const status = normalizeSheetStatus(sheet.statut);
  return TERMINAL_STATUSES.includes(status);
}

// ============================================================================
// HELPERS : NULL / 0 / RÉALISÉ EXPLICITE
// ============================================================================

/**
 * Vérifie si une entrée a un réalisé explicitement renseigné
 * CONTRAT : distingue null (aucun réalisé) de 0 (zéro explicite)
 * 
 * @param {Object} entry - TimeEntry avec heures
 * @returns {boolean} true si heures est une valeur numérique valide
 */
function hasExplicitActual(entry) {
  return (
    Boolean(entry) &&
    entry.heures !== null &&
    entry.heures !== undefined &&
    entry.heures !== '' &&
    Number.isFinite(Number(entry.heures))
  );
}

/**
 * Helper legacy pour compatibilité avec le code existant
 * @param {Object} entry - TimeEntry
 * @returns {boolean} true si heures est renseigné
 */
function hasExplicitActualHours(entry) {
  return hasExplicitActual(entry);
}

// ============================================================================
// UNICITÉ DE LA FEUILLE HEBDOMADAIRE
// ============================================================================

/**
 * Trouve l'unique feuille pour un membre et une semaine donnés
 * 
 * CONTRAT :
 * - 0 feuille → null (création possible)
 * - 1 feuille → la feuille
 * - 2+ feuilles → diagnostic DUPLICATE_WEEKLY_SHEET
 * 
 * @param {number} memberId - ID du membre
 * @param {string} weekStartIso - Date de début de semaine (YYYY-MM-DD, lundi civil)
 * @param {Array} sheets - Toutes les feuilles (Feuilles)
 * @returns {{ 
 *   sheet: null | object, 
 *   status: 'found' | 'none' | 'duplicate', 
 *   reason: string 
 * }}
 */
function findUniqueSheetForWeek(memberId, weekStartIso, sheets) {
  if (!memberId || !weekStartIso) {
    return {
      sheet: null,
      status: 'none',
      reason: 'MISSING_PARAMS'
    };
  }
  
  // Convertir weekStartIso en timestamp Grist pour comparaison
  const weekStartTimestamp = isoToGristDate(weekStartIso);
  
  const matchingSheets = (sheets || []).filter(s => {
    if (s.membre !== memberId) return false;
    
    // Comparer les dates de semaine
    const sheetWeekStart = s.semaine;
    if (sheetWeekStart === weekStartTimestamp) return true;
    
    // Comparer en ISO si les deux sont des timestamps
    const sheetWeekIso = gristDateToIso(sheetWeekStart);
    return sheetWeekIso === weekStartIso;
  });
  
  if (matchingSheets.length === 0) {
    return {
      sheet: null,
      status: 'none',
      reason: 'NO_SHEET_FOR_WEEK'
    };
  }
  
  if (matchingSheets.length === 1) {
    return {
      sheet: matchingSheets[0],
      status: 'found',
      reason: 'UNIQUE_SHEET_FOUND'
    };
  }
  
  // DUPLICAT : plusieurs feuilles pour la même personne/semaine
  return {
    sheet: null,
    status: 'duplicate',
    reason: 'DUPLICATE_WEEKLY_SHEET',
    duplicates: matchingSheets
  };
}

// ============================================================================
// HIÉRARCHIE : RESPONSABLE DIRECT
// ============================================================================

/**
 * Obtient le responsable direct d'un membre
 * 
 * CONTRAT :
 * - Utilise Team.responsable (relation directe)
 * - Ne PAS utiliser agents_geres (formule)
 * - Retourne null si pas de responsable
 * 
 * @param {number} memberId - ID du membre
 * @param {Array} team - Tous les membres (Team)
 * @returns {number|null} ID du responsable direct
 */
function getDirectManagerId(memberId, team) {
  if (!memberId || !team) return null;
  
  const member = Array.isArray(team) ? team.find(m => m.id === memberId) : null;
  
  if (!member) return null;
  
  const managerId = member.responsable;
  
  // Vérifier que le responsable existe dans l'équipe
  if (!managerId || managerId === 0) return null;
  
  const managerExists = team.some(m => m.id === managerId);
  if (!managerExists) return null;
  
  return managerId;
}

/**
 * Obtient les subordonnés directs d'un manager
 * 
 * CONTRAT :
 * - Utilise Team.responsable (relation directe)
 * - Retourne les membres dont responsable = managerId
 * 
 * @param {number} managerId - ID du manager
 * @param {Array} team - Tous les membres (Team)
 * @returns {Array<number>} IDs des subordonnés directs
 */
function getDirectReportIds(managerId, team) {
  if (!managerId || !team) return [];
  
  return team
    .filter(m => m.responsable === managerId)
    .map(m => m.id);
}

/**
 * Vérifie si un membre est le responsable direct d'un autre
 * @param {number} managerId - ID du manager présumé
 * @param {number} memberId - ID du membre
 * @param {Array} team - Tous les membres (Team)
 * @returns {boolean} true si managerId est le responsable direct de memberId
 */
function isDirectManager(managerId, memberId, team) {
  if (!managerId || !memberId) return false;
  const actualManager = getDirectManagerId(memberId, team);
  return actualManager === managerId;
}

// ============================================================================
// AUTORISATIONS : SOUMISSION
// ============================================================================

/**
 * Contexte pour les vérifications d'autorisation
 * @typedef {Object} SheetContext
 * @property {number} actorMemberId - ID de l'acteur (S.currentUserMemberId)
 * @property {Object} sheet - Feuille concernée
 * @property {Array} team - Tous les membres (Team)
 * @property {Array} sheets - Toutes les feuilles (Feuilles)
 */

/**
 * Vérifie si un acteur peut soumettre une feuille
 * 
 * RÈGLES :
 * 1. Acteur identifié (non null)
 * 2. Acteur = membre de la feuille
 * 3. Feuille en brouillon ou rejetée
 * 4. Pas de doublon de feuille
 * 
 * @param {SheetContext} context - Contexte d'autorisation
 * @returns {{ 
 *   can: boolean, 
 *   reason: string,
 *   code: string 
 * }}
 */
function canSubmitSheet(context) {
  const { actorMemberId, sheet, team, sheets } = context || {};
  
  // 1. Acteur identifié
  if (!actorMemberId) {
    return {
      can: false,
      reason: 'Acteur non identifié',
      code: 'ACTOR_NOT_IDENTIFIED'
    };
  }
  
  // 2. Feuille fournie
  if (!sheet) {
    return {
      can: false,
      reason: 'Aucune feuille à soumettre',
      code: 'NO_SHEET'
    };
  }
  
  // 3. Acteur = membre de la feuille
  if (sheet.membre !== actorMemberId) {
    return {
      can: false,
      reason: 'Seul le propriétaire de la feuille peut la soumettre',
      code: 'NOT_SHEET_OWNER'
    };
  }
  
  // 4. Statut éditable (brouillon ou rejetée)
  const status = normalizeSheetStatus(sheet.statut);
  if (!EDITABLE_STATUSES.includes(status)) {
    return {
      can: false,
      reason: 'Feuille non éditable (statut: ' + status + ')',
      code: 'SHEET_NOT_EDITABLE'
    };
  }
  
  // 5. Vérifier l'unicité (diagnostic de doublons)
  const weekStartIso = gristDateToIso(sheet.semaine);
  const uniquenessCheck = findUniqueSheetForWeek(actorMemberId, weekStartIso, sheets);
  
  if (uniquenessCheck.status === 'duplicate') {
    return {
      can: false,
      reason: 'Plusieurs feuilles existent pour cette personne et cette semaine',
      code: 'DUPLICATE_WEEKLY_SHEET'
    };
  }
  
  return {
    can: true,
    reason: 'Autorisé',
    code: 'OK'
  };
}

/**
 * Vérifie si un acteur peut retirer sa soumission
 * 
 * RÈGLES :
 * 1. Acteur identifié
 * 2. Acteur = membre de la feuille
 * 3. Feuille soumise (pas validée, pas rejetée)
 * 
 * @param {SheetContext} context - Contexte d'autorisation
 * @returns {{ can: boolean, reason: string, code: string }}
 */
function canWithdrawSheet(context) {
  const { actorMemberId, sheet } = context || {};
  
  if (!actorMemberId) {
    return {
      can: false,
      reason: 'Acteur non identifié',
      code: 'ACTOR_NOT_IDENTIFIED'
    };
  }
  
  if (!sheet) {
    return {
      can: false,
      reason: 'Aucune feuille',
      code: 'NO_SHEET'
    };
  }
  
  if (sheet.membre !== actorMemberId) {
    return {
      can: false,
      reason: 'Seul le propriétaire peut retirer sa soumission',
      code: 'NOT_SHEET_OWNER'
    };
  }
  
  const status = normalizeSheetStatus(sheet.statut);
  if (status !== SHEET_STATUS.SUBMITTED) {
    return {
      can: false,
      reason: 'Feuille non soumise (statut: ' + status + ')',
      code: 'SHEET_NOT_SUBMITTED'
    };
  }
  
  return {
    can: true,
    reason: 'Autorisé',
    code: 'OK'
  };
}

// ============================================================================
// AUTORISATIONS : VALIDATION
// ============================================================================

/**
 * Vérifie si un acteur peut valider une feuille
 * 
 * RÈGLES :
 * 1. Acteur identifié
 * 2. Feuille soumise
 * 3. Acteur ≠ membre de la feuille (auto-validation interdite)
 * 4. Acteur = responsable direct du membre
 * 5. Pas de doublon de feuille
 * 
 * @param {SheetContext} context - Contexte d'autorisation
 * @returns {{ can: boolean, reason: string, code: string }}
 */
function canValidateSheet(context) {
  const { actorMemberId, sheet, team, sheets } = context || {};
  
  // 1. Acteur identifié
  if (!actorMemberId) {
    return {
      can: false,
      reason: 'Acteur non identifié',
      code: 'ACTOR_NOT_IDENTIFIED'
    };
  }
  
  // 2. Feuille fournie
  if (!sheet) {
    return {
      can: false,
      reason: 'Aucune feuille à valider',
      code: 'NO_SHEET'
    };
  }
  
  // 3. Statut = soumis
  const status = normalizeSheetStatus(sheet.statut);
  if (status !== SHEET_STATUS.SUBMITTED) {
    return {
      can: false,
      reason: 'Feuille non soumise (statut: ' + status + ')',
      code: 'SHEET_NOT_SUBMITTED'
    };
  }
  
  // 4. Auto-validation interdite
  if (sheet.membre === actorMemberId) {
    return {
      can: false,
      reason: 'Auto-validation interdite',
      code: 'SELF_VALIDATION_FORBIDDEN'
    };
  }
  
  // 5. Acteur = responsable direct du membre
  const actualManager = getDirectManagerId(sheet.membre, team);
  if (actualManager !== actorMemberId) {
    return {
      can: false,
      reason: 'Seul le responsable direct peut valider',
      code: 'NOT_DIRECT_MANAGER'
    };
  }
  
  // 6. Vérifier l'unicité (diagnostic de doublons)
  const weekStartIso = gristDateToIso(sheet.semaine);
  const uniquenessCheck = findUniqueSheetForWeek(sheet.membre, weekStartIso, sheets);
  
  if (uniquenessCheck.status === 'duplicate') {
    return {
      can: false,
      reason: 'Plusieurs feuilles existent pour cette personne et cette semaine',
      code: 'DUPLICATE_WEEKLY_SHEET'
    };
  }
  
  return {
    can: true,
    reason: 'Autorisé',
    code: 'OK'
  };
}

// ============================================================================
// AUTORISATIONS : REJET
// ============================================================================

/**
 * Vérifie si un acteur peut rejeter une feuille
 * 
 * RÈGLES :
 * 1. Acteur identifié
 * 2. Feuille soumise
 * 3. Acteur ≠ membre de la feuille (auto-rejet interdit)
 * 4. Acteur = responsable direct du membre
 * 5. Motif de rejet non vide
 * 6. Pas de doublon de feuille
 * 
 * @param {SheetContext} context - Contexte d'autorisation
 * @returns {{ can: boolean, reason: string, code: string }}
 */
function canRejectSheet(context) {
  const { actorMemberId, sheet, team, sheets, rejectReason } = context || {};
  
  // 1. Acteur identifié
  if (!actorMemberId) {
    return {
      can: false,
      reason: 'Acteur non identifié',
      code: 'ACTOR_NOT_IDENTIFIED'
    };
  }
  
  // 2. Feuille fournie
  if (!sheet) {
    return {
      can: false,
      reason: 'Aucune feuille à rejeter',
      code: 'NO_SHEET'
    };
  }
  
  // 3. Statut = soumis
  const status = normalizeSheetStatus(sheet.statut);
  if (status !== SHEET_STATUS.SUBMITTED) {
    return {
      can: false,
      reason: 'Feuille non soumise (statut: ' + status + ')',
      code: 'SHEET_NOT_SUBMITTED'
    };
  }
  
  // 4. Auto-rejet interdit
  if (sheet.membre === actorMemberId) {
    return {
      can: false,
      reason: 'Auto-rejet interdit',
      code: 'SELF_REJECTION_FORBIDDEN'
    };
  }
  
  // 5. Acteur = responsable direct du membre
  const actualManager = getDirectManagerId(sheet.membre, team);
  if (actualManager !== actorMemberId) {
    return {
      can: false,
      reason: 'Seul le responsable direct peut rejeter',
      code: 'NOT_DIRECT_MANAGER'
    };
  }
  
  // 6. Motif de rejet requis
  if (!rejectReason || String(rejectReason).trim() === '') {
    return {
      can: false,
      reason: 'Motif de rejet requis',
      code: 'MISSING_REJECT_REASON'
    };
  }
  
  // 7. Vérifier l'unicité (diagnostic de doublons)
  const weekStartIso = gristDateToIso(sheet.semaine);
  const uniquenessCheck = findUniqueSheetForWeek(sheet.membre, weekStartIso, sheets);
  
  if (uniquenessCheck.status === 'duplicate') {
    return {
      can: false,
      reason: 'Plusieurs feuilles existent pour cette personne et cette semaine',
      code: 'DUPLICATE_WEEKLY_SHEET'
    };
  }
  
  return {
    can: true,
    reason: 'Autorisé',
    code: 'OK'
  };
}

// ============================================================================
// ACTIONS GRIST : SOUMISSION
// ============================================================================

/**
 * Construit les actions Grist pour une soumission de feuille
 * 
 * CONTRAT :
 * 1. Matérialiser toutes les propositions (heures = null → heures = heuresPrevues)
 * 2. Conserver les valeurs explicites (heures = 0 ou > 0)
 * 3. Rattacher toutes les TimeEntries à la feuille
 * 4. Passer la feuille en 'soumis'
 * 5. Un seul applyUserActions
 * 
 * @param {Object} params - Paramètres
 * @param {number} params.sheetId - ID de la feuille
 * @param {Array} params.timeEntries - TimeEntries de la semaine
 * @param {string} params.rejectReason - Motif de rejet (à effacer)
 * @returns {{ actions: Array, diagnostics: Array }}
 */
function buildSubmissionActions(params) {
  const { sheetId, timeEntries, rejectReason = '' } = params || {};
  const actions = [];
  const diagnostics = [];
  
  if (!sheetId) {
    return {
      actions: [],
      diagnostics: [{
        code: 'MISSING_SHEET_ID',
        message: 'ID de feuille requis pour la soumission'
      }]
    };
  }
  
  // 1. Mettre à jour toutes les TimeEntries
  for (const entry of timeEntries || []) {
    const fields = {};
    
    // Rattacher à la feuille si pas encore fait
    if (entry.feuille == null || entry.feuille === 0) {
      fields.feuille = sheetId;
    }
    
    // Matérialiser la proposition si pas de réalisé explicite
    if (!hasExplicitActual(entry)) {
      fields.heures = Number(entry.heuresPrevues) || 0;
    }
    
    // Appliquer la mise à jour si des champs ont changé
    if (Object.keys(fields).length > 0) {
      actions.push([
        'UpdateRecord',
        'TimeEntries',
        entry.id,
        fields
      ]);
    }
  }
  
  // 2. Mettre à jour la feuille
  const sheetUpdate = {
    statut: 'soumis',
    motifRejet: String(rejectReason).trim() === '' ? '' : ''
  };
  
  actions.push([
    'UpdateRecord',
    'Feuilles',
    sheetId,
    sheetUpdate
  ]);
  
  return {
    actions,
    diagnostics
  };
}

/**
 * Construit les actions Grist pour un retrait de soumission
 * @param {Object} params - Paramètres
 * @param {number} params.sheetId - ID de la feuille
 * @returns {{ actions: Array }}
 */
function buildWithdrawActions(params) {
  const { sheetId } = params || {};
  const actions = [];
  
  if (!sheetId) {
    return { actions: [] };
  }
  
  actions.push([
    'UpdateRecord',
    'Feuilles',
    sheetId,
    {
      statut: 'brouillon'
    }
  ]);
  
  return { actions };
}

// ============================================================================
// ACTIONS GRIST : VALIDATION
// ============================================================================

/**
 * Construit les actions Grist pour une validation de feuille
 * 
 * CONTRAT :
 * 1. Ne JAMAIS modifier les TimeEntries
 * 2. Mettre à jour uniquement la feuille
 * 3. Effacer motifRejet
 * 4. Positionner validePar et dateValidation
 * 
 * @param {Object} params - Paramètres
 * @param {number} params.sheetId - ID de la feuille
 * @param {number} params.validatorId - ID du validateur (actorMemberId)
 * @param {number} params.validationDate - Timestamp de validation
 * @returns {{ actions: Array, diagnostics: Array }}
 */
function buildValidationAction(params) {
  const { sheetId, validatorId, validationDate } = params || {};
  const actions = [];
  const diagnostics = [];
  
  if (!sheetId) {
    return {
      actions: [],
      diagnostics: [{
        code: 'MISSING_SHEET_ID',
        message: 'ID de feuille requis pour la validation'
      }]
    };
  }
  
  if (!validatorId) {
    return {
      actions: [],
      diagnostics: [{
        code: 'MISSING_VALIDATOR_ID',
        message: 'ID du validateur requis'
      }]
    };
  }
  
  actions.push([
    'UpdateRecord',
    'Feuilles',
    sheetId,
    {
      statut: 'valide',
      validePar: validatorId,
      dateValidation: validationDate || Math.floor(Date.now() / 1000),
      motifRejet: ''
    }
  ]);
  
  return {
    actions,
    diagnostics
  };
}

// ============================================================================
// ACTIONS GRIST : REJET
// ============================================================================

/**
 * Construit les actions Grist pour un rejet de feuille
 * 
 * CONTRAT :
 * 1. Ne JAMAIS modifier les TimeEntries
 * 2. Ne JAMAIS effacer les heures réalisées
 * 3. Mettre à jour uniquement la feuille
 * 4. Positionner statut, motifRejet
 * 5. Effacer validePar et dateValidation
 * 
 * @param {Object} params - Paramètres
 * @param {number} params.sheetId - ID de la feuille
 * @param {string} params.rejectReason - Motif de rejet (obligatoire)
 * @returns {{ actions: Array, diagnostics: Array }}
 */
function buildRejectionAction(params) {
  const { sheetId, rejectReason } = params || {};
  const actions = [];
  const diagnostics = [];
  
  if (!sheetId) {
    return {
      actions: [],
      diagnostics: [{
        code: 'MISSING_SHEET_ID',
        message: 'ID de feuille requis pour le rejet'
      }]
    };
  }
  
  if (!rejectReason || String(rejectReason).trim() === '') {
    return {
      actions: [],
      diagnostics: [{
        code: 'MISSING_REJECT_REASON',
        message: 'Motif de rejet requis'
      }]
    };
  }
  
  actions.push([
    'UpdateRecord',
    'Feuilles',
    sheetId,
    {
      statut: 'rejete',
      motifRejet: String(rejectReason).trim(),
      validePar: null,
      dateValidation: null
    }
  ]);
  
  return {
    actions,
    diagnostics
  };
}

// ============================================================================
// HELPERS : DATES
// ============================================================================

/**
 * Convertit une date ISO (YYYY-MM-DD) en timestamp Grist (secondes)
 * @param {string} isoDate - Date ISO
 * @returns {number} Timestamp Grist
 */
function isoToGristDate(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') return null;
  
  const date = parseDateUTC(isoDate);
  if (!date) return null;
  
  return Math.floor(date.getTime() / 1000);
}

/**
 * Convertit une date Grist (secondes) en ISO (YYYY-MM-DD)
 * @param {number} gristDate - Timestamp Grist
 * @returns {string} Date ISO
 */
function gristDateToIso(gristDate) {
  if (gristDate === null || gristDate === undefined || gristDate === '') return null;
  
  if (typeof gristDate === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(gristDate)) {
      return gristDate;
    }
    gristDate = Number(gristDate);
  }
  
  if (typeof gristDate === 'number' && Number.isFinite(gristDate)) {
    const date = new Date(gristDate * 1000);
    if (!isNaN(date.getTime())) {
      return formatDateUTC(date);
    }
  }
  
  return null;
}

/**
 * Parse une date YYYY-MM-DD en objet Date UTC
 * @param {string} dateStr - Date au format YYYY-MM-DD
 * @returns {Date|null} Date UTC
 */
function parseDateUTC(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  
  if (formatDateUTC(date) !== dateStr) return null;
  
  return date;
}

/**
 * Formate une Date en YYYY-MM-DD UTC
 * @param {Date} date - Date à formater
 * @returns {string} Date au format YYYY-MM-DD
 */
function formatDateUTC(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

module.exports = {
  // Constantes
  SHEET_STATUS,
  GRIST_STATUS_MAPPING,
  EDITABLE_STATUSES,
  LOCKED_STATUSES,
  TERMINAL_STATUSES,
  
  // Statuts
  normalizeSheetStatus,
  isSheetEditable,
  isSheetLocked,
  isSheetTerminal,
  
  // Null / 0 / Réalisé
  hasExplicitActual,
  hasExplicitActualHours,
  
  // Unicité
  findUniqueSheetForWeek,
  
  // Hiérarchie
  getDirectManagerId,
  getDirectReportIds,
  isDirectManager,
  
  // Autorisations : Soumission
  canSubmitSheet,
  canWithdrawSheet,
  
  // Autorisations : Validation
  canValidateSheet,
  
  // Autorisations : Rejet
  canRejectSheet,
  
  // Actions Grist
  buildSubmissionActions,
  buildWithdrawActions,
  buildValidationAction,
  buildRejectionAction,
  
  // Helpers dates
  isoToGristDate,
  gristDateToIso,
  parseDateUTC,
  formatDateUTC
};
