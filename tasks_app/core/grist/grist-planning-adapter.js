/**
 * Grist Planning Adapter - Adaptateur entre le moteur métier et Grist
 * 
 * Fournit une couche d'abstraction pour :
 * - La conversion des dates Grist ↔ ISO UTC
 * - La normalisation des statuts
 * - La construction des capacités quotidiennes
 * - La réconciliation des plans avec Grist
 */

'use strict';

const { buildAssignmentPlan, toCentiHours, toHours, parseDateUTC, formatDateUTC, addDaysUTC } = require('../planning/planning-engine.js');
const { reconcileDailyEntries } = require('../planning/planning-reconciliation.js');
const { getDocApi } = require('./grist-api-helper.js');

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
 * Construit les capacités quotidiennes pour un membre
 * @param {Object} input - Paramètres d'entrée
 * @param {Object} input.member - Membre avec capaciteHebdo
 * @param {Array} input.availabilities - Disponibilités du membre
 * @param {string} input.startDate - Date de début (ISO)
 * @param {string} input.endDate - Date de fin (ISO)
 * @param {number} [input.defaultWeeklyCapacityHours=35] - Capacité hebdo par défaut
 * @returns {Object} Résultat avec capacities et diagnostics
 */
function buildMemberDailyCapacities(input) {
  const diagnostics = [];
  
  const {
    member,
    availabilities,
    startDate,
    endDate,
    defaultWeeklyCapacityHours = DEFAULT_WEEKLY_CAPACITY
  } = input;
  
  // Capacité hebdomadaire
  let weeklyCapacity = member?.capaciteHebdo;
  
  if (weeklyCapacity === null || weeklyCapacity === undefined || weeklyCapacity === '') {
    weeklyCapacity = defaultWeeklyCapacityHours;
    diagnostics.push({
      code: 'DEFAULT_CAPACITY_USED',
      message: `Capacité hebdomadaire par défaut utilisée : ${weeklyCapacity}h`
    });
  }
  
  // Capacité quotidienne de base (lundi-vendredi)
  const dailyBaseCapacity = weeklyCapacity / DAYS_PER_WEEK;
  
  // Générer les dates
  const dates = [];
  const current = parseDateUTC(startDate);
  const end = parseDateUTC(endDate);
  
  if (!current || !end) {
    return {
      capacities: [],
      diagnostics: [{
        code: 'INVALID_DATE_RANGE',
        message: 'Intervalle de dates invalide'
      }]
    };
  }
  
  // Traiter les disponibilités
  const availabilityMap = new Map();
  
  for (const avail of availabilities || []) {
    const availStart = parseDateUTC(gristDateToIso(avail.dateDebut));
    const availEnd = parseDateUTC(gristDateToIso(avail.dateFin));
    const dispoRatio = typeof avail.dispo === 'number' ? avail.dispo : 1;
    
    if (!availStart || !availEnd) continue;
    
    // Marquer les dates couvertes par cette disponibilité
    let d = new Date(availStart.getTime());
    while (d <= availEnd) {
      const dateStr = formatDateUTC(d);
      const existingRatio = availabilityMap.get(dateStr);
      
      // Prendre le ratio le plus restrictif (minimum)
      if (existingRatio === undefined || dispoRatio < existingRatio) {
        availabilityMap.set(dateStr, dispoRatio);
      }
      
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  
  // Construire les capacités quotidiennes
  let d = new Date(current.getTime());
  while (d <= end) {
    const dateStr = formatDateUTC(d);
    const dayOfWeek = d.getUTCDay();
    
    // Week-end = 0
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
    
    let baseCapacity = 0;
    let availableCapacity = 0;
    
    if (!isWeekend) {
      baseCapacity = dailyBaseCapacity;
      
      // Appliquer le ratio de disponibilité
      const dispoRatio = availabilityMap.get(dateStr);
      
      if (dispoRatio !== undefined) {
        availableCapacity = baseCapacity * dispoRatio;
      } else {
        availableCapacity = baseCapacity;
      }
    }
    
    // Arrondir à 0,01h
    baseCapacity = toHours(Math.round(baseCapacity * 100));
    availableCapacity = toHours(Math.round(availableCapacity * 100));
    
    dates.push({
      date: dateStr,
      baseCapacityHours: baseCapacity,
      availableCapacityHours: availableCapacity
    });
    
    d.setUTCDate(d.getUTCDate() + 1);
  }
  
  return {
    capacities: dates,
    diagnostics
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
 * @returns {Promise<Object>} Contexte adapté pour buildAssignmentPlan
 */
async function loadAssignmentContext(grist, assignmentId, options = {}) {
  const docApi = getDocApi(grist);
  const {
    includeAllEntries = true
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
          feuille: e.feuille || null
        };
      });
    
    return {
      error: {
        code: 'ASSIGNMENT_INACTIVE_CLEANUP',
        assignmentId,
        message: 'Une affectation inactive nécessite un nettoyage contrôlé',
        existingEntries: existingEntriesForInactive
      }
    };
  }
  
  // Mapper les données
  const task = tasks.find(t => t.id === assignment.tache);
  const member = team.find(m => m.id === assignment.membre);
  
  if (!task || !member) {
    return {
      error: {
        code: 'RELATED_DATA_NOT_FOUND',
        taskId: assignment.tache,
        memberId: assignment.membre
      }
    };
  }
  
  // Construire les capacités
  const capacityResult = buildMemberDailyCapacities({
    member,
    availabilities: availabilities.filter(a => a.membre === assignment.membre),
    startDate: gristDateToIso(assignment.dateDebut),
    endDate: gristDateToIso(assignment.dateFin),
    defaultWeeklyCapacityHours: DEFAULT_WEEKLY_CAPACITY
  });
  
  // Mapper les entrées existantes et détecter les entrées orphelines
  const diagnostics = [...(capacityResult.diagnostics || [])];
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
        baseCapacityHours: e.capaciteTheorique || 0,
        availableCapacityHours: e.capaciteDisponible || 0
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
    capacities: capacityResult.capacities,
    existingEntries,
    diagnostics
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
    replanFromDate,
    precisionHours = 0.01,
    capacityPolicy = 'cap'
  } = options;
  
  // Charger le contexte
  const context = await loadAssignmentContext(grist, assignmentId, options);
  
  if (context.error) {
    return {
      success: false,
      error: context.error,
      desiredPlan: [],
      summary: null,
      diagnostics: [],
      diff: null
    };
  }
  
  const { assignment, capacities, existingEntries, diagnostics } = context;
  
  // Appeler le moteur de planification
  const planResult = buildAssignmentPlan({
    assignment,
    capacities,
    existingEntries,
    replanFromDate,
    precisionHours,
    capacityPolicy
  });
  
  // Réconcilier (en mode simulation)
  const diff = reconcileDailyEntries(existingEntries, planResult.desiredPlan, {
    precisionHours
  });
  
  return {
    success: true,
    assignmentId,
    desiredPlan: planResult.desiredPlan,
    summary: planResult.summary,
    diagnostics: [...(diagnostics || []), ...planResult.diagnostics],
    diff,
    context
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
    replanFromDate,
    precisionHours = 0.01,
    capacityPolicy = 'cap'
  } = options;
  
  // Charger le contexte
  const context = await loadAssignmentContext(grist, assignmentId, options);
  
  if (context.error) {
    return {
      success: false,
      error: context.error,
      actionsExecuted: 0,
      actions: []
    };
  }
  
  const { assignment, capacities, existingEntries, diagnostics } = context;
  
  // Appeler le moteur de planification
  const planResult = buildAssignmentPlan({
    assignment,
    capacities,
    existingEntries,
    replanFromDate,
    precisionHours,
    capacityPolicy
  });
  
  // Vérifier les diagnostics bloquants
  const allDiagnostics = [...(diagnostics || []), ...planResult.diagnostics];
  const blockingDiagnostics = allDiagnostics.filter(isBlockingDiagnostic);
  
  if (blockingDiagnostics.length > 0) {
    return {
      success: false,
      error: {
        code: 'BLOCKING_DIAGNOSTICS',
        diagnostics: blockingDiagnostics
      },
      actionsExecuted: 0,
      actions: [],
      diagnostics: allDiagnostics
    };
  }
  
  // Réconcilier
  const diff = reconcileDailyEntries(existingEntries, planResult.desiredPlan, {
    precisionHours
  });
  
  // S'il y a des conflits, bloquer
  if (diff.conflicts && diff.conflicts.length > 0) {
    return {
      success: false,
      error: {
        code: 'CONFLICTS_DETECTED',
        conflicts: diff.conflicts
      },
      actionsExecuted: 0,
      actions: [],
      diff,
      diagnostics: allDiagnostics
    };
  }
  
  // Transformer le diff en actions Grist
  const existingEntriesMap = new Map();
  for (const entry of existingEntries) {
    existingEntriesMap.set(entry.id, entry);
  }
  const actions = diffToGristActions(diff, assignment, capacities, existingEntriesMap);
  
  if (dryRun || actions.length === 0) {
    return {
      success: true,
      dryRun,
      actionsExecuted: 0,
      actions,
      diff,
      summary: planResult.summary,
      diagnostics: allDiagnostics
    };
  }
  
  // Appliquer les actions
  try {
    await docApi.applyUserActions(actions);
    
    return {
      success: true,
      actionsExecuted: actions.length,
      actions,
      diff,
      summary: planResult.summary,
      diagnostics: allDiagnostics
    };
  } catch (e) {
    return {
      success: false,
      error: {
        code: 'GRIST_ACTION_FAILED',
        message: e.message || String(e)
      },
      actionsExecuted: 0,
      actions,
      diff,
      diagnostics: allDiagnostics
    };
  }
}

/**
 * Transforme un diff en actions Grist
 * @param {Object} diff - Résultat de reconcileDailyEntries
 * @param {Object} assignment - Affectation de référence
 * @param {Array} capacities - Capacités par date
 * @param {Map} existingEntriesMap - Map id -> entrée existante pour revisionPlan
 * @returns {Array} Actions Grist
 */
function diffToGristActions(diff, assignment, capacities, existingEntriesMap = new Map()) {
  const actions = [];
  const capacityMap = new Map();
  
  for (const cap of capacities) {
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
  const {
    dryRun = false,
    activeOnly = true
  } = options;
  
  // Charger les affectations de la tâche
  const assignmentsData = await grist.fetchTable('TaskAssignments');
  const assignments = columnarToRows(assignmentsData);
  
  const taskAssignments = assignments.filter(a => {
    if (a.tache !== taskId) return false;
    if (activeOnly && a.actif === false) return false;
    return true;
  });
  
  // Réconcilier chaque affectation
  const results = [];
  
  for (const assignment of taskAssignments) {
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
    results
  };
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

module.exports = {
  // Conversion des dates
  gristDateToIso,
  isoToGristDate,
  
  // Normalisation des statuts
  normalizeSheetStatus,
  
  // Construction des capacités
  buildMemberDailyCapacities,
  
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
