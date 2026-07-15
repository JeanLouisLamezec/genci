/**
 * Mock Grist - Faux grist.docApi pour les tests
 * 
 * Permet de tester les migrations et l'adaptateur sans navigateur ni Grist réel.
 * Implémente un sous-ensemble de l'API Grist en mémoire.
 */

'use strict';

/**
 * Crée une instance de mock Grist
 * @param {Object} options - Options de configuration
 * @param {Object} options.initialData - Données initiales
 * @param {Function} options.shouldFailAction - Fonction pour injecter des échecs (action, index) => boolean
 * @returns {Object} Mock de grist.docApi
 */
function createMockGrist(options = {}) {
  const { initialData = {}, shouldFailAction } = options;
  
  // État interne
  const tables = new Map();
  const columnsByTable = new Map();
  const nextRowIdByTable = new Map();
  
  // Métadonnées Grist (tables virtuelles)
  const gristTables = []; // { id, tableId }
  const gristTablesColumn = []; // { id, parentId, colId, type, isFormula }
  
  // Initialiser avec les données de base si fournies
  function initializeWith(data) {
    if (!data) return;
    
    for (const tableId in data) {
      if (!Object.prototype.hasOwnProperty.call(data, tableId)) continue;
      
      const rows = data[tableId];
      if (!Array.isArray(rows)) continue;
      
      const tableData = { columns: new Map(), rows: new Map() };
      
      // Initialiser les colonnes
      if (rows.length > 0) {
        const firstRow = rows[0];
        for (const colId in firstRow) {
          if (!Object.prototype.hasOwnProperty.call(firstRow, colId)) continue;
          tableData.columns.set(colId, []);
        }
      }
      
      // Ajouter les lignes
      let maxId = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowId = row.id || (maxId + 1);
        if (rowId > maxId) maxId = rowId;
        
        for (const colId in row) {
          if (!Object.prototype.hasOwnProperty.call(row, colId)) continue;
          if (!tableData.columns.has(colId)) {
            tableData.columns.set(colId, []);
          }
          const colData = tableData.columns.get(colId);
          while (colData.length < i) {
            colData.push(null);
          }
          colData[i] = row[colId];
        }
        
        tableData.rows.set(rowId, { ...row, id: rowId });
      }
      
      tables.set(tableId, tableData);
      columnsByTable.set(tableId, tableData.columns);
      nextRowIdByTable.set(tableId, maxId + 1);
      
      // Initialiser les métadonnées Grist
      const tableMetaId = gristTables.length + 1;
      gristTables.push({ id: tableMetaId, tableId });
      
      for (const [colId] of tableData.columns) {
        const colMetaId = gristTablesColumn.length + 1;
        gristTablesColumn.push({
          id: colMetaId,
          parentId: tableMetaId,
          colId,
          type: 'Any',
          isFormula: false
        });
      }
    }
  }
  
  initializeWith(initialData);
  
  // Helper: convertir les données colonnaires en lignes
  function columnarToRows(columnarData) {
    if (!columnarData || Array.isArray(columnarData)) return columnarData || [];
    
    const cols = Object.keys(columnarData);
    if (!cols.length) return [];
    
    const n = (columnarData[cols[0]] && columnarData[cols[0]].length) || 0;
    const rows = [];
    
    for (let i = 0; i < n; i++) {
      const rec = {};
      for (const col of cols) {
        rec[col] = columnarData[col][i];
      }
      rows.push(rec);
    }
    
    return rows;
  }
  
  // Helper: convertir les lignes en données colonnaires
  function rowsToColumnar(rows, columns) {
    const columnar = {};
    
    for (const col of columns) {
      columnar[col] = [];
    }
    
    for (const row of rows) {
      for (const col of columns) {
        columnar[col].push(row[col] !== undefined ? row[col] : null);
      }
    }
    
    return columnar;
  }
  
  // API publique mockée
  const mockApi = {
    // API compatible avec grist.docApi
    docApi: null, // Sera défini ci-dessous
    
    /**
     * Liste les tables existantes
     * @returns {Promise<string[]>}
     */
    async listTables() {
      return Array.from(tables.keys());
    },
    
    /**
     * Récupère une table entière
     * @param {string} tableId - ID de la table
     * @returns {Promise<Object>} Données colonnaires
     */
    async fetchTable(tableId) {
      // Tables virtuelles Grist
      if (tableId === '_grist_Tables') {
        const result = { id: [], tableId: [] };
        for (const t of gristTables) {
          result.id.push(t.id);
          result.tableId.push(t.tableId);
        }
        return result;
      }
      
      if (tableId === '_grist_Tables_column') {
        const result = { id: [], parentId: [], colId: [], type: [], isFormula: [] };
        for (const c of gristTablesColumn) {
          result.id.push(c.id);
          result.parentId.push(c.parentId);
          result.colId.push(c.colId);
          result.type.push(c.type);
          result.isFormula.push(c.isFormula);
        }
        return result;
      }
      
      const table = tables.get(tableId);
      
      if (!table) {
        // Retourner une structure vide pour les tables inexistantes
        return { id: [] };
      }
      
      const result = { id: [] };
      
      // Ajouter les IDs
      for (const [rowId] of table.rows) {
        result.id.push(rowId);
      }
      
      // Ajouter les colonnes
      for (const [colId, colData] of table.columns) {
        result[colId] = [...colData];
      }
      
      return result;
    },
    
    /**
     * Applique des actions utilisateur
     * @param {Array} actions - Tableau d'actions Grist
     * @returns {Promise<Array>} Résultats des actions
     */
    async applyUserActions(actions) {
      const results = [];
      const stateSnapshot = mockApi.exportState();
      const countersSnapshot = {
        nextRowIdByTable: new Map(nextRowIdByTable),
        gristTablesLength: gristTables.length,
        gristTablesColumnLength: gristTablesColumn.length
      };
      
      try {
        for (let i = 0; i < actions.length; i++) {
          const action = actions[i];
          const [type, ...args] = action;
          
          // Injecter un échec si configuré
          if (shouldFailAction && shouldFailAction(action, i)) {
            throw new Error(`ACTION_FAILED: Échec simulé pour l'action ${i}: ${type}`);
          }
          
          let result;
          
          switch (type) {
            case 'AddTable':
              result = handleAddTable(...args);
              break;
            case 'AddColumn':
              result = handleAddColumn(...args);
              break;
            case 'AddRecord':
              result = handleAddRecord(...args);
              break;
            case 'UpdateRecord':
              result = handleUpdateRecord(...args);
              break;
            case 'RemoveRecord':
              result = handleRemoveRecord(...args);
              break;
            case 'RenameTable':
              result = handleRenameTable(...args);
              break;
            case 'ModifyColumn':
              result = handleModifyColumn(...args);
              break;
            default:
              throw new Error(`Action non supportée: ${type}`);
          }
          
          results.push(result);
        }
        
        return results;
      } catch (e) {
        // Rollback complet en cas d'erreur (injectée ou naturelle)
        tables.clear();
        columnsByTable.clear();
        nextRowIdByTable.clear();
        gristTables.length = 0;
        gristTablesColumn.length = 0;
        initializeWith(stateSnapshot);
        
        // Restaurer les compteurs
        for (const [tableId, count] of countersSnapshot.nextRowIdByTable) {
          nextRowIdByTable.set(tableId, count);
        }
        
        throw e;
      }
    },
    
    /**
     * Réinitialise l'état du mock
     */
    reset() {
      tables.clear();
      columnsByTable.clear();
      nextRowIdByTable.clear();
      gristTables.length = 0;
      gristTablesColumn.length = 0;
      initializeWith(initialData);
    },
    
    /**
     * Exporte l'état actuel pour inspection
     * @returns {Object} État complet
     */
    exportState() {
      const state = {};
      
      for (const [tableId, tableData] of tables) {
        const rows = [];
        for (const [rowId, row] of tableData.rows) {
          rows.push({ ...row });
        }
        state[tableId] = rows;
      }
      
      // Exporter aussi les métadonnées Grist et compteurs
      state._gristTables = gristTables.map(t => ({ ...t }));
      state._gristTablesColumn = gristTablesColumn.map(c => ({ ...c }));
      state._counters = {};
      for (const [tableId, count] of nextRowIdByTable) {
        state._counters[tableId] = count;
      }
      
      return state;
    },
    
    /**
     * Importe un état pour les tests de rollback
     * @param {Object} state - État à importer
     */
    importState(state) {
      tables.clear();
      columnsByTable.clear();
      nextRowIdByTable.clear();
      gristTables.length = 0;
      gristTablesColumn.length = 0;
      initializeWith(state);
      
      // Restaurer les métadonnées et compteurs si présents
      if (state._gristTables) {
        for (const t of state._gristTables) {
          gristTables.push({ ...t });
        }
      }
      if (state._gristTablesColumn) {
        for (const c of state._gristTablesColumn) {
          gristTablesColumn.push({ ...c });
        }
      }
      if (state._counters) {
        for (const tableId in state._counters) {
          nextRowIdByTable.set(tableId, state._counters[tableId]);
        }
      }
    },
    
    /**
     * Vérifie si une table existe
     * @param {string} tableId
     * @returns {boolean}
     */
    hasTable(tableId) {
      return tables.has(tableId);
    },
    
    /**
     * Vérifie si une colonne existe
     * @param {string} tableId
     * @param {string} colId
     * @returns {boolean}
     */
    hasColumn(tableId, colId) {
      const table = tables.get(tableId);
      if (!table) return false;
      return table.columns.has(colId);
    },
    
    /**
     * Obtient les colonnes d'une table
     * @param {string} tableId
     * @returns {string[]}
     */
    getColumns(tableId) {
      const table = tables.get(tableId);
      if (!table) return [];
      return Array.from(table.columns.keys());
    },
    
    /**
     * Obtient le nombre de lignes d'une table
     * @param {string} tableId
     * @returns {number}
     */
    getRowCount(tableId) {
      const table = tables.get(tableId);
      if (!table) return 0;
      return table.rows.size;
    },
    
    /**
     * Récupère les métadonnées des colonnes (compatible _grist_Tables_column)
     * @returns {Promise<Array>} Tableau de {tableId, colId}
     */
    async fetchTableMetadata() {
      const result = [];
      for (const [tableId, tableData] of tables) {
        for (const [colId] of tableData.columns) {
          result.push({ tableId, colId });
        }
      }
      return result;
    }
  };
  
  // Auto-référencer docApi
  mockApi.docApi = mockApi;
  
  // Gestionnaires d'actions
  
  function handleAddTable(tableId, columns) {
    if (tables.has(tableId)) {
      // Idempotence : retourner succès si la table existe déjà
      return { id: null, tableId };
    }
    
    const tableData = {
      columns: new Map(),
      rows: new Map()
    };
    
    // Initialiser les colonnes
    for (const col of columns) {
      tableData.columns.set(col.id, []);
    }
    
    // Ajouter la colonne id implicitement
    if (!tableData.columns.has('id')) {
      tableData.columns.set('id', []);
    }
    
    tables.set(tableId, tableData);
    columnsByTable.set(tableId, tableData.columns);
    nextRowIdByTable.set(tableId, 1);
    
    // Ajouter aux métadonnées Grist
    const tableMetaId = gristTables.length + 1;
    gristTables.push({ id: tableMetaId, tableId });
    
    for (const col of columns) {
      const colMetaId = gristTablesColumn.length + 1;
      gristTablesColumn.push({
        id: colMetaId,
        parentId: tableMetaId,
        colId: col.id,
        type: col.type || 'Any',
        isFormula: col.isFormula || false
      });
    }
    
    return { id: null, tableId };
  }
  
  function handleAddColumn(tableId, colId, options) {
    const table = tables.get(tableId);
    
    if (!table) {
      throw new Error(`Table '${tableId}' not found`);
    }
    
    if (table.columns.has(colId)) {
      // Idempotence : retourner succès si la colonne existe déjà
      return { colId, tableId };
    }
    
    // Créer la colonne avec des nulls pour toutes les lignes existantes
    const rowCount = table.rows.size;
    const newColData = new Array(rowCount).fill(null);
    table.columns.set(colId, newColData);
    columnsByTable.set(tableId, table.columns);
    
    // Mettre à jour les métadonnées Grist
    const tableMeta = gristTables.find(t => t.tableId === tableId);
    if (tableMeta) {
      const colMetaId = gristTablesColumn.length + 1;
      gristTablesColumn.push({
        id: colMetaId,
        parentId: tableMeta.id,
        colId,
        type: (options && options.type) || 'Any',
        isFormula: (options && options.isFormula) || false
      });
    }
    
    return { colId, tableId };
  }
  
  function handleAddRecord(tableId, rowId, data) {
    const table = tables.get(tableId);
    
    if (!table) {
      throw new Error(`Table '${tableId}' not found`);
    }
    
    // Utiliser le compteur par table pour éviter les écrasements
    const id = rowId || nextRowIdByTable.get(tableId) || 1;
    
    // Initialiser les colonnes manquantes
    for (const key in data) {
      if (key === 'id') continue;
      if (!table.columns.has(key)) {
        const rowCount = table.rows.size;
        table.columns.set(key, new Array(rowCount).fill(null));
      }
    }
    
    // Ajouter la ligne
    const row = { ...data, id };
    table.rows.set(id, row);
    
    // Mettre à jour les colonnes - ajouter aux colonnes existantes
    for (const [colId, colData] of table.columns) {
      if (colId === 'id') {
        colData.push(id);
      } else if (data[colId] !== undefined) {
        colData.push(data[colId]);
      } else {
        colData.push(null);
      }
    }
    
    // Incrémenter le compteur pour la prochaine ligne
    nextRowIdByTable.set(tableId, id + 1);
    
    return { id };
  }
  
  function handleUpdateRecord(tableId, rowId, data) {
    const table = tables.get(tableId);
    
    if (!table) {
      throw new Error(`Table '${tableId}' not found`);
    }
    
    const row = table.rows.get(rowId);
    
    if (!row) {
      throw new Error(`Record ${rowId} not found in '${tableId}'`);
    }
    
    // Mettre à jour la ligne
    Object.assign(row, data);
    
    // Mettre à jour les colonnes - trouver l'index de la ligne dans la colonne id
    const idColumn = table.columns.get('id');
    const rowIndex = idColumn ? idColumn.indexOf(rowId) : -1;
    
    if (rowIndex === -1) {
      throw new Error(`Row ${rowId} not found in columns`);
    }
    
    // Mettre à jour chaque colonne (créer si nécessaire)
    for (const key in data) {
      if (key === 'id') continue;
      
      // Créer la colonne si elle n'existe pas
      if (!table.columns.has(key)) {
        // Initialiser avec null pour toutes les lignes existantes
        const newCol = new Array(table.rows.size).fill(null);
        table.columns.set(key, newCol);
      }
      
      const colData = table.columns.get(key);
      // Étendre la colonne si nécessaire
      while (colData.length < table.rows.size) {
        colData.push(null);
      }
      if (rowIndex < colData.length) {
        colData[rowIndex] = data[key];
      }
    }
    
    return { id: rowId };
  }
  
  function handleRemoveRecord(tableId, rowId) {
    const table = tables.get(tableId);
    
    if (!table) {
      throw new Error(`Table '${tableId}' not found`);
    }
    
    if (!table.rows.has(rowId)) {
      throw new Error(`Record ${rowId} not found in '${tableId}'`);
    }
    
    table.rows.delete(rowId);
    
    // Mettre à jour les colonnes - trouver l'index par la colonne id
    const idColumn = table.columns.get('id');
    if (idColumn) {
      const rowIndex = idColumn.indexOf(rowId);
      if (rowIndex !== -1) {
        // Supprimer cet index dans toutes les colonnes
        for (const [colId, colData] of table.columns) {
          if (colData.length > rowIndex) {
            colData.splice(rowIndex, 1);
          }
        }
      }
    }
    
    return { id: rowId };
  }
  
  function handleRenameTable(oldTableId, newTableId) {
    if (!tables.has(oldTableId)) {
      throw new Error(`Table '${oldTableId}' not found`);
    }
    
    if (tables.has(newTableId)) {
      throw new Error(`Table '${newTableId}' already exists`);
    }
    
    const tableData = tables.get(oldTableId);
    tables.delete(oldTableId);
    tables.set(newTableId, tableData);
    
    columnsByTable.delete(oldTableId);
    columnsByTable.set(newTableId, tableData.columns);
    
    return { oldTableId, newTableId };
  }
  
  function handleModifyColumn(tableId, colId, options) {
    const table = tables.get(tableId);
    
    if (!table) {
      throw new Error(`Table '${tableId}' not found`);
    }
    
    if (!table.columns.has(colId)) {
      throw new Error(`Column '${colId}' not found in '${tableId}'`);
    }
    
    // Mettre à jour le type dans les métadonnées Grist
    const tableMeta = gristTables.find(t => t.tableId === tableId);
    if (tableMeta) {
      const colMeta = gristTablesColumn.find(c => c.parentId === tableMeta.id && c.colId === colId);
      if (colMeta) {
        if (options && options.type) {
          colMeta.type = options.type;
        }
        if (options && options.isFormula !== undefined) {
          colMeta.isFormula = options.isFormula;
        }
      }
    }
    
    return { colId, tableId, modified: true };
  }
  
  return mockApi;
}

// Export
module.exports = {
  createMockGrist
};
