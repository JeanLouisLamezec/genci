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

'use strict';

const { reconcileAssignmentPlan, isBlockingDiagnostic } = require('./grist/grist-planning-adapter.js');

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

module.exports = {
  createWidgetPlanningService,
  summarizeGristActions
};
