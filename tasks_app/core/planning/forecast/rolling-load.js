/**
 * Rolling Load Forecast
 *
 * Calcule une demande glissante non plafonnée depuis TaskAssignments.
 * Aucune écriture Grist : le résultat est un index virtuel destiné au Plan.
 */

'use strict';

var RollingTimePeriods = typeof TaskFlowTimePeriods !== 'undefined'
  ? TaskFlowTimePeriods
  : require('../../time/time-periods');

var TaskFlowRollingLoad = (function () {
  var DAY_MS = 24 * 60 * 60 * 1000;

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function dateToIso(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    var date = value instanceof Date
      ? new Date(value.getTime())
      : new Date(typeof value === 'number' ? value * 1000 : value);
    if (isNaN(date.getTime())) return null;
    return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
  }

  function isoToDate(value) {
    var iso = dateToIso(value);
    if (!iso) return null;
    var date = new Date(iso + 'T00:00:00Z');
    return isNaN(date.getTime()) ? null : date;
  }

  function addIsoDays(iso, count) {
    var date = isoToDate(iso);
    if (!date) return null;
    date.setUTCDate(date.getUTCDate() + count);
    return dateToIso(date);
  }

  function isWeekday(iso) {
    var date = isoToDate(iso);
    if (!date) return false;
    var day = date.getUTCDay();
    return day >= 1 && day <= 5;
  }

  function isoWeekKey(iso) {
    var date = isoToDate(iso);
    if (!date) return null;
    var target = new Date(date.getTime());
    var day = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - day);
    var yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    var week = Math.ceil((((target - yearStart) / DAY_MS) + 1) / 7);
    return target.getUTCFullYear() + '-W' + pad2(week);
  }

  function periodKey(iso, granularity) {
    return RollingTimePeriods.key(isoToDate(iso), granularity);
  }

  function finiteNonNegative(value) {
    var number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function pairKey(taskId, memberId) {
    return String(taskId) + '|' + String(memberId);
  }

  function buildEntryIndexes(entries, assignments) {
    var byAssignment = new Map();
    var legacyByPair = new Map();
    var activePairCounts = new Map();

    for (var i = 0; i < assignments.length; i++) {
      var assignment = assignments[i];
      if (assignment.actif === false) continue;
      var key = pairKey(assignment.tache, assignment.membre);
      activePairCounts.set(key, (activePairCounts.get(key) || 0) + 1);
    }

    for (var j = 0; j < entries.length; j++) {
      var entry = entries[j];
      if (entry.assignmentId != null && Number(entry.assignmentId) > 0) {
        var assignmentId = Number(entry.assignmentId);
        if (!byAssignment.has(assignmentId)) byAssignment.set(assignmentId, []);
        byAssignment.get(assignmentId).push(entry);
      } else if (entry.taskId != null && entry.memberId != null) {
        var legacyKey = pairKey(entry.taskId, entry.memberId);
        if (!legacyByPair.has(legacyKey)) legacyByPair.set(legacyKey, []);
        legacyByPair.get(legacyKey).push(entry);
      }
    }

    return {
      forAssignment: function (assignment) {
        var exact = byAssignment.get(Number(assignment.id)) || [];
        var key = pairKey(assignment.tache, assignment.membre);
        if ((activePairCounts.get(key) || 0) !== 1) return exact;
        return exact.concat(legacyByPair.get(key) || []);
      }
    };
  }

  function buildRollingLoadIndex(input) {
    input = input || {};
    var assignments = (input.assignments || []).filter(function (assignment) {
      return assignment && assignment.actif !== false;
    });
    var entries = input.timeEntries || [];
    var capacities = input.dailyCapacities || [];
    var team = input.team || [];
    var tasks = input.tasks || [];
    var periods = input.periods || {};
    var granularity = RollingTimePeriods.normalizeGranularity(periods.granularity);
    var visiblePeriods = new Set(periods.keys || []);
    var today = dateToIso(input.today || new Date());

    var taskById = new Map(tasks.map(function (task) { return [Number(task.id), task]; }));
    var memberById = new Map(team.map(function (member) { return [Number(member.id), member]; }));
    var capacityByMemberDate = new Map();
    var entriesIndex = buildEntryIndexes(entries, assignments);

    capacities.forEach(function (capacity) {
      var date = dateToIso(capacity.date);
      if (!date || capacity.membre == null) return;
      var value = finiteNonNegative(capacity.capaciteDisponible);
      if (value == null) value = 0;
      capacityByMemberDate.set(String(Number(capacity.membre)) + '|' + date, value);
    });

    var contributions = [];
    var assignmentSummaries = {};
    var diagnostics = [];

    assignments.forEach(function (assignment) {
      var assignmentId = Number(assignment.id);
      var taskId = Number(assignment.tache);
      var memberId = Number(assignment.membre);
      var task = taskById.get(taskId) || {};
      var member = memberById.get(memberId) || {};
      var allocatedHours = finiteNonNegative(assignment.heuresAllouees);
      if (allocatedHours == null || allocatedHours <= 0 || !memberId || !taskId) return;

      var actualHours = 0;
      entriesIndex.forAssignment(assignment).forEach(function (entry) {
        var actual = finiteNonNegative(entry.actualHours);
        if (actual != null) actualHours += actual;
      });

      var remainingHours = Math.max(allocatedHours - actualHours, 0);
      var overconsumedHours = Math.max(actualHours - allocatedHours, 0);
      var start = dateToIso(assignment.dateDebut) || dateToIso(task.dateDebut);
      var end = dateToIso(assignment.dateFin) || dateToIso(task.dateEcheance);
      var effectiveStart = start && today && start > today ? start : today;
      var summary = {
        assignmentId: assignmentId,
        taskId: taskId,
        memberId: memberId,
        mode: assignment.modeRepartition || 'uniforme',
        allocatedHours: allocatedHours,
        actualHours: actualHours,
        remainingHours: remainingHours,
        overconsumedHours: overconsumedHours,
        startDate: start,
        endDate: end,
        effectiveStartDate: effectiveStart,
        overdue: Boolean(end && today && end < today),
        totalFutureCapacityHours: 0
      };
      assignmentSummaries[assignmentId] = summary;

      if (overconsumedHours > 0) {
        diagnostics.push({
          code: 'OVERCONSUMED_ASSIGNMENT',
          assignmentId: assignmentId,
          hours: overconsumedHours
        });
      }
      if (remainingHours <= 0) return;
      if (!effectiveStart || !end) {
        diagnostics.push({ code: 'MISSING_ASSIGNMENT_DATES', assignmentId: assignmentId });
        return;
      }

      if (end < effectiveStart) {
        var overduePeriod = periodKey(today, granularity);
        summary.overdue = true;
        diagnostics.push({ code: 'OVERDUE_REMAINING_LOAD', assignmentId: assignmentId, hours: remainingHours });
        if (visiblePeriods.has(overduePeriod)) {
          contributions.push({
            assignmentId: assignmentId,
            taskId: taskId,
            memberId: memberId,
            periodKey: overduePeriod,
            hours: remainingHours,
            capacityHours: 0,
            loadRatio: null,
            mode: summary.mode,
            overdue: true
          });
        }
        return;
      }

      var nominalDailyCapacity = (finiteNonNegative(member.capaciteHebdo) || 35) / 5;
      var capacityByPeriod = new Map();
      var totalFutureCapacity = 0;
      for (var date = effectiveStart; date <= end; date = addIsoDays(date, 1)) {
        if (!isWeekday(date)) continue;
        var capacityKey = String(memberId) + '|' + date;
        var dailyCapacity = capacityByMemberDate.has(capacityKey)
          ? capacityByMemberDate.get(capacityKey)
          : nominalDailyCapacity;
        if (!(dailyCapacity > 0)) continue;
        var key = periodKey(date, granularity);
        capacityByPeriod.set(key, (capacityByPeriod.get(key) || 0) + dailyCapacity);
        totalFutureCapacity += dailyCapacity;
      }
      summary.totalFutureCapacityHours = totalFutureCapacity;

      if (!(totalFutureCapacity > 0)) {
        var fallbackPeriod = periodKey(effectiveStart, granularity);
        diagnostics.push({ code: 'NO_FUTURE_CAPACITY', assignmentId: assignmentId, hours: remainingHours });
        if (visiblePeriods.has(fallbackPeriod)) {
          contributions.push({
            assignmentId: assignmentId,
            taskId: taskId,
            memberId: memberId,
            periodKey: fallbackPeriod,
            hours: remainingHours,
            capacityHours: 0,
            loadRatio: null,
            mode: summary.mode,
            overdue: false
          });
        }
        return;
      }

      capacityByPeriod.forEach(function (periodCapacity, key) {
        if (!visiblePeriods.has(key)) return;
        var hours = remainingHours * periodCapacity / totalFutureCapacity;
        contributions.push({
          assignmentId: assignmentId,
          taskId: taskId,
          memberId: memberId,
          periodKey: key,
          hours: hours,
          capacityHours: periodCapacity,
          loadRatio: periodCapacity > 0 ? hours / periodCapacity : null,
          mode: summary.mode,
          overdue: false
        });
      });
    });

    return {
      today: today,
      granularity: granularity,
      contributions: contributions,
      assignments: assignmentSummaries,
      diagnostics: diagnostics
    };
  }

  return {
    buildRollingLoadIndex: buildRollingLoadIndex,
    dateToIso: dateToIso,
    periodKey: periodKey,
    isWeekday: isWeekday
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TaskFlowRollingLoad;
}
if (typeof globalThis !== 'undefined') {
  globalThis.TaskFlowRollingLoad = TaskFlowRollingLoad;
}
