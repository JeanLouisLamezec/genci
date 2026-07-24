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
  REJECTED: 'rejected',
  MANAGER_CORRECTION: 'manager_correction'
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
  'correction_manager': SHEET_STATUS.MANAGER_CORRECTION,
  // Anglais
  'draft': SHEET_STATUS.DRAFT,
  'submitted': SHEET_STATUS.SUBMITTED,
  'validated': SHEET_STATUS.VALIDATED,
  'rejected': SHEET_STATUS.REJECTED,
  'manager_correction': SHEET_STATUS.MANAGER_CORRECTION
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
 * Note: correction_manager est verrouillé pour le propriétaire mais éditable par le manager
 */
const LOCKED_STATUSES = [
  SHEET_STATUS.SUBMITTED,
  SHEET_STATUS.VALIDATED,
  SHEET_STATUS.MANAGER_CORRECTION
];

/**
 * Statuts terminaux (workflow normal, aucune transition sortante)
 * Note: une transition administrative exceptionnelle reste possible vers correction_manager
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

/**
 * Vérifie si une feuille est en correction manager
 * @param {Object} sheet - Feuille avec statut
 * @returns {boolean} true si en correction manager
 */
function isSheetManagerCorrection(sheet) {
  if (!sheet) return false;
  const status = normalizeSheetStatus(sheet.statut);
  return status === SHEET_STATUS.MANAGER_CORRECTION;
}

/**
 * Vérifie si une feuille est éditable par son propriétaire
 * @param {Object} sheet - Feuille avec statut
 * @returns {boolean} true si éditable par le propriétaire
 */
function isSheetOwnerEditable(sheet) {
  if (!sheet) return false;
  const status = normalizeSheetStatus(sheet.statut);
  return EDITABLE_STATUSES.includes(status);
}

/**
 * Vérifie si une feuille est éditable par le manager (uniquement en correction_manager)
 * @param {Object} sheet - Feuille avec statut
 * @returns {boolean} true si éditable par le manager
 */
function isSheetManagerEditable(sheet) {
  if (!sheet) return false;
  const status = normalizeSheetStatus(sheet.statut);
  return status === SHEET_STATUS.MANAGER_CORRECTION;
}

// ============================================================================
// HELPERS : NORMALISATION DES IDS ET RÉVISIONS
// ============================================================================

/**
 * Normalise un ID de membre (numérique ou référence Grist)
 * Seuls sont valides : un nombre entier strictement positif ou une chaîne contenant uniquement un entier strictement positif
 * @param {*} value - ID à normaliser
 * @returns {number|null} ID numérique ou null
 */
function normalizeMemberId(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  if (
    typeof value === 'string' &&
    !/^[1-9]\d*$/.test(value)
  ) {
    return null;
  }

  const numeric = Number(value);

  return (
    Number.isInteger(numeric) &&
    numeric > 0
  )
    ? numeric
    : null;
}

/**
 * Normalise une valeur de révision (entier >= 0)
 * @param {*} value - Valeur à normaliser
 * @returns {number} Entier >= 0 (0 par défaut si invalide)
 */
function normalizeRevision(value) {
  const numeric = Number(value);
  return (
    Number.isInteger(numeric) &&
    numeric >= 0
  ) ? numeric : 0;
}

/**
 * Valide un timestamp Unix (fini, positif et entier)
 * @param {*} value - Valeur à valider
 * @returns {{ valid: boolean, value?: number, code?: string }}
 */
function validateUnixTimestamp(value) {
  if (value === null || value === undefined) {
    return { valid: false, code: 'INVALID_NOW_UNIX_SECONDS' };
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || !Number.isInteger(numeric)) {
    return { valid: false, code: 'INVALID_NOW_UNIX_SECONDS' };
  }
  return { valid: true, value: numeric };
}

/**
 * Calcule le lundi de la semaine civile contenant la date donnée
 * @param {*} dateValue - Date (Grist timestamp, ISO string, ou Date)
 * @returns {string|null} Date ISO YYYY-MM-DD du lundi ou null
 */
function getWeekStartIso(dateValue) {
  const date = normalizeDateValue(dateValue);
  if (!date) return null;

  const dayOfWeek = date.getUTCDay();
  const offset = (dayOfWeek === 0) ? 6 : (dayOfWeek - 1);
  const monday = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - offset
  ));

  return formatDateUTC(monday);
}

/**
 * Normalise une valeur de date vers un objet Date UTC
 * @param {*} value - Valeur Grist
 * @returns {Date|null} Date UTC ou null
 */
function normalizeDateValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parts = value.split('-').map(Number);
      return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    }
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 10000000000 ? value * 1000 : value;
    const date = new Date(ms);
    return isNaN(date.getTime()) ? null : date;
  }

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  return null;
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

  const normalizedMemberId = normalizeMemberId(memberId);

  const matchingSheets = (sheets || []).filter(s => {
    if (normalizeMemberId(s.membre) !== normalizedMemberId) return false;

    const sheetWeekIso = getWeekStartIso(s.semaine);
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

  const normalizedMemberId = normalizeMemberId(memberId);
  const member = Array.isArray(team) ? team.find(m => normalizeMemberId(m.id) === normalizedMemberId) : null;

  if (!member) return null;

  const managerId = normalizeMemberId(member.responsable);

  // Vérifier que le responsable existe dans l'équipe
  if (!managerId) return null;

  const managerExists = team.some(m => normalizeMemberId(m.id) === managerId);
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

  const normalizedManagerId = normalizeMemberId(managerId);

  return team
    .filter(m => normalizeMemberId(m.responsable) === normalizedManagerId)
    .map(m => normalizeMemberId(m.id))
    .filter(id => id !== null);
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
  return actualManager === normalizeMemberId(managerId);
}

// ============================================================================
// HELPERS : RESPONSABLE VALIDATION (SNAPSHOT)
// ============================================================================

/**
 * Obtient le responsable de validation attendu pour une feuille
 *
 * CONTRAT :
 * - Utilise uniquement responsableValidation (photographie au moment de la soumission)
 * - Ne PAS utiliser Team.responsable pour les feuilles soumises/validées
 * - Retourne null si responsableValidation absent
 *
 * @param {Object} sheet - Feuille avec responsableValidation
 * @returns {number|null} ID du responsable de validation attendu
 */
function getExpectedValidationManagerId(sheet) {
  if (!sheet) return null;
  return normalizeMemberId(sheet.responsableValidation);
}

/**
 * Vérifie si un acteur est le responsable de validation attendu
 *
 * CONTRAT :
 * - Compare les IDs normalisés
 * - Accepte les IDs numériques ou chaînes numériques
 *
 * @param {number} actorMemberId - ID de l'acteur
 * @param {Object} sheet - Feuille avec responsableValidation
 * @returns {boolean} true si l'acteur est le responsable attendu
 */
function isExpectedValidationManager(actorMemberId, sheet) {
  if (!actorMemberId || !sheet) return false;
  const expectedManager = getExpectedValidationManagerId(sheet);
  if (expectedManager === null) return false;
  return normalizeMemberId(actorMemberId) === expectedManager;
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
 * Vérifie si les TimeEntries appartiennent à la feuille
 *
 * CONTRAT :
 * - Chaque entrée doit avoir un ID valide
 * - Chaque entrée doit appartenir au même membre que la feuille
 * - Chaque entrée doit appartenir à la même semaine que la feuille
 * - Chaque entrée doit être rattachée à cette feuille
 *
 * @param {Object} context - Contexte avec sheet et timeEntries
 * @returns {{ valid: boolean, errors: Array }}
 */
function validateEntriesBelongToSheet(context) {
  const { sheet, timeEntries } = context || {};
  const errors = [];

  if (!sheet || !timeEntries || timeEntries.length === 0) {
    return { valid: true, errors: [] };
  }

  const sheetMemberId = normalizeMemberId(sheet.membre);
  const sheetWeekStartIso = getWeekStartIso(sheet.semaine);
  const sheetId = normalizeMemberId(sheet.id);

  for (let i = 0; i < timeEntries.length; i++) {
    const entry = timeEntries[i];
    const entryId = normalizeMemberId(entry.id);
    const entryMemberId = normalizeMemberId(entry.membre);
    const entryWeekStartIso = getWeekStartIso(entry.date);
    const entrySheetId = normalizeMemberId(entry.feuille);

    // 1. ID valide
    if (entryId === null) {
      errors.push({
        code: 'TIME_ENTRY_ID_INVALID',
        entry: entry,
        index: i,
        message: 'TimeEntry sans ID valide'
      });
      continue;
    }

    // 2. Membre valide
    if (entryMemberId === null) {
      errors.push({
        code: 'TIME_ENTRY_MEMBER_INVALID',
        entryId: entryId,
        entry: entry,
        index: i,
        message: 'TimeEntry sans membre valide'
      });
      continue;
    }

    // 3. Membre = membre de la feuille
    if (entryMemberId !== sheetMemberId) {
      errors.push({
        code: 'TIME_ENTRY_MEMBER_MISMATCH',
        entryId: entryId,
        entryMemberId: entryMemberId,
        sheetMemberId: sheetMemberId,
        entry: entry,
        index: i,
        message: 'TimeEntry n\'appartient pas au membre de la feuille'
      });
    }

    // 4. Semaine = semaine de la feuille
    if (entryWeekStartIso !== sheetWeekStartIso) {
      errors.push({
        code: 'TIME_ENTRY_WEEK_MISMATCH',
        entryId: entryId,
        entryWeek: entryWeekStartIso,
        sheetWeek: sheetWeekStartIso,
        entry: entry,
        index: i,
        message: 'TimeEntry n\'appartient pas à la semaine de la feuille'
      });
    }

    // 5. Feuille = cette feuille (seulement si feuille est renseigné)
    if (entrySheetId === null) {
      errors.push({
        code: 'TIME_ENTRY_SHEET_MISMATCH',
        entryId: entryId,
        entrySheetId: null,
        sheetId: sheetId,
        entry: entry,
        index: i,
        message: 'TimeEntry n\'est pas rattachée à une feuille'
      });
    } else if (entrySheetId !== sheetId) {
      errors.push({
        code: 'TIME_ENTRY_SHEET_MISMATCH',
        entryId: entryId,
        entrySheetId: entrySheetId,
        sheetId: sheetId,
        entry: entry,
        index: i,
        message: 'TimeEntry n\'est pas rattachée à cette feuille'
      });
    }

    // 6. Heures prévues valides (si heures non renseigné)
    if (!hasExplicitActual(entry)) {
      const plannedHours = entry.heuresPrevues;
      const hasValidPlanned = plannedHours !== null && plannedHours !== undefined && plannedHours !== '' && Number.isFinite(Number(plannedHours));
      if (!hasValidPlanned) {
        errors.push({
          code: 'TIME_ENTRY_PLANNED_HOURS_INVALID',
          entryId: entryId,
          entry: entry,
          index: i,
          message: 'TimeEntry sans heures réalisées et sans heures prévues valides'
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Vérifie si un acteur peut soumettre une feuille
 *
 * RÈGLES :
 * 1. Acteur identifié (non null)
 * 2. Acteur = membre de la feuille
 * 3. Feuille en brouillon ou rejetée
 * 4. Pas de doublon de feuille
 * 5. Responsable direct valide
 * 6. Responsable différent du propriétaire
 * 7. Toutes les TimeEntries appartiennent à la feuille
 *
 * @param {SheetContext} context - Contexte d'autorisation
 * @returns {{
 *   can: boolean,
 *   reason: string,
 *   code: string
 * }}
 */
function canSubmitSheet(context) {
  const { actorMemberId, sheet, team, sheets, timeEntries } = context || {};

  // 1. Acteur identifié
  const actorId = normalizeMemberId(actorMemberId);
  if (actorId === null) {
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

  const sheetId = normalizeMemberId(sheet.id);
  if (sheetId === null) {
    return {
      can: false,
      reason: 'Feuille sans ID valide',
      code: 'SHEET_ID_INVALID'
    };
  }

  const sheetMemberId = normalizeMemberId(sheet.membre);

  // 3. Acteur = membre de la feuille
  if (actorId !== sheetMemberId) {
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
  const weekStartIso = getWeekStartIso(sheet.semaine);
  const uniquenessCheck = findUniqueSheetForWeek(actorId, weekStartIso, sheets);

  if (uniquenessCheck.status === 'duplicate') {
    return {
      can: false,
      reason: 'Plusieurs feuilles existent pour cette personne et cette semaine',
      code: 'DUPLICATE_WEEKLY_SHEET'
    };
  }
  if (uniquenessCheck.status === 'none') {
    return {
      can: false,
      reason: 'Feuille introuvable ou dupliquée',
      code: 'SHEET_NOT_FOUND_IN_COLLECTION'
    };
  }
  if (uniquenessCheck.status === 'found') {
    const foundSheetId = normalizeMemberId(uniquenessCheck.sheet.id);
    const contextSheetId = normalizeMemberId(sheet.id);
    if (foundSheetId !== contextSheetId) {
      return {
        can: false,
        reason: 'Incohérence de contexte de feuille',
        code: 'SHEET_CONTEXT_MISMATCH'
      };
    }
  }

  // 6. Trouver le responsable direct
  const managerId = getDirectManagerId(sheetMemberId, team);

  if (managerId === null) {
    return {
      can: false,
      reason: 'Aucun responsable de validation trouvé',
      code: 'NO_VALIDATION_MANAGER'
    };
  }

  // 7. Vérifier que le responsable n'est pas le membre lui-même
  if (managerId === sheetMemberId) {
    return {
      can: false,
      reason: 'Le responsable ne peut pas être le membre lui-même',
      code: 'SELF_MANAGER_INVALID'
    };
  }

  // 8. Vérifier les TimeEntries si fournies
  if (timeEntries && timeEntries.length > 0) {
    const validation = validateEntriesBelongToSheet({ sheet, timeEntries });
    if (!validation.valid) {
      const firstError = validation.errors[0];
      return {
        can: false,
        reason: firstError.message,
        code: firstError.code
      };
    }
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
  const { actorMemberId, sheet, sheets } = context || {};

  const actorId = normalizeMemberId(actorMemberId);
  if (actorId === null) {
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

  const sheetId = normalizeMemberId(sheet.id);
  if (sheetId === null) {
    return {
      can: false,
      reason: 'Feuille sans ID valide',
      code: 'SHEET_ID_INVALID'
    };
  }

  if (normalizeMemberId(sheet.membre) !== actorId) {
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

  if (sheet.validePar != null || sheet.dateValidation != null) {
    return {
      can: false,
      reason: 'Feuille déjà validée',
      code: 'SHEET_ALREADY_VALIDATED'
    };
  }

  const weekStartIso = getWeekStartIso(sheet.semaine);
  const uniquenessCheck = findUniqueSheetForWeek(normalizeMemberId(sheet.membre), weekStartIso, sheets);
  if (uniquenessCheck.status === 'duplicate') {
    return {
      can: false,
      reason: 'Plusieurs feuilles existent pour cette personne et cette semaine',
      code: 'DUPLICATE_WEEKLY_SHEET'
    };
  }
  if (uniquenessCheck.status === 'none') {
    return {
      can: false,
      reason: 'Feuille introuvable ou dupliquée',
      code: 'SHEET_NOT_FOUND_IN_COLLECTION'
    };
  }

  if (uniquenessCheck.status === 'found') {
    const foundSheetId = normalizeMemberId(uniquenessCheck.sheet.id);
    const contextSheetId = normalizeMemberId(sheet.id);
    if (foundSheetId !== contextSheetId) {
      return {
        can: false,
        reason: 'Incohérence de contexte de feuille',
        code: 'SHEET_CONTEXT_MISMATCH'
      };
    }
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
 * 4. responsableValidation présent (photographie)
 * 5. Acteur = responsableValidation
 * 6. Pas de doublon de feuille
 * 7. Validation fonctionnelle réussie (optionnel)
 *
 * @param {SheetContext} context - Contexte d'autorisation
 * @returns {{ can: boolean, reason: string, code: string }}
 */
function canValidateSheet(context) {
  const { actorMemberId, sheet, sheets, validationResult } = context || {};

  // 1. Acteur identifié
  const actorId = normalizeMemberId(actorMemberId);
  if (actorId === null) {
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

  const sheetId = normalizeMemberId(sheet.id);
  if (sheetId === null) {
    return {
      can: false,
      reason: 'Feuille sans ID valide',
      code: 'SHEET_ID_INVALID'
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
  if (normalizeMemberId(sheet.membre) === actorId) {
    return {
      can: false,
      reason: 'Auto-validation interdite',
      code: 'SELF_VALIDATION_FORBIDDEN'
    };
  }

  // 5. responsableValidation présent (photographie)
  const expectedManager = getExpectedValidationManagerId(sheet);
  if (expectedManager === null) {
    return {
      can: false,
      reason: 'responsableValidation absent (photographie manquante)',
      code: 'VALIDATION_MANAGER_SNAPSHOT_MISSING'
    };
  }

  // 6. Acteur = responsableValidation
  if (!isExpectedValidationManager(actorMemberId, sheet)) {
    return {
      can: false,
      reason: 'Seul le responsable de validation photographié peut valider',
      code: 'NOT_EXPECTED_VALIDATION_MANAGER'
    };
  }

  // 7. Vérifier l'unicité (diagnostic de doublons)
  const weekStartIso = getWeekStartIso(sheet.semaine);
  const uniquenessCheck = findUniqueSheetForWeek(normalizeMemberId(sheet.membre), weekStartIso, sheets);

  if (uniquenessCheck.status === 'duplicate') {
    return {
      can: false,
      reason: 'Plusieurs feuilles existent pour cette personne et cette semaine',
      code: 'DUPLICATE_WEEKLY_SHEET'
    };
  }
  if (uniquenessCheck.status === 'none') {
    return {
      can: false,
      reason: 'Feuille introuvable ou dupliquée',
      code: 'SHEET_NOT_FOUND_IN_COLLECTION'
    };
  }
  if (uniquenessCheck.status === 'found') {
    const foundSheetId = normalizeMemberId(uniquenessCheck.sheet.id);
    const contextSheetId = normalizeMemberId(sheet.id);
    if (foundSheetId !== contextSheetId) {
      return {
        can: false,
        reason: 'Incohérence de contexte de feuille',
        code: 'SHEET_CONTEXT_MISMATCH'
      };
    }
  }

  // 8. Validation fonctionnelle (obligatoire)
  if (!validationResult || validationResult.valid !== true) {
    return {
      can: false,
      reason: validationResult
        ? 'Validation fonctionnelle échouée'
        : 'Résultat de validation requis',
      code: validationResult
        ? 'TIMESHEET_VALIDATION_FAILED'
        : 'VALIDATION_RESULT_MISSING'
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
 * 4. responsableValidation présent (photographie)
 * 5. Acteur = responsableValidation
 * 6. Motif de rejet non vide
 * 7. Pas de doublon de feuille
 *
 * @param {SheetContext} context - Contexte d'autorisation
 * @returns {{ can: boolean, reason: string, code: string }}
 */
function canRejectSheet(context) {
  const { actorMemberId, sheet, sheets, rejectReason } = context || {};

  // 1. Acteur identifié
  const actorId = normalizeMemberId(actorMemberId);
  if (actorId === null) {
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

  const sheetId = normalizeMemberId(sheet.id);
  if (sheetId === null) {
    return {
      can: false,
      reason: 'Feuille sans ID valide',
      code: 'SHEET_ID_INVALID'
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
  if (normalizeMemberId(sheet.membre) === actorId) {
    return {
      can: false,
      reason: 'Auto-rejet interdit',
      code: 'SELF_REJECTION_FORBIDDEN'
    };
  }

  // 5. responsableValidation présent (photographie)
  const expectedManager = getExpectedValidationManagerId(sheet);
  if (expectedManager === null) {
    return {
      can: false,
      reason: 'responsableValidation absent (photographie manquante)',
      code: 'VALIDATION_MANAGER_SNAPSHOT_MISSING'
    };
  }

  // 6. Acteur = responsableValidation
  if (!isExpectedValidationManager(actorMemberId, sheet)) {
    return {
      can: false,
      reason: 'Seul le responsable de validation photographié peut rejeter',
      code: 'NOT_EXPECTED_VALIDATION_MANAGER'
    };
  }

  // 7. Motif de rejet requis
  if (!rejectReason || String(rejectReason).trim() === '') {
    return {
      can: false,
      reason: 'Motif de rejet requis',
      code: 'MISSING_REJECT_REASON'
    };
  }

  // 8. Vérifier l'unicité (diagnostic de doublons)
  const weekStartIso = getWeekStartIso(sheet.semaine);
  const uniquenessCheck = findUniqueSheetForWeek(normalizeMemberId(sheet.membre), weekStartIso, sheets);

  if (uniquenessCheck.status === 'duplicate') {
    return {
      can: false,
      reason: 'Plusieurs feuilles existent pour cette personne et cette semaine',
      code: 'DUPLICATE_WEEKLY_SHEET'
    };
  }
  if (uniquenessCheck.status === 'none') {
    return {
      can: false,
      reason: 'Feuille introuvable ou dupliquée',
      code: 'SHEET_NOT_FOUND_IN_COLLECTION'
    };
  }
  if (uniquenessCheck.status === 'found') {
    const foundSheetId = normalizeMemberId(uniquenessCheck.sheet.id);
    const contextSheetId = normalizeMemberId(sheet.id);
    if (foundSheetId !== contextSheetId) {
      return {
        can: false,
        reason: 'Incohérence de contexte de feuille',
        code: 'SHEET_CONTEXT_MISMATCH'
      };
    }
  }

  return {
    can: true,
    reason: 'Autorisé',
    code: 'OK'
  };
}

// ============================================================================
// AUTORISATIONS : CORRECTION MANAGER
// ============================================================================

/**
 * Vérifie si un acteur peut ouvrir une correction manager
 *
 * RÈGLES :
 * 1. Acteur identifié
 * 2. Feuille validée
 * 3. Acteur ≠ membre de la feuille
 * 4. responsableValidation présent (photographie)
 * 5. Acteur = responsableValidation
 * 6. Motif de correction obligatoire
 * 7. Pas de doublon de feuille
 *
 * @param {SheetContext} context - Contexte d'autorisation
 * @returns {{ can: boolean, reason: string, code: string }}
 */
function canOpenManagerCorrection(context) {
  const { actorMemberId, sheet, sheets, correctionReason } = context || {};

  // 1. Acteur identifié
  const actorId = normalizeMemberId(actorMemberId);
  if (actorId === null) {
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
      reason: 'Aucune feuille',
      code: 'NO_SHEET'
    };
  }

  const sheetId = normalizeMemberId(sheet.id);
  if (sheetId === null) {
    return {
      can: false,
      reason: 'Feuille sans ID valide',
      code: 'SHEET_ID_INVALID'
    };
  }

  // 3. Statut = validée
  const status = normalizeSheetStatus(sheet.statut);
  if (status !== SHEET_STATUS.VALIDATED) {
    return {
      can: false,
      reason: 'Feuille non validée (statut: ' + status + ')',
      code: 'SHEET_NOT_VALIDATED'
    };
  }

  // 4. Auto-correction interdite
  if (normalizeMemberId(sheet.membre) === actorId) {
    return {
      can: false,
      reason: 'Auto-correction interdite',
      code: 'SELF_CORRECTION_FORBIDDEN'
    };
  }

  // 5. responsableValidation présent (photographie)
  const expectedManager = getExpectedValidationManagerId(sheet);
  if (expectedManager === null) {
    return {
      can: false,
      reason: 'responsableValidation absent (photographie manquante)',
      code: 'VALIDATION_MANAGER_SNAPSHOT_MISSING'
    };
  }

  // 6. Acteur = responsableValidation
  if (!isExpectedValidationManager(actorMemberId, sheet)) {
    return {
      can: false,
      reason: 'Seul le responsable de validation photographié peut ouvrir une correction',
      code: 'NOT_EXPECTED_VALIDATION_MANAGER'
    };
  }

  // 7. Motif de correction requis
  if (!correctionReason || String(correctionReason).trim() === '') {
    return {
      can: false,
      reason: 'Motif de correction requis',
      code: 'MISSING_CORRECTION_REASON'
    };
  }

  // 8. Vérifier l'unicité (diagnostic de doublons)
  const weekStartIso = getWeekStartIso(sheet.semaine);
  const uniquenessCheck = findUniqueSheetForWeek(normalizeMemberId(sheet.membre), weekStartIso, sheets);

  if (uniquenessCheck.status === 'duplicate') {
    return {
      can: false,
      reason: 'Plusieurs feuilles existent pour cette personne et cette semaine',
      code: 'DUPLICATE_WEEKLY_SHEET'
    };
  }
  if (uniquenessCheck.status === 'none') {
    return {
      can: false,
      reason: 'Feuille introuvable ou dupliquée',
      code: 'SHEET_NOT_FOUND_IN_COLLECTION'
    };
  }
  if (uniquenessCheck.status === 'found') {
    const foundSheetId = normalizeMemberId(uniquenessCheck.sheet.id);
    const contextSheetId = normalizeMemberId(sheet.id);
    if (foundSheetId !== contextSheetId) {
      return {
        can: false,
        reason: 'Incohérence de contexte de feuille',
        code: 'SHEET_CONTEXT_MISMATCH'
      };
    }
  }

  return {
    can: true,
    reason: 'Autorisé',
    code: 'OK'
  };
}

/**
 * Vérifie si un manager peut éditer une TimeEntry en mode correction
 *
 * RÈGLES :
 * 1. Acteur identifié
 * 2. Feuille en correction_manager
 * 3. Acteur ≠ membre de la feuille
 * 4. Acteur = responsableValidation
 * 5. TimeEntry fournie
 * 6. TimeEntry rattachée à la feuille
 * 7. Membre de la TimeEntry = membre de la feuille
 * 8. Semaine cohérente
 *
 * @param {Object} context - Contexte avec actorMemberId, sheet, timeEntry
 * @returns {{ can: boolean, reason: string, code: string }}
 */
function canManagerEditActual(context) {
  const { actorMemberId, sheet, timeEntry } = context || {};

  // 1. Acteur identifié
  const actorId = normalizeMemberId(actorMemberId);
  if (actorId === null) {
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
      reason: 'Aucune feuille',
      code: 'NO_SHEET'
    };
  }

  const sheetId = normalizeMemberId(sheet.id);
  if (sheetId === null) {
    return {
      can: false,
      reason: 'Feuille sans ID valide',
      code: 'SHEET_ID_INVALID'
    };
  }

  // 3. Statut = correction_manager
  const status = normalizeSheetStatus(sheet.statut);
  if (status !== SHEET_STATUS.MANAGER_CORRECTION) {
    return {
      can: false,
      reason: 'Feuille non en correction manager (statut: ' + status + ')',
      code: 'SHEET_NOT_IN_MANAGER_CORRECTION'
    };
  }

  // 4. Auto-édition interdite
  if (normalizeMemberId(sheet.membre) === actorId) {
    return {
      can: false,
      reason: 'Le propriétaire ne peut pas éditer en mode correction manager',
      code: 'SELF_EDIT_FORBIDDEN'
    };
  }

  // 5. responsableValidation présent
  const expectedManager = getExpectedValidationManagerId(sheet);
  if (expectedManager === null) {
    return {
      can: false,
      reason: 'responsableValidation absent',
      code: 'VALIDATION_MANAGER_SNAPSHOT_MISSING'
    };
  }

  // 6. Acteur = responsableValidation
  if (!isExpectedValidationManager(actorMemberId, sheet)) {
    return {
      can: false,
      reason: 'Seul le responsable de validation photographié peut éditer',
      code: 'NOT_EXPECTED_VALIDATION_MANAGER'
    };
  }

  // 7. TimeEntry fournie
  if (!timeEntry) {
    return {
      can: false,
      reason: 'Aucune TimeEntry fournie',
      code: 'NO_TIME_ENTRY'
    };
  }

  // 8. TimeEntry rattachée à la feuille
  const entrySheetId = normalizeMemberId(timeEntry.feuille);
  if (entrySheetId !== sheetId) {
    return {
      can: false,
      reason: 'TimeEntry non rattachée à cette feuille',
      code: 'TIME_ENTRY_SHEET_MISMATCH'
    };
  }

  // 9. Membre de la TimeEntry = membre de la feuille
  const entryMemberId = normalizeMemberId(timeEntry.membre);
  const sheetMemberId = normalizeMemberId(sheet.membre);
  if (entryMemberId !== sheetMemberId) {
    return {
      can: false,
      reason: 'TimeEntry n\'appartient pas au membre de la feuille',
      code: 'TIME_ENTRY_MEMBER_MISMATCH'
    };
  }

  // 10. Semaine cohérente
  const entryWeekIso = getWeekStartIso(timeEntry.date);
  const sheetWeekIso = getWeekStartIso(sheet.semaine);
  if (entryWeekIso !== sheetWeekIso) {
    return {
      can: false,
      reason: 'TimeEntry n\'appartient pas à la semaine de la feuille',
      code: 'TIME_ENTRY_WEEK_MISMATCH'
    };
  }

  return {
    can: true,
    reason: 'Autorisé',
    code: 'OK'
  };
}

/**
 * Vérifie si un acteur peut revalider une feuille après correction
 *
 * RÈGLES :
 * 1. Acteur identifié
 * 2. Feuille en correction_manager
 * 3. Acteur ≠ membre de la feuille
 * 4. responsableValidation présent
 * 5. Acteur = responsableValidation
 * 6. Validation fonctionnelle réussie
 * 7. Pas de doublon de feuille
 *
 * @param {SheetContext} context - Contexte d'autorisation
 * @returns {{ can: boolean, reason: string, code: string }}
 */
function canRevalidateSheet(context) {
  const { actorMemberId, sheet, sheets, validationResult } = context || {};

  // 1. Acteur identifié
  const actorId = normalizeMemberId(actorMemberId);
  if (actorId === null) {
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
      reason: 'Aucune feuille',
      code: 'NO_SHEET'
    };
  }

  const sheetId = normalizeMemberId(sheet.id);
  if (sheetId === null) {
    return {
      can: false,
      reason: 'Feuille sans ID valide',
      code: 'SHEET_ID_INVALID'
    };
  }

  // 3. Statut = correction_manager
  const status = normalizeSheetStatus(sheet.statut);
  if (status !== SHEET_STATUS.MANAGER_CORRECTION) {
    return {
      can: false,
      reason: 'Feuille non en correction manager (statut: ' + status + ')',
      code: 'SHEET_NOT_IN_MANAGER_CORRECTION'
    };
  }

  // 4. Auto-validation interdite
  if (normalizeMemberId(sheet.membre) === actorId) {
    return {
      can: false,
      reason: 'Auto-validation interdite',
      code: 'SELF_VALIDATION_FORBIDDEN'
    };
  }

  // 5. responsableValidation présent
  const expectedManager = getExpectedValidationManagerId(sheet);
  if (expectedManager === null) {
    return {
      can: false,
      reason: 'responsableValidation absent',
      code: 'VALIDATION_MANAGER_SNAPSHOT_MISSING'
    };
  }

  // 6. Acteur = responsableValidation
  if (!isExpectedValidationManager(actorMemberId, sheet)) {
    return {
      can: false,
      reason: 'Seul le responsable de validation photographié peut revalider',
      code: 'NOT_EXPECTED_VALIDATION_MANAGER'
    };
  }

  // 7. Validation fonctionnelle (obligatoire)
  if (!validationResult || validationResult.valid !== true) {
    return {
      can: false,
      reason: validationResult
        ? 'Validation fonctionnelle échouée'
        : 'Résultat de validation requis',
      code: validationResult
        ? 'TIMESHEET_VALIDATION_FAILED'
        : 'VALIDATION_RESULT_MISSING'
    };
  }

  // 8. Vérifier l'unicité (diagnostic de doublons)
  const weekStartIso = getWeekStartIso(sheet.semaine);
  const uniquenessCheck = findUniqueSheetForWeek(normalizeMemberId(sheet.membre), weekStartIso, sheets);

  if (uniquenessCheck.status === 'duplicate') {
    return {
      can: false,
      reason: 'Plusieurs feuilles existent pour cette personne et cette semaine',
      code: 'DUPLICATE_WEEKLY_SHEET'
    };
  }
  if (uniquenessCheck.status === 'none') {
    return {
      can: false,
      reason: 'Feuille introuvable ou dupliquée',
      code: 'SHEET_NOT_FOUND_IN_COLLECTION'
    };
  }
  if (uniquenessCheck.status === 'found') {
    const foundSheetId = normalizeMemberId(uniquenessCheck.sheet.id);
    const contextSheetId = normalizeMemberId(sheet.id);
    if (foundSheetId !== contextSheetId) {
      return {
        can: false,
        reason: 'Incohérence de contexte de feuille',
        code: 'SHEET_CONTEXT_MISMATCH'
      };
    }
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
 * 1. Appelle canSubmitSheet() en premier
 * 2. Si non autorisé, retourne { allowed: false, can: false, code, reason, actions: [], diagnostics: [], summary: {} }
 * 3. Si autorisé, calcule managerId depuis team et crée les actions
 * 4. Écrit à Feuilles: { statut: 'soumis', responsableValidation: managerId, soumisPar: actorMemberId, dateSoumission: nowUnixSeconds, validePar: null, dateValidation: null, motifRejet: '', motifCorrection: '', revisionValidation: existing || 0 }
 * 5. Ne répare PAS les liens feuille - c'est une erreur de validation
 * 6. Trie les actions TimeEntry par ID
 * 7. Retourne l'action Feuilles en dernier
 *
 * @param {Object} params - Paramètres
 * @param {number} params.actorMemberId - ID de l'acteur
 * @param {Object} params.sheet - Feuille
 * @param {Array} params.team - Tous les membres
 * @param {Array} params.sheets - Toutes les feuilles
 * @param {Array} params.timeEntries - TimeEntries de la semaine
 * @param {number} params.nowUnixSeconds - Timestamp actuel
 * @returns {{ allowed: boolean, can: boolean, code: string, reason: string, actions: Array, diagnostics: Array, summary: Object }}
 */
function buildSubmissionActions(params) {
  const { actorMemberId, sheet, team, sheets, timeEntries, nowUnixSeconds } = params || {};
  const actions = [];
  const diagnostics = [];
  const summary = {};

  if (!actorMemberId || !sheet) {
    return {
      allowed: false,
      can: false,
      code: 'MISSING_PARAMS',
      reason: 'Paramètres requis manquants',
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const timestampCheck = validateUnixTimestamp(nowUnixSeconds);
  if (!timestampCheck.valid) {
    return {
      allowed: false,
      can: false,
      code: timestampCheck.code,
      reason: 'Timestamp Unix invalide',
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const authCheck = canSubmitSheet({ actorMemberId, sheet, team, sheets, timeEntries });
  if (!authCheck.can) {
    return {
      allowed: false,
      can: authCheck.can,
      code: authCheck.code,
      reason: authCheck.reason,
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const actorId = normalizeMemberId(actorMemberId);
  const sheetId = normalizeMemberId(sheet.id);
  const managerId = getDirectManagerId(normalizeMemberId(sheet.membre), team);

  if (!managerId) {
    return {
      allowed: false,
      can: false,
      code: 'NO_VALIDATION_MANAGER',
      reason: 'Aucun responsable de validation trouvé',
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const existingRevision = normalizeRevision(sheet.revisionValidation);

  for (const entry of timeEntries || []) {
    const fields = {};

    if (!hasExplicitActual(entry)) {
      const plannedHours = entry.heuresPrevues;
      const hasValidPlanned = plannedHours !== null && plannedHours !== undefined && plannedHours !== '' && Number.isFinite(Number(plannedHours));
      if (hasValidPlanned) {
        fields.heures = Number(plannedHours);
      }
    }

    if (Object.keys(fields).length > 0) {
      actions.push([
        'UpdateRecord',
        'TimeEntries',
        entry.id,
        fields
      ]);
    }
  }

  actions.sort((a, b) => {
    if (a[1] === 'TimeEntries' && b[1] === 'TimeEntries') {
      return a[2] - b[2];
    }
    return 0;
  });

  const sheetUpdate = {
    statut: 'soumis',
    responsableValidation: managerId,
    soumisPar: actorId,
    dateSoumission: timestampCheck.value,
    validePar: null,
    dateValidation: null,
    motifRejet: '',
    motifCorrection: '',
    revisionValidation: existingRevision
  };

  actions.push([
    'UpdateRecord',
    'Feuilles',
    sheetId,
    sheetUpdate
  ]);

  summary.sheetId = sheetId;
  summary.managerId = managerId;
  summary.timeEntriesCount = timeEntries ? timeEntries.length : 0;

  return {
    allowed: true,
    can: true,
    code: 'OK',
    reason: 'Autorisé',
    actions,
    diagnostics,
    summary
  };
}

/**
 * Construit les actions Grist pour un retrait de soumission
 *
 * CONTRAT :
 * 1. Appelle canWithdrawSheet() en premier
 * 2. Ajoute les vérifications : unicité, pas de validation préalable
 * 3. Écrit : { statut: 'brouillon', responsableValidation: null, soumisPar: null, dateSoumission: null, validePar: null, dateValidation: null, motifRejet: '', motifCorrection: '' }
 * 4. Préserve revisionValidation
 *
 * @param {Object} params - Paramètres
 * @param {number} params.actorMemberId - ID de l'acteur
 * @param {Object} params.sheet - Feuille
 * @param {Array} params.sheets - Toutes les feuilles
 * @param {number} params.nowUnixSeconds - Timestamp actuel
 * @returns {{ allowed: boolean, can: boolean, code: string, reason: string, actions: Array, diagnostics: Array, summary: Object }}
 */
function buildWithdrawActions(params) {
  const { actorMemberId, sheet, sheets } = params || {};
  const actions = [];
  const diagnostics = [];
  const summary = {};

  if (!actorMemberId || !sheet) {
    return {
      allowed: false,
      can: false,
      code: 'MISSING_PARAMS',
      reason: 'Paramètres requis manquants',
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  if (sheet.validePar != null || sheet.dateValidation != null) {
    return {
      allowed: false,
      can: false,
      code: 'SHEET_ALREADY_VALIDATED',
      reason: 'Feuille déjà validée',
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const weekStartIso = getWeekStartIso(sheet.semaine);
  const uniquenessCheck = findUniqueSheetForWeek(normalizeMemberId(sheet.membre), weekStartIso, sheets);
  if (uniquenessCheck.status === 'duplicate') {
    return {
      allowed: false,
      can: false,
      code: 'DUPLICATE_WEEKLY_SHEET',
      reason: 'Plusieurs feuilles existent pour cette personne et cette semaine',
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }
  if (uniquenessCheck.status === 'none') {
    return {
      allowed: false,
      can: false,
      code: 'SHEET_NOT_FOUND_IN_COLLECTION',
      reason: 'Feuille introuvable ou dupliquée',
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const authCheck = canWithdrawSheet({ actorMemberId, sheet, sheets });
  if (!authCheck.can) {
    return {
      allowed: false,
      can: authCheck.can,
      code: authCheck.code,
      reason: authCheck.reason,
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const sheetId = normalizeMemberId(sheet.id);

  const sheetUpdate = {
    statut: 'brouillon',
    responsableValidation: null,
    soumisPar: null,
    dateSoumission: null,
    validePar: null,
    dateValidation: null,
    motifRejet: '',
    motifCorrection: ''
  };

  actions.push([
    'UpdateRecord',
    'Feuilles',
    sheetId,
    sheetUpdate
  ]);

  summary.sheetId = sheetId;

  return {
    allowed: true,
    can: true,
    code: 'OK',
    reason: 'Autorisé',
    actions,
    diagnostics,
    summary
  };
}

// ============================================================================
// ACTIONS GRIST : VALIDATION
// ============================================================================

/**
 * Construit les actions Grist pour une validation de feuille
 *
 * CONTRAT :
 * 1. Appelle canValidateSheet() en premier
 * 2. Supprime Date.now() - nécessite nowUnixSeconds
 * 3. Calcule nextRevision = (sheet.revisionValidation || 0) + 1
 * 4. Écrit : { statut: 'valide', validePar: actorMemberId, dateValidation: nowUnixSeconds, revisionValidation: nextRevision, motifRejet: '' }
 *
 * @param {Object} params - Paramètres
 * @param {number} params.actorMemberId - ID de l'acteur
 * @param {Object} params.sheet - Feuille
 * @param {Array} params.sheets - Toutes les feuilles
 * @param {Object} params.validationResult - Résultat de validation fonctionnelle
 * @param {number} params.nowUnixSeconds - Timestamp actuel
 * @returns {{ allowed: boolean, can: boolean, code: string, reason: string, actions: Array, diagnostics: Array, summary: Object }}
 */
function buildValidationAction(params) {
  const { actorMemberId, sheet, sheets, validationResult, nowUnixSeconds } = params || {};
  const actions = [];
  const diagnostics = [];
  const summary = {};

  if (!actorMemberId || !sheet) {
    return {
      allowed: false,
      can: false,
      code: 'MISSING_PARAMS',
      reason: 'Paramètres requis manquants',
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const timestampCheck = validateUnixTimestamp(nowUnixSeconds);
  if (!timestampCheck.valid) {
    return {
      allowed: false,
      can: false,
      code: timestampCheck.code,
      reason: 'Timestamp Unix invalide',
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const authCheck = canValidateSheet({ actorMemberId, sheet, sheets, validationResult });
  if (!authCheck.can) {
    return {
      allowed: false,
      can: authCheck.can,
      code: authCheck.code,
      reason: authCheck.reason,
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const actorId = normalizeMemberId(actorMemberId);
  const sheetId = normalizeMemberId(sheet.id);
  const currentRevision = normalizeRevision(sheet.revisionValidation);
  const nextRevision = currentRevision + 1;

  const sheetUpdate = {
    statut: 'valide',
    validePar: actorId,
    dateValidation: timestampCheck.value,
    revisionValidation: nextRevision,
    motifRejet: ''
  };

  actions.push([
    'UpdateRecord',
    'Feuilles',
    sheetId,
    sheetUpdate
  ]);

  summary.sheetId = sheetId;
  summary.revision = nextRevision;

  return {
    allowed: true,
    can: true,
    code: 'OK',
    reason: 'Autorisé',
    actions,
    diagnostics,
    summary
  };
}

// ============================================================================
// ACTIONS GRIST : REJET
// ============================================================================

/**
 * Construit les actions Grist pour un rejet de feuille
 *
 * CONTRAT :
 * 1. Appelle canRejectSheet() en premier
 * 2. Préserve revisionValidation
 *
 * @param {Object} params - Paramètres
 * @param {number} params.actorMemberId - ID de l'acteur
 * @param {Object} params.sheet - Feuille
 * @param {Array} params.sheets - Toutes les feuilles
 * @param {string} params.rejectReason - Motif de rejet
 * @param {number} params.nowUnixSeconds - Timestamp actuel
 * @returns {{ allowed: boolean, can: boolean, code: string, reason: string, actions: Array, diagnostics: Array, summary: Object }}
 */
function buildRejectionAction(params) {
  const { actorMemberId, sheet, sheets, rejectReason } = params || {};
  const actions = [];
  const diagnostics = [];
  const summary = {};

  if (!actorMemberId || !sheet) {
    return {
      allowed: false,
      can: false,
      code: 'MISSING_PARAMS',
      reason: 'Paramètres requis manquants',
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const authCheck = canRejectSheet({ actorMemberId, sheet, sheets, rejectReason });
  if (!authCheck.can) {
    return {
      allowed: false,
      can: authCheck.can,
      code: authCheck.code,
      reason: authCheck.reason,
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const sheetId = normalizeMemberId(sheet.id);

  const sheetUpdate = {
    statut: 'rejete',
    motifRejet: String(rejectReason).trim(),
    validePar: null,
    dateValidation: null
  };

  actions.push([
    'UpdateRecord',
    'Feuilles',
    sheetId,
    sheetUpdate
  ]);

  summary.sheetId = sheetId;

  return {
    allowed: true,
    can: true,
    code: 'OK',
    reason: 'Autorisé',
    actions,
    diagnostics,
    summary
  };
}

// ============================================================================
// ACTIONS GRIST : CORRECTION MANAGER
// ============================================================================

/**
 * Construit les actions Grist pour ouvrir une correction manager
 *
 * CONTRAT :
 * 1. Appelle canOpenManagerCorrection() en premier
 * 2. Écrit : { statut: 'correction_manager', motifCorrection: trimmedReason }
 * 3. Préserve : validePar, dateValidation, responsableValidation, submitted info, revisionValidation
 *
 * @param {Object} params - Paramètres
 * @param {number} params.actorMemberId - ID de l'acteur
 * @param {Object} params.sheet - Feuille
 * @param {Array} params.sheets - Toutes les feuilles
 * @param {string} params.correctionReason - Motif de correction
 * @param {number} params.nowUnixSeconds - Timestamp actuel
 * @returns {{ allowed: boolean, can: boolean, code: string, reason: string, actions: Array, diagnostics: Array, summary: Object }}
 */
function buildOpenManagerCorrectionActions(params) {
  const { actorMemberId, sheet, sheets, correctionReason } = params || {};
  const actions = [];
  const diagnostics = [];
  const summary = {};

  if (!actorMemberId || !sheet) {
    return {
      allowed: false,
      can: false,
      code: 'MISSING_PARAMS',
      reason: 'Paramètres requis manquants',
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const authCheck = canOpenManagerCorrection({ actorMemberId, sheet, sheets, correctionReason });
  if (!authCheck.can) {
    return {
      allowed: false,
      can: authCheck.can,
      code: authCheck.code,
      reason: authCheck.reason,
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const sheetId = normalizeMemberId(sheet.id);

  const sheetUpdate = {
    statut: 'correction_manager',
    motifCorrection: String(correctionReason).trim()
  };

  actions.push([
    'UpdateRecord',
    'Feuilles',
    sheetId,
    sheetUpdate
  ]);

  summary.sheetId = sheetId;

  return {
    allowed: true,
    can: true,
    code: 'OK',
    reason: 'Autorisé',
    actions,
    diagnostics,
    summary
  };
}

/**
 * Construit les actions Grist pour revalider une feuille après correction
 *
 * CONTRAT :
 * 1. Appelle canRevalidateSheet() en premier
 * 2. Calcule nextRevision = (sheet.revisionValidation || 0) + 1
 * 3. Écrit : { statut: 'valide', validePar: actorMemberId, dateValidation: nowUnixSeconds, revisionValidation: nextRevision }
 * 4. Préserve : motifCorrection
 *
 * @param {Object} params - Paramètres
 * @param {number} params.actorMemberId - ID de l'acteur
 * @param {Object} params.sheet - Feuille
 * @param {Array} params.sheets - Toutes les feuilles
 * @param {Object} params.validationResult - Résultat de validation fonctionnelle
 * @param {number} params.nowUnixSeconds - Timestamp actuel
 * @returns {{ allowed: boolean, can: boolean, code: string, reason: string, actions: Array, diagnostics: Array, summary: Object }}
 */
function buildRevalidationActions(params) {
  const { actorMemberId, sheet, sheets, validationResult, nowUnixSeconds } = params || {};
  const actions = [];
  const diagnostics = [];
  const summary = {};

  if (!actorMemberId || !sheet) {
    return {
      allowed: false,
      can: false,
      code: 'MISSING_PARAMS',
      reason: 'Paramètres requis manquants',
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const timestampCheck = validateUnixTimestamp(nowUnixSeconds);
  if (!timestampCheck.valid) {
    return {
      allowed: false,
      can: false,
      code: timestampCheck.code,
      reason: 'Timestamp Unix invalide',
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const authCheck = canRevalidateSheet({ actorMemberId, sheet, sheets, validationResult });
  if (!authCheck.can) {
    return {
      allowed: false,
      can: authCheck.can,
      code: authCheck.code,
      reason: authCheck.reason,
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const sheetId = normalizeMemberId(sheet.id);
  const currentRevision = normalizeRevision(sheet.revisionValidation);
  const nextRevision = currentRevision + 1;

  const sheetUpdate = {
    statut: 'valide',
    validePar: normalizeMemberId(actorMemberId),
    dateValidation: timestampCheck.value,
    revisionValidation: nextRevision
  };

  actions.push([
    'UpdateRecord',
    'Feuilles',
    sheetId,
    sheetUpdate
  ]);

  summary.sheetId = sheetId;
  summary.revision = nextRevision;

  return {
    allowed: true,
    can: true,
    code: 'OK',
    reason: 'Autorisé',
    actions,
    diagnostics,
    summary
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
  isSheetManagerCorrection,
  isSheetOwnerEditable,
  isSheetManagerEditable,

  // Normalisation IDs et révisions
  normalizeMemberId,
  normalizeRevision,
  validateUnixTimestamp,
  getWeekStartIso,

  // Null / 0 / Réalisé
  hasExplicitActual,
  hasExplicitActualHours,

  // Unicité
  findUniqueSheetForWeek,

  // Hiérarchie
  getDirectManagerId,
  getDirectReportIds,
  isDirectManager,

  // Responsable validation (snapshot)
  getExpectedValidationManagerId,
  isExpectedValidationManager,

  // Validation des TimeEntries
  validateEntriesBelongToSheet,

  // Autorisations : Soumission
  canSubmitSheet,
  canWithdrawSheet,

  // Autorisations : Validation
  canValidateSheet,

  // Autorisations : Rejet
  canRejectSheet,

  // Autorisations : Correction manager
  canOpenManagerCorrection,
  canManagerEditActual,
  canRevalidateSheet,

  // Actions Grist
  buildSubmissionActions,
  buildWithdrawActions,
  buildValidationAction,
  buildRejectionAction,
  buildOpenManagerCorrectionActions,
  buildRevalidationActions,

  // Helpers
  getWeekStartIso,

  // Helpers dates
  isoToGristDate,
  gristDateToIso,
  parseDateUTC,
  formatDateUTC
};
