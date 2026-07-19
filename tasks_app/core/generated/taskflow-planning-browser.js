/* ============================================================================
 * taskflow-planning-browser.js — Bundle navigateur pour le moteur de planification
 * ----------------------------------------------------------------------------
 * Fichier généré automatiquement par scripts/build-planning-browser.js
 * NE PAS EDITER MANUELLEMENT
 * 
 * Usage:
 *   <script src="core/generated/taskflow-planning-browser.js"></script>
 *   const service = window.TaskFlowPlanning.createWidgetPlanningService(grist);
 * ========================================================================== */

(function(global) {
  'use strict';
  
  // Registry des modules (remplie ci-dessous)
  var moduleRegistry = new Map();
  
  // Fonction require interne
  function __require(id) {
    if (!moduleRegistry.has(id)) {
      throw new Error('Module non résolu: ' + id);
    }
    return moduleRegistry.get(id)();
  }


  // Module: planning/planning-engine
  moduleRegistry.set('planning/planning-engine', (function() {
    var exports = {};
    var module = { exports: exports };
    var __require = function(id) {
      if (!moduleRegistry.has(id)) {
        throw new Error('Module non résolu: ' + id);
      }
      return moduleRegistry.get(id)();
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
      validatedActualCentiHours += toCentiHours(entry.actualHours || 0);
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
  validateNumber
};

  }));

  // Module: planning/reconciliation/planning-reconciliation
  moduleRegistry.set('planning/reconciliation/planning-reconciliation', (function() {
    var exports = {};
    var module = { exports: exports };
    var __require = function(id) {
      if (!moduleRegistry.has(id)) {
        throw new Error('Module non résolu: ' + id);
      }
      return moduleRegistry.get(id)();
    };
    
    /**
 * Planning Reconciliation - Réconciliation entre plan désiré et entrées existantes
 * 
 * Compare le plan généré avec les entrées existantes et produit
 * les opérations de création, mise à jour et suppression nécessaires.
 */
const { toCentiHours, toHours, validateNumber } = __require('planning/planning-engine');

const PRECISION_CENTIHOURS = 1;

/**
 * Vérifie si deux valeurs en centièmes d'heure sont différentes
 * @param {number} a - Première valeur en centièmes d'heure
 * @param {number} b - Deuxième valeur en centièmes d'heure
 * @returns {boolean} true si différentes
 */
function areDifferent(a, b) {
  return a !== b;
}

/**
 * Clé logique pour une entrée : assignmentId + date
 * @param {string|number} assignmentId - ID de l'affectation
 * @param {string} date - Date YYYY-MM-DD
 * @returns {string} Clé composite
 */
function makeEntryKey(assignmentId, date) {
  return `${assignmentId}:${date}`;
}

/**
 * Détecte les doublons dans un tableau
 * @param {Array} items - Items à vérifier
 * @param {Function} keyFn - Fonction pour extraire la clé
 * @returns {{ duplicates: Array, hasDuplicates: boolean }}
 */
function findDuplicatesInArray(items, keyFn) {
  const seen = new Map();
  const duplicates = [];
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = keyFn(item);
    
    if (seen.has(key)) {
      duplicates.push({
        index: i,
        item,
        key,
        firstIndex: seen.get(key),
        firstItem: items[seen.get(key)]
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
 * Réconcilie les entrées existantes avec le plan désiré.
 * 
 * @param {Array} existingEntries - Entrées existantes avec id, assignmentId, date, plannedHours, actualHours, sheetStatus, description, imputation, feuille, baseCapacityHours, availableCapacityHours, capaciteJour, revisionPlan
 * @param {Array} desiredPlan - Plan désiré avec assignmentId, taskId, memberId, date, plannedHours, baseCapacityHours, availableCapacityHours, capacityRecordId
 * @param {Object} [options] - Options de réconciliation
 * @param {number} [options.precisionHours=0.01] - Précision en heures
 * @param {Map} [options.existingEntriesMap] - Map id -> entrée existante pour revisionPlan
 * @returns {Object} Résultat avec creates, updates, deletes, conflicts
 */
function reconcileDailyEntries(existingEntries, desiredPlan, options = {}) {
  const precisionCentiHours = toCentiHours(options.precisionHours || 0.01);
  const existingEntriesMap = options.existingEntriesMap || new Map();
  
  const creates = [];
  const updates = [];
  const deletes = [];
  const conflicts = [];
  const conflictingKeys = new Set();
  
  const existingByKey = new Map();
  const existingDuplicateCheck = findDuplicatesInArray(
    existingEntries || [], 
    e => makeEntryKey(e.assignmentId, e.date)
  );
  
  if (existingDuplicateCheck.hasDuplicates) {
    for (const dup of existingDuplicateCheck.duplicates) {
      conflicts.push({
        code: "DUPLICATE_EXISTING_ENTRY",
        key: dup.key,
        assignmentId: dup.item.assignmentId,
        date: dup.item.date,
        entryIds: [dup.firstItem.id, dup.item.id],
        message: `Doublon existant : entrées ${dup.firstItem.id} et ${dup.item.id} pour ${dup.key}`
      });
      conflictingKeys.add(dup.key);
    }
  }
  
  for (const entry of existingEntries || []) {
    const key = makeEntryKey(entry.assignmentId, entry.date);
    
    if (existingByKey.has(key)) {
      existingByKey.get(key).push(entry);
    } else {
      existingByKey.set(key, [entry]);
    }
  }
  
  const desiredByKey = new Map();
  const desiredDuplicateCheck = findDuplicatesInArray(
    desiredPlan || [],
    d => makeEntryKey(d.assignmentId, d.date)
  );
  
  if (desiredDuplicateCheck.hasDuplicates) {
    for (const dup of desiredDuplicateCheck.duplicates) {
      conflicts.push({
        code: "DUPLICATE_DESIRED_ENTRY",
        key: dup.key,
        assignmentId: dup.item.assignmentId,
        date: dup.item.date,
        plannedHours: [dup.firstItem.plannedHours, dup.item.plannedHours],
        message: `Doublon dans le plan désiré : ${dup.key} apparaît ${dup.index + 1} fois`
      });
      conflictingKeys.add(dup.key);
    }
  }
  
  for (const item of desiredPlan || []) {
    const key = makeEntryKey(item.assignmentId, item.date);
    
    if (desiredByKey.has(key)) {
      desiredByKey.get(key).push(item);
    } else {
      desiredByKey.set(key, [item]);
    }
  }
  
  const processedKeys = new Set();
  
  for (const entry of existingEntries || []) {
    const key = makeEntryKey(entry.assignmentId, entry.date);
    
    if (processedKeys.has(key)) {
      continue;
    }
    processedKeys.add(key);
    
    if (conflictingKeys.has(key)) {
      continue;
    }
    
    const entriesForKey = existingByKey.get(key) || [];
    const primaryEntry = entriesForKey[0];
    
    const isSubmitted = primaryEntry.sheetStatus === 'submitted';
    const isValidated = primaryEntry.sheetStatus === 'validated';
    const isLocked = isSubmitted || isValidated;
    
    const desiredItems = desiredByKey.get(key);
    
    if (!desiredItems || desiredItems.length === 0) {
      // Aucune entrée désirée pour cette clé
      const plannedCentiHours = toCentiHours(primaryEntry.plannedHours || 0);
      const actualCentiHours = toCentiHours(primaryEntry.actualHours || 0);
      const hasDescription = !!(primaryEntry.description && primaryEntry.description.trim());
      const hasImputation = !!(primaryEntry.imputation && primaryEntry.imputation.trim());
      const hasFeuille = !!(primaryEntry.feuille && primaryEntry.feuille !== null && primaryEntry.feuille !== undefined);
      
      const isEmpty = (
        plannedCentiHours === 0 &&
        actualCentiHours === 0 &&
        !hasDescription &&
        !hasImputation &&
        !hasFeuille
      );
      
      // Une ligne verrouillée (soumise ou validée) absente de desiredPlan est simplement conservée
      // sans action ni conflit
      if (isLocked) {
        // Ne rien faire - la ligne est préservée telle quelle
        continue;
      }
      
      // Ligne avec réalisé : ne pas supprimer, mais possiblement mettre à zéro le prévu
      if (actualCentiHours > 0) {
        if (plannedCentiHours !== 0) {
          updates.push({
            id: primaryEntry.id,
            fields: {
              plannedHours: 0
            },
            reason: "ACTUAL_HOURS_PRESENT_ZERO_PLANNED"
          });
        }
        continue;
      }
      
      // Ligne avec description/imputation/feuille : mettre à zéro le prévu
      if (hasDescription || hasImputation || hasFeuille) {
        if (plannedCentiHours !== 0) {
          updates.push({
            id: primaryEntry.id,
            fields: {
              plannedHours: 0
            },
            reason: "HAS_METADATA_ZERO_PLANNED"
          });
        }
        continue;
      }
      
      // Ligne vide ou avec juste du prévu : supprimer
      deletes.push({
        id: primaryEntry.id,
        reason: "ENTRY_EMPTY_OR_PLANNED_ONLY"
      });
      
      continue;
    }
    
    const desiredItem = desiredItems[0];
    const existingPlannedCentiHours = toCentiHours(primaryEntry.plannedHours || 0);
    const desiredPlannedCentiHours = toCentiHours(desiredItem.plannedHours || 0);
    const existingBaseCapCentiHours = toCentiHours(primaryEntry.baseCapacityHours || 0);
    const desiredBaseCapCentiHours = toCentiHours(desiredItem.baseCapacityHours || 0);
    const existingAvailCapCentiHours = toCentiHours(primaryEntry.availableCapacityHours || 0);
    const desiredAvailCapCentiHours = toCentiHours(desiredItem.availableCapacityHours || 0);
    const existingCapacityRecordId = primaryEntry.capacityRecordId ?? primaryEntry.capaciteJour ?? null;
    const desiredCapacityRecordId = desiredItem.capacityRecordId ?? null;
    
    const fieldsToUpdate = {};
    
    if (areDifferent(existingPlannedCentiHours, desiredPlannedCentiHours)) {
      fieldsToUpdate.plannedHours = desiredItem.plannedHours;
    }
    
    if (areDifferent(existingBaseCapCentiHours, desiredBaseCapCentiHours)) {
      fieldsToUpdate.baseCapacityHours = desiredItem.baseCapacityHours;
    }
    
    if (areDifferent(existingAvailCapCentiHours, desiredAvailCapCentiHours)) {
      fieldsToUpdate.availableCapacityHours = desiredItem.availableCapacityHours;
    }
    
    // Correction 3 : Ne jamais effacer automatiquement une référence existante
    // lorsque le desired capacityRecordId est nul (capacité simulée sans ID)
    if (desiredCapacityRecordId !== null && desiredCapacityRecordId !== undefined) {
      if (areDifferent(existingCapacityRecordId, desiredCapacityRecordId)) {
        fieldsToUpdate.capacityRecordId = desiredCapacityRecordId;
      }
    }
    
    if (Object.keys(fieldsToUpdate).length > 0) {
      if (!isLocked) {
        // Incrémenter revisionPlan si un champ de planification change
        const existingRevision = Number(primaryEntry.revisionPlan || 0);
        fieldsToUpdate.revisionPlan = existingRevision + 1;
        
        updates.push({
          id: primaryEntry.id,
          fields: fieldsToUpdate,
          reason: "FIELDS_UPDATED"
        });
      } else {
        conflicts.push({
          code: "LOCKED_ENTRY_MISMATCH",
          key,
          date: primaryEntry.date,
          entryId: primaryEntry.id,
          sheetStatus: primaryEntry.sheetStatus,
          existingPlannedHours: primaryEntry.plannedHours,
          desiredPlannedHours: desiredItem.plannedHours,
          message: `Entrée ${primaryEntry.sheetStatus} : écart entre prévu existant (${primaryEntry.plannedHours}h) et désiré (${desiredItem.plannedHours}h)`
        });
      }
    }
  }
  
  for (const item of desiredPlan || []) {
    const key = makeEntryKey(item.assignmentId, item.date);
    
    if (conflictingKeys.has(key)) {
      continue;
    }
    
    const entriesForKey = existingByKey.get(key);
    
    if (!entriesForKey || entriesForKey.length === 0) {
      creates.push({
        assignmentId: item.assignmentId,
        taskId: item.taskId,
        memberId: item.memberId,
        date: item.date,
        plannedHours: item.plannedHours,
        baseCapacityHours: item.baseCapacityHours,
        availableCapacityHours: item.availableCapacityHours,
        capacityRecordId: item.capacityRecordId !== undefined ? item.capacityRecordId : null,
        revisionPlan: 1,
        reason: "NEW_PLAN_ENTRY"
      });
    }
  }
  
  return {
    creates,
    updates,
    deletes,
    conflicts
  };
}

return {
  reconcileDailyEntries,
  areDifferent,
  makeEntryKey,
  findDuplicatesInArray
};

  }));

  // Module: grist/grist-api-helper
  moduleRegistry.set('grist/grist-api-helper', (function() {
    var exports = {};
    var module = { exports: exports };
    var __require = function(id) {
      if (!moduleRegistry.has(id)) {
        throw new Error('Module non résolu: ' + id);
      }
      return moduleRegistry.get(id)();
    };
    
    /**
 * Grist API Helper - Helper commun pour l'accès à grist.docApi
 * 
 * Normalise l'accès à l'API Grist pour éviter les erreurs
 * et garantir la cohérence entre les différents modules.
 */
/**
 * Normalise l'accès à grist.docApi
 * @param {Object} grist - Objet Grist ou grist.docApi
 * @returns {Object} L'API docApi validée
 * @throws {Error} Si l'API n'est pas valide
 */
function getDocApi(grist) {
  const docApi = grist && (grist.docApi || grist);

  if (
    !docApi ||
    typeof docApi.fetchTable !== 'function' ||
    typeof docApi.applyUserActions !== 'function'
  ) {
    throw new Error('INVALID_GRIST_DOC_API: grist.docApi doit exposer fetchTable et applyUserActions');
  }

  return docApi;
}

/**
 * Charge les métadonnées de migration depuis Grist
 * @param {Object} grist - Objet Grist
 * @returns {Promise<Array>} Tableau de {tableId, colId, type, isFormula}
 */
async function loadMigrationMetadata(grist) {
  const docApi = getDocApi(grist);
  
  // Charger les tables et colonnes
  const [tablesData, columnsData] = await Promise.all([
    docApi.fetchTable('_grist_Tables'),
    docApi.fetchTable('_grist_Tables_column')
  ]);
  
  // Convertir en lignes
  const tables = columnarToRows(tablesData);
  const columns = columnarToRows(columnsData);
  
  // Créer un map tableId par parentId
  const tableById = new Map();
  for (const table of tables) {
    tableById.set(table.id, table.tableId);
  }
  
  // Reconstruire les métadonnées avec tableId
  const result = [];
  for (const col of columns) {
    const tableId = tableById.get(col.parentId);
    if (tableId) {
      result.push({
        tableId,
        colId: col.colId,
        type: col.type,
        isFormula: col.isFormula
      });
    }
  }
  
  return result;
}

/**
 * Helper: convertir tableau colonnaire en lignes
 * @param {Object} data - Données colonnaires
 * @returns {Array} Tableau de lignes
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

return {
  getDocApi,
  loadMigrationMetadata,
  columnarToRows
};

  }));

  // Module: capacity/member-daily-capacity-service
  moduleRegistry.set('capacity/member-daily-capacity-service', (function() {
    var exports = {};
    var module = { exports: exports };
    var __require = function(id) {
      if (!moduleRegistry.has(id)) {
        throw new Error('Module non résolu: ' + id);
      }
      return moduleRegistry.get(id)();
    };
    
    /**
 * Member Daily Capacity Service - Gestion des capacités quotidiennes
 * 
 * Service dédié pour créer, réconcilier et assurer les capacités quotidiennes
 * des membres dans la table MemberDailyCapacities.
 */
const { parseDateUTC, formatDateUTC, addDaysUTC, compareDates, toCentiHours, toHours, validateNumber } = __require('planning/planning-engine');
const { getDocApi } = __require('grist/grist-api-helper');

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
      actions,
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

return {
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

  }));

  // Module: grist/grist-planning-adapter
  moduleRegistry.set('grist/grist-planning-adapter', (function() {
    var exports = {};
    var module = { exports: exports };
    var __require = function(id) {
      if (!moduleRegistry.has(id)) {
        throw new Error('Module non résolu: ' + id);
      }
      return moduleRegistry.get(id)();
    };
    
    /**
 * Grist Planning Adapter - Adaptateur entre le moteur métier et Grist
 * 
 * Fournit une couche d'abstraction pour :
 * - La conversion des dates Grist ↔ ISO UTC
 * - La normalisation des statuts
 * - La construction des capacités quotidiennes
 * - La réconciliation des plans avec Grist
 */
const { buildAssignmentPlan, toCentiHours, toHours, parseDateUTC, formatDateUTC, addDaysUTC } = __require('planning/planning-engine');
const { reconcileDailyEntries } = __require('planning/reconciliation/planning-reconciliation');
const { getDocApi } = __require('grist/grist-api-helper');
const { ensureMemberDailyCapacities } = __require('capacity/member-daily-capacity-service');

// ============================================================================
// CONSTANTES
// ============================================================================

const PRECISION_CENTIHOURS = 1;
const DEFAULT_WEEKLY_CAPACITY = 35;
const DAYS_PER_WEEK = 5;

// Mapping des statuts Grist (français) vers statuts du domaine (anglais)
const STATUS_MAPPING = {
  // Français
  'brouillon': 'draft',
  'soumis': 'submitted',
  'valide': 'validated',
  'rejete': 'draft',
  // Anglais (pour robustesse)
  'draft': 'draft',
  'submitted': 'submitted',
  'validated': 'validated',
  'rejected': 'draft'
};

// Codes de diagnostics bloquants
const BLOCKING_DIAGNOSTIC_PREFIXES = [
  'MISSING_',
  'INVALID_',
  'DUPLICATE_'
];

const BLOCKING_DIAGNOSTIC_CODES = [
  'PROTECTED_PLAN_EXCEEDS_ALLOCATION'
];

// ============================================================================
// RESOLUTION DE replanFromDate
// ============================================================================

/**
 * Détermine la date de replanification à utiliser
 * @param {Object} options - Options avec replanFromDate, todayIso
 * @returns {string} Date YYYY-MM-DD UTC
 */
function resolveReplanFromDate(options = {}) {
  const { replanFromDate, todayIso } = options;
  
  // Priorité 1: options.replanFromDate explicite
  if (replanFromDate) {
    return replanFromDate;
  }
  
  // Priorité 2: options.todayIso (pour les tests)
  if (todayIso) {
    return todayIso;
  }
  
  // Priorité 3: Date UTC du jour
  return formatDateUTC(new Date());
}

// ============================================================================
// DETECTION DES DOUBLONS ACTIFS
// ============================================================================

/**
 * Détecte les doublons d'affectations actives (même tâche + même membre)
 * @param {Array} assignments - Toutes les affectations
 * @returns {Object} Résultat avec hasDuplicates, duplicates, blockedAssignments
 */
function detectActiveAssignmentDuplicates(assignments) {
  const activeByTaskMember = new Map();
  const duplicates = [];
  const blockedAssignments = new Set();
  
  for (const assignment of assignments || []) {
    // Ignorer les affectations inactives
    if (assignment.actif === false) continue;
    
    const key = `${assignment.tache}:${assignment.membre}`;
    
    if (activeByTaskMember.has(key)) {
      // Doublon détecté
      const first = activeByTaskMember.get(key);
      duplicates.push({
        key,
        task: assignment.tache,
        member: assignment.membre,
        assignments: [first.id, assignment.id]
      });
      blockedAssignments.add(first.id);
      blockedAssignments.add(assignment.id);
    } else {
      activeByTaskMember.set(key, assignment);
    }
  }
  
  return {
    hasDuplicates: duplicates.length > 0,
    duplicates,
    blockedAssignments
  };
}

// ============================================================================
// CONVERSION DES DATES
// ============================================================================

/**
 * Convertit une date Grist (secondes Unix) en ISO UTC (YYYY-MM-DD)
 * @param {*} value - Valeur Grist (nombre de secondes ou string ISO)
 * @returns {string|null} Date ISO UTC ou null
 */
function gristDateToIso(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  
  // Si c'est déjà une chaîne ISO
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
    // Tenter de parser une date ISO complète
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return formatDateUTC(date);
    }
  }
  
  // Si c'est un nombre (secondes Unix Grist)
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value * 1000);
    if (!isNaN(date.getTime())) {
      return formatDateUTC(date);
    }
  }
  
  // Si c'est un objet Date
  if (value instanceof Date) {
    return formatDateUTC(value);
  }
  
  return null;
}

/**
 * Convertit une date ISO UTC (YYYY-MM-DD) en date Grist (secondes Unix)
 * @param {string} value - Date ISO UTC
 * @returns {number|null} Secondes Unix ou null
 */
function isoToGristDate(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  
  const date = parseDateUTC(value);
  if (!date) {
    return null;
  }
  
  // Retourner les secondes Unix (Grist utilise des secondes, pas des millisecondes)
  return Math.floor(date.getTime() / 1000);
}

// ============================================================================
// NORMALISATION DES STATUTS
// ============================================================================

/**
 * Normalise un statut de feuille Grist vers le statut du domaine
 * @param {*} status - Statut brut venant de Grist
 * @returns {string|null} Statut normalisé ou null
 */
function normalizeSheetStatus(status) {
  if (status === null || status === undefined || status === '') {
    return null;
  }
  
  const normalized = STATUS_MAPPING[String(status).toLowerCase()];
  return normalized || null;
}

// ============================================================================
// CONSTRUCTION DES CAPACITÉS QUOTIDIENNES
// ============================================================================

/**
 * Construit les capacités quotidiennes pour le moteur de planification à partir des capacités Grist
 * @param {Array} memberDailyCapacities - Capacités depuis Grist
 * @returns {Array} Capacités formatées pour le moteur
 */
function buildCapacitiesFromGrist(memberDailyCapacities) {
  const capacities = [];
  
  for (const cap of memberDailyCapacities || []) {
    const dateStr = typeof cap.date === 'number' 
      ? formatDateUTC(new Date(cap.date * 1000))
      : cap.date;
    
    capacities.push({
      date: dateStr,
      baseCapacityHours: cap.capaciteTheorique || 0,
      availableCapacityHours: cap.capaciteDisponible || 0
    });
  }
  
  return capacities;
}

// ============================================================================
// ÉTAT EFFECTIF DES CAPACITÉS (HELPER COMMUN)
// ============================================================================

/**
 * Construit l'état effectif des capacités pour un membre sur une période
 * en réconciliant les capacités existantes avec les capacités désirées.
 * 
 * Ce helper est utilisé par :
 * - planAssignment (lecture seule)
 * - reconcileAssignmentPlan en mode dryRun
 * 
 * @param {Object} grist - API Grist
 * @param {number} memberId - ID du membre
 * @param {string} startDate - Date de début (YYYY-MM-DD)
 * @param {string} endDate - Date de fin (YYYY-MM-DD)
 * @param {Object} options - Options
 * @param {number} [options.weeklyCapacity] - Capacité hebdomadaire
 * @param {Array} [options.availabilities] - Disponibilités du membre
 * @param {number} [options.defaultWeeklyCapacity=35] - Capacité par défaut
 * @param {string} [options.todayIso] - Date de référence pour protéger l'historique
 * @param {boolean} [options.forceHistoricalRebuild] - Si true, autorise la modification de l'historique
 * @param {boolean} [options.forceSourceOverride] - Si true, ignore la priorité des sources
 * @returns {Promise<Object>} Résultat avec capacities, capacityByDate, diff, conflicts, diagnostics
 */
async function buildEffectiveMemberDailyCapacityState(grist, memberId, startDate, endDate, options = {}) {
  const docApi = getDocApi(grist);
  const {
    weeklyCapacity,
    availabilities = [],
    defaultWeeklyCapacity = DEFAULT_WEEKLY_CAPACITY,
    todayIso,
    forceHistoricalRebuild = false,
    forceSourceOverride = false
  } = options;
  
  // Charger les capacités existantes
  const existingData = await docApi.fetchTable('MemberDailyCapacities');
  const existingCapacities = columnarToRows(existingData)
    .filter(cap => cap.membre === memberId);
  
  // Construire les capacités désirées
  const { buildDesiredMemberDailyCapacities, reconcileMemberDailyCapacities } = __require('capacity/member-daily-capacity-service');
  
  const desiredResult = buildDesiredMemberDailyCapacities({
    memberId,
    weeklyCapacity,
    availabilities,
    startDate,
    endDate,
    defaultWeeklyCapacity,
    source: 'calcul',
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
  const capacityReconciliation = reconcileMemberDailyCapacities(
    existingCapacities,
    desiredResult.capacities,
    {
      todayIso,
      forceHistoricalRebuild,
      forceSourceOverride
    }
  );
  
  // Vérifier les conflits immédiatement
  if (capacityReconciliation.conflicts && capacityReconciliation.conflicts.length > 0) {
    return {
      success: false,
      error: {
        code: 'CAPACITY_CONFLICTS',
        conflicts: capacityReconciliation.conflicts
      },
      diagnostics: desiredResult.diagnostics,
      desiredPlan: [],
      summary: null
    };
  }
  
  // Construire un état simulé des capacités après application virtuelle du diff
  const existingCapacitiesMap = new Map();
  for (const cap of existingCapacities) {
    const dateStr = typeof cap.date === 'number'
      ? formatDateUTC(new Date(cap.date * 1000))
      : cap.date;
    existingCapacitiesMap.set(dateStr, { ...cap });
  }
  
  // Appliquer virtuellement les créations
  for (const create of capacityReconciliation.creates) {
    const dateStr = formatDateUTC(new Date(create.date * 1000));
    existingCapacitiesMap.set(dateStr, {
      id: null, // Pas d'ID car simulé
      membre: create.membre,
      date: create.date,
      capaciteTheorique: create.capaciteTheorique,
      disponibiliteRatio: create.disponibiliteRatio,
      capaciteDisponible: create.capaciteDisponible,
      absenceHeures: create.absenceHeures,
      source: create.source,
      revision: create.revision
    });
  }
  
  // Appliquer virtuellement les mises à jour
  for (const update of capacityReconciliation.updates) {
    // Trouver la capacité existante par ID
    let foundDate = null;
    for (const [dateStr, cap] of existingCapacitiesMap) {
      if (cap.id === update.id) {
        foundDate = dateStr;
        break;
      }
    }
    if (foundDate) {
      const existing = existingCapacitiesMap.get(foundDate);
      existingCapacitiesMap.set(foundDate, {
        ...existing,
        capaciteTheorique: update.fields.capaciteTheorique,
        disponibiliteRatio: update.fields.disponibiliteRatio,
        capaciteDisponible: update.fields.capaciteDisponible,
        absenceHeures: update.fields.absenceHeures,
        source: update.fields.source,
        revision: update.fields.revision
      });
    }
  }
  
  // Reconstruire les capacités pour le moteur à partir de l'état simulé
  const simulatedCapacities = [];
  const simulatedCapacityByDate = new Map();
  
  for (const [dateStr, cap] of existingCapacitiesMap) {
    if (dateStr >= startDate && dateStr <= endDate) {
      simulatedCapacities.push({
        date: dateStr,
        baseCapacityHours: cap.capaciteTheorique || 0,
        availableCapacityHours: cap.capaciteDisponible || 0
      });
      simulatedCapacityByDate.set(dateStr, {
        id: cap.id,
        capaciteTheorique: cap.capaciteTheorique || 0,
        capaciteDisponible: cap.capaciteDisponible || 0,
        disponibiliteRatio: cap.disponibiliteRatio || 1
      });
    }
  }
  
  // Trier par date
  simulatedCapacities.sort((a, b) => a.date.localeCompare(b.date));
  
  // Construire les actions simulées de capacité
  const simulatedCapacityActions = [];
  for (const create of capacityReconciliation.creates) {
    simulatedCapacityActions.push(['AddRecord', 'MemberDailyCapacities', null, create]);
  }
  for (const update of capacityReconciliation.updates) {
    simulatedCapacityActions.push(['UpdateRecord', 'MemberDailyCapacities', update.id, update.fields]);
  }
  
  return {
    success: true,
    capacities: simulatedCapacities,
    capacityByDate: simulatedCapacityByDate,
    creates: capacityReconciliation.creates,
    updates: capacityReconciliation.updates,
    conflicts: capacityReconciliation.conflicts,
    capacityActions: simulatedCapacityActions,
    diagnostics: desiredResult.diagnostics
  };
}

// ============================================================================
// CHARGEMENT DU CONTEXTE D'UNE AFFECTATION
// ============================================================================

/**
 * Charge le contexte complet d'une affectation
 * @param {Object} grist - API Grist
 * @param {number} assignmentId - ID de l'affectation
 * @param {Object} options - Options
 * @param {boolean} [options.ensureCapacities=true] - Si true, assure les capacités dans Grist. Si false, construit en mémoire seulement.
 * @param {string} [options.todayIso] - Date de référence pour protéger l'historique des capacités
 * @param {boolean} [options.forceHistoricalRebuild] - Si true, autorise la modification de l'historique
 * @param {boolean} [options.forceSourceOverride] - Si true, ignore la priorité des sources
 * @returns {Promise<Object>} Contexte adapté pour buildAssignmentPlan
 */
async function loadAssignmentContext(grist, assignmentId, options = {}) {
  const docApi = getDocApi(grist);
  const {
    includeAllEntries = true,
    ensureCapacities = true,
    todayIso,
    forceHistoricalRebuild,
    forceSourceOverride
  } = options;
  
  // Charger toutes les tables nécessaires en parallèle
  const [
    assignmentsData,
    tasksData,
    teamData,
    entriesData,
    sheetsData,
    availabilitiesData
  ] = await Promise.all([
    docApi.fetchTable('TaskAssignments'),
    docApi.fetchTable('Tasks'),
    docApi.fetchTable('Team'),
    includeAllEntries ? docApi.fetchTable('TimeEntries') : Promise.resolve({ id: [] }),
    docApi.fetchTable('Feuilles'),
    docApi.fetchTable('Disponibilites')
  ]);
  
  // Convertir en lignes
  const assignments = columnarToRows(assignmentsData);
  const tasks = columnarToRows(tasksData);
  const team = columnarToRows(teamData);
  const entries = columnarToRows(entriesData);
  const sheets = columnarToRows(sheetsData);
  const availabilities = columnarToRows(availabilitiesData);
  
  // Trouver l'affectation
  const assignment = assignments.find(a => a.id === assignmentId);
  
  if (!assignment) {
    return {
      error: {
        code: 'ASSIGNMENT_NOT_FOUND',
        assignmentId
      }
    };
  }
  
  // Mapper les données de base (nécessaire même pour les affectations inactives)
  const task = tasks.find(t => t.id === assignment.tache);
  const member = team.find(m => m.id === assignment.membre);
  
  // Vérifier si l'affectation est inactive
  if (assignment.actif === false) {
    // Pour une affectation inactive, charger quand même les entrées existantes
    // pour permettre un nettoyage contrôlé
    const existingEntriesForInactive = entries
      .filter(e => e.affectation === assignmentId)
      .map(e => {
        const sheet = e.feuille ? sheets.find(s => s.id === e.feuille) : null;
        const sheetStatus = sheet ? normalizeSheetStatus(sheet.statut) : null;
        
        return {
          id: e.id,
          assignmentId: e.affectation,
          taskId: e.tache,
          memberId: e.membre,
          date: gristDateToIso(e.date),
          plannedHours: e.heuresPrevues || 0,
          actualHours: e.heures || 0,
          sheetStatus,
          description: e.description || null,
          imputation: e.imputation || null,
          feuille: e.feuille || null,
          revisionPlan: Number(e.revisionPlan || 0)
        };
      });
    
    // Retourner le contexte pour permettre le nettoyage
    return {
      assignment: {
        id: assignment.id,
        taskId: task ? task.id : assignment.tache,
        memberId: member ? member.id : assignment.membre,
        allocatedHours: assignment.heuresAllouees || 0,
        startDate: gristDateToIso(assignment.dateDebut),
        endDate: gristDateToIso(assignment.dateFin),
        actif: false
      },
      existingEntries: existingEntriesForInactive,
      diagnostics: [{
        code: 'ASSIGNMENT_INACTIVE_CLEANUP',
        message: 'Une affectation inactive nécessite un nettoyage contrôlé'
      }],
      isInactive: true
    };
  }
  
  if (!task || !member) {
    return {
      error: {
        code: 'RELATED_DATA_NOT_FOUND',
        taskId: assignment.tache,
        memberId: assignment.membre
      }
    };
  }
  
  // Assurer les capacités quotidiennes dans Grist avant de planifier
  const startDate = gristDateToIso(assignment.dateDebut);
  const endDate = gristDateToIso(assignment.dateFin);
  
  let capacityEnsureResult = { success: true, diagnostics: [] };
  let memberDailyCapacitiesInRange = [];
  let capacityByDate = new Map();
  let capacityActions = [];
  
  if (ensureCapacities) {
    // Mode écriture : assurer les capacités dans Grist
    capacityEnsureResult = await ensureMemberDailyCapacities(grist, member.id, startDate, endDate, {
      weeklyCapacity: member.capaciteHebdo,
      availabilities: availabilities.filter(a => a.membre === assignment.membre),
      defaultWeeklyCapacity: DEFAULT_WEEKLY_CAPACITY,
      source: 'calcul',
      dryRun: false,
      todayIso,
      forceHistoricalRebuild: forceHistoricalRebuild === true,
      forceSourceOverride: forceSourceOverride === true
    });
    
    // Vérifier les erreurs ou conflits bloquants
    if (!capacityEnsureResult.success) {
      return {
        error: {
          code: capacityEnsureResult.error.code,
          errors: capacityEnsureResult.error.errors || capacityEnsureResult.error.conflicts,
          message: capacityEnsureResult.error.message || 'Erreur lors de l\'assurance des capacités'
        }
      };
    }
    
    // Recharger les capacités quotidiennes depuis Grist (source de vérité unique)
    const memberDailyCapacitiesData = await docApi.fetchTable('MemberDailyCapacities');
    const memberDailyCapacities = columnarToRows(memberDailyCapacitiesData)
      .filter(cap => cap.membre === assignment.membre);
    
    // Filtrer pour ne garder que celles dans la période de l'affectation
    memberDailyCapacitiesInRange = memberDailyCapacities.filter(cap => {
      const capDate = typeof cap.date === 'number' 
        ? formatDateUTC(new Date(cap.date * 1000))
        : cap.date;
      return capDate >= startDate && capDate <= endDate;
    });
  } else {
    // Mode lecture : utiliser le helper commun pour construire l'état effectif des capacités
    // en respectant les capacités existantes (manuel, Lucca) et les options de protection
    const effectiveCapacityResult = await buildEffectiveMemberDailyCapacityState(grist, member.id, startDate, endDate, {
      weeklyCapacity: member.capaciteHebdo,
      availabilities: availabilities.filter(a => a.membre === assignment.membre),
      defaultWeeklyCapacity: DEFAULT_WEEKLY_CAPACITY,
      todayIso,
      forceHistoricalRebuild: forceHistoricalRebuild === true,
      forceSourceOverride: forceSourceOverride === true
    });
    
    if (!effectiveCapacityResult.success) {
      return {
        error: {
          code: effectiveCapacityResult.error.code,
          errors: effectiveCapacityResult.error.errors || effectiveCapacityResult.error.conflicts,
          message: 'Erreur lors de la construction des capacités effectives'
        }
      };
    }
    
    // Utiliser les capacités effectives simulées avec leurs IDs
    // effectiveCapacityResult.capacityByDate contient les IDs des capacités existantes
    memberDailyCapacitiesInRange = effectiveCapacityResult.capacities.map(cap => {
      const existingCap = effectiveCapacityResult.capacityByDate.get(cap.date);
      return {
        id: existingCap ? existingCap.id : null,
        membre: member.id,
        date: cap.date,
        capaciteTheorique: cap.baseCapacityHours,
        disponibiliteRatio: cap.baseCapacityHours > 0 ? cap.availableCapacityHours / cap.baseCapacityHours : 1,
        capaciteDisponible: cap.availableCapacityHours,
        absenceHeures: (cap.baseCapacityHours || 0) - cap.availableCapacityHours,
        source: 'calcul',
        revision: 1
      };
    });
    
    // Mettre à jour capacityByDate avec les capacités effectives et leurs IDs
    for (const [dateStr, cap] of effectiveCapacityResult.capacityByDate) {
      if (dateStr >= startDate && dateStr <= endDate) {
        capacityByDate.set(dateStr, {
          id: cap.id,
          capaciteTheorique: cap.capaciteTheorique || 0,
          capaciteDisponible: cap.capaciteDisponible || 0,
          disponibiliteRatio: cap.disponibiliteRatio || 1
        });
      }
    }
    
    capacityEnsureResult.diagnostics = effectiveCapacityResult.diagnostics;
    
    // Conserver les actions de capacité simulées pour le dryRun
    capacityActions = effectiveCapacityResult.capacityActions || [];
  }
  
  // Construire un map des capacités par date
  for (const cap of memberDailyCapacitiesInRange) {
    const dateStr = typeof cap.date === 'number' 
      ? formatDateUTC(new Date(cap.date * 1000))
      : cap.date;
    capacityByDate.set(dateStr, {
      id: cap.id,
      capaciteTheorique: cap.capaciteTheorique || 0,
      capaciteDisponible: cap.capaciteDisponible || 0,
      disponibiliteRatio: cap.disponibiliteRatio || 1
    });
  }
  
  // Construire les capacités pour le moteur de planification à partir des données
  const capacities = buildCapacitiesFromGrist(memberDailyCapacitiesInRange);
  
  // Mapper les entrées existantes et détecter les entrées orphelines
  const diagnostics = [...(capacityEnsureResult.diagnostics || [])];
  const existingEntries = entries
    .filter(e => {
      // Inclure UNIQUEMENT les entrées de cette affectation
      if (e.affectation === assignmentId) {
        return true;
      }
      // Signaler les entrées orphelines (sans affectation) comme diagnostic non bloquant
      if (!e.affectation && e.tache === assignment.tache && e.membre === assignment.membre) {
        diagnostics.push({
          code: 'UNASSIGNED_LEGACY_TIME_ENTRY',
          entryId: e.id,
          taskId: e.tache,
          memberId: e.membre,
          date: gristDateToIso(e.date),
          message: `Entrée ${e.id} sans affectation détectée pour la tâche ${e.tache} et le membre ${e.membre}. Un backfill explicite sera nécessaire.`
        });
        return false; // Ne pas inclure dans le calcul
      }
      return false;
    })
    .map(e => {
      // Trouver la feuille associée
      const sheet = e.feuille ? sheets.find(s => s.id === e.feuille) : null;
      const sheetStatus = sheet ? normalizeSheetStatus(sheet.statut) : null;
      
      // Conserver les valeurs réellement stockées (snapshots persistés)
      // La capacité effective est disponible séparément dans capacityByDate
      const dateStr = gristDateToIso(e.date);
      
      return {
        id: e.id,
        assignmentId: e.affectation,
        taskId: e.tache,
        memberId: e.membre,
        date: dateStr,
        plannedHours: e.heuresPrevues || 0,
        actualHours: e.heures || 0,
        sheetStatus,
        description: e.description || null,
        imputation: e.imputation || null,
        feuille: e.feuille || null,
        capaciteJour: e.capaciteJour || null,
        capacityRecordId: e.capaciteJour || null,
        baseCapacityHours: Number(e.capaciteTheorique || 0),
        availableCapacityHours: Number(e.capaciteDisponible || 0),
        revisionPlan: Number(e.revisionPlan || 0)
      };
    });
  
  return {
    assignment: {
      id: assignment.id,
      taskId: task.id,
      memberId: member.id,
      allocatedHours: assignment.heuresAllouees || 0,
      startDate: gristDateToIso(assignment.dateDebut),
      endDate: gristDateToIso(assignment.dateFin)
    },
    capacities,
    existingEntries,
    capacityByDate,
    diagnostics,
    capacityActions,
    memberWeeklyCapacity: member.capaciteHebdo,
    memberAvailabilities:
      availabilities.filter(a => a.membre === assignment.membre)
  };
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
// SERVICE DE PLANIFICATION GRIST
// ============================================================================

/**
 * Planifie une affectation (lecture seule, dry-run)
 * @param {Object} grist - API Grist
 * @param {number} assignmentId - ID de l'affectation
 * @param {Object} options - Options
 * @returns {Promise<Object>} Résultat avec plan, diff, diagnostics
 */
async function planAssignment(grist, assignmentId, options = {}) {
  const {
    precisionHours = 0.01,
    capacityPolicy = 'cap'
  } = options;
  
  // Utiliser le helper de prévalidation
  const preview = await prepareAssignmentReconciliation(grist, assignmentId, {
    ...options,
    precisionHours,
    capacityPolicy
  });
  
  if (!preview.success) {
    return {
      success: false,
      error: preview.error,
      assignmentId,
      desiredPlan: [],
      summary: null,
      diagnostics: preview.diagnostics || [],
      diff: null
    };
  }
  
  return {
    success: true,
    assignmentId,
    desiredPlan: preview.desiredPlan,
    summary: preview.summary,
    diagnostics: preview.diagnostics,
    diff: preview.diff,
    context: preview.context
  };
}

/**
 * Helper de prévalidation en lecture seule
 * Construit un état simulé complet sans aucune écriture
 * Utilisé par planAssignment, reconcileAssignmentPlan dryRun, et la prévalidation du mode réel
 */
async function prepareAssignmentReconciliation(grist, assignmentId, options = {}) {
  const {
    precisionHours = 0.01,
    capacityPolicy = 'cap'
  } = options;
  
  const effectiveReplanFromDate = resolveReplanFromDate(options);
  
  // Charger le contexte en mode lecture seule (sans écrire les capacités)
  const context = await loadAssignmentContext(grist, assignmentId, {
    ...options,
    ensureCapacities: false
  });
  
  if (context.error) {
    return {
      success: false,
      error: context.error,
      context: null,
      assignment: null,
      desiredPlan: [],
      summary: null,
      diagnostics: [],
      diff: null,
      capacityActions: [],
      timeEntryActions: []
    };
  }
  
  const { assignment, capacities, existingEntries, diagnostics, capacityByDate, capacityActions } = context;
  
  // Appeler le moteur de planification
  const planResult = buildAssignmentPlan({
    assignment,
    capacities,
    existingEntries,
    replanFromDate: effectiveReplanFromDate,
    precisionHours,
    capacityPolicy
  });
  
  // Fusionner les diagnostics
  const allDiagnostics = [...(diagnostics || []), ...planResult.diagnostics];
  
  // Vérifier les diagnostics bloquants
  const blockingDiagnostics = allDiagnostics.filter(isBlockingDiagnostic);
  
  if (blockingDiagnostics.length > 0) {
    return {
      success: false,
      error: {
        code: 'BLOCKING_DIAGNOSTICS',
        diagnostics: blockingDiagnostics
      },
      context,
      assignment,
      desiredPlan: [],
      summary: null,
      diagnostics: allDiagnostics,
      diff: null,
      capacityActions: [],
      timeEntryActions: []
    };
  }
  
  // Enrichir le plan désiré avec la référence de capacité
  const desiredPlanWithCapacityRefs = planResult.desiredPlan.map(item => {
    const dailyCapacity = capacityByDate.get(item.date);
    return {
      ...item,
      capacityRecordId: (dailyCapacity && dailyCapacity.id) ? dailyCapacity.id : null
    };
  });
  
  // Réconcilier
  const diff = reconcileDailyEntries(existingEntries, desiredPlanWithCapacityRefs, {
    precisionHours
  });
  
  // Vérifier les conflits
  if (diff.conflicts && diff.conflicts.length > 0) {
    return {
      success: false,
      error: {
        code: 'CONFLICTS_DETECTED',
        conflicts: diff.conflicts
      },
      context,
      assignment,
      desiredPlan: [],
      summary: null,
      diagnostics: allDiagnostics,
      diff,
      capacityActions: [],
      timeEntryActions: []
    };
  }
  
  // Construire les actions simulées
  const existingEntriesMap = new Map();
  for (const entry of existingEntries) {
    existingEntriesMap.set(entry.id, entry);
  }
  
  const timeEntryActions = diffToGristActions(diff, assignment, capacities, existingEntriesMap, capacityByDate);
  
  // Utiliser les actions de capacité simulées du contexte (pour le dryRun)
  const effectiveCapacityActions = capacityActions || [];
  
  return {
    success: true,
    context,
    assignment,
    desiredPlan: desiredPlanWithCapacityRefs,
    summary: planResult.summary,
    diagnostics: allDiagnostics,
    diff,
    capacityActions: effectiveCapacityActions,
    timeEntryActions,
    effectiveReplanFromDate
  };
}

/**
 * Vérifie si un diagnostic est bloquant
 * @param {Object} diagnostic - Diagnostic à vérifier
 * @returns {boolean}
 */
function isBlockingDiagnostic(diagnostic) {
  const code = diagnostic.code || '';
  
  // Vérifier les préfixes bloquants
  for (const prefix of BLOCKING_DIAGNOSTIC_PREFIXES) {
    if (code.startsWith(prefix)) {
      return true;
    }
  }
  
  // Vérifier les codes bloquants explicites
  if (BLOCKING_DIAGNOSTIC_CODES.includes(code)) {
    return true;
  }
  
  return false;
}

/**
 * Réconcilie le plan d'une affectation avec Grist
 * @param {Object} grist - API Grist
 * @param {number} assignmentId - ID de l'affectation
 * @param {Object} options - Options
 * @returns {Promise<Object>} Résultat détaillé
 */
async function reconcileAssignmentPlan(grist, assignmentId, options = {}) {
  const {
    dryRun = false,
    precisionHours = 0.01,
    capacityPolicy = 'cap'
  } = options;
  
  const docApi = getDocApi(grist);
  
  // Phase 1 : Prévalidation complète sans écriture
  const preview = await prepareAssignmentReconciliation(grist, assignmentId, {
    ...options,
    precisionHours,
    capacityPolicy
  });
  
  if (!preview.success) {
    return {
      success: false,
      error: preview.error,
      dryRun,
      actionsExecuted: 0,
      actions: [],
      capacityActions: [],
      timeEntryActions: [],
      desiredPlan: [],
      summary: null,
      diagnostics: preview.diagnostics || [],
      actionsArePreviewOnly: dryRun,
      canApplyActionsDirectly: false,
      commitMethod: 'reconcileAssignmentPlan'
    };
  }
  
  const { context, assignment, desiredPlan, summary, diagnostics, timeEntryActions, capacityActions, effectiveReplanFromDate } = preview;
  
  // Si l'affectation est inactive, effectuer un nettoyage contrôlé
  if (context.isInactive) {
    const allDiagnostics = [...(diagnostics || [])];
    const existingEntries = context.existingEntries;
    
    // Générer les actions de nettoyage pour les entrées futures
    const cleanupActions = [];
    const existingEntriesMap = new Map();
    
    for (const entry of existingEntries) {
      existingEntriesMap.set(entry.id, entry);
      
      const isBeforeReplan = entry.date < effectiveReplanFromDate;
      const isSubmitted = entry.sheetStatus === 'submitted';
      const isValidated = entry.sheetStatus === 'validated';
      const isLocked = isSubmitted || isValidated;
      
      // Conserver toutes les lignes antérieures à replanFromDate
      if (isBeforeReplan) {
        continue;
      }
      
      // Conserver toutes les lignes soumises ou validées
      if (isLocked) {
        continue;
      }
      
      // Pour les lignes futures mutables
      const hasPlannedHours = entry.plannedHours > 0;
      const hasActualHours = entry.actualHours > 0;
      const hasDescription = !!(entry.description && entry.description.trim());
      const hasImputation = !!(entry.imputation && entry.imputation.trim());
      const hasFeuille = !!(entry.feuille && entry.feuille !== null && entry.feuille !== undefined);
      
      const isEmpty = (
        !hasPlannedHours &&
        !hasActualHours &&
        !hasDescription &&
        !hasImputation &&
        !hasFeuille
      );
      
      if (isEmpty) {
        // Supprimer la ligne vide
        cleanupActions.push([
          'RemoveRecord',
          'TimeEntries',
          entry.id
        ]);
      } else if (hasPlannedHours) {
        // Mettre heuresPrevues à zéro tout en conservant le reste
        const currentRevision = Number(entry.revisionPlan || 0);
        cleanupActions.push([
          'UpdateRecord',
          'TimeEntries',
          entry.id,
          {
            heuresPrevues: 0,
            revisionPlan: currentRevision + 1
          }
        ]);
      }
    }
    
    if (dryRun || cleanupActions.length === 0) {
      return {
        success: true,
        dryRun,
        actionsExecuted: 0,
        actions: cleanupActions,
        capacityActions: [],
        timeEntryActions: cleanupActions,
        diagnostics: allDiagnostics,
        isInactive: true,
        desiredPlan,
        summary,
        actionsArePreviewOnly: dryRun,
        canApplyActionsDirectly: false,
        commitMethod: 'reconcileAssignmentPlan'
      };
    }
    
    // Appliquer les actions de nettoyage
    try {
      await docApi.applyUserActions(cleanupActions);
      
      return {
        success: true,
        dryRun,
        actionsExecuted: cleanupActions.length,
        actions: cleanupActions,
        capacityActions: [],
        timeEntryActions: cleanupActions,
        diagnostics: allDiagnostics,
        isInactive: true,
        desiredPlan,
        summary,
        actionsArePreviewOnly: false,
        canApplyActionsDirectly: false,
        commitMethod: 'reconcileAssignmentPlan'
      };
    } catch (e) {
      return {
        success: false,
        error: {
          code: 'GRIST_ACTION_FAILED',
          message: e.message || String(e)
        },
        actionsExecuted: 0,
        actions: cleanupActions,
        capacityActions: [],
        timeEntryActions: cleanupActions,
        diagnostics: allDiagnostics,
        isInactive: true,
        desiredPlan,
        summary,
        actionsArePreviewOnly: false,
        canApplyActionsDirectly: false,
        commitMethod: 'reconcileAssignmentPlan'
      };
    }
  }
  
  // Mode dryRun : retourner la prévisualisation
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      desiredPlan,
      summary,
      diagnostics,
      diff: preview.diff,
      capacityActions,
      timeEntryActions,
      actions: timeEntryActions,
      actionsExecuted: 0,
      actionsArePreviewOnly: true,
      canApplyActionsDirectly: false,
      commitMethod: 'reconcileAssignmentPlan'
    };
  }
  
  // Phase 2 : Exécution réelle
  // Assurer réellement les capacités une seule fois avec les vraies données
  const capacityEnsureResult = await ensureMemberDailyCapacities(grist, assignment.memberId, assignment.startDate, assignment.endDate, {
    weeklyCapacity: context.memberWeeklyCapacity,
    availabilities: context.memberAvailabilities,
    defaultWeeklyCapacity: DEFAULT_WEEKLY_CAPACITY,
    source: 'calcul',
    dryRun: false,
    todayIso: options.todayIso,
    forceHistoricalRebuild: options.forceHistoricalRebuild === true,
    forceSourceOverride: options.forceSourceOverride === true
  });
  
  if (!capacityEnsureResult.success) {
    return {
      success: false,
      error: capacityEnsureResult.error,
      dryRun: false,
      actionsExecuted: 0,
      actions: [],
      capacityActions: [],
      timeEntryActions: [],
      desiredPlan: [],
      summary: null,
      diagnostics: diagnostics,
      actionsArePreviewOnly: false,
      canApplyActionsDirectly: false,
      commitMethod: 'reconcileAssignmentPlan'
    };
  }
  
  // Recharger le contexte réel avec les vrais IDs de capacités (sans réécrire les capacités)
  const realContext = await loadAssignmentContext(grist, assignmentId, {
    ...options,
    ensureCapacities: false
  });
  
  if (realContext.error) {
    return {
      success: false,
      error: realContext.error,
      dryRun: false,
      actionsExecuted: 0,
      actions: [],
      capacityActions: [],
      timeEntryActions: [],
      desiredPlan: [],
      summary: null,
      diagnostics: diagnostics,
      actionsArePreviewOnly: false,
      canApplyActionsDirectly: false,
      commitMethod: 'reconcileAssignmentPlan'
    };
  }
  
  // Recalculer le plan avec l'état réel
  const realPlanResult = buildAssignmentPlan({
    assignment: realContext.assignment,
    capacities: realContext.capacities,
    existingEntries: realContext.existingEntries,
    replanFromDate: effectiveReplanFromDate,
    precisionHours,
    capacityPolicy
  });
  
  // Vérifier à nouveau les diagnostics
  const realAllDiagnostics = [...(realContext.diagnostics || []), ...realPlanResult.diagnostics];
  const realBlockingDiagnostics = realAllDiagnostics.filter(isBlockingDiagnostic);
  
  if (realBlockingDiagnostics.length > 0) {
    return {
      success: false,
      error: {
        code: 'BLOCKING_DIAGNOSTICS',
        diagnostics: realBlockingDiagnostics
      },
      dryRun: false,
      actionsExecuted: 0,
      actions: [],
      capacityActions: [],
      timeEntryActions: [],
      desiredPlan: [],
      summary: null,
      diagnostics: realAllDiagnostics,
      actionsArePreviewOnly: false,
      canApplyActionsDirectly: false,
      commitMethod: 'reconcileAssignmentPlan'
    };
  }
  
  // Enrichir le plan réel avec les références de capacité
  const realDesiredPlan = realPlanResult.desiredPlan.map(item => {
    const dailyCapacity = realContext.capacityByDate.get(item.date);
    return {
      ...item,
      capacityRecordId: (dailyCapacity && dailyCapacity.id) ? dailyCapacity.id : null
    };
  });
  
  // Réconcilier avec l'état réel
  const realDiff = reconcileDailyEntries(realContext.existingEntries, realDesiredPlan, {
    precisionHours
  });
  
  // Vérifier les conflits
  if (realDiff.conflicts && realDiff.conflicts.length > 0) {
    return {
      success: false,
      error: {
        code: 'CONFLICTS_DETECTED',
        conflicts: realDiff.conflicts
      },
      dryRun: false,
      actionsExecuted: 0,
      actions: [],
      capacityActions: [],
      timeEntryActions: [],
      desiredPlan: [],
      summary: null,
      diagnostics: realAllDiagnostics,
      actionsArePreviewOnly: false,
      canApplyActionsDirectly: false,
      commitMethod: 'reconcileAssignmentPlan'
    };
  }
  
  // Construire les actions réelles
  const realExistingEntriesMap = new Map();
  for (const entry of realContext.existingEntries) {
    realExistingEntriesMap.set(entry.id, entry);
  }
  
  const realTimeEntryActions = diffToGristActions(realDiff, realContext.assignment, realContext.capacities, realExistingEntriesMap, realContext.capacityByDate);
  
  if (realTimeEntryActions.length === 0) {
    return {
      success: true,
      dryRun: false,
      desiredPlan: realDesiredPlan,
      summary: realPlanResult.summary,
      diagnostics: realAllDiagnostics,
      diff: realDiff,
      capacityActions: capacityEnsureResult.actions || [],
      timeEntryActions: realTimeEntryActions,
      actions: realTimeEntryActions,
      actionsExecuted: capacityEnsureResult.actionsExecuted || 0,
      actionsArePreviewOnly: false,
      canApplyActionsDirectly: false,
      commitMethod: 'reconcileAssignmentPlan'
    };
  }
  
  // Appliquer les actions TimeEntries
  try {
    await docApi.applyUserActions(realTimeEntryActions);
    
    return {
      success: true,
      dryRun: false,
      desiredPlan: realDesiredPlan,
      summary: realPlanResult.summary,
      diagnostics: realAllDiagnostics,
      diff: realDiff,
      capacityActions: capacityEnsureResult.actions || [],
      timeEntryActions: realTimeEntryActions,
      actions: realTimeEntryActions,
      actionsExecuted: (capacityEnsureResult.actionsExecuted || 0) + realTimeEntryActions.length,
      actionsArePreviewOnly: false,
      canApplyActionsDirectly: false,
      commitMethod: 'reconcileAssignmentPlan'
    };
  } catch (e) {
    return {
      success: false,
      error: {
        code: 'GRIST_ACTION_FAILED',
        message: e.message || String(e)
      },
      dryRun: false,
      actionsExecuted: 0,
      actions: [],
      capacityActions: capacityEnsureResult.actions || [],
      timeEntryActions: realTimeEntryActions,
      desiredPlan: realDesiredPlan,
      summary: realPlanResult.summary,
      diagnostics: realAllDiagnostics,
      actionsArePreviewOnly: false,
      canApplyActionsDirectly: false,
      commitMethod: 'reconcileAssignmentPlan'
    };
  }
}

/**
 * Transforme un diff en actions Grist
 * @param {Object} diff - Résultat de reconcileDailyEntries
 * @param {Object} assignment - Affectation de référence
 * @param {Array} capacities - Capacités par date
 * @param {Map} existingEntriesMap - Map id -> entrée existante pour revisionPlan
 * @param {Map} capacityByDate - Map date -> capacité effective avec id
 * @returns {Array} Actions Grist
 */
function diffToGristActions(diff, assignment, capacities = [], existingEntriesMap = new Map(), capacityByDate = new Map()) {
  const actions = [];
  const capacityMap = new Map();
  
  for (const cap of capacities || []) {
    capacityMap.set(cap.date, cap);
  }
  
  // Créations
  for (const create of diff.creates || []) {
    const date = create.date;
    const cap = capacityMap.get(date) || {};
    
    actions.push([
      'AddRecord',
      'TimeEntries',
      null,
      {
        affectation: assignment.id,
        tache: assignment.taskId,
        membre: assignment.memberId,
        date: isoToGristDate(date),
        heuresPrevues: create.plannedHours,
        heures: 0,
        capaciteTheorique: create.baseCapacityHours || cap.baseCapacityHours || 0,
        capaciteDisponible: create.availableCapacityHours || cap.availableCapacityHours || 0,
        capaciteJour: create.capacityRecordId || null,
        revisionPlan: 1,
        description: null,
        imputation: null
      }
    ]);
  }
  
  // Mises à jour
  for (const update of diff.updates || []) {
    const fields = {};
    
    // Mapper uniquement les champs de planification
    if (update.fields.plannedHours !== undefined) {
      fields.heuresPrevues = update.fields.plannedHours;
    }
    if (update.fields.baseCapacityHours !== undefined) {
      fields.capaciteTheorique = update.fields.baseCapacityHours;
    }
    if (update.fields.availableCapacityHours !== undefined) {
      fields.capaciteDisponible = update.fields.availableCapacityHours;
    }
    if (update.fields.capacityRecordId !== undefined) {
      fields.capaciteJour = update.fields.capacityRecordId;
    }
    
    // Incrémenter revisionPlan si un champ de planification change
    if (Object.keys(fields).length > 0) {
      const existingEntry = existingEntriesMap.get(update.id);
      const currentRevision = existingEntry ? Number(existingEntry.revisionPlan || 0) : 0;
      fields.revisionPlan = currentRevision + 1;
      
      actions.push([
        'UpdateRecord',
        'TimeEntries',
        update.id,
        fields
      ]);
    }
  }
  
  // Suppressions
  for (const del of diff.deletes || []) {
    actions.push([
      'RemoveRecord',
      'TimeEntries',
      del.id
    ]);
  }
  
  return actions;
}

/**
 * Réconcilie le plan de toutes les affectations d'une tâche
 * @param {Object} grist - API Grist
 * @param {number} taskId - ID de la tâche
 * @param {Object} options - Options
 * @returns {Promise<Object>} Résultats par affectation
 */
async function reconcileTaskPlan(grist, taskId, options = {}) {
  const docApi = getDocApi(grist);
  
  const {
    dryRun = false,
    activeOnly = true
  } = options;
  
  // Charger les affectations de la tâche
  const assignmentsData = await docApi.fetchTable('TaskAssignments');
  const assignments = columnarToRows(assignmentsData);
  
  const taskAssignments = assignments.filter(a => {
    if (a.tache !== taskId) return false;
    if (activeOnly && a.actif === false) return false;
    return true;
  });
  
  // Détecter les doublons d'affectations actives (même tâche + même membre)
  const activeByTaskMember = new Map();
  const duplicates = [];
  const blockedAssignments = new Set();
  
  for (const assignment of taskAssignments) {
    const key = `${assignment.tache}:${assignment.membre}`;
    
    if (activeByTaskMember.has(key)) {
      // Doublon détecté
      const first = activeByTaskMember.get(key);
      duplicates.push({
        key,
        task: assignment.tache,
        member: assignment.membre,
        assignments: [first.id, assignment.id]
      });
      blockedAssignments.add(first.id);
      blockedAssignments.add(assignment.id);
    } else {
      activeByTaskMember.set(key, assignment);
    }
  }
  
  // Réconcilier chaque affectation non bloquée
  const results = [];
  
  for (const assignment of taskAssignments) {
    // Si cette affectation est un doublon actif, la bloquer
    if (blockedAssignments.has(assignment.id)) {
      results.push({
        assignmentId: assignment.id,
        memberId: assignment.membre,
        success: false,
        error: {
          code: 'DUPLICATE_ACTIVE_ASSIGNMENT',
          key: `${assignment.tache}:${assignment.membre}`,
          message: `Doublon d'affectation active détecté pour la tâche ${assignment.tache} et le membre ${assignment.membre}`
        },
        actionsExecuted: 0,
        actions: []
      });
      continue;
    }
    
    const result = await reconcileAssignmentPlan(grist, assignment.id, {
      ...options,
      dryRun
    });
    
    results.push({
      assignmentId: assignment.id,
      memberId: assignment.membre,
      ...result
    });
  }
  
  return {
    taskId,
    assignmentCount: results.length,
    duplicates: duplicates.length > 0 ? duplicates : undefined,
    results
  };
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

return {
  // Conversion des dates
  gristDateToIso,
  isoToGristDate,
  
  // Normalisation des statuts
  normalizeSheetStatus,
  
  // Construction des capacités
  buildCapacitiesFromGrist,
  
  // Chargement du contexte
  loadAssignmentContext,
  
  // Services de planification
  planAssignment,
  reconcileAssignmentPlan,
  reconcileTaskPlan,
  
  // Utilitaires
  isBlockingDiagnostic,
  diffToGristActions,
  resolveReplanFromDate,
  detectActiveAssignmentDuplicates,
  
  // Constantes exportées pour les tests
  STATUS_MAPPING,
  DEFAULT_WEEKLY_CAPACITY,
  BLOCKING_DIAGNOSTIC_PREFIXES,
  BLOCKING_DIAGNOSTIC_CODES
};

  }));

  // Module: planning/member/member-planning-orchestrator
  moduleRegistry.set('planning/member/member-planning-orchestrator', (function() {
    var exports = {};
    var module = { exports: exports };
    var __require = function(id) {
      if (!moduleRegistry.has(id)) {
        throw new Error('Module non résolu: ' + id);
      }
      return moduleRegistry.get(id)();
    };
    
    /**
 * Member Planning Orchestrator - Orchestration de la planification par membre
 * 
 * Gère le partage de capacité entre toutes les affectations d'un même membre.
 * Contrairement au planning-engine.js qui traite une affectation isolément,
 * cet orchestrateur maintient un registre de capacité quotidien partagé.
 */
// Import des dépendances
var PlanningEngine = __require('planning/planning-engine');
var PlanningReconciliation = __require('planning/reconciliation/planning-reconciliation');
var CapacityService = __require('capacity/member-daily-capacity-service');

var toCentiHours = PlanningEngine.toCentiHours;
var toHours = PlanningEngine.toHours;
var formatDateUTC = PlanningEngine.formatDateUTC;
var parseDateUTC = PlanningEngine.parseDateUTC;
var addDaysUTC = PlanningEngine.addDaysUTC;
var generateDateRange = PlanningEngine.generateDateRange;
var reconcileDailyEntries = PlanningReconciliation.reconcileDailyEntries;
var buildDesiredMemberDailyCapacities = CapacityService.buildDesiredMemberDailyCapacities;
var reconcileMemberDailyCapacities = CapacityService.reconcileMemberDailyCapacities;
  
  // ===========================================================================
  // Helpers de date
  // ===========================================================================
  
  /**
   * Convertit un tableau colonnaire en lignes
   */
  function columnarToRows(data) {
    if (!data || !data.id || data.id.length === 0) {
      return [];
    }
    
    var cols = Object.keys(data);
    var n = data.id.length;
    var rows = [];
    
    for (var i = 0; i < n; i++) {
      var rec = {};
      for (var j = 0; j < cols.length; j++) {
        var col = cols[j];
        rec[col] = data[col][i];
      }
      rows.push(rec);
    }
    
    return rows;
  }
  
  /**
   * Convertit un timestamp Grist (secondes) en date YYYY-MM-DD
   */
  function gristTimestampToDate(timestamp) {
    if (!timestamp) return null;
    var date = new Date(timestamp * 1000);
    return formatDateUTC(date);
  }
  
  /**
   * Convertit une date YYYY-MM-DD en timestamp Grist
   */
  function dateToGristTimestamp(dateStr) {
    if (!dateStr) return null;
    var date = parseDateUTC(dateStr);
    if (!date) return null;
    return Math.floor(date.getTime() / 1000);
  }
  
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
      var date = new Date(value);
      if (!isNaN(date.getTime())) {
        return formatDateUTC(date);
      }
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      var date = new Date(value * 1000);
      if (!isNaN(date.getTime())) {
        return formatDateUTC(date);
      }
    }
    if (value instanceof Date) {
      return formatDateUTC(value);
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
    var date = parseDateUTC(value);
    if (!date) {
      return null;
    }
    return Math.floor(date.getTime() / 1000);
  }
  
  /**
   * Normalise un statut de feuille Grist vers le statut du domaine
   */
  function normalizeSheetStatus(status) {
    if (status === null || status === undefined || status === '') {
      return null;
    }
    var STATUS_MAPPING = {
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
  
  /**
   * Mappe une affectation Grist vers le format domaine
   */
  function assignmentToDomain(assignment) {
    return {
      id: assignment.id,
      taskId: assignment.tache,
      memberId: assignment.membre,
      allocatedHours: Number(assignment.heuresAllouees || 0),
      startDate: gristDateToIso(assignment.dateDebut),
      endDate: gristDateToIso(assignment.dateFin)
    };
  }
  
  /**
   * Codes de diagnostics bloquants
   */
  var BLOCKING_DIAGNOSTIC_PREFIXES = ['MISSING_', 'INVALID_', 'DUPLICATE_'];
  var BLOCKING_DIAGNOSTIC_CODES = ['PROTECTED_PLAN_EXCEEDS_ALLOCATION', 'OVERCONSUMPTION'];
  
  /**
   * Vérifie si un diagnostic est bloquant
   */
  function isBlockingDiagnostic(diagnostic) {
    var code = diagnostic.code || '';
    for (var i = 0; i < BLOCKING_DIAGNOSTIC_PREFIXES.length; i++) {
      if (code.startsWith(BLOCKING_DIAGNOSTIC_PREFIXES[i])) {
        return true;
      }
    }
    if (BLOCKING_DIAGNOSTIC_CODES.indexOf(code) >= 0) {
      return true;
    }
    return false;
  }
  
  /**
   * Trie les affectations dans un ordre déterministe
   */
  function sortAssignments(assignments) {
    return assignments.slice().sort(function(a, b) {
      // Date de fin croissante
      if (a.dateFin !== b.dateFin) {
        return (a.dateFin || 0) - (b.dateFin || 0);
      }
      // Date de début croissante
      if (a.dateDebut !== b.dateDebut) {
        return (a.dateDebut || 0) - (b.dateDebut || 0);
      }
      // Tâche croissante
      if (a.tache !== b.tache) {
        return (a.tache || 0) - (b.tache || 0);
      }
      // ID croissant
      return (a.id || 0) - (b.id || 0);
    });
  }
  
  // ===========================================================================
  // Registre de capacité quotidien
  // ===========================================================================
  
  /**
   * Crée un registre de capacité pour un membre
   * @param {Object} params - Paramètres
   * @returns {Object} Registre de capacité
   */
  function createCapacityRegistry(params) {
    var memberId = params.memberId;
    var capacities = params.capacities || [];
    var protectedHoursByDate = params.protectedHoursByDate || {};
    var dateFrom = params.dateFrom;
    var dateTo = params.dateTo;
    
    var registry = {};
    var dates = generateDateRange(dateFrom, dateTo);
    
    var capacityByDate = {};
    capacities.forEach(function(cap) {
      var dateKey = cap.date;
      if (!capacityByDate[dateKey]) {
        capacityByDate[dateKey] = [];
      }
      capacityByDate[dateKey].push(cap);
    });
    
    dates.forEach(function(date) {
      var capsForDate = capacityByDate[date] || [];
      
      // Capacité théorique (somme de toutes les capacités théoriques du jour)
      var baseCapacity = 0;
      capsForDate.forEach(function(cap) {
        baseCapacity += (cap.capaciteTheorique || 0);
      });
      
      // Capacité disponible (somme de toutes les capacités disponibles du jour)
      var availableCapacity = 0;
      capsForDate.forEach(function(cap) {
        availableCapacity += (cap.capaciteDisponible || 0);
      });
      
      var protectedHours = protectedHoursByDate[date] || 0;
      
      registry[date] = {
        memberId: memberId,
        date: date,
        baseCapacityHours: baseCapacity,
        availableCapacityHours: availableCapacity,
        protectedHours: protectedHours,
        remainingCapacityHours: availableCapacity - protectedHours,
        plannedHours: 0
      };
    });
    
    return {
      registry: registry,
      dates: dates,
      
      /**
       * Réserve des heures pour une affectation
       */
      reserveHours: function(date, hours) {
        if (!registry[date]) return false;
        
        var remaining = registry[date].remainingCapacityHours;
        if (remaining < hours) {
          return false;
        }
        
        registry[date].plannedHours += hours;
        registry[date].remainingCapacityHours -= hours;
        return true;
      },
      
      /**
       * Obtient la capacité restante pour une date
       */
      getRemainingCapacity: function(date) {
        if (!registry[date]) return 0;
        return registry[date].remainingCapacityHours;
      },
      
      /**
       * Obtient le registre complet
       */
      getRegistry: function() {
        return registry;
      },
      
      /**
       * Vérifie la postcondition : protégé + prévu <= disponible
       */
      verifyPostcondition: function(tolerance) {
        tolerance = tolerance || 0.01;
        var violations = [];
        
        dates.forEach(function(date) {
          var entry = registry[date];
          var total = entry.protectedHours + entry.plannedHours;
          
          if (total > entry.availableCapacityHours + tolerance) {
            violations.push({
              date: date,
              protected: entry.protectedHours,
              planned: entry.plannedHours,
              available: entry.availableCapacityHours,
              excess: total - entry.availableCapacityHours
            });
          }
        });
        
        return {
          valid: violations.length === 0,
          violations: violations
        };
      }
    };
  }
  
  // ===========================================================================
  // Orchestrateur principal
  // ===========================================================================
  
  /**
   * Crée un orchestrateur de planification par membre
   * @param {Object} grist - Grist API
   * @param {Object} options - Options
   * @returns {Object} API de l'orchestrateur
   */
  function createMemberPlanningOrchestrator(grist, options) {
    options = options || {};
    var logEnabled = options.logEnabled || false;
    
    function log(message) {
      if (logEnabled && console) {
        console.log('[MemberPlanningOrchestrator]', message);
      }
    }
    
    /**
     * Charge toutes les données nécessaires pour un membre
     */
    async function loadMemberData(memberId) {
      var tables = await Promise.all([
        grist.docApi.fetchTable('Team'),
        grist.docApi.fetchTable('TaskAssignments'),
        grist.docApi.fetchTable('Tasks'),
        grist.docApi.fetchTable('TimeEntries'),
        grist.docApi.fetchTable('Feuilles'),
        grist.docApi.fetchTable('Disponibilites'),
        grist.docApi.fetchTable('MemberDailyCapacities')
      ]);
      
      var teamTable = tables[0];
      var assignmentsTable = tables[1];
      var tasksTable = tables[2];
      var timeEntriesTable = tables[3];
      var feuillesTable = tables[4];
      var disponibilitesTable = tables[5];
      var capacitiesTable = tables[6];
      
      var member = null;
      if (teamTable.id) {
        for (var i = 0; i < teamTable.id.length; i++) {
          if (teamTable.id[i] === memberId) {
            member = {
              id: teamTable.id[i],
              nom: teamTable.nom ? teamTable.nom[i] : '',
              capaciteHebdo: teamTable.capaciteHebdo ? teamTable.capaciteHebdo[i] : 35
            };
            break;
          }
        }
      }
      
      if (!member) {
        throw new Error('Membre ' + memberId + ' non trouvé');
      }
      
      // Charger les affectations actives du membre
      var assignments = [];
      if (assignmentsTable.id) {
        for (var j = 0; j < assignmentsTable.id.length; j++) {
          if (assignmentsTable.membre[j] === memberId && assignmentsTable.actif[j] !== false) {
            assignments.push({
              id: assignmentsTable.id[j],
              tache: assignmentsTable.tache[j],
              membre: assignmentsTable.membre[j],
              heuresAllouees: assignmentsTable.heuresAllouees[j] || 0,
              dateDebut: assignmentsTable.dateDebut[j],
              dateFin: assignmentsTable.dateFin[j],
              modeRepartition: assignmentsTable.modeRepartition[j] || 'uniforme'
            });
          }
        }
      }
      
      // Trier les affectations
      assignments = sortAssignments(assignments);
      
      // Charger les tâches liées
      var tasks = {};
      if (tasksTable.id) {
        for (var k = 0; k < tasksTable.id.length; k++) {
          tasks[tasksTable.id[k]] = {
            id: tasksTable.id[k],
            titre: tasksTable.titre[k],
            dateDebut: tasksTable.dateDebut[k],
            dateEcheance: tasksTable.dateEcheance[k]
          };
        }
      }
      
      // Indexer les feuilles par ID
      var feuillesById = {};
      if (feuillesTable.id) {
        for (var p = 0; p < feuillesTable.id.length; p++) {
          feuillesById[feuillesTable.id[p]] = {
            id: feuillesTable.id[p],
            membre: feuillesTable.membre[p],
            semaine: feuillesTable.semaine[p],
            statut: feuillesTable.statut[p]
          };
        }
      }
      
      // Charger les TimeEntries du membre - rattachés par affectation
      var timeEntries = [];
      if (timeEntriesTable.id) {
        for (var l = 0; l < timeEntriesTable.id.length; l++) {
          if (timeEntriesTable.membre[l] === memberId) {
            var feuilleId = timeEntriesTable.feuille[l];
            var feuille = feuilleId ? feuillesById[feuilleId] : null;
            var sheetStatus = feuille ? normalizeSheetStatus(feuille.statut) : null;
            
            // Normaliser au format domaine avec TOUS les champs nécessaires
            timeEntries.push({
              id: timeEntriesTable.id[l],
              assignmentId: timeEntriesTable.affectation[l] || null,
              taskId: timeEntriesTable.tache[l],
              memberId: timeEntriesTable.membre[l],
              date: gristDateToIso(timeEntriesTable.date[l]),
              plannedHours: Number(timeEntriesTable.heuresPrevues[l] || 0),
              actualHours: Number(timeEntriesTable.heures[l] || 0),
              feuille: timeEntriesTable.feuille[l] || null,
              sheetStatus: sheetStatus,
              baseCapacityHours: Number(timeEntriesTable.capaciteTheorique[l] || 0),
              availableCapacityHours: Number(timeEntriesTable.capaciteDisponible[l] || 0),
              capacityRecordId: timeEntriesTable.capaciteJour[l] || null,
              revisionPlan: Number(timeEntriesTable.revisionPlan[l] || 0),
              description: timeEntriesTable.description ? timeEntriesTable.description[l] : null,
              imputation: timeEntriesTable.imputation ? timeEntriesTable.imputation[l] : null
            });
          }
        }
      }
      
      // Charger les capacités du membre
      var capacities = [];
      if (capacitiesTable.id) {
        for (var m = 0; m < capacitiesTable.id.length; m++) {
          if (capacitiesTable.membre[m] === memberId) {
            capacities.push({
              id: capacitiesTable.id[m],
              membre: capacitiesTable.membre[m],
              date: gristDateToIso(capacitiesTable.date[m]),
              capaciteTheorique: Number(capacitiesTable.capaciteTheorique[m] || 0),
              disponibiliteRatio: Number(capacitiesTable.disponibiliteRatio[m] || 1),
              capaciteDisponible: Number(capacitiesTable.capaciteDisponible[m] || 0),
              absenceHeures: Number(capacitiesTable.absenceHeures[m] || 0),
              source: capacitiesTable.source[m] || 'calcul',
              revision: Number(capacitiesTable.revision[m] || 1)
            });
          }
        }
      }
      
      // Charger les indisponibilités
      var disponibilites = [];
      if (disponibilitesTable.id) {
        for (var n = 0; n < disponibilitesTable.id.length; n++) {
          if (disponibilitesTable.membre[n] === memberId) {
            disponibilites.push({
              id: disponibilitesTable.id[n],
              membre: disponibilitesTable.membre[n],
              type: disponibilitesTable.type[n],
              dateDebut: disponibilitesTable.dateDebut[n],
              dateFin: disponibilitesTable.dateFin[n],
              dispo: disponibilitesTable.dispo[n]
            });
          }
        }
      }
      
      return {
        member: member,
        assignments: assignments,
        tasks: tasks,
        timeEntries: timeEntries,
        capacities: capacities,
        disponibilites: disponibilites,
        feuilles: Object.keys(feuillesById).map(function(k) { return feuillesById[k]; })
      };
    }
    
    /**
     * Identifie les entrées protégées (verrouillées)
     * Critères :
     * - feuille soumise ou validée
     * - heures réalisées > 0
     * - historique avant historyCutoffDate (sans feuille et sans réalisé)
     */
    function identifyProtectedEntries(timeEntries, feuillesById, options) {
      options = options || {};
      var historyCutoffDate = options.historyCutoffDate;
      
      return timeEntries.filter(function(entry) {
        var isSubmitted = entry.sheetStatus === 'submitted';
        var isValidated = entry.sheetStatus === 'validated';
        var hasActualHours = entry.actualHours > 0;
        var isBeforeCutoff = historyCutoffDate && entry.date && entry.date < historyCutoffDate;
        
        // Feuille soumise ou validée
        if (isSubmitted || isValidated) {
          return true;
        }
        
        // Heures réalisées > 0
        if (hasActualHours) {
          return true;
        }
        
        // Historique avant historyCutoffDate (lignes sans feuille et sans réalisé)
        if (isBeforeCutoff && !entry.feuille) {
          return true;
        }
        
        return false;
      });
    }
    
    /**
     * Calcule la période de capacité utile
     * N'inclut QUE :
     * - les affectations actives actuelles
     * - les TimeEntries protégées (réalisé, soumis, validé, historique)
     * Exclut les TimeEntries mutables qui vont être supprimées
     */
    function calculateCapacityPeriod(assignments, protectedEntries) {
      if (!assignments || assignments.length === 0) {
        return null;
      }
      
      var minDate = null;
      var maxDate = null;
      
      // Bornes des affectations actives
      assignments.forEach(function(a) {
        if (a.dateDebut) {
          var start = gristDateToIso(a.dateDebut);
          if (start && (!minDate || start < minDate)) minDate = start;
        }
        if (a.dateFin) {
          var end = gristDateToIso(a.dateFin);
          if (end && (!maxDate || end > maxDate)) maxDate = end;
        }
      });
      
      // Extension pour les entrées protégées uniquement
      if (protectedEntries && protectedEntries.length > 0) {
        protectedEntries.forEach(function(e) {
          if (e.date) {
            var date = typeof e.date === 'string' ? e.date : gristDateToIso(e.date);
            if (date && (!minDate || date < minDate)) minDate = date;
            if (date && (!maxDate || date > maxDate)) maxDate = date;
          }
        });
      }
      
      if (!minDate || !maxDate) {
        return null;
      }
      
      return {
        dateFrom: minDate,
        dateTo: maxDate
      };
    }
    
    /**
     * Détermine la date de coupure historique (historyCutoffDate)
     * Par défaut : date du jour
     * Peut être injectée via options.todayIso pour les tests
     */
    function determineHistoryCutoffDate(options) {
      if (options && options.todayIso) {
        return options.todayIso;
      }
      var today = new Date();
      return formatDateUTC(today);
    }
    
    /**
     * Détermine la date de début de distribution pour une affectation
     * max(historyCutoffDate, assignment.startDate)
     */
    function determineDistributionStartDate(assignment, historyCutoffDate) {
      var assignmentStartDate = gristDateToIso(assignment.dateDebut);
      
      if (!historyCutoffDate) {
        return assignmentStartDate;
      }
      
      if (!assignmentStartDate) {
        return historyCutoffDate;
      }
      
      return assignmentStartDate > historyCutoffDate ? assignmentStartDate : historyCutoffDate;
    }
    
    /**
     * Identifie les entrées protégées (verrouillées)
     * Critères :
     * - feuille soumise ou validée
     * - heures réalisées > 0
     * - historique avant historyCutoffDate (sans feuille et sans réalisé)
     */
    function identifyProtectedEntries(timeEntries, feuillesById, options) {
      options = options || {};
      var historyCutoffDate = options.historyCutoffDate;
      
      return timeEntries.filter(function(entry) {
        var isSubmitted = entry.sheetStatus === 'submitted';
        var isValidated = entry.sheetStatus === 'validated';
        var hasActualHours = entry.actualHours > 0;
        var isBeforeCutoff = historyCutoffDate && entry.date && entry.date < historyCutoffDate;
        
        // Feuille soumise ou validée
        if (isSubmitted || isValidated) {
          return true;
        }
        
        // Heures réalisées > 0
        if (hasActualHours) {
          return true;
        }
        
        // Historique avant historyCutoffDate (lignes sans feuille et sans réalisé)
        if (isBeforeCutoff && !entry.feuille) {
          return true;
        }
        
        return false;
      });
    }
    
    /**
     * Calcule les heures protégées par date selon le statut
     */
    function calculateProtectedHoursByDate(protectedEntries) {
      var protectedHoursByDate = {};
      
      protectedEntries.forEach(function(entry) {
        if (!protectedHoursByDate[entry.date]) {
          protectedHoursByDate[entry.date] = 0;
        }
        
        // Feuille validée : protéger max(heuresPrevues, heures)
        if (entry.sheetStatus === 'validated') {
          protectedHoursByDate[entry.date] += Math.max(entry.plannedHours, entry.actualHours);
        }
        // Feuille soumise : protéger heuresPrevues
        else if (entry.sheetStatus === 'submitted') {
          protectedHoursByDate[entry.date] += entry.plannedHours;
        }
        // Ligne avec réalisé : protéger max(heuresPrevues, heures)
        else if (entry.actualHours > 0) {
          protectedHoursByDate[entry.date] += Math.max(entry.plannedHours, entry.actualHours);
        }
        // Historique avant replanFromDate : protéger heuresPrevues
        else {
          protectedHoursByDate[entry.date] += entry.plannedHours;
        }
      });
      
      return protectedHoursByDate;
    }
    
    /**
     * Preview de la planification pour un membre
     */
    async function previewMember(memberId, options) {
      options = options || {};
      
      try {
        log('Preview planification membre ' + memberId);
        
        var data;
        try {
          data = await loadMemberData(memberId);
        } catch (loadError) {
          log('Erreur loadMemberData: ' + loadError.message);
          throw loadError;
        }
        
        log('Données chargées: ' + data.assignments.length + ' affectations, ' + Object.keys(data.tasks).length + ' tâches');
        
        if (data.assignments.length === 0) {
          log('Aucune affectation pour le membre ' + memberId);
          return {
            success: true,
            memberId: memberId,
            assignmentResults: [],
            capacities: [],
            capacityActions: [],
            timeEntryActions: [],
            reconciliation: {
              creates: [],
              updates: [],
              deletes: [],
              conflicts: []
            },
            diagnostics: [],
            totals: {
              totalAllocatedHours: 0,
              totalPlannedHours: 0,
              totalUnplannedHours: 0,
              protectedHours: 0
            },
            canCommit: false,
            code: 'NO_ASSIGNMENTS',
            fingerprint: ''
          };
        }
        
        // 1. Déterminer historyCutoffDate (date du jour par défaut)
        var historyCutoffDate = determineHistoryCutoffDate(options);
        log('historyCutoffDate: ' + historyCutoffDate);
        
        // 2. Identifier les entrées protégées
        var feuillesById = {};
        data.feuilles.forEach(function(f) {
          feuillesById[f.id] = f;
        });
        
        var protectedEntries = identifyProtectedEntries(data.timeEntries, feuillesById, {
          historyCutoffDate: historyCutoffDate
        });
        
        log('Entrées protégées: ' + protectedEntries.length + ' sur ' + data.timeEntries.length + ' totales');
        
        // 3. Calculer la période de capacité utile (affectations actives + entrées protégées)
        var period = calculateCapacityPeriod(data.assignments, protectedEntries);
        
        if (!period) {
          log('Période invalide');
          return {
            success: false,
            code: 'INVALID_PERIOD'
          };
        }
        
        log('Période capacité: ' + period.dateFrom + ' → ' + period.dateTo);
        
        // 4. Générer les capacités désirées sur la période utile
        var capacityResult = null;
        if (period) {
          capacityResult = buildDesiredMemberDailyCapacities({
            memberId: memberId,
            weeklyCapacity: data.member.capaciteHebdo,
            availabilities: data.disponibilites,
            startDate: period.dateFrom,
            endDate: period.dateTo,
            defaultWeeklyCapacity: 35,
            source: 'calcul',
            revision: 1
          });
        }
        
        // 5. Réconcilier avec les capacités existantes
        var capacityActions = [];
        var capacitiesToUse = data.capacities;
        if (capacityResult && capacityResult.capacities) {
          var nowUnixSeconds = Math.floor(Date.now() / 1000);
          var capReconciliation = reconcileMemberDailyCapacities(
            data.capacities,
            capacityResult.capacities,
            { nowUnixSeconds: nowUnixSeconds, todayIso: historyCutoffDate }
          );
          
          for (var capI = 0; capI < capReconciliation.creates.length; capI++) {
            var capCreate = capReconciliation.creates[capI];
            capacityActions.push(['AddRecord', 'MemberDailyCapacities', null, capCreate]);
          }
          for (var capJ = 0; capJ < capReconciliation.updates.length; capJ++) {
            var capUpdate = capReconciliation.updates[capJ];
            capacityActions.push(['UpdateRecord', 'MemberDailyCapacities', capUpdate.id, capUpdate.fields]);
          }
          
          // Utiliser les capacités réconciliées
          var reconciledCapacities = [];
          data.capacities.forEach(function(cap) {
            reconciledCapacities.push(cap);
          });
          capReconciliation.creates.forEach(function(cap) {
            reconciledCapacities.push({
              id: null,
              membre: cap.membre,
              date: typeof cap.date === 'number' ? formatDateUTC(new Date(cap.date * 1000)) : cap.date,
              capaciteTheorique: cap.capaciteTheorique,
              capaciteDisponible: cap.capaciteDisponible
            });
          });
          capacitiesToUse = reconciledCapacities;
        }
        
        // 6. Calculer les heures protégées par date selon le statut
        var protectedHoursByDate = calculateProtectedHoursByDate(protectedEntries);
        
        // 7. Créer le registre de capacité avec les heures protégées correctes
        var registry = createCapacityRegistry({
          memberId: memberId,
          capacities: capacitiesToUse,
          protectedHoursByDate: protectedHoursByDate,
          dateFrom: period.dateFrom,
          dateTo: period.dateTo
        });
        
        log('Registre créé: ' + registry.dates.length + ' jours');
        
        // 6. Traiter chaque affectation dans l'ordre
        var assignmentResults = [];
        var allDiagnostics = [];
        var totalAllocated = 0;
        var totalPlanned = 0;
        var totalUnplanned = 0;
        var hasAssignmentFailure = false;
        
        log('Début traitement de ' + data.assignments.length + ' affectations...');
        
        for (var i = 0; i < data.assignments.length; i++) {
          var assignment = data.assignments[i];
          totalAllocated += assignment.heuresAllouees || 0;
          
          var task = data.tasks[assignment.tache];
          
          if (!task) {
            log('Tâche ' + assignment.tache + ' non trouvée, affectation échouée');
            assignmentResults.push({
              assignmentId: assignment.id,
              success: false,
              error: 'Tâche non trouvée',
              diagnostics: [{ code: 'TASK_NOT_FOUND', taskId: assignment.tache }],
              plannedEntries: [],
              summary: {
                allocatedHours: assignment.heuresAllouees || 0,
                unplannedHours: assignment.heuresAllouees || 0
              }
            });
            totalUnplanned += assignment.heuresAllouees || 0;
            allDiagnostics.push({ code: 'TASK_NOT_FOUND', taskId: assignment.tache, assignmentId: assignment.id });
            hasAssignmentFailure = true;
            continue;
          }
          
          log('Traitement affectation ' + assignment.id + ' (tâche ' + assignment.tache + ')');
          
          // Convertir l'affectation au format domaine
          var domainAssignment = assignmentToDomain(assignment);
          
          // Déterminer la date de début de distribution pour cette affectation
          var distributionStartDate = determineDistributionStartDate(assignment, historyCutoffDate);
          log('distributionStartDate pour affectation ' + assignment.id + ': ' + distributionStartDate);
          
          // Construire le tableau de capacités restantes pour le moteur
          var capacitiesArray = registry.dates.map(function(date) {
            var regEntry = registry.getRegistry()[date];
            return {
              date: date,
              baseCapacityHours: regEntry.baseCapacityHours,
              availableCapacityHours: regEntry.remainingCapacityHours
            };
          });
          
          // Filtrer les TimeEntries pour cette affectation uniquement
          var entriesForAssignment = data.timeEntries.filter(function(e) {
            return e.assignmentId === assignment.id;
          });
          
          // Appeler le moteur de planification avec distributionStartDate
          var planningResult = PlanningEngine.buildAssignmentPlan({
            assignment: domainAssignment,
            capacities: capacitiesArray,
            existingEntries: entriesForAssignment,
            replanFromDate: distributionStartDate,
            precisionHours: 0.01,
            capacityPolicy: 'cap'
          });
          
          // Vérifier les diagnostics bloquants
          var hasBlockingDiagnostic = false;
          for (var j = 0; j < planningResult.diagnostics.length; j++) {
            if (isBlockingDiagnostic(planningResult.diagnostics[j])) {
              hasBlockingDiagnostic = true;
              break;
            }
          }
          
          if (hasBlockingDiagnostic) {
            log('Diagnostic bloquant pour affectation ' + assignment.id);
            assignmentResults.push({
              assignmentId: assignment.id,
              success: false,
              error: 'Diagnostic bloquant',
              diagnostics: planningResult.diagnostics,
              plannedEntries: [],
              summary: planningResult.summary
            });
            totalUnplanned += planningResult.summary.unplannedHours || 0;
            allDiagnostics = allDiagnostics.concat(planningResult.diagnostics);
            hasAssignmentFailure = true;
            continue;
          }
          
          // Réserver les heures dans le registre
          var plannedEntries = planningResult.desiredPlan || [];
          var reservationFailed = false;
          for (var k = 0; k < plannedEntries.length; k++) {
            var entry = plannedEntries[k];
            if (!registry.reserveHours(entry.date, entry.plannedHours)) {
              reservationFailed = true;
              break;
            }
          }
          
          if (reservationFailed) {
            log('Échec réservation pour affectation ' + assignment.id);
            assignmentResults.push({
              assignmentId: assignment.id,
              success: false,
              error: 'Capacité insuffisante',
              diagnostics: [{ code: 'INSUFFICIENT_CAPACITY', assignmentId: assignment.id }],
              plannedEntries: [],
              summary: planningResult.summary
            });
            totalUnplanned += planningResult.summary.unplannedHours || 0;
            allDiagnostics = allDiagnostics.concat(planningResult.diagnostics);
            hasAssignmentFailure = true;
            continue;
          }
          
          assignmentResults.push({
            assignmentId: assignment.id,
            success: true,
            plannedEntries: plannedEntries,
            diagnostics: planningResult.diagnostics || [],
            summary: planningResult.summary
          });
          
          allDiagnostics = allDiagnostics.concat(planningResult.diagnostics || []);
          totalUnplanned += planningResult.summary.unplannedHours || 0;
        }
        
        // 7. Vérifier la postcondition
        var postconditionCheck = registry.verifyPostcondition();
        
        if (!postconditionCheck.valid) {
          log('Violation postcondition: ' + JSON.stringify(postconditionCheck.violations));
          return {
            success: false,
            code: 'CAPACITY_OVERCOMMITMENT',
            violations: postconditionCheck.violations
          };
        }
        
        // 8. Réconciliation globale
        // Créer un index des capacités par date pour le lien capaciteJour
        var capacityIdByDate = {};
        capacitiesToUse.forEach(function(cap) {
          if (cap.id) {
            capacityIdByDate[cap.date] = cap.id;
          }
        });
        
        // Filtrer les entrées existantes pour la réconciliation
        // Inclure TOUTES les entrées mutables
        // Exclure uniquement les lignes vraiment protégées
        var entriesForReconciliation = data.timeEntries.filter(function(e) {
          var hasActualHours = Number(e.actualHours || 0) > 0;
          var isSubmitted = e.sheetStatus === 'submitted';
          var isValidated = e.sheetStatus === 'validated';
          var hasFeuille = e.feuille != null && e.feuille !== '';
          
          // Lignes protégées (exclues de la réconciliation)
          if (isSubmitted || isValidated) {
            return false;
          }
          
          // Lignes avec réalisé (protégées)
          if (hasActualHours) {
            return false;
          }
          
          // Lignes avec feuille brouillon : à exclure car l'utilisateur travaille dessus
          if (hasFeuille && e.sheetStatus === 'draft') {
            return false;
          }
          
          // Lignes historiques avant historyCutoffDate (sans feuille et sans réalisé)
          if (e.date && e.date < historyCutoffDate && !hasFeuille) {
            return false;
          }
          
          // Toutes les autres lignes sont mutables et doivent être réconciliées
          return true;
        });
        
        log('Réconciliation: ' + entriesForReconciliation.length + ' entrées mutables sur ' + data.timeEntries.length + ' totales');
        
        var allDesiredEntries = [];
        assignmentResults.forEach(function(result) {
          if (result.plannedEntries && result.success) {
            result.plannedEntries.forEach(function(entry) {
              allDesiredEntries.push({
                assignmentId: result.assignmentId,
                taskId: entry.taskId,
                memberId: memberId,
                date: entry.date,
                plannedHours: entry.plannedHours,
                baseCapacityHours: entry.baseCapacityHours,
                availableCapacityHours: entry.availableCapacityHours,
                capacityRecordId: capacityIdByDate[entry.date] || null
              });
            });
          }
        });
        
        var reconciliation = reconcileDailyEntries(entriesForReconciliation, allDesiredEntries, {
          precisionHours: 0.01
        });
        
        // 9. Convertir la réconciliation en actions Grist
        var existingEntriesMap = new Map();
        data.timeEntries.forEach(function(e) {
          existingEntriesMap.set(e.id, e);
        });
        var actions = reconciliationToActions(reconciliation, memberId, existingEntriesMap);
        
        // 10. Calculer les totaux depuis le registre
        totalPlanned = 0;
        var totalProtectedHours = 0;
        Object.keys(registry.getRegistry()).forEach(function(date) {
          var regEntry = registry.getRegistry()[date];
          totalPlanned += regEntry.plannedHours;
          totalProtectedHours += regEntry.protectedHours;
        });
        
        // 11. Générer le fingerprint
        var fingerprint = generateFingerprint(data, registry);
        
        log('Preview terminé: ' + totalPlanned + 'h planifiées sur ' + totalAllocated + 'h allouées');
        
        var hasUnplanned = totalUnplanned > 0;
        var hasFailure = hasAssignmentFailure || hasUnplanned;
        
        // Log détaillé pour débogage
        if (hasUnplanned) {
          log('Heures non planifiées: ' + totalUnplanned + 'h');
          assignmentResults.forEach(function(result) {
            if (result.summary && result.summary.unplannedHours > 0) {
              log('  Affectation ' + result.assignmentId + ': ' + result.summary.unplannedHours + 'h non planifiées');
            }
          });
        }
        
        log('Détails du preview: ' + JSON.stringify({
          timeEntryActions: (actions.timeEntryActions || []).length,
          capacityActions: capacityActions.length,
          totalAllocated: totalAllocated,
          totalPlanned: totalPlanned,
          totalUnplanned: totalUnplanned,
          canCommit: !hasFailure || options.allowPartialPlanning === true
        }));
        
        return {
          success: !hasAssignmentFailure,
          memberId: memberId,
          assignmentResults: assignmentResults,
          capacities: Object.keys(registry.getRegistry()).map(function(date) {
            return registry.getRegistry()[date];
          }),
          capacityActions: capacityActions,
          timeEntryActions: actions.timeEntryActions,
          reconciliation: reconciliation,
          diagnostics: allDiagnostics,
          totals: {
            totalAllocatedHours: totalAllocated,
            totalPlannedHours: totalPlanned,
            totalUnplannedHours: totalUnplanned,
            protectedHours: totalProtectedHours
          },
          fingerprint: fingerprint,
          canCommit: !hasFailure || options.allowPartialPlanning === true,
          code: hasAssignmentFailure ? 'ASSIGNMENT_PLANNING_FAILED' : (hasUnplanned ? 'INSUFFICIENT_SHARED_CAPACITY' : 'SUCCESS'),
          historyCutoffDate: historyCutoffDate,
          capacityPeriod: period
        };
        
      } catch (e) {
        log('Erreur preview: ' + e.message);
        return {
          success: false,
          code: 'PREVIEW_ERROR',
          message: e.message
        };
      }
    }
    
    /**
     * Génère un fingerprint pour détecter les changements
     */
    function generateFingerprint(data, registry) {
      var parts = [
        data.member.capaciteHebdo,
        data.assignments.length,
        data.timeEntries.length,
        data.capacities.length
      ];
      
      return parts.join('|');
    }
    
    /**
     * Convertit un diff de réconciliation en actions Grist
     */
    function reconciliationToActions(reconciliation, memberId, existingEntriesMap) {
      var capacityActions = [];
      var timeEntryActions = [];
      
      // Créations de TimeEntries
      if (reconciliation.creates && reconciliation.creates.length > 0) {
        for (var i = 0; i < reconciliation.creates.length; i++) {
          var create = reconciliation.creates[i];
          timeEntryActions.push([
            'AddRecord',
            'TimeEntries',
            null,
            {
              affectation: create.assignmentId,
              tache: create.taskId,
              membre: create.memberId,
              date: isoToGristDate(create.date),
              heuresPrevues: create.plannedHours,
              heures: 0,
              capaciteTheorique: create.baseCapacityHours || 0,
              capaciteDisponible: create.availableCapacityHours || 0,
              capaciteJour: create.capacityRecordId,
              revisionPlan: 1,
              description: null,
              imputation: null
            }
          ]);
        }
      }
      
      // Mises à jour de TimeEntries
      if (reconciliation.updates && reconciliation.updates.length > 0) {
        for (var j = 0; j < reconciliation.updates.length; j++) {
          var update = reconciliation.updates[j];
          var fields = {};
          
          if (update.fields.plannedHours !== undefined) {
            fields.heuresPrevues = update.fields.plannedHours;
          }
          if (update.fields.baseCapacityHours !== undefined) {
            fields.capaciteTheorique = update.fields.baseCapacityHours;
          }
          if (update.fields.availableCapacityHours !== undefined) {
            fields.capaciteDisponible = update.fields.availableCapacityHours;
          }
          if (update.fields.capacityRecordId !== undefined) {
            fields.capaciteJour = update.fields.capacityRecordId;
          }
          
          if (Object.keys(fields).length > 0) {
            // Utiliser la revisionPlan déjà calculée par la réconciliation
            if (update.fields.revisionPlan !== undefined) {
              fields.revisionPlan = update.fields.revisionPlan;
            }
            timeEntryActions.push([
              'UpdateRecord',
              'TimeEntries',
              update.id,
              fields
            ]);
          }
        }
      }
      
      // Suppressions de TimeEntries
      if (reconciliation.deletes && reconciliation.deletes.length > 0) {
        for (var k = 0; k < reconciliation.deletes.length; k++) {
          var del = reconciliation.deletes[k];
          timeEntryActions.push([
            'RemoveRecord',
            'TimeEntries',
            del.id
          ]);
        }
      }
      
      return {
        capacityActions: capacityActions,
        timeEntryActions: timeEntryActions
      };
    }
    
    /**
     * Commit de la planification pour un membre - Version multi-phase
     * Phase 1 : Upsert des capacités
     * Phase 2 : Rechargement et nouveau preview
     * Phase 3 : Mutation des TimeEntries avec vrais IDs de capacité
     * Phase 4 : Nettoyage sûr des capacités (optionnel)
     */
    async function commitMember(memberId, preview, options) {
      options = options || {};
      
      try {
        log('Commit planification membre ' + memberId + ' (multi-phase)');
        
        if (!preview || !preview.success) {
          return {
            success: false,
            code: 'INVALID_PREVIEW'
          };
        }
        
        // Récupérer historyCutoffDate du preview ou le recalculer
        var historyCutoffDate = preview.historyCutoffDate || determineHistoryCutoffDate(options);
        
        // Vérifier canCommit
        if (!preview.canCommit) {
          return {
            success: false,
            code: preview.code || 'CANNOT_COMMIT',
            message: 'Le preview indique que le commit n\'est pas autorisé'
          };
        }
        
        // Vérifier le fingerprint (optionnel)
        if (options.expectedFingerprint && preview.fingerprint !== options.expectedFingerprint) {
          return {
            success: false,
            code: 'STALE_PREVIEW',
            message: 'Le preview est obsolète'
          };
        }
        
        var phases = {
          capacityUpsert: { actionsExecuted: 0 },
          timeEntryReconciliation: { actionsExecuted: 0 },
          capacityCleanup: { actionsExecuted: 0 }
        };
        
        // =========================================================================
        // PHASE 1 : Upsert des capacités
        // =========================================================================
        log('PHASE 1 : Upsert des capacités (' + preview.capacityActions.length + ' actions)');
        
        if (preview.capacityActions.length > 0) {
          var capacityResult = await grist.docApi.applyUserActions(preview.capacityActions);
          phases.capacityUpsert.actionsExecuted = preview.capacityActions.length;
          log('Phase 1 terminée : ' + preview.capacityActions.length + ' capacités créées/mises à jour');
        } else {
          log('Phase 1 : aucune action de capacité');
        }
        
        // =========================================================================
        // PHASE 2 : Rechargement et reconstruction de l'index capaciteJour
        // =========================================================================
        log('PHASE 2 : Rechargement des capacités et recalcul des références');
        
        // Recharger MemberDailyCapacities pour obtenir les vrais IDs
        var capacitiesTable = await grist.docApi.fetchTable('MemberDailyCapacities');
        var capacityIdByDate = {};
        
        if (capacitiesTable.id) {
          for (var capI = 0; capI < capacitiesTable.id.length; capI++) {
            if (capacitiesTable.membre[capI] === memberId) {
              var capDate = typeof capacitiesTable.date[capI] === 'number'
                ? formatDateUTC(new Date(capacitiesTable.date[capI] * 1000))
                : capacitiesTable.date[capI];
              capacityIdByDate[capDate] = capacitiesTable.id[capI];
            }
          }
        }
        
        log('Capacités rechargées : ' + Object.keys(capacityIdByDate).length + ' dates indexées');
        
        // Reconstruire les actions TimeEntries avec les vrais IDs
        var correctedTimeEntryActions = [];
        
        if (preview.reconciliation && preview.reconciliation.creates) {
          for (var i = 0; i < preview.reconciliation.creates.length; i++) {
            var create = preview.reconciliation.creates[i];
            var date = create.date;
            var capacityId = capacityIdByDate[date] || null;
            
            if (!capacityId) {
              log('Avertissement : pas de capacité trouvée pour la date ' + date + ', création différée');
              // On passe cette création pour l'instant
              continue;
            }
            
            correctedTimeEntryActions.push([
              'AddRecord',
              'TimeEntries',
              null,
              {
                affectation: create.assignmentId,
                tache: create.taskId,
                membre: create.memberId,
                date: isoToGristDate(date),
                heuresPrevues: create.plannedHours,
                heures: 0,
                capaciteTheorique: create.baseCapacityHours || 0,
                capaciteDisponible: create.availableCapacityHours || 0,
                capaciteJour: capacityId,
                revisionPlan: 1,
                description: null,
                imputation: null
              }
            ]);
          }
        }
        
        // Mises à jour (inchangées)
        if (preview.reconciliation && preview.reconciliation.updates) {
          for (var j = 0; j < preview.reconciliation.updates.length; j++) {
            var update = preview.reconciliation.updates[j];
            var fields = {};
            
            if (update.fields.plannedHours !== undefined) {
              fields.heuresPrevues = update.fields.plannedHours;
            }
            if (update.fields.baseCapacityHours !== undefined) {
              fields.capaciteTheorique = update.fields.baseCapacityHours;
            }
            if (update.fields.availableCapacityHours !== undefined) {
              fields.capaciteDisponible = update.fields.availableCapacityHours;
            }
            if (update.fields.capacityRecordId !== undefined) {
              // Mettre à jour avec le vrai ID si disponible
              var updateDate = update.date;
              var updateCapacityId = capacityIdByDate[updateDate] || update.fields.capacityRecordId;
              fields.capaciteJour = updateCapacityId;
            }
            
            if (Object.keys(fields).length > 0) {
              if (update.fields.revisionPlan !== undefined) {
                fields.revisionPlan = update.fields.revisionPlan;
              }
              correctedTimeEntryActions.push([
                'UpdateRecord',
                'TimeEntries',
                update.id,
                fields
              ]);
            }
          }
        }
        
        // Suppressions (inchangées)
        if (preview.reconciliation && preview.reconciliation.deletes) {
          for (var k = 0; k < preview.reconciliation.deletes.length; k++) {
            var del = preview.reconciliation.deletes[k];
            correctedTimeEntryActions.push([
              'RemoveRecord',
              'TimeEntries',
              del.id
            ]);
          }
        }
        
        // =========================================================================
        // PHASE 3 : Mutation des TimeEntries
        // =========================================================================
        log('PHASE 3 : Mutation des TimeEntries (' + correctedTimeEntryActions.length + ' actions)');
        
        if (correctedTimeEntryActions.length > 0) {
          var timeEntryResult = await grist.docApi.applyUserActions(correctedTimeEntryActions);
          phases.timeEntryReconciliation.actionsExecuted = correctedTimeEntryActions.length;
          log('Phase 3 terminée : ' + correctedTimeEntryActions.length + ' TimeEntries créées/mises à jour/supprimées');
        } else {
          log('Phase 3 : aucune action TimeEntry');
        }
        
        // =========================================================================
        // PHASE 4 : Nettoyage sûr des capacités obsolètes
        // =========================================================================
        log('PHASE 4 : Nettoyage des capacités obsolètes');
        
        var cleanupActions = await buildCapacityCleanupActions(memberId, historyCutoffDate);
        
        if (cleanupActions.length > 0) {
          log('Nettoyage de ' + cleanupActions.length + ' capacités obsolètes');
          await grist.docApi.applyUserActions(cleanupActions);
          phases.capacityCleanup.actionsExecuted = cleanupActions.length;
          log('Phase 4 terminée : ' + cleanupActions.length + ' capacités supprimées');
        } else {
          log('Phase 4 : aucune capacité à nettoyer');
        }
        
        // =========================================================================
        // Résultat final
        // =========================================================================
        var totalActions = phases.capacityUpsert.actionsExecuted + 
                          phases.timeEntryReconciliation.actionsExecuted + 
                          phases.capacityCleanup.actionsExecuted;
        
        log('Commit terminé : ' + totalActions + ' actions totales');
        
        return {
          success: true,
          memberId: memberId,
          phases: phases,
          totalActionsExecuted: totalActions,
          code: 'SUCCESS'
        };
        
      } catch (e) {
        log('Erreur commit: ' + e.message);
        return {
          success: false,
          code: 'COMMIT_ERROR',
          message: e.message,
          phases: phases
        };
      }
    }
    
    /**
     * Construit les actions de nettoyage des capacités obsolètes
     * @param {number} memberId - ID du membre
     * @param {string} historyCutoffDate - Date de coupure historique
     * @returns {Promise<Array>} Actions de suppression
     */
    async function buildCapacityCleanupActions(memberId, historyCutoffDate) {
      // Charger les données nécessaires
      var tables = await Promise.all([
        grist.docApi.fetchTable('TaskAssignments'),
        grist.docApi.fetchTable('TimeEntries'),
        grist.docApi.fetchTable('MemberDailyCapacities')
      ]);
      
      var assignmentsTable = tables[0];
      var timeEntriesTable = tables[1];
      var capacitiesTable = tables[2];
      
      // Filtrer les affectations actives du membre
      var assignments = [];
      if (assignmentsTable.id) {
        for (var i = 0; i < assignmentsTable.id.length; i++) {
          if (assignmentsTable.membre[i] === memberId && assignmentsTable.actif[i] !== false) {
            assignments.push({
              id: assignmentsTable.id[i],
              tache: assignmentsTable.tache[i],
              membre: assignmentsTable.membre[i],
              dateDebut: assignmentsTable.dateDebut[i],
              dateFin: assignmentsTable.dateFin[i]
            });
          }
        }
      }
      
      // Filtrer les TimeEntries du membre
      var timeEntries = [];
      if (timeEntriesTable.id) {
        for (var j = 0; j < timeEntriesTable.id.length; j++) {
          if (timeEntriesTable.membre[j] === memberId) {
            timeEntries.push({
              id: timeEntriesTable.id[j],
              affectation: timeEntriesTable.affectation[j],
              date: timeEntriesTable.date[j],
              capaciteJour: timeEntriesTable.capaciteJour[j]
            });
          }
        }
      }
      
      // Filtrer les capacités du membre
      var capacities = [];
      if (capacitiesTable.id) {
        for (var k = 0; k < capacitiesTable.id.length; k++) {
          if (capacitiesTable.membre[k] === memberId) {
            capacities.push({
              id: capacitiesTable.id[k],
              membre: capacitiesTable.membre[k],
              date: capacitiesTable.date[k],
              source: capacitiesTable.source[k]
            });
          }
        }
      }
      
      // Construire l'ensemble des dates utiles
      var usefulDates = new Set();
      
      // Dates des affectations actives
      assignments.forEach(function(assignment) {
        var start = gristDateToIso(assignment.dateDebut);
        var end = gristDateToIso(assignment.dateFin);
        
        if (start && end) {
          var dates = generateDateRange(start, end);
          dates.forEach(function(date) {
            usefulDates.add(date);
          });
        }
      });
      
      // Dates des TimeEntries
      timeEntries.forEach(function(entry) {
        var date = gristDateToIso(entry.date);
        if (date) {
          usefulDates.add(date);
        }
      });
      
      // IDs de capacité référencés par les TimeEntries
      var referencedCapacityIds = new Set();
      timeEntries.forEach(function(entry) {
        var capId = Number(entry.capaciteJour);
        if (capId) {
          referencedCapacityIds.add(capId);
        }
      });
      
      // Filtrer les capacités supprimables
      var cleanupActions = [];
      
      capacities.forEach(function(capacity) {
        var date = gristDateToIso(capacity.date);
        var source = String(capacity.source || '').toLowerCase();
        
        // Critères de suppression :
        // 1. source = 'calcul' (pas manuel, pas Lucca)
        // 2. date >= historyCutoffDate (pas historique)
        // 3. date absente des dates utiles
        // 4. ID absent des capacités référencées
        var isCalculated = source === 'calcul';
        var isNotHistorical = date && date >= historyCutoffDate;
        var isNotUseful = date && !usefulDates.has(date);
        var isNotReferenced = !referencedCapacityIds.has(Number(capacity.id));
        
        if (isCalculated && isNotHistorical && isNotUseful && isNotReferenced) {
          cleanupActions.push([
            'RemoveRecord',
            'MemberDailyCapacities',
            capacity.id
          ]);
        }
      });
      
      return cleanupActions;
    }
    
    /**
     * Commit des actions de capacité uniquement (sans le planning)
     * Utile lorsque le planning est bloqué mais qu'on veut quand même enregistrer les capacités
     */
    async function commitCapacityActions(preview) {
      var actions = preview && preview.capacityActions ? preview.capacityActions : [];
      
      if (!actions.length) {
        log('Aucune action de capacité à appliquer');
        return {
          success: true,
          actionsExecuted: 0
        };
      }
      
      log('Application de ' + actions.length + ' actions de capacité...');
      
      try {
        var result = await grist.docApi.applyUserActions(actions);
        log('Commit capacité terminé: ' + actions.length + ' actions');
        
        return {
          success: true,
          actionsExecuted: actions.length,
          result: result
        };
      } catch (e) {
        log('Erreur commit capacité: ' + e.message);
        return {
          success: false,
          code: 'CAPACITY_COMMIT_ERROR',
          message: e.message
        };
      }
    }
    
    /**
     * Replanifie plusieurs membres
     */
    async function replanMembers(memberIds, options) {
      options = options || {};
      
      log('Replanification de ' + memberIds.length + ' membres');
      
      var results = [];
      
      for (var i = 0; i < memberIds.length; i++) {
        var memberId = memberIds[i];
        
        var preview = await previewMember(memberId, options);
        
        if (!preview.success || !preview.canCommit) {
          results.push({
            memberId: memberId,
            success: false,
            code: preview.code
          });
          continue;
        }
        
        var commitResult = await commitMember(memberId, preview, options);
        
        results.push({
          memberId: memberId,
          success: commitResult.success,
          actionsExecuted: commitResult.actionsExecuted
        });
      }
      
      return {
        success: results.every(function(r) { return r.success; }),
        results: results
      };
    }
    
    /**
     * Replanifie une tâche (tous ses assignés)
     */
    async function replanTask(taskId, options) {
      options = options || {};
      
      log('Replanification tâche ' + taskId);
      
      var assignmentsData = await grist.docApi.fetchTable('TaskAssignments');
      var taskAssignments = [];
      
      if (assignmentsData.id) {
        for (var i = 0; i < assignmentsData.id.length; i++) {
          if (assignmentsData.tache[i] === taskId && assignmentsData.actif[i] !== false) {
            taskAssignments.push({
              id: assignmentsData.id[i],
              tache: assignmentsData.tache[i],
              membre: assignmentsData.membre[i]
            });
          }
        }
      }
      
      var memberIds = [];
      taskAssignments.forEach(function(a) {
        if (memberIds.indexOf(a.membre) < 0) {
          memberIds.push(a.membre);
        }
      });
      
      return await replanMembers(memberIds, options);
    }
    
    /**
     * Replanifie plusieurs tâches
     */
    async function replanTasks(taskIds, options) {
      options = options || {};
      
      log('Replanification de ' + taskIds.length + ' tâches');
      
      var assignmentsData = await grist.docApi.fetchTable('TaskAssignments');
      var taskAssignments = [];
      
      if (assignmentsData.id) {
        for (var i = 0; i < assignmentsData.id.length; i++) {
          if (taskIds.indexOf(assignmentsData.tache[i]) >= 0 && assignmentsData.actif[i] !== false) {
            taskAssignments.push({
              id: assignmentsData.id[i],
              tache: assignmentsData.tache[i],
              membre: assignmentsData.membre[i]
            });
          }
        }
      }
      
      var memberIds = [];
      taskAssignments.forEach(function(a) {
        if (memberIds.indexOf(a.membre) < 0) {
          memberIds.push(a.membre);
        }
      });
      
      return await replanMembers(memberIds, options);
    }
    
    // API publique
    return {
      previewMember: previewMember,
      commitMember: commitMember,
      commitCapacityActions: commitCapacityActions,
      replanMembers: replanMembers,
      replanTask: replanTask,
      replanTasks: replanTasks,
      loadMemberData: loadMemberData,
      createCapacityRegistry: createCapacityRegistry
    };
  }
  
  // Export CommonJS
  if (typeof module !== 'undefined' && module.exports) {
    return {
      createMemberPlanningOrchestrator: createMemberPlanningOrchestrator,
      createCapacityRegistry: createCapacityRegistry,
      sortAssignments: sortAssignments
    };
  }
  
  // Export pour le navigateur
  if (typeof window !== 'undefined') {
    window.createMemberPlanningOrchestrator = createMemberPlanningOrchestrator;
    window.createCapacityRegistry = createCapacityRegistry;
    window.sortAssignments = sortAssignments;
  }

  }));

  // Module: planning/gantt/gantt-auto-planning-integration
  moduleRegistry.set('planning/gantt/gantt-auto-planning-integration', (function() {
    var exports = {};
    var module = { exports: exports };
    var __require = function(id) {
      if (!moduleRegistry.has(id)) {
        throw new Error('Module non résolu: ' + id);
      }
      return moduleRegistry.get(id)();
    };
    
    /* ============================================================================
 * gantt-auto-planning-integration.js — Planification automatique après synchro
 * ----------------------------------------------------------------------------
 * Ce module déclenche la planification automatique après la synchronisation
 * des TaskAssignments depuis le Gantt.
 * 
 * API :
 *   createGanttAutoPlanningIntegration(grist, options)
 * 
 * Retourne un objet avec :
 *   - autoPlanMembersAfterTaskSync(options) : planifie les membres après synchro
 * ============================================================================ */

(function (global) {
/**
     * Crée l'intégration de planification automatique pour le Gantt
     */
    function createGanttAutoPlanningIntegration(grist, options) {
        options = options || {};
        var logEnabled = options.logEnabled || false;
        var planningApi = options.planningApi || null;

        function log(message) {
            if (logEnabled && typeof console !== 'undefined') {
                console.log('[GanttAutoPlanning]', message);
            }
        }

        /**
         * Normalise une affectation (accepte les deux formats : Grist et domaine)
         * @param {Object} a - Affectation
         * @returns {Object} Affectation normalisée
         */
        function normalizeAssignment(a) {
            return {
                id: a.id || null,
                membre: Number(a.membre ?? a.memberId) || null,
                actif: (a.actif ?? a.active) !== false,
                dateDebut: a.dateDebut ?? a.startDate ?? null,
                dateFin: a.dateFin ?? a.endDate ?? null,
                heuresAllouees: a.heuresAllouees ?? a.allocatedHours ?? 0,
                modeRepartition: a.modeRepartition ?? a.distributionMode ?? 'uniforme'
            };
        }

        /**
         * Détermine la date de début de replanification
         * @param {Object} assignment - Affectation (format Grist ou domaine)
         * @param {string} operation - 'create' | 'update'
         * @returns {string} Date YYYY-MM-DD
         */
        function determineReplanFromDate(assignment, operation) {
            var today = new Date();
            var todayStr = formatDateUTC(today);
            
            // Normaliser la date de début (accepte les deux formats)
            var rawStartDate = assignment.dateDebut ?? assignment.startDate;
            var startDate = rawStartDate ? formatDateUTC(new Date(rawStartDate * 1000)) : null;
            
            if (operation === 'create') {
                // Pour une création, commencer à la date de début de l'affectation
                return startDate || todayStr;
            } else {
                // Pour une modification, max(today, dateDebut)
                if (startDate && startDate > todayStr) {
                    return startDate;
                }
                return todayStr;
            }
        }

        /**
         * Formate une date UTC en YYYY-MM-DD
         */
        function formatDateUTC(date) {
            var year = date.getUTCFullYear();
            var month = String(date.getUTCMonth() + 1).padStart(2, '0');
            var day = String(date.getUTCDate()).padStart(2, '0');
            return year + '-' + month + '-' + day;
        }

        /**
         * Planifie automatiquement les membres après une synchronisation TaskAssignments
         * @param {Object} params - Paramètres
         * @param {number} params.taskId - ID de la tâche
         * @param {Array} params.assignments - Affectations synchronisées
         * @param {string} params.operation - 'create' | 'update' | 'delete'
         * @param {Function} [params.onStatus] - Callback de statut optionnel
         * @returns {Promise<Object>} Résultat de la planification
         */
        async function autoPlanMembersAfterTaskSync(params) {
            var taskId = params.taskId;
            var assignments = params.assignments || [];
            var operation = params.operation || 'update';
            var onStatus = params.onStatus || null;

            log('autoPlanMembersAfterTaskSync pour tâche ' + taskId + ' (' + operation + ')');

            // 1. Normaliser et filtrer les affectations actives
            var normalizedAssignments = assignments.map(normalizeAssignment);
            var activeAssignments = normalizedAssignments.filter(function(a) {
                return a.actif !== false && a.membre != null && a.membre > 0;
            });

            if (activeAssignments.length === 0) {
                log('Aucune affectation active à planifier');
                return {
                    success: true,
                    taskId: taskId,
                    members: [],
                    committedMemberIds: [],
                    blockedMemberIds: [],
                    failedMemberIds: [],
                    code: 'NO_ACTIVE_ASSIGNMENTS'
                };
            }

            // 2. Dédupliquer les membres
            var memberIds = [];
            var memberAssignments = {};
            activeAssignments.forEach(function(a) {
                var memberId = Number(a.membre);
                if (memberIds.indexOf(memberId) < 0) {
                    memberIds.push(memberId);
                    memberAssignments[memberId] = [];
                }
                memberAssignments[memberId].push(a);
            });

            log('Membres concernés : ' + memberIds.join(', '));

            // 3. Vérifier si l'orchestrateur est disponible
            var orchestratorFactory = null;
            
            // Essayer planningApi en premier, puis global.TaskFlowPlanning, puis global
            if (planningApi && planningApi.createMemberPlanningOrchestrator) {
                orchestratorFactory = planningApi.createMemberPlanningOrchestrator;
            } else if (global.TaskFlowPlanning && global.TaskFlowPlanning.createMemberPlanningOrchestrator) {
                orchestratorFactory = global.TaskFlowPlanning.createMemberPlanningOrchestrator;
            } else if (global.createMemberPlanningOrchestrator) {
                orchestratorFactory = global.createMemberPlanningOrchestrator;
            }

            if (!orchestratorFactory) {
                log('Orchestrateur non disponible');
                return {
                    success: false,
                    taskId: taskId,
                    members: [],
                    committedMemberIds: [],
                    blockedMemberIds: [],
                    failedMemberIds: [],
                    code: 'ORCHESTRATOR_NOT_AVAILABLE'
                };
            }

            // 4. Créer l'orchestrateur
            var orchestrator = orchestratorFactory(grist, {
                logEnabled: logEnabled
            });

            // 5. Planifier chaque membre
            var results = [];
            var committedMemberIds = [];
            var blockedMemberIds = [];
            var failedMemberIds = [];

            for (var i = 0; i < memberIds.length; i++) {
                var memberId = memberIds[i];
                var memberAssigns = memberAssignments[memberId];

                log('Traitement membre ' + memberId + ' (' + memberAssigns.length + ' affectations)');

                try {
                    // Déterminer la date de replanification
                    // Pour une modification, utiliser la date la plus proche parmi les affectations modifiées
                    var replanFromDate = null;
                    if (operation === 'update') {
                        // Pour chaque affectation du membre, prendre la plus ancienne date de début
                        for (var j = 0; j < memberAssigns.length; j++) {
                            var assignReplan = determineReplanFromDate(memberAssigns[j], operation);
                            if (!replanFromDate || assignReplan < replanFromDate) {
                                replanFromDate = assignReplan;
                            }
                        }
                    } else {
                        // Pour une création, utiliser la date de début de la première affectation
                        replanFromDate = determineReplanFromDate(memberAssigns[0], operation);
                    }

                    log('replanFromDate pour membre ' + memberId + ' : ' + replanFromDate);

                    // Preview de la planification
                    if (onStatus) {
                        onStatus({
                            phase: 'preview',
                            memberId: memberId,
                            replanFromDate: replanFromDate
                        });
                    }

                    var preview = await orchestrator.previewMember(memberId, {
                        replanFromDate: replanFromDate
                    });

                    log('Preview membre ' + memberId + ' : ' + JSON.stringify({
                        success: preview.success,
                        canCommit: preview.canCommit,
                        code: preview.code,
                        actionCount: (preview.timeEntryActions || []).length
                    }));

                    // Examiner le résultat
                    if (!preview.success) {
                        log('Preview échoué pour membre ' + memberId + ' : ' + preview.code);
                        results.push({
                            memberId: memberId,
                            status: 'failed',
                            code: preview.code,
                            diagnostics: preview.diagnostics || []
                        });
                        failedMemberIds.push(memberId);
                        continue;
                    }

                    if (!preview.canCommit) {
                        log('Preview non committable pour membre ' + memberId + ' : ' + preview.code);
                        
                        // IMPORTANT : Ne PAS committer les capacités quand le preview est bloqué
                        // Les capacités seront créées lors d'un futur preview committable
                        log('Aucune capacité écrite pour membre ' + memberId + ' (preview bloqué)');
                        
                        results.push({
                            memberId: memberId,
                            status: 'blocked',
                            code: preview.code,
                            diagnostics: preview.diagnostics || [],
                            actionCount: 0
                        });
                        blockedMemberIds.push(memberId);
                        continue;
                    }

                    // Vérifier si des actions sont nécessaires
                    var actionCount = (preview.timeEntryActions || []).length + (preview.capacityActions || []).length;
                    
                    if (actionCount === 0) {
                        log('Planning déjà conforme pour membre ' + memberId);
                        results.push({
                            memberId: memberId,
                            status: 'already-conformant',
                            code: preview.code,
                            actionCount: 0
                        });
                        continue;
                    }

                    // Commit de la planification
                    if (onStatus) {
                        onStatus({
                            phase: 'commit',
                            memberId: memberId,
                            actionCount: actionCount
                        });
                    }

                    var commitResult = await orchestrator.commitMember(memberId, preview);

                    if (commitResult.success) {
                        var executedActions = commitResult.totalActionsExecuted || 0;
                        log('Commit réussi pour membre ' + memberId + ' : ' + executedActions + ' actions');
                        results.push({
                            memberId: memberId,
                            status: 'committed',
                            actionCount: executedActions
                        });
                        committedMemberIds.push(memberId);
                    } else {
                        log('Commit échoué pour membre ' + memberId + ' : ' + commitResult.code);
                        results.push({
                            memberId: memberId,
                            status: 'failed',
                            code: commitResult.code,
                            diagnostics: []
                        });
                        failedMemberIds.push(memberId);
                    }

                } catch (e) {
                    log('Erreur traitement membre ' + memberId + ' : ' + e.message);
                    results.push({
                        memberId: memberId,
                        status: 'failed',
                        error: e.message,
                        diagnostics: []
                    });
                    failedMemberIds.push(memberId);
                }
            }

            // 6. Retourner le résultat global
            var allSuccess = failedMemberIds.length === 0 && blockedMemberIds.length === 0;
            var hasCommitted = committedMemberIds.length > 0;
            var hasBlocked = blockedMemberIds.length > 0;
            var hasFailed = failedMemberIds.length > 0;
            var hasAlreadyConformant = results.some(function(r) { return r.status === 'already-conformant'; });

            log('Résultat global : ' + JSON.stringify({
                success: allSuccess,
                committed: committedMemberIds.length,
                blocked: blockedMemberIds.length,
                failed: failedMemberIds.length,
                alreadyConformant: results.filter(function(r) { return r.status === 'already-conformant'; }).length
            }));

            // Déterminer le code de statut correct
            var code;
            if (hasFailed) {
                code = hasCommitted ? 'PARTIAL_FAILURE' : 'COMMIT_FAILED';
            } else if (hasBlocked) {
                code = hasCommitted ? 'PARTIAL_BLOCKED' : 'BLOCKED';
            } else if (hasCommitted) {
                code = 'SUCCESS';
            } else if (hasAlreadyConformant) {
                code = 'ALREADY_CONFORMANT';
            } else {
                code = 'NO_ACTIVE_ASSIGNMENTS';
            }

            return {
                success: allSuccess,
                taskId: taskId,
                members: results,
                committedMemberIds: committedMemberIds,
                blockedMemberIds: blockedMemberIds,
                failedMemberIds: failedMemberIds,
                code: code,
                summary: {
                    totalMembers: memberIds.length,
                    committed: committedMemberIds.length,
                    blocked: blockedMemberIds.length,
                    failed: failedMemberIds.length,
                    alreadyConformant: results.filter(function(r) { return r.status === 'already-conformant'; }).length
                }
            };
        }

        // API publique
        return {
            autoPlanMembersAfterTaskSync: autoPlanMembersAfterTaskSync,
            determineReplanFromDate: determineReplanFromDate
        };
    }

    // Export pour le navigateur
    global.createGanttAutoPlanningIntegration = createGanttAutoPlanningIntegration;

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));

// Export CommonJS pour tests et bundle (DOIT ÊTRE APRÈS l'IIFE)
if (typeof module !== 'undefined' && module.exports) {
    return {
        createGanttAutoPlanningIntegration: globalThis.createGanttAutoPlanningIntegration
    };
}

  }));

  // Module: widget-planning-service
  moduleRegistry.set('widget-planning-service', (function() {
    var exports = {};
    var module = { exports: exports };
    var __require = function(id) {
      if (!moduleRegistry.has(id)) {
        throw new Error('Module non résolu: ' + id);
      }
      return moduleRegistry.get(id)();
    };
    
    /**
 * Widget Planning Service - Façade pour la planification des widgets
 * 
 * Fournit une interface simplifiée et sécurisée pour :
 * - Prévisualiser une planification (dryRun)
 * - Appliquer une planification (commit)
 * 
 * Garanties :
 * - Aucun widget ne peut appliquer directement les actions brutes d'un dryRun
 * - Le noyau recalcule toujours avant d'écrire
 * - Gestion des doubles commits via verrou par instance
 */
const { reconcileAssignmentPlan, isBlockingDiagnostic } = __require('grist/grist-planning-adapter');

// ============================================================================
// HELPERS INTERNES
// ============================================================================

/**
 * Résume les actions Grist en comptant les créations, mises à jour et suppressions
 * @param {Array} actions - Actions Grist
 * @returns {Object} Résumé avec creates, updates, deletes, total
 */
function summarizeGristActions(actions) {
  const summary = {
    creates: 0,
    updates: 0,
    deletes: 0,
    total: 0,
    unknown: 0
  };
  
  if (!Array.isArray(actions)) {
    return summary;
  }
  
  for (const action of actions) {
    if (!Array.isArray(action) || action.length < 1) {
      summary.unknown++;
      summary.total++;
      continue;
    }
    
    const actionType = action[0];
    
    switch (actionType) {
      case 'AddRecord':
        summary.creates++;
        break;
      case 'UpdateRecord':
        summary.updates++;
        break;
      case 'RemoveRecord':
        summary.deletes++;
        break;
      default:
        summary.unknown++;
    }
    
    summary.total++;
  }
  
  return summary;
}

/**
 * Normalise les erreurs pour la façade
 * @param {Error|Object} error - Erreur à normaliser
 * @returns {Object} Erreur normalisée
 */
function normalizeError(error) {
  if (!error) {
    return null;
  }
  
  if (error.code) {
    return {
      code: error.code,
      message: error.message || 'Erreur inconnue',
      diagnostics: error.diagnostics || null,
      conflicts: error.conflicts || null
    };
  }
  
  return {
    code: 'WIDGET_PLANNING_SERVICE_ERROR',
    message: error.message || String(error)
  };
}

/**
 * Exécute le commit d'une affectation
 * @param {Object} grist - API Grist
 * @param {number} assignmentId - ID de l'affectation
 * @param {Object} options - Options
 * @returns {Promise<Object>} Résultat normalisé
 */
async function executeCommit(grist, assignmentId, options = {}) {
  try {
    const result = await reconcileAssignmentPlan(grist, assignmentId, {
      ...options,
      dryRun: false
    });
    
    if (!result.success) {
      return {
        success: false,
        mode: 'commit',
        assignmentId,
        desiredPlan: result.desiredPlan || [],
        summary: result.summary || null,
        diagnostics: result.diagnostics || [],
        capacityActions: result.capacityActions || [],
        timeEntryActions: result.timeEntryActions || [],
        actionsExecuted: result.actionsExecuted || 0,
        error: normalizeError(result.error)
      };
    }
    
    return {
      success: true,
      mode: 'commit',
      assignmentId,
      desiredPlan: result.desiredPlan || [],
      summary: result.summary || null,
      diagnostics: result.diagnostics || [],
      capacityActions: result.capacityActions || [],
      timeEntryActions: result.timeEntryActions || [],
      actionsExecuted: result.actionsExecuted || 0,
      error: null
    };
  } catch (error) {
    return {
      success: false,
      mode: 'commit',
      assignmentId,
      desiredPlan: [],
      summary: null,
      diagnostics: [],
      capacityActions: [],
      timeEntryActions: [],
      actionsExecuted: 0,
      error: normalizeError(error)
    };
  }
}

// ============================================================================
// CRÉATION DU SERVICE
// ============================================================================

/**
 * Crée une instance du service de planification pour widgets
 * @param {Object} grist - API Grist
 * @returns {Object} Service avec previewAssignment et commitAssignment
 */
function createWidgetPlanningService(grist) {
  const pendingCommits = new Map();
  
  /**
   * Prévisualise la planification d'une affectation
   * @param {number} assignmentId - ID de l'affectation
   * @param {Object} options - Options (replanFromDate, todayIso, etc.)
   * @returns {Promise<Object>} Résultat normalisé
   */
  async function previewAssignment(assignmentId, options = {}) {
    try {
      const result = await reconcileAssignmentPlan(grist, assignmentId, {
        ...options,
        dryRun: true
      });
      
      if (!result.success) {
        return {
          success: false,
          mode: 'preview',
          assignmentId,
          desiredPlan: result.desiredPlan || [],
          summary: result.summary || null,
          diagnostics: result.diagnostics || [],
          capacityActions: result.capacityActions || [],
          timeEntryActions: result.timeEntryActions || [],
          changeSummary: {
            capacities: summarizeGristActions(result.capacityActions || []),
            timeEntries: summarizeGristActions(result.timeEntryActions || [])
          },
          canCommit: false,
          error: normalizeError(result.error)
        };
      }
      
      const hasBlockingDiagnostics = (result.diagnostics || []).some(isBlockingDiagnostic);
      
      return {
        success: true,
        mode: 'preview',
        assignmentId,
        desiredPlan: result.desiredPlan || [],
        summary: result.summary || null,
        diagnostics: result.diagnostics || [],
        capacityActions: result.capacityActions || [],
        timeEntryActions: result.timeEntryActions || [],
        changeSummary: {
          capacities: summarizeGristActions(result.capacityActions || []),
          timeEntries: summarizeGristActions(result.timeEntryActions || [])
        },
        canCommit: !hasBlockingDiagnostics,
        error: null
      };
    } catch (error) {
      return {
        success: false,
        mode: 'preview',
        assignmentId,
        desiredPlan: [],
        summary: null,
        diagnostics: [],
        capacityActions: [],
        timeEntryActions: [],
        changeSummary: {
          capacities: { creates: 0, updates: 0, deletes: 0, total: 0 },
          timeEntries: { creates: 0, updates: 0, deletes: 0, total: 0 }
        },
        canCommit: false,
        error: normalizeError(error)
      };
    }
  }
  
  /**
   * Applique la planification d'une affectation
   * Retourne exactement la même Promise pour des appels simultanés sur la même affectation
   * @param {number} assignmentId - ID de l'affectation
   * @param {Object} options - Options (replanFromDate, todayIso, etc.)
   * @returns {Promise<Object>} Résultat normalisé
   */
  function commitAssignment(assignmentId, options = {}) {
    const commitKey = String(assignmentId);
    
    const existingPromise = pendingCommits.get(commitKey);
    if (existingPromise) {
      return existingPromise;
    }
    
    const commitPromise = executeCommit(grist, assignmentId, options).finally(() => {
      if (pendingCommits.get(commitKey) === commitPromise) {
        pendingCommits.delete(commitKey);
      }
    });
    
    pendingCommits.set(commitKey, commitPromise);
    
    return commitPromise;
  }
  
  return {
    previewAssignment,
    commitAssignment
  };
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

return {
  createWidgetPlanningService,
  summarizeGristActions
};

  }));

  
  // Exposer l'API publique
  var adapter = __require('grist/grist-planning-adapter');
  var widgetPlanningService = __require('widget-planning-service');
  var orchestrator = __require('planning/member/member-planning-orchestrator');
  var ganttAutoPlanning = __require('planning/gantt/gantt-auto-planning-integration');
  
  global.TaskFlowPlanning = {
    createWidgetPlanningService: widgetPlanningService.createWidgetPlanningService,
    summarizeGristActions: widgetPlanningService.summarizeGristActions,
    createMemberPlanningOrchestrator: orchestrator.createMemberPlanningOrchestrator,
    isBlockingDiagnostic: adapter.isBlockingDiagnostic,
    createGanttAutoPlanningIntegration: ganttAutoPlanning.createGanttAutoPlanningIntegration
  };
  
  // Exposer aussi directement pour compatibilité avec le code existant
  global.createMemberPlanningOrchestrator = orchestrator.createMemberPlanningOrchestrator;
  global.createGanttAutoPlanningIntegration = ganttAutoPlanning.createGanttAutoPlanningIntegration;
  
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

/* ============================================================================
 * Fin du bundle taskflow-planning-browser.js
 * ========================================================================== */
