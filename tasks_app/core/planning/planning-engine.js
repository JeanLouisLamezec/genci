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
  
  // Accepter objets Date ou timestamps
  let current = startDate instanceof Date ? startDate : new Date(startDate);
  const end = endDate instanceof Date ? endDate : new Date(endDate);
  
  if (!current.getTime() || !end.getTime()) return dates;
  
  while (compareDates(formatDateUTC(current), formatDateUTC(end)) <= 0) {
    dates.push(formatDateUTC(current));  // Retourner des strings
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
  
  // Séparer explicitement :
  // 1. entriesForAccounting : toutes les lignes de l'affectation (pour le calcul comptable)
  // 2. entriesInAssignmentRange : lignes entre startDate et endDate (pour la réconciliation)
  
  // Calcul comptable : toutes les entrées de l'affectation, peu importe la date
  let validatedActualCentiHours = 0;
  let validatedActualEntries = [];
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
    
    if (entry.sheetStatus === 'validated') {
      validatedActualCentiHours += entry.actualHours === null || entry.actualHours === undefined || entry.actualHours === '' ? 0 : toCentiHours(entry.actualHours);
      validatedActualEntries.push(entry);
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
  
  const validatedActualHours = toHours(validatedActualCentiHours);
  const overconsumedCentiHours = Math.max(0, validatedActualCentiHours - allocatedCentiHours);
  const overconsumedHours = toHours(overconsumedCentiHours);
  
  // Si surconsommation, retourner immédiatement sans plan
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
      // validatedActualCentiHours déjà calculé plus haut pour toutes les entrées
      // Ne pas re-compter ici pour éviter le double comptage
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
  
  // validatedActualHours et overconsumedCentiHours déjà calculés plus haut
  // À ce stade, overconsumedCentiHours === 0 (sinon retour immédiat)
  // Donc overconsumedHours === 0 également
  
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
  
  // Algorithme de distribution : plus forts restes sous contrainte de capacité
  // Travailler en centièmes d'heure entiers pour éviter la dérive flottante
  const totalCapacityCentiHours = distributableDates.reduce((sum, date) => {
    return sum + capacityForDistribution.get(date);
  }, 0);
  
  const desiredPlan = [];
  let newlyPlannedCentiHours = 0;
  let remainingToDistribute = remainingCentiHours;
  
  if (totalCapacityCentiHours > 0 && remainingToDistribute > 0) {
    // Limiter à la capacité totale disponible
    const toDistribute = Math.min(remainingToDistribute, totalCapacityCentiHours);
    
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
      
      // Plafonner à la capacité (policy "cap")
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
