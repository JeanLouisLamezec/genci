/* ============================================================================
 * gantt-date-sync-integration.test.js
 * ----------------------------------------------------------------------------
 * Test d'intégration pour la synchronisation des dates Gantt → TaskAssignments
 * 
 * Tests le parcours complet :
 * openTaskPanel → updateField → saveTaskToGrist → assignmentIntegration
 * ============================================================================ */

(function(global) {
    'use strict';

    /**
     * Mock Grist API pour les tests
     */
    function createMockGrist() {
        var tasks = [
            {
                id: 5,
                titre: 'Tâche Test',
                dateDebut: 1700000000,
                dateEcheance: 1700086400,
                assignees: ['L', 1],
                charges: JSON.stringify([{ teamId: 1, heures: 35 }])
            }
        ];

        var taskAssignments = [
            {
                id: 3,
                tache: 5,
                membre: 1,
                heuresAllouees: 35,
                dateDebut: 1700000000,
                dateFin: 1700086400,
                modeRepartition: 'uniforme',
                actif: true,
                commentaire: ''
            }
        ];

        var team = [
            {
                id: 1,
                nom: 'Membre 1'
            }
        ];

        var mockGrist = {
            docApi: {
                fetchTable: async function(tableName) {
                    if (tableName === 'Tasks') {
                        var result = {};
                        Object.keys(tasks[0]).forEach(function(key) {
                            result[key] = tasks.map(function(t) { return t[key]; });
                        });
                        return result;
                    }
                    if (tableName === 'TaskAssignments') {
                        var result = {};
                        Object.keys(taskAssignments[0]).forEach(function(key) {
                            result[key] = taskAssignments.map(function(a) { return a[key]; });
                        });
                        return result;
                    }
                    if (tableName === 'Team') {
                        var result = {};
                        Object.keys(team[0]).forEach(function(key) {
                            result[key] = team.map(function(t) { return t[key]; });
                        });
                        return result;
                    }
                    return {};
                },

                applyUserActions: async function(actions) {
                    var retValues = [];
                    
                    for (var i = 0; i < actions.length; i++) {
                        var action = actions[i];
                        var type = action[0];
                        var table = action[1];
                        var id = action[2];
                        var data = action[3];

                        if (table === 'Tasks') {
                            if (type === 'UpdateRecord') {
                                var task = tasks.find(function(t) { return t.id === id; });
                                if (task) {
                                    Object.assign(task, data);
                                }
                            }
                        }

                        if (table === 'TaskAssignments') {
                            if (type === 'UpdateRecord') {
                                var assignment = taskAssignments.find(function(a) { return a.id === id; });
                                if (assignment) {
                                    Object.assign(assignment, data);
                                }
                            }
                            if (type === 'AddRecord') {
                                var newId = Math.max.apply(null, taskAssignments.map(function(a) { return a.id; })) + 1;
                                var newAssignment = Object.assign({}, data, { id: newId });
                                taskAssignments.push(newAssignment);
                                retValues.push(newId);
                            }
                            if (type === 'RemoveRecord') {
                                var idx = taskAssignments.findIndex(function(a) { return a.id === id; });
                                if (idx >= 0) {
                                    taskAssignments.splice(idx, 1);
                                }
                            }
                        }
                    }

                    return { retValues: retValues };
                }
            },

            setSelectedRows: function(ids) {
                console.log('[Mock Grist] setSelectedRows:', ids);
            },

            getSelectedRows: function() {
                return [5];
            }
        };

        return mockGrist;
    }

    /**
     * Test 1: Modification de date de début uniquement
     */
    async function test1_dateDebutOnly() {
        console.log('\n=== TEST 1: Modification dateDebut uniquement ===');
        
        var mockGrist = createMockGrist();
        var assignmentIntegration = global.createGanttAssignmentIntegration(mockGrist, { logEnabled: true });
        
        var originalTask = {
            id: 5,
            titre: 'Tâche Test',
            dateDebut: 1700000000,
            dateEcheance: 1700086400,
            assignees: ['L', 1],
            charges: [{ teamId: 1, heures: 35 }]
        };

        var editData = {
            titre: 'Tâche Test',
            dateDebut: 1700050000,
            dateEcheance: 1700090000,
            assignees: [1],
            charges: [{ teamId: 1, heures: 35 }]
        };

        console.log('[Test] État initial TaskAssignments:', JSON.stringify(
            await mockGrist.docApi.fetchTable('TaskAssignments')
        ));

        var result = await assignmentIntegration.onTaskUpdated(5, Object.assign({}, editData, {
            assignmentsEdited: false,
            datesEdited: true
        }));

        console.log('[Test] Résultat sync:', JSON.stringify(result));

        var updatedTable = await mockGrist.docApi.fetchTable('TaskAssignments');
        var updatedAssignment = null;
        if (updatedTable.id) {
            for (var i = 0; i < updatedTable.id.length; i++) {
                if (updatedTable.id[i] === 3) {
                    updatedAssignment = {
                        id: updatedTable.id[i],
                        dateDebut: updatedTable.dateDebut[i],
                        dateFin: updatedTable.dateFin[i]
                    };
                    break;
                }
            }
        }

        console.log('[Test] TaskAssignment après sync:', JSON.stringify(updatedAssignment));

        if (!updatedAssignment) {
            console.error('❌ TEST 1 ÉCHOUÉ: TaskAssignment introuvable');
            return false;
        }

        if (updatedAssignment.dateDebut !== 1700050000) {
            console.error('❌ TEST 1 ÉCHOUÉ: dateDebut non mise à jour');
            console.error('  Attendu: 1700050000, Reçu:', updatedAssignment.dateDebut);
            return false;
        }

        if (updatedAssignment.dateFin !== 1700090000) {
            console.error('❌ TEST 1 ÉCHOUÉ: dateFin non mise à jour');
            console.error('  Attendu: 1700090000, Reçu:', updatedAssignment.dateFin);
            return false;
        }

        console.log('✅ TEST 1 RÉUSSI');
        return true;
    }

    /**
     * Test 2: Modification de date de fin uniquement
     */
    async function test2_dateFinOnly() {
        console.log('\n=== TEST 2: Modification dateEcheance uniquement ===');
        
        var mockGrist = createMockGrist();
        var assignmentIntegration = global.createGanttAssignmentIntegration(mockGrist, { logEnabled: true });
        
        var editData = {
            titre: 'Tâche Test',
            dateDebut: 1700000000,
            dateEcheance: 1700100000,
            assignees: [1],
            charges: [{ teamId: 1, heures: 35 }]
        };

        var result = await assignmentIntegration.onTaskUpdated(5, Object.assign({}, editData, {
            assignmentsEdited: false,
            datesEdited: true
        }));

        var updatedTable = await mockGrist.docApi.fetchTable('TaskAssignments');
        var updatedAssignment = null;
        if (updatedTable.id) {
            for (var i = 0; i < updatedTable.id.length; i++) {
                if (updatedTable.id[i] === 3) {
                    updatedAssignment = {
                        id: updatedTable.id[i],
                        dateDebut: updatedTable.dateDebut[i],
                        dateFin: updatedTable.dateFin[i]
                    };
                    break;
                }
            }
        }

        if (!updatedAssignment || updatedAssignment.dateFin !== 1700100000) {
            console.error('❌ TEST 2 ÉCHOUÉ: dateFin non mise à jour');
            return false;
        }

        if (updatedAssignment.dateDebut !== 1700000000) {
            console.error('❌ TEST 2 ÉCHOUÉ: dateDebut incorrecte');
            console.error('  Attendu: 1700000000, Reçu:', updatedAssignment.dateDebut);
            return false;
        }

        console.log('✅ TEST 2 RÉUSSI');
        return true;
    }

    /**
     * Test 3: Modification des deux dates
     */
    async function test3_bothDates() {
        console.log('\n=== TEST 3: Modification des deux dates ===');
        
        var mockGrist = createMockGrist();
        var assignmentIntegration = global.createGanttAssignmentIntegration(mockGrist, { logEnabled: true });
        
        var editData = {
            titre: 'Tâche Test',
            dateDebut: 1700050000,
            dateEcheance: 1700100000,
            assignees: [1],
            charges: [{ teamId: 1, heures: 35 }]
        };

        var result = await assignmentIntegration.onTaskUpdated(5, Object.assign({}, editData, {
            assignmentsEdited: false,
            datesEdited: true
        }));

        var updatedTable = await mockGrist.docApi.fetchTable('TaskAssignments');
        var updatedAssignment = null;
        if (updatedTable.id) {
            for (var i = 0; i < updatedTable.id.length; i++) {
                if (updatedTable.id[i] === 3) {
                    updatedAssignment = {
                        id: updatedTable.id[i],
                        dateDebut: updatedTable.dateDebut[i],
                        dateFin: updatedTable.dateFin[i]
                    };
                    break;
                }
            }
        }

        if (!updatedAssignment || 
            updatedAssignment.dateDebut !== 1700050000 || 
            updatedAssignment.dateFin !== 1700100000) {
            console.error('❌ TEST 3 ÉCHOUÉ: dates non mises à jour correctement');
            return false;
        }

        console.log('✅ TEST 3 RÉUSSI');
        return true;
    }

    /**
     * Test 4: Titre uniquement (aucune synchronisation TaskAssignments)
     */
    async function test4_titleOnly() {
        console.log('\n=== TEST 4: Modification titre uniquement ===');
        
        var mockGrist = createMockGrist();
        var assignmentIntegration = global.createGanttAssignmentIntegration(mockGrist, { logEnabled: true });
        
        var editData = {
            titre: 'Nouveau Titre',
            dateDebut: 1700000000,
            dateEcheance: 1700086400,
            assignees: [1],
            charges: [{ teamId: 1, heures: 35 }]
        };

        var result = await assignmentIntegration.onTaskUpdated(5, Object.assign({}, editData, {
            assignmentsEdited: false,
            datesEdited: false
        }));

        console.log('[Test] Résultat:', JSON.stringify(result));

        if (result.code !== 'NO_ASSIGNMENT_CHANGE') {
            console.error('❌ TEST 4 ÉCHOUÉ: synchronisation inutile déclenchée');
            return false;
        }

        console.log('✅ TEST 4 RÉUSSI (aucune synchronisation TaskAssignments)');
        return true;
    }

    /**
     * Test 5: Postcondition échouée (mock ne met pas à jour)
     */
    async function test5_postconditionFailed() {
        console.log('\n=== TEST 5: Postcondition échouée ===');
        
        var tasks = [
            {
                id: 5,
                titre: 'Tâche Test',
                dateDebut: 1700000000,
                dateEcheance: 1700086400,
                assignees: ['L', 1],
                charges: JSON.stringify([{ teamId: 1, heures: 35 }])
            }
        ];

        var taskAssignments = [
            {
                id: 3,
                tache: 5,
                membre: 1,
                heuresAllouees: 35,
                dateDebut: 1700000000,
                dateFin: 1700086400,
                modeRepartition: 'uniforme',
                actif: true,
                commentaire: ''
            }
        ];

        var team = [
            { id: 1, nom: 'Membre 1' }
        ];

        var mockGrist = {
            docApi: {
                fetchTable: async function(tableName) {
                    if (tableName === 'Tasks') {
                        var result = {};
                        Object.keys(tasks[0]).forEach(function(key) {
                            result[key] = tasks.map(function(t) { return t[key]; });
                        });
                        return result;
                    }
                    if (tableName === 'TaskAssignments') {
                        var result = {};
                        Object.keys(taskAssignments[0]).forEach(function(key) {
                            result[key] = taskAssignments.map(function(a) { return a[key]; });
                        });
                        return result;
                    }
                    if (tableName === 'Team') {
                        var result = {};
                        Object.keys(team[0]).forEach(function(key) {
                            result[key] = team.map(function(t) { return t[key]; });
                        });
                        return result;
                    }
                    return {};
                },

                applyUserActions: async function(actions) {
                    var retValues = [];
                    
                    for (var i = 0; i < actions.length; i++) {
                        var action = actions[i];
                        var type = action[0];
                        var table = action[1];
                        var id = action[2];
                        var data = action[3];

                        console.log('[Mock Grist] Action:', type, table, id, JSON.stringify(data));

                        if (table === 'Tasks') {
                            if (type === 'UpdateRecord') {
                                var task = tasks.find(function(t) { return t.id === id; });
                                if (task) {
                                    Object.assign(task, data);
                                }
                            }
                        }

                        if (table === 'TaskAssignments') {
                            if (type === 'UpdateRecord') {
                                var assignment = taskAssignments.find(function(a) { return a.id === id; });
                                if (assignment) {
                                    if (data.dateDebut !== undefined || data.dateFin !== undefined) {
                                        console.log('[Mock] SIMULATION ÉCHEC: dates non mises à jour');
                                    } else {
                                        Object.assign(assignment, data);
                                    }
                                }
                            }
                            if (type === 'AddRecord') {
                                var newId = Math.max.apply(null, taskAssignments.map(function(a) { return a.id; })) + 1;
                                var newAssignment = Object.assign({}, data, { id: newId });
                                taskAssignments.push(newAssignment);
                                retValues.push(newId);
                            }
                        }
                    }

                    return { retValues: retValues };
                }
            },

            setSelectedRows: function(ids) {},
            getSelectedRows: function() { return [5]; }
        };

        var assignmentIntegration = global.createGanttAssignmentIntegration(mockGrist, { logEnabled: true });

        var result = await assignmentIntegration.syncTaskDates(5, 1700050000, 1700090000);

        console.log('[Test] Résultat:', JSON.stringify(result));

        if (result.ok !== false || result.code !== 'ASSIGNMENT_DATE_POSTCONDITION_FAILED') {
            console.error('❌ TEST 5 ÉCHOUÉ: postcondition non détectée');
            console.error('  Résultat attendu: ok=false, code=ASSIGNMENT_DATE_POSTCONDITION_FAILED');
            console.error('  Résultat obtenu: ok=' + result.ok + ', code=' + (result.code || 'undefined'));
            return false;
        }

        console.log('✅ TEST 5 RÉUSSI (postcondition échouée détectée)');
        return true;
    }

    /**
     * Exécute tous les tests
     */
    async function runAllTests() {
        console.log('==================================================');
        console.log('Tests d\'intégration Gantt → TaskAssignments Date Sync');
        console.log('==================================================');

        var results = {
            passed: 0,
            failed: 0,
            total: 0
        };

        var tests = [
            { name: 'Test 1: Date début uniquement', fn: test1_dateDebutOnly },
            { name: 'Test 2: Date fin uniquement', fn: test2_dateFinOnly },
            { name: 'Test 3: Deux dates', fn: test3_bothDates },
            { name: 'Test 4: Titre uniquement', fn: test4_titleOnly },
            { name: 'Test 5: Postcondition échouée', fn: test5_postconditionFailed }
        ];

        for (var i = 0; i < tests.length; i++) {
            var test = tests[i];
            results.total++;
            
            try {
                var success = await test.fn();
                if (success) {
                    results.passed++;
                } else {
                    results.failed++;
                }
            } catch (e) {
                console.error('❌ ' + test.name + ' ERREUR:', e.message);
                results.failed++;
            }
        }

        console.log('\n==================================================');
        console.log('RÉSULTATS FINAUX');
        console.log('==================================================');
        console.log('Tests réussis:', results.passed + '/' + results.total);
        console.log('Tests échoués:', results.failed + '/' + results.total);
        console.log('==================================================\n');

        return results;
    }

    global.GanttDateSyncIntegrationTests = {
        runAllTests: runAllTests,
        test1_dateDebutOnly: test1_dateDebutOnly,
        test2_dateFinOnly: test2_dateFinOnly,
        test3_bothDates: test3_bothDates,
        test4_titleOnly: test4_titleOnly,
        test5_postconditionFailed: test5_postconditionFailed
    };

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
