/* ============================================================================
 * taskflow-bootstrap.js — API unique d'initialisation du schéma TaskFlow/GENCI
 * ----------------------------------------------------------------------------
 * Ce module fournit une fonction unique `ensureGenciSchema(grist, options)` qui :
 * 1. Attend que Grist soit accessible
 * 2. Lit les métadonnées du document (Passe 0)
 * 3. Crée toutes les tables manquantes SANS colonnes Ref (Passe 1)
 * 4. Attend la stabilisation des métadonnées
 * 5. Ajoute les colonnes Ref et RefList (Passe 2)
 * 6. Ajoute les colonnes formules (Passe 3)
 * 7. Configure les Choices (Passe 4)
 * 8. Configure l'affichage des références (Passe 5)
 * 9. Vérifie le résultat final
 * 10. Seed les données de démo uniquement si tables vides
 * 
 * Résistant à la concurrence, idempotent, non destructif.
 * ============================================================================ */

(function (global) {
    'use strict';

    // Référence au schéma déclaré
    var SCHEMA = global.TASKFLOW_SCHEMA;
    var TF = global.TF;
    
    if (!SCHEMA) {
        throw new Error('TASKFLOW_SCHEMA non chargé. Charger taskflow-schema.js en premier.');
    }
    if (!TF) {
        throw new Error('TF (taskflow-core) non chargé. Charger taskflow-core.js en premier.');
    }

    // État interne pour sérialiser les appels dans une même iframe
    var bootstrapPromise = null;
    var bootstrapComplete = false;
    var maxRetries = 3;

    // Spécifications d'affichage des références (dérivé automatiquement de SCHEMA.referenceDisplays)
    var GENCI_REF_DISPLAY_SPECS = [];
    
    // Initialiser GENCI_REF_DISPLAY_SPECS à partir du schéma
    function initializeRefDisplaySpecs() {
        if (SCHEMA && SCHEMA.referenceDisplays) {
            GENCI_REF_DISPLAY_SPECS = SCHEMA.referenceDisplays.map(function(ref) {
                return {
                    table: ref.table,
                    column: ref.column,
                    visibleColId: ref.visibleColumn
                };
            });
        }
    }
    
    // Appeler l'initialisation
    initializeRefDisplaySpecs();

    // Helper : convertit un tableau colonnaire Grist en tableau d'objets
    function columnarToRows(data) {
        if (!data || Array.isArray(data)) return data || [];
        var cols = Object.keys(data);
        if (!cols.length) return [];
        var n = (data[cols[0]] && data[cols[0]].length) || 0;
        var rows = [];
        for (var i = 0; i < n; i++) {
            var rec = {};
            for (var j = 0; j < cols.length; j++) {
                rec[cols[j]] = data[cols[j]][i];
            }
            rows.push(rec);
        }
        return rows;
    }

    // Helper : log structuré
    function log(phase, data) {
        var msg = '[GENCI schema] ' + phase;
        if (typeof console !== 'undefined') {
            if (data !== undefined) {
                console.info(msg, data);
            } else {
                console.info(msg);
            }
        }
    }

    // Helper : délai
    function delay(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    // Helper : vérifie si un type est Ref ou RefList
    function isRefType(type) {
        return /^(Ref|RefList):/.test(String(type || ''));
    }

    // Helper : extrait la table cible d'un type Ref
    function getRefTarget(type) {
        var match = /^(?:Ref|RefList):(.+)$/.exec(String(type || ''));
        return match ? match[1] : null;
    }

    // ========================================================================
    // PASSE 0 — Migration et inspection
    // ========================================================================
    
    async function migrateLegacyTables(grist) {
        var migrationEntries = [];
        try {
            // Renommer Portefeuilles → Programmes si nécessaire
            var tablesData = await grist.docApi.fetchTable('_grist_Tables');
            var tables = columnarToRows(tablesData);
            var hasPortefeuilles = tables.some(function(t) { return t.tableId === 'Portefeuilles'; });
            var hasProgrammes = tables.some(function(t) { return t.tableId === 'Programmes'; });
            
            if (hasPortefeuilles && !hasProgrammes) {
                await grist.docApi.applyUserActions([['RenameTable', 'Portefeuilles', 'Programmes']]);
                migrationEntries.push('Renamed Portefeuilles → Programmes');
                log('[GENCI tables] Migration: ' + migrationEntries[0]);
            }
        } catch (e) {
            log('[GENCI tables] Migration error: ' + (e.message || e));
        }
        return migrationEntries;
    }

    async function loadSchemaMetadata(grist) {
        var tablesData = await grist.docApi.fetchTable('_grist_Tables');
        var columnsData = await grist.docApi.fetchTable('_grist_Tables_column');
        
        var tables = columnarToRows(tablesData);
        var columns = columnarToRows(columnsData);
        
        // Index par tableId
        var tableById = {};
        for (var i = 0; i < tables.length; i++) {
            tableById[tables[i].tableId] = tables[i];
        }
        
        // Index par (tableId, colId)
        var columnByKey = {};
        var columnByRowId = {};
        for (var j = 0; j < columns.length; j++) {
            var col = columns[j];
            var parentTable = tables.find(function (t) { t.id === col.parentId });
            if (parentTable) {
                var key = parentTable.tableId + '.' + col.colId;
                columnByKey[key] = col;
                columnByRowId[col.id] = col;
            }
        }
        
        return {
            tables: tables,
            columns: columns,
            tableById: tableById,
            columnByKey: columnByKey,
            columnByRowId: columnByRowId
        };
    }

    // ========================================================================
    // PASSE 1 — Création de toutes les tables (colonnes non-Ref uniquement)
    // ========================================================================
    
    // Normalise une définition de colonne pour Grist
    function normalizeColumnDefinition(column) {
        var opts = column.opts || column;
        return {
            id: column.id,
            type: opts.type || 'Text',
            isFormula: Boolean(opts.isFormula),
            formula: opts.formula || ''
        };
    }
    
    function splitColumns(columns, formulasMap, tableName) {
        var nonRefCols = [];
        var refCols = [];
        var formulaCols = [];
        
        for (var i = 0; i < columns.length; i++) {
            var col = columns[i];
            var type = col.type || (col.opts && col.opts.type);
            
            // Vérifier si c'est une formule définie
            if (formulasMap && formulasMap[tableName] && formulasMap[tableName][col.id]) {
                formulaCols.push(col);
            } else if (isRefType(type)) {
                refCols.push(col);
            } else {
                nonRefCols.push(col);
            }
        }
        
        return { nonRef: nonRefCols, ref: refCols, formula: formulaCols };
    }

    async function createTable(grist, tableId, columns, retryCount) {
        var colSpecs = columns.map(function (column) {
            var normalized = normalizeColumnDefinition(column);
            var spec = {
                id: normalized.id,
                type: normalized.type,
                isFormula: normalized.isFormula
            };
            if (normalized.isFormula && normalized.formula) {
                spec.formula = normalized.formula;
            }
            return spec;
        });
        
        // Validation avant appel Grist
        for (var i = 0; i < colSpecs.length; i++) {
            if (!colSpecs[i].id || !colSpecs[i].type) {
                throw new Error(
                    'Définition de colonne invalide pour ' + tableId +
                    ': ' + JSON.stringify(colSpecs[i])
                );
            }
        }
        
        log('[GENCI tables] Création table: ' + tableId + ' (' + colSpecs.length + ' colonnes)');
        
        try {
            await grist.docApi.applyUserActions([
                ['AddTable', tableId, colSpecs]
            ]);
            return true;
        } catch (e) {
            var msg = e.message || String(e);
            if (msg.indexOf('already exists') !== -1 && retryCount < maxRetries) {
                log('[GENCI tables] Table déjà créée, réessai ' + (retryCount + 1));
                await delay(200 * (retryCount + 1));
                return createTable(grist, tableId, columns, retryCount + 1);
            }
            throw e;
        }
    }

    async function ensureBaseTables(grist, schemaDef, formulasMap) {
        var metadata = await loadSchemaMetadata(grist);
        var created = [];
        var columnsAdded = [];
        var invalidTypes = [];
        var errors = [];
        
        for (var i = 0; i < SCHEMA.tableOrder.length; i++) {
            var tableId = SCHEMA.tableOrder[i];
            var tableDef = schemaDef.tables[tableId];
            
            if (!tableDef) continue;
            
            if (!metadata.tableById[tableId]) {
                // Table manquante : la créer
                var columns = tableDef.columns || [];
                var split = splitColumns(columns, formulasMap, tableId);
                
                // Créer avec colonnes non-Ref UNIQUEMENT (pas les formules ici)
                var baseCols = split.nonRef;
                if (baseCols.length > 0) {
                    await createTable(grist, tableId, baseCols, 0);
                    created.push(tableId);
                }
            } else {
                // Table existante : ajouter les colonnes simples manquantes
                var columns = tableDef.columns || [];
                var split = splitColumns(columns, formulasMap, tableId);
                
                for (var j = 0; j < split.nonRef.length; j++) {
                    var colDef = split.nonRef[j];
                    var key = tableId + '.' + colDef.id;
                    if (!metadata.columnByKey[key]) {
                        try {
                            await addColumn(grist, tableId, colDef, 0);
                            columnsAdded.push(key);
                        } catch (e) {
                            errors.push({
                                table: tableId,
                                column: colDef.id,
                                action: 'add',
                                error: e.message || String(e)
                            });
                        }
                    }
                }
            }
        }
        
        return { 
            created: created, 
            columnsAdded: columnsAdded,
            invalidTypes: invalidTypes,
            errors: errors 
        };
    }

    // ========================================================================
    // SYNCHRONISATION — Attendre la stabilisation des métadonnées (3 tentatives max)
    // ========================================================================
    
    async function syncMetadata(grist, expectedTables) {
        log('[GENCI sync] Attente stabilisation métadonnées (3 tentatives)...');
        
        var lastMetadata = null;
        
        for (var attempt = 0; attempt < 3; attempt++) {
            lastMetadata = await loadSchemaMetadata(grist);
            
            var missing = expectedTables.filter(function(tableId) {
                return !lastMetadata.tableById[tableId];
            });
            
            if (missing.length === 0) {
                log('[GENCI sync] Métadonnées stabilisées');
                return lastMetadata;
            }
            
            if (attempt < 2) {
                await delay(150);
            }
        }
        
        throw new Error(
            'Tables absentes après création: ' +
            expectedTables.filter(function(tableId) {
                return !lastMetadata.tableById[tableId];
            }).join(', ')
        );
    }

    // ========================================================================
    // PASSE 2 — Création et réparation des colonnes de référence
    // ========================================================================
    
    async function addColumn(grist, tableId, colDef, retryCount) {
        var normalized = normalizeColumnDefinition(colDef);
        
        log('[GENCI refs] Ajout colonne: ' + tableId + '.' + normalized.id + ' (' + normalized.type + ')');
        
        var action = ['AddColumn', tableId, normalized.id, {
            type: normalized.type,
            isFormula: normalized.isFormula
        }];
        
        if (normalized.isFormula && normalized.formula) {
            action[3].formula = normalized.formula;
        }
        
        try {
            await grist.docApi.applyUserActions([action]);
            return true;
        } catch (e) {
            var msg = e.message || String(e);
            
            // Erreurs transitoires : retry avec délai progressif
            var isTransientError = 
                msg.indexOf('already exists') !== -1 ||
                msg.indexOf('NoneType') !== -1 ||
                msg.indexOf('table_id') !== -1 ||
                msg.indexOf('table not found') !== -1 ||
                msg.indexOf('unknown table') !== -1 ||
                msg.indexOf('invalid table') !== -1;
            
            if (isTransientError && retryCount < maxRetries) {
                log('[GENCI refs] Erreur transitoire, réessai ' + (retryCount + 1) + ': ' + msg);
                await delay(300 * (retryCount + 1));
                return addColumn(grist, tableId, colDef, retryCount + 1);
            }
            
            // Après dernier essai ou erreur non transitoire : relancer l'erreur
            throw e;
        }
    }

    async function ensureRefColumns(grist, schemaDef, formulasMap) {
        var metadata = await loadSchemaMetadata(grist);
        var result = { added: [], repaired: [], errors: [] };
        
        for (var i = 0; i < SCHEMA.tableOrder.length; i++) {
            var tableId = SCHEMA.tableOrder[i];
            var tableDef = schemaDef.tables[tableId];
            
            if (!tableDef || !metadata.tableById[tableId]) continue;
            
            var columns = tableDef.columns || [];
            var split = splitColumns(columns, formulasMap, tableId);
            
            // Traiter les colonnes Ref
            for (var j = 0; j < split.ref.length; j++) {
                var colDef = split.ref[j];
                var key = tableId + '.' + colDef.id;
                var existingCol = metadata.columnByKey[key];
                
                if (!existingCol) {
                    // Colonne manquante : l'ajouter
                    try {
                        await addColumn(grist, tableId, colDef, 0);
                        result.added.push(key);
                    } catch (e) {
                        result.errors.push({
                            table: tableId,
                            column: colDef.id,
                            action: 'add',
                            error: e.message || String(e)
                        });
                    }
                } else {
                    // Colonne existante : vérifier le type
                    var expectedType = colDef.opts?.type || colDef.type;
                    var existingType = existingCol.type;
                    
                    if (existingType !== expectedType) {
                        // Type incorrect : tenter réparation
                        log('[GENCI refs] Type incorrect: ' + key + ' (attendu: ' + expectedType + ', actuel: ' + existingType + ')');
                        
                        // Vérifier que la table cible existe
                        var targetType = getRefTarget(expectedType);
                        if (targetType && metadata.tableById[targetType]) {
                            try {
                                await grist.docApi.applyUserActions([
                                    ['ModifyColumn', tableId, colDef.id, { type: expectedType }]
                                ]);
                                result.repaired.push(key);
                            } catch (e) {
                                result.errors.push({
                                    table: tableId,
                                    column: colDef.id,
                                    action: 'repair',
                                    expectedType: expectedType,
                                    actualType: existingType,
                                    error: e.message || String(e)
                                });
                            }
                        } else {
                            result.errors.push({
                                table: tableId,
                                column: colDef.id,
                                action: 'repair-skipped',
                                reason: 'Table cible non trouvée: ' + targetType
                            });
                        }
                    }
                }
            }
        }
        
        return result;
    }

    // Attend que toutes les colonnes Ref soient visibles dans les métadonnées
    async function waitForReferenceColumns(grist, schemaDef, formulasMap, options) {
        options = options || {};
        var maxAttempts = options.maxAttempts || 20;
        var baseDelay = options.baseDelay || 200;
        var attempt = 0;
        var lastMissing = [];
        var lastInvalid = [];
        
        // Construire la liste des colonnes Ref attendues
        var expectedRefs = [];
        for (var i = 0; i < SCHEMA.tableOrder.length; i++) {
            var tableId = SCHEMA.tableOrder[i];
            var tableDef = schemaDef.tables[tableId];
            if (!tableDef) continue;
            
            var columns = tableDef.columns || [];
            var split = splitColumns(columns, formulasMap, tableId);
            
            for (var j = 0; j < split.ref.length; j++) {
                var colDef = split.ref[j];
                expectedRefs.push({
                    table: tableId,
                    column: colDef.id,
                    expectedType: colDef.opts?.type || colDef.type
                });
            }
        }
        
        log('[GENCI sync] Attente des colonnes Ref (' + expectedRefs.length + ' colonnes)...');
        
        while (attempt < maxAttempts) {
            try {
                var metadata = await loadSchemaMetadata(grist);
                var missing = [];
                var invalid = [];
                
                for (var k = 0; k < expectedRefs.length; k++) {
                    var ref = expectedRefs[k];
                    var key = ref.table + '.' + ref.column;
                    var col = metadata.columnByKey[key];
                    
                    // Vérifier principalement l'existence de la colonne
                    if (!col) {
                        missing.push(key);
                    } else if (col.type !== ref.expectedType) {
                        // Types incorrects collectés mais ne bloquent pas la stabilisation
                        invalid.push({
                            key: key,
                            expected: ref.expectedType,
                            actual: col.type
                        });
                    }
                }
                
                // Sauvegarder pour le rapport final
                lastMissing = missing.slice();
                lastInvalid = invalid.slice();
                
                // Succès si toutes les colonnes existent (peu importe le type pour l'instant)
                if (missing.length === 0) {
                    log('[GENCI sync] Toutes les colonnes Ref sont présentes (' + attempt + ' tentatives)');
                    if (invalid.length > 0) {
                        log('[GENCI sync] Types incorrects détectés (seront réparés): ' + invalid.length);
                    }
                    return {
                        success: true,
                        missing: [],
                        invalid: invalid,
                        attempts: attempt + 1
                    };
                }
                
                if (missing.length > 0) {
                    log('[GENCI sync] Colonnes Ref manquantes: ' + missing.join(', '));
                }
                
            } catch (e) {
                log('[GENCI sync] Erreur de lecture métadonnées: ' + (e.message || e));
            }
            
            attempt++;
            if (attempt < maxAttempts) {
                await delay(baseDelay * Math.min(attempt, 5));
            }
        }
        
        return {
            success: false,
            error: 'Timeout après ' + attempt + ' tentatives',
            attempts: attempt,
            missing: lastMissing,
            invalid: lastInvalid
        };
    }

    // ========================================================================
    // PASSE 3 — Colonnes calculées (formules)
    // ========================================================================
    
    async function ensureFormulaColumns(grist, formulasMap) {
        var metadata = await loadSchemaMetadata(grist);
        var result = { added: [], skipped: [], errors: [] };
        
        for (var tableName in formulasMap) {
            if (!formulasMap.hasOwnProperty(tableName)) continue;
            
            var formulas = formulasMap[tableName];
            var tableMeta = metadata.tableById[tableName];
            
            if (!tableMeta) {
                result.skipped.push({ table: tableName, reason: 'Table non trouvée' });
                continue;
            }
            
            for (var colId in formulas) {
                if (!formulas.hasOwnProperty(colId)) continue;
                
                var formula = formulas[colId];
                var key = tableName + '.' + colId;
                var existingCol = metadata.columnByKey[key];
                
                if (!existingCol) {
                    // Colonne manquante : l'ajouter
                    try {
                        await grist.docApi.applyUserActions([
                            ['AddColumn', tableName, colId, {
                                type: 'Any',
                                isFormula: true,
                                formula: formula
                            }]
                        ]);
                        result.added.push(key);
                    } catch (e) {
                        result.errors.push({
                            table: tableName,
                            column: colId,
                            error: e.message || String(e)
                        });
                    }
                } else {
                    result.skipped.push({ table: tableName, column: colId, reason: 'Déjà existe' });
                }
            }
        }
        
        return result;
    }

    // ========================================================================
    // PASSE 4 — Configuration des Choices et statuts
    // ========================================================================
    
    async function configureChoiceColumns(grist, defaultChoices) {
        var result = { configured: [], skipped: [] };
        
        for (var key in defaultChoices) {
            if (!defaultChoices.hasOwnProperty(key)) continue;
            
            var parts = key.split('.');
            if (parts.length !== 2) continue;
            
            var table = parts[0];
            var column = parts[1];
            var choices = defaultChoices[key];
            
            try {
                var statusList = choices.map(function(v) {
                    return { value: v, label: v, fillColor: '#94a3b8', textColor: '#ffffff' };
                });
                
                var seedResult = await TF.seedStatusChoices(grist, table, column, statusList);
                
                if (seedResult.ok && seedResult.changed) {
                    result.configured.push(key);
                } else if (seedResult.ok && !seedResult.changed) {
                    result.skipped.push({ key: key, reason: seedResult.reason || 'Déjà configuré' });
                } else {
                    result.skipped.push({ key: key, reason: seedResult.error || 'Erreur inconnue' });
                }
            } catch (e) {
                result.skipped.push({ key: key, reason: e.message || String(e) });
            }
        }
        
        return result;
    }

    // ========================================================================
    // PASSE 5 — Configuration des colonnes visibles des références
    // ========================================================================
    
    async function configureAllRefDisplays(grist, specs) {
        log('[GENCI display] Configuration affichage références...');
        
        var result = await TF.setRefDisplayColumns(grist, specs);
        
        if (result.configured && result.configured.length > 0) {
            log('[GENCI display] Configurés: ' + result.configured.length);
        }
        if (result.alreadyCorrect && result.alreadyCorrect.length > 0) {
            log('[GENCI display] Déjà corrects: ' + result.alreadyCorrect.length);
        }
        if (result.skipped && result.skipped.length > 0) {
            log('[GENCI display] Ignorés: ' + result.skipped.length, result.skipped);
        }
        if (result.errors && result.errors.length > 0) {
            log('[GENCI display] Erreurs: ' + result.errors.length, result.errors);
        }
        
        return result;
    }

    // Helper : obtient toutes les spécifications de références depuis le schéma
    function getExpectedReferenceSpecs(schema) {
        var specs = [];
        
        for (var tableId in schema.tables) {
            if (!Object.prototype.hasOwnProperty.call(schema.tables, tableId)) {
                continue;
            }
            
            var columns = schema.tables[tableId].columns || [];
            
            for (var i = 0; i < columns.length; i++) {
                var column = columns[i];
                var opts = column.opts || column;
                var type = opts.type || '';
                
                if (/^(Ref|RefList):/.test(type)) {
                    specs.push({
                        table: tableId,
                        column: column.id,
                        expectedType: type,
                        targetTable: getRefTarget(type)
                    });
                }
            }
        }
        
        return specs;
    }
    
    // Helper : charge les colonnes réelles des tables utilisateur
    async function loadActualTableColumns(grist, tableIds) {
        var columnsByTable = {};
        var errors = [];
        
        for (var i = 0; i < tableIds.length; i++) {
            var tableId = tableIds[i];
            
            try {
                var data = await grist.docApi.fetchTable(tableId);
                columnsByTable[tableId] = new Set(Object.keys(data || {}));
            } catch (e) {
                columnsByTable[tableId] = new Set();
                errors.push({
                    table: tableId,
                    error: e.message || String(e)
                });
            }
        }
        
        return {
            columnsByTable: columnsByTable,
            errors: errors
        };
    }

    // ========================================================================
    // INSPECTION — Vérification complète du schéma
    // ========================================================================
    
    async function inspectGenciSchema(grist, requiredTables, metadataSnapshot) {
        var result = {
            ready: true,
            missingTables: [],
            missingColumns: [],
            metadataPending: [],
            invalidColumnTypes: [],
            invalidRefTargets: [],
            invalidVisibleColumns: [],
            missingFormulaColumns: []
        };
        
        try {
            // Utiliser le snapshot fourni ou charger les métadonnées
            var metadata = metadataSnapshot || await loadSchemaMetadata(grist);
            
            // Vérifier les tables essentielles
            for (var i = 0; i < requiredTables.length; i++) {
                var tableId = requiredTables[i];
                if (!metadata.tableById[tableId]) {
                    result.missingTables.push(tableId);
                    result.ready = false;
                }
            }
            
            // Vérifier TOUTES les références du schéma (pas juste 6)
            var expectedRefs = getExpectedReferenceSpecs(SCHEMA);
            
            // Charger les colonnes réelles des tables pour distinguer absent vs retardé
            var refTableIds = Array.from(new Set(expectedRefs.map(function(ref) {
                return ref.table;
            })));
            
            var actualColumns = await loadActualTableColumns(grist, refTableIds);
            
            for (var j = 0; j < expectedRefs.length; j++) {
                var ref = expectedRefs[j];
                var key = ref.table + '.' + ref.column;
                var metadataCol = metadata.columnByKey[key];
                var actualTableCols = actualColumns.columnsByTable[ref.table];
                var existsInTable = actualTableCols && actualTableCols.has(ref.column);
                
                // Cas 1 : Colonne absente des métadonnées ET de la table réelle
                if (!metadataCol && !existsInTable) {
                    result.missingColumns.push(key);
                    result.ready = false;
                    continue;
                }
                
                // Cas 2 : Colonne présente dans la table mais absente des métadonnées (retard)
                if (!metadataCol && existsInTable) {
                    result.metadataPending.push(key);
                    // Ne pas mettre ready = false, c'est temporaire
                    continue;
                }
                
                // Cas 3 : Colonne présente dans les métadonnées, vérifier le type
                if (metadataCol.type !== ref.expectedType) {
                    result.invalidColumnTypes.push({
                        column: key,
                        expected: ref.expectedType,
                        actual: metadataCol.type
                    });
                    result.ready = false;
                    
                    // Vérifier si la table cible existe
                    var targetType = ref.targetTable;
                    if (!metadata.tableById[targetType]) {
                        result.invalidRefTargets.push({
                            column: key,
                            expectedTarget: targetType
                        });
                    }
                }
            }
            
            // Vérifier les visibleCol sur TOUTES les références de SCHEMA.referenceDisplays
            var refDisplaySpecs = SCHEMA.referenceDisplays || [];
            
            for (var k = 0; k < refDisplaySpecs.length; k++) {
                var spec = refDisplaySpecs[k];
                var specKey = spec.table + '.' + spec.column;
                var specCol = metadata.columnByKey[specKey];
                
                if (!specCol) {
                    // Référence absente des métadonnées
                    if (!result.metadataPending.includes(specKey)) {
                        result.metadataPending.push(specKey);
                    }
                    continue;
                }
                
                var targetTable = getRefTarget(specCol.type);
                if (targetTable) {
                    var visColKey = targetTable + '.' + spec.visibleColId;
                    var visCol = metadata.columnByKey[visColKey];
                    
                    if (visCol) {
                        // Vérification stricte du visibleCol
                        if (Number(specCol.visibleCol) !== Number(visCol.id)) {
                            result.invalidVisibleColumns.push({
                                column: specKey,
                                expected: visCol.id,
                                actual: specCol.visibleCol
                            });
                            result.ready = false;
                        }
                    }
                }
            }
            
        } catch (e) {
            result.error = e.message || String(e);
            result.ready = false;
        }
        
        return result;
    }

    // Helper : extrait l'ID d'un enregistrement créé
    function getAddedRecordId(actionResult, label) {
        var value = Array.isArray(actionResult)
            ? actionResult[0]
            : actionResult;

        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }

        if (
            value &&
            typeof value === 'object' &&
            typeof value.id === 'number'
        ) {
            return value.id;
        }

        throw new Error(
            'ID de ligne introuvable après AddRecord' +
            (label ? ' (' + label + ')' : '') +
            ': ' + JSON.stringify(actionResult)
        );
    }

    // ========================================================================
    // SEED — Données de démonstration (UNIQUEMENT si tables vides)
    // ========================================================================
    
    async function seedInitialData(grist, context) {
        var seedEntries = [];
        context = context || {};
        
        try {
            // Vérifier si Tasks est vide
            var tasksData = await grist.docApi.fetchTable('Tasks');
            var tasksCount = (tasksData && tasksData.id && tasksData.id.length) || 0;
            
            if (tasksCount > 0) {
                log('[GENCI seed] Tables non vides (' + tasksCount + ' tasks) — seed ignoré');
                return { seeded: false, reason: 'Tables non vides' };
            }
            
            log('[GENCI seed] Tables vides — création données de démonstration...');
            
            // Créer les données dans l'ordre de dépendance
            var createdIds = {};
            
            // 1. Entités
            if (context.tablesCreated && context.tablesCreated.indexOf('Entites') !== -1) {
                var entiteRacine = await grist.docApi.applyUserActions([
                    ['AddRecord', 'Entites', null, { nom: 'Direction', niveau: 'direction', actif: true }]
                ]);
                createdIds.Entites = { racine: getAddedRecordId(entiteRacine, 'Entites.Direction') };
                
                var entiteDev = await grist.docApi.applyUserActions([
                    ['AddRecord', 'Entites', null, { nom: 'Développement', parent: createdIds.Entites.racine, niveau: 'service', actif: true }]
                ]);
                createdIds.Entites.dev = getAddedRecordId(entiteDev, 'Entites.Développement');
                
                seedEntries.push('Créé: Entités (2)');
            }
            
            // 2. Team
            if (context.tablesCreated && context.tablesCreated.indexOf('Team') !== -1) {
                var member1 = await grist.docApi.applyUserActions([
                    ['AddRecord', 'Team', null, { nom: 'Alice Martin', role: 'chef_de_projet', actif: true }]
                ]);
                createdIds.Team = { alice: getAddedRecordId(member1, 'Team.Alice') };
                
                var member2 = await grist.docApi.applyUserActions([
                    ['AddRecord', 'Team', null, { nom: 'Bob Durant', role: 'membre', actif: true }]
                ]);
                createdIds.Team.bob = getAddedRecordId(member2, 'Team.Bob');
                
                // Mettre à jour les références
                if (createdIds.Entites && createdIds.Entites.dev) {
                    await grist.docApi.applyUserActions([
                        ['UpdateRecord', 'Team', createdIds.Team.alice, { entite: createdIds.Entites.dev }],
                        ['UpdateRecord', 'Team', createdIds.Team.bob, { entite: createdIds.Entites.dev, responsable: createdIds.Team.alice }]
                    ]);
                }
                
                seedEntries.push('Créé: Team (2)');
            }
            
            // 3. Programmes
            if (context.tablesCreated && context.tablesCreated.indexOf('Programmes') !== -1) {
                var programme = await grist.docApi.applyUserActions([
                    ['AddRecord', 'Programmes', null, { nom: 'Transformation Digitale', couleur: '#4f46e5', actif: true }]
                ]);
                createdIds.Programmes = { digital: getAddedRecordId(programme, 'Programmes.Transformation') };
                seedEntries.push('Créé: Programmes (1)');
            }
            
            // 4. Competences
            if (context.tablesCreated && context.tablesCreated.indexOf('Competences') !== -1) {
                await grist.docApi.applyUserActions([
                    ['AddRecord', 'Competences', null, { nom: 'JavaScript', categorie: 'technique', actif: true }],
                    ['AddRecord', 'Competences', null, { nom: 'Python', categorie: 'technique', actif: true }],
                    ['AddRecord', 'Competences', null, { nom: 'Gestion de projet', categorie: 'fonctionnel', actif: true }]
                ]);
                seedEntries.push('Créé: Competences (3)');
            }
            
            // 5. KanbanSteps
            if (context.tablesCreated && context.tablesCreated.indexOf('KanbanSteps') !== -1) {
                await grist.docApi.applyUserActions([
                    ['AddRecord', 'KanbanSteps', null, { nom: 'À faire', valeur: 'todo', couleur: '#94a3b8', ordre: 0, actif: true }],
                    ['AddRecord', 'KanbanSteps', null, { nom: 'En cours', valeur: 'inprogress', couleur: '#f59e0b', ordre: 1, actif: true }],
                    ['AddRecord', 'KanbanSteps', null, { nom: 'En revue', valeur: 'review', couleur: '#3b82f6', ordre: 2, actif: true }],
                    ['AddRecord', 'KanbanSteps', null, { nom: 'Terminé', valeur: 'done', couleur: '#10b981', ordre: 3, actif: true }]
                ]);
                seedEntries.push('Créé: KanbanSteps (4)');
            }
            
            return { seeded: true, ids: createdIds, log: seedEntries };
            
        } catch (e) {
            log('[GENCI seed] Erreur: ' + (e.message || e));
            return { seeded: false, error: e.message || String(e) };
        }
    }

    // ========================================================================
    // ORCHESTRATEUR PRINCIPAL
    // ========================================================================
    
    async function ensureGenciSchema(grist, options) {
        options = options || {};
        
        // Sérialise les appels dans une même iframe
        if (bootstrapPromise) {
            return bootstrapPromise;
        }
        
        if (bootstrapComplete && !options.force) {
            return Promise.resolve({ success: true, alreadyComplete: true });
        }
        
        bootstrapPromise = (async function () {
            var startTime = Date.now();
            var globalLog = [];
            var result = {
                success: false,
                phases: {},
                errors: [],
                warnings: []
            };
            
            try {
                log('Démarrage initialisation...');
                
                // Phase 0 : Exécuter les migrations puis inspection
                log('Phase 0: Migrations...');
                var migrationLog = await migrateLegacyTables(grist);
                globalLog = globalLog.concat(migrationLog);
                
                // Exécuter les migrations versionnées si TaskFlowMigrations est disponible
                if (global.TaskFlowMigrations) {
                    try {
                        var currentVersion = await global.TaskFlowMigrations.getCurrentVersion(grist);
                        log('Version actuelle du schéma: v' + currentVersion);
                        
                        var migrationResult = await global.TaskFlowMigrations.runMigrations(grist, currentVersion);
                        
                        if (migrationResult.success) {
                            log('Migrations appliquées: ' + migrationResult.applied + ' migrations, version finale: v' + migrationResult.finalVersion);
                            globalLog.push('Migrations: v' + currentVersion + ' → v' + migrationResult.finalVersion);
                            result.phases.migrations = migrationResult;
                        } else {
                            result.warnings.push({ phase: 'migrations', message: 'Certaines migrations ont échoué' });
                        }
                    } catch (migrationError) {
                        log('Erreur lors des migrations: ' + (migrationError.message || migrationError));
                        result.warnings.push({ phase: 'migrations', error: migrationError.message || String(migrationError) });
                        // Continuer malgré tout, le schéma déclaratif réparera
                    }
                }
                
                result.phases.migration = migrationLog;
                
                // Phase 1 : Création des tables (sans Ref)
                log('Phase 1: Création tables...');
                var phase1 = await ensureBaseTables(grist, SCHEMA, options.formulasMap || {});
                globalLog.push('Tables créées: ' + phase1.created.join(', '));
                result.phases.tables = phase1;
                
                // Synchronisation
                var allExpectedTables = SCHEMA.tableOrder.slice();
                var metadata = await syncMetadata(grist, allExpectedTables);
                result.phases.sync = { success: true };
                
                // Phase 2 : Colonnes Ref
                log('Phase 2: Colonnes Ref...');
                var phase2 = await ensureRefColumns(grist, SCHEMA, options.formulasMap || {});
                globalLog.push('Ref ajoutées: ' + phase2.added.join(', '));
                if (phase2.repaired.length > 0) {
                    globalLog.push('Ref réparées: ' + phase2.repaired.join(', '));
                }
                
                // Vérifier les erreurs de création des Ref
                if (phase2.errors.length > 0) {
                    result.errors.push({
                        phase: 'refs',
                        errors: phase2.errors
                    });
                    result.success = false;
                    log('Échec création des colonnes Ref, arrêt de l\'initialisation');
                    return result;
                }
                
                result.phases.refs = phase2;
                
                // Phase 2 : Colonnes Ref terminées (succès des AddColumn = confirmation)
                log('Phase 2: Colonnes Ref terminées (' + phase2.added.length + ' créées)');
                result.phases.refs = phase2;
                
                // Petite pause pour stabilisation Grist avant formules
                await delay(500);
                
                // Phase 3 : Formules
                if (options.formulasMap && Object.keys(options.formulasMap).length > 0) {
                    log('Phase 3: Formules...');
                    var phase3 = await ensureFormulaColumns(grist, options.formulasMap);
                    globalLog.push('Formules ajoutées: ' + phase3.added.join(', '));
                    result.phases.formulas = phase3;
                }
                
                // Phase 4 : Choices
                log('Phase 4: Choices...');
                var phase4 = await configureChoiceColumns(grist, options.defaultChoices || {});
                result.phases.choices = phase4;
                
                // Phase 5 : Affichage des références
                log('Phase 5: Affichage références...');
                var phase5 = await configureAllRefDisplays(grist, GENCI_REF_DISPLAY_SPECS);
                result.phases.display = phase5;
                
                if (!phase5.ok) {
                    result.warnings.push({ phase: 'display', errors: phase5.errors });
                }
                
                // Phase 6 : Seed (seulement si demandé explicitement)
                if (options.seedDemo === true) {
                    log('Phase 6: Seed de démonstration...');
                    var seedContext = { tablesCreated: phase1.created };
                    var phase6 = await seedInitialData(grist, seedContext);
                    result.phases.seed = phase6;
                    if (phase6.seeded) {
                        globalLog = globalLog.concat(phase6.log || []);
                    }
                    if (phase6.error) {
                        result.errors.push({ phase: 'seed', error: phase6.error });
                    }
                } else {
                    result.phases.seed = {
                        seeded: false,
                        reason: 'Seed de démonstration désactivé (options.seedDemo !== true)'
                    };
                }
                
                // Vérification finale
                log('Vérification finale...');
                
                // Délai de stabilisation avant validation
                await delay(300);
                
                // Relire les métadonnées fraîches
                metadata = await loadSchemaMetadata(grist);
                
                var requiredTables = ['Team', 'Programmes', 'Entites', 'Projects', 'Tasks', 'Actions'];
                var inspection = await inspectGenciSchema(grist, requiredTables, metadata);
                
                if (!inspection.ready) {
                    result.errors.push({
                        phase: 'validation',
                        missingTables: inspection.missingTables,
                        missingColumns: inspection.missingColumns,
                        invalidTypes: inspection.invalidColumnTypes
                    });
                    
                    // Ne pas considérer comme échec total si ce sont juste des visibleCol ou metadataPending
                    if (inspection.missingTables.length === 0 && inspection.missingColumns.length === 0) {
                        result.success = true;
                        result.warnings.push({ phase: 'validation', details: inspection });
                    } else {
                        result.success = false;
                    }
                } else {
                    result.success = true;
                }
                
                // Afficher le détail de la validation
                console.info(
                    '[GENCI validation]',
                    JSON.stringify({
                        ready: inspection.ready,
                        missingTables: inspection.missingTables,
                        missingColumns: inspection.missingColumns,
                        metadataPending: inspection.metadataPending,
                        invalidColumnTypes: inspection.invalidColumnTypes.length,
                        invalidRefTargets: inspection.invalidRefTargets.length,
                        invalidVisibleColumns: inspection.invalidVisibleColumns.length
                    }, null, 2)
                );
                
                // Afficher les warnings techniques
                if (result.warnings && result.warnings.length > 0) {
                    console.warn('[GENCI] Warnings:', result.warnings);
                }
                
                // Afficher les erreurs si échec
                if (!result.success && result.errors && result.errors.length > 0) {
                    console.error('[GENCI] Errors:', JSON.stringify(result.errors, null, 2));
                }
                
                // bootstrapComplete seulement si succès
                bootstrapComplete = result.success === true;
                var duration = Date.now() - startTime;
                log('Initialisation terminée (' + duration + 'ms)');
                result.duration = duration;
                result.log = globalLog;
                
                return result;
                
            } catch (e) {
                log('Échec initialisation: ' + (e.message || e));
                result.errors.push({ phase: 'global', error: e.message || String(e) });
                result.success = false;
                bootstrapComplete = false;
                throw e;
            } finally {
                bootstrapPromise = null;
            }
        })();
        
        return bootstrapPromise;
    }

    // Ancienne API pour compatibilité
    async function ensureSchema(grist, options) {
        return ensureGenciSchema(grist, options);
    }

    // Export public
    global.TaskFlowBootstrap = {
        ensureSchema: ensureSchema,
        ensureGenciSchema: ensureGenciSchema,
        inspectGenciSchema: inspectGenciSchema,
        loadSchemaMetadata: loadSchemaMetadata,
        reset: function () {
            bootstrapPromise = null;
            bootstrapComplete = false;
        },
        GENCI_REF_DISPLAY_SPECS: GENCI_REF_DISPLAY_SPECS
    };

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
