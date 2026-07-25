/**
 * CRA Workflow Integration - Intégration du workflow dans l'UI du CRA
 * 
 * Ce fichier fait le lien entre l'ancien code CRA et le nouveau service transactionnel.
 * Il doit être chargé APRÈS le bundle taskflow-cra-browser.js et APRÈS l'initialisation de S.
 * 
 * @module core/cra/cra-workflow-integration
 */

(function(global) {
  'use strict';
  
  /**
   * Helper : obtenir le lundi de la semaine pour une date
   */
  function getMondayOf(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  }
  
  /**
   * Helper : formater une date en ISO YYYY-MM-DD
   */
  function toISODate(date) {
    return date.toISOString().split('T')[0];
  }
  
  /**
   * Helper : trouver l'unique feuille pour un membre et une semaine
   */
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
  
  /**
   * Remplace submitWeekForPerson par l'adaptateur
   */
  async function submitWeekForPerson(personId) {
    // Vérifier que c'est bien l'acteur qui soumet sa propre feuille
    if (!globalThis.S || !globalThis.S.currentUserMemberId) {
      toast('Acteur non identifié');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    // La soumission ne concerne que la feuille de currentUserMemberId
    if (personId !== globalThis.S.currentUserMemberId) {
      toast('Vous ne pouvez soumettre que votre propre feuille');
      return { success: false, code: 'NOT_SHEET_OWNER' };
    }
    
    // Trouver la feuille
    const monday = new Date(globalThis.S.weekStart * 1000);
    const sheet = findSheetForMemberWeek(personId, monday, globalThis.S.feuilles);
    
    if (!sheet) {
      toast('Aucune feuille trouvée pour cette semaine. Veuillez créer une feuille d\'abord.');
      return { success: false, code: 'NO_SHEET' };
    }
    
    // Vérifier le statut
    const status = String(sheet.statut || '').toLowerCase();
    if (['soumis', 'submitted', 'valide', 'validated', 'correction_manager'].includes(status)) {
      toast('Feuille non éditable (statut: ' + status + ')');
      return { success: false, code: 'SHEET_NOT_EDITABLE' };
    }
    
    // Utiliser l'adaptateur
    if (!globalThis.craSheetAdapter) {
      toast('Adaptateur non initialisé');
      return { success: false, code: 'ADAPTER_NOT_READY' };
    }
    
    return await globalThis.craSheetAdapter.submit(sheet.id);
  }
  
  /**
   * Remplace withdrawWeekForPerson par l'adaptateur
   */
  async function withdrawWeekForPerson(personId) {
    if (!globalThis.S || !globalThis.S.currentUserMemberId) {
      toast('Acteur non identifié');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    if (personId !== globalThis.S.currentUserMemberId) {
      toast('Vous ne pouvez retirer que votre propre soumission');
      return { success: false, code: 'NOT_SHEET_OWNER' };
    }
    
    const monday = new Date(globalThis.S.weekStart * 1000);
    const sheet = findSheetForMemberWeek(personId, monday, globalThis.S.feuilles);
    
    if (!sheet) {
      toast('Aucune feuille trouvée');
      return { success: false, code: 'NO_SHEET' };
    }
    
    if (!globalThis.craSheetAdapter) {
      toast('Adaptateur non initialisé');
      return { success: false, code: 'ADAPTER_NOT_READY' };
    }
    
    return await globalThis.craSheetAdapter.withdraw(sheet.id);
  }
  
  /**
   * Remplace validerFeuille par l'adaptateur
   */
  async function validerFeuille(sheetId) {
    if (!globalThis.craSheetAdapter) {
      toast('Adaptateur non initialisé');
      return { success: false, code: 'ADAPTER_NOT_READY' };
    }
    
    return await globalThis.craSheetAdapter.validate(sheetId);
  }
  
  /**
   * Remplace rejeterFeuille par l'adaptateur avec modale
   */
  async function rejeterFeuille(sheetId) {
    if (!globalThis.craSheetAdapter) {
      toast('Adaptateur non initialisé');
      return { success: false, code: 'ADAPTER_NOT_READY' };
    }
    
    // Afficher la modale de rejet
    const reason = await showRejectModal();
    if (!reason) {
      return { success: false, code: 'MISSING_REJECT_REASON' };
    }
    
    return await globalThis.craSheetAdapter.reject(sheetId, reason);
  }
  
  /**
   * Modale de rejet
   */
  function showRejectModal() {
    return new Promise((resolve) => {
      // Créer la modale si elle n'existe pas
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
        
        // Gérer la fermeture
        document.getElementById('craRejectCancel').onclick = () => {
          modal.classList.remove('open');
          resolve(null);
        };
        
        // Fermeture par Échap
        const escHandler = (e) => {
          if (e.key === 'Escape') {
            modal.classList.remove('open');
            document.removeEventListener('keydown', escHandler);
            resolve(null);
          }
        };
        document.addEventListener('keydown', escHandler);
      }
      
      // Afficher la modale
      modal.classList.add('open');
      const textarea = document.getElementById('craRejectReason');
      textarea.value = '';
      textarea.focus();
      
      // Confirmer
      document.getElementById('craRejectConfirm').onclick = () => {
        const reason = textarea.value.trim();
        if (!reason) {
          toast('Le motif est obligatoire');
          return;
        }
        modal.classList.remove('open');
        resolve(reason);
      };
    });
  }
  
  /**
   * Modale d'ouverture de correction manager
   */
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
          toast('Le motif est obligatoire');
          return;
        }
        modal.classList.remove('open');
        resolve(reason);
      };
    });
  }
  
  /**
   * Ouvrir une correction manager
   */
  async function openManagerCorrection(sheetId) {
    if (!globalThis.craSheetAdapter) {
      toast('Adaptateur non initialisé');
      return { success: false, code: 'ADAPTER_NOT_READY' };
    }
    
    const reason = await showCorrectionModal();
    if (!reason) {
      return { success: false, code: 'MISSING_CORRECTION_REASON' };
    }
    
    return await globalThis.craSheetAdapter.openCorrection(sheetId, reason);
  }
  
  /**
   * Revalider une feuille après correction
   */
  async function revalidateSheet(sheetId) {
    if (!globalThis.craSheetAdapter) {
      toast('Adaptateur non initialisé');
      return { success: false, code: 'ADAPTER_NOT_READY' };
    }
    
    return await globalThis.craSheetAdapter.revalidate(sheetId);
  }
  
  /**
   * Mettre à jour les heures d'une TimeEntry en mode correction
   */
  async function updateManagerActualHours(sheetId, timeEntryId, hours) {
    if (!globalThis.craSheetAdapter) {
      toast('Adaptateur non initialisé');
      return { success: false, code: 'ADAPTER_NOT_READY' };
    }
    
    return await globalThis.craSheetAdapter.updateManagerActual(sheetId, timeEntryId, hours);
  }
  
  /**
   * Calculer les feuilles accessibles au manager (par snapshot)
   */
  function getManagerAccessibleSheets(managerId, sheets) {
    if (!managerId || !sheets) {
      return [];
    }
    
    return sheets.filter(f => {
      const status = String(f.statut || '').toLowerCase();
      const resp = f.responsableValidation;
      
      // Utiliser le snapshot responsableValidation, pas Team.responsable
      if (!resp || resp !== managerId) {
        return false;
      }
      
      // Feuilles soumises, validées, ou en correction_manager
      return ['soumis', 'submitted', 'valide', 'validated', 'correction_manager'].includes(status);
    });
  }
  
  /**
   * Vérifier si une feuille est accessible au manager
   */
  function isSheetAccessibleToManager(sheet, managerId) {
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
  
  // Exposer globalement
  globalThis.CraWorkflowIntegration = {
    submitWeekForPerson,
    withdrawWeekForPerson,
    validerFeuille,
    rejeterFeuille,
    openManagerCorrection,
    revalidateSheet,
    updateManagerActualHours,
    getManagerAccessibleSheets,
    isSheetAccessibleToManager,
    showRejectModal,
    showCorrectionModal
  };
  
  console.info('[CRA] Workflow integration loaded');
  
})(typeof globalThis !== 'undefined' ? globalThis : this);
