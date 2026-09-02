/* ============================================================================
 * taskflow-notifications.js — Notifications compactes communes aux widgets
 * ============================================================================ */
(function(root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaskFlowNotifications = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var DEFAULT_DURATIONS = {
    success: 4000,
    error: 8000,
    warning: 8000,
    info: 8000
  };
  var STYLE_ID = 'taskflow-notification-styles';
  var CONTAINER_ID = 'taskflow-notification-container';
  var defaultManager = null;

  function inferType(message) {
    var text = String(message || '').toLowerCase();
    if (/erreur|échec|echec|impossible|bloqu|refus|invalide|introuvable|inaccessible|verrouill|non autoris|ne pouvez|n[’']a pas pu|incohérent|ambigu|aucune affectation/.test(text)) {
      return 'error';
    }
    if (/attention|partiel|différ|renseigne|sélectionne|mais/.test(text)) return 'warning';
    if (/succès|succes|réussi|reussi|enregistr|créé|créee|ajouté|supprimé|généré|lancé|initialisé|mis à jour|mise à jour/.test(text)) {
      return 'success';
    }
    return 'info';
  }

  function normalizeType(type, message) {
    var value = String(type || '').toLowerCase();
    if (value === 'success' || value === 'error' || value === 'warning' || value === 'info') {
      return value;
    }
    return inferType(message);
  }

  function ensureStyles(doc) {
    if (!doc || !doc.head || doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.tf-notification-container{position:fixed;right:12px;bottom:12px;z-index:10050;',
      'display:flex;flex-direction:column;align-items:flex-end;gap:7px;',
      'width:min(360px,calc(100vw - 24px));pointer-events:none}',
      '.tf-notification{box-sizing:border-box;display:grid;grid-template-columns:8px minmax(0,1fr) 24px;',
      'align-items:start;gap:8px;width:fit-content;max-width:100%;min-width:220px;',
      'padding:8px 8px 8px 10px;border:1px solid #d6dce4;border-radius:8px;',
      'background:#fff;color:#20242a;box-shadow:0 5px 18px rgba(20,30,45,.18);',
      'font:500 12px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      'pointer-events:auto;overflow:hidden}',
      '.tf-notification-marker{width:8px;height:8px;margin-top:4px;border-radius:50%;background:#4f6b86}',
      '.tf-notification-success .tf-notification-marker{background:#16845b}',
      '.tf-notification-warning .tf-notification-marker{background:#c07800}',
      '.tf-notification-error .tf-notification-marker{background:#c73535}',
      '.tf-notification-message{min-width:0;max-height:7.2em;overflow:auto;overflow-wrap:anywhere}',
      '.tf-notification-count{display:inline-block;margin-left:5px;padding:0 5px;border-radius:9px;',
      'background:#edf1f5;color:#52606d;font-size:10px;line-height:17px}',
      '.tf-notification-close{display:grid;place-items:center;width:24px;height:24px;margin:-4px -3px 0 0;',
      'padding:0;border:0;border-radius:5px;background:transparent;color:#66717d;cursor:pointer;',
      'font:600 18px/1 system-ui,sans-serif}',
      '.tf-notification-close:hover,.tf-notification-close:focus-visible{background:#edf1f5;color:#20242a;outline:none}',
      '@media (max-width:520px){.tf-notification-container{right:8px;bottom:8px;width:calc(100vw - 16px)}',
      '.tf-notification{min-width:0;width:100%}}'
    ].join('');
    doc.head.appendChild(style);
  }

  function createManager(options) {
    options = options || {};
    var doc = options.document || (typeof document !== 'undefined' ? document : null);
    var maxVisible = Math.max(1, Number(options.maxVisible) || 3);
    var durations = Object.assign({}, DEFAULT_DURATIONS, options.durations || {});
    var entries = [];
    var container = null;

    function ensureContainer() {
      if (!doc || !doc.body) return null;
      ensureStyles(doc);
      if (container && container.isConnected) return container;
      container = doc.getElementById(CONTAINER_ID);
      if (!container) {
        container = doc.createElement('div');
        container.id = CONTAINER_ID;
        container.className = 'tf-notification-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-relevant', 'additions text');
        doc.body.appendChild(container);
      }
      return container;
    }

    function removeEntry(entry) {
      if (!entry || entry.removed) return;
      entry.removed = true;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      var index = entries.indexOf(entry);
      if (index !== -1) entries.splice(index, 1);
      if (entry.element && entry.element.parentNode) entry.element.parentNode.removeChild(entry.element);
    }

    function schedule(entry, duration) {
      if (!entry || entry.removed) return;
      if (entry.timer) clearTimeout(entry.timer);
      entry.remaining = Math.max(0, Number(duration) || 0);
      entry.deadline = Date.now() + entry.remaining;
      if (entry.remaining === 0) {
        removeEntry(entry);
        return;
      }
      entry.timer = setTimeout(function() { removeEntry(entry); }, entry.remaining);
    }

    function pause(entry) {
      if (!entry || entry.removed || !entry.timer) return;
      clearTimeout(entry.timer);
      entry.timer = null;
      entry.remaining = Math.max(0, entry.deadline - Date.now());
    }

    function resume(entry) {
      if (!entry || entry.removed || entry.timer) return;
      schedule(entry, entry.remaining || durations[entry.type]);
    }

    function show(message, type, showOptions) {
      showOptions = showOptions || {};
      var host = ensureContainer();
      if (!host) return null;
      var text = String(message == null ? '' : message).trim();
      if (!text) return null;
      var normalizedType = normalizeType(type, text);
      var duration = showOptions.duration === undefined
        ? durations[normalizedType]
        : Math.max(0, Number(showOptions.duration) || 0);

      var duplicate = entries.find(function(entry) {
        return !entry.removed && entry.message === text && entry.type === normalizedType;
      });
      if (duplicate) {
        duplicate.count += 1;
        duplicate.countElement.textContent = '×' + duplicate.count;
        duplicate.countElement.hidden = false;
        host.appendChild(duplicate.element);
        schedule(duplicate, duration);
        return duplicate.element;
      }

      var element = doc.createElement('div');
      element.className = 'tf-notification tf-notification-' + normalizedType;
      element.setAttribute('role', normalizedType === 'error' ? 'alert' : 'status');

      var marker = doc.createElement('span');
      marker.className = 'tf-notification-marker';
      marker.setAttribute('aria-hidden', 'true');

      var messageElement = doc.createElement('div');
      messageElement.className = 'tf-notification-message';
      messageElement.appendChild(doc.createTextNode(text));
      var countElement = doc.createElement('span');
      countElement.className = 'tf-notification-count';
      countElement.hidden = true;
      messageElement.appendChild(countElement);

      var close = doc.createElement('button');
      close.type = 'button';
      close.className = 'tf-notification-close';
      close.setAttribute('aria-label', 'Fermer le message');
      close.textContent = '×';

      element.appendChild(marker);
      element.appendChild(messageElement);
      element.appendChild(close);
      host.appendChild(element);

      var entry = {
        element: element,
        countElement: countElement,
        message: text,
        type: normalizedType,
        count: 1,
        timer: null,
        deadline: 0,
        remaining: duration,
        removed: false
      };
      entries.push(entry);

      close.addEventListener('click', function() { removeEntry(entry); });
      element.addEventListener('mouseenter', function() { pause(entry); });
      element.addEventListener('mouseleave', function() { resume(entry); });
      element.addEventListener('focusin', function() { pause(entry); });
      element.addEventListener('focusout', function() { resume(entry); });

      while (entries.length > maxVisible) removeEntry(entries[0]);
      schedule(entry, duration);
      return element;
    }

    function clear() {
      entries.slice().forEach(removeEntry);
    }

    return {
      show: show,
      clear: clear,
      inferType: inferType,
      getContainer: ensureContainer,
      getVisibleCount: function() { return entries.length; }
    };
  }

  function getDefaultManager() {
    if (!defaultManager || !defaultManager.getContainer() || !defaultManager.getContainer().isConnected) {
      defaultManager = createManager();
    }
    return defaultManager;
  }

  function notify(message, type, options) {
    return getDefaultManager().show(message, type, options);
  }

  return {
    DEFAULT_DURATIONS: DEFAULT_DURATIONS,
    createManager: createManager,
    inferType: inferType,
    notify: notify,
    clear: function() { if (defaultManager) defaultManager.clear(); }
  };
});
