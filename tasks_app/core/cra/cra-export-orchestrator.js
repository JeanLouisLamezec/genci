/**
 * CRA Export Orchestrator - Orchestrateur d'export pour le CRA
 * 
 * Module intermédiaire qui prépare et déclenche un export PDF ou CSV
 * à partir d'un état CRA déjà normalisé.
 * 
 * Contraintes :
 * - Aucun accès au DOM
 * - Aucun accès direct à Grist
 * - Aucun accès à FilterManager
 * - Aucun accès direct à l'état global S
 * - Aucune dépendance à pdfmake au chargement
 * - Aucun téléchargement propre
 * - Aucune logique de mise en page PDF
 * - Aucune logique de sérialisation CSV
 * 
 * Ce module orchestre les modules existants sans dupliquer leur logique.
 * 
 * @module core/cra/cra-export-orchestrator
 */

(function(global) {
  'use strict';

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  /**
   * Formats d'export autorisés
   */
const ALLOWED_FORMATS = ['pdf', 'csv'];

// ============================================================================
// RÉSOLUTION DES DÉPENDANCES
// ============================================================================

/**
 * Résout CraExportModel de manière compatible navigateur et Node
 * @param {Object} candidate - Instance candidate fournie explicitement
 * @returns {Object} CraExportModel résolu
 * @throws {Error} Si CraExportModel est indisponible
 */
function resolveExportModel(candidate) {
  // 1. Dépendance injectée explicitement
  if (candidate) {
    return candidate;
  }

  // 2. globalThis.CraExportModel
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.CraExportModel
  ) {
    return globalThis.CraExportModel;
  }

  // 3. CommonJS require
  if (
    typeof module !== 'undefined' &&
    module.exports &&
    typeof require === 'function'
  ) {
    return require('./cra-export-model.js');
  }

  throw new Error(
    'CraExportOrchestrator: CraExportModel indisponible. ' +
    'Fournissez-le en dépendance ou exposez-le via globalThis.CraExportModel'
  );
}

/**
 * Résout un générateur (PDF ou CSV) de manière compatible navigateur et Node
 * @param {string} format - Format demandé ('pdf' ou 'csv')
 * @param {Object} dependencies - Dépendances candidates
 * @returns {Object} Générateur résolu
 * @throws {Error} Si le générateur est indisponible
 */
function resolveRenderer(format, dependencies) {
  const deps = dependencies || {};

  // 1. Dépendance injectée explicitement
  if (format === 'pdf' && deps.pdf) {
    return deps.pdf;
  }
  if (format === 'csv' && deps.csv) {
    return deps.csv;
  }

  // 2. globalThis
  if (format === 'pdf' && typeof globalThis !== 'undefined' && globalThis.CraExportPdf) {
    return globalThis.CraExportPdf;
  }
  if (format === 'csv' && typeof globalThis !== 'undefined' && globalThis.CraExportCsv) {
    return globalThis.CraExportCsv;
  }

  // 3. CommonJS require
  if (
    typeof module !== 'undefined' &&
    module.exports &&
    typeof require === 'function'
  ) {
    if (format === 'pdf') {
      return require('./cra-export-pdf.js');
    }
    if (format === 'csv') {
      return require('./cra-export-csv.js');
    }
  }

  throw new Error(
    'CraExportOrchestrator: générateur ' + format + ' indisponible. ' +
    'Fournissez-le en dépendance ou exposez-le via globalThis.CraExport' + format.toUpperCase()
  );
}

/**
 * Valide qu'un modèle CraExportModel expose les fonctions requises
 * @param {Object} model - Modèle à valider
 * @returns {Object} Le modèle validé
 * @throws {Error} Si le modèle est invalide
 */
function validateExportModel(model) {
  if (
    !model ||
    typeof model.buildReport !== 'function' ||
    typeof model.normalizeScope !== 'function' ||
    typeof model.validateDateRange !== 'function'
  ) {
    throw new Error('CraExportOrchestrator: CraExportModel invalide.');
  }

  return model;
}

/**
 * Valide qu'un générateur PDF expose les fonctions requises
 * @param {Object} renderer - Générateur à valider
 * @returns {Object} Le générateur validé
 * @throws {Error} Si le générateur est invalide
 */
function validatePdfRenderer(renderer) {
  if (
    !renderer ||
    typeof renderer.buildFilename !== 'function' ||
    typeof renderer.download !== 'function'
  ) {
    throw new Error('CraExportOrchestrator: générateur PDF invalide.');
  }

  return renderer;
}

/**
 * Valide qu'un générateur CSV expose les fonctions requises
 * @param {Object} renderer - Générateur à valider
 * @returns {Object} Le générateur validé
 * @throws {Error} Si le générateur est invalide
 */
function validateCsvRenderer(renderer) {
  if (
    !renderer ||
    typeof renderer.buildFilename !== 'function' ||
    typeof renderer.download !== 'function'
  ) {
    throw new Error('CraExportOrchestrator: générateur CSV invalide.');
  }

  return renderer;
}

// ============================================================================
// NORMALISATION DU FORMAT
// ============================================================================

/**
 * Normalise le format d'export
 * @param {string} format - Format à normaliser
 * @returns {string} Format normalisé ('pdf' ou 'csv')
 * @throws {Error} Si le format est invalide
 */
function normalizeFormat(format) {
  if (typeof format !== 'string') {
    throw new Error('CraExportOrchestrator: format invalide - doit être une chaîne.');
  }

  const normalized = format.trim().toLowerCase();

  if (!ALLOWED_FORMATS.includes(normalized)) {
    throw new Error(
      'CraExportOrchestrator: format "' + format + '" non autorisé. ' +
      'Formats autorisés : ' + ALLOWED_FORMATS.join(', ')
    );
  }

  return normalized;
}

// ============================================================================
// OPTIONS DE FORMAT POUR LA FUTURE MODALE
// ============================================================================

/**
 * Retourne les options de format disponibles pour la future modale
 * @returns {Array} Tableau des options de format
 */
function getFormatOptions() {
  return [
    {
      id: 'pdf',
      label: 'PDF',
      description: 'Feuille de temps mise en page'
    },
    {
      id: 'csv',
      label: 'CSV',
      description: 'Données tabulaires exploitables'
    }
  ];
}

// ============================================================================
// VALIDATION DE LA REQUÊTE
// ============================================================================

/**
 * Valide une requête d'export
 * @param {Object} request - Requête à valider
 * @param {Object} dependencies - Dépendances pour résolution du modèle
 * @returns {{ valid: boolean, error: string|null }} Résultat de validation
 */
function validateRequest(request, dependencies) {
  // Vérifier que request est un objet
  if (!request || typeof request !== 'object') {
    return {
      valid: false,
      error: 'CraExportOrchestrator: request doit être un objet.'
    };
  }

  // Vérifier le format
  let normalizedFormat;
  try {
    normalizedFormat = normalizeFormat(request.format);
  } catch (e) {
    return {
      valid: false,
      error: e.message
    };
  }

  // Vérifier startDateIso et endDateIso
  if (!request.startDateIso || !request.endDateIso) {
    return {
      valid: false,
      error: 'CraExportOrchestrator: startDateIso et endDateIso sont obligatoires.'
    };
  }

  // Résoudre et valider le modèle pour valider les dates
  let model;
  try {
    model = validateExportModel(
      resolveExportModel(dependencies ? dependencies.model : null)
    );
  } catch (e) {
    return {
      valid: false,
      error: e.message
    };
  }

  const dateValidation = model.validateDateRange(
    request.startDateIso,
    request.endDateIso
  );

  if (!dateValidation.valid) {
    return {
      valid: false,
      error: 'CraExportOrchestrator: ' + dateValidation.error
    };
  }

  // Vérifier personIds
  if (!Array.isArray(request.personIds)) {
    return {
      valid: false,
      error: 'CraExportOrchestrator: personIds doit être un tableau.'
    };
  }

  // Normaliser personIds pour vérifier qu'il en reste au moins un
  const normalizedPersonIds = request.personIds
    .map(id => {
      if (id === null || id === undefined || id === '') {
        return null;
      }
      const str = String(id).trim();
      return str === '' ? null : str;
    })
    .filter(id => id !== null);

  if (normalizedPersonIds.length === 0) {
    return {
      valid: false,
      error: 'CraExportOrchestrator: aucune personne à exporter.'
    };
  }

  // Vérifier filters (optionnel) - doit être un objet non null et non tableau
  if (
    Object.prototype.hasOwnProperty.call(request, 'filters') &&
    (request.filters === null || typeof request.filters !== 'object' || Array.isArray(request.filters))
  ) {
    return {
      valid: false,
      error: 'CraExportOrchestrator: filters doit être un objet.'
    };
  }

  // Vérifier data - doit être un objet
  if (!request.data || typeof request.data !== 'object') {
    return {
      valid: false,
      error: 'CraExportOrchestrator: data doit être un objet.'
    };
  }

  // Vérifier que chaque collection data est présente et est un tableau
  const dataKeys = ['entries', 'team', 'tasks', 'projects', 'programmes'];
  for (const key of dataKeys) {
    if (!Array.isArray(request.data[key])) {
      return {
        valid: false,
        error: 'CraExportOrchestrator: data.' + key + ' doit être un tableau.'
      };
    }
  }

  // Vérifier filename (optionnel)
  if (
    Object.prototype.hasOwnProperty.call(request, 'filename') &&
    (typeof request.filename !== 'string' || request.filename.trim() === '')
  ) {
    return {
      valid: false,
      error: 'CraExportOrchestrator: filename doit être une chaîne non vide.'
    };
  }

  // Vérifier pdfOptions (optionnel) - doit être un objet non null et non tableau
  if (
    Object.prototype.hasOwnProperty.call(request, 'pdfOptions') &&
    (request.pdfOptions === null || typeof request.pdfOptions !== 'object' || Array.isArray(request.pdfOptions))
  ) {
    return {
      valid: false,
      error: 'CraExportOrchestrator: pdfOptions doit être un objet.'
    };
  }

  // Vérifier csvOptions (optionnel) - doit être un objet non null et non tableau
  if (
    Object.prototype.hasOwnProperty.call(request, 'csvOptions') &&
    (request.csvOptions === null || typeof request.csvOptions !== 'object' || Array.isArray(request.csvOptions))
  ) {
    return {
      valid: false,
      error: 'CraExportOrchestrator: csvOptions doit être un objet.'
    };
  }

  return {
    valid: true,
    error: null
  };
}

// ============================================================================
// CONSTRUCTION DU SCOPE
// ============================================================================

/**
 * Construit le scope d'export à partir de la requête
 * @param {Object} request - Requête d'export
 * @param {Object} dependencies - Dépendances pour résolution du modèle
 * @returns {Object} Scope normalisé compatible avec CraExportModel.buildReport
 */
function buildScope(request, dependencies) {
  const model = validateExportModel(
    resolveExportModel(dependencies ? dependencies.model : null)
  );

  const filters = request.filters || {};

  const scope = {
    personIds: request.personIds || [],
    projectIds: filters.project || [],
    programmeIds: filters.programme || [],
    taskIds: filters.task || []
  };

  return model.normalizeScope(scope);
}

// ============================================================================
// CONSTRUCTION DU RAPPORT
// ============================================================================

/**
 * Construit le rapport d'export à partir de la requête
 * @param {Object} request - Requête d'export
 * @param {Object} dependencies - Dépendances pour résolution du modèle
 * @returns {Object} Rapport structuré de CraExportModel
 * @throws {Error} Si la requête est invalide ou si le modèle est indisponible
 */
function buildReport(request, dependencies) {
  // Valider la requête
  const validation = validateRequest(request, dependencies);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Résoudre le modèle
  const model = validateExportModel(
    resolveExportModel(dependencies ? dependencies.model : null)
  );

  // Construire le scope
  const scope = buildScope(request, dependencies);

  // Appeler CraExportModel.buildReport avec les tableaux validés
  return model.buildReport({
    startDateIso: request.startDateIso,
    endDateIso: request.endDateIso,
    scope: scope,
    entries: request.data.entries,
    team: request.data.team,
    tasks: request.data.tasks,
    projects: request.data.projects,
    programmes: request.data.programmes
  });
}

// ============================================================================
// PRÉPARATION DE L'EXPORT
// ============================================================================

/**
 * Prépare un export sans déclencher de téléchargement
 * @param {Object} request - Requête d'export
 * @param {Object} dependencies - Dépendances pour résolution des modules
 * @returns {Object} Synthèse de l'export prête pour la modale
 * @throws {Error} Si la requête est invalide ou si le rapport est vide
 */
function prepareExport(request, dependencies) {
  const deps = dependencies || {};

  // Valider la requête avant tout accès à request.format
  const validation = validateRequest(request, deps);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Normaliser le format
  const format = normalizeFormat(request.format);

  // Construire le rapport
  const report = buildReport(request, deps);

  // Vérifier que le rapport contient des données exportables
  const hasExportableRows =
    Array.isArray(report.persons) &&
    report.persons.some(function(person) {
      return (
        person &&
        Array.isArray(person.rows) &&
        person.rows.length > 0
      );
    });

  if (!hasExportableRows) {
    throw new Error('CraExportOrchestrator: aucune feuille de temps à exporter.');
  }

  // Résoudre uniquement le générateur correspondant
  const renderer = format === 'pdf'
    ? validatePdfRenderer(resolveRenderer('pdf', deps))
    : validateCsvRenderer(resolveRenderer('csv', deps));

  // Construire le nom du fichier
  const filenameOptions = {};
  if (Object.prototype.hasOwnProperty.call(request, 'filename')) {
    filenameOptions.filename = request.filename;
  }

  const filename = renderer.buildFilename(report, filenameOptions);

  // Produire une synthèse pour la future modale
  const totals =
    report.totals && typeof report.totals === 'object'
      ? report.totals
      : {};

  const summary = {
    startDateIso: report.period.startDateIso,
    endDateIso: report.period.endDateIso,
    selectedPersonCount: totals.selectedPersonCount || 0,
    exportedPersonCount: totals.exportedPersonCount || 0,
    rowCount: totals.rowCount || 0,
    totalMinutes: totals.totalMinutes || 0
  };

  return {
    format: format,
    filename: filename,
    report: report,
    summary: summary
  };
}

// ============================================================================
// TÉLÉCHARGEMENT
// ============================================================================

/**
 * Déclenche le téléchargement d'un export
 * @param {Object} request - Requête d'export
 * @param {Object} dependencies - Dépendances pour résolution des modules
 * @returns {Object} Résultat du téléchargement
 * @throws {Error} Si la requête est invalide ou si le téléchargement échoue
 */
function download(request, dependencies) {
  const deps = dependencies || {};

  // Préparer l'export
  const prepared = prepareExport(request, deps);

  // Sélectionner le bon générateur
  const renderer = prepared.format === 'pdf'
    ? validatePdfRenderer(resolveRenderer('pdf', deps))
    : validateCsvRenderer(resolveRenderer('csv', deps));

  // Créer une nouvelle copie des options spécifiques au format
  const options = {};
  if (prepared.format === 'pdf' && request.pdfOptions) {
    Object.assign(options, request.pdfOptions);
  } else if (prepared.format === 'csv' && request.csvOptions) {
    Object.assign(options, request.csvOptions);
  }

  // Ajouter le nom de fichier préparé
  options.filename = prepared.filename;

  // Déléguer au générateur
  const rendererResult = renderer.download(prepared.report, options);

  // Retourner une structure de haut niveau
  return {
    format: prepared.format,
    filename: prepared.filename,
    report: prepared.report,
    summary: prepared.summary,
    rendererResult: rendererResult
  };
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

const CraExportOrchestrator = {
  getFormatOptions: getFormatOptions,
  normalizeFormat: normalizeFormat,
  validateRequest: validateRequest,
  buildScope: buildScope,
  buildReport: buildReport,
  prepareExport: prepareExport,
  download: download,
  resolveExportModel: resolveExportModel,
  resolveRenderer: resolveRenderer
};

// Export navigateur
if (typeof global !== 'undefined' && global) {
  global.CraExportOrchestrator = CraExportOrchestrator;
}

// Export CommonJS (Node/Jest)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CraExportOrchestrator;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
