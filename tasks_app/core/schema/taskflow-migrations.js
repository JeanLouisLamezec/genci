/* ============================================================================
 * taskflow-migrations.js — Migrations versionnées du schéma TaskFlow
 * ----------------------------------------------------------------------------
 * Ce module gère les évolutions du schéma de manière contrôlée et réversible.
 * Chaque migration est :
 * - Idempotente (peut être réexécutée sans effet secondaire)
 * - Non destructive (ne supprime jamais de données)
 * - Testable indépendamment
 * 
 * Version 1: Schéma de base
 * Version 2: TaskAssignments + extension quotidienne de TimeEntries
 * Version 3: MemberDailyCapacities + TimeEntries.capaciteJour
 * ============================================================================ */

(function (global) {
    'use strict';

    var SCHEMA = global.TASKFLOW_SCHEMA;
    var DEFAULT_WEEKLY_CAPACITY = 35;

    // Helper : délai
    function delay(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    // Helper : log
    function log(msg, data) {
        var prefix = '[TaskFlow Migration] ';
        if (typeof console !== 'undefined') {
            if (data !== undefined) {
                console.info(prefix + msg, data);
            } else {
                console.info(prefix + msg);
            }
        }
    }

    // Helper : convertir tableau colonnaire en lignes
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

    // Helper : obtenir docApi normalisé
    function getDocApi(grist) {
        var docApi = grist && (grist.docApi || grist);
        if (!docApi || typeof docApi.fetchTable !== 'function' || typeof docApi.applyUserActions !== 'function') {
            throw new Error('INVALID_GRIST_DOC_API: grist.docApi doit exposer fetchTable et applyUserActions');
        }
        return docApi;
    }

    // Helper : charger les métadonnées
    async function loadMigrationMetadata(grist) {
        var docApi = getDocApi(grist);
        var tablesData = await docApi.fetchTable('_grist_Tables');
        var columnsData = await docApi.fetchTable('_grist_Tables_column');
        
        var tables = columnarToRows(tablesData);
        var columns = columnarToRows(columnsData);
        
        var tableById = {};
        for (var i = 0; i < tables.length; i++) {
            tableById[tables[i].id] = tables[i].tableId;
        }
        
        var columnsByKey = {};
        for (var j = 0; j < columns.length; j++) {
            var col = columns[j];
            var tableId = tableById[col.parentId];
            if (tableId) {
                var key = tableId + '.' + col.colId;
                columnsByKey[key] = {
                    tableId: tableId,
                    colId: col.colId,
                    type: col.type,
                    isFormula: col.isFormula,
                    parentId: col.parentId
                };
            }
        }
        
        var tablesByName = {};
        for (var k = 0; k < tables.length; k++) {
            tablesByName[tables[k].tableId] = tables[k];
        }
        
        return {
            tablesById: tableById,
            tablesByName: tablesByName,
            columnsByKey: columnsByKey
        };
    }

    // ========================================================================
    // MIGRATION V1 → V2 — Planning daily assignments
    // ========================================================================
    
    async function migrateToV2(grist, metadata) {
        log('Migration v1 → v2: planning-daily-assignments-v2');
        
        var docApi = getDocApi(grist);
        var actions = [];
        var existingTables = metadata.tablesByName || {};
        var existingColumns = metadata.columnsByKey || {};
        
        // 1. Créer TaskAssignments si elle n'existe pas
        if (!existingTables['TaskAssignments']) {
            log('Création de la table TaskAssignments');
            actions.push(['AddTable', 'TaskAssignments', [
                { id: 'tache', type: 'Ref:Tasks', isFormula: false },
                { id: 'membre', type: 'Ref:Team', isFormula: false },
                { id: 'heuresAllouees', type: 'Numeric', isFormula: false },
                { id: 'dateDebut', type: 'Date', isFormula: false },
                { id: 'dateFin', type: 'Date', isFormula: false },
                { id: 'modeRepartition', type: 'Choice', isFormula: false },
                { id: 'actif', type: 'Bool', isFormula: false },
                { id: 'commentaire', type: 'Text', isFormula: false }
            ]]);
        } else {
            log('TaskAssignments existe déjà');
        }
        
        // 2. Vérifier et ajouter les colonnes manquantes de TaskAssignments
        var taskAssignmentsCols = ['tache', 'membre', 'heuresAllouees', 'dateDebut', 'dateFin', 'modeRepartition', 'actif', 'commentaire'];
        for (var i = 0; i < taskAssignmentsCols.length; i++) {
            var colId = taskAssignmentsCols[i];
            var key = 'TaskAssignments.' + colId;
            if (!existingColumns[key]) {
                log('Ajout de la colonne TaskAssignments.' + colId);
                var colType = colId === 'tache' || colId === 'membre' ? 'Ref' : 
                              colId === 'heuresAllouees' ? 'Numeric' :
                              colId === 'dateDebut' || colId === 'dateFin' ? 'Date' :
                              colId === 'modeRepartition' ? 'Choice' :
                              colId === 'actif' ? 'Bool' : 'Text';
                actions.push(['AddColumn', 'TaskAssignments', colId, {
                    type: colType,
                    isFormula: false
                }]);
            }
        }
        
        // 3. Ajouter les colonnes v2 manquantes à TimeEntries
        var timeEntriesCols = [
            { id: 'affectation', type: 'Ref:TaskAssignments' },
            { id: 'heuresPrevues', type: 'Numeric' },
            { id: 'capaciteTheorique', type: 'Numeric' },
            { id: 'capaciteDisponible', type: 'Numeric' },
            { id: 'feuille', type: 'Ref:Feuilles' },
            { id: 'revisionPlan', type: 'Int' }
        ];
        
        for (var j = 0; j < timeEntriesCols.length; j++) {
            var colDef = timeEntriesCols[j];
            var key = 'TimeEntries.' + colDef.id;
            if (!existingColumns[key]) {
                log('Ajout de la colonne TimeEntries.' + colDef.id);
                actions.push(['AddColumn', 'TimeEntries', colDef.id, {
                    type: colDef.type,
                    isFormula: false
                }]);
            } else {
                log('TimeEntries.' + colDef.id + ' existe déjà');
            }
        }
        
        // Appliquer les actions si nécessaire
        if (actions.length > 0) {
            await docApi.applyUserActions(actions);
            log('Migration v2 appliquée avec succès: ' + actions.length + ' actions');
            
            // Relire les métadonnées après écriture
            metadata = await loadMigrationMetadata(grist);
        } else {
            log('Aucune action nécessaire, migration déjà appliquée');
        }
        
        return { 
            success: true, 
            message: 'Migration v2 appliquée',
            actionsExecuted: actions.length,
            metadata: metadata
        };
    }

    // ========================================================================
    // MIGRATION V2 → V3 — Member daily capacities
    // ========================================================================
    
    async function migrateToV3(grist, metadata) {
        log('Migration v2 → v3: member-daily-capacities-v3');
        
        var docApi = getDocApi(grist);
        var actions = [];
        var existingTables = metadata.tablesByName || {};
        var existingColumns = metadata.columnsByKey || {};
        
        // 1. Créer MemberDailyCapacities si elle n'existe pas
        if (!existingTables['MemberDailyCapacities']) {
            log('Création de la table MemberDailyCapacities');
            actions.push(['AddTable', 'MemberDailyCapacities', [
                { id: 'membre', type: 'Ref:Team', isFormula: false },
                { id: 'date', type: 'Date', isFormula: false },
                { id: 'capaciteTheorique', type: 'Numeric', isFormula: false },
                { id: 'disponibiliteRatio', type: 'Numeric', isFormula: false },
                { id: 'capaciteDisponible', type: 'Numeric', isFormula: false },
                { id: 'absenceHeures', type: 'Numeric', isFormula: false },
                { id: 'source', type: 'Choice', isFormula: false },
                { id: 'revision', type: 'Int', isFormula: false },
                { id: 'sourceUpdatedAt', type: 'DateTime', isFormula: false },
                { id: 'commentaire', type: 'Text', isFormula: false }
            ]]);
        } else {
            log('MemberDailyCapacities existe déjà');
        }
        
        // 2. Vérifier et ajouter les colonnes manquantes de MemberDailyCapacities
        var memberDailyCapCols = [
            { id: 'membre', type: 'Ref:Team' },
            { id: 'date', type: 'Date' },
            { id: 'capaciteTheorique', type: 'Numeric' },
            { id: 'disponibiliteRatio', type: 'Numeric' },
            { id: 'capaciteDisponible', type: 'Numeric' },
            { id: 'absenceHeures', type: 'Numeric' },
            { id: 'source', type: 'Choice' },
            { id: 'revision', type: 'Int' },
            { id: 'sourceUpdatedAt', type: 'DateTime' },
            { id: 'commentaire', type: 'Text' }
        ];
        
        for (var i = 0; i < memberDailyCapCols.length; i++) {
            var colDef = memberDailyCapCols[i];
            var key = 'MemberDailyCapacities.' + colDef.id;
            if (!existingColumns[key]) {
                log('Ajout de la colonne MemberDailyCapacities.' + colDef.id);
                actions.push(['AddColumn', 'MemberDailyCapacities', colDef.id, {
                    type: colDef.type,
                    isFormula: false
                }]);
            }
        }
        
        // 3. Ajouter TimeEntries.capaciteJour
        var key = 'TimeEntries.capaciteJour';
        if (!existingColumns[key]) {
            log('Ajout de la colonne TimeEntries.capaciteJour');
            actions.push(['AddColumn', 'TimeEntries', 'capaciteJour', {
                type: 'Ref:MemberDailyCapacities',
                isFormula: false
            }]);
        } else {
            log('TimeEntries.capaciteJour existe déjà');
        }
        
        // Appliquer les actions si nécessaire
        if (actions.length > 0) {
            await docApi.applyUserActions(actions);
            log('Migration v3 appliquée avec succès: ' + actions.length + ' actions');
            
            // Relire les métadonnées après écriture
            metadata = await loadMigrationMetadata(grist);
        } else {
            log('Aucune action nécessaire, migration déjà appliquée');
        }
        
        return { 
            success: true, 
            message: 'Migration v3 appliquée',
            actionsExecuted: actions.length,
            metadata: metadata
        };
    }

    // ========================================================================
    // LISTE DES MIGRATIONS
    // ========================================================================
    
    var MIGRATIONS = [
        {
            version: 2,
            name: 'planning-daily-assignments-v2',
            description: 'Création de TaskAssignments et extension de TimeEntries',
            run: migrateToV2
        },
        {
            version: 3,
            name: 'member-daily-capacities-v3',
            description: 'Création de MemberDailyCapacities et TimeEntries.capaciteJour',
            run: migrateToV3
        }
    ];

    // ========================================================================
    // API PUBLIQUE
    // ========================================================================

    // Lit la version actuelle installée
    async function getCurrentVersion(grist) {
        var docApi = getDocApi(grist);
        try {
            var meta = await docApi.fetchTable('TaskFlow_Meta');
            var rows = columnarToRows(meta);
            if (rows && rows.length > 0) {
                return rows[0].schemaVersion || 1;
            }
            return 1;
        } catch (e) {
            return 1; // Pas de table meta = version 1
        }
    }

    // Calcule les migrations à appliquer
    function getPendingMigrations(currentVersion) {
        var pending = [];
        var targetVersion = SCHEMA ? SCHEMA.version : 3;
        
        for (var i = 0; i < MIGRATIONS.length; i++) {
            var migration = MIGRATIONS[i];
            if (migration.version > currentVersion && migration.version <= targetVersion) {
                pending.push(migration);
            }
        }
        return pending;
    }

    // Exécute toutes les migrations en attente
    async function runMigrations(grist, currentVersion, options) {
        options = options || {};
        var nowUnixSeconds = options.nowUnixSeconds || Math.floor(Date.now() / 1000);
        
        var pending = getPendingMigrations(currentVersion);
        
        if (pending.length === 0) {
            log('Aucune migration en attente');
            return {
                success: true,
                applied: 0,
                message: 'Schéma à jour',
                finalVersion: currentVersion
            };
        }
        
        log('Migrations en attente: ' + pending.length, pending.map(function (m) { return m.name; }));
        
        var results = [];
        var metadata = null;
        var lastSuccessfulVersion = currentVersion;
        var docApi = getDocApi(grist);
        
        for (var i = 0; i < pending.length; i++) {
            var migration = pending[i];
            
            try {
                log('Application migration: ' + migration.name + ' (v' + migration.version + ')');
                
                // Relit les métadonnées avant chaque migration
                try {
                    metadata = await loadMigrationMetadata(grist);
                } catch (e) {
                    metadata = { tablesByName: {}, columnsByKey: {} };
                }
                
                // Exécute la migration
                var result = await migration.run(grist, metadata);
                
                if (!result || !result.success) {
                    throw new Error('Migration échouée: ' + migration.name);
                }
                
                results.push({
                    version: migration.version,
                    name: migration.name,
                    success: true,
                    message: result.message
                });
                
                // Met à jour la version courante après succès
                lastSuccessfulVersion = migration.version;
                
                // Mettre à jour TaskFlow_Meta
                await updateSchemaVersion(grist, lastSuccessfulVersion, migration.name, nowUnixSeconds);
                
                log('Migration appliquée: ' + migration.name + ' - version mise à jour: ' + lastSuccessfulVersion);
                
                // Petit délai entre les migrations
                await delay(100);
                
            } catch (e) {
                log('Échec migration: ' + migration.name, e);
                
                results.push({
                    version: migration.version,
                    name: migration.name,
                    success: false,
                    error: e.message || String(e)
                });
                
                // Met à jour les métadonnées avec l'erreur
                try {
                    await updateMigrationError(grist, migration.name, e.message || String(e), nowUnixSeconds);
                } catch (updateError) {
                    log('Erreur lors de la mise à jour de l\'erreur: ' + updateError);
                }
                
                // Arrête au premier échec
                throw new Error('Migration échouée à v' + migration.version + ': ' + (e.message || e));
            }
        }
        
        return {
            success: true,
            applied: pending.length,
            results: results,
            finalVersion: lastSuccessfulVersion
        };
    }
    
    // Met à jour la version du schéma dans TaskFlow_Meta
    async function updateSchemaVersion(grist, version, migrationName, nowUnixSeconds) {
        var docApi = getDocApi(grist);
        nowUnixSeconds = nowUnixSeconds || Math.floor(Date.now() / 1000);
        
        try {
            var meta = await docApi.fetchTable('TaskFlow_Meta');
            var rows = columnarToRows(meta);
            
            if (rows && rows.length > 0) {
                // Mettre à jour l'enregistrement existant
                var rowId = meta.id ? meta.id[0] : rows[0].id;
                await docApi.applyUserActions([
                    ['UpdateRecord', 'TaskFlow_Meta', rowId, {
                        schemaVersion: version,
                        lastMigration: migrationName,
                        lastMigrationAt: nowUnixSeconds,
                        lastError: null
                    }]
                ]);
            } else {
                // Créer un nouvel enregistrement
                await docApi.applyUserActions([
                    ['AddRecord', 'TaskFlow_Meta', null, {
                        schemaVersion: version,
                        lastMigration: migrationName,
                        lastMigrationAt: nowUnixSeconds,
                        installationStatus: 'migrated'
                    }]
                ]);
            }
        } catch (e) {
            log('Erreur lors de la mise à jour de TaskFlow_Meta: ' + (e.message || e));
            throw e; // Propager l'erreur pour que la migration échoue
        }
    }
    
    // Met à jour l'erreur de migration dans TaskFlow_Meta
    async function updateMigrationError(grist, migrationName, errorMessage, nowUnixSeconds) {
        var docApi = getDocApi(grist);
        nowUnixSeconds = nowUnixSeconds || Math.floor(Date.now() / 1000);
        
        try {
            var meta = await docApi.fetchTable('TaskFlow_Meta');
            var rows = columnarToRows(meta);
            
            if (rows && rows.length > 0) {
                var rowId = meta.id ? meta.id[0] : rows[0].id;
                await docApi.applyUserActions([
                    ['UpdateRecord', 'TaskFlow_Meta', rowId, {
                        lastError: errorMessage,
                        lastMigration: migrationName,
                        lastMigrationAt: nowUnixSeconds
                    }]
                ]);
            }
        } catch (e) {
            log('Erreur lors de la mise à jour de l\'erreur: ' + (e.message || e));
        }
    }

    // Export public
    global.TaskFlowMigrations = {
        getCurrentVersion: getCurrentVersion,
        getPendingMigrations: getPendingMigrations,
        runMigrations: runMigrations,
        MIGRATIONS: MIGRATIONS,
        updateSchemaVersion: updateSchemaVersion,
        updateMigrationError: updateMigrationError,
        loadMigrationMetadata: loadMigrationMetadata
    };
    
    // Export CommonJS pour Jest
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = global.TaskFlowMigrations;
    }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
