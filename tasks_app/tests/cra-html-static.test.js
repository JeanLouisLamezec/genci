/**
 * Test statique de cra.html - Verifie la structure et les delegations
 */

const fs = require('fs');
const path = require('path');

const CRA_HTML_PATH = path.join(__dirname, '..', 'cra.html');

describe('CRA HTML Static Tests', () => {
  let content;
  
  beforeAll(() => {
    expect(fs.existsSync(CRA_HTML_PATH)).toBe(true);
    content = fs.readFileSync(CRA_HTML_PATH, 'utf8');
  });
  
  describe('Ordre de chargement des scripts', () => {
    test('bundle charge avant l integration', () => {
      const bundleScriptIdx = content.indexOf('src="core/generated/taskflow-cra-browser.js"');
      const integrationScriptIdx = content.indexOf('src="core/cra/cra-workflow-integration.js"');
      
      expect(bundleScriptIdx).toBeGreaterThan(-1);
      expect(integrationScriptIdx).toBeGreaterThan(-1);
      expect(bundleScriptIdx).toBeLessThan(integrationScriptIdx);
    });
    
    test('integration chargee avant le script principal', () => {
      const integrationScriptIdx = content.indexOf('src="core/cra/cra-workflow-integration.js"');
      const mainScriptStart = content.indexOf('<script>\n// <taskflow-core>');
      
      expect(integrationScriptIdx).toBeGreaterThan(-1);
      expect(mainScriptStart).toBeGreaterThan(-1);
      expect(integrationScriptIdx).toBeLessThan(mainScriptStart);
    });
  });
  
  describe('Configuration de CraWorkflowIntegration', () => {
    test('controle defensif de CraWorkflowIntegration', () => {
      const hasCheck = content.includes('typeof CraWorkflowIntegration') || 
                       content.includes('CraWorkflowIntegration !== \'undefined\'');
      expect(hasCheck).toBe(true);
    });
    
    test('appel reel a CraWorkflowIntegration.configure', () => {
      const hasConfigure = content.includes('CraWorkflowIntegration.configure({');
      expect(hasConfigure).toBe(true);
    });
    
    test('getState fourni comme callback', () => {
      const hasGetState = content.includes('getState: function()') || 
                          content.includes('getState: () =>');
      expect(hasGetState).toBe(true);
    });
    
    test('enterCorrectionMode fourni comme callback', () => {
      const hasEnterCallback = content.includes('enterCorrectionMode: function') || 
                               content.includes('enterCorrectionMode: () =>');
      expect(hasEnterCallback).toBe(true);
    });
    
    test('leaveCorrectionMode fourni comme callback', () => {
      const hasLeaveCallback = content.includes('leaveCorrectionMode: function') || 
                               content.includes('leaveCorrectionMode: () =>');
      expect(hasLeaveCallback).toBe(true);
    });
    
    test('currentUserMemberId separe de selectedPersonId', () => {
      const hasCurrentUserMemberId = content.includes('currentUserMemberId');
      const hasSelectedPersonId = content.includes('selectedPersonId');
      expect(hasCurrentUserMemberId).toBe(true);
      expect(hasSelectedPersonId).toBe(true);
    });
  });
  
  describe('Contrat temporel weekStart', () => {
    test('absence de weekStart * 1000 dans l integration', () => {
      const configStart = content.indexOf('CraWorkflowIntegration.configure({');
      const configEnd = content.indexOf('});', configStart);
      const configCode = content.substring(configStart, configEnd !== -1 ? configEnd : configStart + 2000);
      
      const hasWeekStartMultiply = configCode.includes('weekStart * 1000');
      expect(hasWeekStartMultiply).toBe(false);
    });
  });
  
  describe('Bouton principal delegue', () => {
    test('bouton principal delegue a CraWorkflowIntegration', () => {
      const updateSubmitBtnStart = content.indexOf('function updateSubmitBtn()');
      const updateSubmitBtnEnd = content.indexOf('\nfunction renderSaisie()', updateSubmitBtnStart);
      const updateSubmitBtnCode = content.substring(
        updateSubmitBtnStart, 
        updateSubmitBtnEnd !== -1 ? updateSubmitBtnEnd : updateSubmitBtnStart + 3000
      );
      
      const hasDelegation = updateSubmitBtnCode.includes('CraWorkflowIntegration.submitCurrentWeek') ||
                            updateSubmitBtnCode.includes('CraWorkflowIntegration.revalidateSheet');
      expect(hasDelegation).toBe(true);
    });
    
    test('absence de soumission par visiblePersonIds[0]', () => {
      const updateSubmitBtnStart = content.indexOf('function updateSubmitBtn()');
      const updateSubmitBtnEnd = content.indexOf('\nfunction renderSaisie()', updateSubmitBtnStart);
      const updateSubmitBtnCode = content.substring(
        updateSubmitBtnStart, 
        updateSubmitBtnEnd !== -1 ? updateSubmitBtnEnd : updateSubmitBtnStart + 3000
      );
      
      const hasVisiblePersonIdsSubmit = /visiblePersonIds\[0\].*submit/.test(updateSubmitBtnCode);
      expect(hasVisiblePersonIdsSubmit).toBe(false);
    });
  });
  
  describe('Mode correction manager', () => {
    test('mode correction present', () => {
      const hasManagerCorrection = content.includes('managerCorrectionSheetId') || 
                                   content.includes('enterManagerCorrection');
      expect(hasManagerCorrection).toBe(true);
    });
    
    test('routage manager vers updateManagerActual', () => {
      const setCellStart = content.indexOf('async function setCell(');
      const setCellEnd = content.indexOf('\nwindow.setCell', setCellStart);
      const setCellCode = content.substring(
        setCellStart, 
        setCellEnd !== -1 ? setCellEnd : setCellStart + 2000
      );
      
      const hasManagerRouting = setCellCode.includes('managerCorrectionSheetId') && 
                                setCellCode.includes('updateManagerActual');
      expect(hasManagerRouting).toBe(true);
    });
    
    test('entree en correction basculant sur la bonne feuille', () => {
      const enterManagerCorrectionStart = content.indexOf('async function enterManagerCorrection(');
      const enterManagerCorrectionEnd = content.indexOf('\nasync function ', enterManagerCorrectionStart + 10);
      const enterManagerCorrectionCode = content.substring(
        enterManagerCorrectionStart, 
        enterManagerCorrectionEnd !== -1 ? enterManagerCorrectionEnd : enterManagerCorrectionStart + 500
      );
      
      const hasDelegation = enterManagerCorrectionCode.includes('CraWorkflowIntegration.enterManagerCorrection');
      expect(hasDelegation).toBe(true);
    });
    
    test('revalidation deleguee', () => {
      const revalidateSheetStart = content.indexOf('async function revalidateSheet(');
      const revalidateSheetEnd = content.indexOf('\nfunction leaveManagerCorrection', revalidateSheetStart);
      const revalidateSheetCode = content.substring(
        revalidateSheetStart, 
        revalidateSheetEnd !== -1 ? revalidateSheetEnd : revalidateSheetStart + 300
      );
      
      const hasDelegation = revalidateSheetCode.includes('CraWorkflowIntegration.revalidateSheet');
      expect(hasDelegation).toBe(true);
    });
  });
  
  describe('Absence de code legacy', () => {
    test('absence d ecriture directe de statut', () => {
      const submitWeekForPersonStart = content.indexOf('async function submitWeekForPerson');
      const submitWeekForPersonEnd = content.indexOf('\nasync function withdrawWeekForPerson', submitWeekForPersonStart);
      const submitWeekForPersonCode = content.substring(
        submitWeekForPersonStart, 
        submitWeekForPersonEnd !== -1 ? submitWeekForPersonEnd : submitWeekForPersonStart + 500
      );
      
      const hasDirectStatutWrite = submitWeekForPersonCode.includes('statut') && 
                                   submitWeekForPersonCode.includes('applyUserActions');
      expect(hasDirectStatutWrite).toBe(false);
    });
    
    test('absence de mutation optimiste', () => {
      const submitWeekForPersonStart = content.indexOf('async function submitWeekForPerson');
      const submitWeekForPersonEnd = content.indexOf('\nasync function withdrawWeekForPerson', submitWeekForPersonStart);
      const submitWeekForPersonCode = content.substring(
        submitWeekForPersonStart, 
        submitWeekForPersonEnd !== -1 ? submitWeekForPersonEnd : submitWeekForPersonStart + 500
      );
      
      const hasObjectAssignSheet = submitWeekForPersonCode.includes('Object.assign') && 
                                   submitWeekForPersonCode.includes('sheet');
      expect(hasObjectAssignSheet).toBe(false);
    });
    
    test('validation deleguee', () => {
      const validerFeuilleStart = content.indexOf('window.validerFeuille');
      const validerFeuilleEnd = content.indexOf('\nwindow.rejeterFeuille', validerFeuilleStart);
      const validerFeuilleCode = content.substring(
        validerFeuilleStart, 
        validerFeuilleEnd !== -1 ? validerFeuilleEnd : validerFeuilleStart + 300
      );
      
      const validatesDelegated = validerFeuilleCode.includes('CraWorkflowIntegration') && 
                                 validerFeuilleCode.includes('validateSheet');
      expect(validatesDelegated).toBe(true);
    });
    
    test('rejet delegue', () => {
      const rejeterFeuilleStart = content.indexOf('window.rejeterFeuille');
      const rejeterFeuilleEnd = content.indexOf('\n//', rejeterFeuilleStart);
      const rejeterFeuilleCode = content.substring(
        rejeterFeuilleStart, 
        rejeterFeuilleEnd !== -1 ? rejeterFeuilleEnd : rejeterFeuilleStart + 300
      );
      
      const rejectsDelegated = rejeterFeuilleCode.includes('CraWorkflowIntegration') && 
                               rejeterFeuilleCode.includes('rejectSheet');
      expect(rejectsDelegated).toBe(true);
    });
  });
  
  describe('Modales', () => {
    let integrationContent;
    
    beforeAll(() => {
      integrationContent = fs.readFileSync(
        path.join(__dirname, '..', 'core', 'cra', 'cra-workflow-integration.js'),
        'utf8'
      );
    });
    
    test('modale de rejet presente', () => {
      const hasRejectModal = content.includes('craRejectModal') || 
                             content.includes('showRejectModal') || 
                             integrationContent.includes('craRejectModal') || 
                             integrationContent.includes('showRejectModal');
      expect(hasRejectModal).toBe(true);
    });
    
    test('modale de correction presente', () => {
      const hasCorrectionModal = content.includes('craCorrectionModal') || 
                                 content.includes('showCorrectionModal') ||
                                 integrationContent.includes('craCorrectionModal') || 
                                 integrationContent.includes('showCorrectionModal');
      expect(hasCorrectionModal).toBe(true);
    });
    
    test('absence de window.prompt()', () => {
      const hasWindowPrompt = content.includes('window.prompt(') || content.includes('.prompt(');
      expect(hasWindowPrompt).toBe(false);
    });
  });
  
  describe('Aucune creation de TimeEntry en correction', () => {
    test('blocage creation en mode correction', () => {
      const setCellStart = content.indexOf('async function setCell(');
      const setCellEnd = content.indexOf('\nwindow.setCell', setCellStart);
      const setCellCode = content.substring(
        setCellStart, 
        setCellEnd !== -1 ? setCellEnd : setCellStart + 2000
      );
      
      const hasBlocking = setCellCode.includes('managerCorrectionSheetId') && 
                          setCellCode.includes('existingEntry') &&
                          setCellCode.includes('return');
      expect(hasBlocking).toBe(true);
    });
  });
});
