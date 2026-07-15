/**
 * Timesheet Validator - Validation de feuilles de temps
 * 
 * Valide les soumissions de feuilles de temps en vérifiant
 * les contraintes de capacité et la cohérence des données.
 */

'use strict';

const { toCentiHours, toHours, parseDateUTC, formatDateUTC, validateNumber } = require('../planning/planning-engine.js');

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
      return sum + toCentiHours(entry.actualHours || 0);
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

module.exports = {
  validateTimesheet,
  isDateInTimesheetWeek,
  ERROR_CODES,
  addDaysUTC
};
