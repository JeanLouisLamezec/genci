/**
 * CRA Sheet UI Adapter - Adaptateur entre l'UI et le service de validation
 * 
 * Ce module est pur vis-à-vis du DOM. Il fait le lien entre :
 * - les actions utilisateur (clics, saisies)
 * - le service transactionnel (cra-sheet-validation-service)
 * 
 * RESPONSABILITÉS :
 * 1. Obtenir l'acteur via getActorMemberId()
 * 2. Refuser un acteur absent
 * 3. Empêcher le double-clic sur la même feuille
 * 4. Appeler la bonne commande du service
 * 5. Fournir le timestamp uniquement aux commandes qui l'exigent
 * 6. Ne jamais modifier S directement
 * 7. Attendre le résultat
 * 8. Afficher un message adapté
 * 9. Recharger les données après un succès
 * 10. Recharger également après WORKFLOW_STATE_CHANGED, WORKFLOW_POSTCONDITION_FAILED, WORKFLOW_APPLY_FAILED
 * 11. Libérer l'état busy dans un finally
 * 
 * @module core/cra/cra-sheet-ui-adapter
 */

'use strict';

/**
 * Codes d'erreur stables → messages utilisateur
 */
const USER_MESSAGES = {
  ACTOR_NOT_IDENTIFIED: 'Votre compte Grist n\'est pas associé à un membre de l\'équipe.',
  NOT_SHEET_OWNER: 'Seul le propriétaire de cette feuille peut la soumettre.',
  NO_VALIDATION_MANAGER: 'Aucun responsable direct n\'est défini pour cette personne.',
  DUPLICATE_WEEKLY_SHEET: 'Plusieurs feuilles existent pour cette semaine. Corrigez les données avant de continuer.',
  TIME_ENTRY_SCOPE_INCOMPLETE: 'Certaines lignes de cette semaine ne sont pas rattachées à la bonne feuille.',
  TIMESHEET_VALIDATION_FAILED: 'La feuille contient des erreurs. Vérifiez les heures et les capacités quotidiennes.',
  NOT_EXPECTED_VALIDATION_MANAGER: 'Cette feuille a été soumise à un autre responsable.',
  WORKFLOW_STATE_CHANGED: 'La feuille a changé pendant l\'opération. Les données ont été rechargées.',
  WORKFLOW_APPLY_FAILED: 'L\'enregistrement dans Grist a échoué.',
  WORKFLOW_POSTCONDITION_FAILED: 'L\'opération a été enregistrée, mais son résultat doit être vérifié. Les données ont été rechargées.',
  SHEET_NOT_SUBMITTED: 'La feuille n\'est pas soumise.',
  SHEET_ALREADY_VALIDATED: 'La feuille a déjà été validée.',
  MISSING_REJECT_REASON: 'Un motif de rejet est requis.',
  MISSING_CORRECTION_REASON: 'Un motif de correction est requis.',
  SHEET_NOT_VALIDATED: 'La feuille n\'est pas validée.',
  SHEET_NOT_IN_MANAGER_CORRECTION: 'La feuille n\'est pas en correction manager.',
  SELF_VALIDATION_FORBIDDEN: 'Auto-validation interdite.',
  SELF_REJECTION_FORBIDDEN: 'Auto-rejet interdit.',
  SELF_CORRECTION_FORBIDDEN: 'Auto-correction interdite.',
  OK: 'Opération réussie.'
};

/**
 * Helper : obtenir un message utilisateur depuis un code
 */
function getUserMessage(code, details) {
  const baseMessage = USER_MESSAGES[code] || 'Une erreur est survenue.';
  
  if (details && details.validation && details.validation.errors && details.validation.errors.length > 0) {
    const firstError = details.validation.errors[0];
    return baseMessage + ' (' + (firstError.message || firstError.code) + ')';
  }
  
  return baseMessage;
}

/**
 * Crée un adaptateur UI pour le workflow CRA
 * 
 * @param {Object} options - Options de configuration
 * @param {Object} options.service - Service de validation (cra-sheet-validation-service)
 * @param {Object} options.grist - API Grist
 * @param {Function} options.getActorMemberId - Fonction retournant l'ID de l'acteur
 * @param {Function} options.reload - Fonction de rechargement des données
 * @param {Function} options.notify - Fonction d'affichage de notification
 * @param {Function} options.setBusy - Fonction pour définir l'état busy
 * @param {Function} [options.nowUnixSeconds] - Fonction retournant le timestamp actuel (défaut: Date.now()/1000)
 * @returns {Object} Adaptateur UI
 */
function createUiAdapter(options) {
  if (!options || !options.service || !options.grist || !options.getActorMemberId) {
    throw new Error('CraUiAdapter: options requises (service, grist, getActorMemberId)');
  }
  
  const {
    service,
    grist,
    getActorMemberId,
    reload,
    notify,
    setBusy,
    nowUnixSeconds = () => Math.floor(Date.now() / 1000)
  } = options;
  
  // État interne pour empêcher le double-clic
  // Verrouillage par sheetId uniquement (pas par opération)
  const pendingOperations = new Set();
  
  /**
   * Vérifie si une opération est déjà en cours pour cette feuille
   */
  function isOperationPending(sheetId) {
    return pendingOperations.has(sheetId);
  }
  
  /**
   * Marque une opération comme en cours
   */
  function markOperationPending(sheetId) {
    pendingOperations.add(sheetId);
  }
  
  /**
   * Marque une opération comme terminée
   */
  function markOperationDone(sheetId) {
    pendingOperations.delete(sheetId);
  }
  
  /**
   * Recharge les données après une transition
   */
  async function reloadAfterTransition(reason) {
    if (typeof reload === 'function') {
      await reload({
        reason: reason || 'sheet-workflow-transition',
        immediate: true,
        allowSchemaRecovery: false
      });
    }
  }
  
  /**
   * Affiche une notification
   */
  function showNotification(message, type) {
    if (typeof notify === 'function') {
      notify(message, type);
    } else {
      console.log('[CRA UI]', message);
    }
  }
  
  /**
   * Gère le résultat d'une opération
   */
  async function handleOperationResult(result, sheetId, operationType, successMessage) {
    const wasBusy = typeof setBusy === 'function';
    if (wasBusy) {
      setBusy(false);
    }
    
    markOperationDone(sheetId, operationType);
    
    if (result.success) {
      showNotification(successMessage || USER_MESSAGES.OK, 'success');
      await reloadAfterTransition('workflow-success');
      return result;
    }
    
    // Échec
    const code = result.code || 'UNKNOWN_ERROR';
    const message = getUserMessage(code, result);
    
    // Logger les détails techniques dans la console
    console.error('[CRA UI] Échec opération', {
      code,
      reason: result.reason,
      transition: result.transition,
      diagnostics: result.diagnostics,
      before: result.before,
      after: result.after
    });
    
    // Afficher le message utilisateur (sans stack technique)
    showNotification(message, 'error');
    
    // Recharger si l'état a pu changer
    if (
      code === 'WORKFLOW_STATE_CHANGED' ||
      code === 'WORKFLOW_POSTCONDITION_FAILED' ||
      code === 'WORKFLOW_APPLY_FAILED'
    ) {
      await reloadAfterTransition('workflow-error');
    }
    
    return result;
  }
  
  /**
   * Soumet une feuille
   */
  async function submit(sheetId) {
    if (!sheetId) {
      throw new Error('submit: sheetId requis');
    }
    
    if (isOperationPending(sheetId)) {
      console.warn('[CRA UI] Double-clic soumis ignoré');
      return { success: false, code: 'OPERATION_PENDING' };
    }
    
    const actorMemberId = getActorMemberId();
    if (!actorMemberId) {
      showNotification(USER_MESSAGES.ACTOR_NOT_IDENTIFIED, 'error');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    markOperationPending(sheetId);
    if (typeof setBusy === 'function') {
      setBusy(true);
    }
    
    try {
      const result = await service.submitSheet({
        grist,
        actorMemberId,
        sheetId,
        nowUnixSeconds: nowUnixSeconds()
      });
      
      return await handleOperationResult(
        result,
        sheetId,
        'submit',
        'Semaine soumise à votre responsable'
      );
    } finally {
      markOperationDone(sheetId);
      if (typeof setBusy === 'function') {
        setBusy(false);
      }
    }
  }
  
  /**
   * Retire une soumission
   */
  async function withdraw(sheetId) {
    if (!sheetId) {
      throw new Error('withdraw: sheetId requis');
    }
    
    if (isOperationPending(sheetId)) {
      console.warn('[CRA UI] Double-clic retrait ignoré');
      return { success: false, code: 'OPERATION_PENDING' };
    }
    
    const actorMemberId = getActorMemberId();
    if (!actorMemberId) {
      showNotification(USER_MESSAGES.ACTOR_NOT_IDENTIFIED, 'error');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    markOperationPending(sheetId);
    if (typeof setBusy === 'function') {
      setBusy(true);
    }
    
    try {
      const result = await service.withdrawSheet({
        grist,
        actorMemberId,
        sheetId
      });
      
      return await handleOperationResult(
        result,
        sheetId,
        'withdraw',
        'Soumission retirée'
      );
    } finally {
      markOperationDone(sheetId);
      if (typeof setBusy === 'function') {
        setBusy(false);
      }
    }
  }
  
  /**
   * Valide une feuille
   */
  async function validate(sheetId) {
    if (!sheetId) {
      throw new Error('validate: sheetId requis');
    }
    
    if (isOperationPending(sheetId)) {
      console.warn('[CRA UI] Double-clic validation ignoré');
      return { success: false, code: 'OPERATION_PENDING' };
    }
    
    const actorMemberId = getActorMemberId();
    if (!actorMemberId) {
      showNotification(USER_MESSAGES.ACTOR_NOT_IDENTIFIED, 'error');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    markOperationPending(sheetId);
    if (typeof setBusy === 'function') {
      setBusy(true);
    }
    
    try {
      const result = await service.validateSheet({
        grist,
        actorMemberId,
        sheetId,
        nowUnixSeconds: nowUnixSeconds()
      });
      
      return await handleOperationResult(
        result,
        sheetId,
        'validate',
        'Feuille validée'
      );
    } finally {
      markOperationDone(sheetId);
      if (typeof setBusy === 'function') {
        setBusy(false);
      }
    }
  }
  
  /**
   * Rejette une feuille avec motif
   */
  async function reject(sheetId, reason) {
    if (!sheetId) {
      throw new Error('reject: sheetId requis');
    }
    
    if (!reason || String(reason).trim() === '') {
      showNotification(USER_MESSAGES.MISSING_REJECT_REASON, 'error');
      return { success: false, code: 'MISSING_REJECT_REASON' };
    }
    
    if (isOperationPending(sheetId)) {
      console.warn('[CRA UI] Double-clic rejet ignoré');
      return { success: false, code: 'OPERATION_PENDING' };
    }
    
    const actorMemberId = getActorMemberId();
    if (!actorMemberId) {
      showNotification(USER_MESSAGES.ACTOR_NOT_IDENTIFIED, 'error');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    markOperationPending(sheetId);
    if (typeof setBusy === 'function') {
      setBusy(true);
    }
    
    try {
      const result = await service.rejectSheet({
        grist,
        actorMemberId,
        sheetId,
        rejectReason: String(reason).trim()
      });
      
      return await handleOperationResult(
        result,
        sheetId,
        'reject',
        'Feuille rejetée'
      );
    } finally {
      markOperationDone(sheetId);
      if (typeof setBusy === 'function') {
        setBusy(false);
      }
    }
  }
  
  /**
   * Ouvre une correction manager avec motif
   */
  async function openCorrection(sheetId, reason) {
    if (!sheetId) {
      throw new Error('openCorrection: sheetId requis');
    }
    
    if (!reason || String(reason).trim() === '') {
      showNotification(USER_MESSAGES.MISSING_CORRECTION_REASON, 'error');
      return { success: false, code: 'MISSING_CORRECTION_REASON' };
    }
    
    if (isOperationPending(sheetId)) {
      console.warn('[CRA UI] Double-clic ouverture correction ignoré');
      return { success: false, code: 'OPERATION_PENDING' };
    }
    
    const actorMemberId = getActorMemberId();
    if (!actorMemberId) {
      showNotification(USER_MESSAGES.ACTOR_NOT_IDENTIFIED, 'error');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    markOperationPending(sheetId);
    if (typeof setBusy === 'function') {
      setBusy(true);
    }
    
    try {
      const result = await service.openManagerCorrection({
        grist,
        actorMemberId,
        sheetId,
        correctionReason: String(reason).trim()
      });
      
      return await handleOperationResult(
        result,
        sheetId,
        'open_correction',
        'Correction manager ouverte'
      );
    } finally {
      markOperationDone(sheetId);
      if (typeof setBusy === 'function') {
        setBusy(false);
      }
    }
  }
  
  /**
   * Met à jour les heures réelles d'une TimeEntry en mode correction manager
   */
  async function updateManagerActual(sheetId, timeEntryId, hours) {
    if (!sheetId) {
      throw new Error('updateManagerActual: sheetId requis');
    }
    
    if (!timeEntryId) {
      throw new Error('updateManagerActual: timeEntryId requis');
    }
    
    if (hours === null || hours === undefined || hours === '') {
      throw new Error('updateManagerActual: hours requis');
    }
    
    const numericHours = Number(hours);
    if (!Number.isFinite(numericHours) || numericHours < 0) {
      throw new Error('updateManagerActual: heures invalides (doit être >= 0)');
    }
    
    if (isOperationPending(sheetId)) {
      console.warn('[CRA UI] Double-clic update actual ignoré');
      return { success: false, code: 'OPERATION_PENDING' };
    }
    
    const actorMemberId = getActorMemberId();
    if (!actorMemberId) {
      showNotification(USER_MESSAGES.ACTOR_NOT_IDENTIFIED, 'error');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    markOperationPending(sheetId);
    if (typeof setBusy === 'function') {
      setBusy(true);
    }
    
    try {
      const result = await service.updateManagerActual({
        grist,
        actorMemberId,
        sheetId,
        timeEntryId,
        hours: numericHours
      });
      
      return await handleOperationResult(
        result,
        sheetId,
        'update_actual',
        'Heures mises à jour'
      );
    } finally {
      markOperationDone(sheetId);
      if (typeof setBusy === 'function') {
        setBusy(false);
      }
    }
  }
  
  /**
   * Revalide une feuille après correction manager
   */
  async function revalidate(sheetId) {
    if (!sheetId) {
      throw new Error('revalidate: sheetId requis');
    }
    
    if (isOperationPending(sheetId)) {
      console.warn('[CRA UI] Double-clic revalidation ignoré');
      return { success: false, code: 'OPERATION_PENDING' };
    }
    
    const actorMemberId = getActorMemberId();
    if (!actorMemberId) {
      showNotification(USER_MESSAGES.ACTOR_NOT_IDENTIFIED, 'error');
      return { success: false, code: 'ACTOR_NOT_IDENTIFIED' };
    }
    
    markOperationPending(sheetId);
    if (typeof setBusy === 'function') {
      setBusy(true);
    }
    
    try {
      const result = await service.revalidateSheet({
        grist,
        actorMemberId,
        sheetId,
        nowUnixSeconds: nowUnixSeconds()
      });
      
      return await handleOperationResult(
        result,
        sheetId,
        'revalidate',
        'Feuille corrigée et revalidée'
      );
    } finally {
      markOperationDone(sheetId);
      if (typeof setBusy === 'function') {
        setBusy(false);
      }
    }
  }
  
  return {
    submit,
    withdraw,
    validate,
    reject,
    openCorrection,
    updateManagerActual,
    revalidate
  };
}

module.exports = {
  createUiAdapter,
  USER_MESSAGES
};
