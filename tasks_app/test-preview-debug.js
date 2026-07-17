#!/usr/bin/env node
/* ============================================================================
 * test-preview-debug.js - Débogage de previewMember
 * ============================================================================ */

'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const BUNDLE_PATH = path.join(__dirname, 'core', 'generated', 'taskflow-planning-browser.js');

console.log('Débogage previewMember...\n');

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

const monday = Math.floor(new Date('2025-01-06T00:00:00Z').getTime() / 1000);
const friday = Math.floor(new Date('2025-01-10T00:00:00Z').getTime() / 1000);

const mockGrist = {
  docApi: {
    fetchTable: async function(tableName) {
      console.log('[Mock] fetchTable:', tableName);
      
      if (tableName === 'Team') {
        return { id: [1], nom: ['Alice'] };
      }
      if (tableName === 'Tasks') {
        return { 
          id: [1], 
          titre: ['Tâche A'],
          dateDebut: [monday],
          dateEcheance: [friday]
        };
      }
      if (tableName === 'TaskAssignments') {
        return {
          id: [1],
          tache: [1],
          membre: [1],
          heuresAllouees: [35],
          dateDebut: [monday],
          dateFin: [friday],
          actif: [true]
        };
      }
      if (tableName === 'MemberDailyCapacities') {
        return {
          id: [1, 2, 3, 4, 5],
          membre: [1, 1, 1, 1, 1],
          date: ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10'],
          capaciteDisponible: [7, 7, 7, 7, 7]
        };
      }
      if (tableName === 'TimeEntries') {
        return { id: [], tache: [], membre: [], affectation: [], date: [], heures: [], heuresPrevues: [], feuille: [], sheetStatus: [] };
      }
      if (tableName === 'Feuilles') {
        return { id: [], membre: [], semaine: [], statut: [] };
      }
      if (tableName === 'Disponibilites') {
        return { id: [], membre: [], type: [], dateDebut: [], dateFin: [], dispo: [] };
      }
      
      return { id: [], name: [] };
    },
    applyUserActions: async function(actions) {
      console.log('[Mock] applyUserActions:', actions.length, 'actions');
      return { retValues: [] };
    }
  }
};

(async () => {
  try {
    const orchestrator = TaskFlowPlanning.createMemberPlanningOrchestrator(mockGrist, { logEnabled: true });
    
    console.log('\n=== Appel previewMember(1) ===\n');
    const preview = await orchestrator.previewMember(1);
    
    console.log('\n=== Résultat ===');
    console.log('success:', preview.success);
    console.log('code:', preview.code);
    console.log('message:', preview.message);
    console.log('canCommit:', preview.canCommit);
    console.log('totals:', JSON.stringify(preview.totals, null, 2));
    console.log('assignmentResults:', preview.assignmentResults ? preview.assignmentResults.length : 0, 'results');
    
    if (preview.assignmentResults && preview.assignmentResults[0]) {
      console.log('\nPremier résultat:');
      console.log('  assignmentId:', preview.assignmentResults[0].assignmentId);
      console.log('  success:', preview.assignmentResults[0].success);
      console.log('  plannedEntries:', preview.assignmentResults[0].plannedEntries ? preview.assignmentResults[0].plannedEntries.length : 0);
      console.log('  error:', preview.assignmentResults[0].error);
      console.log('  diagnostics:', preview.assignmentResults[0].diagnostics);
    }
    
    if (!preview.success) {
      console.error('\n❌ PREVIEW ÉCHOUÉ');
      process.exit(1);
    } else {
      console.log('\n✅ PREVIEW RÉUSSI');
      process.exit(0);
    }
  } catch (e) {
    console.error('\n❌ ERREUR:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
