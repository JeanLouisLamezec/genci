/**
 * Member Daily Overload Detection - Détection des surcharges agrégées
 * 
 * Détecte les surcharges lorsqu'un membre a plusieurs affectations
 * sur la même journée, en comparant le total des heures prévues
 * avec la capacité quotidienne unique.
 */

'use strict';

const { toCentiHours, toHours, formatDateUTC, parseDateUTC } = require('../planning/planning-engine.js');

/**
 * Détecte les surcharges quotidiennes pour un ensemble d'entrées planifiées
 * @param {Object} input - Paramètres d'entrée
 * @param {Array} input.plannedEntries - Entrées planifiées avec memberId, date, plannedHours, assignmentId, taskId
 * @param {Array} input.memberDailyCapacities - Capacités quotidiennes avec memberId, date, availableCapacityHours
 * @returns {Object} Résultat avec overloads, diagnostics
 */
function detectMemberDailyOverloads(input) {
  const {
    plannedEntries = [],
    memberDailyCapacities = []
  } = input;
  
  const overloads = [];
  const diagnostics = [];
  
  // Indexer les capacités par memberId + date
  const capacityByKey = new Map();
  for (const cap of memberDailyCapacities) {
    const key = `${cap.memberId}:${cap.date}`;
    capacityByKey.set(key, cap);
  }
  
  // Agréger les heures planifiées par memberId + date
  const plannedByMemberDate = new Map();
  
  for (const entry of plannedEntries) {
    const key = `${entry.memberId}:${entry.date}`;
    
    if (!plannedByMemberDate.has(key)) {
      plannedByMemberDate.set(key, {
        memberId: entry.memberId,
        date: entry.date,
        plannedHours: 0,
        assignments: [],
        tasks: new Set()
      });
    }
    
    const agg = plannedByMemberDate.get(key);
    agg.plannedHours += entry.plannedHours || 0;
    if (entry.assignmentId) {
      agg.assignments.push(entry.assignmentId);
    }
    if (entry.taskId) {
      agg.tasks.add(entry.taskId);
    }
  }
  
  // Vérifier les surcharges
  for (const [key, agg] of plannedByMemberDate) {
    const capacity = capacityByKey.get(key);
    
    if (!capacity) {
      diagnostics.push({
        code: 'MISSING_DAILY_CAPACITY',
        memberId: agg.memberId,
        date: agg.date,
        message: `Aucune capacité quotidienne trouvée pour ${key}`
      });
      continue;
    }
    
    const availableCapacity = capacity.availableCapacityHours || 0;
    const plannedHours = agg.plannedHours;
    
    // Calculer la surcharge (arrondie à 0,01h)
    const overloadHours = toHours(Math.max(0, toCentiHours(plannedHours - availableCapacity)));
    
    if (overloadHours > 0) {
      overloads.push({
        memberId: agg.memberId,
        date: agg.date,
        plannedHours: toHours(Math.round(plannedHours * 100)),
        availableCapacityHours: availableCapacity,
        overloadHours: overloadHours,
        assignmentIds: [...new Set(agg.assignments)],
        taskIds: [...agg.tasks]
      });
    }
  }
  
  if (overloads.length > 0) {
    diagnostics.push({
      code: 'MEMBER_DAILY_OVERLOADS_DETECTED',
      count: overloads.length,
      overloads: overloads.map(o => ({
        memberId: o.memberId,
        date: o.date,
        overloadHours: o.overloadHours
      }))
    });
  }
  
  return {
    overloads,
    diagnostics
  };
}

/**
 * Vérifie les contraintes d'unicité métier
 * @param {Array} records - Enregistrements à vérifier
 * @param {Function} keyFn - Fonction pour extraire la clé d'unicité
 * @param {string} errorCode - Code d'erreur à retourner
 * @returns {Object} Résultat avec hasViolations, violations
 */
function checkUnicityConstraint(records, keyFn, errorCode) {
  const seen = new Map();
  const violations = [];
  
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const key = keyFn(record);
    
    if (seen.has(key)) {
      violations.push({
        code: errorCode,
        key,
        records: [seen.get(key).id, record.id],
        message: `Violation d'unicité pour ${key}`
      });
    } else {
      seen.set(key, record);
    }
  }
  
  return {
    hasViolations: violations.length > 0,
    violations
  };
}

/**
 * Vérifie l'unicité des affectations actives (tâche + membre)
 * @param {Array} assignments - Affectations à vérifier
 * @returns {Object} Résultat avec hasViolations, violations
 */
function checkActiveAssignmentUnicity(assignments) {
  const active = assignments.filter(a => a.actif !== false);
  
  return checkUnicityConstraint(
    active,
    a => `${a.tache}:${a.membre}`,
    'DUPLICATE_ACTIVE_ASSIGNMENT'
  );
}

/**
 * Vérifie l'unicité des TimeEntries (affectation + date)
 * @param {Array} entries - Entrées à vérifier
 * @returns {Object} Résultat avec hasViolations, violations
 */
function checkTimeEntryUnicity(entries) {
  return checkUnicityConstraint(
    entries,
    e => `${e.affectation}:${e.date}`,
    'DUPLICATE_TIME_ENTRY'
  );
}

/**
 * Vérifie l'unicité des MemberDailyCapacities (membre + date)
 * @param {Array} capacities - Capacités à vérifier
 * @returns {Object} Résultat avec hasViolations, violations
 */
function checkMemberDailyCapacityUnicity(capacities) {
  return checkUnicityConstraint(
    capacities,
    c => `${c.memberId}:${c.date}`,
    'DUPLICATE_MEMBER_DAILY_CAPACITY'
  );
}

module.exports = {
  detectMemberDailyOverloads,
  checkUnicityConstraint,
  checkActiveAssignmentUnicity,
  checkTimeEntryUnicity,
  checkMemberDailyCapacityUnicity
};
