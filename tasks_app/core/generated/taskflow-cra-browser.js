/* ============================================================================
 * taskflow-cra-browser.js — Bundle navigateur pour le workflow CRA
 * ----------------------------------------------------------------------------
 * Fichier généré automatiquement par scripts/build-cra-browser.js
 * NE PAS EDITER MANUELLEMENT
 * 
 * Usage:
 *   <script src="core/generated/taskflow-cra-browser.js"></script>
 *   const service = window.TaskFlowCra.service;
 * ========================================================================== */

(function(global) {
  'use strict';
  
  // Registry des modules (remplie ci-dessous)
  var moduleFactories = new Map();
  var moduleCache = new Map();
  
  // Fonction require interne avec cache
  function __require(id) {
    if (moduleCache.has(id)) {
      return moduleCache.get(id);
    }
    
    if (!moduleFactories.has(id)) {
      throw new Error('Module non résolu: ' + id);
    }
    
    var exports = moduleFactories.get(id)();
    moduleCache.set(id, exports);
    return exports;
  }


  // Module: planning/planning-engine
  moduleFactories.set('planning/planning-engine', (function() {
    var exports = {};
    var __require = function(id) {
      if (!moduleCache.has(id)) {
        if (!moduleFactories.has(id)) {
          throw new Error('Module non résolu: ' + id);
        }
        moduleCache.set(id, moduleFactories.get(id)());
      }
      return moduleCache.get(id);
    };
    
    /**
 * Planning Engine - Moteur de planification pur (indépendant de Grist et du DOM)
 * 
 * Gère la répartition des heures allouées sur les dates disponibles,
 * en tenant compte des capacités et des entrées existantes.
 */
const PRECISION_CENTIHOURS = 1;

/**
 * Valide qu'une valeur est un nombre fini
 * @param {*} value - Valeur à valider
 * @param {string} fieldName - Nom du champ pour les messages d'erreur
 * @param {Object} options - Options de validation
 * @param {boolean} [options allowNull=false] - Autoriser null/undefined comme zéro
 * @param {boolean} [options allowNegative=false] - Autoriser les nombres négatifs
 * @returns {{ valid: boolean, value: number, error: string|null }}
 */
function validateNumber(value, fieldName, options = {}) {
  const { allowNull = false, allowNegative = false } = options;
  
  if (value === null || value === undefined || value === '') {
    if (allowNull) {
      return { valid: true, value: 0, error: null };
    }
    return { 
      valid: false, 
      value: 0, 
      error: `INVALID_${fieldName.toUpperCase()}: ${fieldName} est requis` 
    };
  }
  
  if (typeof value !== 'number') {
    return { 
      valid: false, 
      value: 0, 
      error: `INVALID_${fieldName.toUpperCase()}: ${fieldName} doit être un nombre, reçu ${typeof value}` 
    };
  }
  
  if (!Number.isFinite(value)) {
    return { 
      valid: false, 
      value: 0, 
      error: `INVALID_${fieldName.toUpperCase()}: ${fieldName} doit être fini, reçu ${value}` 
    };
  }
  
  if (Number.isNaN(value)) {
    return { 
      valid: false, 
      value: 0, 
      error: `INVALID_${fieldName.toUpperCase()}: ${fieldName} ne peut pas être NaN` 
    };
  }
  
  if (!allowNegative && value < 0) {
    return { 
      valid: false, 
      value: 0, 
      error: `INVALID_${fieldName.toUpperCase()}: ${fieldName} ne peut pas être négatif, reçu ${value}` 
    };
  }
  
  return { valid: true, value, error: null };
}

/**
 * Indique si une valeur réalisée a été explicitement saisie.
 * Le zéro est une valeur métier : il ne doit pas être confondu avec null.
 */
function hasExplicitActualHours(entry) {
  return entry &&
    entry.actualHours !== null &&
    entry.actualHours !== undefined &&
    entry.actualHours !== '' &&
    Number.isFinite(Number(entry.actualHours));
}

/**
 * Convertit des heures (float) en centièmes d'heure (entier)
 * @param {number} hours - Heures à convertir
 * @returns {number} Centièmes d'heure
 */
function toCentiHours(hours) {
  const validated = validateNumber(hours, 'hours', { allowNull: true, allowNegative: true });
  return Math.round(validated.value * 100);
}

/**
 * Convertit des centièmes d'heure en heures (float)
 * @param {number} centiHours - Centièmes d'heure
 * @returns {number} Heures
 */
function toHours(centiHours) {
  return centiHours / 100;
}

/**
 * Parse une date YYYY-MM-DD en objet Date UTC
 * @param {string} dateStr - Date au format YYYY-MM-DD
 * @returns {Date|null} Date UTC ou null si invalide
 */
function parseDateUTC(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return null;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (formatDateUTC(date) !== dateStr) {
    return null;
  }
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

/**
 * Ajoute un jour à une date UTC
 * @param {Date} date - Date de départ
 * @param {number} days - Nombre de jours à ajouter
 * @returns {Date} Nouvelle date
 */
function addDaysUTC(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Compare deux dates (format YYYY-MM-DD)
 * @param {string} a - Première date
 * @param {string} b - Deuxième date
 * @returns {number} -1 si a < b, 0 si égal, 1 si a > b
 */
function compareDates(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Vérifie si une date civile (YYYY-MM-DD) est un jour ouvré (lundi-vendredi)
 * @param {string} dateIso - Date au format YYYY-MM-DD
 * @returns {boolean} true si lundi-vendredi, false si samedi-dimanche
 */
function isWeekdayIso(dateIso) {
  const date = parseDateUTC(dateIso);
  if (!date) return false;
  const dayOfWeek = date.getUTCDay();
  return dayOfWeek !== 0 && dayOfWeek !== 6;
}

/**
 * Vérifie si une date est dans un intervalle
 * @param {string} date - Date à tester
 * @param {string} startDate - Date de début (inclusive)
 * @param {string} endDate - Date de fin (inclusive)
 * @returns {boolean}
 */
function isDateInRange(date, startDate, endDate) {
  return compareDates(date, startDate) >= 0 && compareDates(date, endDate) <= 0;
}

/**
 * Génère la liste des dates entre startDate et endDate (inclus)
 * @param {string|Date} startDate - Date de début (YYYY-MM-DD ou Date)
 * @param {string|Date} endDate - Date de fin (YYYY-MM-DD ou Date)
 * @returns {string[]} Tableau de dates YYYY-MM-DD (vide si dates invalides ou plage inversée)
 */
function generateDateRange(startDate, endDate) {
  const dates = [];
  
  let current, end;
  
  // Convertir startDate
  if (startDate instanceof Date) {
    if (!Number.isFinite(startDate.getTime())) {
      return dates;
    }
    current = new Date(startDate.getTime());
  } else if (typeof startDate === 'string') {
    current = parseDateUTC(startDate);
    if (!current) {
      return dates;
    }
  } else {
    return dates;
  }
  
  // Convertir endDate
  if (endDate instanceof Date) {
    if (!Number.isFinite(endDate.getTime())) {
      return dates;
    }
    end = new Date(endDate.getTime());
  } else if (typeof endDate === 'string') {
    end = parseDateUTC(endDate);
    if (!end) {
      return dates;
    }
  } else {
    return dates;
  }
  
  // Vérifier que startDate <= endDate
  if (compareDates(formatDateUTC(current), formatDateUTC(end)) > 0) {
    return dates;
  }
  
  while (compareDates(formatDateUTC(current), formatDateUTC(end)) <= 0) {
    dates.push(formatDateUTC(current));
    current = addDaysUTC(current, 1);
  }
  
  return dates;
}

/**
 * Détecte les doublons dans un tableau d'entrées
 * @param {Array} entries - Entrées à vérifier
 * @param {string} idField - Champ à utiliser pour l'ID
 * @returns {{ duplicates: Array, hasDuplicates: boolean }}
 */
function findDuplicates(entries, idField = 'id') {
  const seen = new Map();
  const duplicates = [];
  
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const key = `${entry.assignmentId}:${entry.date}`;
    
    if (seen.has(key)) {
      duplicates.push({
        index: i,
        entry,
        key,
        firstIndex: seen.get(key),
        firstEntry: entries[seen.get(key)]
      });
    } else {
      seen.set(key, i);
    }
  }
  
  return {
    duplicates,
    hasDuplicates: duplicates.length > 0
  };
}

/**
 * Construit un plan d'affectation en répartissant les heures allouées
 * sur les dates disponibles, en tenant compte des capacités et des entrées existantes.
 * 
 * @param {Object} input - Paramètres d'entrée
 * @param {Object} input.assignment - Affectation avec id, taskId, memberId, allocatedHours, startDate, endDate
 * @param {Array} input.capacities - Tableau de capacités avec date, baseCapacityHours, availableCapacityHours
 * @param {Array} input.existingEntries - Entrées existantes avec id, assignmentId, date, plannedHours, actualHours, sheetStatus, description, imputation
 * @param {string} [input.replanFromDate] - Date à partir de laquelle recalculer le plan (YYYY-MM-DD)
 * @param {number} [input.precisionHours=0.01] - Précision en heures
 * @param {string} [input.capacityPolicy="cap"] - Politique de capacité : "cap" ou "allow-overload"
 * @returns {Object} Résultat avec desiredPlan, summary, diagnostics
 */
function buildAssignmentPlan(input) {
  const diagnostics = [];
  const errors = [];
  
  const {
    assignment,
    capacities,
    existingEntries,
    replanFromDate,
    precisionHours = 0.01,
    capacityPolicy = "cap"
  } = input;
  
  if (!assignment) {
    return {
      desiredPlan: [],
      summary: {
        allocatedHours: 0,
        validatedActualHours: 0,
        protectedPlannedHours: 0,
        remainingHours: 0,
        newlyPlannedHours: 0,
        unplannedHours: 0,
        overconsumedHours: 0,
        overprotectedHours: 0
      },
      diagnostics: [{ code: "MISSING_ASSIGNMENT", message: "Aucune affectation fournie" }]
    };
  }
  
  const allocatedValidation = validateNumber(assignment.allocatedHours, 'allocatedHours');
  if (!allocatedValidation.valid) {
    return {
      desiredPlan: [],
      summary: {
        allocatedHours: 0,
        validatedActualHours: 0,
        protectedPlannedHours: 0,
        remainingHours: 0,
        newlyPlannedHours: 0,
        unplannedHours: 0,
        overconsumedHours: 0,
        overprotectedHours: 0
      },
      diagnostics: [{ code: allocatedValidation.error.split(':')[0], message: allocatedValidation.error }]
    };
  }
  
  const allocatedCentiHours = toCentiHours(assignment.allocatedHours);
  const startDate = assignment.startDate;
  const endDate = assignment.endDate;
  const assignmentId = assignment.id;
  
  const effectiveReplanFromDate = replanFromDate || startDate;
  
  const capacityMap = new Map();
  for (const cap of capacities || []) {
    const baseCapValidation = validateNumber(cap.baseCapacityHours, 'baseCapacityHours');
    const availCapValidation = validateNumber(cap.availableCapacityHours, 'availableCapacityHours');
    
    if (!baseCapValidation.valid || !availCapValidation.valid) {
      errors.push(baseCapValidation.error || availCapValidation.error);
      continue;
    }
    
    capacityMap.set(cap.date, {
      baseCapacityHours: cap.baseCapacityHours,
      availableCapacityHours: cap.availableCapacityHours,
      distributionCapacityHours: cap.distributionCapacityHours
    });
  }
  
  if (errors.length > 0) {
    diagnostics.push({
      code: "INVALID_CAPACITY",
      message: `Erreurs de capacité : ${errors.join(', ')}`
    });
  }
  
  // Séparer explicitement :
  // 1. entriesForAccounting : toutes les lignes de l'affectation (pour le calcul comptable)
  // 2. entriesInAssignmentRange : lignes entre startDate et endDate (pour la réconciliation)
  
  // Calcul comptable : toutes les entrées de l'affectation, peu importe la date
  let effectiveActualCentiHours = 0;
  let hasInvalidActualHours = false;
  
  for (const entry of existingEntries || []) {
    if (entry.assignmentId !== assignmentId) continue;
    
    // Refuser strictement les heures réalisées négatives
    const actualValidation = validateNumber(entry.actualHours, 'actualHours', { allowNull: true, allowNegative: false });
    if (!actualValidation.valid) {
      diagnostics.push({
        code: "INVALID_ACTUAL_HOURS",
        entryId: entry.id,
        date: entry.date,
        actualHours: entry.actualHours,
        message: `actualHours invalide : ${actualValidation.error}`
      });
      hasInvalidActualHours = true;
      continue;
    }
    
    // Une saisie explicite, même en brouillon et même égale à zéro, devient
    // immédiatement la réalité de la journée. La validation verrouille la
    // ligne, mais ne change pas sa valeur comptable.
    if (hasExplicitActualHours(entry)) {
      effectiveActualCentiHours += toCentiHours(Number(entry.actualHours));
    }
  }
  
  // Si des heures réalisées négatives ont été détectées, bloquer immédiatement
  if (hasInvalidActualHours) {
    return {
      desiredPlan: [],
      summary: {
        allocatedHours: toHours(allocatedCentiHours),
        validatedActualHours: 0,
        protectedPlannedHours: 0,
        remainingHours: 0,
        newlyPlannedHours: 0,
        unplannedHours: 0,
        overconsumedHours: 0,
        overprotectedHours: 0
      },
      diagnostics
    };
  }
  
  const validatedActualHours = toHours(effectiveActualCentiHours);
  const overconsumedCentiHours = Math.max(0, effectiveActualCentiHours - allocatedCentiHours);
  const overconsumedHours = toHours(overconsumedCentiHours);
  
  // Si surconsommation, retourner immédiatement sans plan
  if (overconsumedCentiHours > 0) {
    diagnostics.push({
      code: "OVERCONSUMPTION",
      message: `Le réalisé renseigné (${validatedActualHours}h) dépasse l'allocation (${toHours(allocatedCentiHours)}h) de ${overconsumedHours}h`
    });
    
    return {
      desiredPlan: [],
      summary: {
        allocatedHours: toHours(allocatedCentiHours),
        validatedActualHours,
        protectedPlannedHours: 0,
        remainingHours: 0,
        newlyPlannedHours: 0,
        unplannedHours: 0,
        overconsumedHours,
        overprotectedHours: 0
      },
      diagnostics
    };
  }
  
  // Réconciliation quotidienne : uniquement les entrées dans la période
  const existingByDate = new Map();
  for (const entry of existingEntries || []) {
    if (entry.assignmentId !== assignmentId) continue;
    if (!isDateInRange(entry.date, startDate, endDate)) continue;
    
    const plannedValidation = validateNumber(entry.plannedHours, 'plannedHours', { allowNull: true });
    if (!plannedValidation.valid) {
      diagnostics.push({
        code: "INVALID_PLANNED_HOURS",
        entryId: entry.id,
        date: entry.date,
        plannedHours: entry.plannedHours,
        message: `plannedHours invalide : ${plannedValidation.error}`
      });
    }
    
    // Vérification actualHours déjà faite ci-dessus pour le calcul comptable
    // mais on garde la vérification pour les entrées dans la période
    
    const existing = existingByDate.get(entry.date);
    if (existing) {
      existing.push(entry);
    } else {
      existingByDate.set(entry.date, [entry]);
    }
  }
  
  // Détecter les doublons sur TOUTES les entrées de l'affectation (y compris hors période)
  // car les entrées hors période participent au calcul comptable du réalisé validé
  const duplicateCheck = findDuplicates(existingEntries || []);
  if (duplicateCheck.hasDuplicates) {
    let hasBlockingDuplicate = false;

    for (const dup of duplicateCheck.duplicates) {
      const duplicateEntries = [dup.firstEntry, dup.entry];
      const isProtectedHistoricalDuplicate = duplicateEntries.every(entry => {
        const protectedSheet = entry.sheetStatus === 'submitted' || entry.sheetStatus === 'validated';
        const beforeReplan = entry.date && compareDates(entry.date, effectiveReplanFromDate) < 0;
        return protectedSheet || beforeReplan;
      });

      if (!isProtectedHistoricalDuplicate) {
        hasBlockingDuplicate = true;
      }

      diagnostics.push({
        code: isProtectedHistoricalDuplicate
          ? "PROTECTED_DUPLICATE_EXISTING_ENTRY"
          : "DUPLICATE_EXISTING_ENTRY",
        key: dup.key,
        assignmentId: dup.entry.assignmentId,
        date: dup.entry.date,
        entryIds: [dup.firstEntry.id, dup.entry.id],
        protected: isProtectedHistoricalDuplicate,
        message: isProtectedHistoricalDuplicate
          ? `Doublon historique protégé conservé : entrées ${dup.firstEntry.id} et ${dup.entry.id} pour ${dup.key}`
          : `Doublon détecté : entrées ${dup.firstEntry.id} et ${dup.entry.id} pour ${dup.key}`
      });
    }

    if (hasBlockingDuplicate) {
      return {
        desiredPlan: [],
        summary: {
          allocatedHours: toHours(allocatedCentiHours),
          validatedActualHours,
          protectedPlannedHours: 0,
          remainingHours: 0,
          newlyPlannedHours: 0,
          unplannedHours: 0,
          overconsumedHours: 0,
          overprotectedHours: 0
        },
        diagnostics
      };
    }
  }
  
  let protectedPlannedCentiHours = 0;
  const entriesToRespect = new Map();
  const distributableEntries = new Map();
  
  for (const [date, entries] of existingByDate) {
    const isBeforeReplan = compareDates(date, effectiveReplanFromDate) < 0;
    
    let validatedEntry = null;
    let submittedEntry = null;
    let explicitActualEntry = null;
    let draftEntry = null;
    let mutableEntries = [];
    
    for (const entry of entries) {
      if (hasExplicitActualHours(entry)) {
        explicitActualEntry = entry;
      } else if (entry.sheetStatus === 'validated') {
        validatedEntry = entry;
      } else if (entry.sheetStatus === 'submitted') {
        submittedEntry = entry;
      } else if (entry.sheetStatus === 'draft') {
        draftEntry = entry;
      } else {
        mutableEntries.push(entry);
      }
    }
    
    if (explicitActualEntry) {
      entriesToRespect.set(date, explicitActualEntry);
    } else if (validatedEntry) {
      entriesToRespect.set(date, validatedEntry);
      // Compatibilité avec les anciennes feuilles validées qui n'auraient pas
      // matérialisé heures : leur proposition reste malgré tout verrouillée.
      protectedPlannedCentiHours += toCentiHours(validatedEntry.plannedHours || 0);
    } else if (submittedEntry) {
      entriesToRespect.set(date, submittedEntry);
      protectedPlannedCentiHours += toCentiHours(submittedEntry.plannedHours || 0);
    } else if (draftEntry) {
      // Une semaine brouillon peut être en cours d'édition. Sa proposition
      // reste stable jusqu'à une action explicite de l'utilisateur.
      entriesToRespect.set(date, draftEntry);
      protectedPlannedCentiHours += toCentiHours(draftEntry.plannedHours || 0);
    } else if (isBeforeReplan && mutableEntries.length > 0) {
      const entryToProtect = mutableEntries[0];
      entriesToRespect.set(date, entryToProtect);
      protectedPlannedCentiHours += toCentiHours(entryToProtect.plannedHours || 0);
    } else if (!isBeforeReplan && mutableEntries.length > 0) {
      distributableEntries.set(date, mutableEntries[0]);
    }
  }
  
  // validatedActualHours et overconsumedCentiHours déjà calculés plus haut
  // À ce stade, overconsumedCentiHours === 0 (sinon retour immédiat)
  // Donc overconsumedHours === 0 également
  
  const remainingAfterValidated = allocatedCentiHours - effectiveActualCentiHours;
  const overprotectedCentiHours = Math.max(0, protectedPlannedCentiHours - remainingAfterValidated);
  const overprotectedHours = toHours(overprotectedCentiHours);
  
  if (overprotectedCentiHours > 0) {
    diagnostics.push({
      code: "PROTECTED_PLAN_EXCEEDS_ALLOCATION",
      message: `Le prévu protégé (${toHours(protectedPlannedCentiHours)}h) dépasse l'allocation restante (${toHours(remainingAfterValidated)}h) de ${overprotectedHours}h`
    });
    
    return {
      desiredPlan: [],
      summary: {
        allocatedHours: toHours(allocatedCentiHours),
        validatedActualHours,
        protectedPlannedHours: toHours(protectedPlannedCentiHours),
        remainingHours: toHours(remainingAfterValidated),
        newlyPlannedHours: 0,
        unplannedHours: 0,
        overconsumedHours: 0,
        overprotectedHours
      },
      diagnostics
    };
  }
  
  const remainingCentiHours = remainingAfterValidated - protectedPlannedCentiHours;
  
  if (remainingCentiHours <= 0) {
    diagnostics.push({
      code: "FULLY_CONSUMED",
      message: "L'allocation est entièrement consommée (réalisé validé + prévu protégé)"
    });
    
    return {
      desiredPlan: [],
      summary: {
        allocatedHours: toHours(allocatedCentiHours),
        validatedActualHours,
        protectedPlannedHours: toHours(protectedPlannedCentiHours),
        remainingHours: 0,
        newlyPlannedHours: 0,
        unplannedHours: 0,
        overconsumedHours: 0,
        overprotectedHours: 0
      },
      diagnostics
    };
  }
  
  const allDates = generateDateRange(startDate, endDate);
  const distributableDates = [];
  const capacityForDistribution = new Map();
  
  for (const date of allDates) {
    // Règle de jour ouvré : s'applique en premier, indépendamment du reste
    if (!isWeekdayIso(date)) {
      continue;
    }
    
    const isBeforeReplan = compareDates(date, effectiveReplanFromDate) < 0;
    if (isBeforeReplan) continue;
    
    const existingEntry = entriesToRespect.get(date);
    if (existingEntry && existingEntry.sheetStatus === 'submitted') {
      continue;
    }
    
    const distributableEntry = distributableEntries.get(date);
    if (distributableEntry) {
      distributableDates.push(date);
      const cap = capacityMap.get(date);
      const availableCapacity = cap
        ? toCentiHours(
            capacityPolicy === 'allow-overload' && cap.distributionCapacityHours != null
              ? cap.distributionCapacityHours
              : cap.availableCapacityHours
          )
        : 0;
      capacityForDistribution.set(date, availableCapacity);
      continue;
    }
    
    if (existingEntry && (existingEntry.sheetStatus === 'validated' || existingEntry.sheetStatus === null || existingEntry.sheetStatus === 'draft')) {
      continue;
    }
    
    const cap = capacityMap.get(date);
    const availableCapacity = cap
      ? toCentiHours(
          capacityPolicy === 'allow-overload' && cap.distributionCapacityHours != null
            ? cap.distributionCapacityHours
            : cap.availableCapacityHours
        )
      : 0;
    
    if (availableCapacity <= 0) {
      continue;
    }
    
    distributableDates.push(date);
    capacityForDistribution.set(date, availableCapacity);
  }
  
  if (distributableDates.length === 0) {
    const unplannedHours = toHours(remainingCentiHours);
    
    diagnostics.push({
      code: "NO_DISTRIBUTABLE_DATES",
      message: "Aucune date disponible pour la redistribution"
    });
    
    return {
      desiredPlan: [],
      summary: {
        allocatedHours: toHours(allocatedCentiHours),
        validatedActualHours,
        protectedPlannedHours: toHours(protectedPlannedCentiHours),
        remainingHours: toHours(remainingCentiHours),
        newlyPlannedHours: 0,
        unplannedHours,
        overconsumedHours: 0,
        overprotectedHours: 0
      },
      diagnostics
    };
  }
  
  // Algorithme de distribution : plus forts restes sous contrainte de capacité
  // Travailler en centièmes d'heure entiers pour éviter la dérive flottante
  const totalCapacityCentiHours = distributableDates.reduce((sum, date) => {
    return sum + capacityForDistribution.get(date);
  }, 0);
  
  const desiredPlan = [];
  let newlyPlannedCentiHours = 0;
  let remainingToDistribute = remainingCentiHours;
  
  if (totalCapacityCentiHours > 0 && remainingToDistribute > 0) {
    // En mode surcharge autorisée, la capacité sert de poids de lissage mais
    // ne plafonne pas la demande. Les dépassements restent visibles dans le Plan.
    const toDistribute = capacityPolicy === 'allow-overload'
      ? remainingToDistribute
      : Math.min(remainingToDistribute, totalCapacityCentiHours);
    
    // Étape 1: Calculer la part théorique de chaque date et prendre la partie entière
    const distribution = distributableDates.map(date => {
      const cap = capacityForDistribution.get(date);
      const ratio = cap / totalCapacityCentiHours;
      const rawCentiHours = Math.floor(ratio * toDistribute);
      const remainder = (ratio * toDistribute) - rawCentiHours;
      return { 
        date, 
        rawCentiHours, 
        remainder,
        capacity: cap,
        assigned: rawCentiHours
      };
    });
    
    // Étape 2: Sommer les parties entières
    let assignedSum = distribution.reduce((sum, item) => sum + item.rawCentiHours, 0);
    
    // Étape 3: Distribuer les centièmes restants aux plus forts restes
    let centiHoursToAssign = toDistribute - assignedSum;
    
    if (centiHoursToAssign > 0) {
      // Créer un tableau indexé pour trier sans perdre l'ordre original
      const indexed = distribution.map((item, index) => ({ ...item, originalIndex: index }));
      
      // Trier par reste décroissant, puis par date croissante pour déterminisme
      indexed.sort((a, b) => {
        const remainderDiff = b.remainder - a.remainder;
        if (Math.abs(remainderDiff) > 0.0001) return remainderDiff;
        return a.date.localeCompare(b.date);
      });
      
      // Distribuer un centième à la fois, sans dépasser la capacité
      for (let i = 0; i < indexed.length && centiHoursToAssign > 0; i++) {
        const item = indexed[i];
        const currentAssigned = item.assigned;
        const maxAssignable = Math.min(item.capacity - currentAssigned, centiHoursToAssign);
        
        if (maxAssignable > 0) {
          item.assigned = currentAssigned + 1;
          centiHoursToAssign--;
        }
      }
      
      // Remettre dans l'ordre original pour la construction du plan
      indexed.sort((a, b) => a.originalIndex - b.originalIndex);
      
      // Copier les valeurs assignées dans le tableau original
      for (let i = 0; i < indexed.length; i++) {
        distribution[i].assigned = indexed[i].assigned;
      }
    }
    
    // Étape 4: Construire le plan final en respectant les capacités
    for (const item of distribution) {
      let plannedCentiHours = item.assigned;
      
      // Plafonner uniquement avec la politique historique "cap".
      if (capacityPolicy === "cap") {
        plannedCentiHours = Math.min(plannedCentiHours, item.capacity);
      }
      
      if (plannedCentiHours > 0) {
        const cap = capacityMap.get(item.date);
        desiredPlan.push({
          assignmentId,
          taskId: assignment.taskId,
          memberId: assignment.memberId,
          date: item.date,
          plannedHours: toHours(plannedCentiHours),
          baseCapacityHours: cap ? cap.baseCapacityHours : 0,
          availableCapacityHours: cap ? cap.availableCapacityHours : 0
        });
        newlyPlannedCentiHours += plannedCentiHours;
        remainingToDistribute -= plannedCentiHours;
      }
    }
  }
  
  const unplannedCentiHours = remainingToDistribute;

  if (capacityPolicy === 'allow-overload') {
    const overloadedDates = desiredPlan.filter(item => {
      const cap = capacityMap.get(item.date);
      return cap && item.plannedHours > Number(cap.availableCapacityHours || 0) + 0.01;
    });
    if (overloadedDates.length > 0) {
      diagnostics.push({
        code: 'CAPACITY_OVERLOAD_ALLOWED',
        dates: overloadedDates.map(item => item.date),
        message: `${overloadedDates.length} jour(s) dépassent la capacité disponible`
      });
    }
  }
  
  if (unplannedCentiHours > 0) {
    diagnostics.push({
      code: "UNPLANNED_HOURS",
      message: `${toHours(unplannedCentiHours)}h n'ont pas pu être planifiées (capacité insuffisante)`
    });
  }
  
  return {
    desiredPlan,
    summary: {
      allocatedHours: toHours(allocatedCentiHours),
      validatedActualHours,
      protectedPlannedHours: toHours(protectedPlannedCentiHours),
      remainingHours: toHours(remainingCentiHours),
      newlyPlannedHours: toHours(newlyPlannedCentiHours),
      unplannedHours: toHours(unplannedCentiHours),
      overconsumedHours: 0,
      overprotectedHours: 0
    },
    diagnostics
  };
}

return {
  buildAssignmentPlan,
  toCentiHours,
  toHours,
  parseDateUTC,
  formatDateUTC,
  addDaysUTC,
  compareDates,
  isDateInRange,
  generateDateRange,
  findDuplicates,
  validateNumber,
  isWeekdayIso
};

  }));

  // Module: cra/workflow/cra-sheet-workflow
  moduleFactories.set('cra/workflow/cra-sheet-workflow', (function() {
    var exports = {};
    var __require = function(id) {
      if (!moduleCache.has(id)) {
        if (!moduleFactories.has(id)) {
          throw new Error('Module non résolu: ' + id);
        }
        moduleCache.set(id, moduleFactories.get(id)());
      }
      return moduleCache.get(id);
    };
    
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
  const dateIso = gristDateToIso(dateValue);

  if (!dateIso || typeof dateIso !== 'string') {
    return dateIso;
  }

  const [year, month, day] = dateIso.split('-').map(Number);

  const date = new Date(Date.UTC(year, month - 1, day));

  const offset = (date.getUTCDay() + 6) % 7;

  date.setUTCDate(date.getUTCDate() - offset);

  return formatDateUTC(date);
}

/**
 * Normalise une valeur de date vers une date civile Europe/Paris
 * @param {*} value - Valeur Grist
 * @returns {string|null} Date ISO YYYY-MM-DD ou null
 */
function gristDateToIso(gristDate) {
  if (
    typeof gristDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(gristDate)
  ) {
    return gristDate;
  }

  const ms = normalizeDateMs(gristDate);

  if (ms === null || typeof ms === 'string') {
    return ms;
  }

  return formatCivilDate(ms);
}

/**
 * Normalise un timestamp Grist (secondes) ou JavaScript (millisecondes) vers millisecondes
 * @param {*} value - Valeur à normaliser
 * @returns {number|null} Timestamp en millisecondes ou null
 */
function normalizeDateMs(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }

    return Math.abs(value) < 100000000000
      ? value * 1000
      : value;
  }

  if (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return value;
  }

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Formate un timestamp en date civile ISO (YYYY-MM-DD) Europe/Paris
 * @param {number} ms - Timestamp en millisecondes
 * @returns {string|null} Date ISO ou null
 */
function formatCivilDate(ms) {
  if (ms === null || typeof ms === 'string') {
    return ms;
  }

  if (!Number.isFinite(ms)) {
    return null;
  }

  const parts = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  ).formatToParts(new Date(ms));

  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
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
  const { actorMemberId, actorIsAdmin = false, sheet, team, sheets, timeEntries } = context || {};

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
  if (!actorIsAdmin && actorId !== sheetMemberId) {
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
  const uniquenessCheck = findUniqueSheetForWeek(sheetMemberId, weekStartIso, sheets);

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
  const { actorMemberId, actorIsAdmin = false, sheet, sheets } = context || {};

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

  if (!actorIsAdmin && normalizeMemberId(sheet.membre) !== actorId) {
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
  const { actorMemberId, actorIsAdmin = false, sheet, sheets, validationResult } = context || {};

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
  if (!actorIsAdmin && normalizeMemberId(sheet.membre) === actorId) {
    return {
      can: false,
      reason: 'Auto-validation interdite',
      code: 'SELF_VALIDATION_FORBIDDEN'
    };
  }

  // 5. responsableValidation présent (photographie)
  const expectedManager = getExpectedValidationManagerId(sheet);
  if (!actorIsAdmin && expectedManager === null) {
    return {
      can: false,
      reason: 'responsableValidation absent (photographie manquante)',
      code: 'VALIDATION_MANAGER_SNAPSHOT_MISSING'
    };
  }

  // 6. Acteur = responsableValidation
  if (!actorIsAdmin && !isExpectedValidationManager(actorMemberId, sheet)) {
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
  const { actorMemberId, actorIsAdmin = false, sheet, sheets, rejectReason } = context || {};

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
  if (!actorIsAdmin && normalizeMemberId(sheet.membre) === actorId) {
    return {
      can: false,
      reason: 'Auto-rejet interdit',
      code: 'SELF_REJECTION_FORBIDDEN'
    };
  }

  // 5. responsableValidation présent (photographie)
  const expectedManager = getExpectedValidationManagerId(sheet);
  if (!actorIsAdmin && expectedManager === null) {
    return {
      can: false,
      reason: 'responsableValidation absent (photographie manquante)',
      code: 'VALIDATION_MANAGER_SNAPSHOT_MISSING'
    };
  }

  // 6. Acteur = responsableValidation
  if (!actorIsAdmin && !isExpectedValidationManager(actorMemberId, sheet)) {
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
  const { actorMemberId, actorIsAdmin = false, sheet, sheets, correctionReason } = context || {};

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
  if (!actorIsAdmin && normalizeMemberId(sheet.membre) === actorId) {
    return {
      can: false,
      reason: 'Auto-correction interdite',
      code: 'SELF_CORRECTION_FORBIDDEN'
    };
  }

  // 5. responsableValidation présent (photographie)
  const expectedManager = getExpectedValidationManagerId(sheet);
  if (!actorIsAdmin && expectedManager === null) {
    return {
      can: false,
      reason: 'responsableValidation absent (photographie manquante)',
      code: 'VALIDATION_MANAGER_SNAPSHOT_MISSING'
    };
  }

  // 6. Acteur = responsableValidation
  if (!actorIsAdmin && !isExpectedValidationManager(actorMemberId, sheet)) {
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
  const { actorMemberId, actorIsAdmin = false, sheet, timeEntry } = context || {};

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
  if (!actorIsAdmin && normalizeMemberId(sheet.membre) === actorId) {
    return {
      can: false,
      reason: 'Le propriétaire ne peut pas éditer en mode correction manager',
      code: 'SELF_EDIT_FORBIDDEN'
    };
  }

  // 5. responsableValidation présent
  const expectedManager = getExpectedValidationManagerId(sheet);
  if (!actorIsAdmin && expectedManager === null) {
    return {
      can: false,
      reason: 'responsableValidation absent',
      code: 'VALIDATION_MANAGER_SNAPSHOT_MISSING'
    };
  }

  // 6. Acteur = responsableValidation
  if (!actorIsAdmin && !isExpectedValidationManager(actorMemberId, sheet)) {
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
  const { actorMemberId, actorIsAdmin = false, sheet, sheets, validationResult } = context || {};

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
  if (!actorIsAdmin && normalizeMemberId(sheet.membre) === actorId) {
    return {
      can: false,
      reason: 'Auto-validation interdite',
      code: 'SELF_VALIDATION_FORBIDDEN'
    };
  }

  // 5. responsableValidation présent
  const expectedManager = getExpectedValidationManagerId(sheet);
  if (!actorIsAdmin && expectedManager === null) {
    return {
      can: false,
      reason: 'responsableValidation absent',
      code: 'VALIDATION_MANAGER_SNAPSHOT_MISSING'
    };
  }

  // 6. Acteur = responsableValidation
  if (!actorIsAdmin && !isExpectedValidationManager(actorMemberId, sheet)) {
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
  const { actorMemberId, actorIsAdmin = false, sheet, team, sheets, timeEntries, nowUnixSeconds } = params || {};
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

  const authCheck = canSubmitSheet({ actorMemberId, actorIsAdmin, sheet, team, sheets, timeEntries });
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
  const { actorMemberId, actorIsAdmin = false, sheet, sheets } = params || {};
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

  const authCheck = canWithdrawSheet({ actorMemberId, actorIsAdmin, sheet, sheets });
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
  const { actorMemberId, actorIsAdmin = false, sheet, sheets, validationResult, nowUnixSeconds } = params || {};
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

  const authCheck = canValidateSheet({ actorMemberId, actorIsAdmin, sheet, sheets, validationResult });
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
  const { actorMemberId, actorIsAdmin = false, sheet, sheets, rejectReason } = params || {};
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

  const authCheck = canRejectSheet({ actorMemberId, actorIsAdmin, sheet, sheets, rejectReason });
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
  const { actorMemberId, actorIsAdmin = false, sheet, sheets, correctionReason } = params || {};
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

  const authCheck = canOpenManagerCorrection({ actorMemberId, actorIsAdmin, sheet, sheets, correctionReason });
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
  const { actorMemberId, actorIsAdmin = false, sheet, sheets, validationResult, nowUnixSeconds } = params || {};
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

  const authCheck = canRevalidateSheet({ actorMemberId, actorIsAdmin, sheet, sheets, validationResult });
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
// ACTIONS GRIST : MISE À JOUR DES HEURES PAR LE MANAGER
// ============================================================================

/**
 * Construit les actions Grist pour mettre à jour les heures réelles d'une TimeEntry en mode correction manager
 *
 * CONTRAT :
 * 1. Appelle canManagerEditActual() en premier
 * 2. Exige un ID de TimeEntry valide
 * 3. Accepte uniquement un nombre fini supérieur ou égal à zéro
 * 4. Préserve explicitement 0
 * 5. Refuse null, chaîne vide, négatif, NaN, Infinity
 * 6. Ne modifie que { heures: normalizedHours }
 * 7. Ne modifie ni membre, ni tâche, ni date, ni feuille, ni heures prévues, ni révision de validation
 * 8. Retourne le même contrat homogène que les autres builders
 * 9. N'incrémente PAS revisionValidation
 *
 * @param {Object} params - Paramètres
 * @param {number} params.actorMemberId - ID de l'acteur (manager)
 * @param {Object} params.sheet - Feuille en correction_manager
 * @param {Object} params.timeEntry - TimeEntry à modifier
 * @param {number} params.hours - Nouvelles heures réelles
 * @returns {{ allowed: boolean, can: boolean, code: string, reason: string, actions: Array, diagnostics: Array, summary: Object }}
 */
function buildManagerActualUpdateAction(params) {
  const { actorMemberId, actorIsAdmin = false, sheet, timeEntry, hours } = params || {};
  const actions = [];
  const diagnostics = [];
  const summary = {};

  if (!actorMemberId || !sheet || !timeEntry) {
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

  // Validation des heures
  if (hours === null || hours === undefined || hours === '') {
    return {
      allowed: false,
      can: false,
      code: 'ACTUAL_HOURS_INVALID',
      reason: 'Heures invalides : valeur requise',
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  const numericHours = Number(hours);
  if (!Number.isFinite(numericHours) || numericHours < 0) {
    return {
      allowed: false,
      can: false,
      code: 'ACTUAL_HOURS_INVALID',
      reason: 'Heures invalides : doit être un nombre fini >= 0',
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  // Vérification d'autorisation
  const authCheck = canManagerEditActual({ actorMemberId, actorIsAdmin, sheet, timeEntry });
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

  const timeEntryId = normalizeMemberId(timeEntry.id);
  if (timeEntryId === null) {
    return {
      allowed: false,
      can: false,
      code: 'TIME_ENTRY_ID_INVALID',
      reason: 'TimeEntry sans ID valide',
      actions: [],
      diagnostics: [],
      summary: {}
    };
  }

  // Construire l'action minimale : uniquement heures
  const entryUpdate = {
    heures: numericHours
  };

  actions.push([
    'UpdateRecord',
    'TimeEntries',
    timeEntryId,
    entryUpdate
  ]);

  summary.sheetId = normalizeMemberId(sheet.id);
  summary.timeEntryId = timeEntryId;
  summary.newHours = numericHours;

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

return {
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
  buildManagerActualUpdateAction,

  // Helpers
  getWeekStartIso,

  // Helpers dates
  isoToGristDate,
  gristDateToIso,
  parseDateUTC,
  formatDateUTC
};

  }));

  // Module: cra/workflow/cra-weekly-sheet
  moduleFactories.set('cra/workflow/cra-weekly-sheet', (function() {
    var exports = {};
    var __require = function(id) {
      if (!moduleCache.has(id)) {
        if (!moduleFactories.has(id)) {
          throw new Error('Module non résolu: ' + id);
        }
        moduleCache.set(id, moduleFactories.get(id)());
      }
      return moduleCache.get(id);
    };
    
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

return {
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

  }));

  // Module: timesheets/timesheet-validator
  moduleFactories.set('timesheets/timesheet-validator', (function() {
    var exports = {};
    var __require = function(id) {
      if (!moduleCache.has(id)) {
        if (!moduleFactories.has(id)) {
          throw new Error('Module non résolu: ' + id);
        }
        moduleCache.set(id, moduleFactories.get(id)());
      }
      return moduleCache.get(id);
    };
    
    /**
 * Timesheet Validator - Validation de feuilles de temps
 * 
 * Valide les soumissions de feuilles de temps en vérifiant
 * les contraintes de capacité et la cohérence des données.
 */
const { toCentiHours, toHours, parseDateUTC, formatDateUTC, validateNumber } = __require('planning/planning-engine');

const PRECISION_CENTIHOURS = 1;

/**
 * Codes d'erreur stables pour la validation
 */
const ERROR_CODES = {
  NEGATIVE_ACTUAL_HOURS: "NEGATIVE_ACTUAL_HOURS",
  DAILY_CAPACITY_EXCEEDED: "DAILY_CAPACITY_EXCEEDED",
  MISSING_CAPACITY: "MISSING_CAPACITY",
  INVALID_DATE: "INVALID_DATE",
  DUPLICATE_DAILY_ENTRY: "DUPLICATE_DAILY_ENTRY",
  INVALID_ACTUAL_HOURS: "INVALID_ACTUAL_HOURS",
  INVALID_CAPACITY: "INVALID_CAPACITY",
  DATE_OUTSIDE_TIMESHEET_WEEK: "DATE_OUTSIDE_TIMESHEET_WEEK"
};

/**
 * Vérifie si une date est dans la période de la feuille
 * @param {string} dateStr - Date à vérifier
 * @param {string} weekStart - Date de début de semaine (lundi)
 * @param {Object} options - Options
 * @param {boolean} [options.allowWeekend=false] - Autoriser les week-ends (lundi-dimanche)
 * @returns {{ valid: boolean, error: string|null }}
 */
function isDateInTimesheetWeek(dateStr, weekStart, options = {}) {
  const { allowWeekend = false } = options;
  
  const date = parseDateUTC(dateStr);
  if (!date) {
    return { valid: false, error: ERROR_CODES.INVALID_DATE };
  }
  
  const start = parseDateUTC(weekStart);
  if (!start) {
    return { valid: false, error: ERROR_CODES.INVALID_DATE };
  }
  
  const dayOfWeek = date.getUTCDay();
  
  if (!allowWeekend && (dayOfWeek === 0 || dayOfWeek === 6)) {
    return { 
      valid: false, 
      error: ERROR_CODES.DATE_OUTSIDE_TIMESHEET_WEEK,
      date: dateStr,
      dayOfWeek
    };
  }
  
  const endOfWeek = addDaysUTC(start, allowWeekend ? 6 : 4);
  const endDateStr = formatDateUTC(endOfWeek);
  
  if (dateStr < weekStart || dateStr > endDateStr) {
    return { 
      valid: false, 
      error: ERROR_CODES.DATE_OUTSIDE_TIMESHEET_WEEK,
      date: dateStr,
      weekStart,
      weekEnd: endDateStr
    };
  }
  
  return { valid: true, error: null };
}

/**
 * Ajoute un jour à une date UTC
 * @param {Date} date - Date de départ
 * @param {number} days - Nombre de jours à ajouter
 * @returns {Date} Nouvelle date
 */
function addDaysUTC(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Valide une feuille de temps.
 * 
 * @param {Object} input - Paramètres d'entrée
 * @param {string|number} input.memberId - ID du membre
 * @param {string} input.weekStart - Date de début de semaine (YYYY-MM-DD)
 * @param {Array} input.entries - Entrées avec taskId, date, actualHours
 * @param {Array} input.capacities - Capacités avec date, availableCapacityHours
 * @param {number} [input.precisionHours=0.01] - Précision en heures
 * @param {Object} [input.options] - Options de validation
 * @param {boolean} [input.options.allowWeekend=false] - Autoriser les week-ends
 * @returns {Object} Résultat avec valid, dailyTotals, errors
 */
function validateTimesheet(input) {
  const errors = [];
  const dailyTotals = [];
  
  const {
    memberId,
    weekStart,
    entries,
    capacities,
    precisionHours = 0.01,
    options = {}
  } = input;
  
  const { allowWeekend = false } = options;
  
  if (!entries || entries.length === 0) {
    return {
      valid: true,
      dailyTotals: [],
      errors: []
    };
  }
  
  const capacityMap = new Map();
  const invalidCapacityDates = new Set();
  
  for (const cap of capacities || []) {
    const availCapValidation = validateNumber(cap.availableCapacityHours, 'availableCapacityHours');
    if (!availCapValidation.valid) {
      errors.push({
        code: ERROR_CODES.INVALID_CAPACITY,
        date: cap.date,
        message: `Capacité invalide : ${availCapValidation.error}`
      });
      invalidCapacityDates.add(cap.date);
      continue;
    }
    capacityMap.set(cap.date, toCentiHours(cap.availableCapacityHours));
  }
  
  const entriesByDate = new Map();
  
  for (const entry of entries) {
    const dateValidation = isDateInTimesheetWeek(entry.date, weekStart, { allowWeekend });
    if (!dateValidation.valid) {
      errors.push({
        code: dateValidation.error,
        date: entry.date,
        taskId: entry.taskId,
        message: `Date hors période : ${entry.date}`
      });
      continue;
    }
    
    if (!parseDateUTC(entry.date)) {
      errors.push({
        code: ERROR_CODES.INVALID_DATE,
        date: entry.date,
        taskId: entry.taskId,
        message: `Date invalide : ${entry.date}`
      });
      continue;
    }
    
    if (entry.actualHours !== null && entry.actualHours !== undefined && entry.actualHours !== '') {
      if (typeof entry.actualHours !== 'number' || !Number.isFinite(entry.actualHours) || Number.isNaN(entry.actualHours)) {
        errors.push({
          code: ERROR_CODES.INVALID_ACTUAL_HOURS,
          date: entry.date,
          taskId: entry.taskId,
          actualHours: entry.actualHours,
          message: `Heures invalides : doit être un nombre fini`
        });
        continue;
      }
      
      if (entry.actualHours < 0) {
        errors.push({
          code: ERROR_CODES.NEGATIVE_ACTUAL_HOURS,
          date: entry.date,
          taskId: entry.taskId,
          actualHours: entry.actualHours,
          message: `Heures négatives : ${entry.actualHours}h le ${entry.date}`
        });
        continue;
      }
    }
    
    if (entriesByDate.has(entry.date)) {
      const existing = entriesByDate.get(entry.date);
      if (!existing.some(e => e.taskId === entry.taskId)) {
        entriesByDate.get(entry.date).push(entry);
      } else {
        errors.push({
          code: ERROR_CODES.DUPLICATE_DAILY_ENTRY,
          date: entry.date,
          taskId: entry.taskId,
          message: `Doublon : tâche ${entry.taskId} déjà présente le ${entry.date}`
        });
      }
    } else {
      entriesByDate.set(entry.date, [entry]);
    }
  }
  
  const sortedDates = Array.from(entriesByDate.keys()).sort();
  
  for (const date of sortedDates) {
    const dateEntries = entriesByDate.get(date);
    
    const totalCentiHours = dateEntries.reduce((sum, entry) => {
      return sum + (entry.actualHours === null || entry.actualHours === undefined || entry.actualHours === '' ? 0 : toCentiHours(entry.actualHours));
    }, 0);
    
    const totalHours = toHours(totalCentiHours);
    
    const availableCapacityCentiHours = capacityMap.get(date);
    
    if (availableCapacityCentiHours === undefined) {
      if (!invalidCapacityDates.has(date)) {
        errors.push({
          code: ERROR_CODES.MISSING_CAPACITY,
          date,
          message: `Capacité non définie pour le ${date}`
        });
      }
      
      dailyTotals.push({
        date,
        totalHours,
        availableCapacityHours: null,
        entries: dateEntries.length
      });
      continue;
    }
    
    const availableCapacityHours = toHours(availableCapacityCentiHours);
    
    dailyTotals.push({
      date,
      totalHours,
      availableCapacityHours,
      entries: dateEntries.length
    });
    
    if (totalCentiHours > availableCapacityCentiHours) {
      const diffCentiHours = totalCentiHours - availableCapacityCentiHours;
      errors.push({
        code: ERROR_CODES.DAILY_CAPACITY_EXCEEDED,
        date,
        totalHours,
        availableCapacityHours,
        exceededBy: toHours(diffCentiHours),
        message: `Capacité dépassée le ${date} : ${totalHours}h > ${availableCapacityHours}h (+${toHours(diffCentiHours)}h)`
      });
    }
  }
  
  const valid = errors.length === 0;
  
  return {
    valid,
    dailyTotals,
    errors
  };
}

return {
  validateTimesheet,
  isDateInTimesheetWeek,
  ERROR_CODES,
  addDaysUTC
};

  }));

  // Module: cra/workflow/cra-sheet-validation-service
  moduleFactories.set('cra/workflow/cra-sheet-validation-service', (function() {
    var exports = {};
    var __require = function(id) {
      if (!moduleCache.has(id)) {
        if (!moduleFactories.has(id)) {
          throw new Error('Module non résolu: ' + id);
        }
        moduleCache.set(id, moduleFactories.get(id)());
      }
      return moduleCache.get(id);
    };
    
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
const workflow = __require('cra/workflow/cra-sheet-workflow');
const timesheetValidator = __require('timesheets/timesheet-validator');
const weeklySheet = __require('cra/workflow/cra-weekly-sheet');

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

return {
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

  }));

  // Module: cra/ui/cra-sheet-ui-adapter
  moduleFactories.set('cra/ui/cra-sheet-ui-adapter', (function() {
    var exports = {};
    var __require = function(id) {
      if (!moduleCache.has(id)) {
        if (!moduleFactories.has(id)) {
          throw new Error('Module non résolu: ' + id);
        }
        moduleCache.set(id, moduleFactories.get(id)());
      }
      return moduleCache.get(id);
    };
    
    /**
 * CRA Sheet UI Adapter - Adaptateur entre l'UI et le service de validation
 * 
 * Ce module est pur vis-à-vis du DOM. Il fait le lien entre :
 * - les actions utilisateur (clics, saisies)
 * - le service transactionnel (cra-sheet-validation-service)
 * 
 * RESPONSABILITÉS :
 * 1. Obtenir l'acteur via getActorMemberId()
 * 2. Refuser un acteur absent
 * 3. Empêcher le double-clic sur la même feuille
 * 4. Appeler la bonne commande du service
 * 5. Fournir le timestamp uniquement aux commandes qui l'exigent
 * 6. Ne jamais modifier S directement
 * 7. Attendre le résultat
 * 8. Afficher un message adapté
 * 9. Recharger les données après un succès
 * 10. Recharger également après WORKFLOW_STATE_CHANGED, WORKFLOW_POSTCONDITION_FAILED, WORKFLOW_APPLY_FAILED
 * 11. Libérer l'état busy dans un finally
 * 
 * @module core/cra/cra-sheet-ui-adapter
 */
/**
 * Codes d'erreur stables → messages utilisateur
 */
const USER_MESSAGES = {
  ACTOR_NOT_IDENTIFIED: 'Votre compte Grist n\'est pas associé à un membre de l\'équipe.',
  NOT_SHEET_OWNER: 'Seul le propriétaire de cette feuille peut la soumettre.',
  NO_VALIDATION_MANAGER: 'Aucun responsable direct n\'est défini pour cette personne.',
  DUPLICATE_WEEKLY_SHEET: 'Plusieurs feuilles existent pour cette semaine. Corrigez les données avant de continuer.',
  TIME_ENTRY_SCOPE_INCOMPLETE: 'Certaines lignes de cette semaine ne sont pas rattachées à la bonne feuille.',
  TIMESHEET_VALIDATION_FAILED: 'La feuille contient des erreurs. Vérifiez les heures et les capacités quotidiennes.',
  NOT_EXPECTED_VALIDATION_MANAGER: 'Cette feuille a été soumise à un autre responsable.',
  WORKFLOW_STATE_CHANGED: 'La feuille a changé pendant l\'opération. Les données ont été rechargées.',
  WORKFLOW_APPLY_FAILED: 'L\'enregistrement dans Grist a échoué.',
  WORKFLOW_POSTCONDITION_FAILED: 'L\'opération a été enregistrée, mais son résultat doit être vérifié. Les données ont été rechargées.',
  SHEET_NOT_SUBMITTED: 'La feuille n\'est pas soumise.',
  SHEET_ALREADY_VALIDATED: 'La feuille a déjà été validée.',
  MISSING_REJECT_REASON: 'Un motif de rejet est requis.',
  MISSING_CORRECTION_REASON: 'Un motif de correction est requis.',
  SHEET_NOT_VALIDATED: 'La feuille n\'est pas validée.',
  SHEET_NOT_IN_MANAGER_CORRECTION: 'La feuille n\'est pas en correction manager.',
  SELF_VALIDATION_FORBIDDEN: 'Auto-validation interdite.',
  SELF_REJECTION_FORBIDDEN: 'Auto-rejet interdit.',
  SELF_CORRECTION_FORBIDDEN: 'Auto-correction interdite.',
  OK: 'Opération réussie.'
};

/**
 * Helper : obtenir un message utilisateur depuis un code
 */
function getUserMessage(code, details) {
  const baseMessage = USER_MESSAGES[code] || 'Une erreur est survenue.';
  
  if (details && details.validation && details.validation.errors && details.validation.errors.length > 0) {
    const firstError = details.validation.errors[0];
    return baseMessage + ' (' + (firstError.message || firstError.code) + ')';
  }
  
  return baseMessage;
}

/**
 * Crée un adaptateur UI pour le workflow CRA
 * 
 * @param {Object} options - Options de configuration
 * @param {Object} options.service - Service de validation (cra-sheet-validation-service)
 * @param {Object} options.grist - API Grist
 * @param {Function} options.getActorMemberId - Fonction retournant l'ID de l'acteur
 * @param {Function} options.reload - Fonction de rechargement des données
 * @param {Function} options.notify - Fonction d'affichage de notification
 * @param {Function} options.setBusy - Fonction pour définir l'état busy
 * @param {Function} [options.nowUnixSeconds] - Fonction retournant le timestamp actuel (défaut: Date.now()/1000)
 * @returns {Object} Adaptateur UI
 */
function createUiAdapter(options) {
  if (!options || !options.service || !options.grist || !options.getActorMemberId) {
    throw new Error('CraUiAdapter: options requises (service, grist, getActorMemberId)');
  }
  
  const {
    service,
    grist,
    getActorMemberId,
    getActor,
    reload,
    notify,
    setBusy,
    nowUnixSeconds = () => Math.floor(Date.now() / 1000)
  } = options;
  
  // État interne pour empêcher le double-clic
  // Verrouillage par sheetId uniquement (pas par opération)
  const pendingOperations = new Set();

  function resolveActor() {
    const actor = typeof getActor === 'function' ? getActor() : null;
    return {
      actorMemberId: actor && actor.memberId ? actor.memberId : getActorMemberId(),
      actorIsAdmin: !!(actor && actor.isAdmin)
    };
  }
  
  /**
   * Vérifie si une opération est déjà en cours pour cette feuille
   */
  function isOperationPending(sheetId) {
    return pendingOperations.has(sheetId);
  }
  
  /**
   * Marque une opération comme en cours
   */
  function markOperationPending(sheetId) {
    pendingOperations.add(sheetId);
  }
  
  /**
   * Marque une opération comme terminée
   */
  function markOperationDone(sheetId) {
    pendingOperations.delete(sheetId);
  }
  
  /**
   * Recharge les données après une transition
   */
  async function reloadAfterTransition(reason) {
    if (typeof reload === 'function') {
      await reload({
        reason: reason || 'sheet-workflow-transition',
        immediate: true,
        allowSchemaRecovery: false
      });
    }
  }
  
  /**
   * Affiche une notification
   */
  function showNotification(message, type) {
    if (typeof notify === 'function') {
      notify(message, type);
    } else {
      console.log('[CRA UI]', message);
    }
  }
  
  /**
   * Gère le résultat d'une opération
   * CONTRAT: busy reste actif jusqu'à la fin du reload
   */
  async function handleOperationResult(result, sheetId, operationType, successMessage) {
    try {
      if (result.success) {
        showNotification(successMessage || USER_MESSAGES.OK, 'success');
        await reloadAfterTransition('workflow-success');
        return result;
      }
      
      // Échec
      const code = result.code || 'UNKNOWN_ERROR';
      const message = getUserMessage(code, result);
      
      // Logger les détails techniques dans la console
      console.error('[CRA UI] Échec opération', {
        code,
        reason: result.reason,
        transition: result.transition,
        diagnostics: result.diagnostics,
        before: result.before,
        after: result.after
      });
      
      // Afficher le message utilisateur (sans stack technique)
      showNotification(message, 'error');
      
      // Recharger si l'état a pu changer
      if (
        code === 'WORKFLOW_STATE_CHANGED' ||
        code === 'WORKFLOW_POSTCONDITION_FAILED' ||
        code === 'WORKFLOW_APPLY_FAILED'
      ) {
        await reloadAfterTransition('workflow-error');
      }
      
      return result;
    } finally {
      // Libérer le verrou et busy APRÈS le reload
      markOperationDone(sheetId);
      if (typeof setBusy === 'function') {
        setBusy(false);
      }
    }
  }

  async function callWorkflowService(operation, sheetId) {
    try {
      return await operation();
    } catch (error) {
      markOperationDone(sheetId);
      if (typeof setBusy === 'function') setBusy(false);
      throw error;
    }
  }
  
  /**
   * Soumet une feuille
   */
  async function submit(sheetId) {
    if (!sheetId) {
      throw new Error('submit: sheetId requis');
    }
    
    if (isOperationPending(sheetId)) {
      console.warn('[CRA UI] Double-clic soumis ignoré');
      return { success: false, code: 'OPERATION_PENDING' };
    }
    
    const { actorMemberId, actorIsAdmin } = resolveActor();
    if (!actorMemberId) {
      showNotification(USER_MESSAGES.ACTOR_NOT_IDENTIFIED, 'error');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    markOperationPending(sheetId);
    if (typeof setBusy === 'function') {
      setBusy(true);
    }
    
    const result = await callWorkflowService(() => service.submitSheet({
      grist,
      actorMemberId,
      actorIsAdmin,
      sheetId,
      nowUnixSeconds: nowUnixSeconds()
    }), sheetId);
    
    return await handleOperationResult(
      result,
      sheetId,
      'submit',
      'Semaine soumise à votre responsable'
    );
  }
  
  /**
   * Retire une soumission
   */
  async function withdraw(sheetId) {
    if (!sheetId) {
      throw new Error('withdraw: sheetId requis');
    }
    
    if (isOperationPending(sheetId)) {
      console.warn('[CRA UI] Double-clic retrait ignoré');
      return { success: false, code: 'OPERATION_PENDING' };
    }
    
    const { actorMemberId, actorIsAdmin } = resolveActor();
    if (!actorMemberId) {
      showNotification(USER_MESSAGES.ACTOR_NOT_IDENTIFIED, 'error');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    markOperationPending(sheetId);
    if (typeof setBusy === 'function') {
      setBusy(true);
    }
    
    const result = await callWorkflowService(() => service.withdrawSheet({
      grist,
      actorMemberId,
      actorIsAdmin,
      sheetId
    }), sheetId);
    
    return await handleOperationResult(
      result,
      sheetId,
      'withdraw',
      'Soumission retirée'
    );
  }
  
  /**
   * Valide une feuille
   */
  async function validate(sheetId) {
    if (!sheetId) {
      throw new Error('validate: sheetId requis');
    }
    
    if (isOperationPending(sheetId)) {
      console.warn('[CRA UI] Double-clic validation ignoré');
      return { success: false, code: 'OPERATION_PENDING' };
    }
    
    const { actorMemberId, actorIsAdmin } = resolveActor();
    if (!actorMemberId) {
      showNotification(USER_MESSAGES.ACTOR_NOT_IDENTIFIED, 'error');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    markOperationPending(sheetId);
    if (typeof setBusy === 'function') {
      setBusy(true);
    }
    
    const result = await callWorkflowService(() => service.validateSheet({
      grist,
      actorMemberId,
      actorIsAdmin,
      sheetId,
      nowUnixSeconds: nowUnixSeconds()
    }), sheetId);
    
    return await handleOperationResult(
      result,
      sheetId,
      'validate',
      'Feuille validée'
    );
  }
  
  /**
   * Rejette une feuille avec motif
   */
  async function reject(sheetId, reason) {
    if (!sheetId) {
      throw new Error('reject: sheetId requis');
    }
    
    if (!reason || String(reason).trim() === '') {
      showNotification(USER_MESSAGES.MISSING_REJECT_REASON, 'error');
      return { success: false, code: 'MISSING_REJECT_REASON' };
    }
    
    if (isOperationPending(sheetId)) {
      console.warn('[CRA UI] Double-clic rejet ignoré');
      return { success: false, code: 'OPERATION_PENDING' };
    }
    
    const { actorMemberId, actorIsAdmin } = resolveActor();
    if (!actorMemberId) {
      showNotification(USER_MESSAGES.ACTOR_NOT_IDENTIFIED, 'error');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    markOperationPending(sheetId);
    if (typeof setBusy === 'function') {
      setBusy(true);
    }
    
    const result = await callWorkflowService(() => service.rejectSheet({
      grist,
      actorMemberId,
      actorIsAdmin,
      sheetId,
      rejectReason: String(reason).trim()
    }), sheetId);
    
    return await handleOperationResult(
      result,
      sheetId,
      'reject',
      'Feuille rejetée'
    );
  }
  
  /**
   * Ouvre une correction manager avec motif
   */
  async function openCorrection(sheetId, reason) {
    if (!sheetId) {
      throw new Error('openCorrection: sheetId requis');
    }
    
    if (!reason || String(reason).trim() === '') {
      showNotification(USER_MESSAGES.MISSING_CORRECTION_REASON, 'error');
      return { success: false, code: 'MISSING_CORRECTION_REASON' };
    }
    
    if (isOperationPending(sheetId)) {
      console.warn('[CRA UI] Double-clic ouverture correction ignoré');
      return { success: false, code: 'OPERATION_PENDING' };
    }
    
    const { actorMemberId, actorIsAdmin } = resolveActor();
    if (!actorMemberId) {
      showNotification(USER_MESSAGES.ACTOR_NOT_IDENTIFIED, 'error');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    markOperationPending(sheetId);
    if (typeof setBusy === 'function') {
      setBusy(true);
    }
    
    const result = await callWorkflowService(() => service.openManagerCorrection({
      grist,
      actorMemberId,
      actorIsAdmin,
      sheetId,
      correctionReason: String(reason).trim()
    }), sheetId);
    
    return await handleOperationResult(
      result,
      sheetId,
      'open_correction',
      'Correction manager ouverte'
    );
  }
  
  /**
   * Met à jour les heures réelles d'une TimeEntry en mode correction manager
   */
  async function updateManagerActual(sheetId, timeEntryId, hours) {
    if (!sheetId) {
      throw new Error('updateManagerActual: sheetId requis');
    }
    
    if (!timeEntryId) {
      throw new Error('updateManagerActual: timeEntryId requis');
    }
    
    if (hours === null || hours === undefined || hours === '') {
      throw new Error('updateManagerActual: hours requis');
    }
    
    const numericHours = Number(hours);
    if (!Number.isFinite(numericHours) || numericHours < 0) {
      throw new Error('updateManagerActual: heures invalides (doit être >= 0)');
    }
    
    if (isOperationPending(sheetId)) {
      console.warn('[CRA UI] Double-clic update actual ignoré');
      return { success: false, code: 'OPERATION_PENDING' };
    }
    
    const { actorMemberId, actorIsAdmin } = resolveActor();
    if (!actorMemberId) {
      showNotification(USER_MESSAGES.ACTOR_NOT_IDENTIFIED, 'error');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    markOperationPending(sheetId);
    if (typeof setBusy === 'function') {
      setBusy(true);
    }
    
    const result = await callWorkflowService(() => service.updateManagerActual({
      grist,
      actorMemberId,
      actorIsAdmin,
      sheetId,
      timeEntryId,
      hours: numericHours
    }), sheetId);
    
    return await handleOperationResult(
      result,
      sheetId,
      'update_actual',
      'Heures mises à jour'
    );
  }
  
  /**
   * Revalide une feuille après correction manager
   */
  async function revalidate(sheetId) {
    if (!sheetId) {
      throw new Error('revalidate: sheetId requis');
    }
    
    if (isOperationPending(sheetId)) {
      console.warn('[CRA UI] Double-clic revalidation ignoré');
      return { success: false, code: 'OPERATION_PENDING' };
    }
    
    const { actorMemberId, actorIsAdmin } = resolveActor();
    if (!actorMemberId) {
      showNotification(USER_MESSAGES.ACTOR_NOT_IDENTIFIED, 'error');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    markOperationPending(sheetId);
    if (typeof setBusy === 'function') {
      setBusy(true);
    }
    
    const result = await callWorkflowService(() => service.revalidateSheet({
      grist,
      actorMemberId,
      actorIsAdmin,
      sheetId,
      nowUnixSeconds: nowUnixSeconds()
    }), sheetId);
    
    return await handleOperationResult(
      result,
      sheetId,
      'revalidate',
      'Feuille corrigée et revalidée'
    );
  }
  
  return {
    submit,
    withdraw,
    validate,
    reject,
    openCorrection,
    updateManagerActual,
    revalidate
  };
}

return {
  createUiAdapter,
  USER_MESSAGES
};

  }));

  // Module: cra/manager/cra-manager-workspace
  moduleFactories.set('cra/manager/cra-manager-workspace', (function() {
    var exports = {};
    var __require = function(id) {
      if (!moduleCache.has(id)) {
        if (!moduleFactories.has(id)) {
          throw new Error('Module non résolu: ' + id);
        }
        moduleCache.set(id, moduleFactories.get(id)());
      }
      return moduleCache.get(id);
    };
    
    /**
 * CRA Manager Workspace - État de l'espace manager "À valider"
 * 
 * Ce module calcule la visibilité et l'état de l'onglet "À valider"
 * en fonction :
 * - des subordonnés directs dans Team
 * - des feuilles accessibles via responsableValidation
 * 
 * PURTÉ : Aucune dépendance à Grist, au DOM, ou aux effets de bord.
 * 
 * @module core/cra/cra-manager-workspace
 */
// ============================================================================
// CONSTANTES
// ============================================================================

const ACCESSIBLE_MANAGER_STATUSES = [
  'soumis',
  'submitted',
  'valide',
  'validated',
  'correction_manager'
];

const PENDING_STATUSES = ['soumis', 'submitted'];

// ============================================================================
// HELPERS DE NORMALISATION
// ============================================================================

/**
 * Normalise un ID pour comparaison
 * @param {*} value - ID à normaliser
 * @returns {number|null} - ID normalisé ou null
 */
function normalizeId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

/**
 * Normalise un statut de feuille
 * @param {string} status - Statut brut
 * @returns {string} - Statut normalisé
 */
function normalizeStatus(status) {
  return String(status || '').toLowerCase();
}

// ============================================================================
// FONCTION PRINCIPALE
// ============================================================================

/**
 * Résout l'état de l'espace manager
 * 
 * @param {Object} options - Options
 * @param {Array} options.team - Liste des membres Team
 * @param {Array} options.sheets - Liste des feuilles Feuilles
 * @param {number} options.currentUserMemberId - ID de l'utilisateur connecté
 * @param {boolean} options.isAdmin - Passe-droit fonctionnel complet
 * @returns {Object} - État de l'espace manager
 */
function resolveManagerWorkspaceState({ team, sheets, currentUserMemberId, isAdmin = false }) {
  const result = {
    isIdentified: false,
    managesSomeone: false,
    directReportIds: [],
    directReportCount: 0,
    hasAccessibleSheets: false,
    accessibleSheets: [],
    pendingSheets: [],
    pendingCount: 0,
    validatedCount: 0,
    correctionCount: 0,
    shouldShowManagerTab: false
  };
  
  // 1. Vérifier que l'utilisateur est identifié
  const managerId = normalizeId(currentUserMemberId);
  if (!managerId) {
    return result;
  }
  
  result.isIdentified = true;
  
  // 2. Calculer les subordonnés directs
  const directReports = team.filter(member => {
    // Membre doit être actif
    if (member.actif === false) {
      return false;
    }
    
    if (isAdmin) return normalizeId(member.id) !== managerId;

    // Responsable direct doit correspondre
    const memberRespId = normalizeId(member.responsable);
    return memberRespId === managerId;
  });
  
  result.directReportIds = directReports.map(m => normalizeId(m.id));
  result.directReportCount = directReports.length;
  result.managesSomeone = directReports.length > 0;
  
  // 3. Calculer les feuilles accessibles via responsableValidation
  const accessibleSheets = sheets.filter(sheet => {
    const sheetRespId = normalizeId(sheet.responsableValidation);
    if (!isAdmin && sheetRespId !== managerId) {
      return false;
    }
    
    const status = normalizeStatus(sheet.statut);
    return ACCESSIBLE_MANAGER_STATUSES.includes(status);
  });
  
  result.accessibleSheets = accessibleSheets;
  result.hasAccessibleSheets = accessibleSheets.length > 0;
  
  // 4. Compter par statut
  result.pendingSheets = accessibleSheets.filter(sheet => {
    const status = normalizeStatus(sheet.statut);
    return PENDING_STATUSES.includes(status);
  });
  
  result.pendingCount = result.pendingSheets.length;
  result.validatedCount = accessibleSheets.filter(sheet => {
    const status = normalizeStatus(sheet.statut);
    return status === 'valide' || status === 'validated';
  }).length;
  
  result.correctionCount = accessibleSheets.filter(sheet => {
    const status = normalizeStatus(sheet.statut);
    return status === 'correction_manager';
  }).length;
  
  // 5. Visibilité finale
  // Afficher si : manager de quelqu'un OU a des feuilles accessibles
  result.shouldShowManagerTab = isAdmin || result.managesSomeone || result.hasAccessibleSheets;
  result.isAdmin = isAdmin;
  
  return result;
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

return {
  resolveManagerWorkspaceState,
  normalizeId,
  normalizeStatus,
  ACCESSIBLE_MANAGER_STATUSES,
  PENDING_STATUSES
};

  }));

  
  // Exposer l'API publique
  var workflow = __require('cra/workflow/cra-sheet-workflow');
  var weeklySheet = __require('cra/workflow/cra-weekly-sheet');
  var validator = __require('timesheets/timesheet-validator');
  var service = __require('cra/workflow/cra-sheet-validation-service');
  var adapterModule = __require('cra/ui/cra-sheet-ui-adapter');
  var managerModule = __require('cra/manager/cra-manager-workspace');
  
  global.TaskFlowCra = {
    service: {
      submitSheet: service.submitSheet,
      withdrawSheet: service.withdrawSheet,
      validateSheet: service.validateSheet,
      rejectSheet: service.rejectSheet,
      openManagerCorrection: service.openManagerCorrection,
      updateManagerActual: service.updateManagerActual,
      revalidateSheet: service.revalidateSheet,
      ensureWeeklySheet: service.ensureWeeklySheet
    },
    
    workflow: {
      SHEET_STATUS: workflow.SHEET_STATUS,
      normalizeSheetStatus: workflow.normalizeSheetStatus,
      normalizeMemberId: workflow.normalizeMemberId,
      normalizeRevision: workflow.normalizeRevision,
      findUniqueSheetForWeek: workflow.findUniqueSheetForWeek,
      getWeekStartIso: workflow.getWeekStartIso,
      isSheetOwnerEditable: workflow.isSheetOwnerEditable,
      isSheetManagerCorrection: workflow.isSheetManagerCorrection,
      isExpectedValidationManager: workflow.isExpectedValidationManager,
      canManagerEditActual: workflow.canManagerEditActual,
      hasExplicitActual: workflow.hasExplicitActual,
      formatDateUTC: workflow.formatDateUTC,
      gristDateToIso: workflow.gristDateToIso
    },
    
    weeklySheet: {
      resolveWeeklySheetState: weeklySheet.resolveWeeklySheetState,
      buildWeeklySheetCreation: weeklySheet.buildWeeklySheetCreation,
      findEntriesForMemberWeek: weeklySheet.findEntriesForMemberWeek,
      buildOrphanEntryLinkPlan: weeklySheet.buildOrphanEntryLinkPlan,
      buildSheetCreationActions: weeklySheet.buildSheetCreationActions,
      buildEntryLinkActions: weeklySheet.buildEntryLinkActions,
      buildEnsureWeeklySheetActions: weeklySheet.buildEnsureWeeklySheetActions,
      normalizeMemberId: weeklySheet.normalizeMemberId,
      getWeekStartIso: weeklySheet.getWeekStartIso,
      gristDateToIso: weeklySheet.gristDateToIso
    },
    
    createUiAdapter: adapterModule.createUiAdapter,
    
    // Exposer aussi le validateur pour usage direct si nécessaire
    validator: {
      validateTimesheet: validator.validateTimesheet,
      ERROR_CODES: validator.ERROR_CODES
    },
    
    // Espace manager
    managerWorkspace: {
      resolveManagerWorkspaceState: managerModule.resolveManagerWorkspaceState,
      ACCESSIBLE_MANAGER_STATUSES: managerModule.ACCESSIBLE_MANAGER_STATUSES,
      PENDING_STATUSES: managerModule.PENDING_STATUSES
    }
  };
  
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

/* ============================================================================
 * Fin du bundle taskflow-cra-browser.js
 * ========================================================================== */
