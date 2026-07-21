/**
 * CRA Export CSV - Générateur de fichier CSV pour les feuilles de temps
 * 
 * Module de génération CSV qui transforme un rapport CraExportModel en
 * contenu CSV téléchargeable.
 * 
 * Contraintes :
 * - Ne charge pas les données Grist
 * - N'applique pas de filtres
 * - Ne recalcule pas les heures
 * - Ne connaît pas l'état S du CRA
 * - Ne lit pas FilterManager
 * - Ne modifie pas les données reçues
 * 
 * @module core/cra/cra-export-csv
 */

'use strict';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Formats de date acceptés pour validation
 */
const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Caractères interdits dans les noms de fichier
 */
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

// ============================================================================
// VALIDATION DES DATES
// ============================================================================

/**
 * Valide une date au format ISO (YYYY-MM-DD)
 * @param {string} dateStr - Date à valider
 * @returns {boolean} true si la date est valide
 */
function isValidDateIso(dateStr) {
  if (typeof dateStr !== 'string') {
    return false;
  }
  
  if (!DATE_ISO_REGEX.test(dateStr)) {
    return false;
  }
  
  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  
  if (month < 1 || month > 12) {
    return false;
  }
  
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/**
 * Valide le rapport reçu de CraExportModel
 * @param {Object} report - Rapport à valider
 * @returns {{ valid: boolean, error: string|null }} Résultat de validation
 */
function validateReport(report) {
  // Vérifier que report est un objet
  if (!report || typeof report !== 'object') {
    return {
      valid: false,
      error: 'report doit être un objet'
    };
  }
  
  // Vérifier que report.period existe
  if (!report.period || typeof report.period !== 'object') {
    return {
      valid: false,
      error: 'report.period doit exister'
    };
  }
  
  const { startDateIso, endDateIso } = report.period;
  
  // Vérifier startDateIso
  if (!isValidDateIso(startDateIso)) {
    return {
      valid: false,
      error: 'report.period.startDateIso doit être une chaîne au format YYYY-MM-DD'
    };
  }
  
  // Vérifier endDateIso
  if (!isValidDateIso(endDateIso)) {
    return {
      valid: false,
      error: 'report.period.endDateIso doit être une chaîne au format YYYY-MM-DD'
    };
  }
  
  // Vérifier que startDateIso <= endDateIso
  if (startDateIso > endDateIso) {
    return {
      valid: false,
      error: 'report.period.startDateIso doit être antérieur ou égal à endDateIso'
    };
  }
  
  // Vérifier que report.persons est un tableau
  if (!Array.isArray(report.persons)) {
    return {
      valid: false,
      error: 'report.persons doit être un tableau'
    };
  }
  
  // Vérifier chaque personne
  for (let i = 0; i < report.persons.length; i++) {
    const person = report.persons[i];
    
    if (!person || typeof person !== 'object') {
      return {
        valid: false,
        error: 'report.persons[' + i + '] doit être un objet'
      };
    }
    
    if (!Array.isArray(person.rows)) {
      return {
        valid: false,
        error: 'report.persons[' + i + '].rows doit être un tableau'
      };
    }
    
    // Vérifier les durées
    for (let j = 0; j < person.rows.length; j++) {
      const row = person.rows[j];
      
      // Vérifier que row est un objet non null
      if (!row || typeof row !== 'object') {
        return {
          valid: false,
          error: 'report.persons[' + i + '].rows[' + j + '] doit être un objet'
        };
      }
      
      // Vérifier que durationMinutes est présent
      if (
        row.durationMinutes === null ||
        row.durationMinutes === undefined ||
        row.durationMinutes === ''
      ) {
        return {
          valid: false,
          error: 'report.persons[' + i + '].rows[' + j + '].durationMinutes est requis'
        };
      }
      
      // Vérifier que durationMinutes est un nombre fini
      if (!Number.isFinite(Number(row.durationMinutes))) {
        return {
          valid: false,
          error: 'report.persons[' + i + '].rows[' + j + '].durationMinutes doit être un nombre fini'
        };
      }
      
      // Vérifier que durationMinutes n'est pas négatif
      if (Number(row.durationMinutes) < 0) {
        return {
          valid: false,
          error: 'report.persons[' + i + '].rows[' + j + '].durationMinutes ne peut pas être négatif'
        };
      }
      
      // Vérifier que dateIso est valide
      if (!isValidDateIso(row.dateIso)) {
        return {
          valid: false,
          error: 'report.persons[' + i + '].rows[' + j + '].dateIso doit être une date ISO valide'
        };
      }
    }
  }
  
  return {
    valid: true,
    error: null
  };
}

// ============================================================================
// FORMATAGE DES DURÉES
// ============================================================================

/**
 * Formate une durée en minutes en heures décimales françaises
 * @param {number} minutes - Durée en minutes
 * @returns {string} Durée formatée (ex: 7, 0,5, 1,5)
 * @throws {Error} Si la valeur est invalide
 */
function formatDurationMinutes(minutes) {
  if (
    minutes === null ||
    minutes === undefined ||
    minutes === ''
  ) {
    throw new Error('CraExportCsv: durationMinutes invalide - ' + String(minutes));
  }
  
  const numeric = Number(minutes);
  
  if (!Number.isFinite(numeric)) {
    throw new Error('CraExportCsv: durationMinutes invalide - ' + String(minutes));
  }
  
  if (numeric < 0) {
    throw new Error('CraExportCsv: durationMinutes négative - ' + String(minutes));
  }
  
  const roundedMinutes = Math.round(numeric);
  const decimalHours = roundedMinutes / 60;
  
  return decimalHours
    .toFixed(4)
    .replace(/0+$/, '')
    .replace(/\.$/, '')
    .replace('.', ',');
}

// ============================================================================
// PROTECTION CONTRE LES FORMULES DE TABLEUR
// ============================================================================

/**
 * Sanitize un texte pour éviter les formules de tableur
 * @param {string} value - Valeur à sanitiser
 * @returns {string} Valeur protégée
 */
function sanitizeSpreadsheetText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  
  const str = String(value);
  const trimmed = str.trimStart();
  
  // Détecter les préfixes dangereux
  if (
    trimmed.startsWith('=') ||
    trimmed.startsWith('+') ||
    trimmed.startsWith('-') ||
    trimmed.startsWith('@')
  ) {
    return "'" + str;
  }
  
  return str;
}

// ============================================================================
// ÉCHAPPEMENT CSV
// ============================================================================

/**
 * Échappe un champ CSV
 * @param {*} value - Valeur à échapper
 * @returns {string} Champ échappé
 */
function escapeCsvField(value) {
  if (value === null || value === undefined) {
    return '';
  }
  
  const str = String(value);
  
  // Vérifier si le champ doit être entouré de guillemets
  const needsQuotes =
    str.includes(';') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r');
  
  if (needsQuotes) {
    // Doubler les guillemets internes
    const escaped = str.replace(/"/g, '""');
    return '"' + escaped + '"';
  }
  
  return str;
}

// ============================================================================
// CRÉATION DES LIGNES
// ============================================================================

/**
 * Crée les lignes du rapport avant sérialisation
 * @param {Object} report - Rapport CraExportModel
 * @returns {Array<Array<string>>} Tableau de tableaux (lignes)
 * @throws {Error} Si le rapport est invalide ou vide
 */
function createRows(report) {
  // Valider le rapport
  const validation = validateReport(report);
  if (!validation.valid) {
    throw new Error('CraExportCsv: rapport invalide — ' + validation.error);
  }
  
  const rows = [];
  
  // En-tête
  rows.push([
    'Déclarant',
    'Date',
    'Durée',
    'Projet',
    'Tâche'
  ]);
  
  // Filtrer les personnes sans lignes (défensivement)
  const activePersons = [];
  for (const person of report.persons) {
    if (person.rows && person.rows.length > 0) {
      activePersons.push(person);
    }
  }
  
  // Vérifier qu'il reste des données à exporter
  if (activePersons.length === 0) {
    throw new Error('CraExportCsv: aucune feuille de temps à exporter.');
  }
  
  // Construire les lignes
  for (const person of activePersons) {
    for (const row of person.rows) {
      // Appliquer la protection contre les formules aux champs textuels
      const declarant = sanitizeSpreadsheetText(person.name);
      const projet = sanitizeSpreadsheetText(row.projectName || '');
      const tache = sanitizeSpreadsheetText(row.taskName || '');
      
      // Formater la durée
      const duree = formatDurationMinutes(row.durationMinutes);
      
      // Conserver la date ISO
      const date = row.dateIso;
      
      rows.push([
        declarant,
        date,
        duree,
        projet,
        tache
      ]);
    }
  }
  
  return rows;
}

// ============================================================================
// SÉRIALISATION
// ============================================================================

/**
 * Sérialise le rapport en contenu CSV
 * @param {Object} report - Rapport CraExportModel
 * @param {Object} [options] - Options de sérialisation
 * @param {boolean} [options.includeBom=true] - Inclure le BOM UTF-8
 * @returns {string} Contenu CSV
 * @throws {Error} Si le rapport est invalide ou vide
 */
function serialize(report, options) {
  const opts = options || {};
  const includeBom = opts.includeBom !== false;
  
  // Créer les lignes
  const rows = createRows(report);
  
  // Échapper chaque champ et joindre les lignes
  const csvRows = rows.map(row => {
    return row.map(field => escapeCsvField(field)).join(';');
  });
  
  // Joindre les lignes avec \r\n et ajouter une fin de ligne finale
  let csvContent = csvRows.join('\r\n') + '\r\n';
  
  // Ajouter le BOM UTF-8 si demandé
  if (includeBom) {
    csvContent = '\uFEFF' + csvContent;
  }
  
  return csvContent;
}

// ============================================================================
// NOM DU FICHIER
// ============================================================================

/**
 * Construit le nom du fichier CSV
 * @param {Object} report - Rapport CraExportModel
 * @param {Object} [options] - Options de nommage
 * @param {string} [options.filename] - Nom de fichier personnalisé
 * @returns {string} Nom du fichier avec extension .csv
 * @throws {Error} Si le rapport est invalide ou si le nom personnalisé est vide
 */
function buildFilename(report, options) {
  const opts = options || {};
  
  // Nom personnalisé - détecter explicitement la présence de filename
  if (Object.prototype.hasOwnProperty.call(opts, 'filename')) {
    // filename doit être une chaîne
    if (typeof opts.filename !== 'string') {
      throw new Error('CraExportCsv: nom de fichier personnalisé invalide.');
    }
    
    let name = opts.filename.trim();
    
    // Refuser un nom vide après trim
    if (name === '') {
      throw new Error('CraExportCsv: nom de fichier personnalisé vide.');
    }
    
    // Nettoyer les caractères interdits
    name = name.replace(INVALID_FILENAME_CHARS, '_');
    
    // Garantir une seule extension CSV (sans tenir compte de la casse)
    const lowerName = name.toLowerCase();
    if (!lowerName.endsWith('.csv')) {
      name += '.csv';
    }
    
    return name;
  }
  
  // Validation de la période pour le nom par défaut
  if (
    !report ||
    !report.period ||
    typeof report.period.startDateIso !== 'string' ||
    typeof report.period.endDateIso !== 'string'
  ) {
    throw new Error('CraExportCsv: rapport invalide — période d\'export invalide.');
  }
  
  const startDate = report.period.startDateIso;
  const endDate = report.period.endDateIso;
  
  // Valider réellement les dates ISO civiles
  if (!isValidDateIso(startDate)) {
    throw new Error('CraExportCsv: rapport invalide — startDateIso n\'est pas une date ISO civile valide.');
  }
  
  if (!isValidDateIso(endDate)) {
    throw new Error('CraExportCsv: rapport invalide — endDateIso n\'est pas une date ISO civile valide.');
  }
  
  // Vérifier que startDateIso <= endDateIso
  if (startDate > endDate) {
    throw new Error('CraExportCsv: rapport invalide — startDateIso doit être antérieur ou égal à endDateIso.');
  }
  
  // Nom par défaut basé sur la période
  let name = 'feuilles-de-temps_' + startDate + '_' + endDate + '.csv';
  name = name.replace(INVALID_FILENAME_CHARS, '_');
  
  return name;
}

// ============================================================================
// RÉSOLUTION DES DÉPENDANCES NAVIGATEUR
// ============================================================================

/**
 * Résout les dépendances navigateur pour le téléchargement
 * @param {Object} [options] - Options de résolution
 * @param {Object} [options.browser] - Dépendances injectées
 * @returns {Object} Dépendances résolues
 * @throws {Error} Si une dépendance manque
 */
function resolveBrowserDependencies(options) {
  const opts = options || {};
  const browser = opts.browser || {};
  
  // Résoudre Blob
  const Blob = browser.Blob || (typeof globalThis !== 'undefined' ? globalThis.Blob : null);
  
  // Résoudre document
  const document = browser.document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
  
  // Résoudre URL
  const URL = browser.URL || (typeof globalThis !== 'undefined' ? globalThis.URL : null);
  
  // Vérifier les dépendances requises
  if (!Blob) {
    throw new Error('CraExportCsv: environnement de téléchargement indisponible.');
  }
  
  if (!document) {
    throw new Error('CraExportCsv: environnement de téléchargement indisponible.');
  }
  
  if (!URL || typeof URL.createObjectURL !== 'function' || typeof URL.revokeObjectURL !== 'function') {
    throw new Error('CraExportCsv: environnement de téléchargement indisponible.');
  }
  
  return {
    Blob: Blob,
    document: document,
    URL: URL
  };
}

// ============================================================================
// TÉLÉCHARGEMENT DANS LE NAVIGATEUR
// ============================================================================

/**
 * Télécharge le fichier CSV généré
 * @param {Object} report - Rapport CraExportModel
 * @param {Object} [options] - Options de génération et téléchargement
 * @param {Object} [options.browser] - Dépendances navigateur injectées
 * @param {string} [options.filename] - Nom de fichier personnalisé
 * @returns {{ filename: string, content: string, blob: Object }} Résultat du téléchargement
 * @throws {Error} Si le rapport est invalide ou si l'environnement est indisponible
 */
function download(report, options) {
  const opts = options || {};
  
  // Valider le rapport d'abord
  const validation = validateReport(report);
  if (!validation.valid) {
    throw new Error('CraExportCsv: rapport invalide — ' + validation.error);
  }
  
  // Sérialiser le contenu
  const content = serialize(report, opts);
  
  // Construire le nom du fichier
  const filename = buildFilename(report, opts);
  
  // Résoudre les dépendances navigateur
  const deps = resolveBrowserDependencies(opts);
  const Blob = deps.Blob;
  const document = deps.document;
  const URL = deps.URL;
  
  // Créer le Blob
  const blob = new Blob([content], {
    type: 'text/csv;charset=utf-8'
  });
  
  // Créer l'URL objet
  const url = URL.createObjectURL(blob);
  
  let anchor = null;
  let wasAdded = false;
  
  try {
    // Créer l'élément <a>
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    
    // Ajouter au document si nécessaire
    if (!anchor.parentNode) {
      document.body.appendChild(anchor);
      wasAdded = true;
    }
    
    // Déclencher le clic
    anchor.click();
  } finally {
    try {
      // Retirer le lien si ajouté (sans dépendre de anchor.parentNode)
      if (wasAdded && anchor) {
        document.body.removeChild(anchor);
      }
    } catch (e) {
      // Ne pas masquer l'erreur principale éventuelle
    } finally {
      // Toujours révoquer l'URL objet, même si removeChild échoue
      URL.revokeObjectURL(url);
    }
  }
  
  return {
    filename: filename,
    content: content,
    blob: blob
  };
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

const CraExportCsv = {
  serialize,
  createRows,
  download,
  buildFilename,
  formatDurationMinutes,
  escapeCsvField,
  sanitizeSpreadsheetText,
  validateReport,
  resolveBrowserDependencies,
  isValidDateIso
};

// Export navigateur
if (typeof globalThis !== 'undefined') {
  globalThis.CraExportCsv = CraExportCsv;
}

// Export CommonJS (Node/Jest)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CraExportCsv;
}
