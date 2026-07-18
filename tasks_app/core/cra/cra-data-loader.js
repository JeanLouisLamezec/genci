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
// INSTRUMENTATION
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
// CONFIGURATION (TODO 2)
// ============================================================================

const loaderConfig = {
  grist: null,
  bootstrap: null,
  isReadOnly: () => false,
  applySnapshot: null,
  showLoading: null,
  showError: null,
  onSchemaUpgrade: null
};

/**
 * Configure le loader avec les dépendances injectées
 * @param {Object} options
 */
function configure(options) {
  if (!options) {
    throw new Error('CraDataLoader.configure: options requises');
  }
  
  Object.assign(loaderConfig, options || {});
  
  if (!loaderConfig.grist || !loaderConfig.grist.docApi) {
    throw new Error('CraDataLoader.configure: grist.docApi requis');
  }
  
  if (!loaderConfig.applySnapshot || typeof loaderConfig.applySnapshot !== 'function') {
    throw new Error('CraDataLoader.configure: applySnapshot requis');
  }
  
  if (typeof loaderConfig.isReadOnly !== 'function') {
    loaderConfig.isReadOnly = () => false;
  }
}

// ============================================================================
// CHARGEMENT PARALLÈLE (TODO 2, 4, 16)
// ============================================================================

/**
 * Helper : décoder base64 URL-safe (TODO 16)
 */
function decodeBase64Url(value) {
  if (typeof atob === 'function') {
    return atob(
      value
        .replace(/-/g, '+')
        .replace(/_/g, '/')
    );
  }
  
  if (typeof Buffer !== 'undefined') {
    return Buffer
      .from(value, 'base64url')
      .toString('utf8');
  }
  
  throw new Error('Décodage base64 indisponible');
}

/**
 * Obtient l'utilisateur Grist actuel (TODO 16)
 */
async function getCurrentGristUser(grist) {
  try {
    const tok = await grist.docApi.getAccessToken({ readOnly: true });
    const p = JSON.parse(decodeBase64Url(tok.token.split('.')[1]));
    return { userId: p.userId || null };
  } catch (e) {
    if (CRA_PERF_DEBUG) {
      console.debug('[CRA] User identification unavailable:', e.message);
    }
    return null;
  }
}

/**
 * Classification des erreurs (TODO 4)
 */
function classifyFetchError(error, tableName) {
  const message = String(
    error?.message ||
    error ||
    ''
  );
  
  if (
    /table.*not found|no such table|unknown table/i
      .test(message)
  ) {
    return {
      type: 'TABLE_MISSING',
      tableName,
      error
    };
  }
  
  if (
    /column.*not found|unknown column/i
      .test(message)
  ) {
    return {
      type: 'COLUMN_MISSING',
      tableName,
      error
    };
  }
  
  if (
    /access denied|permission|forbidden|read.only/i
      .test(message)
  ) {
    return {
      type: 'ACCESS_DENIED',
      tableName,
      error
    };
  }
  
  return {
    type: 'RPC_OR_NETWORK',
    tableName,
    error
  };
}

/**
 * Charge une table optionnelle, retourne null si elle n'existe pas
 */
async function fetchOptionalTable(grist, tableName) {
  try {
    return await grist.docApi.fetchTable(tableName);
  } catch (error) {
    const classified = classifyFetchError(error, tableName);
    
    if (
      classified.type === 'TABLE_MISSING' ||
      classified.type === 'COLUMN_MISSING'
    ) {
      return null;
    }
    
    throw error;
  }
}

/**
 * Charge une table obligatoire, propage l'erreur
 */
async function fetchRequiredTable(grist, tableName) {
  return await grist.docApi.fetchTable(tableName);
}

/**
 * Définition des tables CRA (TODO 3)
 */
const CRA_TABLES = {
  team: {
    tableId: 'Team',
    required: true,
    columns: ['id', 'nom', 'email', 'gristUserId', 'capaciteHebdo', 'indispos', 'entite']
  },
  
  entites: {
    tableId: 'Entites',
    required: false,
    columns: ['id', 'nom', 'parent', 'chef']
  },
  
  tasks: {
    tableId: 'Tasks',
    required: true,
    columns: ['id', 'titre', 'projet', 'assignees', 'charges', 'dateDebut', 'dateEcheance']
  },
  
  projects: {
    tableId: 'Projects',
    required: true,
    columns: ['id', 'nom', 'programme']
  },
  
  programmes: {
    tableId: 'Programmes',
    required: false,
    columns: ['id', 'nom', 'couleur', 'responsable']
  },
  
  timeEntries: {
    tableId: 'TimeEntries',
    required: true,
    columns: [
      'id', 'membre', 'tache', 'date', 'heures',
      'heuresPrevues', 'affectation', 'capaciteTheorique',
      'capaciteDisponible', 'capaciteJour', 'feuille',
      'revisionPlan', 'imputation', 'description'
    ]
  },
  
  feuilles: {
    tableId: 'Feuilles',
    required: true,
    columns: ['id', 'membre', 'semaine', 'statut', 'validePar', 'dateValidation', 'motifRejet']
  },
  
  disponibilites: {
    tableId: 'Disponibilites',
    required: false,
    columns: ['id', 'membre', 'type', 'dateDebut', 'dateFin', 'dispo', 'commentaire']
  },
  
  assignments: {
    tableId: 'TaskAssignments',
    required: true,
    columns: ['id', 'tache', 'membre', 'heuresAllouees', 'dateDebut', 'dateFin', 'modeRepartition', 'actif', 'commentaire']
  },
  
  dailyCapacities: {
    tableId: 'MemberDailyCapacities',
    required: true,
    columns: ['id', 'membre', 'date', 'capaciteTheorique', 'capaciteDisponible', 'revision']
  }
};

/**
 * Charge un snapshot complet des données CRA en parallèle (TODO 3)
 */
async function fetchCraSnapshot(grist) {
  const startedAt = performance.now();
  
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
// VALIDATION DU SCHÉMA (TODO 3, 4)
// ============================================================================

/**
 * Helper : convertit un tableau colonnaire Grist en tableau d'objets
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
 */
function hasColumn(colData, colName) {
  if (!colData) return false;
  return Object.prototype.hasOwnProperty.call(colData, colName);
}

/**
 * Inspecte un snapshot CRA et valide les tables et colonnes indispensables (TODO 3)
 */
function inspectCraSnapshot(rawSnapshot) {
  const result = {
    ready: true,
    missingTables: [],
    missingColumns: [],
    optionalMissing: []
  };
  
  const requiredTables = [
    'team',
    'tasks',
    'projects',
    'timeEntries',
    'feuilles',
    'assignments',
    'dailyCapacities'
  ];
  
  const optionalTables = [
    'entites',
    'programmes',
    'disponibilites'
  ];
  
  const requiredColumns = {
    team: ['id', 'nom'],
    tasks: ['id', 'titre', 'projet'],
    projects: ['id', 'nom'],
    timeEntries: [
      'id', 'membre', 'tache', 'date', 'heures',
      'heuresPrevues', 'affectation', 'capaciteTheorique',
      'capaciteDisponible', 'capaciteJour', 'feuille',
      'revisionPlan', 'imputation', 'description'
    ],
    feuilles: [
      'id', 'membre', 'semaine', 'statut',
      'validePar', 'dateValidation', 'motifRejet'
    ],
    assignments: ['id', 'tache', 'membre', 'actif'],
    dailyCapacities: [
      'id', 'membre', 'date',
      'capaciteTheorique', 'capaciteDisponible', 'revision'
    ]
  };
  
  for (const tableName of requiredTables) {
    if (!rawSnapshot[tableName]) {
      result.missingTables.push(tableName);
      result.ready = false;
    }
  }
  
  for (const tableName of optionalTables) {
    if (!rawSnapshot[tableName]) {
      result.optionalMissing.push(tableName);
    }
  }
  
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
// NORMALISATION DES DONNÉES (TODO 3)
// ============================================================================

/**
 * Normalise un snapshot brut en état CRA utilisable
 */
function normalizeCraSnapshot(raw, currentUser) {
  const team = columnarToRows(raw.team).map(r => ({
    id: r.id,
    nom: r.nom,
    email: r.email,
    gristUserId: r.gristUserId,
    entite: Number(r.entite) || 0,
    agentsGeres: [],
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
    nom: r.nom,
    programme: Number(r.programme) || null
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
    mesGeres: [],
    visiblePersonIds: team.map(m => m.id),
    hasTable: true,
    gOk: true
  };
}

// ============================================================================
// Récupération de schéma (TODO 5)
// ============================================================================

let schemaRecoveryInProgress = null;

/**
 * Crée une erreur de schéma structurée
 */
function createSchemaError(inspection) {
  const err = new Error(
    'Schéma CRA incomplet : ' +
    'Tables manquantes: ' + inspection.missingTables.join(', ') +
    '. Colonnes manquantes: ' + inspection.missingColumns.join(', ')
  );
  err.inspection = inspection;
  err.code = 'SCHEMA_INCOMPLETE';
  return err;
}

/**
 * Crée une erreur de schéma en lecture seule
 */
function createReadOnlySchemaError(inspection) {
  const err = new Error(
    'Schéma CRA incomplet et document en lecture seule. Impossible de réparer.'
  );
  err.inspection = inspection;
  err.code = 'SCHEMA_READ_ONLY';
  return err;
}

/**
 * Assure que le schéma est prêt et charge les données (TODO 5)
 */
async function ensureCraReadyAndLoad(options) {
  const opts = options || {};
  // IMPORTANT : allowSchemaRecovery = false par défaut
  // Le CRA ne doit jamais réparer le schéma automatiquement.
  // Seul le Kanban peut initialiser/mettre à niveau le schéma via une action explicite.
  const allowSchemaRecovery = false;
  
  loaderConfig.showLoading?.('Chargement des données…');
  
  let fetched;
  let fetchError = null;
  
  try {
    fetched = await fetchCraSnapshot(loaderConfig.grist);
  } catch (error) {
    fetchError = error;
    const classified = classifyFetchError(error, 'unknown');
    
    if (
      classified.type !== 'TABLE_MISSING' &&
      classified.type !== 'COLUMN_MISSING'
    ) {
      throw error;
    }
    
    fetched = null;
  }
  
  let inspection = fetched
    ? inspectCraSnapshot(fetched.raw)
    : {
        ready: false,
        missingTables: [],
        missingColumns: [],
        optionalMissing: []
      };
  
  if (fetched && inspection.ready) {
    return normalizeCraSnapshot(fetched.raw, fetched.raw.currentUser);
  }
  
  if (!allowSchemaRecovery) {
    throw createSchemaError(inspection);
  }
  
  if (loaderConfig.isReadOnly()) {
    throw createReadOnlySchemaError(inspection);
  }
  
  if (
    typeof loaderConfig.bootstrap?.ensureGenciSchema !== 'function'
  ) {
    throw new Error('Bootstrap indisponible pour réparer le schéma CRA');
  }
  
  loaderConfig.onSchemaUpgrade?.(inspection);
  
  if (!schemaRecoveryInProgress) {
    schemaRecoveryInProgress = loaderConfig.bootstrap
      .ensureGenciSchema(loaderConfig.grist, {
        reason: 'cra-schema-recovery'
      })
      .finally(() => {
        schemaRecoveryInProgress = null;
      });
  }
  
  await schemaRecoveryInProgress;
  
  const repaired = await fetchCraSnapshot(loaderConfig.grist);
  const repairedInspection = inspectCraSnapshot(repaired.raw);
  
  if (!repairedInspection.ready) {
    throw createSchemaError(repairedInspection);
  }
  
  return normalizeCraSnapshot(repaired.raw, repaired.raw.currentUser);
}

// ============================================================================
// SCHEDULER DE RECHARGEMENT (TODO 6, 8, 9)
// ============================================================================

let reloadInProgress = false;
let pendingRequest = null;
let requestedGeneration = 0;
let appliedGeneration = 0;
let reloadTimer = null;
let reloadWaiters = [];

/**
 * Crée une promesse d'attente pour le rechargement
 */
function createReloadWaiter() {
  return new Promise((resolve, reject) => {
    reloadWaiters.push({ resolve, reject });
  });
}

/**
 * Résout tous les waiters en cours
 */
function resolveReloadWaiters(result) {
  const waiters = reloadWaiters;
  reloadWaiters = [];
  waiters.forEach(w => w.resolve(result));
}

/**
 * Rejette tous les waiters en cours
 */
function rejectReloadWaiters(error) {
  const waiters = reloadWaiters;
  reloadWaiters = [];
  waiters.forEach(w => w.reject(error));
}

/**
 * Demande un rechargement des données CRA (TODO 8, 9)
 */
function requestCraReload(options) {
  const opts = options || {};
  const reason = opts.reason || 'unknown';
  
  const generation = ++requestedGeneration;
  
  pendingRequest = {
    generation,
    reason,
    allowSchemaRecovery: opts.allowSchemaRecovery === true
  };
  
  const waiter = createReloadWaiter();
  
  if (opts.immediate) {
    runReloadLoop();
  } else {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(runReloadLoop, 120);
  }
  
  return waiter;
}

/**
 * Boucle de rechargement - sérialise les appels (TODO 8)
 */
async function runReloadLoop() {
  if (reloadInProgress) {
    return;
  }
  
  reloadInProgress = true;
  
  try {
    while (pendingRequest) {
      const request = pendingRequest;
      pendingRequest = null;
      
      perfLog('reload.start', {
        generation: request.generation,
        reason: request.reason
      });
      
      try {
        const loaded = await loadCraSnapshotForReason(
          request.reason,
          {
            allowSchemaRecovery: request.allowSchemaRecovery
          }
        );
        
        if (request.generation !== requestedGeneration) {
          perfLog('reload.discarded', {
            generation: request.generation,
            requestedGeneration
          });
          continue;
        }
        
        applyCraSnapshot(loaded, request.generation);
        appliedGeneration = request.generation;
        
        resolveReloadWaiters(loaded);
        
        perfLog('reload.complete', {
          generation: request.generation,
          reason: request.reason
        });
      } catch (error) {
        loaderConfig.showError?.(error);
        
        console.error(
          '[CRA] Chargement impossible',
          error
        );
        
        rejectReloadWaiters(error);
        
        perfLog('reload.error', {
          generation: request.generation,
          reason: request.reason,
          error: error.message || String(error)
        });
      }
    }
  } finally {
    reloadInProgress = false;
  }
}

/**
 * Charge un snapshot pour une raison donnée (TODO 6)
 */
async function loadCraSnapshotForReason(reason, options) {
  const loadId = createLoadId();
  const startedAt = performance.now();
  
  perfLog('load.start', {
    loadId,
    reason
  });
  
  try {
    const snapshot = await ensureCraReadyAndLoad({
      reason,
      allowSchemaRecovery: options?.allowSchemaRecovery
    });
    
    perfLog('load.ready', {
      loadId,
      reason,
      durationMs: Math.round(performance.now() - startedAt)
    });
    
    return {
      loadId,
      reason,
      data: snapshot
    };
  } catch (error) {
    perfLog('load.error', {
      loadId,
      reason,
      message: error.message || String(error)
    });
    
    throw error;
  }
}

/**
 * Applique un snapshot à la génération donnée (TODO 7)
 */
function applyCraSnapshot(loaded, generation) {
  if (!loaded || !loaded.data) {
    throw new Error('Snapshot CRA invalide');
  }
  
  loaderConfig.applySnapshot(loaded.data, {
    generation,
    loadId: loaded.loadId,
    reason: loaded.reason
  });
  
  perfLog('snapshot.applied', {
    generation,
    loadId: loaded.loadId,
    reason: loaded.reason
  });
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

const CraDataLoader = {
  configure,
  
  CRA_PERF_DEBUG,
  perfLog,
  createLoadId,
  
  classifyFetchError,
  
  fetchOptionalTable,
  fetchRequiredTable,
  getCurrentGristUser,
  fetchCraSnapshot,
  
  inspectCraSnapshot,
  hasColumn,
  columnarToRows,
  
  normalizeCraSnapshot,
  
  ensureCraReadyAndLoad,
  
  requestCraReload,
  runReloadLoop,
  loadCraSnapshotForReason,
  applyCraSnapshot,
  
  createReloadWaiter,
  resolveReloadWaiters,
  rejectReloadWaiters,
  
  getSchedulerState: () => ({
    reloadInProgress,
    pendingRequest,
    requestedGeneration,
    appliedGeneration
  }),
  
  resetScheduler: () => {
    reloadInProgress = false;
    pendingRequest = null;
    requestedGeneration = 0;
    appliedGeneration = 0;
    reloadTimer = null;
    reloadWaiters = [];
    schemaRecoveryInProgress = null;
    clearTimeout(reloadTimer);
    
    loaderConfig.grist = null;
    loaderConfig.bootstrap = null;
    loaderConfig.isReadOnly = () => false;
    loaderConfig.applySnapshot = null;
    loaderConfig.showLoading = null;
    loaderConfig.showError = null;
    loaderConfig.onSchemaUpgrade = null;
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.CraDataLoader = CraDataLoader;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CraDataLoader;
}
