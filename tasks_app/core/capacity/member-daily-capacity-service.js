/**
 * Member Daily Capacity Service - Gestion des capacités quotidiennes
 * 
 * Service dédié pour créer, réconcilier et assurer les capacités quotidiennes
 * des membres dans la table MemberDailyCapacities.
 */

'use strict';

const { parseDateUTC, formatDateUTC, addDaysUTC, compareDates, toCentiHours, toHours, validateNumber } = require('../planning/planning-engine.js');
const { getDocApi } = require('../grist/grist-api-helper.js');

// ============================================================================
// CONSTANTES
// ============================================================================

const DEFAULT_WEEKLY_CAPACITY = 35;
const DAYS_PER_WEEK = 5;

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Valide strictement les capacités et disponibilités
 * @param {Object} input - Paramètres à valider
 * @returns {Object} Résultat avec valid, errors, diagnostics
 */
function validateCapacityInput(input) {
  const errors = [];
  const diagnostics = [];
  
  // Valider capaciteHebdo (optionnel si defaultWeeklyCapacity est fourni)
  const hasWeeklyCapacity = input.weeklyCapacity !== null && input.weeklyCapacity !== undefined && input.weeklyCapacity !== '';
  const hasDefaultCapacity = input.defaultWeeklyCapacity !== null && input.defaultWeeklyCapacity !== undefined && input.defaultWeeklyCapacity !== '';
  
  if (hasWeeklyCapacity) {
    const weeklyCapValidation = validateNumber(input.weeklyCapacity, 'capaciteHebdo');
    if (!weeklyCapValidation.valid) {
      errors.push({
        code: 'INVALID_WEEKLY_CAPACITY',
        message: weeklyCapValidation.error
      });
    } else if (input.weeklyCapacity < 0) {
      errors.push({
        code: 'INVALID_WEEKLY_CAPACITY',
        message: 'capaciteHebdo doit être >= 0'
      });
    }
  } else if (!hasDefaultCapacity) {
    // Ni weeklyCapacity ni defaultWeeklyCapacity n'est fourni
    errors.push({
      code: 'INVALID_WEEKLY_CAPACITY',
      message: 'capaciteHebdo est requis ou defaultWeeklyCapacity doit être fourni'
    });
  }
  
  // Valider defaultWeeklyCapacity
  const defaultCapValidation = validateNumber(input.defaultWeeklyCapacity, 'defaultWeeklyCapacity');
  if (!defaultCapValidation.valid) {
    errors.push({
      code: 'INVALID_DEFAULT_CAPACITY',
      message: defaultCapValidation.error
    });
  } else if (input.defaultWeeklyCapacity < 0) {
    errors.push({
      code: 'INVALID_DEFAULT_CAPACITY',
      message: 'defaultWeeklyCapacity doit être >= 0'
    });
  }
  
  // Valider les disponibilités
  if (input.availabilities && Array.isArray(input.availabilities)) {
    for (let i = 0; i < input.availabilities.length; i++) {
      const avail = input.availabilities[i];
      
      // Valider le ratio de disponibilité
      if (typeof avail.dispo !== 'number' || !Number.isFinite(avail.dispo)) {
        errors.push({
          code: 'INVALID_AVAILABILITY_RATIO',
          index: i,
          message: `dispo doit être un nombre fini, reçu ${avail.dispo}`
        });
      } else if (avail.dispo < 0 || avail.dispo > 1) {
        errors.push({
          code: 'INVALID_AVAILABILITY_RATIO',
          index: i,
          dispo: avail.dispo,
          message: `dispo doit être compris entre 0 et 1, reçu ${avail.dispo}`
        });
      }
      
      // Valider les dates
      const startDate = typeof avail.dateDebut === 'number' ? new Date(avail.dateDebut * 1000).toISOString().split('T')[0] : avail.dateDebut;
      const endDate = typeof avail.dateFin === 'number' ? new Date(avail.dateFin * 1000).toISOString().split('T')[0] : avail.dateFin;
      
      if (startDate && endDate && compareDates(startDate, endDate) > 0) {
        errors.push({
          code: 'INVALID_AVAILABILITY_DATE_RANGE',
          index: i,
          message: `dateDebut (${startDate}) doit être <= dateFin (${endDate})`
        });
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    diagnostics
  };
}

// ============================================================================
// CONSTRUCTION DES CAPACITÉS DÉSIRÉES
// ============================================================================

/**
 * Construit les capacités quotidiennes désirées pour un membre sur une période
 * @param {Object} input - Paramètres d'entrée
 * @param {number} input.memberId - ID du membre
 * @param {number|string} [input.weeklyCapacity] - Capacité hebdomadaire du membre
 * @param {Array} [input.availabilities] - Disponibilités du membre
 * @param {string} input.startDate - Date de début (YYYY-MM-DD)
 * @param {string} input.endDate - Date de fin (YYYY-MM-DD)
 * @param {number} [input.defaultWeeklyCapacity=35] - Capacité par défaut
 * @param {string} [input.source='calcul'] - Source de la capacité
 * @param {number} [input.revision=1] - Numéro de révision
 * @returns {Object} Résultat avec capacities, diagnostics, errors
 */
function buildDesiredMemberDailyCapacities(input) {
  const diagnostics = [];
  const errors = [];
  
  const {
    memberId,
    weeklyCapacity,
    availabilities = [],
    startDate,
    endDate,
    defaultWeeklyCapacity = DEFAULT_WEEKLY_CAPACITY,
    source = 'calcul',
    revision = 1
  } = input;
  
  // Validation stricte
  const validation = validateCapacityInput({
    weeklyCapacity,
    defaultWeeklyCapacity,
    availabilities
  });
  
  if (!validation.valid) {
    return {
      capacities: [],
      diagnostics: validation.errors,
      errors: validation.errors
    };
  }
  
  // Déterminer la capacité hebdomadaire effective
  let effectiveWeeklyCapacity = weeklyCapacity;
  
  if (effectiveWeeklyCapacity === null || effectiveWeeklyCapacity === undefined || effectiveWeeklyCapacity === '') {
    effectiveWeeklyCapacity = defaultWeeklyCapacity;
    diagnostics.push({
      code: 'DEFAULT_CAPACITY_USED',
      message: `Capacité hebdomadaire par défaut utilisée : ${effectiveWeeklyCapacity}h`
    });
  }
  
  // Capacité quotidienne de base (lundi-vendredi)
  const dailyBaseCapacity = toHours(Math.round((effectiveWeeklyCapacity / DAYS_PER_WEEK) * 100));
  
  // Traiter les disponibilités - construire un map par date
  const availabilityMap = new Map();
  
  for (const avail of availabilities) {
    const availStart = typeof avail.dateDebut === 'number' 
      ? formatDateUTC(new Date(avail.dateDebut * 1000))
      : avail.dateDebut;
    const availEnd = typeof avail.dateFin === 'number'
      ? formatDateUTC(new Date(avail.dateFin * 1000))
      : avail.dateFin;
    const dispoRatio = typeof avail.dispo === 'number' ? avail.dispo : 1;
    
    if (!availStart || !availEnd) continue;
    
    // Marquer les dates couvertes par cette disponibilité
    let current = parseDateUTC(availStart);
    const end = parseDateUTC(availEnd);
    
    if (!current || !end) continue;
    
    while (current <= end) {
      const dateStr = formatDateUTC(current);
      const existingRatio = availabilityMap.get(dateStr);
      
      // Prendre le ratio le plus restrictif (minimum)
      if (existingRatio === undefined || dispoRatio < existingRatio) {
        availabilityMap.set(dateStr, dispoRatio);
      }
      
      current = addDaysUTC(current, 1);
    }
  }
  
  // Générer les capacités quotidiennes
  const capacities = [];
  let currentDate = parseDateUTC(startDate);
  const endDateObj = parseDateUTC(endDate);
  
  if (!currentDate || !endDateObj) {
    return {
      capacities: [],
      diagnostics: [{ code: 'INVALID_DATE_RANGE', message: 'Intervalle de dates invalide' }],
      errors: [{ code: 'INVALID_DATE_RANGE', message: 'Intervalle de dates invalide' }]
    };
  }
  
  while (currentDate <= endDateObj) {
    const dateStr = formatDateUTC(currentDate);
    const dayOfWeek = currentDate.getUTCDay();
    
    // Week-end = 0
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
    
    let capaciteTheorique = 0;
    let disponibiliteRatio = 1;
    let capaciteDisponible = 0;
    let absenceHeures = 0;
    
    if (!isWeekend) {
      capaciteTheorique = dailyBaseCapacity;
      
      // Appliquer le ratio de disponibilité
      const dispoRatio = availabilityMap.get(dateStr);
      
      if (dispoRatio !== undefined) {
        disponibiliteRatio = dispoRatio;
      }
      
      capaciteDisponible = toHours(Math.round(capaciteTheorique * disponibiliteRatio * 100));
      absenceHeures = toHours(Math.round((capaciteTheorique - capaciteDisponible) * 100));
      
      // S'assurer que absenceHeures >= 0
      if (absenceHeures < 0) {
        absenceHeures = 0;
      }
    }
    
    capacities.push({
      memberId,
      date: dateStr,
      capaciteTheorique,
      disponibiliteRatio,
      capaciteDisponible,
      absenceHeures,
      source,
      revision,
      commentaire: null
    });
    
    currentDate = addDaysUTC(currentDate, 1);
  }
  
  return {
    capacities,
    diagnostics,
    errors
  };
}

// ============================================================================
// RÉCONCILIATION DES CAPACITÉS
// ============================================================================

// Priorité des sources (ordre décroissant)
const SOURCE_PRIORITY = {
  'manuel': 3,
  'Lucca': 2,
  'calcul': 1
};

/**
 * Vérifie si une source peut remplacer une autre source
 * @param {string} existingSource - Source existante
 * @param {string} desiredSource - Source désirée
 * @param {boolean} forceSourceOverride - Si true, ignore la priorité
 * @returns {boolean} true si la mise à jour est autorisée
 */
function canUpdateSource(existingSource, desiredSource, forceSourceOverride = false) {
  if (forceSourceOverride) {
    return true;
  }
  
  const existingPriority = SOURCE_PRIORITY[existingSource] || 0;
  const desiredPriority = SOURCE_PRIORITY[desiredSource] || 0;
  
  // La source désirée doit avoir une priorité supérieure ou égale
  return desiredPriority >= existingPriority;
}

/**
 * Réconcilie les capacités existantes avec les capacités désirées
 * @param {Array} existingRows - Capacités existantes (lignes Grist)
 * @param {Array} desiredRows - Capacités désirées (format domaine)
 * @param {Object} options - Options de réconciliation
 * @param {string} [options.todayIso] - Date de référence pour la protection historique
 * @param {boolean} [options.forceHistoricalRebuild=false] - Si true, autorise la modification du passé
 * @param {boolean} [options.forceSourceOverride=false] - Si true, ignore la priorité des sources
 * @param {number} [options.nowUnixSeconds] - Timestamp pour sourceUpdatedAt
 * @returns {Object} Résultat avec creates, updates, deletes, conflicts
 */
function reconcileMemberDailyCapacities(existingRows, desiredRows, options = {}) {
  const {
    nowUnixSeconds = Math.floor(Date.now() / 1000),
    todayIso,
    forceHistoricalRebuild = false,
    forceSourceOverride = false
  } = options;
  
  const creates = [];
  const updates = [];
  const deletes = [];
  const conflicts = [];
  
  // Indexer les capacités existantes par memberId + date
  const existingByKey = new Map();
  const duplicateExistingKeys = new Set();
  
  for (const row of existingRows || []) {
    // Convertir la date en string YYYY-MM-DD pour la clé
    let dateStr;
    if (typeof row.date === 'number') {
      dateStr = formatDateUTC(new Date(row.date * 1000));
    } else if (typeof row.date === 'string') {
      dateStr = row.date;
    } else {
      continue;
    }
    const key = `${row.membre}:${dateStr}`;
    
    // Détecter les doublons
    if (existingByKey.has(key)) {
      // Doublon détecté - ajouter un conflit
      const existingRow = existingByKey.get(key);
      conflicts.push({
        code: 'DUPLICATE_MEMBER_DAILY_CAPACITY',
        key,
        memberId: row.membre,
        date: dateStr,
        entryIds: [existingRow.id, row.id],
        message: `Doublon de capacité existante pour ${key} (IDs: ${existingRow.id}, ${row.id})`
      });
      duplicateExistingKeys.add(key);
    } else {
      existingByKey.set(key, row);
    }
  }
  
  // Indexer les capacités désirées par memberId + date
  const desiredByKey = new Map();
  const duplicateDesiredKeys = new Set();
  
  for (const desired of desiredRows || []) {
    const key = `${desired.memberId}:${desired.date}`;
    
    // Vérifier les doublons dans desiredRows
    if (desiredByKey.has(key)) {
      // Doublon détecté
      const existingDesired = desiredByKey.get(key);
      conflicts.push({
        code: 'DUPLICATE_MEMBER_DAILY_CAPACITY',
        key,
        memberId: desired.memberId,
        date: desired.date,
        message: `Doublon de capacité désirée pour ${key}`
      });
      duplicateDesiredKeys.add(key);
      continue;
    }
    
    desiredByKey.set(key, desired);
  }
  
  // Traiter les créations et mises à jour
  for (const [key, desired] of desiredByKey) {
    // Ignorer les clés avec des doublons désirés
    if (duplicateDesiredKeys.has(key)) {
      continue;
    }
    
    // Ignorer les clés avec des doublons existants
    if (duplicateExistingKeys.has(key)) {
      continue;
    }
    
    const existing = existingByKey.get(key);
    
    if (!existing) {
      // Création
      creates.push({
        membre: desired.memberId,
        date: Math.floor(new Date(desired.date + 'T00:00:00Z').getTime() / 1000),
        capaciteTheorique: desired.capaciteTheorique,
        disponibiliteRatio: desired.disponibiliteRatio,
        capaciteDisponible: desired.capaciteDisponible,
        absenceHeures: desired.absenceHeures,
        source: desired.source,
        revision: desired.revision,
        sourceUpdatedAt: nowUnixSeconds,
        commentaire: desired.commentaire
      });
    } else {
      // Vérifier la protection historique
      const isHistorical = todayIso && desired.date < todayIso;
      if (isHistorical && !forceHistoricalRebuild) {
        // Protéger l'historique : aucune mise à jour automatique
        continue;
      }
      
      // Vérifier la priorité des sources
      const existingSource = existing.source || 'calcul';
      const desiredSource = desired.source || 'calcul';
      
      if (!canUpdateSource(existingSource, desiredSource, forceSourceOverride)) {
        // La source désirée ne peut pas remplacer la source existante
        continue;
      }
      
      // Vérifier si mise à jour nécessaire
      const needsUpdate = (
        Math.abs((existing.capaciteTheorique || 0) - desired.capaciteTheorique) > 0.005 ||
        Math.abs((existing.disponibiliteRatio || 1) - desired.disponibiliteRatio) > 0.005 ||
        Math.abs((existing.capaciteDisponible || 0) - desired.capaciteDisponible) > 0.005 ||
        Math.abs((existing.absenceHeures || 0) - desired.absenceHeures) > 0.005 ||
        (existingSource !== desiredSource && desiredSource !== null)
      );
      
      if (needsUpdate) {
        updates.push({
          id: existing.id,
          fields: {
            capaciteTheorique: desired.capaciteTheorique,
            disponibiliteRatio: desired.disponibiliteRatio,
            capaciteDisponible: desired.capaciteDisponible,
            absenceHeures: desired.absenceHeures,
            source: desired.source,
            revision: (existing.revision || 0) + 1,
            sourceUpdatedAt: nowUnixSeconds,
            commentaire: desired.commentaire
          }
        });
      }
    }
  }
  
  // Note: On ne supprime pas automatiquement les anciennes capacités
  // car elles pourraient être historiques
  
  return {
    creates,
    updates,
    deletes,
    conflicts
  };
}

// ============================================================================
// ASSURANCE DES CAPACITÉS DANS GRIST
// ============================================================================

/**
 * Assure les capacités quotidiennes pour un membre sur une période dans Grist
 * @param {Object} grist - API Grist
 * @param {number} memberId - ID du membre
 * @param {string} startDate - Date de début (YYYY-MM-DD)
 * @param {string} endDate - Date de fin (YYYY-MM-DD)
 * @param {Object} options - Options
 * @returns {Promise<Object>} Résultat avec success, actionsExecuted, etc.
 */
async function ensureMemberDailyCapacities(grist, memberId, startDate, endDate, options = {}) {
  const docApi = getDocApi(grist);
  
  const {
    weeklyCapacity,
    availabilities = [],
    defaultWeeklyCapacity = DEFAULT_WEEKLY_CAPACITY,
    source = 'calcul',
    dryRun = false,
    nowUnixSeconds = Math.floor(Date.now() / 1000),
    todayIso,
    forceHistoricalRebuild = false,
    forceSourceOverride = false
  } = options;
  
  // Charger les capacités existantes
  const existingData = await docApi.fetchTable('MemberDailyCapacities');
  const existingRows = columnarToRows(existingData)
    .filter(row => row.membre === memberId);
  
  // Filtrer pour ne garder que celles dans la période
  const startDateObj = parseDateUTC(startDate);
  const endDateObj = parseDateUTC(endDate);
  
  const existingInRange = existingRows.filter(row => {
    const rowDate = typeof row.date === 'number' 
      ? formatDateUTC(new Date(row.date * 1000))
      : row.date;
    const dateObj = parseDateUTC(rowDate);
    return dateObj && startDateObj && endDateObj && 
           dateObj >= startDateObj && dateObj <= endDateObj;
  });
  
  // Construire les capacités désirées
  const desiredResult = buildDesiredMemberDailyCapacities({
    memberId,
    weeklyCapacity,
    availabilities,
    startDate,
    endDate,
    defaultWeeklyCapacity,
    source,
    revision: 1
  });
  
  if (desiredResult.errors && desiredResult.errors.length > 0) {
    return {
      success: false,
      error: {
        code: 'INVALID_CAPACITY_INPUT',
        errors: desiredResult.errors
      },
      diagnostics: desiredResult.diagnostics
    };
  }
  
  // Réconcilier avec les options de protection
  const reconciliation = reconcileMemberDailyCapacities(
    existingInRange,
    desiredResult.capacities,
    { nowUnixSeconds, todayIso, forceHistoricalRebuild, forceSourceOverride }
  );
  
  if (reconciliation.conflicts && reconciliation.conflicts.length > 0) {
    return {
      success: false,
      error: {
        code: 'CAPACITY_CONFLICTS',
        conflicts: reconciliation.conflicts
      },
      diagnostics: desiredResult.diagnostics
    };
  }
  
  // Transformer en actions Grist
  const actions = [];
  
  for (const create of reconciliation.creates) {
    actions.push(['AddRecord', 'MemberDailyCapacities', null, create]);
  }
  
  for (const update of reconciliation.updates) {
    actions.push(['UpdateRecord', 'MemberDailyCapacities', update.id, update.fields]);
  }
  
  if (dryRun || actions.length === 0) {
    return {
      success: true,
      dryRun,
      actionsExecuted: 0,
      actions,
      creates: reconciliation.creates.length,
      updates: reconciliation.updates.length,
      diagnostics: desiredResult.diagnostics
    };
  }
  
  // Appliquer les actions
  try {
    await docApi.applyUserActions(actions);
    
    return {
      success: true,
      actionsExecuted: actions.length,
      creates: reconciliation.creates.length,
      updates: reconciliation.updates.length,
      diagnostics: desiredResult.diagnostics
    };
  } catch (e) {
    return {
      success: false,
      error: {
        code: 'GRIST_ACTION_FAILED',
        message: e.message || String(e)
      },
      actions,
      diagnostics: desiredResult.diagnostics
    };
  }
}

// Helper: convertir tableau colonnaire en lignes
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

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

module.exports = {
  // Construction
  buildDesiredMemberDailyCapacities,
  
  // Réconciliation
  reconcileMemberDailyCapacities,
  
  // Assurance dans Grist
  ensureMemberDailyCapacities,
  
  // Validation
  validateCapacityInput,
  
  // Utilitaires
  canUpdateSource,
  SOURCE_PRIORITY,
  
  // Constantes
  DEFAULT_WEEKLY_CAPACITY
};
