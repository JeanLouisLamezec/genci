/**
 * Plan Period Aggregation - Module d'agrégation pur pour le widget Plan
 * 
 * Module indépendant qui agrège les données canoniques :
 * - TimeEntries.heuresPrevues (prévu)
 * - TimeEntries.heures (réalisé)
 * - MemberDailyCapacities.capaciteDisponible (capacité disponible)
 * - MemberDailyCapacities.capaciteTheorique (capacité théorique)
 * - TaskAssignments.heuresAllouees (allocation)
 * 
 * Indépendant de :
 * - Grist
 * - DOM
 * - État global du widget
 */

'use strict';

// ============================================================================
// HELPERS DE DATE - BORNES EXACTES UTC
// ============================================================================

/**
 * Obtient le lundi d'une date donnée (UTC)
 * @param {Date} date - Date
 * @returns {Date} Lundi de la semaine
 */
function getMonday(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
}

/**
 * Formate une date en YYYY-MM-DD (UTC)
 * @param {Date} date - Date
 * @returns {string} Date au format YYYY-MM-DD
 */
function formatDateUTC(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

/**
 * Parse une date YYYY-MM-DD en Date UTC
 * @param {string} dateStr - Date au format YYYY-MM-DD
 * @returns {Date} Date UTC
 */
function parseDateUTC(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  const date = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
  return formatDateUTC(date) === dateStr ? date : null;
}

/**
 * Génère un tableau de dates entre deux bornes (inclusif)
 * @param {string} startStr - Date de début (YYYY-MM-DD)
 * @param {string} endStr - Date de fin (YYYY-MM-DD)
 * @returns {string[]} Tableau de dates (YYYY-MM-DD)
 */
function generateDateRange(startStr, endStr) {
  const start = parseDateUTC(startStr);
  const end = parseDateUTC(endStr);
  if (!start || !end) return [];
  
  const dates = [];
  const current = new Date(start.getTime());
  
  while (current <= end) {
    dates.push(formatDateUTC(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  
  return dates;
}

/**
 * Obtient la clé de période pour une date (semaine ISO ou mois)
 * @param {Date} date - Date
 * @param {string} granularity - 'week' ou 'month'
 * @returns {string} Clé de période
 */
function getPeriodKey(date, granularity) {
  if (granularity === 'month') {
    return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0');
  }
  
  // Semaine ISO : YYYY-Www
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

/**
 * Obtient les bornes exactes d'une semaine (lundi 00:00 UTC inclus, lundi suivant 00:00 UTC exclusif)
 * @param {Date} date - Date dans la semaine
 * @returns {Object} { start: Date, end: Date } bornes UTC
 */
function getWeekBounds(date) {
  const monday = getMonday(date);
  const nextMonday = new Date(monday.getTime());
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  return {
    start: monday,
    end: nextMonday
  };
}

/**
 * Obtient les bornes exactes d'un mois (1er 00:00 UTC inclus, 1er mois suivant 00:00 UTC exclusif)
 * @param {Date} date - Date dans le mois
 * @returns {Object} { start: Date, end: Date } bornes UTC
 */
function getMonthBounds(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { start, end };
}

/**
 * Vérifie si une date est dans une période (bornes UTC, fin exclusive)
 * @param {string} dateStr - Date à tester (YYYY-MM-DD)
 * @param {Date} periodStart - Début de période (UTC)
 * @param {Date} periodEnd - Fin de période (UTC, exclusif)
 * @returns {boolean} true si dans la période
 */
function isDateInPeriod(dateStr, periodStart, periodEnd) {
  const date = parseDateUTC(dateStr);
  if (!date) return false;
  const time = date.getTime();
  return time >= periodStart.getTime() && time < periodEnd.getTime();
}

// ============================================================================
// CONVERSION EN CENTIÈMES D'HEURE
// ============================================================================

/**
 * Convertit des heures en centièmes d'heure (entier)
 * @param {number} hours - Heures
 * @returns {number} Centièmes d'heure
 */
function toCentiHours(hours) {
  return Math.round((hours || 0) * 100);
}

/**
 * Convertit des centièmes d'heure en heures
 * @param {number} centiHours - Centièmes d'heure
 * @returns {number} Heures
 */
function toHours(centiHours) {
  return (centiHours || 0) / 100;
}

// ============================================================================
// INDEXATION DES DONNÉES
// ============================================================================

/**
 * Indexe les TimeEntries par membre et date
 * @param {Array} entries - TimeEntries normalisées
 * @returns {Map<string, Array>} Map "memberId:date" → entries
 */
function indexEntriesByMemberAndDate(entries) {
  const map = new Map();
  
  for (const entry of entries) {
    if (!entry.memberId || !entry.date) continue;
    
    const key = entry.memberId + ':' + entry.date;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(entry);
  }
  
  return map;
}

/**
 * Indexe les capacités par membre et date
 * @param {Array} capacities - Capacités quotidiennes
 * @returns {Map<string, Object>} Map "memberId:date" → capacité
 */
function indexCapacitiesByMemberAndDate(capacities) {
  const map = new Map();
  
  for (const cap of capacities) {
    if (!cap.membre || !cap.date) continue;
    
    const key = cap.membre + ':' + cap.date;
    // En cas de doublon, prendre le dernier (plus récent)
    map.set(key, cap);
  }
  
  return map;
}

/**
 * Indexe les affectations par membre
 * @param {Array} assignments - TaskAssignments
 * @returns {Map<number, Array>} Map memberId → assignments
 */
function indexAssignmentsByMember(assignments) {
  const map = new Map();
  
  for (const assignment of assignments) {
    if (!assignment.membre) continue;
    
    if (!map.has(assignment.membre)) {
      map.set(assignment.membre, []);
    }
    map.get(assignment.membre).push(assignment);
  }
  
  return map;
}

// ============================================================================
// AGRÉGATION PAR PÉRIODE
// ============================================================================

/**
 * Agrège les données pour une période donnée
 * @param {Object} params - Paramètres
 * @returns {Object} Agrégats par membre/période
 */
function buildPlanPeriodIndex(params) {
  const {
    periods,
    team,
    assignments,
    tasks,
    projects,
    programmes,
    timeEntries,
    dailyCapacities
  } = params;
  
  const granularity = periods && periods.granularity || 'week';
  const periodKeys = periods && periods.keys || [];
  
  // Indexer les données sources
  const entriesByMemberDate = indexEntriesByMemberAndDate(timeEntries);
  const capacitiesByMemberDate = indexCapacitiesByMemberAndDate(dailyCapacities);
  const assignmentsByMember = indexAssignmentsByMember(assignments);
  
  // Indexer les tâches, projets, programmes par ID
  const taskById = {};
  if (tasks) {
    for (const task of tasks) {
      taskById[task.id] = task;
    }
  }
  
  const projectById = {};
  if (projects) {
    for (const project of projects) {
      projectById[project.id] = project;
    }
  }
  
  const programmeById = {};
  if (programmes) {
    for (const programme of programmes) {
      programmeById[programme.id] = programme;
    }
  }
  
  // Indexer les membres de l'équipe
  const memberById = {};
  if (team) {
    for (const member of team) {
      memberById[member.id] = member;
    }
  }
  
  // Résultats agrégés
  const byMemberPeriod = {};
  const byTaskPeriod = {};
  const byProjectPeriod = {};
  const byProgrammePeriod = {};
  const byRolePeriod = {};
  
  // Pour chaque membre de l'équipe
  for (const member of team) {
    const memberId = member.id;
    const memberRole = member.role || null;
    
    // Pour chaque période
    for (const periodKey of periodKeys) {
      const key = memberId + ':' + periodKey;
      
      // Obtenir les bornes de la période
      const periodBounds = getPeriodBounds(periodKey, granularity);
      if (!periodBounds) continue;
      
      const { start, end } = periodBounds;
      
      // Initialiser l'agrégat
      const agg = {
        memberId: memberId,
        periodKey: periodKey,
        plannedHours: 0,
        actualHours: 0,
        effectiveHours: 0,
        theoreticalCapacityHours: 0,
        availableCapacityHours: 0,
        absenceHours: 0,
        freeCapacityHours: 0,
        loadRatio: 0,
        entries: [],
        assignmentIds: new Set(),
        taskIds: new Set()
      };
      
      // Parcourir les dates de la période
      let currentDate = new Date(start.getTime());
      while (currentDate < end) {
        const dateStr = formatDateUTC(currentDate);
        const memberDateKey = memberId + ':' + dateStr;
        
        // Capacités du jour
        const cap = capacitiesByMemberDate.get(memberDateKey);
        if (cap) {
          agg.theoreticalCapacityHours += cap.capaciteTheorique || 0;
          agg.availableCapacityHours += cap.capaciteDisponible || 0;
          agg.absenceHours += cap.absenceHeures || 0;
        }
        
        // TimeEntries du jour
        const entries = entriesByMemberDate.get(memberDateKey) || [];
        for (const entry of entries) {
          // Travailler en centièmes d'heure pour éviter les erreurs flottantes
          const plannedCenti = toCentiHours(entry.plannedHours);
          const actualCenti = entry.actualHours != null ? toCentiHours(entry.actualHours) : null;
          const effectiveCenti = actualCenti != null ? actualCenti : plannedCenti;
          
          agg.plannedHours += plannedCenti;
          agg.effectiveHours += effectiveCenti;
          if (actualCenti != null) {
            agg.actualHours += actualCenti;
          }
          
          agg.entries.push(entry);
          if (entry.assignmentId) {
            agg.assignmentIds.add(entry.assignmentId);
          }
          if (entry.taskId) {
            agg.taskIds.add(entry.taskId);
          }
        }
        
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }
      
      // Convertir en heures (depuis centièmes)
      agg.plannedHours = toHours(agg.plannedHours);
      agg.actualHours = toHours(agg.actualHours);
      agg.effectiveHours = toHours(agg.effectiveHours);
      
      // Calculer la capacité libre et le ratio
      agg.freeCapacityHours = Math.max(agg.availableCapacityHours - agg.effectiveHours, 0);
      agg.loadRatio = agg.availableCapacityHours > 0 ? agg.effectiveHours / agg.availableCapacityHours : 0;
      
      // Convertir les Sets en tableaux pour sérialisation
      agg.assignmentIds = Array.from(agg.assignmentIds);
      agg.taskIds = Array.from(agg.taskIds);
      
      byMemberPeriod[key] = agg;
      
      // Agrégation par tâche
      for (const taskId of agg.taskIds) {
        const taskKey = taskId + ':' + periodKey;
        if (!byTaskPeriod[taskKey]) {
          byTaskPeriod[taskKey] = {
            taskId: taskId,
            periodKey: periodKey,
            plannedHours: 0,
            actualHours: 0,
            effectiveHours: 0,
            memberIds: new Set()
          };
        }
        
        // Somme des TimeEntries pour cette tâche dans la période
        const taskEntries = agg.entries.filter(e => e.taskId === taskId);
        for (const entry of taskEntries) {
          byTaskPeriod[taskKey].plannedHours += entry.plannedHours;
          byTaskPeriod[taskKey].effectiveHours += entry.actualHours != null
            ? entry.actualHours
            : entry.plannedHours;
          if (entry.actualHours != null) {
            byTaskPeriod[taskKey].actualHours += entry.actualHours;
          }
          byTaskPeriod[taskKey].memberIds.add(entry.memberId);
        }
      }
      
      // Agrégation par projet (via tâche)
      for (const taskId of agg.taskIds) {
        const task = taskById[taskId];
        if (!task || !task.projet) continue;
        
        const projectId = task.projet;
        const projectKey = projectId + ':' + periodKey;
        
        if (!byProjectPeriod[projectKey]) {
          byProjectPeriod[projectKey] = {
            projectId: projectId,
            periodKey: periodKey,
            plannedHours: 0,
            actualHours: 0,
            effectiveHours: 0,
            memberIds: new Set(),
            taskIds: new Set()
          };
        }
        
        const taskEntries = agg.entries.filter(e => e.taskId === taskId);
        for (const entry of taskEntries) {
          byProjectPeriod[projectKey].plannedHours += entry.plannedHours;
          byProjectPeriod[projectKey].effectiveHours += entry.actualHours != null
            ? entry.actualHours
            : entry.plannedHours;
          if (entry.actualHours != null) {
            byProjectPeriod[projectKey].actualHours += entry.actualHours;
          }
          byProjectPeriod[projectKey].memberIds.add(entry.memberId);
          byProjectPeriod[projectKey].taskIds.add(taskId);
        }
      }
      
      // Agrégation par programme (via projet)
      for (const taskId of agg.taskIds) {
        const task = taskById[taskId];
        if (!task || !task.projet) continue;
        
        const project = projectById[task.projet];
        if (!project || !project.programme) continue;
        
        const programmeId = project.programme;
        const programmeKey = programmeId + ':' + periodKey;
        
        if (!byProgrammePeriod[programmeKey]) {
          byProgrammePeriod[programmeKey] = {
            programmeId: programmeId,
            periodKey: periodKey,
            plannedHours: 0,
            actualHours: 0,
            effectiveHours: 0,
            memberIds: new Set(),
            projectIds: new Set(),
            taskIds: new Set()
          };
        }
        
        const taskEntries = agg.entries.filter(e => e.taskId === taskId);
        for (const entry of taskEntries) {
          byProgrammePeriod[programmeKey].plannedHours += entry.plannedHours;
          byProgrammePeriod[programmeKey].effectiveHours += entry.actualHours != null
            ? entry.actualHours
            : entry.plannedHours;
          if (entry.actualHours != null) {
            byProgrammePeriod[programmeKey].actualHours += entry.actualHours;
          }
          byProgrammePeriod[programmeKey].memberIds.add(entry.memberId);
          byProgrammePeriod[programmeKey].projectIds.add(project.id);
          byProgrammePeriod[programmeKey].taskIds.add(taskId);
        }
      }
      
      // Agrégation par rôle
      if (memberRole) {
        const roleKey = memberRole + ':' + periodKey;
        if (!byRolePeriod[roleKey]) {
          byRolePeriod[roleKey] = {
            role: memberRole,
            periodKey: periodKey,
            plannedHours: 0,
            actualHours: 0,
            effectiveHours: 0,
            theoreticalCapacityHours: 0,
            availableCapacityHours: 0,
            memberIds: new Set()
          };
        }
        
        byRolePeriod[roleKey].plannedHours += agg.plannedHours;
        byRolePeriod[roleKey].actualHours += agg.actualHours;
        byRolePeriod[roleKey].effectiveHours += agg.effectiveHours;
        byRolePeriod[roleKey].theoreticalCapacityHours += agg.theoreticalCapacityHours;
        byRolePeriod[roleKey].availableCapacityHours += agg.availableCapacityHours;
        byRolePeriod[roleKey].memberIds.add(memberId);
      }
    }
  }
  
  // Convertir les Sets restants en tableaux
  for (const key of Object.keys(byTaskPeriod)) {
    byTaskPeriod[key].memberIds = Array.from(byTaskPeriod[key].memberIds);
  }
  for (const key of Object.keys(byProjectPeriod)) {
    byProjectPeriod[key].memberIds = Array.from(byProjectPeriod[key].memberIds);
    byProjectPeriod[key].taskIds = Array.from(byProjectPeriod[key].taskIds);
  }
  for (const key of Object.keys(byProgrammePeriod)) {
    byProgrammePeriod[key].memberIds = Array.from(byProgrammePeriod[key].memberIds);
    byProgrammePeriod[key].projectIds = Array.from(byProgrammePeriod[key].projectIds);
    byProgrammePeriod[key].taskIds = Array.from(byProgrammePeriod[key].taskIds);
  }
  for (const key of Object.keys(byRolePeriod)) {
    byRolePeriod[key].memberIds = Array.from(byRolePeriod[key].memberIds);
  }
  
  // Indexer les entrées par membre/période pour le détail
  const entriesByMemberPeriod = {};
  for (const key of Object.keys(byMemberPeriod)) {
    entriesByMemberPeriod[key] = byMemberPeriod[key].entries;
  }
  
  // Indexer les capacités par membre/période
  const capacitiesByMemberPeriod = {};
  for (const key of Object.keys(byMemberPeriod)) {
    const agg = byMemberPeriod[key];
    capacitiesByMemberPeriod[key] = {
      theoreticalCapacityHours: agg.theoreticalCapacityHours,
      availableCapacityHours: agg.availableCapacityHours,
      absenceHours: agg.absenceHours
    };
  }
  
  // Diagnostics
  const diagnostics = [];
  
  // Vérifier les incohérences
  for (const key of Object.keys(byMemberPeriod)) {
    const agg = byMemberPeriod[key];
    
    // Capacité nulle avec prévu > 0
    if (agg.availableCapacityHours === 0 && agg.effectiveHours > 0) {
      diagnostics.push({
        code: 'ZERO_CAPACITY_WITH_PLANNED',
        memberPeriod: key,
        plannedHours: agg.effectiveHours,
        message: 'Capacité nulle mais ' + agg.effectiveHours + 'h de charge'
      });
    }
    
    // Surcharge
    if (agg.loadRatio > 1.01) {
      diagnostics.push({
        code: 'OVERLOAD',
        memberPeriod: key,
        loadRatio: agg.loadRatio,
        plannedHours: agg.effectiveHours,
        availableCapacityHours: agg.availableCapacityHours,
        message: 'Surcharge : ' + Math.round(agg.loadRatio * 100) + '%'
      });
    }
  }
  
  return {
    byMemberPeriod,
    byTaskPeriod,
    byProjectPeriod,
    byProgrammePeriod,
    byRolePeriod,
    entriesByMemberPeriod,
    capacitiesByMemberPeriod,
    diagnostics
  };
}

/**
 * Obtient les bornes d'une période à partir de sa clé
 * @param {string} periodKey - Clé de période (YYYY-MM ou YYYY-Www)
 * @param {string} granularity - 'week' ou 'month'
 * @returns {Object|null} { start: Date, end: Date } ou null
 */
function getPeriodBounds(periodKey, granularity) {
  if (granularity === 'month') {
    // YYYY-MM
    const parts = periodKey.split('-');
    if (parts.length !== 2) return null;
    
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 1));
    
    return { start, end };
  }
  
  // Semaine ISO : YYYY-Www
  const weekMatch = periodKey.match(/^(\d{4})-W(\d{2})$/);
  if (!weekMatch) return null;
  
  const year = parseInt(weekMatch[1], 10);
  const week = parseInt(weekMatch[2], 10);
  
  // Trouver le lundi de la semaine ISO
  // La semaine 1 est celle contenant le 4 janvier
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const jan4Monday = new Date(jan4.getTime());
  jan4Monday.setUTCDate(jan4Monday.getUTCDate() - jan4Day + 1);
  
  const monday = new Date(jan4Monday.getTime());
  monday.setUTCDate(monday.getUTCDate() + (week - 1) * 7);
  
  const nextMonday = new Date(monday.getTime());
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  
  return {
    start: monday,
    end: nextMonday
  };
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

const PlanPeriodAggregationExports = {
  // Agrégation principale
  buildPlanPeriodIndex,
  
  // Helpers de date
  getMonday,
  formatDateUTC,
  parseDateUTC,
  generateDateRange,
  getPeriodKey,
  getWeekBounds,
  getMonthBounds,
  isDateInPeriod,
  getPeriodBounds,
  
  // Conversion
  toCentiHours,
  toHours,
  
  // Indexation
  indexEntriesByMemberAndDate,
  indexCapacitiesByMemberAndDate,
  indexAssignmentsByMember
};

// Export pour Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PlanPeriodAggregationExports;
}

// Export pour navigateur
if (typeof window !== 'undefined') {
  window.PlanPeriodAggregation = PlanPeriodAggregationExports;
}

// Export pour globalThis
if (typeof globalThis !== 'undefined') {
  globalThis.PlanPeriodAggregation = PlanPeriodAggregationExports;
}
