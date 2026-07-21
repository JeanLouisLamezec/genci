/* ============================================================================
 * taskflow-fast-path.test.js — Tests pour le fast path du schéma TaskFlow
 * ----------------------------------------------------------------------------
 * Tests unitaires pour les fonctions :
 * - TF.readSchemaFastState()
 * - TF.writeSchemaReady()
 * - Intégration avec initGrist()
 * ============================================================================ */

(function () {
    'use strict';

    // Helper : convertit un tableau Grist colonnaire en tableau d'objets
    function columnarToRows(data) {
        if (!data || Array.isArray(data)) return data || [];
        const cols = Object.keys(data);
        if (!cols.length) return [];
        const n = (data[cols[0]] && data[cols[0]].length) || 0;
        const rows = [];
        for (let i = 0; i < n; i++) {
            const rec = {};
            for (const k of cols) rec[k] = data[k][i];
            rows.push(rec);
        }
        return rows;
    }

    // Mock Grist API
    function createMockGrist(options) {
        options = options || {};
        
        var metaTable = {
            id: [1],
            tableId: ['TaskFlow_Meta']
        };
        
        var metaColumns = {
            id: [1, 2, 3, 4, 5],
            colId: ['schemaVersion', 'installationStatus', 'lastMigration', 'lastMigrationAt', 'lastError'],
            parentId: [1, 1, 1, 1, 1],
            type: ['Int', 'Choice', 'Text', 'DateTime', 'Text']
        };
        
        var taskFlowMeta = options.metaData || {
            id: [1],
            schemaVersion: options.schemaVersion != null ? [options.schemaVersion] : [3],
            installationStatus: options.installationStatus != null ? [options.installationStatus] : ['ready'],
            lastMigration: options.lastMigration ? [options.lastMigration] : [null],
            lastMigrationAt: options.lastMigrationAt ? [options.lastMigrationAt] : [null],
            lastError: options.lastError ? [options.lastError] : [null]
        };
        
        var tables = {};
        tables['_grist_Tables'] = metaTable;
        tables['_grist_Tables_column'] = metaColumns;
        tables['TaskFlow_Meta'] = taskFlowMeta;
        
        if (options.tasksData) {
            tables['Tasks'] = options.tasksData;
        }
        
        var fetchTableCalls = [];
        var applyUserActionsCalls = [];
        
        return {
            docApi: {
                fetchTable: function (tableId) {
                    fetchTableCalls.push(tableId);
                    if (options.missingTables && options.missingTables.includes(tableId)) {
                        return Promise.reject(new Error('Table not found: ' + tableId));
                    }
                    if (tables[tableId]) {
                        return Promise.resolve(tables[tableId]);
                    }
                    return Promise.resolve({ id: [], tableId: [] });
                },
                applyUserActions: function (actions) {
                    applyUserActionsCalls.push(actions);
                    if (options.rejectWrites) {
                        return Promise.reject(new Error('Access denied'));
                    }
                    
                    for (var i = 0; i < actions.length; i++) {
                        var action = actions[i];
                        if (action[0] === 'AddRecord' && action[1] === 'TaskFlow_Meta') {
                            var newId = taskFlowMeta.id.length > 0 ? Math.max.apply(null, taskFlowMeta.id) + 1 : 1;
                            taskFlowMeta.id.push(newId);
                            for (var key in action[3]) {
                                if (!taskFlowMeta[key]) {
                                    taskFlowMeta[key] = [];
                                }
                                taskFlowMeta[key].push(action[3][key]);
                            }
                            return Promise.resolve([newId]);
                        }
                        if (action[0] === 'UpdateRecord' && action[1] === 'TaskFlow_Meta') {
                            var rowId = action[2];
                            var idx = taskFlowMeta.id.indexOf(rowId);
                            if (idx >= 0) {
                                for (var key in action[3]) {
                                    if (!taskFlowMeta[key]) {
                                        taskFlowMeta[key] = [];
                                    }
                                    taskFlowMeta[key][idx] = action[3][key];
                                }
                            }
                            return Promise.resolve(null);
                        }
                    }
                    
                    return Promise.resolve([]);
                },
                listTables: function () {
                    return Promise.resolve(Object.keys(tables));
                }
            },
            _test: {
                fetchTableCalls: fetchTableCalls,
                applyUserActionsCalls: applyUserActionsCalls,
                getTables: function () { return tables; }
            }
        };
    }

    function assert(condition, message) {
        if (!condition) {
            throw new Error('ASSERTION FAILED: ' + message);
        }
    }

    function assertEquals(actual, expected, message) {
        if (actual !== expected) {
            throw new Error('ASSERTION FAILED: ' + message + ' (expected: ' + expected + ', actual: ' + actual + ')');
        }
    }

    function assertDeepEqual(actual, expected, message) {
        var actualStr = JSON.stringify(actual);
        var expectedStr = JSON.stringify(expected);
        if (actualStr !== expectedStr) {
            throw new Error('ASSERTION FAILED: ' + message + ' (expected: ' + expectedStr + ', actual: ' + actualStr + ')');
        }
    }

    async function runTests() {
        console.log('===== taskflow-fast-path.test.js =====');
        var passed = 0;
        var failed = 0;

        async function test(name, fn) {
            try {
                await fn();
                console.log('  ✓ ' + name);
                passed++;
            } catch (e) {
                console.error('  ✗ ' + name);
                console.error('    ' + e.message);
                failed++;
            }
        }

        console.log('\n[TF.readSchemaFastState]');

        await test('Meta absent (table vide) → META_EMPTY', async function () {
            var grist = createMockGrist({
                metaData: { id: [], schemaVersion: [], installationStatus: [], lastError: [] }
            });
            
            var result = await TF.readSchemaFastState(grist, 3);
            
            assert(!result.ready, 'should not be ready');
            assertEquals(result.reason, 'META_EMPTY', 'reason should be META_EMPTY');
        });

        await test('Meta version courante + status ready → SCHEMA_META_READY', async function () {
            var grist = createMockGrist({
                schemaVersion: 3,
                installationStatus: 'ready',
                lastError: null
            });
            
            var result = await TF.readSchemaFastState(grist, 3);
            
            assert(result.ready, 'should be ready');
            assertEquals(result.reason, 'SCHEMA_META_READY', 'reason should be SCHEMA_META_READY');
        });

        await test('Meta version ancienne → SCHEMA_META_STALE', async function () {
            var grist = createMockGrist({
                schemaVersion: 2,
                installationStatus: 'ready',
                lastError: null
            });
            
            var result = await TF.readSchemaFastState(grist, 3);
            
            assert(!result.ready, 'should not be ready');
            assertEquals(result.reason, 'SCHEMA_META_STALE', 'reason should be SCHEMA_META_STALE');
        });

        await test('Statut "migrated" accepté comme ready', async function () {
            var grist = createMockGrist({
                schemaVersion: 3,
                installationStatus: 'migrated',
                lastError: ''
            });
            
            var result = await TF.readSchemaFastState(grist, 3);
            
            assert(result.ready, 'should be ready');
            assertEquals(result.reason, 'SCHEMA_META_READY', 'reason should be SCHEMA_META_READY');
        });

        await test('lastError renseigné → fast path refusé', async function () {
            var grist = createMockGrist({
                schemaVersion: 3,
                installationStatus: 'ready',
                lastError: 'Previous installation error'
            });
            
            var result = await TF.readSchemaFastState(grist, 3);
            
            assert(!result.ready, 'should not be ready');
            assertEquals(result.reason, 'SCHEMA_META_STALE', 'reason should be SCHEMA_META_STALE');
        });

        await test('Meta en doublon → META_DUPLICATE', async function () {
            var grist = createMockGrist({
                metaData: {
                    id: [1, 2],
                    schemaVersion: [3, 3],
                    installationStatus: ['ready', 'ready'],
                    lastError: [null, null]
                }
            });
            
            var result = await TF.readSchemaFastState(grist, 3);
            
            assert(!result.ready, 'should not be ready');
            assertEquals(result.reason, 'META_DUPLICATE', 'reason should be META_DUPLICATE');
            assert(Array.isArray(result.meta), 'meta should be an array');
            assertEquals(result.meta.length, 2, 'should have 2 meta rows');
        });

        await test('Table TaskFlow_Meta absente → META_UNAVAILABLE', async function () {
            var grist = createMockGrist({
                missingTables: ['TaskFlow_Meta']
            });
            
            var result = await TF.readSchemaFastState(grist, 3);
            
            assert(!result.ready, 'should not be ready');
            assertEquals(result.reason, 'META_UNAVAILABLE', 'reason should be META_UNAVAILABLE');
            assert(result.error, 'should have an error message');
            console.log('  (error message:', result.error + ')');
        });

        await test('Version non spécifiée → accepte toute version', async function () {
            var grist = createMockGrist({
                schemaVersion: 5,
                installationStatus: 'ready',
                lastError: null
            });
            
            var result = await TF.readSchemaFastState(grist, null);
            
            assert(result.ready, 'should be ready');
            assertEquals(result.reason, 'SCHEMA_META_READY', 'reason should be SCHEMA_META_READY');
        });

        console.log('\n[TF.writeSchemaReady]');

        await test('Meta absent → création (created)', async function () {
            var grist = createMockGrist({
                metaData: { id: [], schemaVersion: [], installationStatus: [], lastError: [] }
            });
            
            var result = await TF.writeSchemaReady(grist, {
                schemaVersion: 3,
                installedBy: 'test'
            });
            
            assert(result.success, 'should succeed');
            assertEquals(result.action, 'created', 'action should be created');
            
            var tables = grist._test.getTables();
            assertEquals(tables['TaskFlow_Meta'].id.length, 1, 'should have 1 row');
            assertEquals(tables['TaskFlow_Meta'].schemaVersion[0], 3, 'version should be 3');
            assertEquals(tables['TaskFlow_Meta'].installationStatus[0], 'ready', 'status should be ready');
        });

        await test('Meta présent → mise à jour (updated)', async function () {
            var grist = createMockGrist({
                schemaVersion: 2,
                installationStatus: 'migrated'
            });
            
            var result = await TF.writeSchemaReady(grist, {
                schemaVersion: 3
            });
            
            assert(result.success, 'should succeed');
            assertEquals(result.action, 'updated', 'action should be updated');
            
            var tables = grist._test.getTables();
            assertEquals(tables['TaskFlow_Meta'].schemaVersion[0], 3, 'version should be updated to 3');
            assertEquals(tables['TaskFlow_Meta'].installationStatus[0], 'ready', 'status should be ready');
        });

        await test('Meta en doublon → échec (META_DUPLICATE)', async function () {
            var grist = createMockGrist({
                metaData: {
                    id: [1, 2],
                    schemaVersion: [3, 3],
                    installationStatus: ['ready', 'ready'],
                    lastError: [null, null]
                }
            });
            
            var result = await TF.writeSchemaReady(grist, {
                schemaVersion: 3
            });
            
            assert(!result.success, 'should fail');
            assertEquals(result.error, 'META_DUPLICATE', 'error should be META_DUPLICATE');
            assertEquals(result.count, 2, 'should have 2 rows');
        });

        await test('Écriture refusée → échec avec erreur', async function () {
            var grist = createMockGrist({
                rejectWrites: true
            });
            
            var result = await TF.writeSchemaReady(grist, {
                schemaVersion: 3
            });
            
            assert(!result.success, 'should fail');
            assert(result.error, 'should have error message');
        });

        await test('lastMigrationAt est un timestamp Unix', async function () {
            var grist = createMockGrist({
                metaData: { id: [], schemaVersion: [], installationStatus: [], lastError: [] }
            });
            
            var before = Math.floor(Date.now() / 1000);
            var result = await TF.writeSchemaReady(grist, {
                schemaVersion: 3
            });
            var after = Math.floor(Date.now() / 1000);
            
            var tables = grist._test.getTables();
            var lastMigrationAt = tables['TaskFlow_Meta'].lastMigrationAt[0];
            
            assert(lastMigrationAt >= before, 'timestamp should be >= before');
            assert(lastMigrationAt <= after, 'timestamp should be <= after');
        });

        console.log('\n[Intégration]');

        await test('Écriture puis lecture → ready', async function () {
            var grist = createMockGrist({
                metaData: { id: [], schemaVersion: [], installationStatus: [], lastError: [] }
            });
            
            var writeResult = await TF.writeSchemaReady(grist, {
                schemaVersion: 3,
                installedBy: 'integration-test'
            });
            
            assert(writeResult.success, 'write should succeed');
            
            var readResult = await TF.readSchemaFastState(grist, 3);
            
            assert(readResult.ready, 'read should be ready');
            assertEquals(readResult.reason, 'SCHEMA_META_READY', 'reason should be SCHEMA_META_READY');
            assertEquals(readResult.meta.installedBy, 'integration-test', 'installedBy should match');
        });

        await test('Simulation premier chargement (Meta vide) → slow path', async function () {
            var grist = createMockGrist({
                metaData: { id: [], schemaVersion: [], installationStatus: [], lastError: [] }
            });
            
            var result = await TF.readSchemaFastState(grist, 3);
            
            assert(!result.ready, 'should not be ready');
            assertEquals(result.reason, 'META_EMPTY', 'should indicate empty meta');
        });

        await test('Simulation chargement ultérieur (Meta ready) → fast path', async function () {
            var grist = createMockGrist({
                schemaVersion: 3,
                installationStatus: 'ready',
                lastError: null
            });
            
            var result = await TF.readSchemaFastState(grist, 3);
            
            assert(result.ready, 'should be ready');
            assertEquals(result.reason, 'SCHEMA_META_READY', 'should indicate ready');
        });

        console.log('\n===== Résultats =====');
        console.log('Passés: ' + passed);
        console.log('Échoués: ' + failed);
        console.log('Total: ' + (passed + failed));

        if (failed > 0) {
            throw new Error(failed + ' test(s) failed');
        }

        console.log('\n✓ Tous les tests sont passés');
    }

    // Exports
    if (typeof window !== 'undefined') {
        window.TaskFlowFastPathTests = {
            run: runTests,
            createMockGrist: createMockGrist
        };
    }
    
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            runTests: runTests,
            createMockGrist: createMockGrist
        };
    }
})();
