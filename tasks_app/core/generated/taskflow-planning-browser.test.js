/**
 * Tests pour le bundle navigateur TaskFlow Planning
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const os = require('os');

const BUNDLE_PATH = path.join(__dirname, 'taskflow-planning-browser.js');
const BUILD_SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'build-planning-browser.js');

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
  
  test('TaskFlowPlanning expose isBlockingDiagnostic', () => {
    vm.runInContext(bundleContent, context);
    
    expect(sandbox.window.TaskFlowPlanning.isBlockingDiagnostic).toBeDefined();
    expect(typeof sandbox.window.TaskFlowPlanning.isBlockingDiagnostic).toBe('function');
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
    expect(bundleContent).not.toMatch(/[^a-zA-Z_]require\s*\(/);
  });
});

describe('TaskFlow Planning - Déterminisme du build', () => {
  
  function sha256(content) {
    return crypto
      .createHash('sha256')
      .update(content, 'utf8')
      .digest('hex');
  }
  
  test('le build est déterministe (deux builds réels produisent le même contenu)', () => {
    const { build } = require(BUILD_SCRIPT_PATH);
    
    // Générer deux fichiers temporaires
    const outputFile1 = path.join(os.tmpdir(), `taskflow-test-${Date.now()}-1.js`);
    const outputFile2 = path.join(os.tmpdir(), `taskflow-test-${Date.now()}-2.js`);
    
    try {
      const result1 = build({ outputFile: outputFile1 });
      const result2 = build({ outputFile: outputFile2 });
      
      // Vérifier que les contenus sont identiques
      expect(result1.content).toBe(result2.content);
      
      // Vérifier les hashes SHA256
      expect(sha256(result1.content)).toBe(sha256(result2.content));
    } finally {
      // Nettoyer les fichiers temporaires
      if (fs.existsSync(outputFile1)) fs.unlinkSync(outputFile1);
      if (fs.existsSync(outputFile2)) fs.unlinkSync(outputFile2);
    }
  });
});

describe('TaskFlow Planning - Intégration avec Mock Grist', () => {
  
  let bundleContent;
  let sandbox;
  let context;
  let mockGrist;
  let applyUserActionsCallCount;
  
  beforeEach(() => {
    bundleContent = fs.readFileSync(BUNDLE_PATH, 'utf8');
    applyUserActionsCallCount = 0;
    
    // Mock Grist avec applyUserActions qui jette une erreur
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
          applyUserActionsCallCount++;
          throw new Error('applyUserActions interdit en preview');
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
  
  test('createWidgetPlanningService peut être appelé avec un mock Grist', () => {
    const { createWidgetPlanningService } = sandbox.window.TaskFlowPlanning;
    
    expect(() => {
      const service = createWidgetPlanningService(mockGrist);
      expect(service).toBeDefined();
      expect(typeof service.previewAssignment).toBe('function');
      expect(typeof service.commitAssignment).toBe('function');
    }).not.toThrow();
  });
  
  test('previewAssignment ne modifie pas les données (preuve zéro appel à applyUserActions)', async () => {
    const { createWidgetPlanningService } = sandbox.window.TaskFlowPlanning;
    const service = createWidgetPlanningService(mockGrist);
    
    // La prévisualisation doit réussir même si applyUserActions jette
    const result = await service.previewAssignment(1, {
      replanFromDate: '2024-07-01'
    });
    
    expect(result.success).toBe(true);
    expect(result.mode).toBe('preview');
    expect(applyUserActionsCallCount).toBe(0);
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
  
  test('isBlockingDiagnostic classe correctement les diagnostics', () => {
    const { isBlockingDiagnostic } = sandbox.window.TaskFlowPlanning;
    
    // Diagnostics bloquants
    expect(isBlockingDiagnostic({ code: 'MISSING_ASSIGNMENT' })).toBe(true);
    expect(isBlockingDiagnostic({ code: 'INVALID_ACTUAL_HOURS' })).toBe(true);
    expect(isBlockingDiagnostic({ code: 'DUPLICATE_ACTIVE_ASSIGNMENT' })).toBe(true);
    expect(isBlockingDiagnostic({ code: 'PROTECTED_PLAN_EXCEEDS_ALLOCATION' })).toBe(true);
    
    // Diagnostics non bloquants
    expect(isBlockingDiagnostic({ code: 'OVERCONSUMPTION' })).toBe(false);
    expect(isBlockingDiagnostic({ code: 'UNPLANNED_HOURS' })).toBe(false);
    expect(isBlockingDiagnostic({ code: 'NO_DISTRIBUTABLE_DATES' })).toBe(false);
  });
  
  test('commitAssignment n\'est PAS appelé dans plan.html', () => {
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
  
  const planHtmlPath = path.join(__dirname, '..', '..', 'plan.html');
  let planHtmlContent;
  
  beforeAll(() => {
    planHtmlContent = fs.readFileSync(planHtmlPath, 'utf8');
  });
  
  test('plan.html référence le bundle généré', () => {
    expect(planHtmlContent).toMatch(/taskflow-planning-browser\.js/);
  });
  
  test('plan.html contient le bouton btnPlanningPreview', () => {
    expect(planHtmlContent).toMatch(/id=["']btnPlanningPreview["']/);
  });
  
  test('plan.html charge TaskAssignments dans loadGrist', () => {
    expect(planHtmlContent).toMatch(/TaskAssignments/);
    expect(planHtmlContent).toMatch(/S\.assignments/);
  });
  
  test('plan.html initialise le service de planification', () => {
    expect(planHtmlContent).toMatch(/initPlanningService/);
    expect(planHtmlContent).toMatch(/window\.TaskFlowPlanning/);
  });
  
  test('plan.html gère les états d\'interface de prévisualisation', () => {
    expect(planHtmlContent).toMatch(/PreviewState/);
    expect(planHtmlContent).toMatch(/loading/);
    expect(planHtmlContent).toMatch(/success/);
    expect(planHtmlContent).toMatch(/error/);
  });
  
  test('plan.html utilise PanelMode pour la fermeture unifiée', () => {
    expect(planHtmlContent).toMatch(/PanelMode/);
    expect(planHtmlContent).toMatch(/closeActivePanel/);
  });
  
  test('plan.html gère l\'obsolescence après rechargement Grist', () => {
    expect(planHtmlContent).toMatch(/gristDataRevision/);
    expect(planHtmlContent).toMatch(/previewDataRevision/);
    expect(planHtmlContent).toMatch(/showPreviewObsolete/);
  });
  
  test('plan.html lit la date au clic (pas au rendu)', () => {
    expect(planHtmlContent).toMatch(/getSelectedReplanDate/);
    // Le handler doit utiliser data-preview-assignment-id (délégation)
    expect(planHtmlContent).toMatch(/data-preview-assignment-id/);
    // Pas de setTimeout pour les listeners
    expect(planHtmlContent).not.toMatch(/setTimeout\s*\(\s*\(\)\s*=>\s*{\s*for\s*\(const.*btnPreview/);
  });
  
  test('plan.html n\'utilise plus onclick direct pour pClose et overlay', () => {
    // On doit utiliser addEventListener, pas .onclick =
    const pCloseMatches = planHtmlContent.match(/pClose.*\.onclick\s*=/g);
    const overlayMatches = planHtmlContent.match(/overlay.*\.onclick\s*=/g);
    
    expect(pCloseMatches).toBeNull();
    expect(overlayMatches).toBeNull();
  });
  
  test('getDiagnosticLevel utilise isBlockingDiagnostic du bundle', () => {
    expect(planHtmlContent).toMatch(/isBlockingDiagnostic/);
    expect(planHtmlContent).toMatch(/TaskFlowPlanning/);
  });
});
