/**
 * CRA Time Entry Controller — Logique métier pour la saisie des temps dans le CRA
 * 
 * CONTRATS EXPLICITES (Phase 2) :
 * =================================
 * 1. heuresPrevues = LECTURE SEULE (provient du planning canonique)
 * 2. heures = EDITABLE (réalisé saisi par l'utilisateur)
 * 3. affectation + date = CLÉ CANONIQUE pour retrouver une TimeEntry
 * 4. record ID Grist doit être CONSERVÉ dans toutes les opérations
 * 5. Feuille soumis/validée/submitted/validated = VERROUILLÉE
 * 6. AUCUNE écriture dans MemberDailyCapacities
 * 7. AUCUNE écriture dans TaskAssignments.heuresAllouees
 * 8. AUCUN déclenchement du moteur de planification depuis le CRA
 * 9. Création d'une TimeEntry uniquement si aucune ligne n'existe pour affectation+date
 * 10. Mise à jour minimale : ne renvoyer que les champs modifiés dans UpdateRecord
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
 * 
 * CONTRAT :
 * - Une affectation est active si actif !== false
 * - L'affectation doit couvrir la date saisie (dateDebut <= date <= dateFin)
 * - Retourne 'missing' si aucune affectation active
 * - Retourne 'found' avec l'affectation unique si une seule correspond
 * - Retourne 'ambiguous' si plusieurs affectations actives (blocage)
 * 
 * PHASE 1.1.3 - SENSIBLE À LA DATE :
 * - Ajout du paramètre dateIso
 * - Vérification que dateDebut <= date <= dateFin
 * - Empêche de rattacher une saisie à une affectation terminée
 * 
 * @param {number} taskId - ID de la tâche
 * @param {number} personId - ID de la personne
 * @param {string} dateIso - Date ISO (YYYY-MM-DD) à vérifier
 * @param {Array} assignments - Toutes les affectations (TaskAssignments)
 * @returns {{ status: 'found' | 'missing' | 'ambiguous', assignment: null | object, assignments: Array }}
 */
function resolveActiveAssignment(taskId, personId, dateIso, assignments) {
  // PHASE 1.1.3 - CORRECTION BORNES INCLUSIVES
  // Utiliser gristDateKey pour comparer des dates civiles (YYYY-MM-DD)
  // et non des timestamps avec fuseaux horaires
  
  const activeAssignments = (assignments || []).filter(a => {
    // Vérifier actif
    if (a.actif === false) return false;
    
    // Vérifier dates de couverture avec bornes INCLUSIVES
    // Une affectation qui finit le 15 janvier couvre le 15 janvier toute la journée
    if (a.dateDebut != null) {
      const assignmentStart = gristDateKey(a.dateDebut);
      if (assignmentStart && dateIso < assignmentStart) {
        return false; // Date avant le début
      }
    }
    
    if (a.dateFin != null) {
      const assignmentEnd = gristDateKey(a.dateFin);
      if (assignmentEnd && dateIso > assignmentEnd) {
        return false; // Date après la fin (fin inclusive)
      }
    }
    
    // Vérifier tâche et membre
    return a.tache === taskId && a.membre === personId;
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
 * 
 * CONTRAT (CLÉ CANONIQUE) :
 * - La clé principale est : affectation + membre + date (si affectation présente)
 * - Fallback : tache + membre + date (pour données legacy sans affectation)
 * - Priorité à l'entrée avec affectation correspondante
 * - Retourne 'multiple' en cas d'ambiguïté non résolue (blocage)
 * - CRITIQUE : Ne jamais retourner une entrée d'une autre tâche ou affectation
 * 
 * @param {Array} entries - Toutes les TimeEntries
 * @param {number} taskId - ID de la tâche
 * @param {string} dateIso - Date ISO (YYYY-MM-DD)
 * @param {number} personId - ID de la personne
 * @param {object|null} activeAssignment - Affectation active (ou null)
 * @returns {{ status: 'found' | 'multiple' | 'none', entry: null | object, entries: Array }}
 */
function resolveEditableCellEntry(entries, taskId, dateIso, personId, activeAssignment) {
  // ÉTAPE 1 : Filtrer par membre + date (critères de base)
  const candidates = (entries || []).filter(e => {
    const entryDate = gristDateKey(e.date);
    return e.membre === personId && entryDate === dateIso;
  });
  
  if (candidates.length === 0) {
    return {
      status: 'none',
      entry: null,
      entries: []
    };
  }
  
  // ÉTAPE 2 : Si une affectation active est présente, l'utiliser comme clé principale
  if (activeAssignment && activeAssignment.id) {
    // Filtrer les entrées qui correspondent EXACTEMENT à l'affectation active
    const matchingAssignmentEntries = candidates.filter(e => e.affectation === activeAssignment.id);
    
    if (matchingAssignmentEntries.length === 1) {
      // Cas nominal : une seule entrée avec la bonne affectation
      return {
        status: 'found',
        entry: matchingAssignmentEntries[0],
        entries: candidates
      };
    }
    
    if (matchingAssignmentEntries.length > 1) {
      // ERREUR : plusieurs entrées avec la même affectation (doublon)
      return {
        status: 'multiple',
        entry: null,
        entries: matchingAssignmentEntries,
        reason: 'MULTIPLE_ASSIGNMENT_ENTRIES'
      };
    }
    
    // ÉTAPE 3 : Aucune entrée avec la bonne affectation
    // Chercher des entrées legacy SANS affectation ET de la MÊME TÂCHE
    const sameTaskLegacyEntries = candidates.filter(e => {
      return e.tache === taskId && (e.affectation === null || e.affectation === 0 || e.affectation === undefined);
    });
    
    if (sameTaskLegacyEntries.length === 1) {
      // Entrée legacy trouvée pour la même tâche, peut être mise à jour
      return {
        status: 'found',
        entry: sameTaskLegacyEntries[0],
        entries: candidates,
        isLegacy: true
      };
    }
    
    if (sameTaskLegacyEntries.length > 1) {
      // Plusieurs entrées legacy pour la même tâche : ambiguïté
      return {
        status: 'multiple',
        entry: null,
        entries: sameTaskLegacyEntries,
        reason: 'MULTIPLE_LEGACY_ENTRIES'
      };
    }
    
    // CRITIQUE : Aucune entrée correspondant à l'affectation active ou à la tâche
    // Ne surtout PAS retourner une entrée d'une autre affectation ou tâche
    return {
      status: 'none',
      entry: null,
      entries: []
    };
  }
  
  // ÉTAPE 4 : Pas d'affectation active, utiliser tache comme fallback
  const taskCandidates = candidates.filter(e => e.tache === taskId);
  
  if (taskCandidates.length === 1) {
    return {
      status: 'found',
      entry: taskCandidates[0],
      entries: candidates
    };
  }
  
  if (taskCandidates.length > 1) {
    // Vérifier s'il y a une entrée sans affectation
    const noAssignmentEntries = taskCandidates.filter(e => e.affectation === null || e.affectation === 0 || e.affectation === undefined);
    
    if (noAssignmentEntries.length === 1) {
      return {
        status: 'found',
        entry: noAssignmentEntries[0],
        entries: candidates,
        isLegacy: true
      };
    }
    
    return {
      status: 'multiple',
      entry: null,
      entries: taskCandidates,
      reason: 'MULTIPLE_TASK_ENTRIES'
    };
  }
  
  // Aucun candidat pour cette tâche
  return {
    status: 'none',
    entry: null,
    entries: []
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
 * 
 * CONTRATS DE SAUVEGARDE :
 * - UPDATE : ne renvoyer QUE { heures: nouvelleValeur } (minimaliste)
 * - CREATE : inclure affectation OBLIGATOIRE, heuresPrevues = 0 par défaut
 * - DELETE : uniquement si ligne manuelle vide (pas d'affectation, pas de planning)
 * - JAMAIS modifier heuresPrevues, affectation, capaciteJour, revisionPlan dans un update
 * 
 * PHASE 1.1.4 - INTERDICTION CRÉATION SANS AFFECTATION :
 * - Si aucune affectation et pas de ligne existante : blocage
 * - Les lignes legacy existantes peuvent être éditées
 * - Mais aucune nouvelle ligne sans affectation ne peut être créée
 * 
 * @param {object|null} existingEntry - Ligne existante (ou null)
 * @param {number} actualHours - Heures réelles saisies
 * @param {object|null} activeAssignment - Affectation active (ou null)
 * @param {object|null} currentSheet - Feuille actuelle (ou null)
 * @param {boolean} hasPlanningData - true si la ligne a des champs de planning
 * @returns {{ action: 'update' | 'create' | 'delete' | 'none' | 'blocked', fields: object|null, reason: string }}
 */
function determineEntryAction(existingEntry, actualHours, activeAssignment, currentSheet, hasPlanningData) {
  // ============================================================================
  // CAS 1 : LIGNE EXISTANTE - MISE À JOUR
  // ============================================================================
  if (existingEntry && existingEntry.id) {
    // Remise à zéro
    if (actualHours <= 0) {
      if (hasPlanningData || hasSheetLink(existingEntry)) {
        // CONTRAT : Ligne planifiée ou liée à une feuille
        // → Ne jamais supprimer, mettre heures à 0 uniquement
        // → heuresPrevues, capaciteJour, revisionPlan restent inchangés
        return {
          action: 'update',
          fields: { heures: 0 },
          reason: 'ZERO_PLANNED_OR_SHEET_ENTRY'
        };
      } else if (canDeleteEmptyManualEntry(existingEntry)) {
        // CONTRAT : Ligne manuelle complètement vide
        // → Suppression autorisée (aucune information de planning)
        return {
          action: 'delete',
          fields: null,
          reason: 'DELETE_EMPTY_MANUAL_ENTRY'
        };
      } else {
        // CONTRAT : Ligne manuelle avec description/imputation
        // → Mettre heures à 0, conserver les autres champs
        return {
          action: 'update',
          fields: { heures: 0 },
          reason: 'ZERO_MANUAL_ENTRY_WITH_DATA'
        };
      }
    } else {
      // ========================================================================
      // CAS NOMINAL : SAISIE POSITIVE SUR LIGNE EXISTANTE
      // ========================================================================
      // CONTRAT : Ne modifier QUE le champ 'heures'
      // - heuresPrevues reste inchangé (lecture seule)
      // - affectation reste inchangée
      // - capaciteJour, capaciteTheorique, capaciteDisponible restent inchangés
      // - revisionPlan reste inchangé
      // - description, imputation restent inchangés
      return {
        action: 'update',
        fields: { heures: actualHours },
        reason: 'UPDATE_EXISTING_ENTRY'
      };
    }
  }
  
  // ============================================================================
  // CAS 2 : NOUVELLE LIGNE - CRÉATION
  // ============================================================================
  if (actualHours > 0) {
    // PHASE 1.1.4 : INTERDICTION CRÉATION SANS AFFECTATION
    // Une nouvelle ligne ne peut être créée que si une affectation active existe
    if (!activeAssignment || !activeAssignment.id) {
      return {
        action: 'blocked',
        fields: null,
        reason: 'MISSING_ACTIVE_ASSIGNMENT'
      };
    }
    
    const fields = {
      heures: actualHours
    };
    
    // Rattacher à l'affectation active (OBLIGATOIRE)
    fields.affectation = activeAssignment.id;
    
    // Rattacher à la feuille si elle existe
    if (currentSheet && currentSheet.id) {
      fields.feuille = currentSheet.id;
    }
    
    // NOTE : heuresPrevues n'est PAS initialisé ici
    // Il sera positionné par le moteur de planification si nécessaire
    return {
      action: 'create',
      fields,
      reason: 'CREATE_NEW_ENTRY'
    };
  }
  
  // ============================================================================
  // CAS 3 : AUCUNE ACTION NÉCESSAIRE
  // ============================================================================
  return {
    action: 'none',
    fields: null,
    reason: 'NO_ACTION_NEEDED'
  };
}

/**
 * Vérifie si une semaine est verrouillée pour une personne donnée
 * 
 * CONTRAT DE VERROUILLAGE :
 * - Statuts verrouillés : 'soumis', 'valide', 'submitted', 'validated'
 * - Statuts éditables : 'brouillon', 'rejete', 'draft', 'rejected'
 * - Une feuille soumise ou validée bloque toute saisie
 * - Une feuille rejetée redevient éditable (retour en brouillon)
 * 
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
    const sheetDate = gristDateKey(s.semaine);
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
 * Helper : vérifie si une valeur est numérique valide (TODO 14)
 */
function hasNumericValue(value) {
  return (
    value !== null &&
    value !== undefined &&
    value !== '' &&
    Number.isFinite(Number(value))
  );
}

// ============================================================================
// PHASE 3 - HELPERS MÉTIER : NULL / 0 / PROPOSITION
// ============================================================================

/**
 * Vérifie si une entrée a un réalisé explicitement renseigné
 * CONTRAT : distingue null (aucun réalisé) de 0 (zéro explicite)
 * 
 * @param {Object} entry - TimeEntry
 * @returns {boolean} true si heures est une valeur numérique valide
 */
function hasExplicitActualHours(entry) {
  return (
    Boolean(entry) &&
    entry.heures !== null &&
    entry.heures !== undefined &&
    entry.heures !== '' &&
    Number.isFinite(Number(entry.heures))
  );
}

/**
 * Détermine la valeur affichée pour une entrée
 * CONTRAT :
 *   - si réalisé explicite → affiche réalisé
 *   - sinon si heuresPrevues > 0 → affiche proposition
 *   - sinon → 0
 * 
 * @param {Object|null} entry - TimeEntry
 * @returns {number} Valeur à afficher
 */
function effectiveDisplayedHours(entry) {
  if (!entry) {
    return 0;
  }

  if (hasExplicitActualHours(entry)) {
    return Number(entry.heures);
  }

  return Number(entry.heuresPrevues) || 0;
}

/**
 * Vérifie si la valeur affichée provient du planning (proposition)
 * CONTRAT : est prérempli si :
 *   - pas de réalisé explicite
 *   - heuresPrevues > 0
 * 
 * @param {Object|null} entry - TimeEntry
 * @returns {boolean} true si la valeur est une proposition du planning
 */
function isPrefilledFromPlanning(entry) {
  return (
    Boolean(entry) &&
    !hasExplicitActualHours(entry) &&
    (Number(entry.heuresPrevues) || 0) > 0
  );
}

/**
 * Construit le patch de soumission pour une entrée
 * CONTRAT :
 *   - ajoute feuille si manquante
 *   - matérialise heures uniquement si pas de réalisé explicite
 *   - ne modifie jamais heuresPrevues, affectation, etc.
 * 
 * @param {Object} entry - TimeEntry
 * @param {number} sheetId - ID de la feuille
 * @returns {Object} Patch à appliquer
 */
function buildSubmissionEntryPatch(entry, sheetId) {
  const fields = {};

  // Rattacher à la feuille si pas encore fait
  if (
    entry.feuille == null ||
    entry.feuille === 0
  ) {
    fields.feuille = sheetId;
  }

  // Matérialiser la proposition si pas de réalisé explicite
  if (!hasExplicitActualHours(entry)) {
    fields.heures = Number(entry.heuresPrevues) || 0;
  }

  return fields;
}

/**
 * Construit l'état d'affichage pour une cellule (plusieurs entrées possibles)
 * CONTRAT :
 *   - actualHours = somme des heures explicitement renseignées
 *   - plannedHours = somme des heuresPrevues
 *   - displayedHours = pour chaque entrée : heures si explicite, sinon heuresPrevues
 *   - isPrefilled = true si au moins une partie vient du planning sans réalisé
 *   - hasDisplayValue = true si displayedHours > 0 OU s'il y a un réalisé explicite (même 0)
 * 
 * @param {Array} entries - TimeEntries de la cellule
 * @returns {Object} État de cellule
 */
function buildCellDisplayState(entries) {
  if (!entries || entries.length === 0) {
    return {
      actualHours: 0,
      plannedHours: 0,
      displayedHours: 0,
      hasDisplayValue: false,
      hasExplicitActual: false,
      isPrefilled: false
    };
  }

  let actualHours = 0;
  let plannedHours = 0;
  let displayedHours = 0;
  let hasExplicitActual = false;
  let isPrefilled = false;

  for (const entry of entries) {
    const entryActual = hasExplicitActualHours(entry) ? Number(entry.heures) : 0;
    const entryPlanned = Number(entry.heuresPrevues) || 0;
    const entryDisplayed = effectiveDisplayedHours(entry);

    actualHours += entryActual;
    plannedHours += entryPlanned;
    displayedHours += entryDisplayed;

    if (hasExplicitActualHours(entry)) {
      hasExplicitActual = true;
    }

    if (isPrefilledFromPlanning(entry)) {
      isPrefilled = true;
    }
  }

  // PHASE 5 : hasDisplayValue = true si displayedHours > 0 OU s'il y a un réalisé explicite (même 0)
  // Cela permet d'afficher "0" dans l'input quand l'utilisateur a explicitement saisi 0
  const hasDisplayValue = displayedHours > 0 || hasExplicitActual;

  return {
    actualHours,
    plannedHours,
    displayedHours,
    hasDisplayValue,
    hasExplicitActual,
    isPrefilled
  };
}

/**
 * Obtient la capacité quotidienne pour une personne et une date (TODO 14)
 * Priorité :
 * 1. MemberDailyCapacities.capaciteDisponible (même si = 0)
 * 2. MemberDailyCapacities.capaciteTheorique
 * 3. Calcul legacy (capaciteHebdo / 5 + indisponibilités)
 * 
 * PHASE 1.1.2 - CORRECTION FORMAT DISPO :
 * - Si ratio > 1, on divise par 100 (ancien format 0-100)
 * - Si ratio <= 1, on utilise tel quel (nouveau format 0-1)
 * - dispo = 0 signifie indisponibilité totale (capacité = 0)
 * 
 * BUG 5 - RETOURNE CAPACITÉ COMPLÈTE :
 * - capacityRecordId : ID de la ligne MemberDailyCapacities
 * - theoreticalCapacity : capaciteTheorique
 * - availableCapacity : capaciteDisponible
 * - capacityRecord : ligne complète pour référence
 * 
 * @param {number} personId - ID de la personne
 * @param {number} dayMs - Timestamp du jour en millisecondes
 * @param {Array} dailyCapacities - Toutes les capacités quotidiennes
 * @param {Array} team - Équipe avec capaciteHebdo
 * @param {Array} availabilities - Indisponibilités
 * @returns {{ 
 *   capacity: number,
 *   theoreticalCapacity: number,
 *   availableCapacity: number,
 *   capacityRecordId: number|null,
 *   capacityRecord: object|null,
 *   source: string,
 *   warning: string|null
 * }}
 */
function dailyCapacityForPersonAndDate(personId, dayMs, dailyCapacities, team, availabilities) {
  const dayKey = localDayKeyFromMs(dayMs);
  
  const personCapacities = (dailyCapacities || []).filter(cap => {
    if (cap.membre !== personId) return false;
    const capDate = gristDateKey(cap.date);
    return capDate === dayKey;
  });
  
  if (personCapacities.length === 0) {
    const member = (team || []).find(m => m.id === personId);
    if (!member) {
      return {
        capacity: 0,
        theoreticalCapacity: 0,
        availableCapacity: 0,
        capacityRecordId: null,
        capacityRecord: null,
        source: 'none',
        warning: 'Membre non trouvé'
      };
    }
    
    const weeklyCapacity = Number(member.capaciteHebdo) || 35;
    let dailyCapacity = weeklyCapacity / 5;
    
    // BUG 4 : Utiliser des clés de dates civiles pour les indisponibilités
    const indispos = (availabilities || []).filter(a => {
      if (a.membre !== personId) return false;
      
      const startKey = gristDateKey(a.dateDebut);
      const endKey = gristDateKey(a.dateFin);
      
      // Comparaison avec bornes inclusives en dates civiles
      if (startKey && dayKey < startKey) return false;
      if (endKey && dayKey > endKey) return false;
      
      return true;
    });
    
    for (const ind of indispos) {
      const ratio = Number(ind.dispo) || 0;
      
      // PHASE 1.1.2 : Corriger format dispo (0-1 vs 0-100)
      const normalizedRatio = ratio > 1 ? ratio / 100 : ratio;
      
      dailyCapacity = dailyCapacity * normalizedRatio;
    }
    
    return {
      capacity: dailyCapacity,
      theoreticalCapacity: dailyCapacity,
      availableCapacity: dailyCapacity,
      capacityRecordId: null,
      capacityRecord: null,
      source: 'legacy',
      warning: null
    };
  }
  
  if (personCapacities.length > 1) {
    console.warn(
      '[CRA] Doublon de capacité quotidienne pour personne ' + personId + ' le ' + dayKey +
      ' (' + personCapacities.length + ' lignes). Utilisation de la révision la plus élevée.'
    );
    
    personCapacities.sort((a, b) => {
      const revDiff = (Number(b.revision) || 0) - (Number(a.revision) || 0);
      if (revDiff !== 0) return revDiff;
      return (b.id || 0) - (a.id || 0);
    });
  }
  
  const cap = personCapacities[0];
  
  // BUG 5 : Retourner la capacité complète avec toutes les informations
  const result = {
    capacity: 0,
    theoreticalCapacity: 0,
    availableCapacity: 0,
    capacityRecordId: cap.id || null,
    capacityRecord: cap,
    source: '',
    warning: personCapacities.length > 1 ? 'Doublon de capacité détecté' : null
  };
  
  if (hasNumericValue(cap.capaciteDisponible)) {
    result.capacity = Number(cap.capaciteDisponible);
    result.availableCapacity = Number(cap.capaciteDisponible);
    result.theoreticalCapacity = Number(cap.capaciteTheorique) || 0;
    result.source = 'daily_available';
    return result;
  }
  
  if (hasNumericValue(cap.capaciteTheorique)) {
    result.capacity = Number(cap.capaciteTheorique);
    result.theoreticalCapacity = Number(cap.capaciteTheorique);
    result.availableCapacity = Number(cap.capaciteTheorique);
    result.source = 'daily_theoretical';
    return result;
  }
  
  // Fallback legacy
  const member = (team || []).find(m => m.id === personId);
  if (member) {
    const legacyCapacity = (Number(member.capaciteHebdo) || 35) / 5;
    result.capacity = legacyCapacity;
    result.theoreticalCapacity = legacyCapacity;
    result.availableCapacity = legacyCapacity;
    result.source = 'legacy_fallback';
    result.warning = 'Capacité quotidienne invalide, repli legacy';
    return result;
  }
  
  result.warning = 'Aucune capacité disponible';
  return result;
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
  dailyCapacityForPersonAndDate,
  // PHASE 3 : helpers métier exportés
  hasExplicitActualHours,
  effectiveDisplayedHours,
  isPrefilledFromPlanning,
  buildSubmissionEntryPatch,
  // PHASE 4 : état de cellule
  buildCellDisplayState
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
