#!/usr/bin/env node

/* ============================================================================
 * test-gantt-date-sync-node.js
 * ----------------------------------------------------------------------------
 * Exécute les tests d'intégration date sync en ligne de commande
 * ============================================================================ */

'use strict';

var fs = require('fs');
var path = require('path');

console.log('==================================================');
console.log('Tests d\'intégration Gantt → TaskAssignments Date Sync');
console.log('==================================================\n');

var taskAssignmentServiceCode = fs.readFileSync(
    path.join(__dirname, 'core/planning/task-assignment-service.js'),
    'utf8'
);

var ganttIntegrationCode = fs.readFileSync(
    path.join(__dirname, 'core/planning/gantt-task-assignment-integration.js'),
    'utf8'
);

var testCode = fs.readFileSync(
    path.join(__dirname, 'core/planning/gantt-date-sync-integration.test.js'),
    'utf8'
);

var mockGrist = {
    docApi: {
        fetchTable: async function(tableName) {
            if (tableName === 'Tasks') {
                return {
                    id: [5],
                    titre: ['Tâche Test'],
                    dateDebut: [1700000000],
                    dateEcheance: [1700086400],
                    assignees: [['L', 1]],
                    charges: [JSON.stringify([{ teamId: 1, heures: 35 }])]
                };
            }
            if (tableName === 'TaskAssignments') {
                return {
                    id: [3],
                    tache: [5],
                    membre: [1],
                    heuresAllouees: [35],
                    dateDebut: [1700000000],
                    dateFin: [1700086400],
                    modeRepartition: ['uniforme'],
                    actif: [true],
                    commentaire: ['']
                };
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
            }

            return { retValues: retValues };
        }
    },

    setSelectedRows: function(ids) {
        console.log('[Mock Grist] setSelectedRows:', ids);
    }
};

eval(taskAssignmentServiceCode);
eval(ganttIntegrationCode);
eval(testCode);

var createGanttAssignmentIntegration = global.createGanttAssignmentIntegration;
var GanttDateSyncIntegrationTests = global.GanttDateSyncIntegrationTests;

if (!createGanttAssignmentIntegration) {
    console.error('❌ ERREUR: createGanttAssignmentIntegration non défini');
    process.exit(1);
}

if (!GanttDateSyncIntegrationTests) {
    console.error('❌ ERREUR: GanttDateSyncIntegrationTests non défini');
    process.exit(1);
}

GanttDateSyncIntegrationTests.runAllTests()
    .then(function(results) {
        console.log('\n==================================================');
        console.log('RÉSULTATS FINAUX');
        console.log('==================================================');
        console.log('Tests réussis:', results.passed + '/' + results.total);
        console.log('Tests échoués:', results.failed + '/' + results.total);
        console.log('==================================================\n');

        if (results.failed > 0) {
            process.exit(1);
        } else {
            console.log('✅ Tous les tests sont passés avec succès!');
            process.exit(0);
        }
    })
    .catch(function(e) {
        console.error('❌ ERREUR FATALE:', e.message);
        console.error(e.stack);
        process.exit(1);
    });
