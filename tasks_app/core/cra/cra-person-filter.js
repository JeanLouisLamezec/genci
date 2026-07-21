/**
 * CRA Person Filter - Module de filtrage des personnes pour le CRA
 * 
 * Ce module gère le calcul des personnes visibles en fonction des filtres
 * assignee et team, avec une gestion correcte des types (IDs en chaînes).
 * 
 * Contrat de type :
 * - FilterManager produit des IDs en chaînes : ['1', '2']
 * - Les comparaisons doivent se faire via String(...)
 * - Les résultats retournent les IDs dans leur type d'origine (nombres)
 */

/**
 * Vérifie si des filtres de personne ou d'équipe sont actifs
 * @param {Object} filters - Filtres du FilterManager
 * @returns {boolean} true si au moins un filtre assignee ou team est actif
 */
function hasActivePersonFilter(filters) {
  return Boolean(
    (filters && filters.assignee && filters.assignee.length) ||
    (filters && filters.team && filters.team.length)
  );
}

/**
 * Calcule les IDs des personnes visibles selon les filtres
 * 
 * Règles :
 * - Filtres assignee : OR entre les valeurs (personne 1 OU 2)
 * - Filtres team : OR entre les valeurs (équipe 10 OU 20)
 * - Combinaison assignee + team : AND (personne 1 ET équipe 10)
 * - Comparaison des IDs via String() pour compatibilité avec FilterManager
 * 
 * @param {Array} team - Membres de l'équipe : [{ id: number, nom: string, entite: number|null }]
 * @param {Object} filters - Filtres du FilterManager : { assignee: string[], team: string[] }
 * @returns {number[]} IDs des personnes visibles (type d'origine : nombres)
 */
function computeVisiblePersonIds(team, filters) {
  const members = Array.isArray(team) ? team : [];
  
  const assigneeFilters = Array.isArray(filters && filters.assignee)
    ? filters.assignee.map(String)
    : [];
  
  const teamFilters = Array.isArray(filters && filters.team)
    ? filters.team.map(String)
    : [];
  
  return members
    .filter(member => {
      const memberId = String(member.id);
      const entityId = member.entite == null ? null : String(member.entite);
      
      if (assigneeFilters.length > 0 && !assigneeFilters.includes(memberId)) {
        return false;
      }
      
      if (teamFilters.length > 0 && !teamFilters.includes(entityId)) {
        return false;
      }
      
      return true;
    })
    .map(member => member.id);
}

/**
 * Résout la personne par défaut lorsqu'aucun filtre n'est actif
 * 
 * Ordre de priorité :
 * 1. Utilisateur Grist connecté (s'il est dans l'équipe)
 * 2. Personne déjà sélectionnée (si encore valide)
 * 3. Première personne disponible
 * 4. Aucune personne si Team est vide
 * 
 * @param {Array} team - Membres de l'équipe
 * @param {number|null} currentPersonId - ID de la personne actuellement sélectionnée
 * @param {Array} previousVisibleIds - IDs précédemment visibles
 * @param {number|null} currentUserMemberId - ID de l'utilisateur Grist connecté
 * @returns {number[]} IDs des personnes à afficher par défaut
 */
function resolveDefaultPersonIds(team, currentPersonId, previousVisibleIds, currentUserMemberId) {
  const memberIds = new Set((team || []).map(member => member.id));
  
  if (currentUserMemberId != null && memberIds.has(currentUserMemberId)) {
    return [currentUserMemberId];
  }
  
  if (currentPersonId != null && memberIds.has(currentPersonId)) {
    return [currentPersonId];
  }
  
  const previous = (previousVisibleIds || []).find(id => memberIds.has(id));
  if (previous != null) {
    return [previous];
  }
  
  return team && team.length ? [team[0].id] : [];
}

/**
 * Applique les filtres et calcule les personnes visibles
 * 
 * @param {Object} params
 * @param {Array} params.team - Membres de l'équipe
 * @param {Object} params.filters - Filtres du FilterManager
 * @param {number|null} params.currentPersonId - ID de la personne actuellement sélectionnée
 * @param {Array} params.previousVisibleIds - IDs précédemment visibles
 * @param {number|null} params.currentUserMemberId - ID de l'utilisateur Grist connecté
 * @returns {Object} {
 *   visiblePersonIds: number[],
 *   selectedPersonId: number|null,
 *   isEmptyDueToFilter: boolean
 * }
 */
function applyPersonFilters({
  team,
  filters,
  currentPersonId,
  previousVisibleIds,
  currentUserMemberId
}) {
  const hasFilter = hasActivePersonFilter(filters);
  const visiblePersonIds = computeVisiblePersonIds(team, filters);
  
  let selectedPersonId = null;
  let isEmptyDueToFilter = false;
  
  if (visiblePersonIds.length === 0) {
    if (hasFilter) {
      isEmptyDueToFilter = true;
      selectedPersonId = null;
    } else {
      const defaultIds = resolveDefaultPersonIds(
        team,
        currentPersonId,
        previousVisibleIds,
        currentUserMemberId
      );
      visiblePersonIds.push(...defaultIds);
      selectedPersonId = defaultIds[0] || null;
    }
  } else {
    if (visiblePersonIds.length === 1) {
      selectedPersonId = visiblePersonIds[0];
    } else if (currentPersonId != null && visiblePersonIds.includes(currentPersonId)) {
      selectedPersonId = currentPersonId;
    } else {
      selectedPersonId = visiblePersonIds[0];
    }
  }
  
  return {
    visiblePersonIds,
    selectedPersonId,
    isEmptyDueToFilter
  };
}

// Export pour Node.js (tests) et navigateur
const CraPersonFilter = {
  hasActivePersonFilter,
  computeVisiblePersonIds,
  resolveDefaultPersonIds,
  applyPersonFilters
};

if (typeof globalThis !== 'undefined') {
  globalThis.CraPersonFilter = CraPersonFilter;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CraPersonFilter;
}
