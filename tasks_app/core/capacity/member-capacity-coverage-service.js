/**
 * Member Capacity Coverage Service
 *
 * Materializes only the working days needed by an assignment or a CRA week.
 * It uses MemberCapacityCoverage as a compact index and deliberately never
 * reads MemberDailyCapacities to determine whether a range is already ready.
 */

'use strict';

const { getDocApi, columnarToRows } = require('../grist/grist-api-helper.js');
const {
  parseDateUTC,
  formatDateUTC,
  addDaysUTC,
  isWeekdayIso
} = require('../planning/planning-engine.js');
const { normalizeCivilDate } = require('./daily-unavailability-normalizer.js');

function unwrapRef(value) {
  if (Array.isArray(value) && value.length >= 2) return unwrapRef(value[1]);
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function toUnixSeconds(isoDate) {
  return Math.floor(new Date(isoDate + 'T00:00:00Z').getTime() / 1000);
}

function touchesOrOverlaps(left, right) {
  const dayAfterLeft = formatDateUTC(addDaysUTC(parseDateUTC(left.end), 1));
  return right.start <= dayAfterLeft;
}

function mergeCoverageIntervals(intervals) {
  const sorted = (intervals || []).map(function(interval) {
    return { start: interval.start, end: interval.end };
  }).sort(function(left, right) {
    return left.start.localeCompare(right.start) || left.end.localeCompare(right.end);
  });
  const merged = [];

  sorted.forEach(function(interval) {
    const previous = merged[merged.length - 1];
    if (!previous || !touchesOrOverlaps(previous, interval)) {
      merged.push(interval);
      return;
    }
    if (interval.end > previous.end) previous.end = interval.end;
  });

  return merged;
}

function findMissingCoverageIntervals(coveredIntervals, requestedInterval) {
  const missing = [];
  let cursor = requestedInterval.start;

  (coveredIntervals || []).forEach(function(interval) {
    if (interval.end < cursor || interval.start > requestedInterval.end) return;
    if (interval.start > cursor) {
      const beforeCovered = formatDateUTC(addDaysUTC(parseDateUTC(interval.start), -1));
      missing.push({ start: cursor, end: beforeCovered < requestedInterval.end ? beforeCovered : requestedInterval.end });
    }
    const afterCovered = formatDateUTC(addDaysUTC(parseDateUTC(interval.end), 1));
    if (afterCovered > cursor) cursor = afterCovered;
  });

  if (cursor <= requestedInterval.end) missing.push({ start: cursor, end: requestedInterval.end });
  return missing.filter(function(interval) { return interval.start <= interval.end; });
}

function intersects(interval, target) {
  return interval.start <= target.end && interval.end >= target.start;
}

function buildWorkingDayRecords(memberId, intervals) {
  const records = [];
  (intervals || []).forEach(function(interval) {
    let current = parseDateUTC(interval.start);
    const end = parseDateUTC(interval.end);
    while (current && end && current <= end) {
      const date = formatDateUTC(current);
      if (isWeekdayIso(date)) records.push({ membre: memberId, date: toUnixSeconds(date) });
      current = addDaysUTC(current, 1);
    }
  });
  return records;
}

function planMemberCapacityCoverage(coverageRows, memberId, startDate, endDate, options = {}) {
  const member = unwrapRef(memberId);
  const start = normalizeCivilDate(startDate);
  const end = normalizeCivilDate(endDate);
  const nowUnixSeconds = Number.isFinite(Number(options.nowUnixSeconds))
    ? Number(options.nowUnixSeconds)
    : Math.floor(Date.now() / 1000);

  if (!member || !start || !end || start > end) {
    return {
      success: false,
      error: { code: 'INVALID_CAPACITY_COVERAGE_RANGE', message: 'membre et intervalle civil valide sont requis.' },
      capacityRecords: [], coverageActions: [], missingIntervals: []
    };
  }

  const invalidRows = [];
  const existing = [];
  (coverageRows || []).forEach(function(row) {
    if (unwrapRef(row && row.membre) !== member) return;
    const rowStart = normalizeCivilDate(row.dateDebut);
    const rowEnd = normalizeCivilDate(row.dateFin);
    if (!rowStart || !rowEnd || rowStart > rowEnd) {
      invalidRows.push(row && row.id);
      return;
    }
    existing.push({ id: row.id, start: rowStart, end: rowEnd, row });
  });
  if (invalidRows.length) {
    return {
      success: false,
      error: { code: 'INVALID_EXISTING_CAPACITY_COVERAGE', ids: invalidRows },
      capacityRecords: [], coverageActions: [], missingIntervals: []
    };
  }

  const requested = { start, end };
  const mergedExisting = mergeCoverageIntervals(existing);
  const missingIntervals = findMissingCoverageIntervals(mergedExisting, requested);
  const capacityRecords = buildWorkingDayRecords(member, missingIntervals);
  const mergedTarget = mergeCoverageIntervals(existing.concat([requested]));
  const coverageActions = [];

  mergedTarget.forEach(function(target) {
    const representedBy = existing.filter(function(interval) { return intersects(interval, target); });
    if (!representedBy.length) {
      coverageActions.push(['AddRecord', 'MemberCapacityCoverage', null, {
        membre: member,
        dateDebut: toUnixSeconds(target.start),
        dateFin: toUnixSeconds(target.end),
        createdAt: nowUnixSeconds,
        updatedAt: nowUnixSeconds
      }]);
      return;
    }

    representedBy.sort(function(left, right) { return left.id - right.id; });
    const primary = representedBy[0];
    if (primary.start !== target.start || primary.end !== target.end) {
      coverageActions.push(['UpdateRecord', 'MemberCapacityCoverage', primary.id, {
        dateDebut: toUnixSeconds(target.start),
        dateFin: toUnixSeconds(target.end),
        updatedAt: nowUnixSeconds
      }]);
    }
    representedBy.slice(1).forEach(function(redundant) {
      coverageActions.push(['RemoveRecord', 'MemberCapacityCoverage', redundant.id]);
    });
  });

  return { success: true, capacityRecords, coverageActions, missingIntervals, requested };
}

async function ensureMemberCapacityCoverage(grist, memberId, startDate, endDate, options = {}) {
  const docApi = getDocApi(grist);
  const dryRun = options.dryRun === true;
  const coverageRows = columnarToRows(await docApi.fetchTable('MemberCapacityCoverage'));
  const plan = planMemberCapacityCoverage(coverageRows, memberId, startDate, endDate, options);
  if (!plan.success) return Object.assign({}, plan, { dryRun, actionsExecuted: 0 });

  const actions = plan.capacityRecords.map(function(record) {
    return ['AddRecord', 'MemberDailyCapacities', null, record];
  }).concat(plan.coverageActions);
  if (dryRun || !actions.length) {
    return Object.assign({}, plan, { dryRun, actions, actionsExecuted: 0 });
  }

  try {
    await docApi.applyUserActions(actions);

    // Second contrôle uniquement sur le petit index : il fusionne des
    // intervalles concurrents sans recharger les capacités quotidiennes.
    const afterRows = columnarToRows(await docApi.fetchTable('MemberCapacityCoverage'));
    const afterPlan = planMemberCapacityCoverage(afterRows, memberId, startDate, endDate, options);
    const compactionActions = afterPlan.success ? afterPlan.coverageActions : [];
    if (compactionActions.length) await docApi.applyUserActions(compactionActions);

    return Object.assign({}, plan, {
      dryRun: false,
      actions,
      actionsExecuted: actions.length + compactionActions.length,
      compactionActions
    });
  } catch (error) {
    return Object.assign({}, plan, {
      success: false,
      error: { code: 'GRIST_ACTION_FAILED', message: error.message || String(error) },
      actions,
      actionsExecuted: 0
    });
  }
}

module.exports = {
  mergeCoverageIntervals,
  findMissingCoverageIntervals,
  planMemberCapacityCoverage,
  ensureMemberCapacityCoverage
};
