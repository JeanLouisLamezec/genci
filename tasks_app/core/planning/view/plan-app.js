/**
 * Plan App - Point d'entrée et bootstrap du widget Plan
 * 
 * Ce fichier externalise le bootstrap du widget Plan pour éviter les problèmes
 * d'exécution du gros script inline généré par build-taskflow.js
 * 
 * Ordre de démarrage :
 * 1. Chargement des scripts externes (déjà fait par plan.html)
 * 2. grist.ready({ requiredAccess: 'full' })
 * 3. loadGrist() et chargement des données
 * 4. render() et installation des listeners
 */

'use strict';

// Garde de sécurité pour empêcher les régressions
var planGristReady = false;

/**
 * Point d'entrée principal du widget Plan
 */
async function startPlan() {
  try {
    console.info('[Plan boot] START');

    // Attendre que le script inline soit chargé
    if (!window.__PlanFunctions) {
      console.warn('[Plan boot] En attente des fonctions du script inline...');
      await new Promise(function(resolve) {
        var check = setInterval(function() {
          if (window.__PlanFunctions) {
            clearInterval(check);
            resolve();
          }
        }, 50);
        setTimeout(resolve, 3000); // Timeout de sécurité
      });
    }

    var F = window.__PlanFunctions || {};
    var bindToolbarFn = F.bindToolbar || (typeof bindToolbar !== 'undefined' ? bindToolbar : null);
    var loadDemoFn = F.loadDemo || (typeof loadDemo !== 'undefined' ? loadDemo : null);
    var initGristFn = F.initGrist || (typeof initGrist !== 'undefined' ? initGrist : null);
    var loadGristFn = F.loadGrist || (typeof loadGrist !== 'undefined' ? loadGrist : null);
    var renderFn = F.render || (typeof render !== 'undefined' ? render : null);
    var initPlanningServiceFn = F.initPlanningService || (typeof initPlanningService !== 'undefined' ? initPlanningService : null);
    var initFilterManagerFn = F.initFilterManager || (typeof initFilterManager !== 'undefined' ? initFilterManager : null);
    var buildDispoIndexFn = F.buildDispoIndex || (typeof buildDispoIndex !== 'undefined' ? buildDispoIndex : null);
    var SObj = F.S || (typeof S !== 'undefined' ? S : {});
    var TFObj = F.TF || (typeof TF !== 'undefined' ? TF : null);
    var gristObj = F.grist || (typeof grist !== 'undefined' ? grist : null);
    var toastFn = F.toast || (typeof toast === 'function' ? toast : null);

    // Vérifier si on est dans Grist ou en mode démo
    if (window.self === window.top) {
      console.info('[Plan boot] Mode démo (hors Grist)');
      if (bindToolbarFn) bindToolbarFn();
      window.appMode = 'demo';
      if (loadDemoFn) await loadDemoFn();
      return;
    }

    // Mode Grist : attendre grist.ready() AVANT tout accès docApi
    console.info('[Plan boot] before grist.ready');

    var gristApi = gristObj || window.grist;
    await gristApi.ready({
      requiredAccess: 'full'
    });

    planGristReady = true;
    console.info('[Plan boot] after grist.ready');

    // Installer la bannière lecture seule si nécessaire
    if (TFObj && TFObj.readOnlyBanner) {
      TFObj.readOnlyBanner();
    }

    // Installer le garde-fou pour les écritures Grist
    if (TFObj && TFObj.guardWrites) {
      TFObj.guardWrites(gristApi, {
        onReadOnly: function() {
          if (toastFn) toastFn('Lecture seule : modification non autorisée');
        },
        onDenied: function() {
          if (toastFn) toastFn('Modification refusée par vos droits');
          if (loadGristFn) loadGristFn().catch(function(error) {
            console.error('[Plan] Rechargement après refus impossible', error);
          });
        }
      });
    }

    // Initialiser le service de planning
    if (initPlanningServiceFn) {
      initPlanningServiceFn();
    }

    // Charger les données Grist
    console.info('[Plan boot] calling loadGrist');
    if (loadGristFn) await loadGristFn();

    var currentGristUser = window.TaskFlowIdentityRuntime && window.TaskFlowIdentityRuntime.getCurrentGristUser
      ? await window.TaskFlowIdentityRuntime.getCurrentGristUser(gristApi)
      : null;
    console.info('[Plan filters] identity', {
      userId: currentGristUser && currentGristUser.userId
    });
    if (window.TaskFlowUserFilters && SObj && SObj.filterManager) {
      SObj.userFilterStore = window.TaskFlowUserFilters.createStore(gristApi, {
        gristUserId: currentGristUser && currentGristUser.userId,
        sourceWidget: 'plan',
        onError: function(error) { console.error('[Plan filtres personnels]', error); }
      });
      var savedFilters = await SObj.userFilterStore.load();
      SObj.filterManager.setState(savedFilters, { origin: 'persistent', broadcast: false });
      console.info('[Plan filters] loaded', savedFilters);
    } else {
      console.warn('[Plan filters] store unavailable');
    }

    console.info('[Plan boot] READY');

    // Réagir aux changements de données
    if (gristApi && gristApi.onRecords) {
      gristApi.onRecords(function() {
        if (window.appMode !== 'grist') {
          return;
        }
        if (loadGristFn) loadGristFn().catch(function(error) {
          console.error('[Plan] Rechargement Grist impossible', error);
        });
      });
    }

  } catch (error) {
    window.appMode = 'error';
    planGristReady = false;

    console.error('[Plan boot] FATAL', error);

    var wrap = document.getElementById('gridwrap');
    if (wrap) {
      var msg = error && (error.message || error) ? String(error.message || error) : 'Erreur inconnue';
      wrap.innerHTML =
        '<div class="empty">' +
        '<div class="ic">⚠</div>' +
        '<div>Erreur de démarrage du Plan</div>' +
        '<div style="font-size:.78rem">' +
        escapeHtml(msg) +
        '</div>' +
        '</div>';
    }
  }
}

/**
 * Échappe une chaîne HTML pour l'affichage
 */
function escapeHtml(str) {
  if (typeof str !== 'string') {
    return String(str || '');
  }
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Ferme toutes les sections de filtres au chargement complet
 */
function initFilterSections() {
  setTimeout(function() {
    var allCheckboxes = document.querySelectorAll('.filter-checkboxes');
    allCheckboxes.forEach(function(cb) {
      cb.classList.remove('open');
      cb.style.display = 'none';
    });
    var allHeaders = document.querySelectorAll('.filter-section-header');
    allHeaders.forEach(function(h) {
      h.classList.remove('open');
    });
  }, 200);
}

// ============================================================================
// POINT D'ENTRÉE
// ============================================================================

// Attendre que le DOM soit chargé ET que le script inline soit chargé
function bootstrap() {
  // Attendre que le script inline ait fini de charger
  if (!window.__PLAN_INLINE_LOADED__) {
    console.warn('[Plan boot] En attente du script inline...');
    setTimeout(bootstrap, 50);
    return;
  }

  console.info('[Plan boot] Bootstrap starting');

  // Récupérer les fonctions exportées par le script inline
  var F = window.__PlanFunctions || {};
  var bindToolbarFn = F.bindToolbar || (typeof bindToolbar !== 'undefined' ? bindToolbar : null);

  // Initialiser les sections de filtres
  initFilterSections();

  // Appeler bindToolbar
  if (bindToolbarFn) {
    bindToolbarFn();
  }

  // Démarrer le plan
  startPlan();
}

// Lancer le bootstrap
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
