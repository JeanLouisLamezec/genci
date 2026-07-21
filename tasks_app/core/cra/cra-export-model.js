/**
 * CRA Export Model - Modèle de rapport pour l'export du CRA
 * 
 * Module métier pur qui transforme les données du CRA en un modèle de rapport
 * commun, consommable par les générateurs PDF, CSV et la modale d'export.
 * 
 * Contraintes :
 * - Aucun accès au DOM
 * - Aucun appel API Grist
 * - Aucune modification des données reçues
 * - Fonctionne dans le navigateur et dans Node
 * 
 * @module core/cra/cra-export-model
 */

'use strict';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Formats de date acceptés pour validation
 */
const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ============================================================================
// RÉSOLUTION DE CRAController
// ============================================================================

/**
 * Valide que CRAController expose les fonctions requises
 * @param {Object} controller - Contrôleur à valider
 * @returns {Object} Le contrôleur validé
 * @throws {Error} Si le contrôleur est invalide
 */
function validateCraController(controller) {
  if (
    !controller ||
    typeof controller.gristDateKey !== 'function' ||
    typeof controller.buildCellDisplayState !== 'function'
  ) {
    throw new Error(
      'CraExportModel: CRAController invalide. ' +
      'Les fonctions gristDateKey et buildCellDisplayState sont requises.'
    );
  }

  return controller;
}

/**
 * Résout CRAController de manière compatible navigateur et Node
 * @returns {Object} CRAController
 * @throws {Error} Si CRAController est indisponible ou invalide
 */
function resolveCraController() {
  // Navigateur : utiliser globalThis.CRAController
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.CRAController
  ) {
    return validateCraController(globalThis.CRAController);
  }

  // Node/CommonJS : charger le module
  if (
    typeof module !== 'undefined' &&
    module.exports &&
    typeof require === 'function'
  ) {
    return validateCraController(
      require('./cra-time-entry-controller.js')
    );
  }

  throw new Error(
    'CraExportModel: CRAController indisponible. ' +
    'Assurez-vous de charger cra-time-entry-controller.js avant cra-export-model.js'
  );
}

/**
 * Cache du contrôleur résolu
 */
let craControllerCache = null;

/**
 * Obtient CRAController (avec cache)
 * @returns {Object} CRAController
 */
function getCraController() {
  if (craControllerCache === null) {
    craControllerCache = resolveCraController();
  }
  return craControllerCache;
}

// ============================================================================
// HELPERS DE NORMALISATION
// ============================================================================

/**
 * Normalise un ID (nombre ou chaîne) en chaîne
 * @param {*} id - ID à normaliser
 * @returns {string|null} ID normalisé ou null si invalide
 */
function normalizeId(id) {
  if (id === null || id === undefined || id === '') {
    return null;
  }
  const str = String(id).trim();
  return str === '' ? null : str;
}

/**
 * Normalise le scope d'export
 * - Convertit les IDs valides en chaînes
 * - Supprime les doublons
 * - Préserve l'ordre de première apparition
 * - Ignore null, undefined et chaîne vide
 * 
 * @param {Object} scope - Scope d'export
 * @returns {Object} Scope normalisé
 */
function normalizeScope(scope) {
  const result = {
    personIds: [],
    projectIds: [],
    programmeIds: [],
    taskIds: []
  };

  if (!scope || typeof scope !== 'object') {
    return result;
  }

  const keys = ['personIds', 'projectIds', 'programmeIds', 'taskIds'];
  
  for (const key of keys) {
    const value = scope[key];
    if (Array.isArray(value)) {
      const seen = new Set();
      for (const item of value) {
        const normalized = normalizeId(item);
        if (normalized !== null && !seen.has(normalized)) {
          seen.add(normalized);
          result[key].push(normalized);
        }
      }
    }
  }

  return result;
}

// ============================================================================
// VALIDATION DES DATES
// ============================================================================

/**
 * Valide une date au format ISO (YYYY-MM-DD)
 * @param {string} dateStr - Date à valider
 * @returns {boolean} true si la date est valide
 */
function isValidDateIso(dateStr) {
  if (typeof dateStr !== 'string') {
    return false;
  }
  
  if (!DATE_ISO_REGEX.test(dateStr)) {
    return false;
  }
  
  // Vérifier que la date est une date civile valide
  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  
  if (month < 1 || month > 12) {
    return false;
  }
  
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/**
 * Valide la plage de dates
 * @param {string} startDateIso - Date de début
 * @param {string} endDateIso - Date de fin
 * @returns {{ valid: boolean, error: string|null }} Résultat de validation
 */
function validateDateRange(startDateIso, endDateIso) {
  if (!startDateIso || !endDateIso) {
    return {
      valid: false,
      error: 'startDateIso et endDateIso sont obligatoires'
    };
  }
  
  if (!isValidDateIso(startDateIso)) {
    return {
      valid: false,
      error: 'startDateIso doit être au format YYYY-MM-DD'
    };
  }
  
  if (!isValidDateIso(endDateIso)) {
    return {
      valid: false,
      error: 'endDateIso doit être au format YYYY-MM-DD'
    };
  }
  
  if (startDateIso > endDateIso) {
    return {
      valid: false,
      error: 'startDateIso doit être antérieur ou égal à endDateIso'
    };
  }
  
  return {
    valid: true,
    error: null
  };
}

// ============================================================================
// CONVERSIONS ET UTILITAIRES
// ============================================================================

/**
 * Convertit des heures en minutes entières
 * @param {number} hours - Durée en heures
 * @returns {number} Durée en minutes (arrondie)
 */
function hoursToMinutes(hours) {
  const num = Number(hours);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.round(num * 60);
}

/**
 * Obtient la clé de date Grist (YYYY-MM-DD) depuis un timestamp
 * Utilise CRAController.gristDateKey
 * @param {*} value - Valeur Grist (timestamp secondes ou string ISO)
 * @returns {string|null} Date ISO ou null
 */
function getGristDateKey(value) {
  const controller = getCraController();
  return controller.gristDateKey(value);
}

/**
 * Convertit un timestamp en clé de jour locale (YYYY-MM-DD)
 * Helper public pour tests et débogage
 * @param {number} ms - Timestamp en millisecondes
 * @returns {string} Date ISO
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
 * Vérifie si une valeur est numérique valide
 * @param {*} value - Valeur à vérifier
 * @returns {boolean} true si la valeur est numérique
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
// RÉSOLUTION DES DONNÉES
// ============================================================================

/**
 * Résout le programme d'un projet
 * Priorité : project.programme, puis project.portefeuille (rétrocompatibilité)
 * @param {Object} project - Projet
 * @param {Array} programmes - Liste des programmes
 * @returns {{ id: string|null, name: string }} Programme résolu
 */
function resolveProgramme(project, programmes) {
  if (!project) {
    return { id: null, name: '' };
  }
  
  // Priorité à project.programme
  let programmeId = project.programme;
  
  // Rétrocompatibilité : fallback sur project.portefeuille
  if (programmeId == null && project.portefeuille != null) {
    programmeId = project.portefeuille;
  }
  
  if (programmeId == null) {
    return { id: null, name: '' };
  }
  
  const normalizedId = normalizeId(programmeId);
  if (normalizedId === null) {
    return { id: null, name: '' };
  }
  
  // Chercher le programme dans la liste
  const programme = (programmes || []).find(p => {
    const pId = normalizeId(p.id);
    return pId === normalizedId;
  });
  
  if (programme) {
    return {
      id: normalizedId,
      name: String(programme.nom || '')
    };
  }
  
  // Programme non trouvé : retourner ID avec nom vide
  return {
    id: normalizedId,
    name: ''
  };
}

/**
 * Résout une tâche depuis son ID
 * @param {number|string} taskId - ID de la tâche
 * @param {Array} tasks - Liste des tâches
 * @returns {Object|null} Tâche résolue ou null
 */
function resolveTask(taskId, tasks) {
  const normalizedId = normalizeId(taskId);
  if (normalizedId === null) {
    return null;
  }
  
  return (tasks || []).find(t => {
    const tId = normalizeId(t.id);
    return tId === normalizedId;
  }) || null;
}

/**
 * Résout un projet depuis son ID
 * @param {number|string} projectId - ID du projet
 * @param {Array} projects - Liste des projets
 * @returns {Object|null} Projet résolu ou null
 */
function resolveProject(projectId, projects) {
  const normalizedId = normalizeId(projectId);
  if (normalizedId === null) {
    return null;
  }
  
  return (projects || []).find(p => {
    const pId = normalizeId(p.id);
    return pId === normalizedId;
  }) || null;
}

/**
 * Résout une personne depuis son ID
 * @param {number|string} personId - ID de la personne
 * @param {Array} team - Liste des membres
 * @returns {Object|null} Personne résolue ou null
 */
function resolvePerson(personId, team) {
  const normalizedId = normalizeId(personId);
  if (normalizedId === null) {
    return null;
  }
  
  return (team || []).find(m => {
    const mId = normalizeId(m.id);
    return mId === normalizedId;
  }) || null;
}

// ============================================================================
// FILTRAGE ET REGROUPEMENT
// ============================================================================

/**
 * Vérifie si une entrée est dans la période donnée
 * @param {Object} entry - TimeEntry
 * @param {string} startDateIso - Date de début (inclusive)
 * @param {string} endDateIso - Date de fin (inclusive)
 * @returns {boolean} true si l'entrée est dans la période
 */
function isEntryInRange(entry, startDateIso, endDateIso) {
  const entryDate = getGristDateKey(entry.date);
  if (!entryDate) {
    return false;
  }
  return entryDate >= startDateIso && entryDate <= endDateIso;
}

/**
 * Vérifie si une entrée correspond aux filtres de scope
 * Utilise les Map pour une recherche optimale
 * 
 * @param {Object} entry - TimeEntry
 * @param {Object} normalizedScope - Scope normalisé
 * @param {Map} taskMap - Map des tâches (id -> tâche)
 * @param {Map} projectMap - Map des projets (id -> projet)
 * @returns {boolean} true si l'entrée correspond aux filtres
 */
function entryMatchesScope(entry, normalizedScope, taskMap, projectMap) {
  // Filtre par tâche
  if (normalizedScope.taskIds.length > 0) {
    const entryTaskId = normalizeId(entry.tache);
    if (entryTaskId === null || !normalizedScope.taskIds.includes(entryTaskId)) {
      return false;
    }
  }
  
  // Filtre par projet (via la tâche)
  if (normalizedScope.projectIds.length > 0) {
    const entryTaskId = normalizeId(entry.tache);
    if (entryTaskId === null) {
      return false;
    }
    
    const task = taskMap.get(entryTaskId);
    if (!task) {
      return false;
    }
    
    const projectId = normalizeId(task.projet);
    if (projectId === null || !normalizedScope.projectIds.includes(projectId)) {
      return false;
    }
  }
  
  // Filtre par programme (via le projet de la tâche)
  if (normalizedScope.programmeIds.length > 0) {
    const entryTaskId = normalizeId(entry.tache);
    if (entryTaskId === null) {
      return false;
    }
    
    const task = taskMap.get(entryTaskId);
    if (!task) {
      return false;
    }
    
    const projectId = normalizeId(task.projet);
    if (projectId === null) {
      return false;
    }
    
    const project = projectMap.get(projectId);
    if (!project) {
      return false;
    }
    
    // Résoudre l'ID du programme depuis le projet
    const rawProgrammeId =
      project.programme != null
        ? project.programme
        : project.portefeuille;
    
    const programmeId = normalizeId(rawProgrammeId);
    if (programmeId === null || !normalizedScope.programmeIds.includes(programmeId)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Regroupe les entrées par cellule (personne + date + tâche)
 * @param {Array} entries - TimeEntries à regrouper
 * @returns {Map} Map avec clé "personId|dateIso|taskId" -> Array d'entrées
 */
function groupEntriesByCell(entries) {
  const groups = new Map();
  
  for (const entry of entries) {
    const personId = normalizeId(entry.membre);
    const dateIso = getGristDateKey(entry.date);
    const taskId = normalizeId(entry.tache);
    
    if (personId === null || dateIso === null || taskId === null) {
      continue;
    }
    
    const key = personId + '|' + dateIso + '|' + taskId;
    
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(entry);
  }
  
  return groups;
}

/**
 * Calcule la durée affichée d'une cellule en utilisant CRAController.buildCellDisplayState
 * @param {Array} cellEntries - Entrées d'une cellule
 * @returns {number} Durée affichée en heures
 */
function getCellDisplayedHours(cellEntries) {
  const controller = getCraController();
  const state = controller.buildCellDisplayState(cellEntries);
  return state.displayedHours || 0;
}

// ============================================================================
// CONSTRUCTION DU RAPPORT
// ============================================================================

/**
 * Trie les lignes d'une personne selon les règles :
 * 1. Date croissante
 * 2. Nom du projet
 * 3. Nom de la tâche
 * 4. ID de tâche (critère déterministe)
 * 
 * @param {Array} rows - Lignes à trier
 * @returns {Array} Lignes triées
 */
function sortPersonRows(rows) {
  return rows.sort((a, b) => {
    // 1. Date croissante
    if (a.dateIso < b.dateIso) return -1;
    if (a.dateIso > b.dateIso) return 1;
    
    // 2. Nom du projet
    const projCompare = (a.projectName || '').localeCompare(b.projectName || '');
    if (projCompare !== 0) return projCompare;
    
    // 3. Nom de la tâche
    const taskCompare = (a.taskName || '').localeCompare(b.taskName || '');
    if (taskCompare !== 0) return taskCompare;
    
    // 4. ID de tâche (numérique ou lexicographique)
    const aTaskId = Number(a.taskId) || 0;
    const bTaskId = Number(b.taskId) || 0;
    return aTaskId - bTaskId;
  });
}

/**
 * Construit le rapport d'export CRA
 * 
 * @param {Object} options - Options du rapport
 * @param {string} options.startDateIso - Date de début (YYYY-MM-DD, inclusive)
 * @param {string} options.endDateIso - Date de fin (YYYY-MM-DD, inclusive)
 * @param {Object} options.scope - Périmètre d'export
 * @param {Array} options.scope.personIds - IDs des personnes à exporter
 * @param {Array} [options.scope.projectIds] - IDs des projets (vide = tous)
 * @param {Array} [options.scope.programmeIds] - IDs des programmes (vide = tous)
 * @param {Array} [options.scope.taskIds] - IDs des tâches (vide = toutes)
 * @param {Array} options.entries - TimeEntries (données brutes Grist)
 * @param {Array} options.team - Membres de l'équipe
 * @param {Array} options.tasks - Tâches
 * @param {Array} options.projects - Projets
 * @param {Array} options.programmes - Programmes
 * 
 * @returns {Object} Rapport structuré
 * 
 * @throws {Error} Si les dates sont invalides ou si CRAController est indisponible
 */
function buildReport(options) {
  // ============================================================================
  // VALIDATION DES ENTRÉES
  // ============================================================================
  
  if (!options || typeof options !== 'object') {
    throw new Error('buildReport: options requises');
  }
  
  const {
    startDateIso,
    endDateIso,
    scope,
    entries,
    team,
    tasks,
    projects,
    programmes
  } = options;
  
  // Valider les dates
  const dateValidation = validateDateRange(startDateIso, endDateIso);
  if (!dateValidation.valid) {
    throw new Error('buildReport: ' + dateValidation.error);
  }
  
  // Résoudre CRAController (lèvera une erreur si indisponible)
  getCraController();
  
  // ============================================================================
  // NORMALISATION DU SCOPE
  // ============================================================================
  
  const normalizedScope = normalizeScope(scope || {});
  
  // Règle de sécurité : personIds vide = aucune personne
  if (normalizedScope.personIds.length === 0) {
    return {
      period: {
        startDateIso,
        endDateIso
      },
      scope: normalizedScope,
      persons: [],
      totals: {
        selectedPersonCount: 0,
        exportedPersonCount: 0,
        rowCount: 0,
        totalMinutes: 0
      },
      diagnostics: {
        skippedOutsidePeriod: 0,
        skippedOutsideScope: 0,
        skippedUnknownPerson: 0,
        skippedUnknownTask: 0,
        skippedZeroDurationCells: 0,
        selectedPersonsWithoutRows: []
      }
    };
  }
  
  // ============================================================================
  // PRÉPARATION DES INDEX
  // ============================================================================
  
  const personIdsSet = new Set(normalizedScope.personIds);
  const personMap = new Map();
  (team || []).forEach(m => {
    const id = normalizeId(m.id);
    if (id !== null) {
      personMap.set(id, m);
    }
  });
  
  const taskMap = new Map();
  (tasks || []).forEach(t => {
    const id = normalizeId(t.id);
    if (id !== null) {
      taskMap.set(id, t);
    }
  });
  
  const projectMap = new Map();
  (projects || []).forEach(p => {
    const id = normalizeId(p.id);
    if (id !== null) {
      projectMap.set(id, p);
    }
  });
  
  // ============================================================================
  // FILTRAGE ET REGROUPEMENT
  // ============================================================================
  
  const diagnostics = {
    skippedOutsidePeriod: 0,
    skippedOutsideScope: 0,
    skippedUnknownPerson: 0,
    skippedUnknownTask: 0,
    skippedZeroDurationCells: 0,
    selectedPersonsWithoutRows: new Set()
  };
  
  // Initialiser le suivi des personnes sélectionnées
  normalizedScope.personIds.forEach(pid => {
    diagnostics.selectedPersonsWithoutRows.add(pid);
  });
  
  // Filtrer les entrées par période et scope
  const filteredEntries = [];
  
  for (const entry of entries || []) {
    // Vérifier la période
    if (!isEntryInRange(entry, startDateIso, endDateIso)) {
      diagnostics.skippedOutsidePeriod++;
      continue;
    }
    
    // Vérifier la personne
    const personId = normalizeId(entry.membre);
    if (personId === null || !personIdsSet.has(personId)) {
      diagnostics.skippedOutsideScope++;
      continue;
    }
    
    // Vérifier les autres filtres (tâche, projet, programme) en utilisant les Map
    if (!entryMatchesScope(entry, normalizedScope, taskMap, projectMap)) {
      diagnostics.skippedOutsideScope++;
      continue;
    }
    
    // Vérifier que la tâche existe
    const taskId = normalizeId(entry.tache);
    if (taskId === null || !taskMap.has(taskId)) {
      diagnostics.skippedUnknownTask++;
      continue;
    }
    
    filteredEntries.push(entry);
  }
  
  // Regrouper par cellule
  const cellGroups = groupEntriesByCell(filteredEntries);
  
  // ============================================================================
  // CONSTRUCTION DES LIGNES
  // ============================================================================
  
  const personData = new Map();
  
  for (const [key, cellEntries] of cellGroups) {
    const [personId, dateIso, taskId] = key.split('|');
    
    // Calculer la durée affichée
    const displayedHours = getCellDisplayedHours(cellEntries);
    const durationMinutes = hoursToMinutes(displayedHours);
    
    // Exclure les cellules de durée nulle ou négative
    if (durationMinutes <= 0) {
      diagnostics.skippedZeroDurationCells++;
      continue;
    }
    
    // Résoudre les données en utilisant les Map
    const person = personMap.get(personId);
    const task = taskMap.get(taskId);
    
    if (!person) {
      diagnostics.skippedUnknownPerson++;
      continue;
    }
    
    if (!task) {
      diagnostics.skippedUnknownTask++;
      continue;
    }
    
    // Résoudre le projet en utilisant la Map
    const projectId = normalizeId(task.projet);
    const project = projectId !== null ? projectMap.get(projectId) : null;
    
    // Résoudre le programme
    const programme = resolveProgramme(project, programmes);
    
    // Créer la ligne
    const row = {
      dateIso,
      durationMinutes,
      personId: person.id,
      personName: String(person.nom || ''),
      taskId: task.id,
      taskName: String(task.titre || ''),
      projectId: project ? project.id : null,
      projectName: project ? String(project.nom || '') : '',
      programmeId: programme.id,
      programmeName: programme.name
    };
    
    // Ajouter aux données de la personne
    if (!personData.has(personId)) {
      personData.set(personId, {
        id: person.id,
        name: String(person.nom || ''),
        totalMinutes: 0,
        rows: []
      });
    }
    
    const pData = personData.get(personId);
    pData.totalMinutes += durationMinutes;
    pData.rows.push(row);
    
    // Retirer des personnes sans lignes
    diagnostics.selectedPersonsWithoutRows.delete(personId);
  }
  
  // ============================================================================
  // TRI ET ORDONNANCEMENT
  // ============================================================================
  
  // Trier les lignes de chaque personne
  for (const pData of personData.values()) {
    sortPersonRows(pData.rows);
  }
  
  // Construire le tableau final dans l'ordre de personIds
  const persons = [];
  let exportedPersonCount = 0;
  let totalRowCount = 0;
  let grandTotalMinutes = 0;
  
  for (const personId of normalizedScope.personIds) {
    const pData = personData.get(personId);
    if (pData && pData.rows.length > 0) {
      persons.push(pData);
      exportedPersonCount++;
      totalRowCount += pData.rows.length;
      grandTotalMinutes += pData.totalMinutes;
    }
  }
  
  // ============================================================================
  // RÉSULTAT FINAL
  // ============================================================================
  
  return {
    period: {
      startDateIso,
      endDateIso
    },
    scope: normalizedScope,
    persons,
    totals: {
      selectedPersonCount: normalizedScope.personIds.length,
      exportedPersonCount,
      rowCount: totalRowCount,
      totalMinutes: grandTotalMinutes
    },
    diagnostics: {
      skippedOutsidePeriod: diagnostics.skippedOutsidePeriod,
      skippedOutsideScope: diagnostics.skippedOutsideScope,
      skippedUnknownPerson: diagnostics.skippedUnknownPerson,
      skippedUnknownTask: diagnostics.skippedUnknownTask,
      skippedZeroDurationCells: diagnostics.skippedZeroDurationCells,
      selectedPersonsWithoutRows: Array.from(diagnostics.selectedPersonsWithoutRows)
    }
  };
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

const CraExportModel = {
  buildReport,
  normalizeScope,
  validateDateRange,
  isValidDateIso,
  hoursToMinutes,
  // Helpers exportés pour tests futurs
  getGristDateKey,
  localDayKeyFromMs,
  groupEntriesByCell,
  getCellDisplayedHours,
  resolveProgramme,
  resolveTask,
  resolveProject,
  resolvePerson,
  isEntryInRange,
  entryMatchesScope,
  hasNumericValue,
  normalizeId,
  sortPersonRows,
  // Fonction interne exposée pour tests
  resolveCraController,
  getCraController
};

// Export navigateur
if (typeof globalThis !== 'undefined') {
  globalThis.CraExportModel = CraExportModel;
}

// Export CommonJS (Node/Jest)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CraExportModel;
}
