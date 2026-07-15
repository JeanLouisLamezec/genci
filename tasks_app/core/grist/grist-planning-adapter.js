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
const { ensureMemberDailyCapacities } = require('../capacity/member-daily-capacity-service.js');

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
// CHARGEMENT DU CONTEXTE D'UNE AFFECTATION
// ============================================================================

/**
 * Charge le contexte complet d'une affectation
 * @param {Object} grist - API Grist
 * @param {number} assignmentId - ID de l'affectation
 * @param {Object} options - Options
 * @param {boolean} [options.ensureCapacities=true] - Si true, assure les capacités dans Grist. Si false, construit en mémoire seulement.
 * @returns {Promise<Object>} Contexte adapté pour buildAssignmentPlan
 */
async function loadAssignmentContext(grist, assignmentId, options = {}) {
  const docApi = getDocApi(grist);
  const {
    includeAllEntries = true,
    ensureCapacities = true
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
  
  if (ensureCapacities) {
    // Mode écriture : assurer les capacités dans Grist
    capacityEnsureResult = await ensureMemberDailyCapacities(grist, member.id, startDate, endDate, {
      weeklyCapacity: member.capaciteHebdo,
      availabilities: availabilities.filter(a => a.membre === assignment.membre),
      defaultWeeklyCapacity: DEFAULT_WEEKLY_CAPACITY,
      source: 'calcul',
      dryRun: false
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
    // Mode lecture : construire les capacités en mémoire sans écrire dans Grist
    const { buildDesiredMemberDailyCapacities } = require('../capacity/member-daily-capacity-service.js');
    
    const desiredResult = buildDesiredMemberDailyCapacities({
      memberId: member.id,
      weeklyCapacity: member.capaciteHebdo,
      availabilities: availabilities.filter(a => a.membre === assignment.membre),
      startDate,
      endDate,
      defaultWeeklyCapacity: DEFAULT_WEEKLY_CAPACITY,
      source: 'calcul',
      revision: 1
    });
    
    if (desiredResult.errors && desiredResult.errors.length > 0) {
      return {
        error: {
          code: 'INVALID_CAPACITY_INPUT',
          errors: desiredResult.errors,
          message: 'Erreur de validation des capacités'
        }
      };
    }
    
    // Utiliser les capacités désirées directement
    memberDailyCapacitiesInRange = desiredResult.capacities.map(cap => ({
      id: null, // Pas d'ID car pas encore dans Grist
      membre: cap.memberId,
      date: cap.date,
      capaciteTheorique: cap.capaciteTheorique,
      disponibiliteRatio: cap.disponibiliteRatio,
      capaciteDisponible: cap.capaciteDisponible,
      absenceHeures: cap.absenceHeures,
      source: cap.source,
      revision: cap.revision
    }));
    
    capacityEnsureResult.diagnostics = desiredResult.diagnostics;
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
      
      // Trouver la capacité quotidienne associée
      const dateStr = gristDateToIso(e.date);
      const dailyCap = capacityByDate.get(dateStr);
      
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
        capaciteJour: dailyCap ? dailyCap.id : null,
        baseCapacityHours: dailyCap ? dailyCap.capaciteTheorique : (e.capaciteTheorique || 0),
        availableCapacityHours: dailyCap ? dailyCap.capaciteDisponible : (e.capaciteDisponible || 0),
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
    precisionHours = 0.01,
    capacityPolicy = 'cap'
  } = options;
  
  // Résoudre la date de replanification
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
    replanFromDate: effectiveReplanFromDate,
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
    precisionHours = 0.01,
    capacityPolicy = 'cap'
  } = options;
  
  const docApi = getDocApi(grist);
  
  // Résoudre la date de replanification
  const effectiveReplanFromDate = resolveReplanFromDate(options);
  
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
  
  const { assignment, capacities, existingEntries, diagnostics, isInactive } = context;
  
  // Si l'affectation est inactive, effectuer un nettoyage contrôé
  if (isInactive) {
    const allDiagnostics = [...(diagnostics || [])];
    
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
      // Si pas de heuresPrevues mais d'autres champs, ne rien faire
    }
    
    if (dryRun || cleanupActions.length === 0) {
      return {
        success: true,
        dryRun,
        actionsExecuted: 0,
        actions: cleanupActions,
        diagnostics: allDiagnostics,
        isInactive: true
      };
    }
    
    // Appliquer les actions de nettoyage
    try {
      await docApi.applyUserActions(cleanupActions);
      
      return {
        success: true,
        actionsExecuted: cleanupActions.length,
        actions: cleanupActions,
        diagnostics: allDiagnostics,
        isInactive: true
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
        diagnostics: allDiagnostics,
        isInactive: true
      };
    }
  }
  
  // Traitement normal pour les affectations actives
  const planResult = buildAssignmentPlan({
    assignment,
    capacities,
    existingEntries,
    replanFromDate: effectiveReplanFromDate,
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
  const actions = diffToGristActions(diff, assignment, capacities, existingEntriesMap, context.capacityByDate);
  
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
function diffToGristActions(diff, assignment, capacities, existingEntriesMap = new Map(), capacityByDate = new Map()) {
  const actions = [];
  const capacityMap = new Map();
  
  for (const cap of capacities) {
    capacityMap.set(cap.date, cap);
  }
  
  // Créations
  for (const create of diff.creates || []) {
    const date = create.date;
    const cap = capacityMap.get(date) || {};
    const dailyCap = capacityByDate.get(date);
    
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
        capaciteJour: dailyCap ? dailyCap.id : null,
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

module.exports = {
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
