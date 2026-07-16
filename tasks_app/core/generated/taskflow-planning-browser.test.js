/**
 * Tests pour le bundle navigateur TaskFlow Planning
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BUNDLE_PATH = path.join(__dirname, 'taskflow-planning-browser.js');

describe('TaskFlow Planning Browser Bundle', () => {
  
  let bundleContent;
  let sandbox;
  let context;
  
  beforeAll(() => {
    // Charger le bundle
    expect(fs.existsSync(BUNDLE_PATH)).toBe(true);
    bundleContent = fs.readFileSync(BUNDLE_PATH, 'utf8');
  });
  
  beforeEach(() => {
    // Créer un contexte de test isolé
    sandbox = {
      window: {},
      globalThis: {},
      console: console,
      Map: Map,
      Set: Set,
      Date: Date,
      Array: Array,
      Object: Object,
      String: String,
      Number: Number,
      Math: Math,
      JSON: JSON,
      Promise: Promise,
      Error: Error
    };
    
    context = vm.createContext(sandbox);
  });
  
  test('le fichier bundle existe', () => {
    expect(fs.existsSync(BUNDLE_PATH)).toBe(true);
  });
  
  test('le bundle expose window.TaskFlowPlanning', () => {
    // Exécuter le bundle dans le contexte
    vm.runInContext(bundleContent, context);
    
    expect(sandbox.window.TaskFlowPlanning).toBeDefined();
    expect(typeof sandbox.window.TaskFlowPlanning).toBe('object');
  });
  
  test('TaskFlowPlanning expose createWidgetPlanningService', () => {
    vm.runInContext(bundleContent, context);
    
    expect(sandbox.window.TaskFlowPlanning.createWidgetPlanningService).toBeDefined();
    expect(typeof sandbox.window.TaskFlowPlanning.createWidgetPlanningService).toBe('function');
  });
  
  test('TaskFlowPlanning expose summarizeGristActions', () => {
    vm.runInContext(bundleContent, context);
    
    expect(sandbox.window.TaskFlowPlanning.summarizeGristActions).toBeDefined();
    expect(typeof sandbox.window.TaskFlowPlanning.summarizeGristActions).toBe('function');
  });
  
  test('summarizeGristActions fonctionne correctement', () => {
    vm.runInContext(bundleContent, context);
    
    const { summarizeGristActions } = sandbox.window.TaskFlowPlanning;
    
    const actions = [
      ['AddRecord', 'TimeEntries', null, {}],
      ['AddRecord', 'TimeEntries', null, {}],
      ['UpdateRecord', 'TimeEntries', 1, {}],
      ['RemoveRecord', 'TimeEntries', 2]
    ];
    
    const summary = summarizeGristActions(actions);
    
    expect(summary.creates).toBe(2);
    expect(summary.updates).toBe(1);
    expect(summary.deletes).toBe(1);
    expect(summary.total).toBe(4);
  });
  
  test('le bundle peut être évalué sans erreur de syntaxe', () => {
    expect(() => {
      vm.runInContext(bundleContent, context);
    }).not.toThrow();
  });
  
  test('le bundle ne dépend pas de require global', () => {
    // Le bundle ne doit pas appeler require() directement
    expect(bundleContent).not.toMatch(/[^a-zA-Z_]require\s*\(/);
  });
  
  test('le bundle est déterministe (même contenu à chaque build)', () => {
    const hash1 = bundleContent.length;
    const bundleContent2 = fs.readFileSync(BUNDLE_PATH, 'utf8');
    const hash2 = bundleContent2.length;
    
    expect(hash1).toBe(hash2);
  });
});

describe('TaskFlow Planning - Intégration avec Mock Grist', () => {
  
  let bundleContent;
  let sandbox;
  let context;
  let mockGrist;
  
  beforeEach(() => {
    bundleContent = fs.readFileSync(BUNDLE_PATH, 'utf8');
    
    // Mock Grist simple
    mockGrist = {
      docApi: {
        fetchTable: async (tableId) => {
          const mockData = {
            TaskAssignments: {
              id: [1],
              tache: [1],
              membre: [1],
              heuresAllouees: [35],
              dateDebut: [1719792000],
              dateFin: [1720137600],
              actif: [true]
            },
            Tasks: { id: [1], titre: ['Tâche 1'] },
            Team: { id: [1], nom: ['Alice'], capaciteHebdo: [35] },
            TimeEntries: { id: [] },
            Feuilles: { id: [] },
            Disponibilites: { id: [] },
            MemberDailyCapacities: { id: [] }
          };
          return mockData[tableId] || { id: [] };
        },
        applyUserActions: async (actions) => {
          // Ne rien faire en mode preview
          return actions.length;
        }
      }
    };
    
    sandbox = {
      window: {},
      globalThis: {},
      console: console,
      Map: Map,
      Set: Set,
      Date: Date,
      Array: Array,
      Object: Object,
      String: String,
      Number: Number,
      Math: Math,
      JSON: JSON,
      Promise: Promise,
      Error: Error
    };
    
    context = vm.createContext(sandbox);
    vm.runInContext(bundleContent, context);
  });
  
  test('createWidgetPlanningService peut être appelé avec un mock Grist', async () => {
    const { createWidgetPlanningService } = sandbox.window.TaskFlowPlanning;
    
    expect(() => {
      const service = createWidgetPlanningService(mockGrist);
      expect(service).toBeDefined();
      expect(typeof service.previewAssignment).toBe('function');
      expect(typeof service.commitAssignment).toBe('function');
    }).not.toThrow();
  });
  
  test('previewAssignment ne modifie pas les données (dryRun)', async () => {
    const { createWidgetPlanningService } = sandbox.window.TaskFlowPlanning;
    const service = createWidgetPlanningService(mockGrist);
    
    let fetchCalled = false;
    const originalFetchTable = mockGrist.docApi.fetchTable;
    mockGrist.docApi.fetchTable = async (tableId) => {
      fetchCalled = true;
      return originalFetchTable(tableId);
    };
    
    const result = await service.previewAssignment(1, {
      replanFromDate: '2024-07-01'
    });
    
    expect(fetchCalled).toBe(true);
    expect(result.mode).toBe('preview');
    expect(result.success).toBe(true);
  });
  
  test('previewAssignment retourne un résultat structuré', async () => {
    const { createWidgetPlanningService } = sandbox.window.TaskFlowPlanning;
    const service = createWidgetPlanningService(mockGrist);
    
    const result = await service.previewAssignment(1, {
      replanFromDate: '2024-07-01'
    });
    
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('mode', 'preview');
    expect(result).toHaveProperty('assignmentId', 1);
    expect(result).toHaveProperty('desiredPlan');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('diagnostics');
    expect(result).toHaveProperty('capacityActions');
    expect(result).toHaveProperty('timeEntryActions');
    expect(result).toHaveProperty('changeSummary');
    expect(result).toHaveProperty('canCommit');
    expect(result).toHaveProperty('error');
  });
  
  test('commitAssignment n\'est PAS appelé dans plan.html', () => {
    // Vérification statique : plan.html ne doit pas appeler commitAssignment
    const planHtmlPath = path.join(__dirname, '..', '..', 'plan.html');
    const planHtmlContent = fs.readFileSync(planHtmlPath, 'utf8');
    
    // Le fichier HTML ne doit pas contenir d'appel direct à commitAssignment
    expect(planHtmlContent).not.toMatch(/commitAssignment\s*\(/);
    
    // Il ne doit pas non plus appliquer directement les actions brutes
    expect(planHtmlContent).not.toMatch(/applyUserActions\s*\(.*capacityActions/);
    expect(planHtmlContent).not.toMatch(/applyUserActions\s*\(.*timeEntryActions/);
  });
});

describe('Intégration HTML - plan.html', () => {
  
  test('plan.html référence le bundle généré', () => {
    const planHtmlPath = path.join(__dirname, '..', '..', 'plan.html');
    const planHtmlContent = fs.readFileSync(planHtmlPath, 'utf8');
    
    expect(planHtmlContent).toMatch(/taskflow-planning-browser\.js/);
  });
  
  test('plan.html contient le bouton btnPlanningPreview', () => {
    const planHtmlPath = path.join(__dirname, '..', '..', 'plan.html');
    const planHtmlContent = fs.readFileSync(planHtmlPath, 'utf8');
    
    expect(planHtmlContent).toMatch(/id=["']btnPlanningPreview["']/);
  });
  
  test('plan.html charge TaskAssignments dans loadGrist', () => {
    const planHtmlPath = path.join(__dirname, '..', '..', 'plan.html');
    const planHtmlContent = fs.readFileSync(planHtmlPath, 'utf8');
    
    expect(planHtmlContent).toMatch(/TaskAssignments/);
    expect(planHtmlContent).toMatch(/S\.assignments/);
  });
  
  test('plan.html initialise le service de planification', () => {
    const planHtmlPath = path.join(__dirname, '..', '..', 'plan.html');
    const planHtmlContent = fs.readFileSync(planHtmlPath, 'utf8');
    
    expect(planHtmlContent).toMatch(/initPlanningService/);
    expect(planHtmlContent).toMatch(/window\.TaskFlowPlanning/);
  });
  
  test('plan.html gère les états d\'interface de prévisualisation', () => {
    const planHtmlPath = path.join(__dirname, '..', '..', 'plan.html');
    const planHtmlContent = fs.readFileSync(planHtmlPath, 'utf8');
    
    expect(planHtmlContent).toMatch(/PreviewState/);
    expect(planHtmlContent).toMatch(/loading/);
    expect(planHtmlContent).toMatch(/success/);
    expect(planHtmlContent).toMatch(/error/);
  });
});
