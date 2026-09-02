/* ============================================================================
 * gantt-date-change-transaction.js — Écriture compensable des dates du Gantt
 * ============================================================================ */
(function(root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GanttDateChangeTransaction = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function planningFailed(planningResult) {
    if (!planningResult) return false;
    if (planningResult.success === false) return true;
    if (Array.isArray(planningResult.blockedMemberIds) && planningResult.blockedMemberIds.length) return true;
    if (Array.isArray(planningResult.failedMemberIds) && planningResult.failedMemberIds.length) return true;
    return Boolean(planningResult.summary && Number(planningResult.summary.failed) > 0);
  }

  function syncFailed(result) {
    return !result || result.ok === false || planningFailed(result.planningResult);
  }

  function describeFailure(target, result, error) {
    var label = target && target.label ? target.label : ('Tâche ' + (target && target.id));
    if (error) return label + ' : ' + (error.message || String(error));
    if (result && result.message) return label + ' : ' + result.message;
    if (result && result.planningResult && result.planningResult.code) {
      return label + ' : ' + result.planningResult.code;
    }
    return label + ' : échec de synchronisation';
  }

  async function run(options) {
    options = options || {};
    if (typeof options.applyActions !== 'function') throw new Error('applyActions requis');
    if (!Array.isArray(options.forwardActions) || !options.forwardActions.length) {
      throw new Error('forwardActions requis');
    }

    var targets = Array.isArray(options.targets) ? options.targets : [];
    var result = {
      ok: false,
      forwardCommitted: false,
      syncResults: [],
      planningResults: [],
      errors: [],
      rollbackAttempted: false,
      datesRestored: false,
      planningRestored: false,
      rollbackErrors: []
    };

    await options.applyActions(options.forwardActions);
    result.forwardCommitted = true;

    if (targets.length && typeof options.syncTaskDates !== 'function') {
      result.errors.push('Service de synchronisation indisponible');
    }

    var attemptedTargets = [];
    if (!result.errors.length) {
      for (var index = 0; index < targets.length; index++) {
        var target = targets[index];
        attemptedTargets.push(target);
        try {
          var syncResult = await options.syncTaskDates(target.id, target.nextStart, target.nextEnd);
          result.syncResults.push(syncResult);
          if (syncResult && syncResult.planningResult) {
            result.planningResults.push(syncResult.planningResult);
          }
          if (syncFailed(syncResult)) {
            result.errors.push(describeFailure(target, syncResult));
            break;
          }
        } catch (error) {
          result.errors.push(describeFailure(target, null, error));
          break;
        }
      }
    }

    if (!result.errors.length) {
      result.ok = true;
      return result;
    }

    result.rollbackAttempted = true;
    try {
      await options.applyActions(options.rollbackActions || []);
      result.datesRestored = true;
    } catch (rollbackError) {
      result.rollbackErrors.push('Dates : ' + (rollbackError.message || String(rollbackError)));
      return result;
    }

    if (!attemptedTargets.length || typeof options.syncTaskDates !== 'function') {
      result.planningRestored = attemptedTargets.length === 0;
      return result;
    }

    result.planningRestored = true;
    for (var rollbackIndex = 0; rollbackIndex < attemptedTargets.length; rollbackIndex++) {
      var rollbackTarget = attemptedTargets[rollbackIndex];
      try {
        var rollbackSync = await options.syncTaskDates(
          rollbackTarget.id,
          rollbackTarget.previousStart,
          rollbackTarget.previousEnd
        );
        if (syncFailed(rollbackSync)) {
          result.planningRestored = false;
          result.rollbackErrors.push(describeFailure(rollbackTarget, rollbackSync));
        }
      } catch (rollbackSyncError) {
        result.planningRestored = false;
        result.rollbackErrors.push(describeFailure(rollbackTarget, null, rollbackSyncError));
      }
    }
    return result;
  }

  return {
    run: run,
    planningFailed: planningFailed,
    syncFailed: syncFailed
  };
});
