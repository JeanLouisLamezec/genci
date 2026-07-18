/**
 * Time Entry Planning Service - Génération du planning prévisionnel
 * 
 * Service dédié pour générer les lignes TimeEntries.heuresPrevues
 * à partir des TaskAssignments, en respectant les capacités quotidiennes.
 */

'use strict';

const { getDocApi } = require('../../grist/grist-api-helper.js');
const { 
  parseDateUTC, 
  formatDateUTC, 
  addDaysUTC, 
  compareDates, 
  datesAreEqual,
  toCentiHours, 
  toHours, 
  validateNumber,
  generateDateRange
} = require('../planning-engine.js');

const { buildDesiredMemberDailyCapacities } = require('../../capacity/member-daily-capacity-service.js');

// ============================================================================
// CONSTANTES
// ============================================================================

const DISTRIBUTION_MODES = {
  UNIFORME: 'uniforme',
  PERSONNALISE: 'personnalise'
};

const DEFAULT_DISTRIBUTION_MODE = DISTRIBUTION_MODES.UNIFORME;

// ============================================================================
// VALIDATION DES TASK ASSIGNMENTS
// ============================================================================

/**
 * Valide qu'un TaskAssignment est planifiable
 * @param {Object} assignment - L'affectation à valider
 * @param {Object} context - Contexte (tasks, members, capacities)
 * @returns {Object} { valid, errors, warnings }
 */
function validateAssignment(assignment, context) {
  const errors = [];
  const warnings = [];
  
  // Vérifier actif
  if (assignment.actif === false) {
    return {
      valid: false,
      errors: [{ code: 'INACTIVE_ASSIGNMENT', message: "L'affectation est inactive" }],
      warnings: []
    };
  }
  
  // Vérifier heuresAllouees
  const hoursValidation = validateNumber(assignment.heuresAllouees, 'heuresAllouees');
  if (!hoursValidation.valid) {
    errors.push({
      code: 'INVALID_HOURS',
      message: hoursValidation.error
    });
  } else if (assignment.heuresAllouees <= 0) {
    errors.push({
      code: 'ZERO_HOURS',
      message: 'heuresAllouees doit être > 0'
    });
  }
  
  // Vérifier dates
  if (!assignment.dateDebut || !assignment.dateFin) {
    errors.push({
      code: 'MISSING_DATES',
      message: 'dateDebut et dateFin sont requises'
    });
  } else if (compareDates(assignment.dateDebut, assignment.dateFin) > 0) {
    errors.push({
      code: 'INVALID_DATE_RANGE',
      message: 'dateFin doit être >= dateDebut'
    });
  }
  
  // Vérifier le membre
  if (!assignment.membre) {
    errors.push({
      code: 'MISSING_MEMBER',
      message: 'membre est requis'
    });
  } else if (context && context.members) {
    const memberExists = context.members.some(m => m.id === assignment.membre);
    if (!memberExists) {
      errors.push({
        code: 'MEMBER_NOT_FOUND',
        memberId: assignment.membre,
        message: `Le membre ${assignment.membre} n'existe pas`
      });
    }
  }
  
  // Vérifier la tâche
  if (!assignment.tache) {
    errors.push({
      code: 'MISSING_TASK',
      message: 'tache est requise'
    });
  } else if (context && context.tasks) {
    const taskExists = context.tasks.some(t => t.id === assignment.tache);
    if (!taskExists) {
      errors.push({
        code: 'TASK_NOT_FOUND',
        taskId: assignment.tache,
        message: `La tâche ${assignment.tache} n'existe pas`
      });
    }
  }
  
  // Vérifier le mode de répartition
  if (assignment.modeRepartition && assignment.modeRepartition !== DISTRIBUTION_MODES.UNIFORME) {
    if (assignment.modeRepartition === DISTRIBUTION_MODES.PERSONNALISE) {
      warnings.push({
        code: 'PERSONNALISE_MODE_NOT_IMPLEMENTED',
        message: 'Le mode personnalise n\'est pas encore implémenté, traitement en uniforme'
      });
    } else {
      warnings.push({
        code: 'UNKNOWN_DISTRIBUTION_MODE',
        mode: assignment.modeRepartition,
        message: `Mode de répartition inconnu: ${assignment.modeRepartition}`
      });
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// ============================================================================
// CALCUL DE LA RÉPARTITION UNIFORME
// ============================================================================

/**
 * Répartit des heures uniformément sur des jours admissibles
 * @param {number} totalHours - Total d'heures à répartir
 * @param {Array} eligibleDays - Jours admissibles avec capacité
 * @param {Object} existingPlan - Planning existant { date: heuresDejaPlanifiees }
 * @returns {Object} { planned: { date: heures }, unallocatedHours, warnings }
 */
function distributeHoursUniformly(totalHours, eligibleDays, existingPlan = {}) {
  const planned = {};
  const warnings = [];
  let remainingHours = totalHours;
  
  // Trier les jours par date (ordre déterministe)
  const sortedDays = [...eligibleDays].sort((a, b) => compareDates(a.date, b.date));
  
  // Calculer la capacité restante pour chaque jour
  const dayCapacities = sortedDays.map(day => {
    const existingHours = existingPlan[day.date] || 0;
    const remainingCapacity = Math.max(0, day.capaciteDisponible - existingHours);
    return {
      ...day,
      remainingCapacity
    };
  });
  
  // Capacité totale disponible
  const totalCapacity = dayCapacities.reduce((sum, day) => sum + day.remainingCapacity, 0);
  
  if (totalCapacity === 0) {
    return {
      planned: {},
      unallocatedHours: totalHours,
      warnings: [{
        code: 'NO_CAPACITY_AVAILABLE',
        message: 'Aucune capacité disponible sur la période'
      }]
    };
  }
  
  // Si on a plus d'heures que de capacité
  if (totalHours > totalCapacity) {
    warnings.push({
      code: 'INSUFFICIENT_CAPACITY',
      allocatedHours: totalHours,
      availableCapacity: totalCapacity,
      unallocatedHours: totalHours - totalCapacity,
      message: `Capacité insuffisante: ${totalHours}h demandées, ${totalCapacity}h disponibles`
    });
    remainingHours = totalCapacity; // On planifie au maximum de la capacité
  }
  
  // Répartir les heures
  const hoursPerDay = remainingHours / dayCapacities.length;
  
  // Appliquer la répartition avec gestion des arrondis
  let accumulatedError = 0;
  
  for (let i = 0; i < dayCapacities.length && remainingHours > 0; i++) {
    const day = dayCapacities[i];
    
    // Heures à allouer (avec correction d'arrondi)
    let hoursToAllocate = hoursPerDay;
    
    // Accumuler l'erreur d'arrondi
    accumulatedError += hoursPerDay - Math.floor(hoursPerDay * 100) / 100;
    
    // Sur le dernier jour, corriger l'arrondi
    if (i === dayCapacities.length - 1) {
      hoursToAllocate = remainingHours; // Prendre tout ce qui reste
    } else {
      hoursToAllocate = Math.floor(hoursToAllocate * 100) / 100;
    }
    
    // Ne pas dépasser la capacité restante
    hoursToAllocate = Math.min(hoursToAllocate, day.remainingCapacity, remainingHours);
    
    // Arrondir à 2 décimales
    hoursToAllocate = Math.round(hoursToAllocate * 100) / 100;
    
    if (hoursToAllocate > 0) {
      planned[day.date] = hoursToAllocate;
      remainingHours -= hoursToAllocate;
      remainingHours = Math.round(remainingHours * 100) / 100; // Éviter l'accumulation d'erreurs flottantes
    }
  }
  
  // Vérifier la conservation exacte
  const totalPlanned = Object.values(planned).reduce((sum, h) => sum + h, 0);
  const finalUnallocated = Math.round((totalHours - totalPlanned) * 100) / 100;
  
  if (finalUnallocated > 0.001) {
    // Tenter de redistribuer le reliquat sur le dernier jour avec capacité
    const lastDayWithCapacity = dayCapacities.reverse().find(d => 
      d.remainingCapacity > (planned[d.date] || 0) + 0.01
    );
    
    if (lastDayWithCapacity) {
      const additionalHours = Math.min(finalUnallocated, lastDayWithCapacity.remainingCapacity - (planned[lastDayWithCapacity.date] || 0));
      if (additionalHours > 0) {
        planned[lastDayWithCapacity.date] = Math.round(((planned[lastDayWithCapacity.date] || 0) + additionalHours) * 100) / 100;
      }
    }
  }
  
  return {
    planned,
    unallocatedHours: finalUnallocated,
    warnings
  };
}

// ============================================================================
// PLANIFICATION D'UNE AFFECTATION
// ============================================================================

/**
 * Planifie une affectation sur sa période
 * @param {Object} assignment - TaskAssignment
 * @param {Object} context - Capacités et planning existant
 * @returns {Object} { plannedEntries, unallocatedHours, warnings }
 */
function planAssignment(assignment, context) {
  const result = {
    plannedEntries: [],
    unallocatedHours: 0,
    warnings: []
  };
  
  // Valider l'affectation
  const validation = validateAssignment(assignment, context);
  if (!validation.valid) {
    return {
      ...result,
      errors: validation.errors,
      warnings: validation.warnings
    };
  }
  
  result.warnings.push(...validation.warnings);
  
  // Obtenir les jours dans la période
  const dateRange = generateDateRange(
    new Date(assignment.dateDebut * 1000),
    new Date(assignment.dateFin * 1000)
  );
  
  const daysInRange = dateRange.map(dateStr => ({
    date: dateStr,
    timestamp: new Date(dateStr + 'T00:00:00Z').getTime() / 1000
  }));
  
  // Filtrer les jours avec capacité > 0
  const eligibleDays = daysInRange
    .map(day => {
      // Trouver la capacité pour ce jour
      // Le contexte peut avoir des dates en timestamp ou en string
      const capacity = context.capacities.find(c => {
        if (c.membre !== assignment.membre) return false;
        
        // Comparer les dates (timestamp ou string)
        const capacityDate = typeof c.date === 'number' ? formatDateUTC(new Date(c.date * 1000)) : c.date;
        return capacityDate === day.date;
      });
      
      return capacity ? {
        date: day.date,
        timestamp: day.timestamp,
        capaciteDisponible: capacity.capaciteDisponible || 0,
        capaciteTheorique: capacity.capaciteTheorique || 0,
        capaciteJourId: capacity.id || null
      } : null;
    })
    .filter(d => d && d.capaciteDisponible > 0);
  
  if (eligibleDays.length === 0) {
    return {
      ...result,
      unallocatedHours: assignment.heuresAllouees,
      warnings: [{
        code: 'NO_ELIGIBLE_DAYS',
        message: 'Aucun jour avec capacité > 0 dans la période'
      }]
    };
  }
  
  // Obtenir le planning existant pour ce membre
  const existingPlan = {};
  if (context.existingEntries) {
    context.existingEntries
      .filter(e => e.membre === assignment.membre && e.affectation !== assignment.id)
      .forEach(e => {
        const dateStr = typeof e.date === 'number' ? formatDateUTC(new Date(e.date * 1000)) : e.date;
        existingPlan[dateStr] = (existingPlan[dateStr] || 0) + (e.heuresPrevues || 0);
      });
  }
  
  // Répartir les heures
  const distribution = distributeHoursUniformly(
    assignment.heuresAllouees,
    eligibleDays,
    existingPlan
  );
  
  result.warnings.push(...distribution.warnings);
  result.unallocatedHours = distribution.unallocatedHours;
  
  // Créer les entrées planifiées
  for (const [dateStr, hours] of Object.entries(distribution.planned)) {
    const dayData = eligibleDays.find(d => d.date === dateStr);
    
    result.plannedEntries.push({
      membre: assignment.membre,
      tache: assignment.tache,
      affectation: assignment.id,
      date: dayData.timestamp,
      heuresPrevues: hours,
      capaciteTheorique: dayData.capaciteTheorique,
      capaciteDisponible: dayData.capaciteDisponible,
      capaciteJour: dayData.capaciteJourId || null,
      revisionPlan: 1
    });
  }
  
  return result;
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

module.exports = {
  // Validation
  validateAssignment,
  
  // Répartition
  distributeHoursUniformly,
  planAssignment,
  
  // Constantes
  DISTRIBUTION_MODES,
  DEFAULT_DISTRIBUTION_MODE
};
