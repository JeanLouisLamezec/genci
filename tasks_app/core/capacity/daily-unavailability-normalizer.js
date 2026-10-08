/**
 * Daily Unavailability Normalizer
 *
 * Converts availability data into the source-independent daily facts used by
 * TaskFlow. It deliberately does not call Grist: the same deterministic rules
 * can be used by a migration, an n8n workflow specification, or a widget.
 */

'use strict';

const {
  parseDateUTC,
  formatDateUTC,
  addDaysUTC,
  compareDates
} = require('../planning/planning-engine.js');

const DEFAULT_MANUAL_INTEGRATION = 'manuel';
const TYPE_PRIORITY = ['maladie', 'conge', 'formation', 'ferie', 'temps_partiel', 'autre'];

function normalizeCivilDate(value) {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const date = new Date(value * 1000);
    return Number.isFinite(date.getTime()) ? formatDateUTC(date) : null;
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? formatDateUTC(value) : null;
  }

  if (typeof value === 'string') {
    const date = parseDateUTC(value);
    return date ? formatDateUTC(date) : null;
  }

  return null;
}

function toUnixSeconds(isoDate) {
  return Math.floor(new Date(isoDate + 'T00:00:00Z').getTime() / 1000);
}

function unwrapRef(value) {
  if (Array.isArray(value) && value.length >= 2) return unwrapRef(value[1]);
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function isActive(value) {
  return value !== false && value !== 0 && value !== '0' && value !== 'false';
}

function uniqueStrings(values) {
  const unique = new Set();
  (values || []).forEach(function(value) {
    if (value === null || value === undefined) return;
    const text = String(value).trim();
    if (text) unique.add(text);
  });
  return Array.from(unique).sort();
}

function parseExternalRefs(value) {
  if (Array.isArray(value)) return uniqueStrings(value);
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return uniqueStrings(parsed);
    } catch (error) {
      // Une ancienne valeur texte est une référence opaque parfaitement valide.
    }
  }
  return uniqueStrings([value]);
}

function normalizeRatio(value) {
  const ratio = Number(value);
  return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : null;
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
}

function normalizeIntegration(row, defaultIntegration) {
  const origin = row.origine === 'logiciel_metier' ? 'logiciel_metier' : 'manuel';
  const explicit = row.integration === null || row.integration === undefined
    ? ''
    : String(row.integration).trim();
  if (explicit) return { origin, integration: explicit };
  if (origin === 'manuel') return { origin, integration: DEFAULT_MANUAL_INTEGRATION };
  return { origin, integration: defaultIntegration || '' };
}

function canonicalKey(memberId, date, integration) {
  return String(memberId) + '|' + date + '|' + integration;
}

function chooseType(types) {
  const choices = uniqueStrings(types);
  if (!choices.length) return 'autre';
  choices.sort(function(left, right) {
    const leftRank = TYPE_PRIORITY.indexOf(left);
    const rightRank = TYPE_PRIORITY.indexOf(right);
    return (leftRank === -1 ? TYPE_PRIORITY.length : leftRank) -
      (rightRank === -1 ? TYPE_PRIORITY.length : rightRank) || left.localeCompare(right);
  });
  return choices[0];
}

function normalizeHorizon(options, diagnostics) {
  const hasStart = options.horizonStart !== null && options.horizonStart !== undefined;
  const hasEnd = options.horizonEnd !== null && options.horizonEnd !== undefined;
  if (!hasStart && !hasEnd) return { start: null, end: null };

  const start = normalizeCivilDate(options.horizonStart);
  const end = normalizeCivilDate(options.horizonEnd);
  if (!start || !end || compareDates(start, end) > 0) {
    diagnostics.push({
      code: 'INVALID_HORIZON',
      message: 'horizonStart et horizonEnd doivent former un intervalle civil valide.'
    });
    return null;
  }
  return { start, end };
}

/**
 * Normalise des lignes quotidiennes ou historiques en faits quotidiens.
 * Une plage héritée requiert obligatoirement un horizon explicite : cela évite
 * une expansion accidentelle de plusieurs années de données historiques.
 */
function normalizeDailyUnavailabilityRows(rows, options = {}) {
  const diagnostics = [];
  const rejected = [];
  const horizon = normalizeHorizon(options, diagnostics);
  if (!horizon) return { facts: [], diagnostics, rejected };

  const defaultIntegration = String(options.defaultIntegration || '').trim();
  const byKey = new Map();

  (rows || []).forEach(function(row, index) {
    if (!row || !isActive(row.actif)) return;

    const memberId = unwrapRef(row.membre);
    const ratio = normalizeRatio(row.dispo);
    const source = normalizeIntegration(row, defaultIntegration);
    const dailyDate = normalizeCivilDate(row.date);
    let start = dailyDate || normalizeCivilDate(row.dateDebut);
    let end = dailyDate || normalizeCivilDate(row.dateFin);
    const legacyRange = !dailyDate;

    if (!memberId) {
      rejected.push({ index, code: 'INVALID_MEMBER', message: 'membre doit référencer une ligne Team.' });
      return;
    }
    if (ratio === null) {
      rejected.push({ index, code: 'INVALID_RATIO', message: 'dispo doit être comprise entre 0 et 1.' });
      return;
    }
    if (!source.integration) {
      rejected.push({ index, code: 'MISSING_INTEGRATION', message: 'Une ligne logiciel_metier requiert integration.' });
      return;
    }
    if (!start || !end || compareDates(start, end) > 0) {
      rejected.push({ index, code: 'INVALID_DATE_RANGE', message: 'date ou dateDebut/dateFin est invalide.' });
      return;
    }
    if (legacyRange && !horizon.start) {
      rejected.push({
        index,
        code: 'HORIZON_REQUIRED_FOR_LEGACY_RANGE',
        message: 'Une plage historique ne peut être développée sans horizon explicite.'
      });
      return;
    }

    if (horizon.start && compareDates(start, horizon.start) < 0) start = horizon.start;
    if (horizon.end && compareDates(end, horizon.end) > 0) end = horizon.end;
    if (compareDates(start, end) > 0) return;

    const refs = parseExternalRefs(row.externalRefs);
    if (row.externalKey) refs.push(String(row.externalKey));
    if (legacyRange && row.id) refs.push('legacy:' + row.id);
    const timestamp = normalizeTimestamp(row.sourceUpdatedAt);
    let current = parseDateUTC(start);
    const last = parseDateUTC(end);

    while (current && last && current <= last) {
      const date = formatDateUTC(current);
      const key = canonicalKey(memberId, date, source.integration);
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = {
          membre: memberId,
          date,
          integration: source.integration,
          dispo: ratio,
          origins: new Set([source.origin]),
          types: new Set(),
          comments: new Set(),
          refs: new Set(),
          sourceUpdatedAt: timestamp
        };
        byKey.set(key, bucket);
      } else {
        bucket.dispo = Math.min(bucket.dispo, ratio);
        bucket.origins.add(source.origin);
        if (timestamp !== null && (bucket.sourceUpdatedAt === null || timestamp > bucket.sourceUpdatedAt)) {
          bucket.sourceUpdatedAt = timestamp;
        }
      }

      if (row.type) bucket.types.add(String(row.type).trim());
      if (row.commentaire) bucket.comments.add(String(row.commentaire).trim());
      refs.forEach(function(ref) { bucket.refs.add(ref); });
      current = addDaysUTC(current, 1);
    }
  });

  const facts = Array.from(byKey.values()).map(function(bucket) {
    const origins = Array.from(bucket.origins);
    const origin = origins.indexOf('logiciel_metier') !== -1 ? 'logiciel_metier' : 'manuel';
    const refs = uniqueStrings(Array.from(bucket.refs));
    const comments = uniqueStrings(Array.from(bucket.comments));
    return {
      membre: bucket.membre,
      date: bucket.date,
      dispo: bucket.dispo,
      type: chooseType(Array.from(bucket.types)),
      commentaire: comments.join(' — '),
      origine: origin,
      integration: bucket.integration,
      externalKey: 'daily:' + bucket.integration + ':' + bucket.membre + ':' + bucket.date,
      externalRefs: JSON.stringify(refs),
      actif: true,
      sourceUpdatedAt: bucket.sourceUpdatedAt
    };
  });

  facts.sort(function(left, right) {
    return left.integration.localeCompare(right.integration) ||
      left.membre - right.membre || left.date.localeCompare(right.date);
  });

  return { facts, diagnostics, rejected };
}

function sameValue(left, right) {
  return (left === null || left === undefined ? '' : String(left)) ===
    (right === null || right === undefined ? '' : String(right));
}

function sameFact(current, desired) {
  return Number(current.dispo) === desired.dispo &&
    sameValue(current.type, desired.type) &&
    sameValue(current.commentaire, desired.commentaire) &&
    sameValue(current.origine, desired.origine) &&
    sameValue(current.integration, desired.integration) &&
    sameValue(current.externalKey, desired.externalKey) &&
    sameValue(current.externalRefs, desired.externalRefs) &&
    isActive(current.actif) &&
    (desired.sourceUpdatedAt === null || desired.sourceUpdatedAt === undefined ||
      Number(current.sourceUpdatedAt) === desired.sourceUpdatedAt);
}

/**
 * Produit un diff idempotent pour une intégration donnée sur une fenêtre
 * explicite. Les lignes d'une autre intégration, et les lignes historiques de
 * plage, restent hors de portée.
 */
function reconcileDailyUnavailabilities(currentRows, desiredFacts, options = {}) {
  const integration = String(options.integration || '').trim();
  const scopeStart = normalizeCivilDate(options.scopeStart);
  const scopeEnd = normalizeCivilDate(options.scopeEnd);
  const nowUnixSeconds = normalizeTimestamp(options.nowUnixSeconds) || Math.floor(Date.now() / 1000);
  const conflicts = [];

  if (!integration || !scopeStart || !scopeEnd || compareDates(scopeStart, scopeEnd) > 0) {
    return {
      success: false,
      error: { code: 'INVALID_RECONCILIATION_SCOPE', message: 'integration et une fenêtre valide sont requises.' },
      creates: [], updates: [], deactivations: [], unchanged: [], conflicts
    };
  }

  const currentByKey = new Map();
  (currentRows || []).forEach(function(row) {
    const memberId = unwrapRef(row && row.membre);
    const date = normalizeCivilDate(row && row.date);
    if (!memberId || !date || row.integration !== integration ||
      compareDates(date, scopeStart) < 0 || compareDates(date, scopeEnd) > 0) return;
    const key = canonicalKey(memberId, date, integration);
    if (currentByKey.has(key)) {
      conflicts.push({ code: 'DUPLICATE_CURRENT_DAILY_FACT', key, ids: [currentByKey.get(key).id, row.id] });
      return;
    }
    currentByKey.set(key, row);
  });

  const desiredByKey = new Map();
  (desiredFacts || []).forEach(function(fact) {
    if (!fact || fact.integration !== integration) return;
    const memberId = unwrapRef(fact.membre);
    const date = normalizeCivilDate(fact.date);
    if (!memberId || !date || compareDates(date, scopeStart) < 0 || compareDates(date, scopeEnd) > 0) {
      conflicts.push({ code: 'INVALID_DESIRED_DAILY_FACT', fact });
      return;
    }
    const key = canonicalKey(memberId, date, integration);
    if (desiredByKey.has(key)) {
      conflicts.push({ code: 'DUPLICATE_DESIRED_DAILY_FACT', key });
      return;
    }
    desiredByKey.set(key, Object.assign({}, fact, { membre: memberId, date }));
  });

  if (conflicts.length) {
    return { success: false, error: { code: 'DAILY_UNAVAILABILITY_CONFLICTS' }, creates: [], updates: [], deactivations: [], unchanged: [], conflicts };
  }

  const creates = [];
  const updates = [];
  const deactivations = [];
  const unchanged = [];

  desiredByKey.forEach(function(desired, key) {
    const current = currentByKey.get(key);
    const fields = {
      membre: desired.membre,
      date: toUnixSeconds(desired.date),
      dispo: desired.dispo,
      type: desired.type,
      commentaire: desired.commentaire,
      origine: desired.origine,
      integration: desired.integration,
      externalKey: desired.externalKey,
      externalRefs: desired.externalRefs,
      actif: true
    };

    if (!current) {
      fields.sourceUpdatedAt = desired.sourceUpdatedAt === null || desired.sourceUpdatedAt === undefined
        ? nowUnixSeconds
        : desired.sourceUpdatedAt;
      creates.push(fields);
    } else if (sameFact(current, fields)) {
      unchanged.push(current.id);
    } else {
      fields.sourceUpdatedAt = desired.sourceUpdatedAt === null || desired.sourceUpdatedAt === undefined
        ? nowUnixSeconds
        : desired.sourceUpdatedAt;
      updates.push({ id: current.id, fields });
    }
  });

  currentByKey.forEach(function(current, key) {
    if (!desiredByKey.has(key) && isActive(current.actif)) {
      deactivations.push({ id: current.id, fields: { actif: false, sourceUpdatedAt: nowUnixSeconds } });
    }
  });

  return { success: true, creates, updates, deactivations, unchanged, conflicts: [] };
}

module.exports = {
  DEFAULT_MANUAL_INTEGRATION,
  canonicalKey,
  normalizeCivilDate,
  normalizeDailyUnavailabilityRows,
  reconcileDailyUnavailabilities
};
