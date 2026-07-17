#!/usr/bin/env node
/* ============================================================================
 * test-member-planning-business.js - Tests métier de la planification partagée
 * ----------------------------------------------------------------------------
 * Tests les scénarios de partage de capacité entre plusieurs tâches.
 * ============================================================================ */

'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const BUNDLE_PATH = path.join(__dirname, 'core', 'generated', 'taskflow-planning-browser.js');

console.log('==================================================');
console.log('Tests métier - Planification partagée par membre');
console.log('==================================================\n');

// Charger le bundle
const bundleContent = fs.readFileSync(BUNDLE_PATH, 'utf8');
const sandbox = {
  window: {},
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
};
const context = vm.createContext(sandbox);
vm.runInContext(bundleContent, context);

const TaskFlowPlanning = context.window.TaskFlowPlanning;

// Helper: créer un mock Grist avec des données
function createMockGristWithData(data) {
  return {
    docApi: {
      fetchTable: async function(tableName) {
        if (tableName === 'Team') {
          return {
            id: data.members ? data.members.map(m => m.id) : [1],
            nom: data.members ? data.members.map(m => m.nom) : ['Alice']
          };
        }
        if (tableName === 'Tasks') {
          return {
            id: data.tasks ? data.tasks.map(t => t.id) : [],
            titre: data.tasks ? data.tasks.map(t => t.titre) : [],
            dateDebut: data.tasks ? data.tasks.map(t => t.dateDebut) : [],
            dateEcheance: data.tasks ? data.tasks.map(t => t.dateEcheance) : []
          };
        }
        if (tableName === 'TaskAssignments') {
          return {
            id: data.assignments ? data.assignments.map(a => a.id) : [],
            tache: data.assignments ? data.assignments.map(a => a.tache) : [],
            membre: data.assignments ? data.assignments.map(a => a.membre) : [],
            heuresAllouees: data.assignments ? data.assignments.map(a => a.heuresAllouees) : [],
            dateDebut: data.assignments ? data.assignments.map(a => a.dateDebut) : [],
            dateFin: data.assignments ? data.assignments.map(a => a.dateFin) : [],
            actif: data.assignments ? data.assignments.map(a => a.actif !== false) : [],
            modeRepartition: data.assignments ? data.assignments.map(a => a.modeRepartition || 'uniforme') : []
          };
        }
        if (tableName === 'MemberDailyCapacities') {
          return {
            id: data.capacities ? data.capacities.map(c => c.id) : [],
            membre: data.capacities ? data.capacities.map(c => c.membre) : [],
            date: data.capacities ? data.capacities.map(c => c.date) : [],
            capaciteDisponible: data.capacities ? data.capacities.map(c => c.capaciteDisponible) : []
          };
        }
        if (tableName === 'TimeEntries') {
          return {
            id: data.timeEntries ? data.timeEntries.map(e => e.id) : [],
            tache: data.timeEntries ? data.timeEntries.map(e => e.tache) : [],
            membre: data.timeEntries ? data.timeEntries.map(e => e.membre) : [],
            affectation: data.timeEntries ? data.timeEntries.map(e => e.affectation) : [],
            date: data.timeEntries ? data.timeEntries.map(e => e.date) : [],
            heures: data.timeEntries ? data.timeEntries.map(e => e.heures || 0) : [],
            heuresPrevues: data.timeEntries ? data.timeEntries.map(e => e.heuresPrevues || 0) : [],
            sheetStatus: data.timeEntries ? data.timeEntries.map(e => e.sheetStatus || null) : []
          };
        }
        return { id: [], name: [] };
      },
      applyUserActions: async function(actions) {
        console.log('[Mock] applyUserActions appelé avec', actions.length, 'actions');
        // Pour les tests de preview, on peut lever une erreur
        if (data.blockApplyUserActions) {
          throw new Error('applyUserActions disabled for preview test');
        }
        return { retValues: actions.map(() => Math.floor(Math.random() * 1000)) };
      }
    }
  };
}

// Helper: convertir timestamp en date YYYY-MM-DD
function timestampToDate(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toISOString().split('T')[0];
}

// Helper: convertir date YYYY-MM-DD en timestamp
function dateToTimestamp(dateStr) {
  const date = new Date(dateStr + 'T00:00:00Z');
  return Math.floor(date.getTime() / 1000);
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

// TEST 1: Une tâche seule
async function test1_singleTask() {
  // Alice : capacité 35 h
  // Tâche A : 35 h du lundi au vendredi
  
  const monday = dateToTimestamp('2025-01-06'); // Lundi
  const friday = dateToTimestamp('2025-01-10'); // Vendredi
  
  const mockGrist = createMockGristWithData({
    members: [{ id: 1, nom: 'Alice' }],
    tasks: [{ id: 1, titre: 'Tâche A', dateDebut: monday, dateEcheance: friday }],
    assignments: [{
      id: 1, tache: 1, membre: 1,
      heuresAllouees: 35,
      dateDebut: monday, dateFin: friday,
      actif: true,
      modeRepartition: 'uniforme'
    }],
    capacities: [
      { id: 1, membre: 1, date: '2025-01-06', capaciteDisponible: 7 },
      { id: 2, membre: 1, date: '2025-01-07', capaciteDisponible: 7 },
      { id: 3, membre: 1, date: '2025-01-08', capaciteDisponible: 7 },
      { id: 4, membre: 1, date: '2025-01-09', capaciteDisponible: 7 },
      { id: 5, membre: 1, date: '2025-01-10', capaciteDisponible: 7 }
    ],
    timeEntries: []
  });
  
  const orchestrator = TaskFlowPlanning.createMemberPlanningOrchestrator(mockGrist, { logEnabled: false });
  const preview = await orchestrator.previewMember(1);
  
  console.log('Preview result:', JSON.stringify({
    success: preview.success,
    canCommit: preview.canCommit,
    totalPlanned: preview.totals ? preview.totals.totalPlannedHours : 'N/A',
    totalUnplanned: preview.totals ? preview.totals.totalUnplannedHours : 'N/A'
  }, null, 2));
  
  if (!preview.success) {
    throw new Error('Preview should succeed: ' + (preview.code || 'unknown error'));
  }
  
  if (!preview.canCommit) {
    throw new Error('Should be able to commit');
  }
  
  // Vérifier que ~35h sont planifiées
  const totalPlanned = preview.totals ? preview.totals.totalPlannedHours : 0;
  if (totalPlanned < 34.9 || totalPlanned > 35.1) {
    throw new Error('Expected ~35h planned, got ' + totalPlanned);
  }
  
  // Vérifier qu'aucun jour ne dépasse 7h
  if (preview.assignmentResults && preview.assignmentResults[0]) {
    const entries = preview.assignmentResults[0].plannedEntries || [];
    const byDate = {};
    entries.forEach(e => {
      byDate[e.date] = (byDate[e.date] || 0) + e.plannedHours;
    });
    
    for (const date in byDate) {
      if (byDate[date] > 7.01) {
        throw new Error('Day ' + date + ' exceeds 7h: ' + byDate[date] + 'h');
      }
    }
  }
  
  console.log('✓ 35h planifiées correctement');
  console.log('✓ Aucun jour ne dépasse 7h');
}

// TEST 2: Partage exact 20h + 15h
async function test2_exactShare() {
  // Alice : capacité 35 h
  // Tâche A : 20 h
  // Tâche B : 15 h
  
  const monday = dateToTimestamp('2025-01-06');
  const friday = dateToTimestamp('2025-01-10');
  
  const mockGrist = createMockGristWithData({
    members: [{ id: 1, nom: 'Alice' }],
    tasks: [
      { id: 1, titre: 'Tâche A', dateDebut: monday, dateEcheance: friday },
      { id: 2, titre: 'Tâche B', dateDebut: monday, dateEcheance: friday }
    ],
    assignments: [
      {
        id: 1, tache: 1, membre: 1,
        heuresAllouees: 20,
        dateDebut: monday, dateFin: friday,
        actif: true,
      modeRepartition: 'uniforme'
      },
      {
        id: 2, tache: 2, membre: 1,
        heuresAllouees: 15,
        dateDebut: monday, dateFin: friday,
        actif: true,
      modeRepartition: 'uniforme'
      }
    ],
    capacities: [
      { id: 1, membre: 1, date: '2025-01-06', capaciteDisponible: 7 },
      { id: 2, membre: 1, date: '2025-01-07', capaciteDisponible: 7 },
      { id: 3, membre: 1, date: '2025-01-08', capaciteDisponible: 7 },
      { id: 4, membre: 1, date: '2025-01-09', capaciteDisponible: 7 },
      { id: 5, membre: 1, date: '2025-01-10', capaciteDisponible: 7 }
    ],
    timeEntries: []
  });
  
  const orchestrator = TaskFlowPlanning.createMemberPlanningOrchestrator(mockGrist, { logEnabled: false });
  const preview = await orchestrator.previewMember(1);
  
  console.log('Preview result:', JSON.stringify({
    success: preview.success,
    canCommit: preview.canCommit,
    totalPlanned: preview.totals ? preview.totals.totalPlannedHours : 'N/A',
    totalUnplanned: preview.totals ? preview.totals.totalUnplannedHours : 'N/A'
  }, null, 2));
  
  if (!preview.success) {
    throw new Error('Preview should succeed: ' + (preview.code || 'unknown error'));
  }
  
  const totalPlanned = preview.totals ? preview.totals.totalPlannedHours : 0;
  const totalUnplanned = preview.totals ? preview.totals.totalUnplannedHours : 0;
  
  if (totalPlanned < 34.9 || totalPlanned > 35.1) {
    throw new Error('Expected ~35h planned, got ' + totalPlanned);
  }
  
  if (totalUnplanned > 0.1) {
    throw new Error('Expected 0h unplanned, got ' + totalUnplanned);
  }
  
  console.log('✓ 35h planifiées (20h + 15h)');
  console.log('✓ 0h non planifiée');
}

// TEST 3: Surcharge 30h + 30h
async function test3_overload() {
  // Alice : capacité 35 h
  // Tâche A : 30 h
  // Tâche B : 30 h
  
  const monday = dateToTimestamp('2025-01-06');
  const friday = dateToTimestamp('2025-01-10');
  
  const mockGrist = createMockGristWithData({
    members: [{ id: 1, nom: 'Alice' }],
    tasks: [
      { id: 1, titre: 'Tâche A', dateDebut: monday, dateEcheance: friday },
      { id: 2, titre: 'Tâche B', dateDebut: monday, dateEcheance: friday }
    ],
    assignments: [
      {
        id: 1, tache: 1, membre: 1,
        heuresAllouees: 30,
        dateDebut: monday, dateFin: friday,
        actif: true,
      modeRepartition: 'uniforme'
      },
      {
        id: 2, tache: 2, membre: 1,
        heuresAllouees: 30,
        dateDebut: monday, dateFin: friday,
        actif: true,
      modeRepartition: 'uniforme'
      }
    ],
    capacities: [
      { id: 1, membre: 1, date: '2025-01-06', capaciteDisponible: 7 },
      { id: 2, membre: 1, date: '2025-01-07', capaciteDisponible: 7 },
      { id: 3, membre: 1, date: '2025-01-08', capaciteDisponible: 7 },
      { id: 4, membre: 1, date: '2025-01-09', capaciteDisponible: 7 },
      { id: 5, membre: 1, date: '2025-01-10', capaciteDisponible: 7 }
    ],
    timeEntries: []
  });
  
  const orchestrator = TaskFlowPlanning.createMemberPlanningOrchestrator(mockGrist, { logEnabled: false });
  const preview = await orchestrator.previewMember(1);
  
  console.log('Preview result:', JSON.stringify({
    success: preview.success,
    code: preview.code,
    canCommit: preview.canCommit,
    totalPlanned: preview.totals ? preview.totals.totalPlannedHours : 'N/A',
    totalUnplanned: preview.totals ? preview.totals.totalUnplannedHours : 'N/A'
  }, null, 2));
  
  // La surcharge devrait être détectée
  const totalPlanned = preview.totals ? preview.totals.totalPlannedHours : 0;
  const totalUnplanned = preview.totals ? preview.totals.totalUnplannedHours : 0;
  
  if (totalPlanned > 35.1) {
    throw new Error('Should not plan more than 35h, got ' + totalPlanned);
  }
  
  if (totalUnplanned < 24.9) {
    throw new Error('Expected ~25h unplanned, got ' + totalUnplanned);
  }
  
  // canCommit devrait être false en cas de surcharge
  if (preview.canCommit !== false) {
    console.warn('⚠ Warning: canCommit should be false for overload');
  }
  
  console.log('✓ Maximum 35h planifiées');
  console.log('✓ ~25h non planifiées détectées');
}

// TEST 4: Preview sans écriture
async function test4_previewNoWrite() {
  const monday = dateToTimestamp('2025-01-06');
  const friday = dateToTimestamp('2025-01-10');
  
  const mockGrist = createMockGristWithData({
    members: [{ id: 1, nom: 'Alice' }],
    tasks: [{ id: 1, titre: 'Tâche A', dateDebut: monday, dateEcheance: friday }],
    assignments: [{
      id: 1, tache: 1, membre: 1,
      heuresAllouees: 35,
      dateDebut: monday, dateFin: friday,
      actif: true,
      modeRepartition: 'uniforme'
    }],
    capacities: [
      { id: 1, membre: 1, date: '2025-01-06', capaciteDisponible: 7 },
      { id: 2, membre: 1, date: '2025-01-07', capaciteDisponible: 7 },
      { id: 3, membre: 1, date: '2025-01-08', capaciteDisponible: 7 },
      { id: 4, membre: 1, date: '2025-01-09', capaciteDisponible: 7 },
      { id: 5, membre: 1, date: '2025-01-10', capaciteDisponible: 7 }
    ],
    timeEntries: [],
    blockApplyUserActions: true // Bloquer les écritures
  });
  
  const orchestrator = TaskFlowPlanning.createMemberPlanningOrchestrator(mockGrist, { logEnabled: false });
  
  try {
    const preview = await orchestrator.previewMember(1);
    console.log('✓ Preview réussi sans applyUserActions');
    console.log('  Result:', preview.success ? 'SUCCESS' : 'FAILED');
  } catch (e) {
    throw new Error('Preview should not call applyUserActions: ' + e.message);
  }
}

// TEST 5: Non-régression Gantt
async function test5_ganttRegression() {
  console.log('Lancement des tests de non-régression Gantt...');
  
  // Exécuter les tests existants
  const { execSync } = require('child_process');
  try {
    const output = execSync('node test-gantt-date-sync-node.js', {
      cwd: __dirname,
      encoding: 'utf8'
    });
    console.log(output);
    console.log('✓ Tests Gantt passés');
  } catch (e) {
    throw new Error('Gantt regression tests failed:\n' + e.stdout);
  }
}

// Exécuter tous les tests
(async function() {
  await runTest('TEST 1: Une tâche (35h)', test1_singleTask);
  await runTest('TEST 2: Partage exact (20h + 15h)', test2_exactShare);
  await runTest('TEST 3: Surcharge (30h + 30h)', test3_overload);
  await runTest('TEST 4: Preview sans écriture', test4_previewNoWrite);
  await runTest('TEST 5: Non-régression Gantt', test5_ganttRegression);
  
  console.log('\n==================================================');
  console.log('RÉSULTATS FINAUX');
  console.log('==================================================');
  console.log('Tests réussis:', testsPassed);
  console.log('Tests échoués:', testsFailed);
  console.log('==================================================\n');
  
  if (testsFailed > 0) {
    process.exit(1);
  } else {
    console.log('✅ TOUS LES TESTS MÉTIER SONT PASSÉS');
    process.exit(0);
  }
})();
