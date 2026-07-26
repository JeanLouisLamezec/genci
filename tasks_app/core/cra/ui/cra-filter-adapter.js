/**
 * CRA Filter Adapter - Module d'intégration des filtres pour le CRA
 * 
 * Ce module gère :
 * - La normalisation canonique des filtres
 * - La signature stable pour déduplication
 * - L'application centralisée de l'état des filtres
 * - La diffusion Grist dédupliquée
 * - Le filtrage des tâches (project, programme, task)
 * 
 * Contrat :
 * - FilterManager normalise en chaînes
 * - CRA utilise une signature canonique triée
 * - Changement local → un seul setOptions maximum
 * - Filtre externe → aucun broadcast
 */

(function(global) {
  'use strict';

  // Mode debug via query param (uniquement dans le navigateur)
  var CRA_FILTER_DEBUG = false;
  try {
    CRA_FILTER_DEBUG = typeof global.location !== 'undefined' &&
      new global.URLSearchParams(global.location.search).get('debugFilters') === '1';
  } catch (e) {
    // Ignorer en environnement Node.js
  }

  /**
   * Log de diagnostic (seulement si ?debugFilters=1)
   */
  function filterDebug(label, details) {
    if (!CRA_FILTER_DEBUG) {
      return;
    }
    console.info('[CRA filters] ' + label, details || '');
  }

  /**
   * Normalise les filtres pour le CRA
   * - Toujours 5 clés
   * - Toujours des tableaux de chaînes
   * - Triés pour signature stable
   * - Immutabilité
   */
  function normalizeCraFilters(input) {
    var source = input && typeof input === 'object' ? input : {};

    var normalizeList = function(value) {
      if (!Array.isArray(value)) {
        return [];
      }

      var seen = new Set();
      var result = [];

      for (var i = 0; i < value.length; i++) {
        var item = value[i];
        if (item === null || item === undefined || item === '') {
          continue;
        }
        var str = String(item);
        if (!seen.has(str)) {
          seen.add(str);
          result.push(str);
        }
      }

      result.sort();
      return result;
    };

    return {
      assignee: normalizeList(source.assignee),
      team: normalizeList(source.team),
      project: normalizeList(source.project),
      programme: normalizeList(source.programme),
      task: normalizeList(source.task)
    };
  }

  /**
   * Crée une signature canonique pour comparaison
   */
  function craFilterSignature(filters) {
    return JSON.stringify(normalizeCraFilters(filters));
  }

  /**
   * Compare deux états de filtres
   */
  function sameCraFilters(a, b) {
    return craFilterSignature(a) === craFilterSignature(b);
  }

  /**
   * Filtre les tâches du CRA selon project, programme, task
   * N'applique PAS assignee/team (déjà gérés au niveau des personnes)
   */
  function filterCraTasks(tasks, filters, projects) {
    var normalized = normalizeCraFilters(filters);
    
    var projectById = new Map();
    (projects || []).forEach(function(project) {
      projectById.set(String(project.id), project);
    });

    return (tasks || []).filter(function(task) {
      var taskId = String(task.id);
      var projectId = task.projet == null ? null : String(task.projet);

      if (normalized.task.length > 0 &&
          !normalized.task.includes(taskId)) {
        return false;
      }

      if (normalized.project.length > 0 &&
          !normalized.project.includes(projectId)) {
        return false;
      }

      if (normalized.programme.length > 0) {
        var project = projectById.get(projectId);
        if (!project) {
          return false;
        }

        var programmeId = project.programme != null
          ? project.programme
          : project.portefeuille;

        if (programmeId == null ||
            !normalized.programme.includes(String(programmeId))) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Diffuse les filtres vers Grist avec déduplication
   */
  async function broadcastCraFilters(filters, gristApi, instanceSync) {
    var normalized = normalizeCraFilters(filters);
    var signature = craFilterSignature(normalized);

    if (signature === instanceSync.lastBroadcastSignature) {
      filterDebug('broadcast.skipped', {
        reason: 'UNCHANGED',
        signature: signature
      });
      return {
        skipped: true,
        reason: 'UNCHANGED'
      };
    }

    instanceSync.lastBroadcastSignature = signature;

    try {
      var promise = gristApi.setOptions({
        filters: normalized
      });

      instanceSync.broadcastInFlight = promise;

      await promise;

      filterDebug('broadcast.sent', {
        signature: signature,
        filters: normalized
      });

      return {
        skipped: false,
        signature: signature
      };
    } catch (error) {
      instanceSync.lastBroadcastSignature = null;

      console.error(
        '[CRA filters] Échec setOptions',
        error
      );

      filterDebug('broadcast.error', {
        error: error,
        signature: signature
      });

      return {
        skipped: false,
        error: error
      };
    } finally {
      instanceSync.broadcastInFlight = null;
    }
  }

  // Variable globale supprimée - chaque instance a son propre état

  /**
   * Crée un objet de synchronisation complet
   */
  function createCraFilterSynchronizer(S, gristApi, options) {
    var opts = options || {};
    var onStateApplied = typeof opts.onStateApplied === 'function'
      ? opts.onStateApplied
      : function() {};

    // État propre à chaque instance (pas de variable globale)
    var instanceSync = {
      lastBroadcastSignature: null,
      lastExternalSignature: null,
      broadcastInFlight: null
    };

    /**
     * Applique un état de filtre centralisé
     */
    function applyCraFilterState(filters, metadata) {
      var normalized = normalizeCraFilters(filters);

      S.filters = normalized;

      var peopleResult = global.CraPersonFilter.applyPersonFilters({
        team: S.team,
        filters: normalized,
        currentPersonId: S.selectedPersonId,
        previousVisibleIds: S.visiblePersonIds,
        currentUserMemberId: S.currentUserMemberId
      });

      S.visiblePersonIds = peopleResult.visiblePersonIds;
      S.selectedPersonId = peopleResult.selectedPersonId;
      S.isEmptyDueToFilter = peopleResult.isEmptyDueToFilter;

      if (S.selectedPersonId != null) {
        S.me = S.selectedPersonId;

        var selected = S.team.find(function(member) {
          return member.id === S.selectedPersonId;
        });

        S.meName = selected ? selected.nom : S.currentUserMemberName;
      }

      filterDebug('applyCraFilterState', {
        origin: metadata ? metadata.origin : 'unknown',
        filters: normalized,
        visiblePersonIds: S.visiblePersonIds,
        selectedPersonId: S.selectedPersonId
      });

      // Déclencher le rendu après application de l'état
      onStateApplied({
        filters: normalized,
        origin: metadata ? metadata.origin : 'unknown',
        visiblePersonIds: S.visiblePersonIds,
        selectedPersonId: S.selectedPersonId
      });
    }

    /**
     * Applique les options externes (grist.onOptions)
     */
    function applyExternalOptions(options) {
      if (!options ||
          !Object.prototype.hasOwnProperty.call(options, 'filters')) {
        return;
      }

      var normalized = normalizeCraFilters(options.filters);
      var signature = craFilterSignature(normalized);

      var manager = S.filterManager;
      var current = normalizeCraFilters(manager.getState());

      if (sameCraFilters(current, normalized)) {
        filterDebug('external.skipped', {
          reason: 'UNCHANGED',
          signature: signature
        });
        instanceSync.lastExternalSignature = signature;
        return;
      }

      filterDebug('external.received', {
        signature: signature,
        filters: normalized
      });

      instanceSync.lastExternalSignature = signature;

      if (typeof manager.applyExternalFilters === 'function') {
        manager.applyExternalFilters(normalized);
        return;
      }

      if (typeof manager.setState === 'function') {
        manager.setState(normalized, {
          origin: 'external',
          broadcast: false,
          notify: true
        });
        return;
      }

      throw new Error(
        'FilterManager ne permet pas l\'application externe des filtres'
      );
    }

    return {
      applyCraFilterState: applyCraFilterState,
      applyExternalOptions: applyExternalOptions,
      broadcastCraFilters: function(filters) {
        return broadcastCraFilters(filters, gristApi, instanceSync);
      },
      normalizeCraFilters: normalizeCraFilters,
      craFilterSignature: craFilterSignature,
      sameCraFilters: sameCraFilters,
      filterCraTasks: filterCraTasks
    };
  }

  // Export pour navigateur
  var CraFilterAdapter = {
    normalizeCraFilters: normalizeCraFilters,
    craFilterSignature: craFilterSignature,
    sameCraFilters: sameCraFilters,
    filterCraTasks: filterCraTasks,
    broadcastCraFilters: broadcastCraFilters,
    createCraFilterSynchronizer: createCraFilterSynchronizer,
    CRA_FILTER_DEBUG: CRA_FILTER_DEBUG,
    filterDebug: filterDebug
  };

  if (typeof global !== 'undefined') {
    global.CraFilterAdapter = CraFilterAdapter;
  }

  // Export pour Node.js (tests)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CraFilterAdapter;
  }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : {}));
