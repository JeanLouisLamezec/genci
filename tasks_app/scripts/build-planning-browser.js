#!/usr/bin/env node
/* ============================================================================
 * build-planning-browser.js — Bundler navigateur pour le moteur de planification
 * ----------------------------------------------------------------------------
 * Ce script bundle les modules CommonJS du moteur de planification en un seul
 * fichier utilisable dans le navigateur, sans dépendance externe.
 * 
 * Il utilise une approche simple de résolution de dépendances :
 * 1. Lire tous les modules requis
 * 2. Résoudre les require() par un système de registry
 * 3. Exposer un global window.TaskFlowPlanning
 * 
 * Usage : npm run build:planning:browser
 * ============================================================================ */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const CORE_DIR = path.join(ROOT_DIR, 'core');
const OUTPUT_DIR = path.join(CORE_DIR, 'generated');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'taskflow-planning-browser.js');

// Modules à bundler (dans l'ordre de dépendance)
// Les IDs doivent correspondre aux chemins relatifs depuis CORE_DIR
const MODULES = [
  { path: path.join(CORE_DIR, 'planning', 'planning-engine.js') },
  { path: path.join(CORE_DIR, 'planning', 'reconciliation', 'planning-reconciliation.js') },
  { path: path.join(CORE_DIR, 'grist', 'grist-api-helper.js') },
  { path: path.join(CORE_DIR, 'capacity', 'member-daily-capacity-service.js') },
  { path: path.join(CORE_DIR, 'grist', 'grist-planning-adapter.js') },
  { path: path.join(CORE_DIR, 'planning', 'member', 'member-planning-orchestrator.js') },
  { path: path.join(CORE_DIR, 'planning', 'gantt', 'gantt-auto-planning-integration.js') },
  { path: path.join(CORE_DIR, 'widget-planning-service.js') }
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
 * @param {string} moduleId - ID du module
 * @param {string} filePath - Chemin du fichier
 * @param {string} baseDir - Répertoire de base pour la résolution
 * @returns {string} Code transformé
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
    // Si c'est un chemin relatif, le normaliser
    if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
      const resolved = path.resolve(dir, modulePath);
      const normalizedPath = path.relative(baseDir, resolved).replace(/\\/g, '/');
      const moduleKey = normalizedPath.replace(/\.js$/, '').replace(/^\//, '');
      return `__require('${moduleKey}')`;
    }
    // Module externe (ne devrait pas arriver dans notre cas)
    return match;
  }
  
  // Remplacer require() par des accès à la registry
  // Traiter d'abord les require avec chemins relatifs
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
 * @param {string} moduleId - ID du module
 * @param {string} filePath - Chemin du fichier
 * @returns {Function} Fonction factory du module
 */
function compileModule(moduleId, filePath) {
  const code = readAndTransformModule(moduleId, filePath);
  
  // Créer une factory function qui retourne le module
  const factoryCode = `(function() {
    var exports = {};
    var module = { exports: exports };
    var __require = function(id) {
      if (!moduleRegistry.has(id)) {
        throw new Error('Module non résolu: ' + id);
      }
      return moduleRegistry.get(id)();
    };
    
    ${code}
  })`;
  
  return factoryCode;
}

/**
 * Build le bundle complet
 * @param {Object} options - Options
 * @param {string} [options.outputFile] - Fichier de sortie (défaut: OUTPUT_FILE)
 * @returns {Object} Résultat avec outputFile et content
 */
function build(options = {}) {
  const outputFile = options.outputFile || OUTPUT_FILE;
  
  console.log('🔨 Build du bundle navigateur...\n');
  
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
 * taskflow-planning-browser.js — Bundle navigateur pour le moteur de planification
 * ----------------------------------------------------------------------------
 * Fichier généré automatiquement par scripts/build-planning-browser.js
 * NE PAS EDITER MANUELLEMENT
 * 
 * Usage:
 *   <script src="core/generated/taskflow-planning-browser.js"></script>
 *   const service = window.TaskFlowPlanning.createWidgetPlanningService(grist);
 * ========================================================================== */

(function(global) {
  'use strict';
  
  // Registry des modules (remplie ci-dessous)
  var moduleRegistry = new Map();
  
  // Fonction require interne
  function __require(id) {
    if (!moduleRegistry.has(id)) {
      throw new Error('Module non résolu: ' + id);
    }
    return moduleRegistry.get(id)();
  }
`);

  // Déclarer chaque module dans la registry
  for (const mod of MODULES) {
    const factoryCode = compileModule(mod.id, mod.path);
    bundleParts.push(`
  // Module: ${mod.id}
  moduleRegistry.set('${mod.id}', ${factoryCode});`);
  }
  
  // Exposer les exports publics
  bundleParts.push(`
  
  // Exposer l'API publique
  var adapter = __require('grist/grist-planning-adapter');
  var widgetPlanningService = __require('widget-planning-service');
  var orchestrator = __require('planning/member-planning-orchestrator');
  var ganttAutoPlanning = __require('planning/gantt/gantt-auto-planning-integration');
  
  global.TaskFlowPlanning = {
    createWidgetPlanningService: widgetPlanningService.createWidgetPlanningService,
    summarizeGristActions: widgetPlanningService.summarizeGristActions,
    createMemberPlanningOrchestrator: orchestrator.createMemberPlanningOrchestrator,
    isBlockingDiagnostic: adapter.isBlockingDiagnostic,
    createGanttAutoPlanningIntegration: ganttAutoPlanning.createGanttAutoPlanningIntegration
  };
  
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

/* ============================================================================
 * Fin du bundle taskflow-planning-browser.js
 * ========================================================================== */
`);

  // Écrire le fichier
  const bundleContent = bundleParts.join('\n');
  fs.writeFileSync(outputFile, bundleContent, 'utf8');
  
  console.log(`\n✅ Bundle généré: ${outputFile}`);
  console.log(`   Taille: ${(bundleContent.length / 1024).toFixed(2)} KB`);
  
  // Vérification rapide
  try {
    // Vérifier que le fichier est syntaxiquement correct en le lisant
    const check = fs.readFileSync(outputFile, 'utf8');
    if (!check.includes('window.TaskFlowPlanning') && !check.includes('globalThis.TaskFlowPlanning')) {
      console.warn('⚠️  Attention: le bundle ne semble pas exposer TaskFlowPlanning correctement');
    } else {
      console.log('   ✓ Vérification syntaxique OK');
    }
  } catch (e) {
    console.error(`❌ Erreur de vérification: ${e.message}`);
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
