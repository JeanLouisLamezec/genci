/**
 * CRA Identity Association - Module pur d'identité et d'association
 * 
 * Ce module contient la logique métier pure pour :
 * - Résoudre l'identité d'un utilisateur Grist connecté
 * - Détecter les conflits de données (doublons)
 * - Lister les lignes Team claimables
 * - Construire une action d'association valide
 * 
 * PURTÉ : Aucune dépendance à Grist, au DOM, ou aux effets de bord.
 * Testable unitairement avec des données mockées.
 * 
 * @module core/cra/cra-identity-association
 */

'use strict';

// ============================================================================
// CONSTANTES - États d'identité
// ============================================================================

const IDENTITY_STATUS = {
  IDENTIFIED: 'IDENTIFIED',
  ASSOCIATION_REQUIRED: 'ASSOCIATION_REQUIRED',
  INVALID_CURRENT_USER_ID: 'INVALID_CURRENT_USER_ID',
  CURRENT_USER_ID_DUPLICATED: 'CURRENT_USER_ID_DUPLICATED',
  GRIST_USER_ID_DUPLICATED: 'GRIST_USER_ID_DUPLICATED',
  NO_CLAIMABLE_TEAM_ROW: 'NO_CLAIMABLE_TEAM_ROW',
  DATA_CONFLICT: 'DATA_CONFLICT'
};

// Note : TEAM_EMAIL_DUPLICATED a été retiré car les doublons d'email
// ne bloquent plus l'association en mode libre (provisoire).
// La détection est conservée pour diagnostic via findDuplicateEmails().

// ============================================================================
// HELPERS DE NORMALISATION
// ============================================================================

/**
 * Normalise un Grist userId en entier positif ou null
 * @param {*} value - Valeur à normaliser
 * @returns {number|null} - Entier positif ou null
 */
function normalizeGristUserId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  
  if (value === 0 || value === '0') {
    return null;
  }
  
  if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) {
    return null;
  }
  
  const numeric = Number(value);
  
  return (Number.isInteger(numeric) && numeric > 0) ? numeric : null;
}

/**
 * Normalise un email pour comparaison (lowercase + trim)
 * @param {*} value - Email à normaliser
 * @returns {string} - Email normalisé ou chaîne vide
 */
function normalizeEmail(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim().toLowerCase();
}

/**
 * Vérifie si une valeur est "non associée"
 * @param {*} value - Valeur à tester
 * @returns {boolean} - true si non associé
 */
function isUnassociated(value) {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    value === 0 ||
    value === '0'
  );
}

/**
 * Vérifie si un Grist userId est valide (entier strictement positif)
 * @param {*} value - Valeur à tester
 * @returns {boolean} - true si valide
 */
function isValidGristUserId(value) {
  const normalized = normalizeGristUserId(value);
  return normalized !== null && normalized > 0;
}

// ============================================================================
// DÉTECTION DES CONFLITS
// ============================================================================

/**
 * Détecte les doublons de gristUserId dans l'équipe
 * @param {Array} team - Liste des membres Team
 * @returns {Array} - Liste des userId dupliqués
 */
function findDuplicateGristUserIds(team) {
  const counts = new Map();
  
  for (const member of team) {
    const userId = normalizeGristUserId(member.gristUserId);
    if (userId !== null) {
      counts.set(userId, (counts.get(userId) || 0) + 1);
    }
  }
  
  const duplicates = [];
  for (const [userId, count] of counts) {
    if (count > 1) {
      duplicates.push(userId);
    }
  }
  
  return duplicates;
}

/**
 * Détecte les doublons d'email dans l'équipe
 * @param {Array} team - Liste des membres Team
 * @returns {Map<string, Array>} - Map email → membres
 */
function findDuplicateEmails(team) {
  const byEmail = new Map();
  
  for (const member of team) {
    const email = normalizeEmail(member.email);
    if (email !== '') {
      if (!byEmail.has(email)) {
        byEmail.set(email, []);
      }
      byEmail.get(email).push(member);
    }
  }
  
  const duplicates = new Map();
  for (const [email, members] of byEmail) {
    if (members.length > 1) {
      duplicates.set(email, members);
    }
  }
  
  return duplicates;
}

/**
 * Vérifie si le currentUserId est dupliqué dans l'équipe
 * @param {Array} team - Liste des membres Team
 * @param {number} currentGristUserId - userId Grist actuel
 * @returns {Array} - Membres ayant ce userId
 */
function findMembersByGristUserId(team, currentGristUserId) {
  if (!isValidGristUserId(currentGristUserId)) {
    return [];
  }
  
  return team.filter(member => 
    normalizeGristUserId(member.gristUserId) === currentGristUserId
  );
}

// ============================================================================
// RÉSOLUTION D'IDENTITÉ
// ============================================================================

/**
 * Résout l'identité de l'utilisateur Grist connecté
 * 
 * @param {Object} options - Options de résolution
 * @param {Array} options.team - Liste des membres Team
 * @param {*} options.currentGristUserId - userId Grist actuel (brut)
 * @param {string} [options.currentEmail] - email Grist actuel (optionnel)
 * @returns {Object} - Résultat de résolution
 */
function resolveCurrentUserIdentity({ team, currentGristUserId, currentEmail }) {
  const result = {
    status: null,
    currentUserMemberId: null,
    member: null,
    candidates: [],
    conflictCodes: []
  };
  
  // 1. Valider le currentGristUserId
  const normalizedUserId = normalizeGristUserId(currentGristUserId);
  
  if (!isValidGristUserId(currentGristUserId)) {
    result.status = IDENTITY_STATUS.INVALID_CURRENT_USER_ID;
    result.conflictCodes.push('INVALID_USER_ID');
    return result;
  }
  
  // 2. Détecter les conflits bloquants
  
  // 2a. Doublons de gristUserId dans toute l'équipe (BLOQUANT)
  const duplicateUserIds = findDuplicateGristUserIds(team);
  if (duplicateUserIds.length > 0) {
    result.status = IDENTITY_STATUS.GRIST_USER_ID_DUPLICATED;
    result.conflictCodes.push('GRIST_USER_ID_DUPLICATED');
    result.duplicateUserIds = duplicateUserIds;
    return result;
  }
  
  // 2b. Doublons d'email : NON BLOQUANT en mode libre
  // On conserve la détection pour diagnostic/logging
  const duplicateEmails = findDuplicateEmails(team);
  if (duplicateEmails.size > 0) {
    // Log pour diagnostic, mais ne bloque pas
    console.warn('[CRA identity] Emails dupliqués détectés (mode libre)', {
      duplicateEmails: Array.from(duplicateEmails.keys())
    });
    result.duplicateEmails = Array.from(duplicateEmails.keys());
  }
  
  // 3. Chercher une correspondance par gristUserId
  const matchingMembers = findMembersByGristUserId(team, normalizedUserId);
  
  if (matchingMembers.length > 1) {
    // Cas théoriquement impossible après vérification des doublons, mais sécurité
    result.status = IDENTITY_STATUS.CURRENT_USER_ID_DUPLICATED;
    result.conflictCodes.push('CURRENT_USER_ID_DUPLICATED');
    result.matchingMembers = matchingMembers;
    return result;
  }
  
  if (matchingMembers.length === 1) {
    // Utilisateur déjà identifié
    result.status = IDENTITY_STATUS.IDENTIFIED;
    result.currentUserMemberId = matchingMembers[0].id;
    result.member = matchingMembers[0];
    return result;
  }
  
  // 4. Aucune correspondance par userId → association requise
  
  // 4a. Vérifier s'il y a des candidats claimables
  const candidates = listClaimableTeamMembers({
    team,
    currentGristUserId: normalizedUserId,
    currentEmail: normalizeEmail(currentEmail)
  });
  
  if (candidates.length === 0) {
    result.status = IDENTITY_STATUS.NO_CLAIMABLE_TEAM_ROW;
    result.conflictCodes.push('NO_CLAIMABLE_TEAM_ROW');
    return result;
  }
  
  // 4b. Association requise avec candidats disponibles
  result.status = IDENTITY_STATUS.ASSOCIATION_REQUIRED;
  result.currentUserMemberId = null;
  result.candidates = candidates;
  
  return result;
}

// ============================================================================
// LISTE DES CANDIDATS CLAIMABLES
// ============================================================================

/**
 * Liste les membres Team qui peuvent être claimés (mode libre)
 * 
 * Critères :
 * - email non vide
 * - gristUserId non associé (null, 0, '', etc.)
 * - actif (si la colonne existe et est false, exclure)
 * 
 * NOTE : Les emails dupliqués ne sont PLUS exclus en mode libre.
 * 
 * @param {Object} options - Options
 * @param {Array} options.team - Liste des membres Team
 * @param {number} options.currentGristUserId - userId Grist actuel
 * @param {string} [options.currentEmail] - email Grist actuel normalisé
 * @returns {Array} - Liste des candidats
 */
function listClaimableTeamMembers({ team, currentGristUserId, currentEmail }) {
  const candidates = [];
  
  for (const member of team) {
    // 1. email non vide
    const email = normalizeEmail(member.email);
    if (email === '') {
      continue;
    }
    
    // 2. gristUserId non associé
    if (!isUnassociated(member.gristUserId)) {
      continue;
    }
    
    // 3. actif (si la colonne existe et est explicitement false)
    if (member.actif === false) {
      continue;
    }
    
    // En mode libre, on n'exclut PAS les emails dupliqués
    
    candidates.push({
      id: member.id,
      nom: member.nom,
      email: email
    });
  }
  
  return candidates;
}

// ============================================================================
// CONSTRUCTION D'UNE ACTION D'ASSOCIATION
// ============================================================================

/**
 * Construit une action d'association valide
 * 
 * @param {Object} options - Options
 * @param {Array} options.team - Liste des membres Team (pour vérification)
 * @param {number} options.selectedTeamMemberId - ID du membre sélectionné
 * @param {*} options.currentGristUserId - userId Grist actuel
 * @returns {Object} - Action d'association ou erreur
 */
function buildIdentityClaim({ team, selectedTeamMemberId, currentGristUserId }) {
  const result = {
    allowed: false,
    teamMemberId: null,
    gristUserId: null,
    code: null,
    reason: null
  };
  
  // 1. Valider le currentGristUserId
  const normalizedUserId = normalizeGristUserId(currentGristUserId);
  
  if (!isValidGristUserId(currentGristUserId)) {
    result.code = 'INVALID_CURRENT_USER_ID';
    result.reason = 'Le userId Grist actuel est invalide';
    return result;
  }
  
  // 2. Valider le selectedTeamMemberId
  const normalizedMemberId = normalizeGristUserId(selectedTeamMemberId);
  
  if (!isValidGristUserId(selectedTeamMemberId)) {
    result.code = 'INVALID_TEAM_MEMBER_ID';
    result.reason = 'L\'ID du membre Team est invalide';
    return result;
  }
  
  // 3. Trouver la ligne Team correspondante
  const member = team.find(m => m.id === normalizedMemberId);
  
  if (!member) {
    result.code = 'TEAM_MEMBER_NOT_FOUND';
    result.reason = 'Le membre sélectionné n\'existe pas dans Team';
    return result;
  }
  
  // 4. Vérifier que la ligne n'est pas déjà associée
  if (!isUnassociated(member.gristUserId)) {
    result.code = 'TEAM_MEMBER_ALREADY_ASSOCIATED';
    result.reason = 'Ce membre est déjà associé à un compte Grist';
    return result;
  }
  
  // 5. Vérifier qu'aucun autre membre n'a déjà ce userId
  const existingAssociation = team.find(m => 
    normalizeGristUserId(m.gristUserId) === normalizedUserId
  );
  
  if (existingAssociation) {
    result.code = 'GRIST_USER_ID_ALREADY_CLAIMED';
    result.reason = 'Ce compte Grist est déjà associé à un autre membre';
    return result;
  }
  
  // 6. Construire l'action
  result.allowed = true;
  result.teamMemberId = normalizedMemberId;
  result.gristUserId = normalizedUserId;
  result.memberEmail = normalizeEmail(member.email);
  
  return result;
}

/**
 * Vérifie si une association est idempotente (déjà appliquée)
 * 
 * @param {Object} options - Options
 * @param {Array} options.team - Liste des membres Team
 * @param {number} options.teamMemberId - ID du membre Team
 * @param {*} options.currentGristUserId - userId Grist actuel
 * @returns {boolean} - true si déjà associée
 */
function isAssociationAlreadyApplied({ team, teamMemberId, currentGristUserId }) {
  const normalizedUserId = normalizeGristUserId(currentGristUserId);
  const normalizedMemberId = normalizeGristUserId(teamMemberId);
  
  if (!isValidGristUserId(currentGristUserId) || !isValidGristUserId(teamMemberId)) {
    return false;
  }
  
  const member = team.find(m => m.id === normalizedMemberId);
  
  if (!member) {
    return false;
  }
  
  return normalizeGristUserId(member.gristUserId) === normalizedUserId;
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

module.exports = {
  // Constantes
  IDENTITY_STATUS,
  
  // Helpers de normalisation
  normalizeGristUserId,
  normalizeEmail,
  isUnassociated,
  isValidGristUserId,
  
  // Détection des conflits
  findDuplicateGristUserIds,
  findDuplicateEmails,
  findMembersByGristUserId,
  
  // Résolution d'identité
  resolveCurrentUserIdentity,
  
  // Liste des candidats
  listClaimableTeamMembers,
  
  // Construction d'action
  buildIdentityClaim,
  isAssociationAlreadyApplied
};
