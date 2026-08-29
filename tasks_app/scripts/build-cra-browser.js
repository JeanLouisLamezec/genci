#!/usr/bin/env node
/* ============================================================================
 * build-cra-browser.js — Bundler navigateur pour le workflow CRA
 * ----------------------------------------------------------------------------
 * Ce script bundle les modules CommonJS du workflow CRA en un seul fichier
 * utilisable dans le navigateur, sans dépendance externe.
 * 
 * Il utilise une approche simple de résolution de dépendances :
 * 1. Lire tous les modules requis
 * 2. Résoudre les require() par un système de registry
 * 3. Exposer un global window.TaskFlowCra
 * 
 * Usage : npm run build:cra-browser
 * ============================================================================ */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const CORE_DIR = path.join(ROOT_DIR, 'core');
const OUTPUT_DIR = path.join(CORE_DIR, 'generated');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'taskflow-cra-browser.js');

// Modules à bundler (dans l'ordre de dépendance)
const MODULES = [
  { path: path.join(CORE_DIR, 'planning', 'planning-engine.js') },
  { path: path.join(CORE_DIR, 'cra', 'workflow', 'cra-sheet-workflow.js') },
  { path: path.join(CORE_DIR, 'cra', 'workflow', 'cra-weekly-sheet.js') },
  { path: path.join(CORE_DIR, 'timesheets', 'timesheet-validator.js') },
  { path: path.join(CORE_DIR, 'cra', 'workflow', 'cra-sheet-validation-service.js') },
  { path: path.join(CORE_DIR, 'cra', 'ui', 'cra-sheet-ui-adapter.js') },
  { path: path.join(CORE_DIR, 'cra', 'manager', 'cra-manager-workspace.js') }
];

// Générer les IDs à partir des chemins
MODULES.forEach(mod => {
  const normalizedPath = path.relative(CORE_DIR, mod.path).replace(/\\/g, '/');
  mod.id = normalizedPath.replace(/\.js$/, '').replace(/^\//, '');
});

// Registry des modules compilés
const moduleRegistry = new Map();

/**
 * Lit et transforme un module CommonJS pour le navigateur
 */
function readAndTransformModule(moduleId, filePath, baseDir = CORE_DIR) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Module non trouvé: ${filePath}`);
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Supprimer les commentaires de première ligne (shebang, etc.)
  content = content.replace(/^#!.*\n/, '');
  
  // Supprimer 'use strict' en début de fichier (on le mettra au niveau du bundle)
  content = content.replace(/^\s*'use strict';?\s*/m, '');
  
  // Fonction pour résoudre un chemin relatif et retourner l'ID du module
  function resolveRequire(match, modulePath, dir) {
    if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
      const resolved = path.resolve(dir, modulePath);
      const normalizedPath = path.relative(baseDir, resolved).replace(/\\/g, '/');
      const moduleKey = normalizedPath.replace(/\.js$/, '').replace(/^\//, '');
      return `__require('${moduleKey}')`;
    }
    return match;
  }
  
  // Remplacer require() par des accès à la registry
  content = content.replace(
    /require\(['"](\.[^'"]+)['"]\)/g,
    (match, modulePath) => {
      const dir = path.dirname(filePath);
      return resolveRequire(match, modulePath, dir);
    }
  );
  
  // Transformer module.exports en retour pour la registry
  content = content.replace(
    /module\.exports\s*=\s*([^;]+);?/g,
    'return $1;'
  );
  
  // Transformer les exports individuels
  content = content.replace(
    /exports\.(\w+)\s*=\s*([^;\n]+);?/g,
    'exports.$1 = $2;'
  );
  
  return content;
}

/**
 * Compile un module et ses dépendances
 */
function compileModule(moduleId, filePath) {
  const code = readAndTransformModule(moduleId, filePath);
  
  // Le code transformé retourne directement les exports
  // Le système de cache est géré au niveau du bundle
  const factoryCode = `(function() {
    var exports = {};
    var __require = function(id) {
      if (!moduleCache.has(id)) {
        if (!moduleFactories.has(id)) {
          throw new Error('Module non résolu: ' + id);
        }
        moduleCache.set(id, moduleFactories.get(id)());
      }
      return moduleCache.get(id);
    };
    
    ${code}
  })`;
  
  return factoryCode;
}

/**
 * Build le bundle complet
 */
function build(options = {}) {
  const outputFile = options.outputFile || OUTPUT_FILE;
  
  console.log('🔨 Build du bundle navigateur CRA...\n');
  
  // Créer le dossier de sortie s'il n'existe pas
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Compiler chaque module dans l'ordre
  for (const mod of MODULES) {
    console.log(`  📦 ${mod.id}...`);
    const factoryCode = compileModule(mod.id, mod.path);
    moduleRegistry.set(mod.id, new Function(`return ${factoryCode}`)());
  }
  
  // Générer le code final du bundle
  const bundleParts = [];
  
  // En-tête
  bundleParts.push(`/* ============================================================================
 * taskflow-cra-browser.js — Bundle navigateur pour le workflow CRA
 * ----------------------------------------------------------------------------
 * Fichier généré automatiquement par scripts/build-cra-browser.js
 * NE PAS EDITER MANUELLEMENT
 * 
 * Usage:
 *   <script src="core/generated/taskflow-cra-browser.js"></script>
 *   const service = window.TaskFlowCra.service;
 * ========================================================================== */

(function(global) {
  'use strict';
  
  // Registry des modules (remplie ci-dessous)
  var moduleFactories = new Map();
  var moduleCache = new Map();
  
  // Fonction require interne avec cache
  function __require(id) {
    if (moduleCache.has(id)) {
      return moduleCache.get(id);
    }
    
    if (!moduleFactories.has(id)) {
      throw new Error('Module non résolu: ' + id);
    }
    
    var exports = moduleFactories.get(id)();
    moduleCache.set(id, exports);
    return exports;
  }
`);

  // Déclarer chaque module dans la registry
  for (const mod of MODULES) {
    const factoryCode = compileModule(mod.id, mod.path);
    bundleParts.push(`
  // Module: ${mod.id}
  moduleFactories.set('${mod.id}', ${factoryCode});`);
  }
  
  // Exposer les exports publics
  bundleParts.push(`
  
  // Exposer l'API publique
  var workflow = __require('cra/workflow/cra-sheet-workflow');
  var weeklySheet = __require('cra/workflow/cra-weekly-sheet');
  var validator = __require('timesheets/timesheet-validator');
  var service = __require('cra/workflow/cra-sheet-validation-service');
  var adapterModule = __require('cra/ui/cra-sheet-ui-adapter');
  var managerModule = __require('cra/manager/cra-manager-workspace');
  
  global.TaskFlowCra = {
    service: {
      submitSheet: service.submitSheet,
      withdrawSheet: service.withdrawSheet,
      validateSheet: service.validateSheet,
      rejectSheet: service.rejectSheet,
      openManagerCorrection: service.openManagerCorrection,
      updateManagerActual: service.updateManagerActual,
      revalidateSheet: service.revalidateSheet,
      ensureWeeklySheet: service.ensureWeeklySheet
    },
    
    workflow: {
      SHEET_STATUS: workflow.SHEET_STATUS,
      normalizeSheetStatus: workflow.normalizeSheetStatus,
      normalizeMemberId: workflow.normalizeMemberId,
      normalizeRevision: workflow.normalizeRevision,
      findUniqueSheetForWeek: workflow.findUniqueSheetForWeek,
      getWeekStartIso: workflow.getWeekStartIso,
      isSheetOwnerEditable: workflow.isSheetOwnerEditable,
      isSheetManagerCorrection: workflow.isSheetManagerCorrection,
      isExpectedValidationManager: workflow.isExpectedValidationManager,
      canManagerEditActual: workflow.canManagerEditActual,
      hasExplicitActual: workflow.hasExplicitActual,
      formatDateUTC: workflow.formatDateUTC,
      gristDateToIso: workflow.gristDateToIso
    },
    
    weeklySheet: {
      resolveWeeklySheetState: weeklySheet.resolveWeeklySheetState,
      buildWeeklySheetCreation: weeklySheet.buildWeeklySheetCreation,
      findEntriesForMemberWeek: weeklySheet.findEntriesForMemberWeek,
      buildOrphanEntryLinkPlan: weeklySheet.buildOrphanEntryLinkPlan,
      buildSheetCreationActions: weeklySheet.buildSheetCreationActions,
      buildEntryLinkActions: weeklySheet.buildEntryLinkActions,
      buildEnsureWeeklySheetActions: weeklySheet.buildEnsureWeeklySheetActions,
      normalizeMemberId: weeklySheet.normalizeMemberId,
      getWeekStartIso: weeklySheet.getWeekStartIso,
      gristDateToIso: weeklySheet.gristDateToIso
    },
    
    createUiAdapter: adapterModule.createUiAdapter,
    
    // Exposer aussi le validateur pour usage direct si nécessaire
    validator: {
      validateTimesheet: validator.validateTimesheet,
      ERROR_CODES: validator.ERROR_CODES
    },
    
    // Espace manager
    managerWorkspace: {
      resolveManagerWorkspaceState: managerModule.resolveManagerWorkspaceState,
      ACCESSIBLE_MANAGER_STATUSES: managerModule.ACCESSIBLE_MANAGER_STATUSES,
      PENDING_STATUSES: managerModule.PENDING_STATUSES
    }
  };
  
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

/* ============================================================================
 * Fin du bundle taskflow-cra-browser.js
 * ========================================================================== */
`);

  // Écrire le fichier
  const bundleContent = bundleParts.join('\n');
  fs.writeFileSync(outputFile, bundleContent, 'utf8');
  
  console.log(`\n✅ Bundle généré: ${outputFile}`);
  console.log(`   Taille: ${(bundleContent.length / 1024).toFixed(2)} KB`);
  
  // Vérification runtime avec vm
  try {
    const vm = require('vm');
    const context = {
      console: console,
      Map: Map,
      Date: Date,
      globalThis: {}
    };
    
    vm.createContext(context);
    vm.runInContext(bundleContent, context);
    
    if (
      !context.globalThis.TaskFlowCra ||
      !context.globalThis.TaskFlowCra.service ||
      typeof context.globalThis.TaskFlowCra.service.submitSheet !== 'function' ||
      typeof context.globalThis.TaskFlowCra.service.updateManagerActual !== 'function' ||
      typeof context.globalThis.TaskFlowCra.service.ensureWeeklySheet !== 'function' ||
      typeof context.globalThis.TaskFlowCra.createUiAdapter !== 'function' ||
      !context.globalThis.TaskFlowCra.managerWorkspace ||
      typeof context.globalThis.TaskFlowCra.managerWorkspace.resolveManagerWorkspaceState !== 'function' ||
      !context.globalThis.TaskFlowCra.weeklySheet ||
      typeof context.globalThis.TaskFlowCra.weeklySheet.resolveWeeklySheetState !== 'function'
    ) {
      throw new Error('TaskFlowCra mal exposé');
    }
    
    console.log('   ✓ Exécution runtime OK');
    console.log('   ✓ TaskFlowCra correctement exposé');
    console.log('   ✓ service.submitSheet disponible');
    console.log('   ✓ service.updateManagerActual disponible');
    console.log('   ✓ service.ensureWeeklySheet disponible');
    console.log('   ✓ createUiAdapter disponible');
    console.log('   ✓ managerWorkspace.resolveManagerWorkspaceState disponible');
    console.log('   ✓ weeklySheet.resolveWeeklySheetState disponible');
  } catch (e) {
    console.error(`❌ Erreur d'exécution: ${e.message}`);
    process.exit(1);
  }
  
  return {
    outputFile,
    content: bundleContent
  };
}

// Exécution
if (require.main === module) {
  build();
}

// Export pour les tests
module.exports = {
  build
};
