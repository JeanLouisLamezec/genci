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
 * Version 4: Fondation du workflow de validation des feuilles de temps
 * Version 5: Rattachement des entrées de temps aux feuilles hebdomadaires
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
                    formula: col.formula || '',
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
            // Marquer les colonnes comme créées pour éviter de les recréer
            existingTables['TaskAssignments'] = { id: null };
            existingColumns['TaskAssignments.tache'] = { type: 'Ref:Tasks' };
            existingColumns['TaskAssignments.membre'] = { type: 'Ref:Team' };
            existingColumns['TaskAssignments.heuresAllouees'] = { type: 'Numeric' };
            existingColumns['TaskAssignments.dateDebut'] = { type: 'Date' };
            existingColumns['TaskAssignments.dateFin'] = { type: 'Date' };
            existingColumns['TaskAssignments.modeRepartition'] = { type: 'Choice' };
            existingColumns['TaskAssignments.actif'] = { type: 'Bool' };
            existingColumns['TaskAssignments.commentaire'] = { type: 'Text' };
        } else {
            log('TaskAssignments existe déjà');
        }
        
        // 2. Vérifier et ajouter les colonnes manquantes de TaskAssignments
        var taskAssignmentsCols = [
            { id: 'tache', type: 'Ref:Tasks' },
            { id: 'membre', type: 'Ref:Team' },
            { id: 'heuresAllouees', type: 'Numeric' },
            { id: 'dateDebut', type: 'Date' },
            { id: 'dateFin', type: 'Date' },
            { id: 'modeRepartition', type: 'Choice' },
            { id: 'actif', type: 'Bool' },
            { id: 'commentaire', type: 'Text' }
        ];
        for (var i = 0; i < taskAssignmentsCols.length; i++) {
            var colDef = taskAssignmentsCols[i];
            var key = 'TaskAssignments.' + colDef.id;
            if (!existingColumns[key]) {
                log('Ajout de la colonne TaskAssignments.' + colDef.id);
                actions.push(['AddColumn', 'TaskAssignments', colDef.id, {
                    type: colDef.type,
                    isFormula: false
                }]);
                existingColumns[key] = { type: colDef.type };
            } else {
                log('TaskAssignments.' + colDef.id + ' existe déjà');
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
                existingColumns[key] = { type: colDef.type };
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
            // Marquer les colonnes comme créées pour éviter de les recréer
            existingTables['MemberDailyCapacities'] = { id: null };
            existingColumns['MemberDailyCapacities.membre'] = { type: 'Ref:Team' };
            existingColumns['MemberDailyCapacities.date'] = { type: 'Date' };
            existingColumns['MemberDailyCapacities.capaciteTheorique'] = { type: 'Numeric' };
            existingColumns['MemberDailyCapacities.disponibiliteRatio'] = { type: 'Numeric' };
            existingColumns['MemberDailyCapacities.capaciteDisponible'] = { type: 'Numeric' };
            existingColumns['MemberDailyCapacities.absenceHeures'] = { type: 'Numeric' };
            existingColumns['MemberDailyCapacities.source'] = { type: 'Choice' };
            existingColumns['MemberDailyCapacities.revision'] = { type: 'Int' };
            existingColumns['MemberDailyCapacities.sourceUpdatedAt'] = { type: 'DateTime' };
            existingColumns['MemberDailyCapacities.commentaire'] = { type: 'Text' };
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
                existingColumns[key] = { type: colDef.type };
            } else {
                log('MemberDailyCapacities.' + colDef.id + ' existe déjà');
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
            existingColumns[key] = { type: 'Ref:MemberDailyCapacities' };
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
    // MIGRATION V3 → V4 — Fondation du workflow de validation
    // ========================================================================
    
    async function migrateToV4(grist, metadata) {
        log('Migration v3 → v4: timesheet-validation-foundation-v4');
        
        var docApi = getDocApi(grist);
        var actions = [];
        var existingTables = metadata.tablesByName || {};
        var existingColumns = metadata.columnsByKey || {};
        var errors = [];
        
        // 1. Ajouter les colonnes simples manquantes de Feuilles
        var feuillesCols = [
            { id: 'responsableValidation', type: 'Ref:Team' },
            { id: 'soumisPar', type: 'Ref:Team' },
            { id: 'dateSoumission', type: 'DateTime' },
            { id: 'revisionValidation', type: 'Int' },
            { id: 'motifCorrection', type: 'Text' }
        ];
        
        for (var i = 0; i < feuillesCols.length; i++) {
            var colDef = feuillesCols[i];
            var key = 'Feuilles.' + colDef.id;
            if (!existingColumns[key]) {
                log('Ajout de la colonne Feuilles.' + colDef.id);
                actions.push(['AddColumn', 'Feuilles', colDef.id, {
                    type: colDef.type,
                    isFormula: false
                }]);
                existingColumns[key] = { type: colDef.type };
            } else {
                // Vérifier le type
                var existingCol = existingColumns[key];
                if (existingCol.type !== colDef.type) {
                    errors.push({
                        column: key,
                        expectedType: colDef.type,
                        actualType: existingCol.type,
                        issue: 'TYPE_MISMATCH'
                    });
                }
                log('Feuilles.' + colDef.id + ' existe déjà (type: ' + existingCol.type + ')');
            }
        }
        
        // 2. Ajouter les colonnes simples de TaskFlow_Meta pour les ACL
        var metaCols = [
            { id: 'aclVersion', type: 'Int' },
            { id: 'aclStatus', type: 'Choice' },
            { id: 'lastAclMigration', type: 'Text' },
            { id: 'lastAclMigrationAt', type: 'DateTime' },
            { id: 'lastAclError', type: 'Text' }
        ];
        
        for (var j = 0; j < metaCols.length; j++) {
            var colDef = metaCols[j];
            var key = 'TaskFlow_Meta.' + colDef.id;
            if (!existingColumns[key]) {
                log('Ajout de la colonne TaskFlow_Meta.' + colDef.id);
                actions.push(['AddColumn', 'TaskFlow_Meta', colDef.id, {
                    type: colDef.type,
                    isFormula: false
                }]);
                existingColumns[key] = { type: colDef.type };
            } else {
                var existingCol = existingColumns[key];
                if (existingCol.type !== colDef.type) {
                    errors.push({
                        column: key,
                        expectedType: colDef.type,
                        actualType: existingCol.type,
                        issue: 'TYPE_MISMATCH'
                    });
                }
                log('TaskFlow_Meta.' + colDef.id + ' existe déjà (type: ' + existingCol.type + ')');
            }
        }
        
        // 3. Ajouter les colonnes formulées de TimeEntries
        var timeEntriesFormulaCols = [
            { 
                id: 'statutFeuille', 
                type: 'Text', 
                formula: '$feuille.statut if $feuille else ""' 
            },
            { 
                id: 'responsableValidation', 
                type: 'Ref:Team', 
                formula: '$feuille.responsableValidation if $feuille else None' 
            },
            { 
                id: 'semaineFeuille', 
                type: 'Date', 
                formula: '$feuille.semaine if $feuille else None' 
            }
        ];
        
        for (var k = 0; k < timeEntriesFormulaCols.length; k++) {
            var colDef = timeEntriesFormulaCols[k];
            var key = 'TimeEntries.' + colDef.id;
            if (!existingColumns[key]) {
                log('Ajout de la colonne formulée TimeEntries.' + colDef.id);
                actions.push(['AddColumn', 'TimeEntries', colDef.id, {
                    type: colDef.type,
                    isFormula: true,
                    formula: colDef.formula
                }]);
                existingColumns[key] = { 
                    type: colDef.type,
                    isFormula: true,
                    formula: colDef.formula
                };
            } else {
                var existingCol = existingColumns[key];
                
                // Vérifier isFormula
                if (!existingCol.isFormula) {
                    errors.push({
                        column: key,
                        expectedFormula: true,
                        actualFormula: existingCol.isFormula,
                        issue: 'NOT_A_FORMULA'
                    });
                }
                
                // Vérifier le type
                if (existingCol.type !== colDef.type) {
                    errors.push({
                        column: key,
                        expectedType: colDef.type,
                        actualType: existingCol.type,
                        issue: 'TYPE_MISMATCH'
                    });
                }
                
                // Vérifier la formule (seulement si isFormula=true)
                if (existingCol.isFormula && existingCol.formula !== colDef.formula) {
                    // Formule différente : pourrait être une personnalisation
                    // On ne bloque pas, mais on logue
                    log('TimeEntries.' + colDef.id + ' a une formule personnalisée');
                }
                
                log('TimeEntries.' + colDef.id + ' existe déjà (type: ' + existingCol.type + ', isFormula: ' + existingCol.isFormula + ')');
            }
        }
        
        // Si des erreurs critiques, échouer la migration
        if (errors.length > 0) {
            var criticalErrors = errors.filter(function(e) { 
                return e.issue === 'TYPE_MISMATCH' || e.issue === 'NOT_A_FORMULA'; 
            });
            
            if (criticalErrors.length > 0) {
                log('Migration v4 échouée: conflits critiques détectés', criticalErrors);
                throw new Error(
                    'Migration v4 bloquée: ' + criticalErrors.length + ' conflit(s) critique(s). ' +
                    'Colonnes incompatibles détectées. Détails: ' + JSON.stringify(criticalErrors)
                );
            }
        }
        
        // Appliquer les actions si nécessaire
        if (actions.length > 0) {
            await docApi.applyUserActions(actions);
            log('Migration v4 appliquée avec succès: ' + actions.length + ' actions');
            
            // Relire les métadonnées après écriture
            metadata = await loadMigrationMetadata(grist);
        } else {
            log('Aucune action nécessaire, migration déjà appliquée');
        }
        
        return { 
            success: true, 
            message: 'Migration v4 appliquée',
            actionsExecuted: actions.length,
            metadata: metadata,
            warnings: errors.length > 0 ? errors : undefined
        };
    }

    // ========================================================================
    // MIGRATION V4 → V5 — Rattachement des entrées de temps aux feuilles hebdomadaires
    // ========================================================================
    
    async function migrateToV5(grist, metadata, options) {
        var opts = options || {};
        var dryRun = opts.dryRun || false;
        
        log('Migration v4 → v5: timesheet-sheet-link-backfill-v5');
        
        // Vérifier que le module de backfill est chargé
        if (!global.TaskFlowTimesheetBackfill) {
            throw new Error('TIMESHEET_BACKFILL_MODULE_NOT_LOADED: Le module TaskFlowTimesheetBackfill n\'est pas chargé');
        }
        
        var backfill = global.TaskFlowTimesheetBackfill;
        var docApi = getDocApi(grist);
        
        // Vérifier que les tables existent
        var tablesData = await docApi.fetchTable('_grist_Tables');
        var tables = columnarToRows(tablesData);
        var tableIds = tables.map(function(t) { return t.tableId; });
        
        var requiredTables = ['Team', 'Feuilles', 'TimeEntries'];
        var missingTables = requiredTables.filter(function(t) { return tableIds.indexOf(t) === -1; });
        
        if (missingTables.length > 0) {
            throw new Error('TIMESHEET_BACKFILL_TABLE_MISSING: Tables manquantes: ' + missingTables.join(', '));
        }
        
        // Charger les données
        var teamData = await docApi.fetchTable('Team');
        var sheetsData = await docApi.fetchTable('Feuilles');
        var entriesData = await docApi.fetchTable('TimeEntries');
        
        var team = columnarToRows(teamData);
        var sheets = columnarToRows(sheetsData);
        var entries = columnarToRows(entriesData);
        
        log('Données chargées: ' + team.length + ' membres, ' + sheets.length + ' feuilles, ' + entries.length + ' entrées');
        
        // Phase 1 : Prévalidation - construire le plan initial
        var inspection = backfill.inspect({ team: team, sheets: sheets, entries: entries });
        var plan = backfill.buildPlan({ team: team, sheets: sheets, entries: entries }, inspection);
        
        if (!plan.valid) {
            log('Migration v5 échouée: conflits détectés', plan.conflicts);
            throw new Error(
                'TIMESHEET_BACKFILL_CONFLICT: ' + plan.conflicts.length + ' conflit(s) détecté(s). ' +
                'Codes: ' + plan.conflicts.map(function(c) { return c.code; }).join(', ')
            );
        }
        
        // Dry run : retourner le plan sans appliquer
        if (dryRun) {
            log('Dry run: aucun changement appliqué');
            return {
                success: true,
                dryRun: true,
                message: 'Prévisualisation de la migration v5',
                actionsExecuted: 0,
                plan: plan
            };
        }
        
        var actionsExecuted = 0;
        var createdSheets = [];
        var linkedEntries = [];
        var preservedLinks = [];
        
        // Phase A : Créer les feuilles manquantes
        if (plan.creates.length > 0) {
            log('Phase A: Création de ' + plan.creates.length + ' feuilles manquantes');
            
            var addActions = [];
            for (var i = 0; i < plan.creates.length; i++) {
                var create = plan.creates[i];
                addActions.push([
                    'AddRecord',
                    'Feuilles',
                    null,
                    create.values
                ]);
            }
            
            if (addActions.length > 0) {
                await docApi.applyUserActions(addActions);
                actionsExecuted += addActions.length;
                log('Feuilles créées: ' + addActions.length);
            }
            
            // Relire les feuilles pour obtenir les vrais IDs
            var newSheetsData = await docApi.fetchTable('Feuilles');
            var newSheets = columnarToRows(newSheetsData);
            
            // Reconstruire le plan avec les nouvelles données
            var newInspection = backfill.inspect({ 
                team: team, 
                sheets: newSheets, 
                entries: entries 
            });
            
            // Vérifier qu'il n'y a pas de conflits après création
            if (newInspection.conflicts.length > 0) {
                log('Conflits détectés après phase A', newInspection.conflicts);
                throw new Error(
                    'TIMESHEET_BACKFILL_CONFLICT_AFTER_CREATE: ' + newInspection.conflicts.length + ' conflit(s) après création des feuilles'
                );
            }
            
            var newPlan = backfill.buildPlan({ 
                team: team, 
                sheets: newSheets, 
                entries: entries 
            }, newInspection);
            
            // Vérifier que la phase A est complète
            if (newPlan.creates.length > 0) {
                throw new Error('TIMESHEET_BACKFILL_PHASE_A_INCOMPLETE: Il reste des feuilles à créer après la phase A');
            }
            
            // Utiliser le nouveau plan pour la phase B
            plan = newPlan;
        }
        
        // Phase B : Rattacher les TimeEntries
        if (plan.links.length > 0) {
            log('Phase B: Rattachement de ' + plan.links.length + ' entrées');
            
            var updateActions = [];
            for (var j = 0; j < plan.links.length; j++) {
                var link = plan.links[j];
                updateActions.push([
                    'UpdateRecord',
                    'TimeEntries',
                    link.entryId,
                    {
                        feuille: link.sheetId
                    }
                ]);
            }
            
            if (updateActions.length > 0) {
                await docApi.applyUserActions(updateActions);
                actionsExecuted += updateActions.length;
                log('Entrées rattachées: ' + updateActions.length);
            }
        }
        
        // Vérification finale
        log('Vérification finale...');
        var finalTeamData = await docApi.fetchTable('Team');
        var finalSheetsData = await docApi.fetchTable('Feuilles');
        var finalEntriesData = await docApi.fetchTable('TimeEntries');
        
        var finalTeam = columnarToRows(finalTeamData);
        var finalSheets = columnarToRows(finalSheetsData);
        var finalEntries = columnarToRows(finalEntriesData);
        
        var verification = backfill.verifyFinalState({ 
            team: finalTeam, 
            sheets: finalSheets, 
            entries: finalEntries 
        });
        
        if (!verification.valid) {
            log('Vérification finale échouée', verification.conflicts);
            throw new Error(
                'TIMESHEET_BACKFILL_VERIFICATION_FAILED: ' + verification.conflicts.length + ' conflit(s) après migration'
            );
        }
        
        // Compter les statistiques
        for (var k = 0; k < plan.links.length; k++) {
            var link = plan.links[k];
            if (link.pendingCreate) {
                linkedEntries.push(link.entryId);
            } else {
                // Lien vers feuille existante
                linkedEntries.push(link.entryId);
            }
        }
        
        for (var l = 0; l < plan.preservedLinks.length; l++) {
            preservedLinks.push(plan.preservedLinks[l].entryId);
        }
        
        log('Migration v5 appliquée avec succès');
        
        return {
            success: true,
            message: 'Migration v5 appliquée',
            actionsExecuted: actionsExecuted,
            createdSheets: plan.creates.map(function(c) { return c.key; }),
            linkedEntries: linkedEntries,
            preservedLinks: preservedLinks,
            verification: verification,
            dryRun: false
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
        },
        {
            version: 4,
            name: 'timesheet-validation-foundation-v4',
            description: 'Fondation du workflow de validation des feuilles de temps',
            run: migrateToV4
        },
        {
            version: 5,
            name: 'timesheet-sheet-link-backfill-v5',
            description: 'Rattachement des entrées de temps aux feuilles hebdomadaires',
            run: migrateToV5
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
        var dryRun = options.dryRun || false;
        
        var pending = getPendingMigrations(currentVersion);
        
        // Dry run autorisé uniquement si la seule migration en attente est v5
        if (dryRun && pending.length > 0) {
            var hasOnlyV5 = pending.length === 1 && pending[0].version === 5;
            if (!hasOnlyV5) {
                throw new Error('DRY_RUN_REQUIRES_SCHEMA_V4: Le dry run n\'est autorisé que pour la migration v5 depuis un schéma v4');
            }
        }
        
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
                var migrationOptions = {
                    dryRun: dryRun,
                    nowUnixSeconds: nowUnixSeconds
                };
                var result = await migration.run(grist, metadata, migrationOptions);
                
                if (!result || !result.success) {
                    throw new Error('Migration échouée: ' + migration.name);
                }
                
                results.push({
                    version: migration.version,
                    name: migration.name,
                    success: true,
                    message: result.message
                });
                
                // Met à jour la version courante après succès (seulement si pas dry run)
                if (!dryRun) {
                    lastSuccessfulVersion = migration.version;
                    
                    // Mettre à jour TaskFlow_Meta
                    await updateSchemaVersion(grist, lastSuccessfulVersion, migration.name, nowUnixSeconds);
                    
                    log('Migration appliquée: ' + migration.name + ' - version mise à jour: ' + lastSuccessfulVersion);
                } else {
                    log('Dry run: migration ' + migration.name + ' non appliquée');
                }
                
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
                
                // Met à jour les métadonnées avec l'erreur (seulement si pas dry run)
                if (!dryRun) {
                    try {
                        await updateMigrationError(grist, migration.name, e.message || String(e), nowUnixSeconds);
                    } catch (updateError) {
                        log('Erreur lors de la mise à jour de l\'erreur: ' + updateError);
                    }
                }
                
                // Arrête au premier échec
                throw new Error('Migration échouée à v' + migration.version + ': ' + (e.message || e));
            }
        }
        
        return {
            success: true,
            applied: pending.length,
            results: results,
            finalVersion: dryRun ? currentVersion : lastSuccessfulVersion,
            dryRun: dryRun
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
