#!/usr/bin/env node
/* ============================================================================
 * test-assignees-grist-format.js - Test du format Tasks.assignees pour Grist
 * ============================================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

console.log('==================================================');
console.log('Tests: Format Tasks.assignees pour Grist');
console.log('==================================================\n');

// Charger les services directement
const taskAssignmentServiceCode = fs.readFileSync(
    path.join(__dirname, 'core', 'planning', 'task-assignment-service.js'),
    'utf8'
);

eval(taskAssignmentServiceCode);

const createTaskAssignmentService = global.createTaskAssignmentService;

// Helper pour créer un mock Grist
function createMockGrist(initialTasks) {
    let tasks = initialTasks || [];
    let taskAssignments = [];
    
    return {
        docApi: {
            fetchTable: async function(tableName) {
                if (tableName === 'Tasks') {
                    const result = {};
                    const keys = ['id', 'titre', 'assignees', 'charges'];
                    keys.forEach(key => {
                        result[key] = tasks.map(t => t[key]);
                    });
                    return result;
                }
                if (tableName === 'TaskAssignments') {
                    const result = {};
                    const keys = ['id', 'tache', 'membre', 'heuresAllouees', 'dateDebut', 'dateFin', 'actif', 'modeRepartition'];
                    keys.forEach(key => {
                        result[key] = taskAssignments.map(a => a[key]);
                    });
                    return result;
                }
                if (tableName === 'Team') {
                    return { id: [1, 2], nom: ['Alice', 'Bob'] };
                }
                return { id: [], name: [] };
            },
            
            applyUserActions: async function(actions) {
                console.log('[Mock] applyUserActions:', JSON.stringify(actions, null, 2));
                
                for (const action of actions) {
                    const [type, table, id, data] = action;
                    
                    if (table === 'Tasks' && type === 'UpdateRecord') {
                        const task = tasks.find(t => t.id === id);
                        if (task) {
                            Object.assign(task, data);
                        }
                    }
                    
                    if (table === 'TaskAssignments') {
                        if (type === 'AddRecord') {
                            const newId = Math.max(0, ...taskAssignments.map(a => a.id)) + 1;
                            taskAssignments.push({ ...data, id: newId });
                        }
                        if (type === 'UpdateRecord') {
                            const assignment = taskAssignments.find(a => a.id === id);
                            if (assignment) {
                                Object.assign(assignment, data);
                            }
                        }
                        if (type === 'RemoveRecord') {
                            taskAssignments = taskAssignments.filter(a => a.id !== id);
                        }
                    }
                }
                
                return { retValues: [] };
            }
        }
    };
}

let testsPassed = 0;
let testsFailed = 0;

async function runTest(name, testFn) {
    console.log('\n=== ' + name + ' ===');
    try {
        await testFn();
        console.log('✅ TEST RÉUSSI');
        testsPassed++;
    } catch (e) {
        console.error('❌ TEST ÉCHOUÉ:', e.message);
        console.error(e.stack);
        testsFailed++;
    }
}

// TEST 1: Alice seule → ['L', 1]
async function test1_aliceOnly() {
    const mockGrist = createMockGrist([
        { id: 1, titre: 'Task A', assignees: ['L', 1], charges: '[{"teamId":1,"heures":35}]' }
    ]);
    
    const service = createTaskAssignmentService(mockGrist, { logEnabled: false });
    
    // Créer une affectation pour Alice
    const result = await service.syncTaskAssignments(1, [{
        memberId: 1,
        allocatedHours: 35,
        startDate: 1700000000,
        endDate: 1700086400,
        distributionMode: 'uniforme',
        active: true,
        comment: ''
    }], { updateLegacy: true });
    
    console.log('Result:', result);
    
    // Vérifier que assignees a été écrit correctement
    const tasksTable = await mockGrist.docApi.fetchTable('Tasks');
    const assignees = tasksTable.assignees[0];
    
    console.log('Tasks.assignees:', JSON.stringify(assignees));
    
    if (!Array.isArray(assignees)) {
        throw new Error('assignees should be an array, got: ' + typeof assignees);
    }
    
    if (assignees.length !== 2 || assignees[0] !== 'L' || assignees[1] !== 1) {
        throw new Error('Expected [\'L\', 1], got: ' + JSON.stringify(assignees));
    }
    
    console.log('✓ Format correct: [\'L\', 1]');
}

// TEST 2: Alice + Bob → ['L', 1, 2]
async function test2_aliceAndBob() {
    const mockGrist = createMockGrist([
        { id: 1, titre: 'Task A', assignees: ['L'], charges: '[]' }
    ]);
    
    const service = createTaskAssignmentService(mockGrist, { logEnabled: false });
    
    // Créer des affectations pour Alice et Bob
    const result = await service.syncTaskAssignments(1, [
        {
            memberId: 1,
            allocatedHours: 20,
            startDate: 1700000000,
            endDate: 1700086400,
            distributionMode: 'uniforme',
            active: true,
            comment: ''
        },
        {
            memberId: 2,
            allocatedHours: 15,
            startDate: 1700000000,
            endDate: 1700086400,
            distributionMode: 'uniforme',
            active: true,
            comment: ''
        }
    ], { updateLegacy: true });
    
    console.log('Result:', result);
    
    // Vérifier que assignees a été écrit correctement
    const tasksTable = await mockGrist.docApi.fetchTable('Tasks');
    const assignees = tasksTable.assignees[0];
    
    console.log('Tasks.assignees:', JSON.stringify(assignees));
    
    if (!Array.isArray(assignees)) {
        throw new Error('assignees should be an array');
    }
    
    if (assignees.length !== 3 || assignees[0] !== 'L' || assignees[1] !== 1 || assignees[2] !== 2) {
        throw new Error('Expected [\'L\', 1, 2], got: ' + JSON.stringify(assignees));
    }
    
    console.log('✓ Format correct: [\'L\', 1, 2]');
}

// TEST 3: Bob seul → ['L', 2]
async function test3_bobOnly() {
    const mockGrist = createMockGrist([
        { id: 1, titre: 'Task A', assignees: ['L', 1, 2], charges: '[{"teamId":1,"heures":20},{"teamId":2,"heures":15}]' }
    ]);
    
    const service = createTaskAssignmentService(mockGrist, { logEnabled: false });
    
    // Mettre à jour pour ne garder que Bob (désactiver Alice)
    const result = await service.syncTaskAssignments(1, [
        {
            memberId: 1,
            allocatedHours: 0,
            startDate: 1700000000,
            endDate: 1700086400,
            distributionMode: 'uniforme',
            active: false,
            comment: ''
        },
        {
            memberId: 2,
            allocatedHours: 35,
            startDate: 1700000000,
            endDate: 1700086400,
            distributionMode: 'uniforme',
            active: true,
            comment: ''
        }
    ], { updateLegacy: true });
    
    console.log('Result:', result);
    
    // Vérifier que assignees a été mis à jour correctement
    const tasksTable = await mockGrist.docApi.fetchTable('Tasks');
    const assignees = tasksTable.assignees[0];
    
    console.log('Tasks.assignees:', JSON.stringify(assignees));
    
    if (!Array.isArray(assignees)) {
        throw new Error('assignees should be an array');
    }
    
    if (assignees.length !== 2 || assignees[0] !== 'L' || assignees[1] !== 2) {
        throw new Error('Expected [\'L\', 2], got: ' + JSON.stringify(assignees));
    }
    
    console.log('✓ Format correct: [\'L\', 2]');
}

// TEST 4: Aucun membre → ['L']
async function test4_noMembers() {
    const mockGrist = createMockGrist([
        { id: 1, titre: 'Task A', assignees: ['L', 1], charges: '[{"teamId":1,"heures":35}]' }
    ]);
    
    const service = createTaskAssignmentService(mockGrist, { logEnabled: false });
    
    // Désactiver toutes les affectations
    const result = await service.syncTaskAssignments(1, [], { updateLegacy: true });
    
    console.log('Result:', result);
    
    // Vérifier que assignees a été mis à jour correctement
    const tasksTable = await mockGrist.docApi.fetchTable('Tasks');
    const assignees = tasksTable.assignees[0];
    
    console.log('Tasks.assignees:', JSON.stringify(assignees));
    
    if (!Array.isArray(assignees)) {
        throw new Error('assignees should be an array');
    }
    
    if (assignees.length !== 1 || assignees[0] !== 'L') {
        throw new Error('Expected [\'L\'], got: ' + JSON.stringify(assignees));
    }
    
    console.log('✓ Format correct: [\'L\']');
}

// TEST 5: Idempotence - deuxième synchronisation identique
async function test5_idempotence() {
    const mockGrist = createMockGrist([
        { id: 1, titre: 'Task A', assignees: ['L', 1], charges: '[{"teamId":1,"heures":35}]' }
    ]);
    
    const service = createTaskAssignmentService(mockGrist, { logEnabled: false });
    
    // Première synchronisation
    const result1 = await service.syncTaskAssignments(1, [{
        memberId: 1,
        allocatedHours: 35,
        startDate: 1700000000,
        endDate: 1700086400,
        distributionMode: 'uniforme',
        active: true,
        comment: ''
    }], { updateLegacy: true });
    
    console.log('First sync:', result1);
    console.log('  actionsExecuted:', result1.actionsExecuted);
    
    // Deuxième synchronisation (identique)
    const result2 = await service.syncTaskAssignments(1, [{
        memberId: 1,
        allocatedHours: 35,
        startDate: 1700000000,
        endDate: 1700086400,
        distributionMode: 'uniforme',
        active: true,
        comment: ''
    }], { updateLegacy: true });
    
    console.log('Second sync:', result2);
    console.log('  actionsExecuted:', result2.actionsExecuted);
    
    if (result2.actionsExecuted !== 0) {
        throw new Error('Second sync should execute 0 actions (idempotent), got: ' + result2.actionsExecuted);
    }
    
    console.log('✓ Idempotence vérifiée: 0 actions lors de la 2ème synchro');
}

// TEST 6: Réparation #KeyError
async function test6_keyErrorRepair() {
    const mockGrist = createMockGrist([
        { id: 1, titre: 'Task A', assignees: '#KeyError: Team', charges: '[]' }
    ]);
    
    const service = createTaskAssignmentService(mockGrist, { logEnabled: false });
    
    // Créer une affectation pour réparer
    const result = await service.syncTaskAssignments(1, [{
        memberId: 1,
        allocatedHours: 35,
        startDate: 1700000000,
        endDate: 1700086400,
        distributionMode: 'uniforme',
        active: true,
        comment: ''
    }], { updateLegacy: true });
    
    console.log('Result:', result);
    
    // Vérifier que assignees a été réparé
    const tasksTable = await mockGrist.docApi.fetchTable('Tasks');
    const assignees = tasksTable.assignees[0];
    
    console.log('Tasks.assignees:', JSON.stringify(assignees));
    
    if (!Array.isArray(assignees)) {
        throw new Error('assignees should be an array after repair');
    }
    
    if (assignees.length !== 2 || assignees[0] !== 'L' || assignees[1] !== 1) {
        throw new Error('Expected [\'L\', 1] after repair, got: ' + JSON.stringify(assignees));
    }
    
    console.log('✓ #KeyError réparé: [\'L\', 1]');
}

// Exécuter tous les tests
(async function() {
    await runTest('TEST 1: Alice seule → [\'L\', 1]', test1_aliceOnly);
    await runTest('TEST 2: Alice + Bob → [\'L\', 1, 2]', test2_aliceAndBob);
    await runTest('TEST 3: Bob seul → [\'L\', 2]', test3_bobOnly);
    await runTest('TEST 4: Aucun membre → [\'L\']', test4_noMembers);
    await runTest('TEST 5: Idempotence', test5_idempotence);
    await runTest('TEST 6: Réparation #KeyError', test6_keyErrorRepair);
    
    console.log('\n==================================================');
    console.log('RÉSULTATS FINAUX');
    console.log('==================================================');
    console.log('Tests réussis:', testsPassed + '/' + (testsPassed + testsFailed));
    console.log('Tests échoués:', testsFailed + '/' + (testsPassed + testsFailed));
    console.log('==================================================\n');
    
    if (testsFailed > 0) {
        process.exit(1);
    } else {
        console.log('✅ TOUS LES TESTS SONT PASSÉS');
        process.exit(0);
    }
})();
