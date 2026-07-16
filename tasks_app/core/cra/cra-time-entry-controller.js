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
    const entryDate = gristDateKey(e.date);
    return e.tache === taskId && entryDate === dateIso && e.membre === personId;
  });
  
  if (candidates.length === 0) {
    return {
      status: 'none',
      entry: null,
      entries: []
    };
  }
  
  // Compter les correspondances avec l'affectation active
  if (activeAssignment && activeAssignment.id) {
    const matchingAssignmentEntries = candidates.filter(e => e.affectation === activeAssignment.id);
    
    if (matchingAssignmentEntries.length === 1) {
      return {
        status: 'found',
        entry: matchingAssignmentEntries[0],
        entries: candidates
      };
    }
    
    if (matchingAssignmentEntries.length > 1) {
      return {
        status: 'multiple',
        entry: null,
        entries: candidates,
        reason: 'MULTIPLE_ASSIGNMENT_ENTRIES'
      };
    }
  }
  
  if (candidates.length === 1) {
    return {
      status: 'found',
      entry: candidates[0],
      entries: candidates
    };
  }
  
  // Ambiguïté non résolue
  return {
    status: 'multiple',
    entry: null,
    entries: candidates,
    reason: 'MULTIPLE_CELL_ENTRIES'
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

/**
 * Vérifie si une semaine est verrouillée pour une personne donnée
 * @param {number} personId - ID de la personne
 * @param {string} weekStart - Date de début de semaine (YYYY-MM-DD)
 * @param {Array} sheets - Toutes les feuilles (Feuilles)
 * @returns {{ locked: boolean, sheet: null | object, reason: string }}
 */
function isPersonWeekLocked(personId, weekStart, sheets) {
  if (!personId || !weekStart) {
    return {
      locked: false,
      sheet: null,
      reason: 'MISSING_PARAMS'
    };
  }
  
  const sheet = (sheets || []).find(s => {
    const sheetDate = typeof s.semaine === 'number'
      ? new Date(s.semaine * 1000).toISOString().split('T')[0]
      : s.semaine;
    return s.membre === personId && sheetDate === weekStart;
  });
  
  if (!sheet) {
    return {
      locked: false,
      sheet: null,
      reason: 'NO_SHEET'
    };
  }
  
  const status = String(sheet.statut || '').trim().toLowerCase();
  const lockedStatuses = ['soumis', 'valide', 'submitted', 'validated'];
  
  if (lockedStatuses.includes(status)) {
    return {
      locked: true,
      sheet,
      reason: 'SHEET_' + status.toUpperCase()
    };
  }
  
  return {
    locked: false,
    sheet,
    reason: 'SHEET_' + status
  };
}

/**
 * Convertit une date locale (ms) vers une clé ISO YYYY-MM-DD
 * Utilise la date locale sans conversion UTC pour éviter les décalages de fuseau
 * @param {number} ms - Timestamp en millisecondes
 * @returns {string} Date ISO YYYY-MM-DD
 */
function localDayKeyFromMs(ms) {
  const d = new Date(ms);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('-');
}

/**
 * Convertit une date Grist (secondes Unix) vers une clé ISO YYYY-MM-DD
 * Les dates Grist sont stockées en secondes Unix mais représentent un jour civil
 * @param {*} value - Valeur Grist (nombre de secondes ou string ISO)
 * @returns {string|null} Date ISO YYYY-MM-DD ou null
 */
function gristDateKey(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return localDayKeyFromMs(date.getTime());
    }
  }
  
  if (typeof value === 'number' && Number.isFinite(value)) {
    return localDayKeyFromMs(value * 1000);
  }
  
  if (value instanceof Date) {
    return localDayKeyFromMs(value.getTime());
  }
  
  return null;
}

/**
 * Obtient la capacité quotidienne pour une personne et une date
 * Priorité :
 * 1. MemberDailyCapacities.capaciteDisponible
 * 2. MemberDailyCapacities.capaciteTheorique
 * 3. Calcul legacy (capaciteHebdo / 5 + indisponibilités)
 * @param {number} personId - ID de la personne
 * @param {number} dayMs - Timestamp du jour en millisecondes
 * @param {Array} dailyCapacities - Toutes les capacités quotidiennes
 * @param {Array} team - Équipe avec capaciteHebdo
 * @param {Array} availabilities - Indisponibilités
 * @returns {{ capacity: number, source: string, warning: string|null }}
 */
function dailyCapacityForPersonAndDate(personId, dayMs, dailyCapacities, team, availabilities) {
  const dayKey = localDayKeyFromMs(dayMs);
  
  // Filtrer les capacités pour cette personne et ce jour
  const personCapacities = (dailyCapacities || []).filter(cap => {
    if (cap.membre !== personId) return false;
    const capDate = gristDateKey(cap.date);
    return capDate === dayKey;
  });
  
  // Cas 1 : Aucune capacité quotidienne → repli legacy
  if (personCapacities.length === 0) {
    const member = (team || []).find(m => m.id === personId);
    if (!member) {
      return {
        capacity: 0,
        source: 'none',
        warning: 'Membre non trouvé'
      };
    }
    
    // Calcul legacy : capaciteHebdo / 5
    const weeklyCapacity = Number(member.capaciteHebdo) || 35;
    let dailyCapacity = weeklyCapacity / 5;
    
    // Appliquer les indisponibilités legacy si pas de capacité quotidienne
    const dayDate = new Date(dayMs);
    const indispos = (availabilities || []).filter(a => {
      if (a.membre !== personId) return false;
      const start = typeof a.dateDebut === 'number' ? a.dateDebut * 1000 : 0;
      const end = typeof a.dateFin === 'number' ? a.dateFin * 1000 : 0;
      return dayMs >= start && dayMs <= end;
    });
    
    for (const ind of indispos) {
      const ratio = Number(ind.dispo) || 0;
      dailyCapacity = dailyCapacity * (ratio / 100);
    }
    
    return {
      capacity: dailyCapacity,
      source: 'legacy',
      warning: null
    };
  }
  
  // Cas 2 : Plusieurs capacités pour le même jour → warning et stratégie
  if (personCapacities.length > 1) {
    console.warn(
      '[CRA] Doublon de capacité quotidienne pour personne ' + personId + ' le ' + dayKey +
      ' (' + personCapacities.length + ' lignes). Utilisation de la révision la plus élevée.'
    );
    
    // Trier par revision décroissante, puis par ID décroissant
    personCapacities.sort((a, b) => {
      const revDiff = (Number(b.revision) || 0) - (Number(a.revision) || 0);
      if (revDiff !== 0) return revDiff;
      return (b.id || 0) - (a.id || 0);
    });
  }
  
  // Utiliser la première (plus haute révision)
  const cap = personCapacities[0];
  
  // Priorité : capaciteDisponible > capaciteTheorique
  const available = Number(cap.capaciteDisponible);
  const theoretical = Number(cap.capaciteTheorique);
  
  if (!isNaN(available) && available > 0) {
    return {
      capacity: available,
      source: 'daily_available',
      warning: personCapacities.length > 1 ? 'Doublon de capacité détecté' : null
    };
  }
  
  if (!isNaN(theoretical) && theoretical > 0) {
    return {
      capacity: theoretical,
      source: 'daily_theoretical',
      warning: personCapacities.length > 1 ? 'Doublon de capacité détecté' : null
    };
  }
  
  // Repli sur legacy si les valeurs sont nulles
  const member = (team || []).find(m => m.id === personId);
  if (member) {
    return {
      capacity: (Number(member.capaciteHebdo) || 35) / 5,
      source: 'legacy_fallback',
      warning: 'Capacité quotidienne invalide, repli legacy'
    };
  }
  
  return {
    capacity: 0,
    source: 'none',
    warning: 'Aucune capacité disponible'
  };
}

const CRAController = {
  resolveActiveAssignment,
  resolveEditableCellEntry,
  canDeleteEmptyManualEntry,
  hasPlanningFields,
  hasSheetLink,
  determineEntryAction,
  isPersonWeekLocked,
  localDayKeyFromMs,
  gristDateKey,
  dailyCapacityForPersonAndDate
};

if (typeof globalThis !== 'undefined') {
  globalThis.CRAController = CRAController;
}

if (
  typeof module !== 'undefined' &&
  module.exports
) {
  module.exports = CRAController;
}
