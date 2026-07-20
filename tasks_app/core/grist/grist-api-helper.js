/**
 * Grist API Helper - Helper commun pour l'accès à grist.docApi
 * 
 * Normalise l'accès à l'API Grist pour éviter les erreurs
 * et garantir la cohérence entre les différents modules.
 */

'use strict';

/**
 * Normalise l'accès à grist.docApi
 * @param {Object} grist - Objet Grist ou grist.docApi
 * @returns {Object} L'API docApi validée
 * @throws {Error} Si l'API n'est pas valide
 */
function getDocApi(grist) {
  const docApi = grist && (grist.docApi || grist);

  if (
    !docApi ||
    typeof docApi.fetchTable !== 'function' ||
    typeof docApi.applyUserActions !== 'function'
  ) {
    throw new Error('INVALID_GRIST_DOC_API: grist.docApi doit exposer fetchTable et applyUserActions');
  }

  return docApi;
}

/**
 * Charge les métadonnées de migration depuis Grist
 * @param {Object} grist - Objet Grist
 * @returns {Promise<Array>} Tableau de {tableId, colId, type, isFormula}
 */
async function loadMigrationMetadata(grist) {
  const docApi = getDocApi(grist);
  
  // Charger les tables et colonnes
  const [tablesData, columnsData] = await Promise.all([
    docApi.fetchTable('_grist_Tables'),
    docApi.fetchTable('_grist_Tables_column')
  ]);
  
  // Convertir en lignes
  const tables = columnarToRows(tablesData);
  const columns = columnarToRows(columnsData);
  
  // Créer un map tableId par parentId
  const tableById = new Map();
  for (const table of tables) {
    tableById.set(table.id, table.tableId);
  }
  
  // Reconstruire les métadonnées avec tableId
  const result = [];
  for (const col of columns) {
    const tableId = tableById.get(col.parentId);
    if (tableId) {
      result.push({
        tableId,
        colId: col.colId,
        type: col.type,
        isFormula: col.isFormula
      });
    }
  }
  
  return result;
}

/**
 * Helper: convertir tableau colonnaire en lignes
 * @param {Object} data - Données colonnaires
 * @returns {Array} Tableau de lignes
 */
function columnarToRows(data) {
  if (!data || Array.isArray(data)) return data || [];
  
  const cols = Object.keys(data);
  if (!cols.length) return [];
  
  const n = (data[cols[0]] && data[cols[0]].length) || 0;
  const rows = [];
  
  for (let i = 0; i < n; i++) {
    const rec = {};
    for (const col of cols) {
      rec[col] = data[col][i];
    }
    rows.push(rec);
  }
  
  return rows;
}

module.exports = {
  getDocApi,
  loadMigrationMetadata,
  columnarToRows
};
