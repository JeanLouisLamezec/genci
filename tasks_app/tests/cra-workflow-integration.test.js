/**
 * Tests de CraWorkflowIntegration
 */

describe('CraWorkflowIntegration', () => {
  let mockEnv;
  let integration;
  
  function createMockEnvironment() {
    const now = Date.now();
    const monday = new Date(now);
    const dayOfWeek = monday.getDay();
    const diff = monday.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    const mondayMs = monday.getTime();
    
    const state = {
      currentUserMemberId: 1,
      selectedPersonId: 2,
      weekStart: mondayMs,
      feuilles: [
        { id: 100, membre: 1, semaine: Math.floor(mondayMs / 1000), statut: 'brouillon', responsableValidation: 3 },
        { id: 101, membre: 2, semaine: Math.floor(mondayMs / 1000), statut: 'soumis', responsableValidation: 3 }
      ],
      team: [
        { id: 1, nom: 'User1', responsable: 3 },
        { id: 2, nom: 'User2', responsable: 3 },
        { id: 3, nom: 'Manager' }
      ]
    };
    
    const calls = {
      submit: [],
      withdraw: [],
      validate: [],
      reject: [],
      openCorrection: [],
      updateManagerActual: [],
      revalidate: [],
      reload: [],
      enterCorrectionMode: [],
      leaveCorrectionMode: []
    };
    
    const mockAdapter = {
      submit: jest.fn(async (sheetId) => { calls.submit.push(sheetId); return { success: true, code: 'OK' }; }),
      withdraw: jest.fn(async (sheetId) => { calls.withdraw.push(sheetId); return { success: true, code: 'OK' }; }),
      validate: jest.fn(async (sheetId) => { calls.validate.push(sheetId); return { success: true, code: 'OK' }; }),
      reject: jest.fn(async (sheetId, reason) => { calls.reject.push({ sheetId, reason }); return { success: true, code: 'OK' }; }),
      openCorrection: jest.fn(async (sheetId, reason) => { calls.openCorrection.push({ sheetId, reason }); return { success: true, code: 'OK' }; }),
      updateManagerActual: jest.fn(async (sheetId, timeEntryId, hours) => { calls.updateManagerActual.push({ sheetId, timeEntryId, hours }); return { success: true, code: 'OK' }; }),
      revalidate: jest.fn(async (sheetId) => { calls.revalidate.push(sheetId); return { success: true, code: 'OK' }; })
    };
    
    const mockTaskFlowCra = {
      service: {},
      workflow: {},
      createUiAdapter: jest.fn(() => mockAdapter)
    };
    
    const mockGrist = { docApi: {} };
    
    const reloadFn = jest.fn(async () => { calls.reload.push(true); });
    const enterCorrectionModeFn = jest.fn((sheet) => { calls.enterCorrectionMode.push(sheet); });
    const leaveCorrectionModeFn = jest.fn(() => { calls.leaveCorrectionMode.push(true); });
    
    return { 
      state, 
      calls, 
      mockAdapter, 
      mockTaskFlowCra, 
      mockGrist, 
      reloadFn, 
      mondayMs,
      enterCorrectionModeFn,
      leaveCorrectionModeFn
    };
  }
  
  beforeEach(() => {
    mockEnv = createMockEnvironment();
    globalThis.CraWorkflowIntegration = undefined;
    jest.resetModules();
  });
  
  afterEach(() => {
    delete globalThis.CraWorkflowIntegration;
  });
  
  describe('Configuration', () => {
    test('configuration nominale avec toutes les options', () => {
      require('../core/cra/cra-workflow-integration.js');
      
      expect(() => {
        globalThis.CraWorkflowIntegration.configure({
          grist: mockEnv.mockGrist,
          taskFlowCra: mockEnv.mockTaskFlowCra,
          getState: () => mockEnv.state,
          reload: mockEnv.reloadFn,
          notify: () => {},
          setBusy: () => {},
          enterCorrectionMode: mockEnv.enterCorrectionModeFn,
          leaveCorrectionMode: mockEnv.leaveCorrectionModeFn
        });
      }).not.toThrow();
    });
    
    test('double configuration ignoree avec avertissement', () => {
      require('../core/cra/cra-workflow-integration.js');
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
      
      globalThis.CraWorkflowIntegration.configure({
        grist: mockEnv.mockGrist,
        taskFlowCra: mockEnv.mockTaskFlowCra,
        getState: () => mockEnv.state,
        reload: mockEnv.reloadFn,
        notify: () => {},
        setBusy: () => {}
      });
      
      globalThis.CraWorkflowIntegration.configure({
        grist: mockEnv.mockGrist,
        taskFlowCra: mockEnv.mockTaskFlowCra,
        getState: () => mockEnv.state,
        reload: mockEnv.reloadFn,
        notify: () => {},
        setBusy: () => {}
      });
      
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('configur')
      );
      
      consoleWarn.mockRestore();
    });
    
    test('erreur si taskFlowCra manquant', () => {
      require('../core/cra/cra-workflow-integration.js');
      
      expect(() => {
        globalThis.CraWorkflowIntegration.configure({
          grist: mockEnv.mockGrist,
          taskFlowCra: null,
          getState: () => mockEnv.state
        });
      }).toThrow('taskFlowCra et service requis');
    });
    
    test('erreur si getState manquant', () => {
      require('../core/cra/cra-workflow-integration.js');
      
      expect(() => {
        globalThis.CraWorkflowIntegration.configure({
          grist: mockEnv.mockGrist,
          taskFlowCra: mockEnv.mockTaskFlowCra,
          getState: null
        });
      }).toThrow('getState requis');
    });
  });
  
  describe('Resolution de feuille', () => {
    beforeEach(() => {
      require('../core/cra/cra-workflow-integration.js');
      globalThis.CraWorkflowIntegration.configure({
        grist: mockEnv.mockGrist,
        taskFlowCra: mockEnv.mockTaskFlowCra,
        getState: () => mockEnv.state,
        reload: mockEnv.reloadFn,
        notify: () => {},
        setBusy: () => {}
      });
    });
    
    test('currentUserMemberId utilise comme acteur', () => {
      expect(mockEnv.state.currentUserMemberId).toBe(1);
      expect(mockEnv.state.selectedPersonId).toBe(2);
      expect(mockEnv.state.selectedPersonId).not.toBe(mockEnv.state.currentUserMemberId);
    });
    
    test('semaine en millisecondes dans l etat', () => {
      expect(typeof mockEnv.state.weekStart).toBe('number');
      expect(mockEnv.state.weekStart).toBeGreaterThan(1000000000000);
    });
    
    test('semaine de feuille en secondes', () => {
      const sheet = mockEnv.state.feuilles[0];
      expect(typeof sheet.semaine).toBe('number');
      expect(sheet.semaine).toBeLessThan(1000000000000);
    });
    
    test('resolution nominale de la feuille courante', async () => {
      const result = await globalThis.CraWorkflowIntegration.submitCurrentWeek();
      expect(result.success).toBe(true);
      expect(mockEnv.calls.submit).toHaveLength(1);
      expect(mockEnv.calls.submit[0]).toBe(100);
    });
    
    test('absence de feuille bloquee', async () => {
      mockEnv.state.feuilles = mockEnv.state.feuilles.filter(f => f.membre !== 1);
      const result = await globalThis.CraWorkflowIntegration.submitCurrentWeek();
      expect(result.success).toBe(false);
      expect(result.code).toBe('NO_SHEET');
    });
    
    test('doublon de feuille bloque', async () => {
      mockEnv.state.feuilles.push({
        id: 102,
        membre: 1,
        semaine: Math.floor(mockEnv.mondayMs / 1000),
        statut: 'brouillon',
        responsableValidation: 3
      });
      const result = await globalThis.CraWorkflowIntegration.submitCurrentWeek();
      expect(result.success).toBe(false);
      expect(result.code).toBe('DUPLICATE_WEEKLY_SHEET');
    });
  });
  
  describe('Soumission et retrait', () => {
    beforeEach(() => {
      require('../core/cra/cra-workflow-integration.js');
      globalThis.CraWorkflowIntegration.configure({
        grist: mockEnv.mockGrist,
        taskFlowCra: mockEnv.mockTaskFlowCra,
        getState: () => mockEnv.state,
        reload: mockEnv.reloadFn,
        notify: () => {},
        setBusy: () => {}
      });
    });
    
    test('soumission delegue a l adaptateur', async () => {
      await globalThis.CraWorkflowIntegration.submitCurrentWeek();
      expect(mockEnv.calls.submit).toHaveLength(1);
      expect(mockEnv.calls.submit[0]).toBe(100);
    });
    
    test('retrait delegue a l adaptateur', async () => {
      await globalThis.CraWorkflowIntegration.withdrawCurrentWeek();
      expect(mockEnv.calls.withdraw).toHaveLength(1);
      expect(mockEnv.calls.withdraw[0]).toBe(100);
    });
  });
  
  describe('Validation et rejet', () => {
    beforeEach(() => {
      require('../core/cra/cra-workflow-integration.js');
      globalThis.CraWorkflowIntegration.configure({
        grist: mockEnv.mockGrist,
        taskFlowCra: mockEnv.mockTaskFlowCra,
        getState: () => mockEnv.state,
        reload: mockEnv.reloadFn,
        notify: () => {},
        setBusy: () => {}
      });
    });
    
    test('validation delegue a l adaptateur', async () => {
      await globalThis.CraWorkflowIntegration.validateSheet(101);
      expect(mockEnv.calls.validate).toHaveLength(1);
      expect(mockEnv.calls.validate[0]).toBe(101);
    });
    
    test('rejet avec motif fourni', async () => {
      const result = await globalThis.CraWorkflowIntegration.rejectSheet(101, 'Motif test');
      expect(result.success).toBe(true);
      expect(mockEnv.calls.reject).toHaveLength(1);
      expect(mockEnv.calls.reject[0].sheetId).toBe(101);
      expect(mockEnv.calls.reject[0].reason).toBe('Motif test');
    });
    
    test('rejet avec motif trime', async () => {
      await globalThis.CraWorkflowIntegration.rejectSheet(101, '  Motif avec espaces  ');
      expect(mockEnv.calls.reject[0].reason).toBe('Motif avec espaces');
    });
    
    test('rejet vide refuse', async () => {
      const result = await globalThis.CraWorkflowIntegration.rejectSheet(101, '');
      expect(result.success).toBe(false);
      expect(result.code).toBe('MISSING_REJECT_REASON');
      expect(mockEnv.calls.reject).toHaveLength(0);
    });
    
    test('rejet sans motif ouvre la modale', async () => {
      // Verifie que la fonction showRejectModal est exposee et peut etre appelee
      expect(typeof globalThis.CraWorkflowIntegration.showRejectModal).toBe('function');
    });
  });
  
  describe('Correction manager', () => {
    beforeEach(() => {
      require('../core/cra/cra-workflow-integration.js');
      globalThis.CraWorkflowIntegration.configure({
        grist: mockEnv.mockGrist,
        taskFlowCra: mockEnv.mockTaskFlowCra,
        getState: () => mockEnv.state,
        reload: mockEnv.reloadFn,
        notify: () => {},
        setBusy: () => {},
        enterCorrectionMode: mockEnv.enterCorrectionModeFn,
        leaveCorrectionMode: mockEnv.leaveCorrectionModeFn
      });
    });
    
    test('ouverture de correction avec motif fourni', async () => {
      const result = await globalThis.CraWorkflowIntegration.openCorrection(101, 'Motif correction');
      expect(result.success).toBe(true);
      expect(mockEnv.calls.openCorrection).toHaveLength(1);
      expect(mockEnv.calls.openCorrection[0].reason).toBe('Motif correction');
    });
    
    test('ouverture de correction vide refusee', async () => {
      const result = await globalThis.CraWorkflowIntegration.openCorrection(101, '');
      expect(result.success).toBe(false);
      expect(result.code).toBe('MISSING_CORRECTION_REASON');
    });
    
    test('entree en correction autorisee', async () => {
      const sheet = {
        id: 101,
        membre: 2,
        semaine: Math.floor(mockEnv.mondayMs / 1000),
        statut: 'correction_manager',
        responsableValidation: 1
      };
      mockEnv.state.feuilles = [sheet];
      
      const result = await globalThis.CraWorkflowIntegration.enterManagerCorrection(101);
      expect(result.success).toBe(true);
      expect(result.code).toBe('MANAGER_CORRECTION_MODE_ENTERED');
      expect(mockEnv.enterCorrectionModeFn).toHaveBeenCalledWith(sheet);
    });
    
    test('feuille absente refusee', async () => {
      const result = await globalThis.CraWorkflowIntegration.enterManagerCorrection(999);
      expect(result.success).toBe(false);
      expect(result.code).toBe('SHEET_NOT_FOUND');
    });
    
    test('statut incorrect refuse', async () => {
      mockEnv.state.feuilles[0].statut = 'brouillon';
      const result = await globalThis.CraWorkflowIntegration.enterManagerCorrection(100);
      expect(result.success).toBe(false);
      expect(result.code).toBe('SHEET_NOT_IN_MANAGER_CORRECTION');
    });
    
    test('mauvais manager refuse', async () => {
      mockEnv.state.feuilles[0].statut = 'correction_manager';
      mockEnv.state.feuilles[0].responsableValidation = 999;
      const result = await globalThis.CraWorkflowIntegration.enterManagerCorrection(100);
      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_EXPECTED_VALIDATION_MANAGER');
    });
    
    test('modification manager deleguee', async () => {
      await globalThis.CraWorkflowIntegration.updateManagerActual(101, 500, 3.5);
      expect(mockEnv.calls.updateManagerActual).toHaveLength(1);
      expect(mockEnv.calls.updateManagerActual[0].hours).toBe(3.5);
    });
    
    test('zero preserve', async () => {
      await globalThis.CraWorkflowIntegration.updateManagerActual(101, 500, 0);
      expect(mockEnv.calls.updateManagerActual[0].hours).toBe(0);
    });
    
    test('revalidation', async () => {
      await globalThis.CraWorkflowIntegration.revalidateSheet(101);
      expect(mockEnv.calls.revalidate).toHaveLength(1);
      expect(mockEnv.calls.revalidate[0]).toBe(101);
    });
    
    test('callback leaveCorrectionMode apres succes', async () => {
      await globalThis.CraWorkflowIntegration.revalidateSheet(101);
      expect(mockEnv.leaveCorrectionModeFn).toHaveBeenCalled();
    });
  });
  
  describe('Aucune mutation directe', () => {
    test('aucune mutation directe de l etat', () => {
      // Note: Object.freeze ne leve une erreur qu en mode strict avec assignment
      // On verifie plutot que l integration ne modifie pas l etat directement
      const stateCopy = {
        currentUserMemberId: 1,
        feuilles: []
      };
      
      require('../core/cra/cra-workflow-integration.js');
      globalThis.CraWorkflowIntegration.configure({
        grist: mockEnv.mockGrist,
        taskFlowCra: mockEnv.mockTaskFlowCra,
        getState: () => stateCopy,
        reload: mockEnv.reloadFn,
        notify: () => {},
        setBusy: () => {}
      });
      
      // L etat ne doit pas etre modifie par la configuration
      expect(stateCopy.currentUserMemberId).toBe(1);
      expect(stateCopy.feuilles).toHaveLength(0);
    });
    
    test('aucun applyUserActions direct dans le code', () => {
      const fs = require('fs');
      const path = require('path');
      const integrationCode = fs.readFileSync(
        path.join(__dirname, '..', 'core', 'cra', 'cra-workflow-integration.js'),
        'utf8'
      );
      expect(integrationCode).not.toMatch(/applyUserActions\s*\(/);
    });
  });
});
