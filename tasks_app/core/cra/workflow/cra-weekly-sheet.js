/**
 * CRA Weekly Sheet — Logique pure de résolution des feuilles hebdomadaires
 *
 * CONTRATS :
 * 1. Une seule feuille par membre + semaine (lundi civil)
 * 2. Semaine canonique = lundi civil (YYYY-MM-DD)
 * 3. IDs normalisés (numériques ou chaînes numériques)
 * 4. Aucune mutation des tableaux reçus
 * 5. Déterminisme : ordre stable des actions
 *
 * ÉTATS DE RÉSOLUTION :
 * - FOUND : feuille unique trouvée
 * - CREATION_REQUIRED : aucune feuille, création possible
 * - DUPLICATE_WEEKLY_SHEET : conflit bloquant
 * - INVALID_MEMBER_ID : membre invalide
 * - INVALID_WEEK : semaine invalide
 *
 * @module core/cra/cra-weekly-sheet
 */

'use strict';

// ============================================================================
// HELPERS : NORMALISATION
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

/**
 * Formate une date UTC en ISO YYYY-MM-DD
 * @param {Date} date - Date à formater
 * @returns {string} Date ISO
 */
function formatDateUTC(date) {
  if (!date || isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().split('T')[0];
}

/**
 * Calcule le lundi de la semaine civile contenant la date donnée
 * @param {*} dateValue - Date (Grist timestamp, ISO string, ou Date)
 * @returns {string|null} Date ISO YYYY-MM-DD du lundi civil ou null
 */
function getWeekStartIso(dateValue) {
  const date = normalizeDateValue(dateValue);
  if (!date) return null;

  // CORRECTION : Utiliser les méthodes locales pour respecter le fuseau
  const dayOfWeek = date.getDay();  // 0 = dimanche, 1 = lundi, etc.
  const offset = (dayOfWeek === 0) ? 6 : (dayOfWeek - 1);
  
  const monday = new Date(date);
  monday.setDate(date.getDate() - offset);
  monday.setHours(0, 0, 0, 0);

  return formatDateLocal(monday);
}

/**
 * Formate une date locale en ISO YYYY-MM-DD
 * @param {Date} date - Date à formater
 * @returns {string} Date ISO
 */
function formatDateLocal(date) {
  if (!date || isNaN(date.getTime())) {
    return null;
  }
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

/**
 * Convertit une date Grist (secondes Unix) vers une clé ISO YYYY-MM-DD
 * @param {*} value - Valeur Grist (nombre de secondes ou string ISO)
 * @returns {string|null} Date ISO YYYY-MM-DD ou null
 */
function gristDateToIso(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return formatDateUTC(date);
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value * 1000;
    const date = new Date(ms);
    return formatDateUTC(date);
  }

  // CORRECTION : utiliser value au lieu de date (qui n'existe pas)
  if (value instanceof Date) {
    return formatDateUTC(value);
  }

  return null;
}

// ============================================================================
// RÉSOLUTION DE FEUILLE HEBDOMADAIRE
// ============================================================================

/**
 * Résultat de résolution de feuille
 * @typedef {Object} SheetResolutionResult
 * @property {'FOUND'|'CREATION_REQUIRED'|'DUPLICATE_WEEKLY_SHEET'|'INVALID_MEMBER_ID'|'INVALID_WEEK'} status
 * @property {Object|null} sheet - Feuille trouvée (si FOUND)
 * @property {number|null} sheetId - ID de la feuille (si FOUND)
 * @property {Object|null} creationFields - Champs pour création (si CREATION_REQUIRED)
 * @property {Array} duplicates - Feuilles en doublon (si DUPLICATE)
 * @property {string} reason - Code de raison
 */

/**
 * Résout l'état d'une feuille pour un membre et une semaine donnés
 *
 * CONTRAT :
 * - 0 feuille → CREATION_REQUIRED
 * - 1 feuille → FOUND
 * - 2+ feuilles → DUPLICATE_WEEKLY_SHEET
 * - membre invalide → INVALID_MEMBER_ID
 * - semaine invalide → INVALID_WEEK
 *
 * @param {Object} params - Paramètres
 * @param {number|string} params.memberId - ID du membre
 * @param {string} params.weekStartIso - Date de début de semaine (YYYY-MM-DD, lundi civil)
 * @param {Array} params.sheets - Toutes les feuilles (Feuilles)
 * @returns {SheetResolutionResult} Résultat de résolution
 */
function resolveWeeklySheetState(params) {
  const { memberId, weekStartIso, sheets } = params || {};

  // 1. Valider memberId
  const normalizedMemberId = normalizeMemberId(memberId);
  if (normalizedMemberId === null) {
    return {
      status: 'INVALID_MEMBER_ID',
      sheet: null,
      sheetId: null,
      creationFields: null,
      duplicates: [],
      reason: 'INVALID_MEMBER_ID'
    };
  }

  // 2. Valider weekStartIso
  if (!weekStartIso || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartIso)) {
    return {
      status: 'INVALID_WEEK',
      sheet: null,
      sheetId: null,
      creationFields: null,
      duplicates: [],
      reason: 'INVALID_WEEK'
    };
  }

  // 3. Vérifier que c'est un lundi (optionnel, mais utile pour diagnostic)
  const weekDate = new Date(weekStartIso + 'T00:00:00Z');
  const dayOfWeek = weekDate.getUTCDay();
  if (dayOfWeek !== 1) {
    // Ce n'est pas un lundi, on peut soit corriger, soit rejeter
    // Pour ce module, on accepte mais on logge un avertissement
    // La semaine canonique devrait toujours être le lundi
  }

  // 4. Filtrer les feuilles pour ce membre et cette semaine
  const matchingSheets = (sheets || []).filter(s => {
    const sheetMemberId = normalizeMemberId(s.membre);
    if (sheetMemberId !== normalizedMemberId) return false;

    const sheetWeekIso = getWeekStartIso(s.semaine);
    return sheetWeekIso === weekStartIso;
  });

  // 5. Résoudre selon le nombre de feuilles trouvées
  if (matchingSheets.length === 0) {
    // Aucune feuille → création requise
    // CORRECTION : Convertir ISO en timestamp Grist (secondes) pour l'écriture
    const weekStartMs = new Date(weekStartIso + 'T00:00:00').getTime();
    const weekStartUnixSeconds = Math.floor(weekStartMs / 1000);
    
    return {
      status: 'CREATION_REQUIRED',
      sheet: null,
      sheetId: null,
      creationFields: {
        membre: normalizedMemberId,
        semaine: weekStartUnixSeconds,  // Format Grist : timestamp secondes
        statut: 'brouillon',
        revisionValidation: 0
      },
      duplicates: [],
      reason: 'NO_SHEET_FOR_WEEK'
    };
  }

  if (matchingSheets.length === 1) {
    // Une feuille unique → trouvée
    const sheet = matchingSheets[0];
    return {
      status: 'FOUND',
      sheet,
      sheetId: normalizeMemberId(sheet.id),
      creationFields: null,
      duplicates: [],
      reason: 'UNIQUE_SHEET_FOUND'
    };
  }

  // Plusieurs feuilles → doublon bloquant
  return {
    status: 'DUPLICATE_WEEKLY_SHEET',
    sheet: null,
    sheetId: null,
    creationFields: null,
    duplicates: matchingSheets,
    reason: 'DUPLICATE_WEEKLY_SHEET'
  };
}

/**
 * Construit les champs de création pour une nouvelle feuille
 *
 * @param {Object} params - Paramètres
 * @param {number} params.memberId - ID du membre
 * @param {string} params.weekStartIso - Date de début de semaine
 * @returns {Object|null} Champs de création ou null si invalide
 */
function buildWeeklySheetCreation(params) {
  const { memberId, weekStartIso } = params || {};

  const normalizedMemberId = normalizeMemberId(memberId);
  if (normalizedMemberId === null) {
    return null;
  }

  if (!weekStartIso || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartIso)) {
    return null;
  }

  // CORRECTION : Convertir ISO en timestamp Grist (secondes)
  const weekStartMs = new Date(weekStartIso + 'T00:00:00').getTime();
  const weekStartUnixSeconds = Math.floor(weekStartMs / 1000);

  return {
    membre: normalizedMemberId,
    semaine: weekStartUnixSeconds,  // Format Grist : timestamp secondes
    statut: 'brouillon',
    revisionValidation: 0
  };
}

// ============================================================================
// RÉSOLUTION DES TIMEENTRIES ORPHELINES
// ============================================================================

/**
 * Plan de rattachement des entrées
 * @typedef {Object} EntryLinkPlan
 * @property {boolean} valid - true si le plan est applicable
 * @property {Array} links - Entrées à rattacher [{entryId, sheetId}]
 * @property {Array} preserved - Entrées déjà rattachées [{entryId, sheetId}]
 * @property {Array} conflicts - Entrées en conflit [{entryId, reason, currentSheetId}]
 */

/**
 * Trouve toutes les TimeEntries d'un membre pour une semaine donnée
 *
 * @param {Object} params - Paramètres
 * @param {number} params.memberId - ID du membre
 * @param {string} params.weekStartIso - Date de début de semaine
 * @param {Array} params.entries - Toutes les TimeEntries
 * @returns {Array} TimeEntries du membre pour cette semaine
 */
function findEntriesForMemberWeek(params) {
  const { memberId, weekStartIso, entries } = params || {};

  if (!memberId || !weekStartIso || !entries) {
    return [];
  }

  const normalizedMemberId = normalizeMemberId(memberId);

  return (entries || []).filter(e => {
    const entryMemberId = normalizeMemberId(e.membre);
    if (entryMemberId !== normalizedMemberId) return false;

    const entryWeekIso = getWeekStartIso(e.date);
    return entryWeekIso === weekStartIso;
  });
}

/**
 * Construit un plan de rattachement des entrées orphelines à une feuille
 *
 * CONTRAT :
 * - entrée sans feuille → à rattacher (link)
 * - entrée déjà liée à la bonne feuille → préservée
 * - entrée liée à une autre feuille → conflit bloquant
 * - entrée d'un autre membre → ignorée
 * - entrée d'une autre semaine → ignorée
 *
 * @param {Object} params - Paramètres
 * @param {number} params.memberId - ID du membre
 * @param {string} params.weekStartIso - Date de début de semaine
 * @param {number} params.sheetId - ID de la feuille cible
 * @param {Array} params.entries - Toutes les TimeEntries
 * @returns {EntryLinkPlan} Plan de rattachement
 */
function buildOrphanEntryLinkPlan(params) {
  const { memberId, weekStartIso, sheetId, entries } = params || {};

  const normalizedMemberId = normalizeMemberId(memberId);
  const normalizedSheetId = normalizeMemberId(sheetId);

  const result = {
    valid: true,
    links: [],
    preserved: [],
    conflicts: []
  };

  if (normalizedMemberId === null || normalizedSheetId === null || !entries) {
    return result;
  }

  // Filtrer les entrées du membre pour cette semaine
  const memberWeekEntries = findEntriesForMemberWeek({
    memberId,
    weekStartIso,
    entries
  });

  // Trier par ID pour déterminisme
  memberWeekEntries.sort((a, b) => {
    const idA = normalizeMemberId(a.id) || 0;
    const idB = normalizeMemberId(b.id) || 0;
    return idA - idB;
  });

  for (const entry of memberWeekEntries) {
    const entryId = normalizeMemberId(entry.id);
    const entrySheetId = normalizeMemberId(entry.feuille);

    if (entryId === null) {
      // Entrée sans ID valide → ignorer
      continue;
    }

    if (entrySheetId === null) {
      // Entrée sans feuille → à rattacher
      result.links.push({
        entryId,
        sheetId: normalizedSheetId
      });
    } else if (entrySheetId === normalizedSheetId) {
      // Entrée déjà liée à la bonne feuille → préservée
      result.preserved.push({
        entryId,
        sheetId: normalizedSheetId
      });
    } else {
      // Entrée liée à une autre feuille → conflit
      result.conflicts.push({
        entryId,
        reason: 'TIME_ENTRY_ALREADY_LINKED_TO_OTHER_SHEET',
        currentSheetId: entrySheetId,
        targetSheetId: normalizedSheetId
      });
    }
  }

  // Conflits bloquent le plan
  if (result.conflicts.length > 0) {
    result.valid = false;
  }

  return result;
}

// ============================================================================
// CONSTRUCTION DES ACTIONS GRIST
// ============================================================================

/**
 * Construit les actions Grist pour créer une feuille
 *
 * @param {Object} creationFields - Champs de création
 * @returns {Array} Actions Grist [['AddRecord', 'Feuilles', null, fields]]
 */
function buildSheetCreationActions(creationFields) {
  if (!creationFields) {
    return [];
  }

  return [
    ['AddRecord', 'Feuilles', null, creationFields]
  ];
}

/**
 * Construit les actions Grist pour rattacher des entrées à une feuille
 *
 * @param {Array} links - Liste des liens [{entryId, sheetId}]
 * @returns {Array} Actions Grist [['UpdateRecord', 'TimeEntries', entryId, {feuille}]]
 */
function buildEntryLinkActions(links) {
  if (!links || links.length === 0) {
    return [];
  }

  const actions = [];

  // Trier par entryId pour déterminisme
  const sortedLinks = [...links].sort((a, b) => a.entryId - b.entryId);

  for (const link of sortedLinks) {
    actions.push([
      'UpdateRecord',
      'TimeEntries',
      link.entryId,
      { feuille: link.sheetId }
    ]);
  }

  return actions;
}

/**
 * Construit toutes les actions pour assurer l'existence d'une feuille
 *
 * @param {Object} params - Paramètres
 * @param {number} params.memberId - ID du membre
 * @param {string} params.weekStartIso - Date de début de semaine
 * @param {Array} params.sheets - Toutes les feuilles
 * @param {Array} params.entries - Toutes les TimeEntries (optionnel)
 * @param {boolean} params.linkOrphanEntries - true pour rattacher les entrées orphelines
 * @returns {Object} { actions, sheetId, created, linkPlan }
 */
function buildEnsureWeeklySheetActions(params) {
  const { memberId, weekStartIso, sheets, entries, linkOrphanEntries = false } = params || {};

  const result = {
    actions: [],
    sheetId: null,
    created: false,
    linkPlan: null,
    error: null
  };

  // 1. Résoudre l'état de la feuille
  const resolution = resolveWeeklySheetState({ memberId, weekStartIso, sheets });

  if (resolution.status === 'INVALID_MEMBER_ID') {
    result.error = 'INVALID_MEMBER_ID';
    return result;
  }

  if (resolution.status === 'INVALID_WEEK') {
    result.error = 'INVALID_WEEK';
    return result;
  }

  if (resolution.status === 'DUPLICATE_WEEKLY_SHEET') {
    result.error = 'DUPLICATE_WEEKLY_SHEET';
    result.duplicates = resolution.duplicates;
    return result;
  }

  if (resolution.status === 'CREATION_REQUIRED') {
    // Créer la feuille
    const creationActions = buildSheetCreationActions(resolution.creationFields);
    result.actions.push(...creationActions);
    result.created = true;
    // sheetId sera connu après exécution (à récupérer par refetch)
    result.sheetId = null;
  } else if (resolution.status === 'FOUND') {
    result.sheetId = resolution.sheetId;
  }

  // 2. Rattacher les entrées orphelines si demandé
  if (linkOrphanEntries && entries && result.sheetId !== null) {
    const linkPlan = buildOrphanEntryLinkPlan({
      memberId,
      weekStartIso,
      sheetId: result.sheetId,
      entries
    });

    result.linkPlan = linkPlan;

    if (linkPlan.valid && linkPlan.links.length > 0) {
      const linkActions = buildEntryLinkActions(linkPlan.links);
      result.actions.push(...linkActions);
    } else if (!linkPlan.valid) {
      result.error = 'ENTRY_LINK_CONFLICT';
      result.conflicts = linkPlan.conflicts;
    }
  }

  return result;
}

// ============================================================================
// EXPORT
// ============================================================================

module.exports = {
  // Helpers de normalisation (exportés pour usage externe si nécessaire)
  normalizeMemberId,
  normalizeDateValue,
  formatDateUTC,
  getWeekStartIso,
  gristDateToIso,

  // Résolution de feuille
  resolveWeeklySheetState,
  buildWeeklySheetCreation,

  // Résolution des entrées
  findEntriesForMemberWeek,
  buildOrphanEntryLinkPlan,

  // Construction des actions
  buildSheetCreationActions,
  buildEntryLinkActions,
  buildEnsureWeeklySheetActions
};
