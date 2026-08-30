/**
 * CRA Manager Workspace - État de l'espace manager "À valider"
 * 
 * Ce module calcule la visibilité et l'état de l'onglet "À valider"
 * en fonction :
 * - des subordonnés directs dans Team
 * - des feuilles accessibles via responsableValidation
 * 
 * PURTÉ : Aucune dépendance à Grist, au DOM, ou aux effets de bord.
 * 
 * @module core/cra/cra-manager-workspace
 */

'use strict';

// ============================================================================
// CONSTANTES
// ============================================================================

const ACCESSIBLE_MANAGER_STATUSES = [
  'soumis',
  'submitted',
  'valide',
  'validated',
  'correction_manager'
];

const PENDING_STATUSES = ['soumis', 'submitted'];

// ============================================================================
// HELPERS DE NORMALISATION
// ============================================================================

/**
 * Normalise un ID pour comparaison
 * @param {*} value - ID à normaliser
 * @returns {number|null} - ID normalisé ou null
 */
function normalizeId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

/**
 * Normalise un statut de feuille
 * @param {string} status - Statut brut
 * @returns {string} - Statut normalisé
 */
function normalizeStatus(status) {
  return String(status || '').toLowerCase();
}

// ============================================================================
// FONCTION PRINCIPALE
// ============================================================================

/**
 * Résout l'état de l'espace manager
 * 
 * @param {Object} options - Options
 * @param {Array} options.team - Liste des membres Team
 * @param {Array} options.sheets - Liste des feuilles Feuilles
 * @param {number} options.currentUserMemberId - ID de l'utilisateur connecté
 * @param {boolean} options.isAdmin - Passe-droit fonctionnel complet
 * @returns {Object} - État de l'espace manager
 */
function resolveManagerWorkspaceState({ team, sheets, currentUserMemberId, isAdmin = false }) {
  const result = {
    isIdentified: false,
    managesSomeone: false,
    directReportIds: [],
    directReportCount: 0,
    hasAccessibleSheets: false,
    accessibleSheets: [],
    pendingSheets: [],
    pendingCount: 0,
    validatedCount: 0,
    correctionCount: 0,
    shouldShowManagerTab: false
  };
  
  // 1. Vérifier que l'utilisateur est identifié
  const managerId = normalizeId(currentUserMemberId);
  if (!managerId) {
    return result;
  }
  
  result.isIdentified = true;
  
  // 2. Calculer les subordonnés directs
  const directReports = team.filter(member => {
    // L'administrateur fonctionnel doit pouvoir régulariser l'historique de
    // toute personne, y compris un membre désormais inactif.
    if (isAdmin) return normalizeId(member.id) !== managerId;

    // Membre doit être actif
    if (member.actif === false) {
      return false;
    }

    // Responsable direct doit correspondre
    const memberRespId = normalizeId(member.responsable);
    return memberRespId === managerId;
  });
  
  result.directReportIds = directReports.map(m => normalizeId(m.id));
  result.directReportCount = directReports.length;
  result.managesSomeone = directReports.length > 0;
  
  // 3. Calculer les feuilles accessibles via responsableValidation
  const accessibleSheets = sheets.filter(sheet => {
    const sheetRespId = normalizeId(sheet.responsableValidation);
    if (!isAdmin && sheetRespId !== managerId) {
      return false;
    }
    
    const status = normalizeStatus(sheet.statut);
    return ACCESSIBLE_MANAGER_STATUSES.includes(status);
  });
  
  result.accessibleSheets = accessibleSheets;
  result.hasAccessibleSheets = accessibleSheets.length > 0;
  
  // 4. Compter par statut
  result.pendingSheets = accessibleSheets.filter(sheet => {
    const status = normalizeStatus(sheet.statut);
    return PENDING_STATUSES.includes(status);
  });
  
  result.pendingCount = result.pendingSheets.length;
  result.validatedCount = accessibleSheets.filter(sheet => {
    const status = normalizeStatus(sheet.statut);
    return status === 'valide' || status === 'validated';
  }).length;
  
  result.correctionCount = accessibleSheets.filter(sheet => {
    const status = normalizeStatus(sheet.statut);
    return status === 'correction_manager';
  }).length;
  
  // 5. Visibilité finale
  // Afficher si : manager de quelqu'un OU a des feuilles accessibles
  result.shouldShowManagerTab = isAdmin || result.managesSomeone || result.hasAccessibleSheets;
  result.isAdmin = isAdmin;
  
  return result;
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

module.exports = {
  resolveManagerWorkspaceState,
  normalizeId,
  normalizeStatus,
  ACCESSIBLE_MANAGER_STATUSES,
  PENDING_STATUSES
};
