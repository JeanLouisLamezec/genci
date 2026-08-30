/* ==========================================================================
 * time-periods.js — Contrat temporel partagé entre Plan et Gantt
 * ========================================================================== */
var TaskFlowTimePeriods = (function() {
  'use strict';

  var GRANULARITIES = ['week', 'month', 'quarter', 'semester', 'year'];
  var DEFAULT_HORIZONS = {
    week: 12,
    month: 12,
    quarter: 8,
    semester: 6,
    year: 5
  };
  var MONTHS_SHORT = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];

  function normalizeGranularity(value) {
    return GRANULARITIES.indexOf(value) >= 0 ? value : 'week';
  }

  function utcDate(value) {
    var date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return null;
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  function startOf(date, granularity) {
    var result = utcDate(date);
    if (!result) return null;
    var mode = normalizeGranularity(granularity);
    if (mode === 'week') {
      var day = result.getUTCDay() || 7;
      result.setUTCDate(result.getUTCDate() - day + 1);
    } else if (mode === 'month') {
      result = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth(), 1));
    } else if (mode === 'quarter') {
      result = new Date(Date.UTC(result.getUTCFullYear(), Math.floor(result.getUTCMonth() / 3) * 3, 1));
    } else if (mode === 'semester') {
      result = new Date(Date.UTC(result.getUTCFullYear(), Math.floor(result.getUTCMonth() / 6) * 6, 1));
    } else {
      result = new Date(Date.UTC(result.getUTCFullYear(), 0, 1));
    }
    return result;
  }

  function shift(date, granularity, count) {
    var result = startOf(date, granularity);
    if (!result) return null;
    var amount = Number(count) || 0;
    var mode = normalizeGranularity(granularity);
    if (mode === 'week') result.setUTCDate(result.getUTCDate() + amount * 7);
    else if (mode === 'month') result.setUTCMonth(result.getUTCMonth() + amount);
    else if (mode === 'quarter') result.setUTCMonth(result.getUTCMonth() + amount * 3);
    else if (mode === 'semester') result.setUTCMonth(result.getUTCMonth() + amount * 6);
    else result.setUTCFullYear(result.getUTCFullYear() + amount);
    return result;
  }

  function key(date, granularity) {
    var result = utcDate(date);
    if (!result) return null;
    var mode = normalizeGranularity(granularity);
    var year = result.getUTCFullYear();
    var month = result.getUTCMonth();
    if (mode === 'month') return year + '-' + String(month + 1).padStart(2, '0');
    if (mode === 'quarter') return year + '-Q' + (Math.floor(month / 3) + 1);
    if (mode === 'semester') return year + '-H' + (Math.floor(month / 6) + 1);
    if (mode === 'year') return String(year);

    var target = utcDate(result);
    var day = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - day);
    var yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    var week = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
    return target.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
  }

  function bounds(periodKey, granularity) {
    var mode = normalizeGranularity(granularity);
    var match;
    var start;

    if (mode === 'week') {
      match = String(periodKey || '').match(/^(\d{4})-W(\d{2})$/);
      if (!match) return null;
      var jan4 = new Date(Date.UTC(Number(match[1]), 0, 4));
      var jan4Day = jan4.getUTCDay() || 7;
      start = new Date(jan4.getTime());
      start.setUTCDate(start.getUTCDate() - jan4Day + 1 + (Number(match[2]) - 1) * 7);
    } else if (mode === 'month') {
      match = String(periodKey || '').match(/^(\d{4})-(0[1-9]|1[0-2])$/);
      if (!match) return null;
      start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
    } else if (mode === 'quarter') {
      match = String(periodKey || '').match(/^(\d{4})-Q([1-4])$/);
      if (!match) return null;
      start = new Date(Date.UTC(Number(match[1]), (Number(match[2]) - 1) * 3, 1));
    } else if (mode === 'semester') {
      match = String(periodKey || '').match(/^(\d{4})-H([1-2])$/);
      if (!match) return null;
      start = new Date(Date.UTC(Number(match[1]), (Number(match[2]) - 1) * 6, 1));
    } else {
      match = String(periodKey || '').match(/^(\d{4})$/);
      if (!match) return null;
      start = new Date(Date.UTC(Number(match[1]), 0, 1));
    }

    return { start: start, end: shift(start, mode, 1) };
  }

  function range(startDate, granularity, count) {
    var mode = normalizeGranularity(granularity);
    var cursor = startOf(startDate, mode);
    var result = [];
    if (!cursor) return result;
    for (var index = 0; index < Math.max(Number(count) || 0, 0); index++) {
      result.push(key(cursor, mode));
      cursor = shift(cursor, mode, 1);
    }
    return result;
  }

  function starts(startDate, granularity, count) {
    return range(startDate, granularity, count).map(function(periodKey) {
      return bounds(periodKey, granularity).start;
    });
  }

  function formatLabel(periodKey, granularity) {
    var mode = normalizeGranularity(granularity);
    var value = String(periodKey || '');
    if (mode === 'week') return 'S' + value.slice(6);
    if (mode === 'month') return value.slice(5) + '/' + value.slice(2, 4);
    if (mode === 'quarter') return 'T' + value.slice(-1) + ' ' + value.slice(0, 4);
    if (mode === 'semester') return 'S' + value.slice(-1) + ' ' + value.slice(0, 4);
    return value;
  }

  function formatSubLabel(date, granularity) {
    var start = startOf(date, granularity);
    if (!start) return '';
    var mode = normalizeGranularity(granularity);
    if (mode === 'week') return start.getUTCDate() + ' ' + MONTHS_SHORT[start.getUTCMonth()];
    if (mode === 'quarter') return MONTHS_SHORT[start.getUTCMonth()] + '–' + MONTHS_SHORT[start.getUTCMonth() + 2];
    if (mode === 'semester') return MONTHS_SHORT[start.getUTCMonth()] + '–' + MONTHS_SHORT[start.getUTCMonth() + 5];
    return '';
  }

  function defaultHorizon(granularity) {
    return DEFAULT_HORIZONS[normalizeGranularity(granularity)];
  }

  return {
    GRANULARITIES: GRANULARITIES.slice(),
    DEFAULT_HORIZONS: Object.assign({}, DEFAULT_HORIZONS),
    normalizeGranularity: normalizeGranularity,
    startOf: startOf,
    shift: shift,
    key: key,
    bounds: bounds,
    range: range,
    starts: starts,
    formatLabel: formatLabel,
    formatSubLabel: formatSubLabel,
    defaultHorizon: defaultHorizon
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TaskFlowTimePeriods;
}
if (typeof globalThis !== 'undefined') {
  globalThis.TaskFlowTimePeriods = TaskFlowTimePeriods;
}
