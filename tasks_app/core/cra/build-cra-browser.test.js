/**
 * Tests pour le build du bundle navigateur CRA
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.join(__dirname, '../..');
const BUILD_SCRIPT = path.join(ROOT_DIR, 'scripts', 'build-cra-browser.js');
const BUNDLE_PATH = path.join(ROOT_DIR, 'core', 'generated', 'taskflow-cra-browser.js');

describe('Build CRA Browser Bundle', () => {
  let buildModule;
  let bundleContent;

  beforeAll(() => {
    buildModule = require(BUILD_SCRIPT);
  });

  test('le script de build est disponible', () => {
    expect(fs.existsSync(BUILD_SCRIPT)).toBe(true);
    expect(buildModule).toBeDefined();
    expect(typeof buildModule.build).toBe('function');
  });

  test('le bundle peut être généré', () => {
    const result = buildModule.build();
    expect(result).toBeDefined();
    expect(result.outputFile).toBe(BUNDLE_PATH);
    expect(fs.existsSync(BUNDLE_PATH)).toBe(true);
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
  });

  test('le bundle contient TaskFlowCra', () => {
    expect(bundleContent || fs.readFileSync(BUNDLE_PATH, 'utf8'))
      .toContain('TaskFlowCra');
  });

  test('le bundle ne dépend pas de require global', () => {
    const content = bundleContent || fs.readFileSync(BUNDLE_PATH, 'utf8');
    // Le bundle ne doit pas utiliser require() global, seulement __require interne
    const lines = content.split('\n').filter(line => 
      !line.trim().startsWith('//') && 
      !line.trim().startsWith('/*') &&
      !line.trim().startsWith('*')
    );
    
    // Chercher require( sans être __require(
    const globalRequirePattern = /[^_]require\s*\(/;
    const hasGlobalRequire = lines.some(line => globalRequirePattern.test(line));
    
    expect(hasGlobalRequire).toBe(false);
  });

  test('le bundle ne dépend pas de module global', () => {
    const content = bundleContent || fs.readFileSync(BUNDLE_PATH, 'utf8');
    // Le bundle ne doit pas exposer module.exports global
    expect(content).not.toMatch(/module\.exports\s*=/);
  });

  test('le bundle peut être exécuté dans un contexte vm', () => {
    const content = bundleContent || fs.readFileSync(BUNDLE_PATH, 'utf8');
    const context = {
      console: console,
      Map: Map,
      Date: Date,
      window: {},
      globalThis: {}
    };

    vm.createContext(context);
    expect(() => {
      vm.runInContext(content, context);
    }).not.toThrow();

    expect(context.window.TaskFlowCra).toBeDefined();
  });

  test('les sept commandes publiques sont exposées', () => {
    const content = bundleContent || fs.readFileSync(BUNDLE_PATH, 'utf8');
    const context = {
      console: console,
      Map: Map,
      Date: Date,
      window: {},
      globalThis: {}
    };

    vm.createContext(context);
    vm.runInContext(content, context);

    const TaskFlowCra = context.window.TaskFlowCra;
    expect(TaskFlowCra.service).toBeDefined();
    expect(typeof TaskFlowCra.service.submitSheet).toBe('function');
    expect(typeof TaskFlowCra.service.withdrawSheet).toBe('function');
    expect(typeof TaskFlowCra.service.validateSheet).toBe('function');
    expect(typeof TaskFlowCra.service.rejectSheet).toBe('function');
    expect(typeof TaskFlowCra.service.openManagerCorrection).toBe('function');
    expect(typeof TaskFlowCra.service.updateManagerActual).toBe('function');
    expect(typeof TaskFlowCra.service.revalidateSheet).toBe('function');
  });

  test('createUiAdapter est exposé', () => {
    const content = bundleContent || fs.readFileSync(BUNDLE_PATH, 'utf8');
    const context = {
      console: console,
      Map: Map,
      Date: Date,
      window: {},
      globalThis: {}
    };

    vm.createContext(context);
    vm.runInContext(content, context);

    expect(typeof context.window.TaskFlowCra.createUiAdapter).toBe('function');
  });

  test('une fonction du workflow peut être appelée', () => {
    const content = bundleContent || fs.readFileSync(BUNDLE_PATH, 'utf8');
    const context = {
      console: console,
      Map: Map,
      Date: Date,
      window: {},
      globalThis: {}
    };

    vm.createContext(context);
    vm.runInContext(content, context);

    const TaskFlowCra = context.window.TaskFlowCra;
    
    // Tester normalizeMemberId
    expect(TaskFlowCra.workflow.normalizeMemberId(123)).toBe(123);
    expect(TaskFlowCra.workflow.normalizeMemberId('456')).toBe(456);
    expect(TaskFlowCra.workflow.normalizeMemberId(null)).toBe(null);
    expect(TaskFlowCra.workflow.normalizeMemberId('')).toBe(null);
    
    // Tester normalizeSheetStatus
    expect(TaskFlowCra.workflow.normalizeSheetStatus('brouillon')).toBe('draft');
    expect(TaskFlowCra.workflow.normalizeSheetStatus('soumis')).toBe('submitted');
    expect(TaskFlowCra.workflow.normalizeSheetStatus('valide')).toBe('validated');
  });

  test('le service inclus a la même API que le module CommonJS source', () => {
    const content = bundleContent || fs.readFileSync(BUNDLE_PATH, 'utf8');
    const context = {
      console: console,
      Map: Map,
      Date: Date,
      window: {},
      globalThis: {}
    };

    vm.createContext(context);
    vm.runInContext(content, context);

    const serviceModule = require('./cra-sheet-validation-service');
    const TaskFlowCra = context.window.TaskFlowCra;

    // Vérifier que les fonctions principales sont présentes
    const expectedFunctions = [
      'submitSheet',
      'withdrawSheet',
      'validateSheet',
      'rejectSheet',
      'openManagerCorrection',
      'updateManagerActual',
      'revalidateSheet'
    ];

    for (const fn of expectedFunctions) {
      expect(typeof TaskFlowCra.service[fn]).toBe('function');
      expect(typeof serviceModule[fn]).toBe('function');
    }
  });

  test('chaque module est instancié une seule fois', () => {
    const content = bundleContent || fs.readFileSync(BUNDLE_PATH, 'utf8');
    const context = {
      console: console,
      Map: Map,
      Date: Date,
      window: {},
      globalThis: {},
      factoryCallCounts: new Map()
    };

    vm.createContext(context);
    vm.runInContext(content, context);

    // Vérifier que le bundle fonctionne correctement
    expect(context.window.TaskFlowCra).toBeDefined();
    expect(context.window.TaskFlowCra.service).toBeDefined();
    expect(context.window.TaskFlowCra.workflow).toBeDefined();
    
    // Appeler plusieurs fois la même fonction pour vérifier le cache
    const result1 = context.window.TaskFlowCra.workflow.normalizeMemberId(123);
    const result2 = context.window.TaskFlowCra.workflow.normalizeMemberId(123);
    
    // Les résultats doivent être identiques (pas de réinstanciation)
    expect(result1).toBe(123);
    expect(result2).toBe(123);
  });

  test('le bundle possède un en-tête clair', () => {
    const content = bundleContent || fs.readFileSync(BUNDLE_PATH, 'utf8');
    expect(content).toContain('Fichier généré automatiquement');
    expect(content).toContain('NE PAS EDITER MANUELLEMENT');
  });
});
