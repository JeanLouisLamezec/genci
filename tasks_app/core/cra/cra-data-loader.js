/**
 * CRA Data Loader - Chargeur de données optimisé pour le CRA
 * 
 * Fournit un chargement parallèle des données, une validation du schéma,
 * et un scheduler de rechargement pour éviter les appels concurrents.
 * 
 * @module core/cra/cra-data-loader
 */

'use strict';

// ============================================================================
// INSTRUMENTATION (TODO 1)
// ============================================================================

const CRA_PERF_DEBUG = (function() {
  try {
    return typeof location !== 'undefined' &&
      new URLSearchParams(location.search).get('debugPerf') === '1';
  } catch (e) {
    return false;
  }
})();

let loadIdCounter = 0;

function perfLog(label, details) {
  if (!CRA_PERF_DEBUG) return;
  
  console.info(
    '[CRA perf] ' + label,
    details || ''
  );
}

function createLoadId() {
  return ++loadIdCounter;
}

// ============================================================================
// CHARGEMENT PARALLÈLE (TODO 2)
// ============================================================================

/**
 * Charge une table optionnelle, retourne null si elle n'existe pas
 * @param {Object} grist - API Grist
 * @param {string} tableName - Nom de la table
 * @returns {Promise<Object|null>} Données colonnaires ou null
 */
async function fetchOptionalTable(grist, tableName) {
  try {
    return await grist.docApi.fetchTable(tableName);
  } catch (error) {
    // Table n'existe pas ou erreur temporaire
    return null;
  }
}

/**
 * Charge une table obligatoire, propage l'erreur si elle n'existe pas
 * @param {Object} grist - API Grist
 * @param {string} tableName - Nom de la table
 * @returns {Promise<Object>} Données colonnaires
 */
async function fetchRequiredTable(grist, tableName) {
  return await grist.docApi.fetchTable(tableName);
}

/**
 * Obtient l'utilisateur Grist actuel
 * @param {Object} grist - API Grist
 * @returns {Promise<Object|null>}
 */
async function getCurrentGristUser(grist) {
  try {
    const tok = await grist.docApi.getAccessToken({ readOnly: true });
    const p = JSON.parse(atob(tok.token.split('.')[1]));
    return { userId: p.userId || null };
  } catch (e) {
    return null;
  }
}

/**
 * Charge un snapshot complet des données CRA en parallèle
 * @param {Object} grist - API Grist
 * @returns {Promise<{raw: Object, fetchDuration: number}>}
 */
async function fetchCraSnapshot(grist) {
  const startedAt = performance.now();
  
  // Charger toutes les tables en parallèle
  const [
    team,
    entites,
    tasks,
    projects,
    programmes,
    timeEntries,
    feuilles,
    disponibilites,
    assignments,
    dailyCapacities,
    currentUser
  ] = await Promise.all([
    fetchRequiredTable(grist, 'Team'),
    fetchOptionalTable(grist, 'Entites'),
    fetchRequiredTable(grist, 'Tasks'),
    fetchRequiredTable(grist, 'Projects'),
    fetchOptionalTable(grist, 'Programmes'),
    fetchRequiredTable(grist, 'TimeEntries'),
    fetchRequiredTable(grist, 'Feuilles'),
    fetchOptionalTable(grist, 'Disponibilites'),
    fetchRequiredTable(grist, 'TaskAssignments'),
    fetchRequiredTable(grist, 'MemberDailyCapacities'),
    getCurrentGristUser(grist)
  ]);
  
  const fetchDuration = performance.now() - startedAt;
  
  perfLog('fetch.complete', {
    durationMs: Math.round(fetchDuration),
    tables: {
      team: team && team.id ? team.id.length : 0,
      entites: entites && entites.id ? entites.id.length : 0,
      tasks: tasks && tasks.id ? tasks.id.length : 0,
      projects: projects && projects.id ? projects.id.length : 0,
      programmes: programmes && programmes.id ? programmes.id.length : 0,
      timeEntries: timeEntries && timeEntries.id ? timeEntries.id.length : 0,
      feuilles: feuilles && feuilles.id ? feuilles.id.length : 0,
      disponibilites: disponibilites && disponibilites.id ? disponibilites.id.length : 0,
      assignments: assignments && assignments.id ? assignments.id.length : 0,
      dailyCapacities: dailyCapacities && dailyCapacities.id ? dailyCapacities.id.length : 0
    }
  });
  
  return {
    raw: {
      team,
      entites,
      tasks,
      projects,
      programmes,
      timeEntries,
      feuilles,
      disponibilites,
      assignments,
      dailyCapacities,
      currentUser
    },
    fetchDuration
  };
}

// ============================================================================
// VALIDATION DU SCHÉMA (TODO 3)
// ============================================================================

/**
 * Helper : convertit un tableau colonnaire Grist en tableau d'objets
 * @param {Object} data - Données colonnaires
 * @returns {Array}
 */
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

/**
 * Vérifie la présence d'une colonne dans des données colonnaires
 * @param {Object} colData - Données colonnaires
 * @param {string} colName - Nom de la colonne
 * @returns {boolean}
 */
function hasColumn(colData, colName) {
  if (!colData) return false;
  return Object.prototype.hasOwnProperty.call(colData, colName);
}

/**
 * Inspecte un snapshot CRA et valide les tables et colonnes indispensables
 * @param {Object} rawSnapshot - Données brutes du snapshot
 * @returns {{
 *   ready: boolean,
 *   missingTables: Array<string>,
 *   missingColumns: Array<string>,
 *   optionalMissing: Array<string>
 * }}
 */
function inspectCraSnapshot(rawSnapshot) {
  const result = {
    ready: true,
    missingTables: [],
    missingColumns: [],
    optionalMissing: []
  };
  
  // Tables obligatoires
  const requiredTables = [
    'Team',
    'Tasks',
    'Projects',
    'TimeEntries',
    'Feuilles',
    'TaskAssignments',
    'MemberDailyCapacities'
  ];
  
  // Tables optionnelles
  const optionalTables = [
    'Entites',
    'Programmes',
    'Disponibilites'
  ];
  
  // Colonnes indispensables par table
  const requiredColumns = {
    Team: ['id', 'nom'],
    Tasks: ['id', 'titre', 'projet'],
    Projects: ['id', 'nom'],
    TimeEntries: [
      'id', 'membre', 'tache', 'date', 'heures',
      'heuresPrevues', 'affectation', 'capaciteTheorique',
      'capaciteDisponible', 'capaciteJour', 'feuille',
      'revisionPlan', 'imputation', 'description'
    ],
    Feuilles: [
      'id', 'membre', 'semaine', 'statut',
      'validePar', 'dateValidation', 'motifRejet'
    ],
    TaskAssignments: ['id', 'tache', 'membre', 'actif'],
    MemberDailyCapacities: [
      'id', 'membre', 'date',
      'capaciteTheorique', 'capaciteDisponible', 'revision'
    ]
  };
  
  // Vérifier les tables obligatoires
  for (const tableName of requiredTables) {
    if (!rawSnapshot[tableName]) {
      result.missingTables.push(tableName);
      result.ready = false;
    }
  }
  
  // Vérifier les tables optionnelles
  for (const tableName of optionalTables) {
    if (!rawSnapshot[tableName]) {
      result.optionalMissing.push(tableName);
    }
  }
  
  // Vérifier les colonnes des tables obligatoires
  for (const tableName of requiredTables) {
    const tableData = rawSnapshot[tableName];
    if (!tableData) continue;
    
    const columns = requiredColumns[tableName] || [];
    for (const colName of columns) {
      if (!hasColumn(tableData, colName)) {
        result.missingColumns.push(tableName + '.' + colName);
        result.ready = false;
      }
    }
  }
  
  return result;
}

// ============================================================================
// NORMALISATION DES DONNÉES (TODO 9)
// ============================================================================

/**
 * Normalise un snapshot brut en état CRA utilisable
 * @param {Object} raw - Données brutes
 * @param {Object} currentUser - Utilisateur actuel
 * @returns {Object} État normalisé
 */
function normalizeCraSnapshot(raw, currentUser) {
  const team = columnarToRows(raw.team).map(r => ({
    id: r.id,
    nom: r.nom,
    email: r.email,
    gristUserId: r.gristUserId,
    entite: Number(r.entite) || 0,
    agentsGeres: [], // Sera calculé plus tard
    capaciteHebdo: r.capaciteHebdo || 35,
    indispos: r.indispos || ''
  }));
  
  const entites = raw.entites ? columnarToRows(raw.entites).map(e => ({
    id: e.id,
    nom: e.nom || '',
    parent: Number(e.parent) || 0,
    chef: Number(e.chef) || 0
  })) : [];
  
  const tasks = columnarToRows(raw.tasks).map(r => ({
    id: r.id,
    titre: r.titre,
    projet: r.projet,
    assignees: r.assignees,
    charges: r.charges || null,
    dateDebut: r.dateDebut,
    dateEcheance: r.dateEcheance
  }));
  
  const projects = columnarToRows(raw.projects).map(r => ({
    id: r.id,
    nom: r.nom
  }));
  
  const programmes = raw.programmes ? columnarToRows(raw.programmes) : [];
  
  const timeEntries = columnarToRows(raw.timeEntries).map(r => ({
    id: r.id,
    membre: Number(r.membre) || null,
    tache: Number(r.tache) || null,
    date: r.date,
    heures: Number(r.heures) || 0,
    heuresPrevues: Number(r.heuresPrevues) || 0,
    affectation: Number(r.affectation) || null,
    capaciteTheorique: Number(r.capaciteTheorique) || 0,
    capaciteDisponible: Number(r.capaciteDisponible) || 0,
    capaciteJour: Number(r.capaciteJour) || null,
    feuille: Number(r.feuille) || null,
    revisionPlan: Number(r.revisionPlan) || 0,
    imputation: r.imputation || '',
    description: r.description || ''
  }));
  
  const feuilles = columnarToRows(raw.feuilles).map(r => ({
    id: r.id,
    membre: r.membre,
    semaine: r.semaine,
    statut: r.statut,
    validePar: r.validePar,
    motifRejet: r.motifRejet
  }));
  
  const disponibilites = raw.disponibilites ? columnarToRows(raw.disponibilites) : [];
  
  const assignments = columnarToRows(raw.assignments).map(r => ({
    id: r.id,
    tache: Number(r.tache) || null,
    membre: Number(r.membre) || null,
    heuresAllouees: Number(r.heuresAllouees) || 0,
    dateDebut: r.dateDebut,
    dateFin: r.dateFin,
    modeRepartition: r.modeRepartition || 'uniforme',
    actif: r.actif !== false,
    commentaire: r.commentaire || ''
  }));
  
  const dailyCapacities = columnarToRows(raw.dailyCapacities);
  
  // Résolution "moi"
  const meUserId = currentUser ? currentUser.userId : null;
  let me = team.find(t => t.gristUserId && t.gristUserId === meUserId);
  const meId = me ? me.id : (team[0] ? team[0].id : null);
  const meRow = team.find(t => t.id === meId);
  const meName = meRow ? meRow.nom : '';
  
  return {
    team,
    entites,
    tasks,
    projects,
    programmes,
    entries: timeEntries,
    feuilles,
    disponibilites,
    assignments,
    dailyCapacities,
    meUserId,
    me: meId,
    meName,
    mesGeres: [], // Sera calculé plus tard
    visiblePersonIds: team.map(m => m.id),
    gOk: true
  };
}

// ============================================================================
// SCHEDULER DE RECHARGEMENT (TODO 6)
// ============================================================================

let reloadInProgress = false;
let reloadRequested = false;
let pendingReloadReason = null;
let reloadGeneration = 0;
let appliedGeneration = 0;
let reloadTimer = null;

/**
 * Demande un rechargement des données CRA
 * @param {Object} options
 * @param {string} options.reason - Raison du rechargement
 * @param {boolean} options.immediate - Exécuter immédiatement
 * @param {boolean} options.allowSchemaRecovery - Autoriser la récupération de schéma
 */
function requestCraReload(options) {
  const opts = options || {};
  const reason = opts.reason || 'unknown';
  
  pendingReloadReason = reason;
  
  if (opts.immediate) {
    return runReloadLoop();
  }
  
  clearTimeout(reloadTimer);
  
  // Délai de fusion : 120ms
  reloadTimer = setTimeout(runReloadLoop, 120);
  
  return Promise.resolve();
}

/**
 * Boucle de rechargement - sérialise les appels
 * @returns {Promise<void>}
 */
async function runReloadLoop() {
  if (reloadInProgress) {
    reloadRequested = true;
    return;
  }
  
  reloadInProgress = true;
  
  try {
    do {
      reloadRequested = false;
      
      const generation = ++reloadGeneration;
      const reason = pendingReloadReason;
      
      perfLog('reload.start', { generation, reason });
      
      // Le chargement sera géré par ensureCraReadyAndLoad
      const snapshot = await loadCraSnapshotForReason(reason);
      
      // Vérifier si une nouvelle génération a commencé
      if (generation < reloadGeneration) {
        perfLog('reload.discarded', { generation, current: reloadGeneration });
        continue;
      }
      
      // Appliquer le snapshot
      applyCraSnapshot(snapshot, generation);
      appliedGeneration = generation;
      
      perfLog('reload.complete', { generation, reason });
    } while (reloadRequested);
  } finally {
    reloadInProgress = false;
  }
}

/**
 * Charge un snapshot pour une raison donnée
 * @param {string} reason
 * @returns {Promise<Object>}
 */
async function loadCraSnapshotForReason(reason) {
  // Sera implémenté avec ensureCraReadyAndLoad
  throw new Error('loadCraSnapshotForReason not implemented yet');
}

/**
 * Applique un snapshot à la génération donnée
 * @param {Object} snapshot
 * @param {number} generation
 */
function applyCraSnapshot(snapshot, generation) {
  // Sera implémenté avec le state management
  perfLog('snapshot.applied', { generation });
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

const CraDataLoader = {
  // Instrumentation
  CRA_PERF_DEBUG,
  perfLog,
  createLoadId,
  
  // Chargement
  fetchOptionalTable,
  fetchRequiredTable,
  getCurrentGristUser,
  fetchCraSnapshot,
  
  // Validation
  inspectCraSnapshot,
  hasColumn,
  columnarToRows,
  
  // Normalisation
  normalizeCraSnapshot,
  
  // Scheduler
  requestCraReload,
  runReloadLoop,
  loadCraSnapshotForReason,
  applyCraSnapshot,
  
  // État du scheduler (pour les tests)
  getSchedulerState: () => ({
    reloadInProgress,
    reloadRequested,
    pendingReloadReason,
    reloadGeneration,
    appliedGeneration
  }),
  
  resetScheduler: () => {
    reloadInProgress = false;
    reloadRequested = false;
    pendingReloadReason = null;
    reloadGeneration = 0;
    appliedGeneration = 0;
    clearTimeout(reloadTimer);
  }
};

// Export pour navigateur et Node
if (typeof globalThis !== 'undefined') {
  globalThis.CraDataLoader = CraDataLoader;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CraDataLoader;
}
