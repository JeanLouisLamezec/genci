/* ============================================================================
 * taskflow-migrations.js — Migrations versionnées du schéma TaskFlow
 * ----------------------------------------------------------------------------
 * Ce module gère les évolutions du schéma de manière contrôlée et réversible.
 * Chaque migration est :
 * - Idempotente (peut être réexécutée sans effet secondaire)
 * - Non destructive (ne supprime jamais de données)
 * - Testable indépendamment
 * 
 * Pour ajouter une migration :
 * 1. Incrémenter SCHEMA_VERSION dans taskflow-schema.js
 * 2. Ajouter une nouvelle entrée dans MIGRATIONS
 * 3. Implémenter la fonction de migration
 * 4. Tester sur un document de test
 * ============================================================================ */

(function (global) {
    'use strict';

    var SCHEMA = global.TASKFLOW_SCHEMA;

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

    // ========================================================================
    // MIGRATION V1 → V2 (exemple placeholder)
    // ========================================================================
    // Cette migration est un exemple. À remplacer par la première vraie
    // migration lors de l'évolution du schéma.
    
    async function migrateToV2(grist, metadata) {
        log('Migration v1 → v2: Exemple (pas d\'action réelle)');
        
        // Exemple : ajouter une colonne optionnelle
        // await grist.docApi.applyUserActions([
        //     ['AddColumn', 'Tasks', 'nouvelleColonne', { type: 'Text', isFormula: false }]
        // ]);
        
        return { success: true, message: 'Migration v2 appliquée' };
    }

    // ========================================================================
    // MIGRATION V2 → V3 (exemple placeholder)
    // ========================================================================
    
    async function migrateToV3(grist, metadata) {
        log('Migration v2 → v3: Exemple (pas d\'action réelle)');
        return { success: true, message: 'Migration v3 appliquée' };
    }

    // ========================================================================
    // LISTE DES MIGRATIONS
    // ========================================================================
    // Ordre croissant de version. Chaque migration fait passer de N à N+1.
    
    var MIGRATIONS = [
        {
            version: 2,
            name: 'example-migration-v2',
            description: 'Exemple de migration (à remplacer)',
            run: migrateToV2
        },
        {
            version: 3,
            name: 'example-migration-v3',
            description: 'Exemple de migration (à remplacer)',
            run: migrateToV3
        }
    ];

    // ========================================================================
    // API PUBLIQUE
    // ========================================================================

    // Lit la version actuelle installée
    async function getCurrentVersion(grist) {
        try {
            var meta = await grist.docApi.fetchTable('TaskFlow_Meta');
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
        for (var i = 0; i < MIGRATIONS.length; i++) {
            if (MIGRATIONS[i].version > currentVersion) {
                pending.push(MIGRATIONS[i]);
            }
        }
        return pending;
    }

    // Exécute toutes les migrations en attente
    async function runMigrations(grist, currentVersion) {
        var pending = getPendingMigrations(currentVersion);
        
        if (pending.length === 0) {
            log('Aucune migration en attente');
            return {
                success: true,
                applied: 0,
                message: 'Schéma à jour'
            };
        }
        
        log('Migrations en attente: ' + pending.length, pending.map(function (m) { return m.name; }));
        
        var results = [];
        var metadata = null;
        
        for (var i = 0; i < pending.length; i++) {
            var migration = pending[i];
            
            try {
                log('Application migration: ' + migration.name + ' (v' + migration.version + ')');
                
                // Relit les métadonnées avant chaque migration
                try {
                    metadata = await grist.docApi.fetchTable('_grist_Tables_column');
                    metadata = columnarToRows(metadata);
                } catch (e) {
                    metadata = {};
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
                
                log('Migration appliquée: ' + migration.name);
                
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
                
                // Arrête au premier échec
                throw new Error('Migration échouée à v' + migration.version + ': ' + (e.message || e));
            }
        }
        
        return {
            success: true,
            applied: pending.length,
            results: results
        };
    }

    // Export public
    global.TaskFlowMigrations = {
        getCurrentVersion: getCurrentVersion,
        getPendingMigrations: getPendingMigrations,
        runMigrations: runMigrations,
        MIGRATIONS: MIGRATIONS
    };

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
