/**
 * Planning Generator Service - Orchestration de la génération du planning
 * 
 * Service principal qui coordonne :
 * 1. Le calcul des capacités quotidiennes
 * 2. La prévisualisation du planning
 * 3. La génération des TimeEntries
 * 4. La régénération après modification
 */

'use strict';

const { getDocApi } = require('../../grist/grist-api-helper.js');
const { 
  parseDateUTC, 
  formatDateUTC, 
  addDaysUTC, 
  compareDates,
  datesAreEqual,
  getDaysInRange 
} = require('../planning-engine.js');

const { buildDesiredMemberDailyCapacities } = require('../../capacity/member-daily-capacity-service.js');
const { planAssignment, validateAssignment } = require('../time_entry/time-entry-planning-service.js');

// ============================================================================
// CRÉATION DU SERVICE
// ============================================================================

/**
 * Crée une instance du service de génération de planning
 * @param {Object} grist - Grist API
 * @param {Object} options - Options de configuration
 * @returns {Object} Service API
 */
function createPlanningGeneratorService(grist, options = {}) {
  const logEnabled = options.logEnabled || false;
  
  function log(message, data) {
    if (logEnabled && console) {
      console.log('[PlanningGenerator]', message, data || '');
    }
  }
  
  // ============================================================================
  // CHARGEMENT DES DONNÉES
  // ============================================================================
  
  /**
   * Charge toutes les données nécessaires pour la planification
   */
  async function loadPlanningData(options = {}) {
    const { 
      assignmentIds = null,  // null = tous, array = spécifiques
      dateFrom = null,
      dateTo = null
    } = options;
    
    const api = getDocApi(grist);
    
    // Charger les affectations
    let assignments = await api.fetchTable('TaskAssignments');
    assignments = columnarToRows(assignments);
    
    // Filtrer si des IDs spécifiques sont demandés
    if (assignmentIds && Array.isArray(assignmentIds)) {
      assignments = assignments.filter(a => assignmentIds.includes(a.id));
    }
    
    // Filtrer les affectations actives avec des heures
    assignments = assignments.filter(a => 
      a.actif !== false && 
      a.heuresAllouees > 0 &&
      a.dateDebut &&
      a.dateFin
    );
    
    // Charger les membres
    let members = await api.fetchTable('Team');
    members = columnarToRows(members);
    
    // Charger les tâches
    let tasks = await api.fetchTable('Tasks');
    tasks = columnarToRows(tasks);
    
    // Charger les disponibilités
    let availabilities = await api.fetchTable('Disponibilites');
    availabilities = columnarToRows(availabilities);
    
    // Charger les capacités existantes
    let capacities = await api.fetchTable('MemberDailyCapacities');
    capacities = columnarToRows(capacities);
    
    // Charger le planning existant
    let existingEntries = await api.fetchTable('TimeEntries');
    existingEntries = columnarToRows(existingEntries);
    
    // Déterminer la période à couvrir
    let effectiveDateFrom = dateFrom;
    let effectiveDateTo = dateTo;
    
    if (assignments.length > 0) {
      const minDate = Math.min(...assignments.map(a => a.dateDebut));
      const maxDate = Math.max(...assignments.map(a => a.dateFin));
      
      if (!effectiveDateFrom || minDate < effectiveDateFrom) {
        effectiveDateFrom = minDate;
      }
      if (!effectiveDateTo || maxDate > effectiveDateTo) {
        effectiveDateTo = maxDate;
      }
    }
    
    // Étendre la période de 7 jours avant/après pour être sûr
    if (effectiveDateFrom) {
      effectiveDateFrom = addDaysUTC(new Date(effectiveDateFrom * 1000), -7).getTime() / 1000;
    }
    if (effectiveDateTo) {
      effectiveDateTo = addDaysUTC(new Date(effectiveDateTo * 1000), 7).getTime() / 1000;
    }
    
    return {
      assignments,
      members,
      tasks,
      availabilities,
      capacities,
      existingEntries,
      dateFrom: effectiveDateFrom,
      dateTo: effectiveDateTo
    };
  }
  
  // ============================================================================
  // PRÉVISUALISATION
  // ============================================================================
  
  /**
   * Prévisualise la génération du planning sans écrire
   */
  async function previewPlanning(options = {}) {
    log('Prévisualisation du planning', options);
    
    const result = {
      ok: true,
      capacities: {
        creates: [],
        updates: [],
        unchanged: [],
        conflicts: []
      },
      timeEntries: {
        creates: [],
        updates: [],
        removals: [],
        unchanged: [],
        locked: []
      },
      assignments: {
        planned: [],
        invalid: [],
        insufficientCapacity: []
      },
      totals: {
        allocatedHours: 0,
        plannedHours: 0,
        unallocatedHours: 0
      },
      warnings: [],
      errors: []
    };
    
    try {
      // Charger les données
      const data = await loadPlanningData(options);
      
      if (data.assignments.length === 0) {
        log('Aucune affectation à planifier');
        return result;
      }
      
      // 1. Calculer les capacités souhaitées
      const desiredCapacities = buildDesiredMemberDailyCapacities({
        members: data.members,
        availabilities: data.availabilities,
        dateFrom: data.dateFrom,
        dateTo: data.dateTo,
        defaultWeeklyCapacity: options.defaultWeeklyCapacity || 35
      });
      
      // Comparer avec les capacités existantes
      const capacityMap = new Map();
      data.capacities.forEach(c => {
        const key = `${c.membre}-${c.date}`;
        capacityMap.set(key, c);
      });
      
      desiredCapacities.forEach(desired => {
        const key = `${desired.membre}-${desired.date}`;
        const existing = capacityMap.get(key);
        
        if (!existing) {
          result.capacities.creates.push(desired);
        } else {
          // Vérifier si changement
          const hasChanges = 
            Math.abs((existing.capaciteTheorique || 0) - (desired.capaciteTheorique || 0)) > 0.001 ||
            Math.abs((existing.capaciteDisponible || 0) - (desired.capaciteDisponible || 0)) > 0.001 ||
            Math.abs((existing.disponibiliteRatio || 0) - (desired.disponibiliteRatio || 0)) > 0.001;
          
          if (hasChanges) {
            result.capacities.updates.push({
              ...desired,
              id: existing.id
            });
          } else {
            result.capacities.unchanged.push(existing.id);
          }
        }
      });
      
      // 2. Construire le contexte de planification
      const capacityByMemberDate = new Map();
      [...data.capacities, ...result.capacities.creates, ...result.capacities.updates].forEach(c => {
        const key = `${c.membre}-${formatDateUTC(new Date(c.date * 1000))}`;
        capacityByMemberDate.set(key, c);
      });
      
      const context = {
        members: data.members,
        tasks: data.tasks,
        capacities: [...data.capacities, ...result.capacities.creates],
        existingEntries: data.existingEntries.filter(e => 
          !e.feuille && // Pas de feuille
          (!e.heures || e.heures === 0) // Pas d'heures réalisées
        )
      };
      
      // 3. Planifier chaque affectation
      // Trier par ordre déterministe : dateFin, dateDebut, tache, affectation
      const sortedAssignments = [...data.assignments].sort((a, b) => {
        if (a.dateFin !== b.dateFin) return a.dateFin - b.dateFin;
        if (a.dateDebut !== b.dateDebut) return a.dateDebut - b.dateDebut;
        if (a.tache !== b.tache) return a.tache - b.tache;
        return a.id - b.id;
      });
      
      // Suivi du planning par membre et date
      const memberPlanByDate = {};
      
      data.existingEntries.forEach(e => {
        if (e.membre && e.date) {
          const key = `${e.membre}-${formatDateUTC(new Date(e.date * 1000))}`;
          memberPlanByDate[key] = (memberPlanByDate[key] || 0) + (e.heuresPrevues || 0);
        }
      });
      
      for (const assignment of sortedAssignments) {
        // Valider
        const validation = validateAssignment(assignment, context);
        
        if (!validation.valid) {
          result.assignments.invalid.push({
            assignmentId: assignment.id,
            errors: validation.errors
          });
          result.warnings.push(...validation.warnings);
          continue;
        }
        
        // Préparer le contexte pour cette affectation
        const assignmentContext = {
          ...context,
          capacities: context.capacities.filter(c => c.membre === assignment.membre),
          existingEntries: context.existingEntries.filter(e => e.membre === assignment.membre)
        };
        
        // Ajouter le planning déjà calculé pour ce membre
        const existingPlan = {};
        for (const [key, hours] of Object.entries(memberPlanByDate)) {
          if (key.startsWith(`${assignment.membre}-`)) {
            const date = key.split('-')[1];
            existingPlan[date] = hours;
          }
        }
        assignmentContext.existingPlan = existingPlan;
        
        // Planifier
        const planResult = planAssignment(assignment, assignmentContext);
        
        if (planResult.errors) {
          result.assignments.invalid.push({
            assignmentId: assignment.id,
            errors: planResult.errors
          });
        } else if (planResult.unallocatedHours > 0) {
          result.assignments.insufficientCapacity.push({
            assignmentId: assignment.id,
            allocatedHours: assignment.heuresAllouees,
            plannedHours: assignment.heuresAllouees - planResult.unallocatedHours,
            unallocatedHours: planResult.unallocatedHours,
            reason: 'INSUFFICIENT_CAPACITY'
          });
          
          if (!options.allowPartialPlanning) {
            result.errors.push({
              code: 'INSUFFICIENT_CAPACITY',
              assignmentId: assignment.id,
              unallocatedHours: planResult.unallocatedHours
            });
          }
        } else {
          result.assignments.planned.push({
            assignmentId: assignment.id,
            plannedHours: assignment.heuresAllouees
          });
        }
        
        result.warnings.push(...planResult.warnings);
        
        // Ajouter au planning global
        planResult.plannedEntries.forEach(entry => {
          const dateKey = `${entry.membre}-${formatDateUTC(new Date(entry.date * 1000))}`;
          memberPlanByDate[dateKey] = (memberPlanByDate[dateKey] || 0) + entry.heuresPrevues;
        });
        
        // Ajouter les entrées à créer
        result.timeEntries.creates.push(...planResult.plannedEntries);
        
        // Totaux
        result.totals.allocatedHours += assignment.heuresAllouees;
        const plannedForAssignment = planResult.plannedEntries.reduce((sum, e) => sum + e.heuresPrevues, 0);
        result.totals.plannedHours += plannedForAssignment;
        result.totals.unallocatedHours += planResult.unallocatedHours;
      }
      
      // Arrondir les totaux
      result.totals.allocatedHours = Math.round(result.totals.allocatedHours * 100) / 100;
      result.totals.plannedHours = Math.round(result.totals.plannedHours * 100) / 100;
      result.totals.unallocatedHours = Math.round(result.totals.unallocatedHours * 100) / 100;
      
      // Vérifier les erreurs bloquantes
      if (result.errors.length > 0) {
        result.ok = false;
      }
      
      log('Prévisualisation terminée', {
        assignments: result.assignments.planned.length,
        creates: result.timeEntries.creates.length,
        errors: result.errors.length
      });
      
      return result;
      
    } catch (error) {
      log('Erreur de prévisualisation', error);
      result.ok = false;
      result.errors.push({
        code: 'PREVIEW_ERROR',
        message: error.message
      });
      return result;
    }
  }
  
  // ============================================================================
  // COMMIT
  // ============================================================================
  
  /**
   * Exécute la génération du planning
   */
  async function commitPlanning(preview) {
    log('Commit du planning');
    
    if (!preview || !preview.ok) {
      throw new Error('Cannot commit invalid or failed preview');
    }
    
    const api = getDocApi(grist);
    const actions = [];
    
    // 1. Créer/mettre à jour les capacités
    for (const capacity of preview.capacities.creates) {
      actions.push(['AddRecord', 'MemberDailyCapacities', null, {
        membre: capacity.membre,
        date: capacity.date,
        capaciteTheorique: capacity.capaciteTheorique,
        disponibiliteRatio: capacity.disponibiliteRatio,
        capaciteDisponible: capacity.capaciteDisponible,
        absenceHeures: capacity.absenceHeures,
        source: capacity.source,
        revision: 1,
        sourceUpdatedAt: Math.floor(Date.now() / 1000),
        commentaire: capacity.commentaire
      }]);
    }
    
    for (const capacity of preview.capacities.updates) {
      actions.push(['UpdateRecord', 'MemberDailyCapacities', capacity.id, {
        capaciteTheorique: capacity.capaciteTheorique,
        disponibiliteRatio: capacity.disponibiliteRatio,
        capaciteDisponible: capacity.capaciteDisponible,
        absenceHeures: capacity.absenceHeures,
        revision: (capacity.revision || 0) + 1,
        sourceUpdatedAt: Math.floor(Date.now() / 1000),
        commentaire: capacity.commentaire
      }]);
    }
    
    // 2. Créer les TimeEntries
    for (const entry of preview.timeEntries.creates) {
      actions.push(['AddRecord', 'TimeEntries', null, {
        membre: entry.membre,
        tache: entry.tache,
        affectation: entry.affectation,
        date: entry.date,
        heuresPrevues: entry.heuresPrevues,
        capaciteTheorique: entry.capaciteTheorique,
        capaciteDisponible: entry.capaciteDisponible,
        capaciteJour: entry.capaciteJour,
        revisionPlan: entry.revisionPlan
      }]);
    }
    
    // Exécuter les actions
    if (actions.length > 0) {
      const results = await api.applyUserActions(actions);
      log('Actions exécutées', { count: actions.length });
      
      return {
        ok: true,
        capacitiesCreated: preview.capacities.creates.length,
        capacitiesUpdated: preview.capacities.updates.length,
        timeEntriesCreated: preview.timeEntries.creates.length,
        timeEntriesUpdated: preview.timeEntries.updates.length,
        timeEntriesRemoved: preview.timeEntries.removals.length,
        actionsExecuted: actions.length
      };
    } else {
      log('Aucune action nécessaire');
      return {
        ok: true,
        actionsExecuted: 0
      };
    }
  }
  
  // ============================================================================
  // RÉGÉNÉRATION
  // ============================================================================
  
  /**
   * Régénère le planning pour une tâche spécifique
   */
  async function regenerateTaskPlanning(taskId) {
    log('Régénération du planning pour la tâche', taskId);
    
    // Prévisualiser
    const preview = await previewPlanning({
      assignmentIds: null // Tous, mais on filtrera par tâche
    });
    
    if (!preview.ok) {
      return {
        ok: false,
        errors: preview.errors,
        warnings: preview.warnings
      };
    }
    
    // Filtrer pour ne garder que les entrées liées à cette tâche
    const filteredPreview = {
      ...preview,
      timeEntries: {
        creates: preview.timeEntries.creates.filter(e => e.tache === taskId),
        updates: [],
        removals: [],
        unchanged: [],
        locked: []
      }
    };
    
    // Commit
    return await commitPlanning(filteredPreview);
  }
  
  // ============================================================================
  // EXPORT PUBLIC
  // ============================================================================
  
  return {
    previewPlanning,
    commitPlanning,
    regenerateTaskPlanning,
    loadPlanningData
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

module.exports = {
  createPlanningGeneratorService
};
