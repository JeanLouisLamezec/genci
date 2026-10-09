/**
 * Configuration persistée des exports CRA.
 *
 * La table CRAExportSettings est un singleton documentaire. Le module reste
 * volontairement indépendant de l'interface et des générateurs PDF/CSV afin
 * de pouvoir être testé et réutilisé par d'autres widgets.
 */
(function(global) {
  'use strict';

  const TABLE_ID = 'CRAExportSettings';
  const PROJECT_COLUMNS_FIELD = 'projectColumns';
  const LOGO_FIELD = 'logo';
  const LOGO_POSITION_FIELD = 'logoPosition';
  const MAX_PROJECT_COLUMNS = 3;
  const ALLOWED_LOGO_POSITIONS = ['top-left', 'bottom-center'];
  const LEGACY_LOGO_POSITIONS = Object.freeze({
    'top-right': 'top-left',
    'bottom-right': 'bottom-center'
  });
  const UNSUPPORTED_PROJECT_COLUMN_TYPES = new Set(['Attachments', 'Any', 'ManualSortPos']);

  function columnarToRows(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data.slice();
    const keys = Object.keys(data);
    const count = keys.length && Array.isArray(data[keys[0]]) ? data[keys[0]].length : 0;
    const rows = [];
    for (let index = 0; index < count; index++) {
      const row = {};
      keys.forEach(key => { row[key] = data[key][index]; });
      rows.push(row);
    }
    return rows;
  }

  function normalizeAttachmentIds(value) {
    const raw = Array.isArray(value) && value[0] === 'L' ? value.slice(1) : value;
    if (!Array.isArray(raw)) return [];
    const ids = [];
    const seen = new Set();
    raw.forEach(item => {
      const id = Number(item);
      if (Number.isInteger(id) && id > 0 && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    });
    return ids;
  }

  function normalizeColumnIds(value) {
    let source = value;
    if (typeof source === 'string') {
      try {
        source = JSON.parse(source);
      } catch (error) {
        source = [];
      }
    }
    if (!Array.isArray(source)) return [];
    const seen = new Set();
    const result = [];
    source.forEach(item => {
      const id = String(item || '').trim();
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(id) || id === 'id' || id === 'nom' || seen.has(id)) {
        return;
      }
      seen.add(id);
      if (result.length < MAX_PROJECT_COLUMNS) result.push(id);
    });
    return result;
  }

  function normalizeLogoPosition(value) {
    const normalized = LEGACY_LOGO_POSITIONS[value] || value;
    return ALLOWED_LOGO_POSITIONS.includes(normalized) ? normalized : 'bottom-center';
  }

  function normalizeSettings(row) {
    const source = row && typeof row === 'object' ? row : {};
    return {
      id: Number.isInteger(Number(source.id)) ? Number(source.id) : null,
      projectColumnIds: normalizeColumnIds(source[PROJECT_COLUMNS_FIELD]),
      logoAttachmentIds: normalizeAttachmentIds(source[LOGO_FIELD]),
      logoPosition: normalizeLogoPosition(source[LOGO_POSITION_FIELD])
    };
  }

  function serializeProjectColumnIds(columnIds) {
    return JSON.stringify(normalizeColumnIds(columnIds));
  }

  function attachmentValue(ids) {
    return ['L'].concat(normalizeAttachmentIds(ids).slice(0, 1));
  }

  async function tableExists(grist) {
    if (!grist || !grist.docApi || typeof grist.docApi.listTables !== 'function') return false;
    const tables = await grist.docApi.listTables();
    return Array.isArray(tables) && tables.includes(TABLE_ID);
  }

  async function load(grist) {
    if (!await tableExists(grist)) return normalizeSettings(null);
    const rows = columnarToRows(await grist.docApi.fetchTable(TABLE_ID));
    const singleton = rows.slice().sort((left, right) => Number(left.id || 0) - Number(right.id || 0))[0];
    return normalizeSettings(singleton);
  }

  async function save(grist, settings) {
    if (!grist || !grist.docApi || typeof grist.docApi.applyUserActions !== 'function') {
      throw new Error('CRAExportSettings: API Grist indisponible.');
    }
    if (!await tableExists(grist)) {
      throw new Error('CRAExportSettings: table absente ; exécutez la migration du schéma TaskFlow.');
    }

    const current = await load(grist);
    const source = settings && typeof settings === 'object' ? settings : {};
    const logoIds = Object.prototype.hasOwnProperty.call(source, 'logoAttachmentIds')
      ? normalizeAttachmentIds(source.logoAttachmentIds)
      : current.logoAttachmentIds;
    const fields = {
      [PROJECT_COLUMNS_FIELD]: serializeProjectColumnIds(source.projectColumnIds),
      [LOGO_FIELD]: attachmentValue(logoIds),
      [LOGO_POSITION_FIELD]: normalizeLogoPosition(source.logoPosition),
      updatedAt: Math.floor(Date.now() / 1000)
    };
    const action = current.id
      ? ['UpdateRecord', TABLE_ID, current.id, fields]
      : ['AddRecord', TABLE_ID, null, fields];

    await grist.docApi.applyUserActions([action]);
    return load(grist);
  }

  function isExportableProjectColumn(column) {
    if (!column || !column.colId || column.colId === 'id' || column.colId === 'nom') return false;
    if (String(column.colId).startsWith('manualSort')) return false;
    const type = String(column.type || 'Text');
    return !UNSUPPORTED_PROJECT_COLUMN_TYPES.has(type) && !type.startsWith('RefList:');
  }

  async function listProjectColumns(grist) {
    if (!grist || !grist.docApi) return [];
    const values = await Promise.all([
      grist.docApi.fetchTable('_grist_Tables'),
      grist.docApi.fetchTable('_grist_Tables_column')
    ]);
    const tables = columnarToRows(values[0]);
    const columns = columnarToRows(values[1]);
    const projects = tables.find(table => table.tableId === 'Projects');
    if (!projects) return [];
    return columns
      .filter(column => Number(column.parentId) === Number(projects.id))
      .filter(isExportableProjectColumn)
      .map(column => ({
        id: String(column.colId),
        label: String(column.label || column.colId),
        type: String(column.type || 'Text')
      }))
      .sort((left, right) => left.label.localeCompare(right.label, 'fr'));
  }

  function resolveProjectColumns(settings, availableColumns) {
    const wanted = normalizeColumnIds(settings && settings.projectColumnIds);
    const byId = new Map((availableColumns || []).map(column => [column.id, column]));
    return wanted.map(id => byId.get(id)).filter(Boolean);
  }

  const api = {
    TABLE_ID,
    PROJECT_COLUMNS_FIELD,
    LOGO_FIELD,
    LOGO_POSITION_FIELD,
    MAX_PROJECT_COLUMNS,
    columnarToRows,
    normalizeAttachmentIds,
    normalizeColumnIds,
    normalizeSettings,
    serializeProjectColumnIds,
    attachmentValue,
    tableExists,
    load,
    save,
    listProjectColumns,
    resolveProjectColumns
  };

  if (global) global.CraExportSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
