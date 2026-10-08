/**
 * Legacy Unavailability Migration Service
 *
 * Explicit, opt-in conversion of old date ranges into daily facts. This is not
 * a widget lifecycle hook: callers must provide a finite horizon and normally
 * start with dryRun=true.
 */

'use strict';

const { getDocApi, columnarToRows } = require('../grist/grist-api-helper.js');
const {
  normalizeCivilDate,
  normalizeDailyUnavailabilityRows,
  reconcileDailyUnavailabilities
} = require('./daily-unavailability-normalizer.js');

function isActive(value) {
  return value !== false && value !== 0 && value !== '0' && value !== 'false';
}

function isLegacyRange(row) {
  return row && isActive(row.actif) && !normalizeCivilDate(row.date) &&
    (row.dateDebut !== null && row.dateDebut !== undefined ||
      row.dateFin !== null && row.dateFin !== undefined);
}

function isDailyFact(row) {
  return row && !!normalizeCivilDate(row.date);
}

function isRangeFullyInsideHorizon(row, horizonStart, horizonEnd) {
  const start = normalizeCivilDate(row.dateDebut);
  const end = normalizeCivilDate(row.dateFin);
  return !!start && !!end && start >= horizonStart && end <= horizonEnd;
}

function effectiveIntegration(row, defaultIntegration) {
  const result = normalizeDailyUnavailabilityRows([row], {
    horizonStart: normalizeCivilDate(row.date) || normalizeCivilDate(row.dateDebut),
    horizonEnd: normalizeCivilDate(row.date) || normalizeCivilDate(row.dateFin),
    defaultIntegration
  });
  return result.facts.length ? result.facts[0].integration : null;
}

/**
 * Plans the conversion without writing to Grist.
 *
 * A partially covered legacy range stays active. This is intentional: marking
 * it inactive would silently lose days outside the selected migration horizon.
 */
function planLegacyUnavailabilityMigration(rows, options = {}) {
  const horizonStart = normalizeCivilDate(options.horizonStart);
  const horizonEnd = normalizeCivilDate(options.horizonEnd);
  const nowUnixSeconds = Number.isFinite(Number(options.nowUnixSeconds))
    ? Number(options.nowUnixSeconds)
    : Math.floor(Date.now() / 1000);
  const defaultIntegration = options.defaultIntegration || '';

  if (!horizonStart || !horizonEnd || horizonStart > horizonEnd) {
    return {
      success: false,
      error: { code: 'INVALID_MIGRATION_HORIZON', message: 'Un horizon civil fini est requis.' },
      actions: [],
      diagnostics: [],
      rejected: []
    };
  }

  const allRows = rows || [];
  const dailyRows = allRows.filter(isDailyFact);
  const candidatesByIntegration = new Map();
  const diagnostics = [];
  const rejected = [];

  allRows.filter(isLegacyRange).forEach(function(row) {
    const normalized = normalizeDailyUnavailabilityRows([row], {
      horizonStart,
      horizonEnd,
      defaultIntegration
    });
    diagnostics.push.apply(diagnostics, normalized.diagnostics);
    if (normalized.rejected.length) {
      rejected.push({ id: row.id, reasons: normalized.rejected });
      return;
    }
    if (!normalized.facts.length) return;

    const integration = normalized.facts[0].integration;
    if (!candidatesByIntegration.has(integration)) candidatesByIntegration.set(integration, []);
    candidatesByIntegration.get(integration).push(row);
  });

  const actions = [];
  const conflicts = [];
  const summary = { creates: 0, updates: 0, deactivations: 0, legacyRetained: 0 };

  candidatesByIntegration.forEach(function(legacyRows, integration) {
    const relevantDailyRows = dailyRows.filter(function(row) {
      return effectiveIntegration(row, defaultIntegration) === integration;
    });
    const normalized = normalizeDailyUnavailabilityRows(relevantDailyRows.concat(legacyRows), {
      horizonStart,
      horizonEnd,
      defaultIntegration
    });
    diagnostics.push.apply(diagnostics, normalized.diagnostics);
    rejected.push.apply(rejected, normalized.rejected.map(function(reason) {
      return { id: null, reasons: [reason] };
    }));

    const diff = reconcileDailyUnavailabilities(relevantDailyRows, normalized.facts, {
      integration,
      scopeStart: horizonStart,
      scopeEnd: horizonEnd,
      nowUnixSeconds
    });
    if (!diff.success) {
      conflicts.push.apply(conflicts, diff.conflicts || [diff.error]);
      return;
    }

    diff.creates.forEach(function(fields) {
      actions.push(['AddRecord', 'Disponibilites', null, fields]);
    });
    diff.updates.forEach(function(update) {
      actions.push(['UpdateRecord', 'Disponibilites', update.id, update.fields]);
    });
    summary.creates += diff.creates.length;
    summary.updates += diff.updates.length;

    legacyRows.forEach(function(row) {
      if (isRangeFullyInsideHorizon(row, horizonStart, horizonEnd)) {
        actions.push(['UpdateRecord', 'Disponibilites', row.id, {
          actif: false,
          sourceUpdatedAt: nowUnixSeconds
        }]);
        summary.deactivations += 1;
      } else {
        summary.legacyRetained += 1;
        diagnostics.push({
          code: 'LEGACY_RANGE_PARTIALLY_CONVERTED',
          id: row.id,
          message: 'La plage dépasse l’horizon et reste active jusqu’à sa conversion complète.'
        });
      }
    });
  });

  if (rejected.length || conflicts.length) {
    return {
      success: false,
      error: {
        code: rejected.length
          ? 'LEGACY_UNAVAILABILITY_VALIDATION_FAILED'
          : 'LEGACY_UNAVAILABILITY_CONFLICTS'
      },
      actions: [],
      diagnostics,
      rejected,
      conflicts,
      summary
    };
  }

  return { success: true, actions, diagnostics, rejected, conflicts: [], summary };
}

/** Executes a plan only when dryRun is explicitly false. */
async function migrateLegacyUnavailabilities(grist, options = {}) {
  const docApi = getDocApi(grist);
  const dryRun = options.dryRun !== false;
  const rows = columnarToRows(await docApi.fetchTable('Disponibilites'));
  const plan = planLegacyUnavailabilityMigration(rows, options);

  if (!plan.success || dryRun || !plan.actions.length) {
    return Object.assign({}, plan, { dryRun, actionsExecuted: 0 });
  }

  try {
    await docApi.applyUserActions(plan.actions);
    return Object.assign({}, plan, { dryRun: false, actionsExecuted: plan.actions.length });
  } catch (error) {
    return Object.assign({}, plan, {
      success: false,
      error: { code: 'GRIST_ACTION_FAILED', message: error.message || String(error) },
      actionsExecuted: 0
    });
  }
}

module.exports = {
  planLegacyUnavailabilityMigration,
  migrateLegacyUnavailabilities
};
