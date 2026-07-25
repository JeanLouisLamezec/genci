/**
 * CRA Workflow Integration - Intégration du workflow dans l'UI du CRA
 * 
 * Ce fichier est la frontière unique entre le HTML et l'adaptateur UI.
 * Il doit être chargé APRÈS le bundle taskflow-cra-browser.js et APRÈS l'initialisation de S.
 * 
 * API :
 *   CraWorkflowIntegration.configure({ grist, taskFlowCra, getState, reload, notify, setBusy })
 *   CraWorkflowIntegration.submitCurrentWeek()
 *   CraWorkflowIntegration.withdrawCurrentWeek()
 *   CraWorkflowIntegration.validateSheet(sheetId)
 *   CraWorkflowIntegration.rejectSheet(sheetId, reason)
 *   CraWorkflowIntegration.openCorrection(sheetId, reason)
 *   CraWorkflowIntegration.enterManagerCorrection(sheetId)
 *   CraWorkflowIntegration.updateManagerActual(sheetId, timeEntryId, hours)
 *   CraWorkflowIntegration.revalidateSheet(sheetId)
 *   CraWorkflowIntegration.leaveManagerCorrection()
 * 
 * @module core/cra/cra-workflow-integration
 */

(function(global) {
  'use strict';
  
  // État interne
  let config = null;
  let adapter = null;
  
  // Helper : obtenir le lundi de la semaine pour une date
  function getMondayOf(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  }
  
  // Helper : formater une date en ISO YYYY-MM-DD
  function toISODate(date) {
    return date.toISOString().split('T')[0];
  }
  
  // Helper : trouver l'unique feuille pour un membre et une semaine
  function findSheetForMemberWeek(memberId, weekStart, sheets) {
    if (!memberId || !weekStart || !sheets) {
      return null;
    }
    
    const weekStartIso = toISODate(weekStart);
    
    return sheets.find(f => {
      if (!f.membre || f.membre !== memberId) return false;
      if (!f.semaine) return false;
      
      const fWeekStart = getMondayOf(new Date(f.semaine * 1000));
      return toISODate(fWeekStart) === weekStartIso;
    });
  }
  
  // Helper : résoudre la feuille courante pour l'utilisateur connecté
  function resolveCurrentUserSheet(state) {
    if (!state || !state.currentUserMemberId || !state.feuilles) {
      return { sheet: null, status: 'none', reason: 'MISSING_STATE' };
    }
    
    const monday = new Date(state.weekStart * 1000);
    const mondayIso = monday.toISOString().split('T')[0];
    
    // Trouver toutes les feuilles pour currentUserMemberId et cette semaine
    const matchingSheets = state.feuilles.filter(f => {
      if (f.membre !== state.currentUserMemberId) return false;
      if (!f.semaine) return false;
      
      const fWeekStart = getMondayOf(new Date(f.semaine * 1000));
      return fWeekStart.toISOString().split('T')[0] === mondayIso;
    });
    
    if (matchingSheets.length === 0) {
      return { sheet: null, status: 'none', reason: 'NO_SHEET_FOR_WEEK' };
    }
    
    if (matchingSheets.length > 1) {
      return { sheet: null, status: 'duplicate', reason: 'DUPLICATE_WEEKLY_SHEET', duplicates: matchingSheets };
    }
    
    return { sheet: matchingSheets[0], status: 'found', reason: 'SHEET_FOUND' };
  }
  
  // Helper : vérifier si une feuille est accessible au manager par snapshot
  function isSheetAccessibleBySnapshot(sheet, managerId) {
    if (!sheet || !managerId) {
      return false;
    }
    
    const resp = sheet.responsableValidation;
    if (!resp || resp !== managerId) {
      return false;
    }
    
    const status = String(sheet.statut || '').toLowerCase();
    return ['soumis', 'submitted', 'valide', 'validated', 'correction_manager'].includes(status);
  }
  
  // Helper : obtenir les feuilles accessibles au manager
  function getManagerAccessibleSheets(managerId, sheets) {
    if (!managerId || !sheets) {
      return [];
    }
    
    return sheets.filter(f => isSheetAccessibleBySnapshot(f, managerId));
  }
  
  // Modale de rejet
  function showRejectModal() {
    return new Promise((resolve) => {
      let modal = document.getElementById('craRejectModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'craRejectModal';
        modal.className = 'modal-ov';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'craRejectTitle');
        modal.innerHTML = `
          <div class="modal">
            <h2 id="craRejectTitle">Rejeter la feuille</h2>
            <p class="csub">Veuillez indiquer un motif de rejet</p>
            <label for="craRejectReason" style="display:block;margin-bottom:8px;font-weight:600;font-size:.88rem;">Motif</label>
            <textarea id="craRejectReason" rows="4" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:10px;font-family:inherit;font-size:.88rem;resize:vertical;" placeholder="Ex: Heures incorrectes, capacité dépassée..."></textarea>
            <div class="cacts" style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
              <button class="cbtn" id="craRejectCancel">Annuler</button>
              <button class="cbtn danger" id="craRejectConfirm">Rejeter</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
        
        document.getElementById('craRejectCancel').onclick = () => {
          modal.classList.remove('open');
          resolve(null);
        };
        
        const escHandler = (e) => {
          if (e.key === 'Escape') {
            modal.classList.remove('open');
            document.removeEventListener('keydown', escHandler);
            resolve(null);
          }
        };
        document.addEventListener('keydown', escHandler);
      }
      
      modal.classList.add('open');
      const textarea = document.getElementById('craRejectReason');
      textarea.value = '';
      textarea.focus();
      
      document.getElementById('craRejectConfirm').onclick = () => {
        const reason = textarea.value.trim();
        if (!reason) {
          if (config && typeof config.notify === 'function') {
            config.notify('Le motif est obligatoire', 'error');
          }
          return;
        }
        modal.classList.remove('open');
        resolve(reason);
      };
    });
  }
  
  // Modale d'ouverture de correction manager
  function showCorrectionModal() {
    return new Promise((resolve) => {
      let modal = document.getElementById('craCorrectionModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'craCorrectionModal';
        modal.className = 'modal-ov';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'craCorrectionTitle');
        modal.innerHTML = `
          <div class="modal">
            <h2 id="craCorrectionTitle">Ouvrir une correction</h2>
            <p class="csub">Veuillez indiquer un motif pour ouvrir une correction manager</p>
            <label for="craCorrectionReason" style="display:block;margin-bottom:8px;font-weight:600;font-size:.88rem;">Motif</label>
            <textarea id="craCorrectionReason" rows="4" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:10px;font-family:inherit;font-size:.88rem;resize:vertical;" placeholder="Ex: Erreur sur les heures, modification nécessaire..."></textarea>
            <div class="cacts" style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
              <button class="cbtn" id="craCorrectionCancel">Annuler</button>
              <button class="cbtn primary" id="craCorrectionConfirm">Ouvrir la correction</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
        
        document.getElementById('craCorrectionCancel').onclick = () => {
          modal.classList.remove('open');
          resolve(null);
        };
        
        const escHandler = (e) => {
          if (e.key === 'Escape') {
            modal.classList.remove('open');
            document.removeEventListener('keydown', escHandler);
            resolve(null);
          }
        };
        document.addEventListener('keydown', escHandler);
      }
      
      modal.classList.add('open');
      const textarea = document.getElementById('craCorrectionReason');
      textarea.value = '';
      textarea.focus();
      
      document.getElementById('craCorrectionConfirm').onclick = () => {
        const reason = textarea.value.trim();
        if (!reason) {
          if (config && typeof config.notify === 'function') {
            config.notify('Le motif est obligatoire', 'error');
          }
          return;
        }
        modal.classList.remove('open');
        resolve(reason);
      };
    });
  }
  
  // Configuration
  function configure(options) {
    if (!options) {
      throw new Error('CraWorkflowIntegration.configure: options requises');
    }
    
    const { grist, taskFlowCra, getState, reload, notify, setBusy } = options;
    
    if (!grist || !taskFlowCra || !taskFlowCra.service || !taskFlowCra.createUiAdapter) {
      throw new Error('CraWorkflowIntegration.configure: taskFlowCra et service requis');
    }
    
    if (!getState || typeof getState !== 'function') {
      throw new Error('CraWorkflowIntegration.configure: getState requis');
    }
    
    config = { grist, taskFlowCra, getState, reload, notify, setBusy };
    
    // Créer l'adaptateur UI
    adapter = taskFlowCra.createUiAdapter({
      service: taskFlowCra.service,
      grist,
      getActorMemberId: () => {
        const state = getState();
        return state ? state.currentUserMemberId : null;
      },
      reload: reload || (() => {}),
      notify: notify || (() => {}),
      setBusy: setBusy || (() => {})
    });
    
    console.info('[CRA] Workflow integration configured');
  }
  
  // Soumettre la semaine courante
  async function submitCurrentWeek() {
    if (!config || !adapter) {
      throw new Error('CraWorkflowIntegration non configuré');
    }
    
    const state = config.getState();
    if (!state || !state.currentUserMemberId) {
      if (config.notify) config.notify('Acteur non identifié', 'error');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    const sheetResult = resolveCurrentUserSheet(state);
    if (sheetResult.status === 'none') {
      if (config.notify) config.notify('Aucune feuille trouvée pour cette semaine', 'error');
      return { success: false, code: 'NO_SHEET' };
    }
    
    if (sheetResult.status === 'duplicate') {
      if (config.notify) config.notify('Plusieurs feuilles existent pour cette semaine', 'error');
      return { success: false, code: 'DUPLICATE_WEEKLY_SHEET' };
    }
    
    return await adapter.submit(sheetResult.sheet.id);
  }
  
  // Retirer la soumission
  async function withdrawCurrentWeek() {
    if (!config || !adapter) {
      throw new Error('CraWorkflowIntegration non configuré');
    }
    
    const state = config.getState();
    if (!state || !state.currentUserMemberId) {
      if (config.notify) config.notify('Acteur non identifié', 'error');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    const sheetResult = resolveCurrentUserSheet(state);
    if (sheetResult.status !== 'found' || !sheetResult.sheet) {
      if (config.notify) config.notify('Aucune feuille trouvée', 'error');
      return { success: false, code: 'NO_SHEET' };
    }
    
    return await adapter.withdraw(sheetResult.sheet.id);
  }
  
  // Valider une feuille
  async function validateSheet(sheetId) {
    if (!config || !adapter) {
      throw new Error('CraWorkflowIntegration non configuré');
    }
    
    return await adapter.validate(sheetId);
  }
  
  // Rejeter une feuille avec modale
  async function rejectSheet(sheetId) {
    if (!config || !adapter) {
      throw new Error('CraWorkflowIntegration non configuré');
    }
    
    const reason = await showRejectModal();
    if (!reason) {
      return { success: false, code: 'MISSING_REJECT_REASON' };
    }
    
    return await adapter.reject(sheetId, reason);
  }
  
  // Ouvrir une correction manager avec modale
  async function openCorrection(sheetId) {
    if (!config || !adapter) {
      throw new Error('CraWorkflowIntegration non configuré');
    }
    
    const reason = await showCorrectionModal();
    if (!reason) {
      return { success: false, code: 'MISSING_CORRECTION_REASON' };
    }
    
    return await adapter.openCorrection(sheetId, reason);
  }
  
  // Entrer en mode correction manager
  function enterManagerCorrection(sheetId) {
    if (!config) {
      throw new Error('CraWorkflowIntegration non configuré');
    }
    
    // Stocker l'état de correction dans le state global
    const state = config.getState();
    if (state) {
      state.managerCorrectionSheetId = sheetId;
    }
    
    if (config.notify) {
      config.notify('Mode correction manager activé', 'info');
    }
  }
  
  // Mettre à jour les heures en mode correction
  async function updateManagerActual(sheetId, timeEntryId, hours) {
    if (!config || !adapter) {
      throw new Error('CraWorkflowIntegration non configuré');
    }
    
    return await adapter.updateManagerActual(sheetId, timeEntryId, hours);
  }
  
  // Revalider une feuille après correction
  async function revalidateSheet(sheetId) {
    if (!config || !adapter) {
      throw new Error('CraWorkflowIntegration non configuré');
    }
    
    const result = await adapter.revalidate(sheetId);
    
    if (result && result.success) {
      // Quitter le mode correction
      leaveManagerCorrection();
    }
    
    return result;
  }
  
  // Quitter le mode correction manager
  function leaveManagerCorrection() {
    if (!config) {
      throw new Error('CraWorkflowIntegration non configuré');
    }
    
    const state = config.getState();
    if (state) {
      state.managerCorrectionSheetId = null;
    }
    
    if (config.notify) {
      config.notify('Mode correction manager désactivé', 'info');
    }
  }
  
  // Exposer l'API publique
  global.CraWorkflowIntegration = {
    configure,
    submitCurrentWeek,
    withdrawCurrentWeek,
    validateSheet,
    rejectSheet,
    openCorrection,
    enterManagerCorrection,
    updateManagerActual,
    revalidateSheet,
    leaveManagerCorrection,
    // Helpers pour compatibilité
    getManagerAccessibleSheets,
    isSheetAccessibleBySnapshot,
    showRejectModal,
    showCorrectionModal
  };
  
  console.info('[CRA] Workflow integration loaded');
  
})(typeof globalThis !== 'undefined' ? globalThis : this);
