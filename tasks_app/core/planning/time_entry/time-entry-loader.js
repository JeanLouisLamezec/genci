/**
 * Time Entry Loader - Chargeur commun des TimeEntries
 * 
 * Module partagé entre le Plan et le CRA pour charger, normaliser
 * et manipuler les TimeEntries avec un modèle de données unifié.
 * 
 * @module core/planning/time_entry/time-entry-loader
 */

'use strict';

// ============================================================================
// HELPERS DE DATE
// ============================================================================

/**
 * Convertit une date Grist (timestamp ou string) en ISO UTC (YYYY-MM-DD)
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
      return date.toISOString().split('T')[0];
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value * 1000);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  return null;
}

/**
 * Convertit une date ISO UTC (YYYY-MM-DD) en timestamp Grist
 */
function isoToGristDate(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const date = new Date(value + 'T00:00:00Z');
  if (!isNaN(date.getTime())) {
    return Math.floor(date.getTime() / 1000);
  }
  return null;
}

// ============================================================================
// NORMALISATION DU STATUT DE FEUILLE
// ============================================================================

/**
 * Normalise un statut de feuille Grist vers le statut du domaine
 * Convention : brouillon=draft, soumis=submitted, valide=validated
 */
function normalizeSheetStatus(status) {
  if (status === null || status === undefined || status === '') {
    return null;
  }
  const STATUS_MAPPING = {
    'brouillon': 'draft',
    'soumis': 'submitted',
    'valide': 'validated',
    'rejete': 'draft',
    'draft': 'draft',
    'submitted': 'submitted',
    'validated': 'validated',
    'rejected': 'draft'
  };
  return STATUS_MAPPING[String(status).toLowerCase()] || null;
}

// ============================================================================
// NORMALISATION D'UNE TIME ENTRY
// ============================================================================

/**
 * Normalise une TimeEntry brute Grist en objet domaine
 * @param {Object} rawEntry - Données brutes depuis Grist
 * @param {Object} feuillesById - Index des feuilles par ID
 * @returns {Object} TimeEntry normalisée
 */
function normalizeTimeEntry(rawEntry, feuillesById) {
  if (!rawEntry) {
    return null;
  }
  
  const feuilleId = rawEntry.feuille;
  const feuille = feuilleId ? feuillesById[feuilleId] : null;
  const sheetStatus = feuille ? normalizeSheetStatus(feuille.statut) : null;
  
  return {
    // Identification
    id: rawEntry.id,
    assignmentId: rawEntry.affectation ? Number(rawEntry.affectation) : null,
    taskId: rawEntry.tache ? Number(rawEntry.tache) : null,
    memberId: rawEntry.membre ? Number(rawEntry.membre) : null,
    
    // Date
    date: gristDateToIso(rawEntry.date),
    dateTimestamp: typeof rawEntry.date === 'number' ? rawEntry.date : null,
    
    // Heures
    plannedHours: Number(rawEntry.heuresPrevues) || 0,
    actualHours: Number(rawEntry.heures) || 0,
    
    // Capacité
    baseCapacityHours: Number(rawEntry.capaciteTheorique) || 0,
    availableCapacityHours: Number(rawEntry.capaciteDisponible) || 0,
    capacityRecordId: rawEntry.capaciteJour ? Number(rawEntry.capaciteJour) : null,
    
    // Feuille de temps
    sheetId: feuilleId ? Number(feuilleId) : null,
    sheetStatus: sheetStatus,
    
    // Métadonnées
    revisionPlan: Number(rawEntry.revisionPlan) || 0,
    description: rawEntry.description || null,
    imputation: rawEntry.imputation || null,
    
    // Diagnostic legacy
    isLegacy: !rawEntry.affectation || rawEntry.affectation === 0
  };
}

// ============================================================================
// CHARGEMENT DES TIME ENTRIES
// ============================================================================

/**
 * Charge et normalise toutes les TimeEntries
 * @param {Object} grist - API Grist
 * @param {Object} options - Options
 * @returns {Promise<Object>} { entries, feuillesById, diagnostics }
 */
async function loadTimeEntries(grist, options) {
  const opts = options || {};
  const memberId = opts.memberId; // Filtrer par membre si spécifié
  
  const diagnostics = [];
  
  // Charger les feuilles en premier pour résoudre les statuts
  let feuillesTable;
  try {
    feuillesTable = await grist.docApi.fetchTable('Feuilles');
  } catch (e) {
    return {
      entries: [],
      feuillesById: {},
      diagnostics: [{
        code: 'TABLE_MISSING',
        table: 'Feuilles',
        error: e.message
      }]
    };
  }
  
  const feuilles = columnarToRows(feuillesTable);
  const feuillesById = {};
  feuilles.forEach(f => {
    feuillesById[f.id] = {
      id: f.id,
      membre: f.membre,
      semaine: f.semaine,
      statut: f.statut,
      validePar: f.validePar,
      motifRejet: f.motifRejet
    };
  });
  
  // Charger les TimeEntries
  let timeEntriesTable;
  try {
    timeEntriesTable = await grist.docApi.fetchTable('TimeEntries');
  } catch (e) {
    return {
      entries: [],
      feuillesById: {},
      diagnostics: [{
        code: 'TABLE_MISSING',
        table: 'TimeEntries',
        error: e.message
      }]
    };
  }
  
  const rawEntries = columnarToRows(timeEntriesTable);
  
  // Filtrer par membre si demandé
  const filteredEntries = memberId
    ? rawEntries.filter(e => e.membre === memberId)
    : rawEntries;
  
  // Normaliser chaque entrée
  const entries = filteredEntries.map(raw => normalizeTimeEntry(raw, feuillesById));
  
  // Diagnostiquer les entrées legacy
  const legacyCount = entries.filter(e => e.isLegacy).length;
  if (legacyCount > 0) {
    diagnostics.push({
      code: 'LEGACY_ENTRIES_DETECTED',
      count: legacyCount,
      message: legacyCount + ' TimeEntries sans affectation (données legacy)'
    });
  }
  
  return {
    entries,
    feuillesById,
    diagnostics
  };
}

// ============================================================================
// REGROUPEMENTS
// ============================================================================

/**
 * Regroupe les TimeEntries par affectation
 * @param {Array} entries - TimeEntries normalisées
 * @returns {Map<number, Array>} Map assignmentId → entries
 */
function groupEntriesByAssignment(entries) {
  const map = new Map();
  
  for (const entry of entries) {
    const key = entry.assignmentId;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(entry);
  }
  
  return map;
}

/**
 * Regroupe les TimeEntries par membre et date
 * @param {Array} entries - TimeEntries normalisées
 * @returns {Map<string, Array>} Map "memberId:date" → entries
 */
function groupEntriesByMemberAndDate(entries) {
  const map = new Map();
  
  for (const entry of entries) {
    const key = entry.memberId + ':' + entry.date;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(entry);
  }
  
  return map;
}

/**
 * Regroupe les TimeEntries par membre et période (semaine/mois)
 * @param {Array} entries - TimeEntries normalisées
 * @param {string} granularity - 'week' ou 'month'
 * @returns {Map<string, Array>} Map "memberId:period" → entries
 */
function groupEntriesByMemberAndPeriod(entries, granularity) {
  const map = new Map();
  
  for (const entry of entries) {
    if (!entry.date) continue;
    
    const date = new Date(entry.date + 'T00:00:00Z');
    let periodKey;
    
    if (granularity === 'week') {
      // ISO week: YYYY-Www
      const monday = getMonday(date);
      periodKey = entry.memberId + ':' + monday.toISOString().split('T')[0];
    } else if (granularity === 'month') {
      // YYYY-MM
      periodKey = entry.memberId + ':' + 
        date.getUTCFullYear() + '-' + 
        String(date.getUTCMonth() + 1).padStart(2, '0');
    } else {
      // Par défaut : jour
      periodKey = entry.memberId + ':' + entry.date;
    }
    
    if (!map.has(periodKey)) {
      map.set(periodKey, []);
    }
    map.get(periodKey).push(entry);
  }
  
  return map;
}

// ============================================================================
// CALCULS
// ============================================================================

/**
 * Calcule le total des heures prévues pour un membre sur une période
 * @param {Array} entries - TimeEntries normalisées
 * @param {number} memberId - ID du membre
 * @param {string} startDate - Date de début (YYYY-MM-DD)
 * @param {string} endDate - Date de fin (YYYY-MM-DD)
 * @returns {number} Total des heures prévues
 */
function sumPlannedHoursForMember(entries, memberId, startDate, endDate) {
  return entries
    .filter(e => 
      e.memberId === memberId &&
      e.date >= startDate &&
      e.date <= endDate
    )
    .reduce((sum, e) => sum + e.plannedHours, 0);
}

/**
 * Calcule le total des heures réalisées pour un membre sur une période
 */
function sumActualHoursForMember(entries, memberId, startDate, endDate) {
  return entries
    .filter(e => 
      e.memberId === memberId &&
      e.date >= startDate &&
      e.date <= endDate
    )
    .reduce((sum, e) => sum + e.actualHours, 0);
}

/**
 * Calcule le total des heures prévues par affectation
 * @param {Array} entries - TimeEntries normalisées
 * @param {number} assignmentId - ID de l'affectation
 * @returns {number} Total des heures prévues
 */
function sumPlannedHoursForAssignment(entries, assignmentId) {
  return entries
    .filter(e => e.assignmentId === assignmentId)
    .reduce((sum, e) => sum + e.plannedHours, 0);
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Convertit un tableau colonnaire Grist en tableau d'objets
 */
function columnarToRows(data) {
  if (!data || Array.isArray(data)) return data || [];
  
  const cols = Object.keys(data);
  if (!cols.length) return [];
  
  const n = (data[cols[0]] && data[cols[0]].length) || 0;
  const rows = [];
  
  for (let i = 0; i < n; i++) {
    const rec = {};
    for (const col of cols) {
      rec[col] = data[col][i];
    }
    rows.push(rec);
  }
  
  return rows;
}

/**
 * Obtient le lundi d'une date donnée
 */
function getMonday(date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
}

/**
 * Vérifie si une entrée est verrouillée (feuille soumise ou validée)
 * Helper pour éviter la duplication dans le CRA
 */
function isEntryLocked(entry) {
  if (!entry) return false;
  return (
    entry.sheetStatus === 'submitted' ||
    entry.sheetStatus === 'validated'
  );
}

// ============================================================================
// EXPORT PUBLIC - Compatible Node ET navigateur
// ============================================================================

const TimeEntryLoaderExports = {
  // Chargement
  loadTimeEntries,
  normalizeTimeEntry,
  
  // Regroupements
  groupEntriesByAssignment,
  groupEntriesByMemberAndDate,
  groupEntriesByMemberAndPeriod,
  
  // Calculs
  sumPlannedHoursForMember,
  sumActualHoursForMember,
  sumPlannedHoursForAssignment,
  
  // Helpers
  gristDateToIso,
  isoToGristDate,
  normalizeSheetStatus,
  columnarToRows,
  getMonday,
  isEntryLocked
};

// Export pour Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TimeEntryLoaderExports;
}

// Export pour navigateur (UMD-like)
if (typeof window !== 'undefined') {
  window.TaskFlowTimeEntryLoader = TimeEntryLoaderExports;
}

// Export pour globalThis (fallback)
if (typeof globalThis !== 'undefined') {
  globalThis.TaskFlowTimeEntryLoader = TimeEntryLoaderExports;
}
