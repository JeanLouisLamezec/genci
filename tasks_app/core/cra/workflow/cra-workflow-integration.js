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
 *   CraWorkflowIntegration.prepareRetroactiveCorrection(memberId, weekStart, reason)
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
  
  // CORRECTION : Verrou pour empêcher le double-clic sur submitCurrentWeek
  let submitCurrentWeekPending = false;
  
  // CORRECTION v20260726-5 : Normaliser un timestamp en millisecondes (Grist secondes ou JS ms)
  function normalizeDateMs(value) {
    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {
      return null;
    }

    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? ms : null;
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return null;
      }

      // Timestamp Grist en secondes ou timestamp JS en millisecondes.
      return Math.abs(value) < 100000000000
        ? value * 1000
        : value;
    }

    if (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      const [year, month, day] =
        value.split('-').map(Number);

      // Midi local évite les ambiguïtés autour des changements d'heure.
      return new Date(
        year,
        month - 1,
        day,
        12,
        0,
        0,
        0
      ).getTime();
    }

    const parsed = new Date(value).getTime();

    return Number.isFinite(parsed)
      ? parsed
      : null;
  }

  // CORRECTION v20260726-5 : Formater une date locale en ISO YYYY-MM-DD sans passer par UTC
  function localDateIso(ms) {
    const date = new Date(ms);

    if (!Number.isFinite(date.getTime())) {
      return null;
    }

    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  // CORRECTION v20260726-5 : Obtenir le lundi de la semaine en millisecondes
  function mondayOf(value) {
    const ms = normalizeDateMs(value);

    if (ms === null) {
      return null;
    }

    const date = new Date(ms);
    const dayOffset =
      (date.getDay() + 6) % 7;

    date.setHours(0, 0, 0, 0);
    date.setDate(
      date.getDate() - dayOffset
    );

    return date.getTime();
  }

  // CORRECTION v20260726-5 : Obtenir le lundi canonique en ISO local
  function getWeekStartIso(value) {
    const mondayMs = mondayOf(value);

    return mondayMs === null
      ? null
      : localDateIso(mondayMs);
  }
  
  // CORRECTION v20260726-5 : Normaliser un ID membre
  function normalizeId(value) {
    const id = Number(value);

    return Number.isInteger(id) && id > 0
      ? id
      : null;
  }

  // CORRECTION v20260726-5 : Trouver l'unique feuille pour un membre et une semaine
  function findSheetForMemberWeek(
    memberId,
    weekStart,
    sheets
  ) {
    const normalizedMemberId =
      normalizeId(memberId);

    const expectedWeekIso =
      getWeekStartIso(weekStart);

    if (
      normalizedMemberId === null ||
      !expectedWeekIso ||
      !Array.isArray(sheets)
    ) {
      return null;
    }

    return sheets.find(sheet =>
      normalizeId(sheet.membre) ===
        normalizedMemberId &&
      getWeekStartIso(sheet.semaine) ===
        expectedWeekIso
    ) || null;
  }
  
  // CORRECTION v20260726-5 : Résoudre la feuille courante pour l'utilisateur connecté
  function resolveCurrentUserSheet(state) {
    const memberId =
      normalizeId(state?.currentUserMemberId);

    if (
      memberId === null ||
      !Array.isArray(state?.feuilles)
    ) {
      return {
        sheet: null,
        status: 'none',
        reason: 'MISSING_STATE'
      };
    }

    const expectedWeekIso =
      getWeekStartIso(state.weekStart);

    if (!expectedWeekIso) {
      return {
        sheet: null,
        status: 'none',
        reason: 'INVALID_WEEK'
      };
    }

    const matchingSheets =
      state.feuilles.filter(sheet =>
        normalizeId(sheet.membre) === memberId &&
        getWeekStartIso(sheet.semaine) ===
          expectedWeekIso
      );

    if (matchingSheets.length === 0) {
      return {
        sheet: null,
        status: 'none',
        reason: 'NO_SHEET_FOR_WEEK'
      };
    }

    if (matchingSheets.length > 1) {
      return {
        sheet: null,
        status: 'duplicate',
        reason: 'DUPLICATE_WEEKLY_SHEET',
        duplicates: matchingSheets
      };
    }

    return {
      sheet: matchingSheets[0],
      status: 'found',
      reason: 'SHEET_FOUND'
    };
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
      let textarea, confirmBtn, cancelBtn, escHandler, errorEl;
      
      // Créer la modale si elle n'existe pas
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
            <div id="craRejectError" style="color:#ef4444;font-size:.8rem;margin-top:8px;display:none"></div>
            <div class="cacts" style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
              <button class="cbtn" id="craRejectCancel">Annuler</button>
              <button class="cbtn danger" id="craRejectConfirm">Rejeter</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
      }
      
      textarea = document.getElementById('craRejectReason');
      confirmBtn = document.getElementById('craRejectConfirm');
      cancelBtn = document.getElementById('craRejectCancel');
      errorEl = document.getElementById('craRejectError');
      
      // Fonction de fermeture
      function closeModal(result) {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        if (escHandler) {
          document.removeEventListener('keydown', escHandler);
        }
        if (cancelBtn) cancelBtn.onclick = null;
        if (confirmBtn) confirmBtn.onclick = null;
        resolve(result);
      }
      
      // Gestionnaire Échap
      escHandler = (e) => {
        if (e.key === 'Escape') {
          closeModal(null);
        }
      };
      document.addEventListener('keydown', escHandler);
      
      // Bouton Annuler
      cancelBtn.onclick = () => closeModal(null);
      
      // Bouton Confirmer
      confirmBtn.onclick = () => {
        const reason = textarea.value.trim();
        if (!reason) {
          errorEl.textContent = 'Le motif est obligatoire';
          errorEl.style.display = 'block';
          textarea.focus();
          return;
        }
        errorEl.style.display = 'none';
        confirmBtn.disabled = true;
        closeModal(reason);
      };
      
      // Afficher la modale
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      textarea.value = '';
      errorEl.style.display = 'none';
      confirmBtn.disabled = false;
      textarea.focus();
    });
  }
  
  // Modale d'ouverture de correction manager
  function showCorrectionModal() {
    return new Promise((resolve) => {
      let modal = document.getElementById('craCorrectionModal');
      let textarea, confirmBtn, cancelBtn, escHandler, errorEl;
      
      // Créer la modale si elle n'existe pas
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
            <div id="craCorrectionError" style="color:#ef4444;font-size:.8rem;margin-top:8px;display:none"></div>
            <div class="cacts" style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
              <button class="cbtn" id="craCorrectionCancel">Annuler</button>
              <button class="cbtn primary" id="craCorrectionConfirm">Ouvrir la correction</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
      }
      
      textarea = document.getElementById('craCorrectionReason');
      confirmBtn = document.getElementById('craCorrectionConfirm');
      cancelBtn = document.getElementById('craCorrectionCancel');
      errorEl = document.getElementById('craCorrectionError');
      
      // Fonction de fermeture
      function closeModal(result) {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        if (escHandler) {
          document.removeEventListener('keydown', escHandler);
        }
        if (cancelBtn) cancelBtn.onclick = null;
        if (confirmBtn) confirmBtn.onclick = null;
        resolve(result);
      }
      
      // Gestionnaire Échap
      escHandler = (e) => {
        if (e.key === 'Escape') {
          closeModal(null);
        }
      };
      document.addEventListener('keydown', escHandler);
      
      // Bouton Annuler
      cancelBtn.onclick = () => closeModal(null);
      
      // Bouton Confirmer
      confirmBtn.onclick = () => {
        const reason = textarea.value.trim();
        if (!reason) {
          errorEl.textContent = 'Le motif est obligatoire';
          errorEl.style.display = 'block';
          textarea.focus();
          return;
        }
        errorEl.style.display = 'none';
        confirmBtn.disabled = true;
        closeModal(reason);
      };
      
      // Afficher la modale
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      textarea.value = '';
      errorEl.style.display = 'none';
      confirmBtn.disabled = false;
      textarea.focus();
    });
  }
  
  // Configuration
  function configure(options) {
    if (!options) {
      throw new Error('CraWorkflowIntegration.configure: options requises');
    }
    
    const { grist, taskFlowCra, getState, getActor, reload, notify, setBusy, enterCorrectionMode, leaveCorrectionMode } = options;
    
    if (!grist || !taskFlowCra || !taskFlowCra.service || !taskFlowCra.createUiAdapter) {
      throw new Error('CraWorkflowIntegration.configure: taskFlowCra et service requis');
    }
    
    if (!getState || typeof getState !== 'function') {
      throw new Error('CraWorkflowIntegration.configure: getState requis');
    }
    
    // Protection contre double configuration
    if (config !== null) {
      console.warn('[CRA] CraWorkflowIntegration déjà configuré, ignoré');
      return;
    }
    
    config = { 
      grist, 
      taskFlowCra, 
      getState, 
      getActor,
      reload, 
      notify, 
      setBusy,
      enterCorrectionMode: enterCorrectionMode || (() => {}),
      leaveCorrectionMode: leaveCorrectionMode || (() => {})
    };
    
    // Créer l'adaptateur UI
    adapter = taskFlowCra.createUiAdapter({
      service: taskFlowCra.service,
      grist,
      getActorMemberId: () => {
        const state = getState();
        return state ? state.currentUserMemberId : null;
      },
      getActor: () => {
        if (typeof getActor === 'function') return getActor();
        const state = getState();
        return state ? state.currentUserActor : null;
      },
      reload: reload || (() => {}),
      notify: notify || (() => {}),
      setBusy: setBusy || (() => {})
    });
    
    console.info('[CRA] Workflow integration configured');
  }
  
  // Soumettre la semaine courante
  async function submitCurrentWeek() {
    // CORRECTION : Vérifier le verrou pour empêcher le double-clic
    if (submitCurrentWeekPending) {
      console.warn('[CRA] submitCurrentWeek déjà en cours, ignoré');
      return { success: false, code: 'OPERATION_PENDING' };
    }
    
    if (!config || !adapter) {
      throw new Error('CraWorkflowIntegration non configuré');
    }
    
    // Verrouiller
    submitCurrentWeekPending = true;
    
    try {
      const state = config.getState();
      if (!state || !state.currentUserMemberId) {
        if (config.notify) config.notify('Acteur non identifié', 'error');
        return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
      }
      
      const actorMemberId = state.currentUserMemberId;
      
      // LOG DE DIAGNOSTIC v20260726-4
      console.info('[CRA submit v20260726-4]', {
        actorMemberId: actorMemberId,
        weekStartRaw: state.weekStart,
        weekStartLocal: new Date(state.weekStart).toString(),
        weekStartIso: getWeekStartIso(state.weekStart),
        entryCount: state.entries ? state.entries.length : 0,
        memberEntries: (state.entries || [])
          .filter(entry => Number(entry.membre) === Number(actorMemberId))
          .map(entry => ({
            id: entry.id,
            date: entry.date,
            weekIso: getWeekStartIso(entry.date),
            feuille: entry.feuille
          }))
      });
      
      // CORRECTION : Calculer le lundi canonique avec la date locale, pas UTC
      const mondayMs = mondayOf(state.weekStart);
      const mondayIso = localDateIso(mondayMs);
      
      // ÉTAPE 4 : Réparation - Assurer l'existence de la feuille et rattacher les entrées orphelines
      let sheetId = null;
      
      // 1. Essayer de trouver la feuille existante
      const sheetResult = resolveCurrentUserSheet(state);
      
      if (sheetResult.status === 'duplicate') {
        if (config.notify) config.notify('Plusieurs feuilles existent pour cette semaine', 'error');
        return { success: false, code: 'DUPLICATE_WEEKLY_SHEET' };
      }
      
      // 2. Si aucune feuille mais des entrées existent, créer la feuille
      if (sheetResult.status === 'none') {
        // Vérifier s'il y a des entrées pour cette semaine
        const memberWeekEntries = (state.entries || []).filter(e => {
          if (e.membre !== actorMemberId) return false;
          const entryWeekIso = getWeekStartIso(e.date);
          return entryWeekIso === mondayIso;
        });
        
        if (memberWeekEntries.length === 0) {
          // Aucune entrée → pas de feuille à soumettre
          if (config.notify) config.notify('Aucune saisie à soumettre pour cette semaine', 'error');
          return { success: false, code: 'NO_TIMESHEET_DATA_TO_SUBMIT' };
        }
        
        // Créer la feuille via ensureWeeklySheet
        if (config.taskFlowCra && config.taskFlowCra.service && config.taskFlowCra.service.ensureWeeklySheet) {
          try {
            const weeklySheetResult = await config.taskFlowCra.service.ensureWeeklySheet({
              grist: config.grist,
              memberId: actorMemberId,
              weekStartIso: mondayIso,
              sheets: state.feuilles,
              entries: state.entries,
              createOnlyWhenEntriesExist: false
            });
            
            if (!weeklySheetResult.success) {
              if (weeklySheetResult.code === 'WEEKLY_SHEET_DUPLICATE') {
                if (config.notify) config.notify('Plusieurs feuilles existent pour cette semaine', 'error');
                return { success: false, code: 'DUPLICATE_WEEKLY_SHEET' };
              }
              if (config.notify) config.notify('Création de feuille impossible: ' + (weeklySheetResult.error || 'Erreur'), 'error');
              return { success: false, code: weeklySheetResult.code || 'WEEKLY_SHEET_CREATE_FAILED' };
            }
            
            sheetId = weeklySheetResult.sheetId;
            
            // Recharger les données pour avoir la feuille à jour
            if (typeof config.reload === 'function') {
              await config.reload({ reason: 'sheet-created', immediate: true });
            }
          } catch (e) {
            console.error('[CRA] Erreur ensureWeeklySheet:', e);
            if (config.notify) config.notify('Erreur lors de la création de la feuille', 'error');
            return { success: false, code: 'WEEKLY_SHEET_CREATE_ERROR' };
          }
        } else {
          if (config.notify) config.notify('Service ensureWeeklySheet indisponible', 'error');
          return { success: false, code: 'SERVICE_UNAVAILABLE' };
        }
      } else {
        sheetId = sheetResult.sheet.id;
      }
      
      // 3. Si une feuille existe, rattacher les entrées orphelines avant soumission
      if (sheetId) {
        try {
          // Trouver les entrées orphelines du membre pour cette semaine
          const orphanEntries = (state.entries || []).filter(e => {
            if (e.membre !== actorMemberId) return false;
            const entryWeekIso = getWeekStartIso(e.date);
            if (entryWeekIso !== mondayIso) return false;
            return e.feuille === null || e.feuille === 0 || e.feuille === undefined;
          });
          
          if (orphanEntries.length > 0) {
            // Construire les actions de rattachement
            const linkActions = orphanEntries.map(e => [
              'UpdateRecord',
              'TimeEntries',
              e.id,
              { feuille: sheetId }
            ]);
            
            // Appliquer les actions
            await config.grist.docApi.applyUserActions(linkActions);
            
            // Recharger pour avoir les données à jour
            if (typeof config.reload === 'function') {
              await config.reload({ reason: 'entries-linked', immediate: true });
            }
          }
        } catch (e) {
          console.error('[CRA] Erreur rattachement entrées:', e);
          if (config.notify) config.notify('Erreur lors du rattachement des saisies', 'error');
          return { success: false, code: 'ENTRY_LINK_ERROR' };
        }
      }
      
      // 4. Soumettre la feuille via l'adaptateur
      return await adapter.submit(sheetId);
    } finally {
      // CORRECTION : Déverrouiller dans tous les cas
      submitCurrentWeekPending = false;
    }
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
  async function rejectSheet(sheetId, reason) {
    if (!config || !adapter) {
      throw new Error('CraWorkflowIntegration non configuré');
    }
    
    // Si le motif est fourni en paramètre, l'utiliser directement
    if (reason !== undefined && reason !== null) {
      const trimmedReason = String(reason).trim();
      if (!trimmedReason) {
        return { success: false, code: 'MISSING_REJECT_REASON' };
      }
      return await adapter.reject(sheetId, trimmedReason);
    }
    
    // Sinon, ouvrir la modale
    const modalReason = await showRejectModal();
    if (!modalReason) {
      return { success: false, code: 'MISSING_REJECT_REASON' };
    }
    
    return await adapter.reject(sheetId, modalReason);
  }
  
  // Ouvrir une correction manager avec modale
  async function openCorrection(sheetId, reason) {
    if (!config || !adapter) {
      throw new Error('CraWorkflowIntegration non configuré');
    }
    
    // Si le motif est fourni en paramètre, l'utiliser directement
    if (reason !== undefined && reason !== null) {
      const trimmedReason = String(reason).trim();
      if (!trimmedReason) {
        return { success: false, code: 'MISSING_CORRECTION_REASON' };
      }
      return await adapter.openCorrection(sheetId, trimmedReason);
    }
    
    // Sinon, ouvrir la modale
    const modalReason = await showCorrectionModal();
    if (!modalReason) {
      return { success: false, code: 'MISSING_CORRECTION_REASON' };
    }
    
    return await adapter.openCorrection(sheetId, modalReason);
  }

  /**
   * Prépare une semaine passée pour une régularisation par le manager.
   *
   * Ce parcours ne contourne jamais une feuille soumise ou validée. Il sert
   * uniquement à matérialiser une enveloppe absente (ou encore brouillon sans
   * saisie) autour des TimeEntries prévisionnelles déjà créées par le planning.
   */
  async function prepareRetroactiveCorrection(memberId, weekStart, reason) {
    if (!config || !adapter) {
      throw new Error('CraWorkflowIntegration non configuré');
    }

    const state = config.getState();
    const actorMemberId = normalizeId(state && state.currentUserMemberId);
    const targetMemberId = normalizeId(memberId);
    const weekStartIso = getWeekStartIso(weekStart);
    const trimmedReason = String(reason || '').trim();

    if (!actorMemberId) return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    if (!targetMemberId || !weekStartIso) return { success: false, code: 'INVALID_RETROACTIVE_SCOPE' };
    if (!trimmedReason) return { success: false, code: 'MISSING_CORRECTION_REASON' };

    const managerState = state.managerWorkspaceState || {};
    const directReportIds = Array.isArray(managerState.directReportIds)
      ? managerState.directReportIds
      : (Array.isArray(state.mesGeres) ? state.mesGeres : []);
    const isDirectReport = directReportIds.some(id => normalizeId(id) === targetMemberId);
    if (!isDirectReport) return { success: false, code: 'NOT_DIRECT_REPORT' };

    const weekEntries = (state.entries || []).filter(entry =>
      normalizeId(entry.membre) === targetMemberId &&
      getWeekStartIso(entry.date) === weekStartIso
    );
    if (weekEntries.length === 0) {
      return { success: false, code: 'NO_ENTRIES_TO_REGULARIZE' };
    }

    if (config.setBusy) config.setBusy(true);
    try {
      const ensureResult = await config.taskFlowCra.service.ensureWeeklySheet({
        grist: config.grist,
        memberId: targetMemberId,
        weekStartIso: weekStartIso,
        sheets: state.feuilles || [],
        entries: state.entries || [],
        createOnlyWhenEntriesExist: true
      });

      if (!ensureResult || !ensureResult.success || !ensureResult.sheet) {
        return {
          success: false,
          code: ensureResult && ensureResult.code ? ensureResult.code : 'WEEKLY_SHEET_CREATE_FAILED'
        };
      }

      const sheet = ensureResult.sheet;
      const sheetId = normalizeId(ensureResult.sheetId || sheet.id);
      const status = String(sheet.statut || '').toLowerCase();
      if (!sheetId) return { success: false, code: 'WEEKLY_SHEET_POSTCONDITION_FAILED' };

      if (['soumis', 'submitted', 'valide', 'validated'].includes(status)) {
        return { success: false, code: 'SHEET_REQUIRES_WORKFLOW_ACTION', sheetId };
      }
      if (status === 'correction_manager' && normalizeId(sheet.responsableValidation) !== actorMemberId) {
        return { success: false, code: 'NOT_EXPECTED_VALIDATION_MANAGER', sheetId };
      }

      const sheetEntries = weekEntries.filter(entry => normalizeId(entry.feuille) === sheetId);
      const hasExplicitDraftInput = status === 'brouillon' && sheetEntries.some(entry => entry.heures != null);
      if (hasExplicitDraftInput) {
        return { success: false, code: 'DRAFT_ALREADY_EDITED', sheetId };
      }

      const actions = [];
      if (status !== 'correction_manager') {
        actions.push(['UpdateRecord', 'Feuilles', sheetId, {
          statut: 'correction_manager',
          responsableValidation: actorMemberId,
          motifCorrection: trimmedReason
        }]);
      }

      weekEntries.forEach(entry => {
        if (entry.feuille == null || entry.feuille === 0 || entry.feuille === '') {
          actions.push(['UpdateRecord', 'TimeEntries', entry.id, { feuille: sheetId }]);
        }
      });

      if (actions.length > 0) {
        await config.grist.docApi.applyUserActions(actions);
      }
      if (typeof config.reload === 'function') {
        await config.reload({ reason: 'manager-retroactive-correction', immediate: true });
      }

      const refreshedState = config.getState();
      const refreshedSheet = (refreshedState.feuilles || []).find(item => normalizeId(item.id) === sheetId) || {
        ...sheet,
        id: sheetId,
        membre: targetMemberId,
        semaine: Math.floor(mondayOf(weekStartIso) / 1000),
        statut: 'correction_manager',
        responsableValidation: actorMemberId,
        motifCorrection: trimmedReason
      };
      config.enterCorrectionMode(refreshedSheet);

      return {
        success: true,
        code: 'RETROACTIVE_CORRECTION_READY',
        sheetId: sheetId,
        linkedEntryCount: actions.filter(action => action[1] === 'TimeEntries').length
      };
    } catch (error) {
      console.error('[CRA] Régularisation rétroactive impossible:', error);
      return { success: false, code: 'RETROACTIVE_CORRECTION_ERROR', message: error.message };
    } finally {
      if (config.setBusy) config.setBusy(false);
    }
  }
  
  // Entrer en mode correction manager
  async function enterManagerCorrection(sheetId) {
    if (!config) {
      throw new Error('CraWorkflowIntegration non configuré');
    }
    
    const state = config.getState();
    if (!state || !state.feuilles) {
      return { success: false, code: 'MISSING_STATE' };
    }
    
    // Trouver la feuille par ID
    const sheet = state.feuilles.find(f => f.id === sheetId);
    if (!sheet) {
      return { success: false, code: 'SHEET_NOT_FOUND' };
    }
    
    // Vérifier que la feuille est en correction_manager
    const status = String(sheet.statut || '').toLowerCase();
    if (status !== 'correction_manager') {
      return { success: false, code: 'SHEET_NOT_IN_MANAGER_CORRECTION' };
    }
    
    // Vérifier que le currentUserMemberId est le responsable validation
    if (sheet.responsableValidation !== state.currentUserMemberId) {
      return { success: false, code: 'NOT_EXPECTED_VALIDATION_MANAGER' };
    }
    
    // Appeler le callback pour entrer en mode correction
    config.enterCorrectionMode(sheet);
    
    return { success: true, code: 'MANAGER_CORRECTION_MODE_ENTERED', sheetId };
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
    
    // Appeler le callback pour quitter le mode correction
    config.leaveCorrectionMode();
  }
  
  // Exposer l'API publique
  global.CraWorkflowIntegration = {
    configure,
    submitCurrentWeek,
    withdrawCurrentWeek,
    validateSheet,
    rejectSheet,
    openCorrection,
    prepareRetroactiveCorrection,
    enterManagerCorrection,
    updateManagerActual,
    revalidateSheet,
    leaveManagerCorrection,
    // Helpers pour compatibilité
    getManagerAccessibleSheets,
    isSheetAccessibleBySnapshot,
    showRejectModal,
    showCorrectionModal,
    // Helpers exportés pour tests
    resolveCurrentUserSheet,
    findSheetForMemberWeek
  };
  
  console.info('[CRA] Workflow integration loaded');
  
})(typeof globalThis !== 'undefined' ? globalThis : this);
