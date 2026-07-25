/**
 * Plan Canon Adapter - Adaptateur entre données canoniques et widget Plan
 * 
 * Fait le pont entre :
 * - Le nouveau module d'agrégation canonique (buildPlanPeriodIndex)
 * - Le rendu existant du widget Plan (matrix, rows, capForRow, etc.)
 * 
 * Ce module permet une migration progressive sans réécrire tout le render() d'un coup.
 */

'use strict';

// Dépendances
var PlanPeriodAggregation = (typeof window !== 'undefined' && window.PlanPeriodAggregation) ||
  (typeof module !== 'undefined' && require('./plan-period-aggregation.js'));

var buildPlanPeriodIndex = PlanPeriodAggregation.buildPlanPeriodIndex;
var getPeriodBounds = PlanPeriodAggregation.getPeriodBounds;
var formatDateUTC = PlanPeriodAggregation.formatDateUTC;
var parseDateUTC = PlanPeriodAggregation.parseDateUTC;
var generateDateRange = PlanPeriodAggregation.generateDateRange;

/**
 * Charge et normalise les données Grist pour l'agrégation canonique
 * @param {Object} grist - API Grist
 * @param {Object} state - État actuel du widget (S)
 * @returns {Promise<Object>} Données normalisées pour buildPlanPeriodIndex
 */
async function loadCanonData(grist, state) {
  // Charger toutes les tables nécessaires
  var tables = await Promise.all([
    grist.docApi.fetchTable('Team'),
    grist.docApi.fetchTable('TaskAssignments'),
    grist.docApi.fetchTable('Tasks'),
    grist.docApi.fetchTable('Projects'),
    grist.docApi.fetchTable('Programmes'),
    grist.docApi.fetchTable('TimeEntries'),
    grist.docApi.fetchTable('MemberDailyCapacities'),
    grist.docApi.fetchTable('Feuilles')
  ]);
  
  var teamTable = tables[0];
  var assignmentsTable = tables[1];
  var tasksTable = tables[2];
  var projectsTable = tables[3];
  var programmesTable = tables[4];
  var timeEntriesTable = tables[5];
  var capacitiesTable = tables[6];
  var feuillesTable = tables[7];
  
  // Normaliser Team
  var team = columnarToRows(teamTable).map(function(m) {
    return {
      id: m.id,
      nom: m.nom || '',
      role: m.role || null,
      entite: m.entite || null,
      couleur: m.couleur || '#6366f1',
      actif: m.actif !== false,
      capaciteHebdo: Number(m.capaciteHebdo) || 35
    };
  });
  
  // Filtrer équipe active si nécessaire
  if (state && state.filters && state.filters.team && state.filters.team.length > 0) {
    team = team.filter(function(m) {
      return m.entite && state.filters.team.includes(String(m.entite));
    });
  }
  
  // Normaliser TaskAssignments
  var assignments = columnarToRows(assignmentsTable).map(function(a) {
    return {
      id: a.id,
      tache: a.tache,
      membre: a.membre,
      heuresAllouees: Number(a.heuresAllouees) || 0,
      actif: a.actif !== false,
      dateDebut: a.dateDebut,
      dateFin: a.dateFin,
      modeRepartition: a.modeRepartition || 'uniforme'
    };
  });
  
  // Filtrer assignations actives
  assignments = assignments.filter(function(a) { return a.actif !== false; });
  
  // Normaliser Tasks
  var tasks = columnarToRows(tasksTable).map(function(t) {
    return {
      id: t.id,
      titre: t.titre || '',
      projet: t.projet,
      statut: t.statut,
      dateDebut: t.dateDebut,
      dateEcheance: t.dateEcheance,
      dateCloture: t.dateCloture,
      estimationH: Number(t.estimationH) || 0,
      assignees: t.assignees,
      charges: t.charges,
      progression: Number(t.progression) || 0,
      priorite: t.priorite,
      type: t.type
    };
  });
  
  // Normaliser Projects
  var projects = columnarToRows(projectsTable).map(function(p) {
    return {
      id: p.id,
      nom: p.nom || '',
      couleur: p.couleur || '#64748b',
      programme: p.programme || p.portefeuille
    };
  });
  
  // Normaliser Programmes
  var programmes = columnarToRows(programmesTable).map(function(p) {
    return {
      id: p.id,
      nom: p.nom || '',
      couleur: p.couleur
    };
  });
  
  // Indexer feuilles par ID pour résoudre les statuts
  var feuillesById = {};
  var feuillesRows = columnarToRows(feuillesTable);
  for (var i = 0; i < feuillesRows.length; i++) {
    var f = feuillesRows[i];
    feuillesById[f.id] = {
      id: f.id,
      membre: f.membre,
      semaine: f.semaine,
      statut: f.statut
    };
  }
  
  // Normaliser TimeEntries avec statut de feuille
  var timeEntries = columnarToRows(timeEntriesTable).map(function(e) {
    var feuilleId = e.feuille;
    var feuille = feuilleId ? feuillesById[feuilleId] : null;
    var sheetStatus = normalizeSheetStatus(feuille ? feuille.statut : null);
    
    return {
      id: e.id,
      assignmentId: e.affectation ? Number(e.affectation) : null,
      taskId: e.tache ? Number(e.tache) : null,
      memberId: e.membre ? Number(e.membre) : null,
      date: gristDateToIso(e.date),
      plannedHours: Number(e.heuresPrevues) || 0,
      actualHours: nullableHours(e.heures),
      baseCapacityHours: Number(e.capaciteTheorique) || 0,
      availableCapacityHours: Number(e.capaciteDisponible) || 0,
      capacityRecordId: e.capaciteJour ? Number(e.capaciteJour) : null,
      sheetId: feuilleId ? Number(feuilleId) : null,
      sheetStatus: sheetStatus,
      revisionPlan: Number(e.revisionPlan) || 0,
      isLegacy: !e.affectation || e.affectation === 0
    };
  });
  
  // Filtrer TimeEntries selon l'état (includeDone, filtres)
  if (state) {
    // Filtrer par membre si filtre assignee
    if (state.filters && state.filters.assignee && state.filters.assignee.length > 0) {
      timeEntries = timeEntries.filter(function(e) {
        return state.filters.assignee.includes(String(e.memberId));
      });
    }
    
    // Exclure tâches terminées si includeDone = false
    if (!state.includeDone) {
      var terminalTasks = new Set();
      for (var j = 0; j < tasks.length; j++) {
        if (isTerminal(state.statusCfg, tasks[j].statut)) {
          terminalTasks.add(tasks[j].id);
        }
      }
      timeEntries = timeEntries.filter(function(e) {
        return !terminalTasks.has(e.taskId);
      });
    }
  }
  
  // Normaliser MemberDailyCapacities
  var dailyCapacities = columnarToRows(capacitiesTable).map(function(c) {
    return {
      id: c.id,
      membre: c.membre,
      date: gristDateToIso(c.date),
      capaciteTheorique: Number(c.capaciteTheorique) || 0,
      disponibiliteRatio: c.disponibiliteRatio == null ? 1 : Number(c.disponibiliteRatio),
      capaciteDisponible: Number(c.capaciteDisponible) || 0,
      absenceHeures: Number(c.absenceHeures) || 0,
      source: c.source || 'calcul',
      revision: Number(c.revision) || 1
    };
  });
  
  // Filtrer capacités selon l'équipe active
  var activeMemberIds = new Set(team.map(function(m) { return m.id; }));
  dailyCapacities = dailyCapacities.filter(function(c) {
    return activeMemberIds.has(c.membre);
  });
  
  return {
    team: team,
    assignments: assignments,
    tasks: tasks,
    projects: projects,
    programmes: programmes,
    timeEntries: timeEntries,
    dailyCapacities: dailyCapacities,
    feuillesById: feuillesById
  };
}

/**
 * Construit l'index canonique pour le widget Plan
 * @param {Object} canonData - Données canoniques depuis loadCanonData
 * @param {Object} periodConfig - Configuration des périodes
 * @returns {Object} Index canonique formaté
 */
function buildCanonPlanIndex(canonData, periodConfig) {
  var periods = {
    granularity: periodConfig.granularity || 'week',
    keys: periodConfig.keys || []
  };
  
  return buildPlanPeriodIndex({
    periods: periods,
    team: canonData.team,
    assignments: canonData.assignments,
    tasks: canonData.tasks,
    projects: canonData.projects,
    programmes: canonData.programmes,
    timeEntries: canonData.timeEntries,
    dailyCapacities: canonData.dailyCapacities
  });
}

/**
 * Formate l'index canonique pour compatibilité avec la matrice existante
 * @param {Object} byMemberPeriod - Agrégats par membre/période depuis buildPlanPeriodIndex
 * @param {string} groupBy - Type de groupement ('person', 'project', 'programme', 'role')
 * @param {string} mode - Mode d'affichage ('prevu', 'realise', 'reste', 'dispo')
 * @returns {Object} Matrice compatible avec le rendu existant
 */
function formatCanonMatrixForRender(byMemberPeriod, groupBy, mode) {
  var matrix = {};
  var displayMode = mode || 'prevu';
  
  if (groupBy === 'person') {
    // Clé simple : memberId
    for (var key in byMemberPeriod) {
      var agg = byMemberPeriod[key];
      var parts = key.split(':');
      var memberId = parts[0];
      var periodKey = parts[1];
      
      var matrixKey = memberId;
      if (!matrix[matrixKey]) {
        matrix[matrixKey] = {};
      }
      
      // Utiliser la bonne valeur selon le mode
      var displayValue = 0;
      if (displayMode === 'prevu') {
        displayValue = agg.plannedHours;
      } else if (displayMode === 'realise') {
        displayValue = agg.actualHours;
      } else if (displayMode === 'reste') {
        // Reste = prévu - réalisé (définition métier à confirmer)
        displayValue = Math.max(agg.plannedHours - agg.actualHours, 0);
      } else if (displayMode === 'dispo') {
        // Dispo = capacité disponible - prévu
        displayValue = Math.max(agg.availableCapacityHours - agg.plannedHours, 0);
      }
      
      matrix[matrixKey][periodKey] = displayValue;
    }
  } else if (groupBy === 'project' || groupBy === 'programme' || groupBy === 'role') {
    // Clé composite : "groupe|memberId"
    // L'index canonique est par memberId, il faut le redistribuer
    
    // D'abord, regrouper par membre
    var byMemberId = {};
    for (var key2 in byMemberPeriod) {
      var agg2 = byMemberPeriod[key2];
      var parts2 = key2.split(':');
      var memberId2 = parts2[0];
      var periodKey2 = parts2[1];
      
      if (!byMemberId[memberId2]) {
        byMemberId[memberId2] = {};
      }
      byMemberId[memberId2][periodKey2] = agg2;
    }
    
    // Ensuite, créer les clés composites selon le groupement
    // Cette logique dépend de keyFn() du widget Plan
    // Pour une migration complète, il faudrait connaître la fonction keyFn()
    
    // Version simplifiée : on garde par memberId
    for (var memberId3 in byMemberId) {
      for (var periodKey3 in byMemberId[memberId3]) {
        var matrixKey3 = memberId3;
        if (!matrix[matrixKey3]) {
          matrix[matrixKey3] = {};
        }
        
        var agg3 = byMemberId[memberId3][periodKey3];
        var displayValue3 = 0;
        if (displayMode === 'prevu') {
          displayValue3 = agg3.plannedHours;
        } else if (displayMode === 'realise') {
          displayValue3 = agg3.actualHours;
        } else if (displayMode === 'reste') {
          displayValue3 = Math.max(agg3.plannedHours - agg3.actualHours, 0);
        } else if (displayMode === 'dispo') {
          displayValue3 = Math.max(agg3.availableCapacityHours - agg3.plannedHours, 0);
        }
        
        matrix[matrixKey3][periodKey3] = displayValue3;
      }
    }
  }
  
  return matrix;
}
        byMemberId[memberId2] = {};
      }
      byMemberId[memberId2][periodKey2] = agg2;
    }
    
    // Ensuite, créer les clés composites selon le groupement
    // Cette logique dépend de keyFn() du widget Plan
    // Pour une migration complète, il faudrait connaître la fonction keyFn()
    
    // Version simplifiée : on garde par memberId
    for (var memberId3 in byMemberId) {
      for (var periodKey3 in byMemberId[memberId3]) {
        var matrixKey3 = memberId3;
        if (!matrix[matrixKey3]) {
          matrix[matrixKey3] = {};
        }
        matrix[matrixKey3][periodKey3] = byMemberId[memberId3][periodKey3].plannedHours;
      }
    }
  }
  
  return matrix;
}

/**
 * Calcule la capacité pour une ligne/ressource sur une période
 * Remplace capForRow() qui utilisait capPeriod() et indispoFrac()
 * @param {Object} row - Ligne de ressource (avec members)
 * @param {string} periodKey - Clé de période (YYYY-MM ou YYYY-Www)
 * @param {string} granularity - 'week' ou 'month'
 * @param {Array} dailyCapacities - Capacités quotidiennes
 * @returns {number} Capacité totale en heures
 */
function getCapacityForRow(row, periodKey, granularity, dailyCapacities) {
  if (!row || !row.members || !row.members.length) {
    return 0;
  }
  
  // Obtenir les bornes de la période
  var bounds = getPeriodBounds(periodKey, granularity);
  if (!bounds) {
    return 0;
  }
  
  var start = bounds.start;
  var end = bounds.end;
  
  // Générer les dates de la période
  var dates = [];
  var current = new Date(start.getTime());
  while (current < end) {
    dates.push(formatDateUTC(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  
  // Sommer les capacités de tous les membres sur toutes les dates
  var totalCapacity = 0;
  
  for (var i = 0; i < row.members.length; i++) {
    var member = row.members[i];
    var memberId = member.id;
    
    for (var j = 0; j < dates.length; j++) {
      var dateStr = dates[j];
      
      // Trouver la capacité pour ce membre à cette date
      for (var k = 0; k < dailyCapacities.length; k++) {
        var cap = dailyCapacities[k];
        if (cap.membre === memberId && cap.date === dateStr) {
          totalCapacity += cap.capaciteDisponible || 0;
          break;
        }
      }
    }
  }
  
  return totalCapacity;
}

/**
 * Vérifie si une ligne a une capacité réduite sur une période
 * Remplace rowReduced() qui utilisait indispoFrac()
 * @param {Object} row - Ligne de ressource
 * @param {string} periodKey - Clé de période
 * @param {string} granularity - 'week' ou 'month'
 * @param {Array} dailyCapacities - Capacités quotidiennes
 * @returns {boolean} true si capacité réduite
 */
function isRowCapacityReduced(row, periodKey, granularity, dailyCapacities) {
  if (!row || !row.members || !row.members.length) {
    return false;
  }
  
  var bounds = getPeriodBounds(periodKey, granularity);
  if (!bounds) {
    return false;
  }
  
  var start = bounds.start;
  var end = bounds.end;
  
  var current = new Date(start.getTime());
  while (current < end) {
    var dateStr = formatDateUTC(current);
    
    for (var i = 0; i < row.members.length; i++) {
      var member = row.members[i];
      var memberId = member.id;
      
      for (var j = 0; j < dailyCapacities.length; j++) {
        var cap = dailyCapacities[j];
        if (cap.membre === memberId && cap.date === dateStr) {
          // Capacité réduite si absenceHeures > 0 ou ratio < 1
          if ((cap.absenceHeures || 0) > 0 || (cap.disponibiliteRatio || 1) < 1) {
            return true;
          }
        }
      }
    }
    
    current.setUTCDate(current.getUTCDate() + 1);
  }
  
  return false;
}

/**
 * Calcule la capacité totale de l'équipe sur une période
 * Remplace le calcul du pied de colonne qui utilisait capPeriod() et indispoFrac()
 * @param {Array} team - Équipe complète
 * @param {string} periodKey - Clé de période
 * @param {string} granularity - 'week' ou 'month'
 * @param {Array} dailyCapacities - Capacités quotidiennes
 * @returns {number} Capacité totale de l'équipe
 */
function getTeamCapacity(team, periodKey, granularity, dailyCapacities) {
  var bounds = getPeriodBounds(periodKey, granularity);
  if (!bounds) {
    return 0;
  }
  
  var start = bounds.start;
  var end = bounds.end;
  
  var dates = [];
  var current = new Date(start.getTime());
  while (current < end) {
    dates.push(formatDateUTC(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  
  var totalCapacity = 0;
  
  for (var i = 0; i < team.length; i++) {
    var member = team[i];
    if (!member.actif) continue;
    
    var memberId = member.id;
    
    for (var j = 0; j < dates.length; j++) {
      var dateStr = dates[j];
      
      for (var k = 0; k < dailyCapacities.length; k++) {
        var cap = dailyCapacities[k];
        if (cap.membre === memberId && cap.date === dateStr) {
          totalCapacity += cap.capaciteDisponible || 0;
          break;
        }
      }
    }
  }
  
  return totalCapacity;
}

/**
 * Obtient les tâches dans une cellule pour le détail (drill-down)
 * Remplace tasksInCell() qui utilisait un filtrage manuel des TimeEntries
 * @param {Object} canonIndex - Index canonique depuis buildPlanPeriodIndex
 * @param {string} key - Clé de la cellule (memberId ou composite "groupe|memberId")
 * @param {string} period - Clé de période
 * @param {Array} tasks - Tableau des tâches pour résoudre les détails
 * @returns {Array} Tableau de tâches avec heures planifiées et détails de tâche
 */
function getTasksInCell(canonIndex, key, period, tasks) {
  // Extraire le memberId de la clé (peut être composite)
  var memberId;
  var parts = key.split('|');
  if (parts.length === 2) {
    // Clé composite : "groupe|memberId"
    memberId = parts[1];
  } else {
    // Clé simple : memberId
    memberId = key;
  }
  
  var memberPeriodKey = memberId + ':' + period;
  var agg = canonIndex.byMemberPeriod[memberPeriodKey];
  
  if (!agg || !agg.entries || !agg.entries.length) {
    return [];
  }
  
  // Indexer les tâches par ID pour résolution rapide
  var taskById = {};
  if (tasks) {
    for (var i = 0; i < tasks.length; i++) {
      taskById[tasks[i].id] = tasks[i];
    }
  }
  
  // Regrouper par taskId
  var byTaskId = {};
  for (var i = 0; i < agg.entries.length; i++) {
    var entry = agg.entries[i];
    var taskId = entry.taskId;
    
    if (!byTaskId[taskId]) {
      byTaskId[taskId] = {
        taskId: taskId,
        plannedHours: 0,
        entries: []
      };
    }
    
    byTaskId[taskId].plannedHours += entry.plannedHours;
    byTaskId[taskId].entries.push(entry);
  }
  
  // Convertir en tableau trié avec les détails de tâche
  var result = [];
  for (var taskId2 in byTaskId) {
    var item = byTaskId[taskId2];
    var task = taskById[taskId2];
    
    result.push({
      task: task || { id: taskId2, titre: 'Tâche ' + taskId2, projet: null },
      taskId: item.taskId,
      slice: item.plannedHours,
      total: item.plannedHours,
      entries: item.entries
    });
  }
  
  result.sort(function(a, b) { return b.slice - a.slice; });
  
  return result;
}

/**
 * Calcule la disponibilité des membres pour une période (pour le panel de réaffectation)
 * Remplace memberAvail() qui utilisait capPeriod() et indispoFrac()
 * @param {Array} team - Équipe complète
 * @param {string} periodKey - Clé de période
 * @param {string} granularity - 'week' ou 'month'
 * @param {Object} canonIndex - Index canonique
 * @param {Array} dailyCapacities - Capacités quotidiennes
 * @returns {Object} Map memberId → { load, cap, free }
 */
function calculateMemberAvailability(team, periodKey, granularity, canonIndex, dailyCapacities) {
  var result = {};
  
  for (var i = 0; i < team.length; i++) {
    var member = team[i];
    if (!member.actif) continue;
    
    var memberId = member.id;
    var memberPeriodKey = memberId + ':' + periodKey;
    var agg = canonIndex.byMemberPeriod[memberPeriodKey];
    
    // Charge = heures planifiées
    var load = agg ? agg.plannedHours : 0;
    
    // Capacité = somme des capacités quotidiennes
    var cap = getCapacityForMemberPeriod(memberId, periodKey, granularity, dailyCapacities);
    
    // Libre = max(cap - load, 0)
    var free = Math.max(cap - load, 0);
    
    result[memberId] = {
      load: Math.round(load * 10) / 10,
      cap: Math.round(cap * 10) / 10,
      free: Math.round(free * 10) / 10
    };
  }
  
  return result;
}

/**
 * Calcule la capacité pour un membre sur une période
 * @param {number} memberId - ID du membre
 * @param {string} periodKey - Clé de période
 * @param {string} granularity - 'week' ou 'month'
 * @param {Array} dailyCapacities - Capacités quotidiennes
 * @returns {number} Capacité en heures
 */
function getCapacityForMemberPeriod(memberId, periodKey, granularity, dailyCapacities) {
  var bounds = getPeriodBounds(periodKey, granularity);
  if (!bounds) {
    return 0;
  }
  
  var start = bounds.start;
  var end = bounds.end;
  
  var totalCapacity = 0;
  var current = new Date(start.getTime());
  
  while (current < end) {
    var dateStr = formatDateUTC(current);
    
    for (var i = 0; i < dailyCapacities.length; i++) {
      var cap = dailyCapacities[i];
      if (cap.membre === memberId && cap.date === dateStr) {
        totalCapacity += cap.capaciteDisponible || 0;
        break;
      }
    }
    
    current.setUTCDate(current.getUTCDate() + 1);
  }
  
  return totalCapacity;
}

// ============================================================================
// HELPERS DE NORMALISATION (copiés depuis time-entry-loader pour autonomie)
// ============================================================================

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
    var date2 = new Date(value * 1000);
    if (!isNaN(date2.getTime())) {
      return formatDateUTC(date2);
    }
  }
  if (value instanceof Date) {
    return formatDateUTC(value);
  }
  return null;
}

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

function nullableHours(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }
  
  var parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTerminal(statusCfg, value) {
  if (!statusCfg || !statusCfg.terminalValue) {
    return false;
  }
  return value === statusCfg.terminalValue;
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

var PlanCanonAdapterExports = {
  loadCanonData: loadCanonData,
  buildCanonPlanIndex: buildCanonPlanIndex,
  formatCanonMatrixForRender: formatCanonMatrixForRender,
  getCapacityForRow: getCapacityForRow,
  isRowCapacityReduced: isRowCapacityReduced,
  getTeamCapacity: getTeamCapacity,
  getTasksInCell: getTasksInCell,
  calculateMemberAvailability: calculateMemberAvailability,
  getCapacityForMemberPeriod: getCapacityForMemberPeriod
};

// Export pour Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PlanCanonAdapterExports;
}

// Export pour navigateur
if (typeof window !== 'undefined') {
  window.PlanCanonAdapter = PlanCanonAdapterExports;
}

// Export pour globalThis
if (typeof globalThis !== 'undefined') {
  globalThis.PlanCanonAdapter = PlanCanonAdapterExports;
}
