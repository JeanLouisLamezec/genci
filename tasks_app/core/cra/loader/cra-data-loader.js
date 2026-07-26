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
 * Helper : préserve null et 0 pour les capacités
 * CONTRAT : null reste null, 0 reste 0
 */
function normalizeCapacityValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }
  return number;
}

/**
 * Helper : normalise un ID de membre (délégation vers workflow)
 */
function workflowNormalizeMemberId(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  if (
    typeof value === 'string' &&
    !/^[1-9]\d*$/.test(value)
  ) {
    return null;
  }

  const numeric = Number(value);

  return (
    Number.isInteger(numeric) &&
    numeric > 0
  )
    ? numeric
    : null;
}

/**
 * Helper : normalise une révision (délégation vers workflow)
 */
function workflowNormalizeRevision(value) {
  const numeric = Number(value);
  return (
    Number.isInteger(numeric) &&
    numeric >= 0
  ) ? numeric : 0;
}

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
 * Décoder le payload d'un JWT de manière défensive
 * @param {string} token - JWT token
 * @returns {Object|null} Payload décodé ou null
 */
function tryDecodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  
  if (parts.length !== 3) {
    return null;
  }
  
  try {
    let payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    // Ajouter le padding si nécessaire
    payload += '='.repeat((4 - payload.length % 4) % 4);
    
    return JSON.parse(atob(payload));
  } catch (error) {
    console.error('[CRA identity] Échec décodage JWT', error);
    return null;
  }
}

/**
 * Helper : normaliser un email pour comparaison
 */
function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Helper : importer le module d'identité (depuis le bundle TaskFlowCra)
 */
function getIdentityAssociationModule() {
  try {
    // Priorité au bundle TaskFlowCra (recommandé)
    if (typeof globalThis.TaskFlowCra !== 'undefined' && globalThis.TaskFlowCra.identity) {
      return globalThis.TaskFlowCra.identity;
    }
    // Fallback vers l'ancien nom (pour compatibilité)
    if (typeof globalThis.CraIdentityAssociation !== 'undefined') {
      return globalThis.CraIdentityAssociation;
    }
  } catch (e) {
    // Module non chargé
  }
  return null;
}

/**
 * Obtient l'utilisateur Grist actuel (TODO 16)
 * Retourne userId ET email pour l'identification
 * LOGS EXPLICITES : affiche les claims disponibles pour diagnostic
 */
async function getCurrentGristUser(grist) {
  try {
    const tokenResult = await grist.docApi.getAccessToken({ readOnly: true });
    
    if (!tokenResult || !tokenResult.token) {
      console.error('[CRA identity] Token vide ou manquant');
      return null;
    }
    
    const payload = tryDecodeJwtPayload(tokenResult.token);
    
    if (!payload) {
      console.error('[CRA identity] Jeton non décodable', {
        segmentCount: String(tokenResult.token || '').split('.').length
      });
      return null;
    }
    
    // Extraire userId depuis plusieurs sources possibles
    const userId = (
      payload.userId ??
      payload.user?.id ??
      payload.sub ??
      null
    );
    
    // Extraire email depuis plusieurs sources possibles
    const email = (
      payload.email ??
      payload.user?.email ??
      payload.loginEmail ??
      null
    );
    
    // Log de diagnostic (NE PAS logger le token lui-même)
    console.info('[CRA identity]', {
      source: 'access-token',
      userId,
      email: normalizeEmail(email),
      availableClaims: Object.keys(payload)
    });
    
    return { userId, email };
  } catch (error) {
    console.error('[CRA identity] Identification impossible', error);
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
    columns: ['id', 'nom', 'email', 'gristUserId', 'actif', 'capaciteHebdo', 'indispos', 'entite', 'responsable']
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
    columns: [
      'id', 'membre', 'semaine', 'statut',
      'responsableValidation', 'soumisPar', 'dateSoumission',
      'revisionValidation', 'validePar', 'dateValidation',
      'motifRejet', 'motifCorrection'
    ]
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
 * 
 * PHASE 3 - LOGS STRUCTURÉS :
 * - Log au début et fin de chargement
 * - Compte des entrées par table
 * - Diagnostics en cas d'erreur
 */
async function fetchCraSnapshot(grist) {
  const startedAt = performance.now();
  
  perfLog('fetch.start', { phase: 'load' });
  
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
  
  const counts = {
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
  };
  
  perfLog('fetch.complete', {
    phase: 'load',
    durationMs: Math.round(fetchDuration),
    tables: counts
  });
  
  // Log structuré pour diagnostic
  console.info('[CRA]', {
    phase: 'load',
    timeEntryCount: counts.timeEntries,
    assignmentCount: counts.assignments,
    sheetCount: counts.feuilles,
    capacityCount: counts.dailyCapacities,
    durationMs: Math.round(fetchDuration)
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
 * Helper : convertit une valeur Grist en nombre ou null
 * CONTRAT : préserve la nullabilité de heures pour distinguer :
 *   - null = aucun réalisé encore confirmé (proposition à confirmer)
 *   - 0 = l'utilisateur a explicitement déclaré zéro
 *   - >0 = réalisé saisi
 * 
 * @param {*} value - Valeur Grist à convertir
 * @returns {number|null} Nombre ou null
 */
function nullableNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

/**
 * Normalise un snapshot brut en état CRA utilisable
 * 
 * PHASE 3 - CORRECTIONS :
 * - Conserve TOUS les champs originaux de TimeEntries
 * - Garantit que id est présent sur chaque entrée
 * - Initialisation défensive pour les valeurs nulles
 * - PHASE 2 : préserve null dans heures (ne pas convertir en 0)
 * 
 * @param {Object} raw - Snapshot brut Grist
 * @param {Object} currentUser - Utilisateur Grist actuel
 * @returns {Object} Snapshot normalisé
 */
function normalizeCraSnapshot(raw, currentUser) {
  const team = columnarToRows(raw.team).map(r => ({
    id: r.id,
    nom: r.nom,
    email: r.email,
    gristUserId: r.gristUserId,
    actif: r.actif !== false,  // true par défaut si undefined ou null
    entite: workflowNormalizeMemberId(r.entite),
    agentsGeres: [],
    capaciteHebdo: normalizeCapacityValue(r.capaciteHebdo) !== null ? normalizeCapacityValue(r.capaciteHebdo) : 35,
    indispos: r.indispos || '',
    responsable: workflowNormalizeMemberId(r.responsable)
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
  
  const timeEntries = columnarToRows(raw.timeEntries).map(r => {
    // PHASE 3 : Conserver TOUS les champs, surtout id
    // PHASE 2 : nullableNumber pour heures (préserve null, 0 reste 0)
    return {
      id: r.id,  // ID Grist requis pour UpdateRecord
      membre: workflowNormalizeMemberId(r.membre),
      tache: workflowNormalizeMemberId(r.tache),
      date: r.date,  // Timestamp Grist (secondes)
      heures: nullableNumber(r.heures),  // PHASE 2 : null ≠ 0
      heuresPrevues: normalizeCapacityValue(r.heuresPrevues),
      affectation: workflowNormalizeMemberId(r.affectation),
      capaciteTheorique: normalizeCapacityValue(r.capaciteTheorique),
      capaciteDisponible: normalizeCapacityValue(r.capaciteDisponible),
      capaciteJour: normalizeCapacityValue(r.capaciteJour),
      feuille: workflowNormalizeMemberId(r.feuille),
      revisionPlan: Number(r.revisionPlan) || 0,
      imputation: r.imputation || '',
      description: r.description || ''
    };
  });
  
  const feuilles = columnarToRows(raw.feuilles).map(r => ({
    id: r.id,
    membre: r.membre,
    semaine: r.semaine,
    statut: r.statut,
    responsableValidation: workflowNormalizeMemberId(r.responsableValidation),
    soumisPar: workflowNormalizeMemberId(r.soumisPar),
    dateSoumission: r.dateSoumission,
    revisionValidation: workflowNormalizeRevision(r.revisionValidation),
    validePar: workflowNormalizeMemberId(r.validePar),
    dateValidation: r.dateValidation,
    motifRejet: r.motifRejet || '',
    motifCorrection: r.motifCorrection || ''
  }));
  
  const disponibilites = raw.disponibilites ? columnarToRows(raw.disponibilites) : [];
  
  const assignments = columnarToRows(raw.assignments).map(r => ({
    id: r.id,
    tache: workflowNormalizeMemberId(r.tache),
    membre: workflowNormalizeMemberId(r.membre),
    heuresAllouees: normalizeCapacityValue(r.heuresAllouees),
    dateDebut: r.dateDebut,
    dateFin: r.dateFin,
    modeRepartition: r.modeRepartition || 'uniforme',
    actif: r.actif !== false,
    commentaire: r.commentaire || ''
  }));
  
  const dailyCapacities = columnarToRows(raw.dailyCapacities).map(r => ({
    id: r.id,
    membre: workflowNormalizeMemberId(r.membre),
    date: r.date,
    capaciteTheorique: normalizeCapacityValue(r.capaciteTheorique),
    capaciteDisponible: normalizeCapacityValue(r.capaciteDisponible),
    revision: Number(r.revision) || 0
  }));
  
  // 1.2.1 - SÉPARATION IDENTITÉ : Distinguer utilisateur connecté et personne affichée
  const meUserId = workflowNormalizeMemberId(currentUser?.userId);
  const currentEmail = normalizeEmail(currentUser?.email);
  
  // Identification par gristUserId (méthode principale)
  const matchedByUserId = team.find(member =>
    workflowNormalizeMemberId(member.gristUserId) === meUserId
  );
  
  // Fallback par email (si le jeton contient l'email)
  // DÉTECTION DE DOUBLONS : échouer si plusieurs lignes ont le même email
  const emailMatches = currentEmail
    ? team.filter(member => normalizeEmail(member.email) === currentEmail)
    : [];
  
  let matchedByEmail = null;
  if (emailMatches.length > 1) {
    console.error('[CRA identity] Email Team dupliqué', {
      email: currentEmail,
      memberIds: emailMatches.map(member => member.id)
    });
    // Ne pas sélectionner silencieusement, retourner null
  } else if (emailMatches.length === 1) {
    matchedByEmail = emailMatches[0];
  }
  
  // Utiliser userId en priorité, sinon email
  const matchedUser = matchedByUserId || matchedByEmail;
  
  // Log de diagnostic de correspondance
  console.info('[CRA identity match]', {
    currentUserId: currentUser?.userId ?? null,
    currentEmail: currentEmail || null,
    matchedByUserId: matchedByUserId?.id ?? null,
    matchedByEmail: matchedByEmail?.id ?? null,
    currentUserMemberId: matchedUser?.id ?? null
  });
  
  // currentUserMemberId : l'utilisateur connecté (immuable, ne change pas avec les filtres)
  // Si identification échoue, reste null (pas de fallback silencieux vers team[0])
  const currentUserMemberId = matchedUser ? matchedUser.id : null;
  
  // selectedPersonId : la personne actuellement affichée (peut changer avec filtres)
  // Initialisée à currentUserMemberId si disponible, sinon null
  const selectedPersonId = currentUserMemberId || null;
  
  const matchedUserRow = matchedUser ? team.find(t => t.id === matchedUser.id) : null;
  const currentUserMemberName = matchedUserRow ? matchedUserRow.nom : '';
  
  // === ÉTAT D'IDENTITÉ (pour association libre) ===
  let identityState = null;
  
  const identityModule = getIdentityAssociationModule();
  if (identityModule) {
    try {
      identityState = identityModule.resolveCurrentUserIdentity({
        team,
        currentGristUserId: currentUser?.userId ?? null,
        currentEmail: currentUser?.email ?? null
      });
      
      console.info('[CRA identity state]', {
        status: identityState?.status,
        currentUserMemberId,
        candidateCount: identityState?.candidates?.length || 0,
        conflictCodes: identityState?.conflictCodes || []
      });
    } catch (e) {
      console.error('[CRA identity state] Erreur résolution', e);
      identityState = {
        status: 'DATA_CONFLICT',
        error: e.message
      };
    }
  }
  
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
    // NOUVEAU : Séparation identité
    currentGristUserId: meUserId,  // userId Grist brut (155719, pas Team.id)
    currentUserMemberId,     // Utilisateur connecté (immuable)
    currentUserMemberName,   // Nom de l'utilisateur connecté
    selectedPersonId,        // Personne actuellement affichée (change avec filtres)
    identityState,           // État d'association (IDENTIFIED, ASSOCIATION_REQUIRED, etc.)
    // LEGACY : Pour compatibilité temporaire (sera supprimé)
    me: currentUserMemberId, // Alias vers currentUserMemberId
    meName: currentUserMemberName,
    // État
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
 * 
 * PHASE 3 - CORRECTIONS :
 * - Timeout sur le chargement
 * - Gestion propre des erreurs
 * - Jamais de rechargement en boucle
 */
async function ensureCraReadyAndLoad(options) {
  const opts = options || {};
  // IMPORTANT : allowSchemaRecovery = false par défaut
  // Le CRA ne doit jamais réparer le schéma automatiquement.
  // Seul le Kanban peut initialiser/mettre à niveau le schéma via une action explicite.
  const allowSchemaRecovery = false;
  
  const startedAt = performance.now();
  
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
      // Erreur critique : propager immédiatement
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
  
  // CAS NOMINAL : toutes les tables sont présentes
  if (fetched && inspection.ready) {
    const normalized = normalizeCraSnapshot(fetched.raw, fetched.raw.currentUser);
    
    console.info('[CRA]', {
      phase: 'load-ready',
      durationMs: Math.round(performance.now() - startedAt),
      entryCount: normalized.entries.length,
      assignmentCount: normalized.assignments.length,
      sheetCount: normalized.feuilles.length
    });
    
    return normalized;
  }
  
  // SCHÉMA INCOMPLET
  if (!allowSchemaRecovery) {
    console.error('[CRA]', {
      phase: 'load-error',
      error: 'SCHEMA_INCOMPLETE',
      missingTables: inspection.missingTables,
      missingColumns: inspection.missingColumns,
      durationMs: Math.round(performance.now() - startedAt)
    });
    
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
  
  nullableNumber,  // PHASE 2 : export pour tests
  
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
