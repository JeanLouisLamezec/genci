// =============================================
// FILTER MANAGER - Module mutualisé v3
// Filtre les tâches (Tasks) pour Plan, Kanban, Gantt, CRA
// Gestion des sections accordéon, CSS commun, état partagé
// IDs normalisés en chaînes, origine des changements, suppression explicite
// =============================================

/**
 * Normalise les filtres pour garantir un format canonique
 * - Tous les IDs sont des chaînes
 * - Élimine null, undefined, chaînes vides
 * - Élimine les doublons
 * - Conserve les 5 clés (assignee, team, project, programme, task)
 * - Immutabilité : ne modifie pas l'objet d'entrée
 * @param {Object} input - Filtres en entrée (peut être incomplet ou avec types variés)
 * @returns {Object} Filtres normalisés { assignee: [], team: [], project: [], programme: [], task: [] }
 */
function normalizeFilters(input) {
  const result = {
    assignee: [],
    team: [],
    project: [],
    programme: [],
    task: []
  };

  if (!input || typeof input !== 'object') {
    return result;
  }

  const keys = ['assignee', 'team', 'project', 'programme', 'task'];
  
  for (const key of keys) {
    const value = input[key];
    if (Array.isArray(value)) {
      const seen = new Set();
      for (const item of value) {
        if (item === null || item === undefined || item === '') {
          continue;
        }
        const str = String(item);
        if (!seen.has(str)) {
          seen.add(str);
          result[key].push(str);
        }
      }
    }
  }

  return result;
}

class FilterManager {
  /**
   * @param {Object} options
   * @param {Object} options.data - { team: [], entites: [], projects: [], tasks: [], actions: [], programmes: [] }
   * @param {Object} options.initialFilters - Filtres initiaux (sera normalisé)
   * @param {Function} options.onChange - Callback quand les filtres changent (local, external, init)
   * @param {Function} options.onBroadcast - Callback pour diffuser les filtres (grist.setOptions) - UNIQUEMENT pour changements locaux
   * @param {Function} options.effCharges - Fonction pour obtenir les charges effectives d'une tâche
   * @param {Function} options.teamById - Fonction pour obtenir un membre par son ID
   * @param {string} options.theme - Déprécié : le thème vient de Grist via CSS variables
   * @param {Function} options.postFilter - Fonction de post-filtrage spécifique au widget
   * @param {Object} options.widgetConfig - Configuration spécifique au widget
   */
  constructor(options = {}) {
    this.data = options.data || {};
    this.filters = normalizeFilters(options.initialFilters || {});
    this.onChange = options.onChange || (() => {});
    this.onBroadcast = options.onBroadcast || (() => {});
    this.effCharges = options.effCharges || (() => []);
    this.teamById = options.teamById || (() => null);
    this.theme = options.theme || 'light'; // Déprécié, gardé pour compatibilité
    this.ui = null;
    this.openSection = null;
    this.postFilter = options.postFilter || null;
    this.widgetConfig = options.widgetConfig || {};
    this._isBroadcasting = false; // Indicateur interne pour éviter les boucles
  }

  // ========== INITIALISATION UI ==========

  /**
   * Initialise l'UI avec les conteneurs fournis
   * @param {Object} containers - { assignee: HTMLElement, team: HTMLElement, project: HTMLElement, task: HTMLElement }
   * @param {HTMLElement} filterPanel - L'élément parent .filter-panel
   */
   initUI(containers, filterPanel) {
    this.ui = {
      assignee: containers.assignee ? this._createFilterSection(containers.assignee, 'assignee', 'Personnes', this.data.team || []) : null,
      team: containers.team ? this._createFilterSection(containers.team, 'team', 'Équipes', this.data.entites || []) : null,
      project: containers.project ? this._createFilterSection(containers.project, 'project', 'Projets', this.data.projects || []) : null,
      task: containers.task ? this._createFilterSection(containers.task, 'task', 'Tâches', this.data.tasks || []) : null,
      programme: containers.programme ? this._createFilterSection(containers.programme, 'programme', 'Programmes', this.data.programmes || []) : null
    };
    
    this.filterPanel = filterPanel;
    this._updateUIFromState();
    this._setupAccordion();
    this._setupPanelToggle();
  }

  /**
   * Crée une section de filtre complète avec en-tête et checkboxes
   * @private
   */
  _createFilterSection(container, type, label, items) {
    container.innerHTML = '';
    
    // Créer l'en-tête de section
    const header = document.createElement('div');
    header.className = 'filter-section-header';
    header.innerHTML = `
      <span class="filter-section-label">${label}</span>
      <span class="filter-section-count">0</span>
      <span class="filter-section-chevron">▾</span>
    `;
    header.dataset.type = type;
    
    // Créer le conteneur des checkboxes
    const checkboxContainer = document.createElement('div');
    checkboxContainer.className = 'filter-checkboxes';
    checkboxContainer.dataset.type = type;
    
    // Créer les checkboxes pour chaque item
    items.forEach(item => {
      const itemId = item.id;
      const itemLabel = item.nom || item.titre || item.name || `Item ${itemId}`;
      
      const labelElement = document.createElement('label');
      labelElement.className = 'filter-checkbox-label';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = itemId;
      checkbox.className = 'filter-checkbox';
      checkbox.dataset.type = type;
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        this._handleCheckboxChange(type, e.target.value, e.target.checked);
      });
      
      const textSpan = document.createElement('span');
      textSpan.className = 'filter-checkbox-text';
      textSpan.textContent = itemLabel;
      
      labelElement.appendChild(checkbox);
      labelElement.appendChild(textSpan);
      checkboxContainer.appendChild(labelElement);
    });
    
    // Assembler la section
    container.appendChild(header);
    container.appendChild(checkboxContainer);
    
    return { header, checkboxContainer };
  }

  /**
   * Configure le comportement accordéon des sections
   * @private
   */
  _setupAccordion() {
    if (!this.ui) return;
    
    Object.keys(this.ui).forEach(type => {
      const section = this.ui[type];
      if (section && section.header) {
        section.header.addEventListener('click', (e) => {
          e.stopPropagation();
          this._toggleSection(type);
        });
      }
    });
    
    // Fermer toutes les sections au chargement
    this._closeAllSections();
  }

  /**
   * Configure l'ouverture/fermeture du panneau de filtres
   * @private
   */
  _setupPanelToggle() {
    if (!this.filterPanel) return;
    
    // Trouver le bouton de filtre (peut être dans le parent ou dans le document)
    const filterBtn = this.filterPanel.querySelector('.filter-btn, #btnFilterToggle');
    const filterDropdown = this.filterPanel.closest('.filter-dropdown');
    const btnInDropdown = filterDropdown ? filterDropdown.querySelector('.filter-btn, #btnFilterToggle') : null;
    const btn = filterBtn || btnInDropdown || document.getElementById('btnFilterToggle');
    
    if (btn) {
      btn.onclick = (e) => {
        this.filterPanel.classList.toggle('open');
        e.stopPropagation();
      };
    }
    
    // Fermer le panneau quand on clique à l'extérieur
    document.addEventListener('click', (e) => {
      if (this.filterPanel && !this.filterPanel.contains(e.target) && e.target !== btn) {
        this.filterPanel.classList.remove('open');
      }
    });
    
    // Bouton Effacer tout
    const btnClear = this.filterPanel.querySelector('#btnClearFilters');
    if (btnClear) {
      btnClear.onclick = (e) => {
        this.clearAll();
        e.stopPropagation();
      };
    }
  }

  /**
    * Ouvre/ferme une section spécifique
   * @private
   */
  _toggleSection(type) {
    const section = this.ui[type];
    if (!section) return;
    
    const isOpen = section.header.classList.contains('open');
    
    // Fermer toutes les sections
    this._closeAllSections();
    
    // Ouvrir la section cliquée si elle était fermée
    if (!isOpen) {
      section.header.classList.add('open');
      section.checkboxContainer.classList.add('open');
      section.checkboxContainer.style.display = 'block';
      this.openSection = type;
    } else {
      this.openSection = null;
    }
  }

  /**
   * Ferme toutes les sections
   * @private
   */
  _closeAllSections() {
    Object.keys(this.ui).forEach(type => {
      const section = this.ui[type];
      if (section && section.header) {
        section.header.classList.remove('open');
        if (section.checkboxContainer) {
          section.checkboxContainer.classList.remove('open');
          section.checkboxContainer.style.display = 'none';
        }
      }
    });
    this.openSection = null;
  }

  /**
   * Ouvre une section spécifique
   * @param {string} type - Type de filtre ('assignee', 'team', 'project', 'task')
   */
  openSection(type) {
    if (this.ui && this.ui[type]) {
      this._closeAllSections();
      const section = this.ui[type];
      section.header.classList.add('open');
      section.checkboxContainer.classList.add('open');
      section.checkboxContainer.style.display = 'block';
      this.openSection = type;
    }
  }

  // ========== GESTION DES CHECKBOXES ==========

  /**
   * Gère le changement d'état d'une checkbox (changement local)
   * @private
   */
  _handleCheckboxChange(type, value, checked) {
    if (!this.filters[type]) {
      this.filters[type] = [];
    }
    const filterArray = this.filters[type];
    const strValue = String(value);
    
    if (checked) {
      if (!filterArray.includes(strValue)) {
        filterArray.push(strValue);
      }
    } else {
      const index = filterArray.indexOf(strValue);
      if (index > -1) {
        filterArray.splice(index, 1);
      }
    }
    
    this._updateUIFromState();
    this.onChange(this.filters, 'local');
    this.onBroadcast(this.filters);
  }

  /**
   * Met à jour l'UI en fonction de l'état des filtres
   * @private
   */
  _updateUIFromState() {
    if (!this.ui) return;
    
    Object.keys(this.ui).forEach(type => {
      const section = this.ui[type];
      if (!section || !section.checkboxContainer) return;
      
      const checkboxes = section.checkboxContainer.querySelectorAll('.filter-checkbox');
      checkboxes.forEach(cb => {
        const filterArray = this.filters[type] || [];
        cb.checked = filterArray.includes(String(cb.value));
      });
      
      const filterArray = this.filters[type] || [];
      const count = filterArray.length;
      const countElement = section.header.querySelector('.filter-section-count');
      if (countElement) {
        countElement.textContent = count > 0 ? count : '';
      }
    });
    
    this._updateFilterButton();
  }

  /**
   * Met à jour l'indicateur visuel du bouton Filtres
   * @private
   */
  _updateFilterButton() {
    if (!this.filterPanel) return;
    
    // Trouver le bouton (peut être dans le parent .filter-dropdown)
    const filterDropdown = this.filterPanel.closest('.filter-dropdown');
    const btn = filterDropdown ? filterDropdown.querySelector('.filter-btn, #btnFilterToggle') : 
                 this.filterPanel.querySelector('.filter-btn, #btnFilterToggle');
    if (!btn) return;
    
    const count = Object.values(this.filters).reduce((sum, arr) => sum + arr.length, 0);
    const countEl = btn.querySelector('.filter-count');
    
    if (count > 0) {
      btn.classList.add('has-filter');
      if (countEl) {
        countEl.textContent = count;
        countEl.style.display = 'inline-flex';
      }
      btn.title = 'Filtres actifs (' + count + ') - cliquer pour modifier';
    } else {
      btn.classList.remove('has-filter');
      if (countEl) {
        countEl.style.display = 'none';
      }
      btn.title = 'Filtres - cliquer pour ouvrir';
    }
  }

  // ========== FILTRAGE DES TÂCHES ==========

  /**
   * Filtre les tâches selon les critères actuels, puis applique le post-filter widget si défini
   * @param {Array} tasks - Liste de tâches à filtrer
   * @returns {Array} Tâches filtrées (ou Actions si widget=kanban)
   */
  filterTasks(tasks) {
    let result = [...tasks];
 
    // Filtre par assignee (via charges ou assignees directement)
    if (this.filters.assignee && this.filters.assignee.length > 0) {
      result = result.filter(t => {
        const charges = this.effCharges(t);
        // Vérifier dans les charges d'abord
        if (charges.some(c => this.filters.assignee.includes(String(c.teamId)))) {
          return true;
        }
        // Si pas de charges, vérifier dans le champ assignees directement
        if (t.assignees) {
          const assigneeIds = this._getRefListArray(t.assignees);
          return assigneeIds.some(id => this.filters.assignee.includes(String(id)));
        }
        return false;
      });
    }
 
    // Filtre par équipe/entité (via entité des membres)
    if (this.filters.team && this.filters.team.length > 0) {
      result = result.filter(t => {
        const charges = this.effCharges(t);
        // Vérifier dans les charges d'abord
        if (charges.some(c => {
          const member = this.teamById(c.teamId);
          return member && member.entite && this.filters.team.includes(String(member.entite));
        })) {
          return true;
        }
        // Si pas de charges, vérifier via assignees
        if (t.assignees) {
          const assigneeIds = this._getRefListArray(t.assignees);
          return assigneeIds.some(id => {
            const member = this.teamById(id);
            return member && member.entite && this.filters.team.includes(String(member.entite));
          });
        }
        return false;
      });
    }
 
    // Filtre par projet
    if (this.filters.project && this.filters.project.length > 0) {
      result = result.filter(t => t.projet && this.filters.project.includes(String(t.projet)));
    }
 
    // Filtre par programme (via projets) - rétrocompatible portefeuille/programme
    if (this.filters.programme && this.filters.programme.length > 0) {
      result = result.filter(t => {
        const p = this.data.projects?.find(proj => proj.id === t.projet);
        if (!p) return false;
        const progId = p.programme || p.portefeuille; // rétrocompatible
        // Debug: console.log('Filter programme:', { taskId: t.id, taskProjet: t.projet, project: p?.nom, progId: progId, filterValues: this.filters.programme });
        return progId != null && this.filters.programme.includes(String(progId));
      });
    }
 
    // Filtre par tâche spécifique
    if (this.filters.task && this.filters.task.length > 0) {
      result = result.filter(t => t.id && this.filters.task.includes(String(t.id)));
    }
 
    // Appliquer le post-filter spécifique au widget si défini
    if (this.postFilter) {
      result = this.postFilter(result, this.widgetConfig, this.data);
    }
 
    return result;
  }

  /**
   * Extrait les IDs d'une RefList Grist
   * @private
   */
  _getRefListArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) {
      return val[0] === 'L' ? val.slice(1).map(Number) : val.map(Number);
    }
    return [];
  }

  // ========== GESTION DES FILTRES EXTERNES ==========

  /**
   * Applique les filtres externes (depuis grist.onOptions)
   * Normalise les IDs en chaînes, met à jour l'UI, ne diffuse PAS
   * @param {Object} externalFilters - Filtres externes
   */
  applyExternalFilters(externalFilters) {
    if (!externalFilters) return;

    const normalized = normalizeFilters(externalFilters);
    
    let changed = false;
    const keys = ['assignee', 'team', 'project', 'programme', 'task'];
    
    for (const key of keys) {
      if (normalized[key].length > 0 || this.filters[key].length > 0) {
        if (JSON.stringify(normalized[key]) !== JSON.stringify(this.filters[key])) {
          this.filters[key] = normalized[key];
          changed = true;
        }
      }
    }

    if (changed) {
      this._updateUIFromState();
      this.onChange(this.filters, 'external');
    }
  }

  // ========== UTILITAIRES ==========

  /**
   * Efface tous les filtres
   */
  clearAll() {
    this.filters = { assignee: [], team: [], project: [], task: [], programme: [] };
    this._updateUIFromState();
    this.onChange(this.filters, 'local');
    this.onBroadcast(this.filters);
  }

  /**
   * Retourne l'état actuel des filtres (copie)
   */
  getState() {
    return JSON.parse(JSON.stringify(this.filters));
  }

  /**
   * Définit l'état des filtres avec contrôle de l'origine
   * @param {Object} newFilters - Nouveaux filtres
   * @param {Object} options - { origin: 'local' | 'external' | 'init', broadcast: boolean, notify: boolean }
   */
  setState(newFilters, options = {}) {
    const opts = {
      origin: options.origin || 'local',
      broadcast: options.broadcast !== false,
      notify: options.notify !== false
    };

    const normalized = normalizeFilters(newFilters);
    this.filters = normalized;
    this._updateUIFromState();
    
    if (opts.notify) {
      this.onChange(this.filters, opts.origin);
    }
    
    if (opts.broadcast && opts.origin === 'local') {
      this.onBroadcast(this.filters);
    }
  }

  /**
   * Retire une valeur spécifique d'un type de filtre
   * Ne fait JAMAIS de toggle - uniquement suppression
   * @param {string} type - Type de filtre ('assignee', 'team', 'project', 'programme', 'task')
   * @param {string|number} value - Valeur à retirer (sera convertie en chaîne)
   * @returns {boolean} true si la valeur a été retirée, false si elle n'était pas présente
   */
  removeValue(type, value) {
    if (!this.filters[type] || !Array.isArray(this.filters[type])) {
      return false;
    }
    
    const strValue = String(value);
    const index = this.filters[type].indexOf(strValue);
    
    if (index > -1) {
      this.filters[type].splice(index, 1);
      this._updateUIFromState();
      this.onChange(this.filters, 'local');
      this.onBroadcast(this.filters);
      return true;
    }
    
    return false;
  }

  /**
   * Définit les données (appelé après chargement des données Grist)
   * Conserve les filtres actifs après reconstruction
   * @param {Object} data - { team: [], entites: [], projects: [], tasks: [], actions: [], programmes: [] }
   */
  setData(data) {
    const previousFilters = this.getState();
    
    this.data = data;
    
    if (this.ui) {
      Object.keys(this.ui).forEach(type => {
        const section = this.ui[type];
        if (!section || !section.checkboxContainer) return;
        
        const items = data[type === 'assignee' ? 'team' : 
                      type === 'team' ? 'entites' : 
                      type === 'project' ? 'projects' :
                      type === 'programme' ? 'programmes' : 'tasks'] || [];
        this._createCheckboxGroup(section.checkboxContainer, type, items);
      });
      
      this._updateUIFromState();
    }
  }

  /**
   * Met à jour la configuration spécifique au widget
   * @param {Object} config - Configuration du widget (ex: { workLevel: 'actions', showSubtasks: false, searchQuery: '' })
   */
  setWidgetConfig(config) {
    this.widgetConfig = { ...this.widgetConfig, ...config };
  }

  /**
   * Définit la fonction de post-filtrage spécifique au widget
   * @param {Function} fn - Fonction (filteredData, widgetConfig, allData) => finalData
   */
  setPostFilter(fn) {
    this.postFilter = fn;
  }

  /**
   * Crée un groupe de checkboxes pour un type de filtre (utilisé pour la reconstruction)
   * @private
   */
  _createCheckboxGroup(container, type, items) {
    container.innerHTML = '';
    items.forEach(item => {
      const labelElement = document.createElement('label');
      labelElement.className = 'filter-checkbox-label';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = item.id;
      checkbox.className = 'filter-checkbox';
      checkbox.dataset.type = type;
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        this._handleCheckboxChange(type, e.target.value, e.target.checked);
      });
      
      const textSpan = document.createElement('span');
      textSpan.className = 'filter-checkbox-text';
      textSpan.textContent = item.nom || item.titre || item.name || `Item ${item.id}`;
      
      labelElement.appendChild(checkbox);
      labelElement.appendChild(textSpan);
      container.appendChild(labelElement);
    });
  }

  /**
   * Retourne le nombre total de filtres actifs
   */
  getActiveFilterCount() {
    return Object.values(this.filters).reduce((sum, arr) => sum + arr.length, 0);
  }

  /**
   * Vérifie si des filtres sont actifs
   */
  hasActiveFilters() {
    return this.getActiveFilterCount() > 0;
  }
}

// ========== FONCTIONS D'UTILITÉ GLOBALES ==========

/**
 * Crée un élément de bouton de filtre standard
 * @param {string} label - Texte du bouton
 * @param {string} icon - Icône (emoji ou HTML)
 * @returns {HTMLElement}
 */
function createFilterButton(label, icon = '🔍') {
  const btn = document.createElement('button');
  btn.className = 'filter-btn';
  btn.innerHTML = `${icon} ${label} <span class="filter-count" style="display:none"></span>▾`;
  return btn;
}

/**
 * Crée un panneau de filtres standard
 * @returns {HTMLElement}
 */
function createFilterPanel() {
  const panel = document.createElement('div');
  panel.className = 'filter-menu filter-panel';
  panel.innerHTML = `
    <div class="filter-sections"></div>
    <div class="filter-actions">
      <button class="btn ghost clear-filters-btn">× Effacer tout</button>
    </div>
  `;
  return panel;
}

/**
 * Initialise un menu déroulant de filtres sur un bouton
 * @param {HTMLElement} button - Le bouton qui déclenche le menu
 * @param {HTMLElement} panel - Le panneau de filtres
 */
function initFilterDropdown(button, panel) {
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('open');
  });

  // Fermer le panneau quand on clique à l'extérieur
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== button) {
      panel.classList.remove('open');
    }
  });

  // Fermer le panneau quand on clique sur le bouton Effacer
  const clearBtn = panel.querySelector('.clear-filters-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }
}

// Exporter pour une utilisation dans les modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FilterManager, createFilterButton, createFilterPanel, initFilterDropdown, normalizeFilters };
}
