/**
 * CRA Time Entry Controller — Logique métier pour la saisie des temps dans le CRA
 * 
 * Ce module centralise la logique critique de saisie des temps pour :
 * - Résoudre les affectations actives
 * - Identifier la ligne TimeEntry éditable sans ambiguïté
 * - Déterminer si une ligne peut être supprimée
 * - Protéger les lignes planifiées contre la suppression
 * 
 * Testable indépendamment du widget CRA.
 */

'use strict';

/**
 * Résout l'affectation active pour une tâche et une personne données
 * @param {number} taskId - ID de la tâche
 * @param {number} personId - ID de la personne
 * @param {Array} assignments - Toutes les affectations (TaskAssignments)
 * @returns {{ status: 'found' | 'missing' | 'ambiguous', assignment: null | object, assignments: Array }}
 */
function resolveActiveAssignment(taskId, personId, assignments) {
  const activeAssignments = (assignments || []).filter(a => {
    return a.tache === taskId && a.membre === personId && a.actif !== false;
  });
  
  if (activeAssignments.length === 0) {
    return {
      status: 'missing',
      assignment: null,
      assignments: []
    };
  }
  
  if (activeAssignments.length === 1) {
    return {
      status: 'found',
      assignment: activeAssignments[0],
      assignments: activeAssignments
    };
  }
  
  // Plusieurs affectations actives = ambiguïté bloquante
  return {
    status: 'ambiguous',
    assignment: null,
    assignments: activeAssignments
  };
}

/**
 * Résout la ligne TimeEntry éditable pour une cellule donnée
 * @param {Array} entries - Toutes les TimeEntries
 * @param {number} taskId - ID de la tâche
 * @param {string} dateIso - Date ISO (YYYY-MM-DD)
 * @param {number} personId - ID de la personne
 * @param {object|null} activeAssignment - Affectation active (ou null)
 * @returns {{ status: 'found' | 'multiple' | 'none', entry: null | object, entries: Array }}
 */
function resolveEditableCellEntry(entries, taskId, dateIso, personId, activeAssignment) {
  const candidates = (entries || []).filter(e => {
    const entryDate = typeof e.date === 'number' 
      ? new Date(e.date * 1000).toISOString().split('T')[0]
      : e.date;
    return e.tache === taskId && entryDate === dateIso && e.membre === personId;
  });
  
  if (candidates.length === 0) {
    return {
      status: 'none',
      entry: null,
      entries: []
    };
  }
  
  if (candidates.length === 1) {
    return {
      status: 'found',
      entry: candidates[0],
      entries: candidates
    };
  }
  
  // Plusieurs lignes : prioriser celle qui correspond à l'affectation active
  if (activeAssignment && activeAssignment.id) {
    const matchingAssignment = candidates.find(e => e.affectation === activeAssignment.id);
    if (matchingAssignment) {
      return {
        status: 'found',
        entry: matchingAssignment,
        entries: candidates
      };
    }
  }
  
  // Ambiguïté non résolue
  return {
    status: 'multiple',
    entry: null,
    entries: candidates
  };
}

/**
 * Vérifie si une ligne TimeEntry vide peut être supprimée
 * @param {object} entry - Ligne TimeEntry à vérifier
 * @returns {boolean} true si la ligne peut être supprimée
 */
function canDeleteEmptyManualEntry(entry) {
  if (!entry) return false;
  
  // Une ligne avec affectation ne doit jamais être supprimée par le CRA
  if (entry.affectation != null && entry.affectation !== 0) return false;
  
  // Une ligne avec des heures prévues ne doit jamais être supprimée
  if ((Number(entry.heuresPrevues) || 0) > 0) return false;
  
  // Une ligne avec des champs de planning ne doit jamais être supprimée
  if (entry.capaciteJour != null && entry.capaciteJour !== 0) return false;
  if ((Number(entry.revisionPlan) || 0) > 0) return false;
  if ((Number(entry.capaciteTheorique) || 0) > 0) return false;
  if ((Number(entry.capaciteDisponible) || 0) > 0) return false;
  
  // Une ligne liée à une feuille ne doit jamais être supprimée
  if (entry.feuille != null && entry.feuille !== 0) return false;
  
  // Une ligne avec description ou imputation ne doit pas être supprimée
  if ((entry.description && entry.description.trim()) || (entry.imputation && entry.imputation.trim())) return false;
  
  // Ligne manuelle complètement vide : suppression autorisée
  return true;
}

/**
 * Vérifie si une ligne contient des informations de planning
 * @param {object} entry - Ligne TimeEntry à vérifier
 * @returns {boolean} true si la ligne contient des champs de planning
 */
function hasPlanningFields(entry) {
  if (!entry) return false;
  
  return (
    (entry.affectation != null && entry.affectation !== 0) ||
    (Number(entry.heuresPrevues) || 0) > 0 ||
    (entry.capaciteJour != null && entry.capaciteJour !== 0) ||
    (Number(entry.revisionPlan) || 0) > 0 ||
    (Number(entry.capaciteTheorique) || 0) > 0 ||
    (Number(entry.capaciteDisponible) || 0) > 0
  );
}

/**
 * Vérifie si une ligne est liée à une feuille
 * @param {object} entry - Ligne TimeEntry à vérifier
 * @returns {boolean} true si la ligne est liée à une feuille
 */
function hasSheetLink(entry) {
  if (!entry) return false;
  return entry.feuille != null && entry.feuille !== 0;
}

/**
 * Détermine l'action à effectuer sur une TimeEntry lors d'une saisie
 * @param {object|null} existingEntry - Ligne existante (ou null)
 * @param {number} actualHours - Heures réelles saisies
 * @param {object|null} activeAssignment - Affectation active (ou null)
 * @param {object|null} currentSheet - Feuille actuelle (ou null)
 * @param {boolean} hasPlanningData - true si la ligne a des champs de planning
 * @returns {{ action: 'update' | 'create' | 'delete' | 'none', fields: object|null, reason: string }}
 */
function determineEntryAction(existingEntry, actualHours, activeAssignment, currentSheet, hasPlanningData) {
  // Cas 1 : Ligne existante
  if (existingEntry && existingEntry.id) {
    // Remise à zéro
    if (actualHours <= 0) {
      if (hasPlanningData || hasSheetLink(existingEntry)) {
        // Ligne planifiée ou liée à une feuille : mettre heures à 0 uniquement
        return {
          action: 'update',
          fields: { heures: 0 },
          reason: 'ZERO_PLANNED_OR_SHEET_ENTRY'
        };
      } else if (canDeleteEmptyManualEntry(existingEntry)) {
        // Ligne manuelle complètement vide : supprimer
        return {
          action: 'delete',
          fields: null,
          reason: 'DELETE_EMPTY_MANUAL_ENTRY'
        };
      } else {
        // Ligne manuelle avec autres informations : mettre heures à 0
        return {
          action: 'update',
          fields: { heures: 0 },
          reason: 'ZERO_MANUAL_ENTRY_WITH_DATA'
        };
      }
    } else {
      // Saisie positive : mettre à jour heures uniquement
      return {
        action: 'update',
        fields: { heures: actualHours },
        reason: 'UPDATE_EXISTING_ENTRY'
      };
    }
  }
  
  // Cas 2 : Nouvelle ligne
  if (actualHours > 0) {
    const fields = {
      heures: actualHours
    };
    
    // Rattacher à l'affectation active si elle existe
    if (activeAssignment && activeAssignment.id) {
      fields.affectation = activeAssignment.id;
    }
    
    // Rattacher à la feuille si elle existe
    if (currentSheet && currentSheet.id) {
      fields.feuille = currentSheet.id;
    }
    
    return {
      action: 'create',
      fields,
      reason: 'CREATE_NEW_ENTRY'
    };
  }
  
  // Cas 3 : Aucune action nécessaire
  return {
    action: 'none',
    fields: null,
    reason: 'NO_ACTION_NEEDED'
  };
}

module.exports = {
  resolveActiveAssignment,
  resolveEditableCellEntry,
  canDeleteEmptyManualEntry,
  hasPlanningFields,
  hasSheetLink,
  determineEntryAction
};
