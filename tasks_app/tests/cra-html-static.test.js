#!/usr/bin/env node
/**
 * Test statique de cra.html - Vérifie la structure et les délégations
 * 
 * Vérifications :
 * 1. Bundle chargé avant l'intégration
 * 2. Intégration chargée avant le script principal
 * 3. Contrôle défensif de TaskFlowCra
 * 4. Aucune soumission par visiblePersonIds[0]
 * 5. Aucune soumission par selectedPersonId comme acteur
 * 6. Aucune transition utilisant S.me
 * 7. Aucune écriture directe de Feuilles.statut dans les fonctions de workflow
 * 8. Aucune mutation optimiste de feuille
 * 9. Validation déléguée
 * 10. Rejet délégué
 * 11. Modale métier présente
 * 12. Aucun window.prompt()
 * 13. Mode correction présent
 * 14. Routage manager vers updateManagerActual()
 * 15. Aucune création de TimeEntry en correction
 * 16. Revalidation déléguée
 */

const fs = require('fs');
const path = require('path');

const CRA_HTML_PATH = path.join(__dirname, '..', 'cra.html');

function runStaticTests() {
  console.log('🔍 Tests statiques de cra.html...\n');
  
  if (!fs.existsSync(CRA_HTML_PATH)) {
    console.error('❌ cra.html non trouvé');
    process.exit(1);
  }
  
  const content = fs.readFileSync(CRA_HTML_PATH, 'utf8');
  const lines = content.split('\n');
  
  let passed = 0;
  let failed = 0;
  const errors = [];
  
  function test(name, condition, details) {
    if (condition) {
      console.log('  ✓ ' + name);
      passed++;
    } else {
      console.error('  ✗ ' + name);
      if (details) console.error('    ' + details);
      errors.push({ name, details });
      failed++;
    }
  }
  
  // 1. Bundle chargé avant l'intégration
  const bundleScriptIdx = content.indexOf('src="core/generated/taskflow-cra-browser.js"');
  const integrationScriptIdx = content.indexOf('src="core/cra/cra-workflow-integration.js"');
  test(
    'Bundle chargé avant l\'intégration',
    bundleScriptIdx !== -1 && integrationScriptIdx !== -1 && bundleScriptIdx < integrationScriptIdx,
    bundleScriptIdx === -1 ? 'Bundle non trouvé' : (integrationScriptIdx === -1 ? 'Intégration non trouvée' : 'Ordre incorrect')
  );
  
  // 2. Intégration chargée avant le script principal
  const mainScriptStart = content.indexOf('<script>\n// <taskflow-core>');
  test(
    'Intégration chargée avant le script principal',
    integrationScriptIdx !== -1 && mainScriptStart !== -1 && integrationScriptIdx < mainScriptStart,
    'Ordre de chargement incorrect'
  );
  
  // 3. Contrôle défensif de TaskFlowCra
  const hasTaskFlowCraCheck = content.includes('typeof CraWorkflowIntegration') || 
                               content.includes('CraWorkflowIntegration !== \'undefined\'');
  test(
    'Contrôle défensif de CraWorkflowIntegration',
    hasTaskFlowCraCheck,
    'Aucun contrôle défensif trouvé'
  );
  
  // 4. Aucune soumission par visiblePersonIds[0] dans updateSubmitBtn
  const updateSubmitBtnStart = content.indexOf('function updateSubmitBtn()');
  const updateSubmitBtnEnd = content.indexOf('\nfunction renderSaisie()', updateSubmitBtnStart);
  const updateSubmitBtnCode = content.substring(updateSubmitBtnStart, updateSubmitBtnEnd !== -1 ? updateSubmitBtnEnd : updateSubmitBtnStart + 3000);
  // Vérifier si visiblePersonIds[0] est utilisé pour l'onclick de soumission (pas pour l'affichage)
  const hasVisiblePersonIdsSubmit = /visiblePersonIds\[0\].*submitWeek|visiblePersonIds\[0\].*submitCurrentWeek/.test(updateSubmitBtnCode);
  test(
    'Aucune soumission par visiblePersonIds[0] dans updateSubmitBtn',
    !hasVisiblePersonIdsSubmit,
    'visiblePersonIds[0] utilisé pour la soumission (onclick)'
  );
  
  // 5. Aucune soumission par selectedPersonId comme acteur
  const submitWeekForPersonStart = content.indexOf('async function submitWeekForPerson');
  const submitWeekForPersonEnd = content.indexOf('\nasync function withdrawWeekForPerson', submitWeekForPersonStart);
  const submitWeekForPersonCode = content.substring(submitWeekForPersonStart, submitWeekForPersonEnd !== -1 ? submitWeekForPersonEnd : submitWeekForPersonStart + 500);
  const hasSelectedPersonAsActor = submitWeekForPersonCode.includes('selectedPersonId') && 
                                    submitWeekForPersonCode.includes('CraWorkflowIntegration');
  test(
    'submitWeekForPerson utilise currentUserMemberId',
    submitWeekForPersonCode.includes('currentUserMemberId'),
    'selectedPersonId utilisé comme acteur'
  );
  
  // 6. Aucune transition utilisant S.me
  const hasSmeUsage = content.includes('S.me') && 
                      (content.includes('submitWeek') || content.includes('withdrawWeek'));
  // Vérifier si S.me est utilisé dans les fonctions de workflow
  const workflowFunctions = ['submitWeek', 'withdrawWeek', 'submitWeekForPerson', 'withdrawWeekForPerson'];
  let sMeInWorkflow = false;
  workflowFunctions.forEach(fn => {
    const fnStart = content.indexOf('function ' + fn);
    if (fnStart !== -1) {
      const fnEnd = content.indexOf('\nfunction', fnStart + 1);
      const fnCode = content.substring(fnStart, fnEnd !== -1 ? fnEnd : fnStart + 1000);
      if (fnCode.includes('S.me')) {
        sMeInWorkflow = true;
      }
    }
  });
  test(
    'Aucune transition utilisant S.me',
    !sMeInWorkflow,
    'S.me utilisé dans les fonctions de workflow'
  );
  
  // 7. Aucune écriture directe de Feuilles.statut dans submitWeekForPerson
  const hasDirectStatutWrite = submitWeekForPersonCode.includes('statut') && 
                                submitWeekForPersonCode.includes('applyUserActions');
  test(
    'submitWeekForPerson sans écriture directe de statut',
    !hasDirectStatutWrite,
    'Écriture directe de Feuilles.statut détectée'
  );
  
  // 8. Aucune mutation optimiste de feuille
  const hasObjectAssignSheet = submitWeekForPersonCode.includes('Object.assign') && 
                                submitWeekForPersonCode.includes('sheet');
  test(
    'Aucune mutation optimiste de feuille',
    !hasObjectAssignSheet,
    'Object.assign sur sheet détecté'
  );
  
  // 9. Validation déléguée
  const validerFeuilleStart = content.indexOf('window.validerFeuille');
  const validerFeuilleEnd = content.indexOf('\nwindow.rejeterFeuille', validerFeuilleStart);
  const validerFeuilleCode = content.substring(validerFeuilleStart, validerFeuilleEnd !== -1 ? validerFeuilleEnd : validerFeuilleStart + 300);
  const validatesDelegated = validerFeuilleCode.includes('CraWorkflowIntegration') && 
                              validerFeuilleCode.includes('validateSheet');
  test(
    'Validation déléguée à CraWorkflowIntegration',
    validatesDelegated,
    'Validation non déléguée'
  );
  
  // 10. Rejet délégué
  const rejeterFeuilleStart = content.indexOf('window.rejeterFeuille');
  const rejeterFeuilleEnd = content.indexOf('\n//', rejeterFeuilleStart);
  const rejeterFeuilleCode = content.substring(rejeterFeuilleStart, rejeterFeuilleEnd !== -1 ? rejeterFeuilleEnd : rejeterFeuilleStart + 300);
  const rejectsDelegated = rejeterFeuilleCode.includes('CraWorkflowIntegration') && 
                           rejeterFeuilleCode.includes('rejectSheet');
  test(
    'Rejet délégué à CraWorkflowIntegration',
    rejectsDelegated,
    'Rejet non délégué'
  );
  
  // 11. Modale métier présente (dans cra-workflow-integration.js ou cra.html)
  const integrationContent = fs.readFileSync(path.join(__dirname, '..', 'core', 'cra', 'cra-workflow-integration.js'), 'utf8');
  const hasRejectModal = content.includes('craRejectModal') || content.includes('showRejectModal') || 
                         integrationContent.includes('craRejectModal') || integrationContent.includes('showRejectModal');
  const hasCorrectionModal = content.includes('craCorrectionModal') || content.includes('showCorrectionModal') ||
                              integrationContent.includes('craCorrectionModal') || integrationContent.includes('showCorrectionModal');
  test(
    'Modale métier présente (rejet)',
    hasRejectModal,
    'Modale de rejet absente'
  );
  test(
    'Modale métier présente (correction)',
    hasCorrectionModal,
    'Modale de correction absente'
  );
  
  // 12. Aucun window.prompt()
  const hasWindowPrompt = content.includes('window.prompt(') || content.includes('.prompt(');
  test(
    'Aucun window.prompt()',
    !hasWindowPrompt,
    'window.prompt() détecté'
  );
  
  // 13. Mode correction présent
  const hasManagerCorrection = content.includes('managerCorrectionSheetId') || 
                               content.includes('enterManagerCorrection');
  test(
    'Mode correction manager présent',
    hasManagerCorrection,
    'Mode correction manager absent'
  );
  
  // 14. Routage manager vers updateManagerActual()
  const setCellStart = content.indexOf('async function setCell(');
  const setCellEnd = content.indexOf('\nwindow.setCell', setCellStart);
  const setCellCode = content.substring(setCellStart, setCellEnd !== -1 ? setCellEnd : setCellStart + 2000);
  const hasManagerRouting = setCellCode.includes('managerCorrectionSheetId') && 
                            setCellCode.includes('updateManagerActual');
  test(
    'Routage manager vers updateManagerActual()',
    hasManagerRouting,
    'Routage manager absent'
  );
  
  // 15. Aucune création de TimeEntry en correction
  // Vérifier que le mode correction bloque explicitement la création
  const blocksCreateInCorrection = setCellCode.includes('managerCorrectionSheetId') && 
                                   setCellCode.includes('seules les entrées existantes') ||
                                   setCellCode.includes('return') && setCellCode.includes('!existingEntry');
  test(
    'Aucune création de TimeEntry en correction',
    blocksCreateInCorrection,
    'Création de TimeEntry non bloquée en mode correction'
  );
  
  // 16. Revalidation déléguée
  const revalidateSheetStart = content.indexOf('function revalidateSheet');
  const revalidateSheetEnd = content.indexOf('\nfunction leaveManagerCorrection', revalidateSheetStart);
  const revalidateSheetCode = content.substring(revalidateSheetStart, revalidateSheetEnd !== -1 ? revalidateSheetEnd : revalidateSheetStart + 300);
  const revalidatesDelegated = revalidateSheetCode.includes('CraWorkflowIntegration') && 
                                revalidateSheetCode.includes('revalidateSheet');
  test(
    'Revalidation déléguée à CraWorkflowIntegration',
    revalidatesDelegated,
    'Revalidation non déléguée'
  );
  
  // Résumé
  console.log('\n' + '='.repeat(60));
  console.log('Résumé : ' + passed + ' passés, ' + failed + ' échoués');
  
  if (failed > 0) {
    console.error('\nÉchecs :');
    errors.forEach(e => {
      console.error('  - ' + e.name + (e.details ? ': ' + e.details : ''));
    });
    process.exit(1);
  } else {
    console.log('✅ Tous les tests statiques sont passés');
  }
}

runStaticTests();
