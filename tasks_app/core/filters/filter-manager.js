// =============================================
// FILTER MANAGER - Module mutualisé v2
// Filtre les tâches (Tasks) pour Plan, Kanban, Gantt
// Gestion des sections accordéon, CSS commun, état partagé
// =============================================

class FilterManager {
  /**
   * @param {Object} options
   * @param {Object} options.data - { team: [], entites: [], projects: [], tasks: [] }
   * @param {Object} options.initialFilters - Filtres initiaux { assignee: [], team: [], project: [], task: [] }
   * @param {Function} options.onChange - Callback quand les filtres changent
   * @param {Function} options.onBroadcast - Callback pour diffuser les filtres (grist.setOptions)
   * @param {Function} options.effCharges - Fonction pour obtenir les charges effectives d'une tâche
   * @param {Function} options.teamById - Fonction pour obtenir un membre par son ID
   * @param {string} options.theme - 'light' ou 'dark' pour adapter les styles
   */
  constructor(options = {}) {
    this.data = options.data || {};
    this.filters = options.initialFilters || {
      assignee: [],
      team: [],
      project: [],
      task: []
    };
    this.onChange = options.onChange || (() => {});
    this.onBroadcast = options.onBroadcast || (() => {});
    this.effCharges = options.effCharges || (() => []);
    this.teamById = options.teamById || (() => null);
    this.theme = options.theme || 'dark';
    this.ui = null;
    this.openSection = null; // Section actuellement ouverte (accordéon)
  }

  // ========== INITIALISATION UI ==========

  /**
   * Initialise l'UI avec les conteneurs fournis
   * @param {Object} containers - { assignee: HTMLElement, team: HTMLElement, project: HTMLElement, task: HTMLElement }
   * @param {HTMLElement} filterPanel - L'élément parent .filter-panel
   */
   initUI(containers, filterPanel) {
    this.ui = {
      assignee: this._createFilterSection(containers.assignee, 'assignee', 'Personnes', this.data.team || []),
      team: this._createFilterSection(containers.team, 'team', 'Équipes', this.data.entites || []),
      project: this._createFilterSection(containers.project, 'project', 'Projets', this.data.projects || []),
      task: this._createFilterSection(containers.task, 'task', 'Tâches', this.data.tasks || [])
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
   * Gère le changement d'état d'une checkbox
   * @private
   */
  _handleCheckboxChange(type, value, checked) {
    const filterArray = this.filters[type];
    
    if (checked) {
      if (!filterArray.includes(value)) {
        filterArray.push(value);
      }
    } else {
      const index = filterArray.indexOf(value);
      if (index > -1) {
        filterArray.splice(index, 1);
      }
    }
    
    this._updateUIFromState();
    this.onChange(this.filters);
    this.onBroadcast(this.filters);
  }

  /**
   * Met à jour l'UI en fonction de l'état des filtres
   * @private
   */
  _updateUIFromState() {
    // Mettre à jour les checkboxes
    Object.keys(this.ui).forEach(type => {
      const section = this.ui[type];
      if (section && section.checkboxContainer) {
        const checkboxes = section.checkboxContainer.querySelectorAll('.filter-checkbox');
        checkboxes.forEach(cb => {
          cb.checked = this.filters[type].includes(cb.value);
        });
        
        // Mettre à jour le compteur
        const count = this.filters[type].length;
        const countElement = section.header.querySelector('.filter-section-count');
        if (countElement) {
          countElement.textContent = count > 0 ? count : '';
        }
      }
    });
    
    // Mettre à jour l'indicateur du bouton principal
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
   * Filtre les tâches selon les critères actuels
   * @param {Array} tasks - Liste de tâches à filtrer
   * @returns {Array} Tâches filtrées
   */
   filterTasks(tasks) {
    let result = [...tasks];
 
    // Filtre par assignee (via charges ou assignees directement)
    if (this.filters.assignee.length > 0) {
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
    if (this.filters.team.length > 0) {
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
    if (this.filters.project.length > 0) {
      result = result.filter(t => t.projet && this.filters.project.includes(String(t.projet)));
    }
 
    // Filtre par tâche spécifique
    if (this.filters.task.length > 0) {
      result = result.filter(t => t.id && this.filters.task.includes(String(t.id)));
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
   * @param {Object} externalFilters - Filtres externes
   */
  applyExternalFilters(externalFilters) {
    if (!externalFilters) return;

    let changed = false;

    if (externalFilters.assignee && Array.isArray(externalFilters.assignee)) {
      this.filters.assignee = externalFilters.assignee.map(Number);
      changed = true;
    }

    if (externalFilters.team && Array.isArray(externalFilters.team)) {
      this.filters.team = externalFilters.team.map(Number);
      changed = true;
    }

    if (externalFilters.project != null) {
      this.filters.project = [Number(externalFilters.project)].filter(Boolean);
      changed = true;
    }

    if (externalFilters.task && Array.isArray(externalFilters.task)) {
      this.filters.task = externalFilters.task.map(Number);
      changed = true;
    }

    if (changed) {
      this._updateUIFromState();
      this.onChange(this.filters);
    }
  }

  // ========== UTILITAIRES ==========

  /**
   * Efface tous les filtres
   */
  clearAll() {
    this.filters = { assignee: [], team: [], project: [], task: [] };
    this._updateUIFromState();
    this.onChange(this.filters);
    this.onBroadcast(this.filters);
  }

  /**
   * Retourne l'état actuel des filtres
   */
  getState() {
    return { ...this.filters };
  }

  /**
   * Définit l'état des filtres
   * @param {Object} newFilters
   */
  setState(newFilters) {
    this.filters = { ...this.filters, ...newFilters };
    this._updateUIFromState();
    this.onChange(this.filters);
    this.onBroadcast(this.filters);
  }

  /**
   * Définit les données (appelé après chargement des données Grist)
   * @param {Object} data - { team: [], entites: [], projects: [], tasks: [] }
   */
  setData(data) {
    this.data = data;
    // Reconstruire l'UI si elle existe déjà
    if (this.ui) {
      Object.keys(this.ui).forEach(type => {
        const container = this.ui[type].checkboxContainer;
        if (container) {
          const items = data[type === 'assignee' ? 'team' : 
                        type === 'team' ? 'entites' : 
                        type === 'project' ? 'projects' : 'tasks'] || [];
          this._createCheckboxGroup(container, type, items);
        }
      });
      this._updateUIFromState();
    }
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
  module.exports = { FilterManager, createFilterButton, createFilterPanel, initFilterDropdown };
}
