/**
 * CRA Identity Claim Service - Service d'association d'identité Grist
 * 
 * Ce service gère l'association effective entre :
 * - un compte Grist connecté (userId)
 * - une ligne Team (membre)
 * 
 * RESPONSABILITÉS :
 * 1. Vérifier la demande avec buildIdentityClaim()
 * 2. Poser un verrou d'opération (anti-double-clic)
 * 3. Envoyer l'écriture Grist : Team.gristUserId = userId
 * 4. Recharger le snapshot CRA
 * 5. Vérifier la postcondition : status === IDENTIFIED
 * 6. Libérer le verrou (succès ou erreur)
 * 
 * @module core/cra/cra-identity-claim-service
 */

'use strict';

const {
  IDENTITY_STATUS,
  buildIdentityClaim,
  resolveCurrentUserIdentity,
  isAssociationAlreadyApplied
} = require('./cra-identity-association');

// ============================================================================
// CONSTANTES - Codes d'erreur
// ============================================================================

const CLAIM_ERROR_CODES = {
  IDENTITY_CLAIM_PENDING: 'IDENTITY_CLAIM_PENDING',
  IDENTITY_CLAIM_CONFLICT: 'IDENTITY_CLAIM_CONFLICT',
  IDENTITY_CLAIM_WRITE_FAILED: 'IDENTITY_CLAIM_WRITE_FAILED',
  IDENTITY_CLAIM_RELOAD_FAILED: 'IDENTITY_CLAIM_RELOAD_FAILED',
  IDENTITY_CLAIM_POSTCONDITION_FAILED: 'IDENTITY_CLAIM_POSTCONDITION_FAILED',
  IDENTITY_CLAIM_INVALID_REQUEST: 'IDENTITY_CLAIM_INVALID_REQUEST',
  IDENTITY_CLAIM_ALREADY_ASSOCIATED: 'IDENTITY_CLAIM_ALREADY_ASSOCIATED'
};

// ============================================================================
// ÉTAT INTERNE - Verrouillage
// ============================================================================

let claimInProgress = false;
let pendingClaimData = null;

/**
 * Vérifie si une opération est en cours
 * @returns {boolean}
 */
function isClaimPending() {
  return claimInProgress;
}

/**
 * Pose le verrou d'opération
 * @param {Object} data - Données de l'opération
 * @returns {boolean} - true si verrou posé, false si déjà en cours
 */
function lockClaim(data) {
  if (claimInProgress) {
    return false;
  }
  claimInProgress = true;
  pendingClaimData = data;
  return true;
}

/**
 * Libère le verrou d'opération
 */
function unlockClaim() {
  claimInProgress = false;
  pendingClaimData = null;
}

// ============================================================================
// SERVICE D'ASSOCIATION
// ============================================================================

/**
 * Associe le compte Grist connecté à une ligne Team
 * 
 * @param {Object} params - Paramètres
 * @param {Object} params.grist - API Grist (docApi requis)
 * @param {number} params.teamMemberId - ID du membre Team à associer
 * @param {*} params.currentGristUserId - userId Grist actuel
 * @param {Array} params.team - Snapshot Team actuel (pour validation)
 * @param {Function} [params.reloadSnapshot] - Fonction de rechargement
 * @returns {Object} - Résultat de l'opération
 */
async function claimCurrentUserIdentity({
  grist,
  teamMemberId,
  currentGristUserId,
  team,
  reloadSnapshot
}) {
  const result = {
    success: false,
    code: null,
    reason: null,
    before: null,
    after: null,
    teamMemberId: null,
    gristUserId: null
  };
  
  // === 1. VÉRIFICATION PRÉALABLE ===
  
  // 1a. Vérifier qu'aucune opération n'est en cours
  if (claimInProgress) {
    result.code = CLAIM_ERROR_CODES.IDENTITY_CLAIM_PENDING;
    result.reason = 'Une opération d\'association est déjà en cours';
    return result;
  }
  
  // 1b. Vérifier si déjà associé (idempotence) - AVANT buildIdentityClaim
  // Car buildIdentityClaim échouerait avec TEAM_MEMBER_ALREADY_ASSOCIATED
  if (isAssociationAlreadyApplied({
    team,
    teamMemberId,
    currentGristUserId
  })) {
    result.success = true;
    result.code = 'ALREADY_APPLIED';
    result.reason = 'Association déjà appliquée';
    result.teamMemberId = teamMemberId;
    result.gristUserId = currentGristUserId;
    return result;
  }
  
  // 1c. Valider la demande avec le module pur
  const claimValidation = buildIdentityClaim({
    team,
    selectedTeamMemberId: teamMemberId,
    currentGristUserId
  });
  
  if (!claimValidation.allowed) {
    result.code = CLAIM_ERROR_CODES.IDENTITY_CLAIM_INVALID_REQUEST;
    result.reason = claimValidation.reason;
    result.validationCode = claimValidation.code;
    return result;
  }
  
  // === 2. POSER LE VERROU ===
  
  const lockAcquired = lockClaim({
    teamMemberId,
    currentGristUserId,
    timestamp: Date.now()
  });
  
  if (!lockAcquired) {
    result.code = CLAIM_ERROR_CODES.IDENTITY_CLAIM_PENDING;
    result.reason = 'Impossible d\'acquérir le verrou (opération concurrente)';
    return result;
  }
  
  // === 3. ÉCRITURE GRIST ===
  
  let phase = 'write';
  
  try {
    // Capturer l'état avant écriture
    const memberBefore = team.find(m => m.id === teamMemberId);
    result.before = memberBefore ? { ...memberBefore } : null;
    
    // Préparer l'action UpdateRecord
    const actions = [
      [
        'UpdateRecord',
        'Team',
        teamMemberId,
        {
          gristUserId: currentGristUserId
        }
      ]
    ];
    
    // Exécuter l'écriture
    if (!grist || !grist.docApi || typeof grist.docApi.applyUserActions !== 'function') {
      throw new Error('Grist API indisponible');
    }
    
    await grist.docApi.applyUserActions(actions);
    
    // === 4. RECHARGEMENT ===
    
    phase = 'reload';
    
    if (typeof reloadSnapshot === 'function') {
      try {
        await reloadSnapshot();
      } catch (reloadError) {
        // Rechargement échoué, mais l'écriture a réussi
        result.code = CLAIM_ERROR_CODES.IDENTITY_CLAIM_RELOAD_FAILED;
        result.reason = 'Écriture réussie mais rechargement échoué';
        result.reloadError = reloadError.message || String(reloadError);
        result.teamMemberId = teamMemberId;
        result.gristUserId = currentGristUserId;
        return result;
      }
    } else {
      // Pas de fonction de rechargement fournie
      console.warn('[CRA identity claim] reloadSnapshot non fourni, rechargement manuel requis');
    }
    
    // === 5. VÉRIFICATION POSTCONDITION ===
    
    phase = 'verify';
    
    // Recharger le snapshot Team pour vérification
    const teamAfterData = await grist.docApi.fetchTable('Team');
    const teamAfter = columnarToRows(teamAfterData);
    const memberAfter = teamAfter.find(m => m.id === teamMemberId);
    
    result.after = memberAfter ? { ...memberAfter } : null;
    
    // Vérifier que gristUserId a été correctement mis à jour
    const normalizedUserId = normalizeGristUserId(currentGristUserId);
    const actualGristUserId = normalizeGristUserId(memberAfter?.gristUserId);
    
    if (actualGristUserId !== normalizedUserId) {
      result.code = CLAIM_ERROR_CODES.IDENTITY_CLAIM_POSTCONDITION_FAILED;
      result.reason = `gristUserId incorrect après écriture : attendu ${normalizedUserId}, obtenu ${actualGristUserId}`;
      result.expectedUserId = normalizedUserId;
      result.actualUserId = actualGristUserId;
      result.teamMemberId = teamMemberId;
      result.gristUserId = currentGristUserId;
      return result;
    }
    
    // Vérifier que l'identité est maintenant résolue
    const identityResult = resolveCurrentUserIdentity({
      team: teamAfter,
      currentGristUserId
    });
    
    if (identityResult.status !== IDENTITY_STATUS.IDENTIFIED) {
      result.code = CLAIM_ERROR_CODES.IDENTITY_CLAIM_POSTCONDITION_FAILED;
      result.reason = `Identité non résolue après association : status = ${identityResult.status}`;
      result.identityStatus = identityResult.status;
      result.teamMemberId = teamMemberId;
      result.gristUserId = currentGristUserId;
      return result;
    }
    
    if (identityResult.currentUserMemberId !== teamMemberId) {
      result.code = CLAIM_ERROR_CODES.IDENTITY_CLAIM_POSTCONDITION_FAILED;
      result.reason = `currentUserMemberId incorrect : attendu ${teamMemberId}, obtenu ${identityResult.currentUserMemberId}`;
      result.expectedMemberId = teamMemberId;
      result.actualMemberId = identityResult.currentUserMemberId;
      return result;
    }
    
    // === 6. SUCCÈS ===
    
    result.success = true;
    result.code = 'OK';
    result.teamMemberId = teamMemberId;
    result.gristUserId = currentGristUserId;
    result.identityStatus = identityResult.status;
    result.candidateCount = identityResult.candidates?.length || 0;
    
    return result;
    
  } catch (error) {
    // Échec avec code d'erreur approprié selon la phase
    if (phase === 'write') {
      result.code = CLAIM_ERROR_CODES.IDENTITY_CLAIM_WRITE_FAILED;
      result.reason = 'Erreur lors de l\'écriture : ' + (error.message || String(error));
    } else if (phase === 'reload') {
      result.code = CLAIM_ERROR_CODES.IDENTITY_CLAIM_RELOAD_FAILED;
      result.reason = 'Erreur lors du rechargement : ' + (error.message || String(error));
    } else if (phase === 'verify') {
      result.code = CLAIM_ERROR_CODES.IDENTITY_CLAIM_POSTCONDITION_FAILED;
      result.reason = 'Erreur lors de la vérification : ' + (error.message || String(error));
    } else {
      result.code = CLAIM_ERROR_CODES.IDENTITY_CLAIM_WRITE_FAILED;
      result.reason = error.message || String(error);
    }
    
    result.error = error;
    result.teamMemberId = teamMemberId;
    result.gristUserId = currentGristUserId;
    
    return result;
  } finally {
    // Libérer le verrou dans tous les cas
    unlockClaim();
  }
}

/**
 * Annule une opération en cours (pour débogage/urgence)
 * @returns {boolean} - true si une opération a été annulée
 */
function cancelPendingClaim() {
  if (claimInProgress) {
    unlockClaim();
    return true;
  }
  return false;
}

/**
 * Retourne l'état du service
 * @returns {Object} - État du service
 */
function getServiceState() {
  return {
    claimInProgress,
    pendingClaimData: pendingClaimData ? { ...pendingClaimData } : null
  };
}

/**
 * Réinitialise le service (pour tests)
 */
function resetService() {
  unlockClaim();
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Normalise un Grist userId (copie locale pour indépendance)
 */
function normalizeGristUserId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (value === 0 || value === '0') {
    return null;
  }
  const numeric = Number(value);
  return (Number.isInteger(numeric) && numeric > 0) ? numeric : null;
}

/**
 * Convertit un tableau colonnaire Grist en tableau d'objets
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

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

module.exports = {
  // Fonction principale
  claimCurrentUserIdentity,
  
  // Gestion du verrou
  isClaimPending,
  lockClaim,
  unlockClaim,
  cancelPendingClaim,
  
  // État et réinitialisation
  getServiceState,
  resetService,
  
  // Codes d'erreur
  CLAIM_ERROR_CODES
};
