/* ==========================================================================
 * user-filter-store.js — Persistance personnelle simple des filtres TaskFlow
 * ========================================================================== */
(function(root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaskFlowUserFilters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var FILTER_KEYS = ['assignee', 'team', 'project', 'programme', 'task'];

  function normalizeFilters(input) {
    var source = input && typeof input === 'object' ? input : {};
    var result = {};
    FILTER_KEYS.forEach(function(key) {
      var seen = new Set();
      result[key] = (Array.isArray(source[key]) ? source[key] : [])
        .filter(function(value) { return value !== null && value !== undefined && value !== ''; })
        .map(String)
        .filter(function(value) {
          if (seen.has(value)) return false;
          seen.add(value);
          return true;
        })
        .sort();
    });
    return result;
  }

  function signature(filters) {
    return JSON.stringify(normalizeFilters(filters));
  }

  function parseFilters(value) {
    if (!value) return normalizeFilters({});
    try {
      return normalizeFilters(typeof value === 'string' ? JSON.parse(value) : value);
    } catch (error) {
      return normalizeFilters({});
    }
  }

  function columnarToRows(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data.slice();
    var keys = Object.keys(data);
    var count = keys.length && Array.isArray(data[keys[0]]) ? data[keys[0]].length : 0;
    var rows = [];
    for (var index = 0; index < count; index++) {
      var row = {};
      keys.forEach(function(key) { row[key] = data[key][index]; });
      rows.push(row);
    }
    return rows;
  }

  function normalizeUserId(value) {
    var number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  function createStore(grist, options) {
    options = options || {};
    var gristUserId = normalizeUserId(options.gristUserId);
    var sourceWidget = String(options.sourceWidget || 'unknown');
    var debounceMs = options.debounceMs === undefined
      ? 0
      : (Number(options.debounceMs) >= 0 ? Number(options.debounceMs) : 0);
    var rowId = null;
    var lastSavedSignature = null;
    var pendingFilters = null;
    var timer = null;
    var writeChain = Promise.resolve();
    var enabled = Boolean(grist && grist.docApi && gristUserId);

    async function tableExists() {
      if (!enabled) return false;
      var tables = await grist.docApi.listTables();
      return tables.indexOf('UserFilters') !== -1;
    }

    async function findOwnRow() {
      if (!await tableExists()) return null;
      var rows = columnarToRows(await grist.docApi.fetchTable('UserFilters'))
        .filter(function(row) { return normalizeUserId(row.gristUserId) === gristUserId; })
        .sort(function(left, right) {
          var updatedDiff = Number(right.updatedAt || 0) - Number(left.updatedAt || 0);
          return updatedDiff || Number(right.id || 0) - Number(left.id || 0);
        });
      return rows[0] || null;
    }

    async function load() {
      if (!enabled) return normalizeFilters({});
      try {
        var row = await findOwnRow();
        if (!row) return normalizeFilters({});
        rowId = row.id;
        var filters = parseFilters(row.filters);
        lastSavedSignature = signature(filters);
        return filters;
      } catch (error) {
        if (typeof options.onError === 'function') options.onError(error);
        return normalizeFilters({});
      }
    }

    async function writePending() {
      if (!enabled || !pendingFilters) return { skipped: true };
      var filters = pendingFilters;
      pendingFilters = null;
      var nextSignature = signature(filters);
      if (nextSignature === lastSavedSignature) return { skipped: true };
      if (!await tableExists()) return { skipped: true, reason: 'TABLE_MISSING' };

      if (!rowId) {
        var existing = await findOwnRow();
        if (existing) rowId = existing.id;
      }

      var fields = {
        filters: nextSignature,
        updatedAt: Math.floor(Date.now() / 1000),
        sourceWidget: sourceWidget
      };
      var action;
      if (rowId) {
        action = ['UpdateRecord', 'UserFilters', rowId, fields];
      } else {
        fields.gristUserId = gristUserId;
        action = ['AddRecord', 'UserFilters', null, fields];
      }

      await grist.docApi.applyUserActions([action]);
      if (!rowId) {
        var created = await findOwnRow();
        rowId = created && created.id;
      }
      lastSavedSignature = nextSignature;
      return { skipped: false, rowId: rowId, filters: filters };
    }

    function flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      writeChain = writeChain.then(writePending).catch(function(error) {
        if (typeof options.onError === 'function') options.onError(error);
        return { skipped: true, error: error };
      });
      return writeChain;
    }

    function scheduleSave(filters) {
      if (!enabled) return;
      pendingFilters = normalizeFilters(filters);
      if (signature(pendingFilters) === lastSavedSignature) return;
      if (debounceMs === 0) {
        flush();
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    }

    return {
      load: load,
      scheduleSave: scheduleSave,
      flush: flush,
      isEnabled: function() { return enabled; },
      getRowId: function() { return rowId; }
    };
  }

  return {
    FILTER_KEYS: FILTER_KEYS,
    normalizeFilters: normalizeFilters,
    signature: signature,
    parseFilters: parseFilters,
    columnarToRows: columnarToRows,
    createStore: createStore
  };
});
