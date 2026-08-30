/* ==========================================================================
 * time-view-selector.js — Sélecteur de granularité temporelle partagé
 * ========================================================================== */
(function(root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaskFlowTimeViewSelector = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var DEFAULT_LABELS = {
    week: 'Sem',
    month: 'Mois',
    quarter: 'Trim',
    semester: '6M',
    year: 'An'
  };

  function normalizeViews(views) {
    return (Array.isArray(views) ? views : []).map(function(view) {
      if (typeof view === 'string') {
        return { value: view, label: DEFAULT_LABELS[view] || view };
      }
      var value = view && view.value != null ? String(view.value) : '';
      return {
        value: value,
        label: view && view.label != null
          ? String(view.label)
          : (DEFAULT_LABELS[value] || value)
      };
    }).filter(function(view) { return view.value; });
  }

  function render(container, options) {
    if (!container) return [];
    options = options || {};

    var value = options.value == null ? '' : String(options.value);
    var activeClass = options.activeClass || 'active';
    var buttonClass = options.buttonClass || '';
    var views = normalizeViews(options.views);

    container.replaceChildren();
    return views.map(function(view) {
      var button = container.ownerDocument.createElement('button');
      button.type = 'button';
      button.dataset.view = view.value;
      button.textContent = view.label;
      if (buttonClass) button.className = buttonClass;
      var selected = view.value === value;
      button.classList.toggle(activeClass, selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      button.addEventListener('click', function() {
        if (typeof options.onChange === 'function') options.onChange(view.value);
      });
      container.appendChild(button);
      return button;
    });
  }

  return {
    DEFAULT_LABELS: DEFAULT_LABELS,
    normalizeViews: normalizeViews,
    render: render
  };
});
