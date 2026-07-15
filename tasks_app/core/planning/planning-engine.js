/**
 * Planning Engine - Moteur de planification pur (indépendant de Grist et du DOM)
 * 
 * Gère la répartition des heures allouées sur les dates disponibles,
 * en tenant compte des capacités et des entrées existantes.
 */

'use strict';

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
 * @param {string} startDate - Date de début
 * @param {string} endDate - Date de fin
 * @returns {string[]} Tableau de dates YYYY-MM-DD
 */
function generateDateRange(startDate, endDate) {
  const dates = [];
  const current = parseDateUTC(startDate);
  const end = parseDateUTC(endDate);
  
  if (!current || !end) return dates;
  
  while (compareDates(formatDateUTC(current), endDate) <= 0) {
    dates.push(formatDateUTC(current));
    current.setUTCDate(current.getUTCDate() + 1);
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
 * @param {string} [input.capacityPolicy="cap"] - Politique de capacité ("cap" pour ne pas dépasser)
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
      availableCapacityHours: cap.availableCapacityHours
    });
  }
  
  if (errors.length > 0) {
    diagnostics.push({
      code: "INVALID_CAPACITY",
      message: `Erreurs de capacité : ${errors.join(', ')}`
    });
  }
  
  const existingByDate = new Map();
  for (const entry of existingEntries || []) {
    if (entry.assignmentId !== assignmentId) continue;
    if (!isDateInRange(entry.date, startDate, endDate)) continue;
    
    const existing = existingByDate.get(entry.date);
    if (existing) {
      existing.push(entry);
    } else {
      existingByDate.set(entry.date, [entry]);
    }
  }
  
  const duplicateCheck = findDuplicates(existingEntries || []);
  if (duplicateCheck.hasDuplicates) {
    for (const dup of duplicateCheck.duplicates) {
      diagnostics.push({
        code: "DUPLICATE_EXISTING_ENTRY",
        key: dup.key,
        assignmentId: dup.entry.assignmentId,
        date: dup.entry.date,
        entryIds: [dup.firstEntry.id, dup.entry.id],
        message: `Doublon détecté : entrées ${dup.firstEntry.id} et ${dup.entry.id} pour ${dup.key}`
      });
    }
  }
  
  let validatedActualCentiHours = 0;
  let protectedPlannedCentiHours = 0;
  const entriesToRespect = new Map();
  const distributableEntries = new Map();
  
  for (const [date, entries] of existingByDate) {
    const isBeforeReplan = compareDates(date, effectiveReplanFromDate) < 0;
    
    let validatedEntry = null;
    let submittedEntry = null;
    let mutableEntries = [];
    
    for (const entry of entries) {
      if (entry.sheetStatus === 'validated') {
        validatedEntry = entry;
      } else if (entry.sheetStatus === 'submitted') {
        submittedEntry = entry;
      } else {
        mutableEntries.push(entry);
      }
    }
    
    if (validatedEntry) {
      entriesToRespect.set(date, validatedEntry);
      validatedActualCentiHours += toCentiHours(validatedEntry.actualHours || 0);
    } else if (submittedEntry) {
      entriesToRespect.set(date, submittedEntry);
      protectedPlannedCentiHours += toCentiHours(submittedEntry.plannedHours || 0);
    } else if (isBeforeReplan && mutableEntries.length > 0) {
      const entryToProtect = mutableEntries[0];
      entriesToRespect.set(date, entryToProtect);
      protectedPlannedCentiHours += toCentiHours(entryToProtect.plannedHours || 0);
    } else if (!isBeforeReplan && mutableEntries.length > 0) {
      distributableEntries.set(date, mutableEntries[0]);
    }
  }
  
  const validatedActualHours = toHours(validatedActualCentiHours);
  const overconsumedCentiHours = Math.max(0, validatedActualCentiHours - allocatedCentiHours);
  const overconsumedHours = toHours(overconsumedCentiHours);
  
  if (overconsumedCentiHours > 0) {
    diagnostics.push({
      code: "OVERCONSUMPTION",
      message: `Le réalisé validé (${validatedActualHours}h) dépasse l'allocation (${toHours(allocatedCentiHours)}h) de ${overconsumedHours}h`
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
        overconsumedHours,
        overprotectedHours: 0
      },
      diagnostics
    };
  }
  
  const remainingAfterValidated = allocatedCentiHours - validatedActualCentiHours;
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
      const availableCapacity = cap ? toCentiHours(cap.availableCapacityHours) : 0;
      capacityForDistribution.set(date, availableCapacity);
      continue;
    }
    
    if (existingEntry && (existingEntry.sheetStatus === 'validated' || existingEntry.sheetStatus === null || existingEntry.sheetStatus === 'draft')) {
      continue;
    }
    
    const cap = capacityMap.get(date);
    const availableCapacity = cap ? toCentiHours(cap.availableCapacityHours) : 0;
    
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
  
  const totalCapacityCentiHours = distributableDates.reduce((sum, date) => {
    return sum + capacityForDistribution.get(date);
  }, 0);
  
  const desiredPlan = [];
  let newlyPlannedCentiHours = 0;
  let remainingToDistribute = remainingCentiHours;
  
  if (totalCapacityCentiHours > 0) {
    const rawDistribution = distributableDates.map(date => {
      const cap = capacityForDistribution.get(date);
      const ratio = cap / totalCapacityCentiHours;
      const rawHours = ratio * remainingToDistribute;
      return { date, rawHours, capacity: cap };
    });
    
    let roundedSum = 0;
    const roundedValues = rawDistribution.map(item => {
      const rounded = Math.round(item.rawHours);
      roundedSum += rounded;
      return { ...item, rounded };
    });
    
    const adjustment = remainingToDistribute - roundedSum;
    if (adjustment !== 0) {
      roundedValues.sort((a, b) => (b.rawHours - b.rounded) - (a.rawHours - a.rounded));
      roundedValues[0].rounded += adjustment;
    }
    
    for (const item of roundedValues) {
      let plannedCentiHours = item.rounded;
      
      if (capacityPolicy === "cap") {
        const maxCapacity = Math.min(item.capacity, remainingToDistribute);
        if (plannedCentiHours > maxCapacity) {
          plannedCentiHours = maxCapacity;
        }
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

module.exports = {
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
  validateNumber
};
