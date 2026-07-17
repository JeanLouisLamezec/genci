#!/usr/bin/env node
/* ============================================================================
 * test-bundle-evaluation.js - Teste l'évaluation du bundle dans une VM
 * ----------------------------------------------------------------------------
 * Vérifie que le bundle peut être évalué sans erreur et expose correctement
 * l'API publique TaskFlowPlanning.
 * ============================================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BUNDLE_PATH = path.join(__dirname, 'core', 'generated', 'taskflow-planning-browser.js');

console.log('==================================================');
console.log('Test: Évaluation du bundle dans une VM');
console.log('==================================================\n');

// Lire le bundle
let bundleContent;
try {
  bundleContent = fs.readFileSync(BUNDLE_PATH, 'utf8');
  console.log('✓ Bundle lu:', BUNDLE_PATH);
  console.log('  Taille:', (bundleContent.length / 1024).toFixed(2), 'KB\n');
} catch (e) {
  console.error('❌ Échec lecture bundle:', e.message);
  process.exit(1);
}

// Créer un contexte VM simulé (sans require global)
const sandbox = {
  window: {},
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval
};

// IMPORTANT: Ne PAS exposer require dans le contexte
// Cela simule un environnement navigateur pur
const context = vm.createContext(sandbox);

console.log('Évaluation du bundle dans une VM sans require global...\n');

try {
  // Évaluer le bundle
  vm.runInContext(bundleContent, context, {
    filename: 'taskflow-planning-browser.js',
    timeout: 5000
  });
  
  console.log('✓ Bundle évalué avec succès\n');
  
  // Vérifier que TaskFlowPlanning est exposé
  const TaskFlowPlanning = context.window.TaskFlowPlanning;
  
  if (!TaskFlowPlanning) {
    console.error('❌ TaskFlowPlanning non exposé sur window');
    process.exit(1);
  }
  
  console.log('✓ TaskFlowPlanning exposé sur window\n');
  
  // Vérifier les exports attendus
  const expectedExports = [
    'createWidgetPlanningService',
    'createMemberPlanningOrchestrator',
    'summarizeGristActions',
    'isBlockingDiagnostic'
  ];
  
  let allPresent = true;
  expectedExports.forEach(function(exportName) {
    if (typeof TaskFlowPlanning[exportName] === 'function') {
      console.log('✓', exportName, 'est une fonction');
    } else {
      console.error('✗', exportName, 'manquant ou non fonction');
      allPresent = false;
    }
  });
  
  if (!allPresent) {
    console.error('\n❌ Certains exports sont manquants');
    process.exit(1);
  }
  
  console.log('\n==================================================');
  console.log('✅ TOUS LES TESTS SONT PASSÉS');
  console.log('==================================================\n');
  
  // Test supplémentaire: essayer d'instancier un service
  console.log('Test: Instanciation d\'un mock Grist...\n');
  
  const mockGrist = {
    docApi: {
      fetchTable: async function(tableName) {
        return { id: [], name: [] };
      },
      applyUserActions: async function(actions) {
        return { retValues: [] };
      }
    }
  };
  
  try {
    const orchestrator = TaskFlowPlanning.createMemberPlanningOrchestrator(mockGrist, { logEnabled: false });
    console.log('✓ createMemberPlanningOrchestrator fonctionne');
    console.log('  Methods:', Object.keys(orchestrator).join(', '));
    
    const widgetService = TaskFlowPlanning.createWidgetPlanningService(mockGrist);
    console.log('✓ createWidgetPlanningService fonctionne');
    console.log('  Methods:', Object.keys(widgetService).join(', '));
    
    console.log('\n==================================================');
    console.log('✅ TESTS D\'INSTANCIATION RÉUSSIS');
    console.log('==================================================\n');
  } catch (e) {
    console.error('❌ Erreur instanciation:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
  
} catch (e) {
  console.error('❌ Échec évaluation bundle:', e.message);
  console.error('  Ligne:', e.lineNumber);
  console.error('  Colonne:', e.columnNumber);
  console.error(e.stack);
  process.exit(1);
}
