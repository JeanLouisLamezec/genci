/**
 * CRA Export PDF - Générateur de document PDF pour les feuilles de temps
 * 
 * Module de génération PDF qui transforme un rapport CraExportModel en
 * définition pdfmake, puis crée ou télécharge le PDF.
 * 
 * Contraintes :
 * - Ne charge pas les données Grist
 * - N'applique pas de filtres
 * - Ne recalcule pas les heures
 * - Ne connaît pas l'état S du CRA
 * - Ne lit pas FilterManager
 * - Ne modifie pas les données reçues
 * 
 * @module core/cra/cra-export-pdf
 */

(function(global) {
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
// VALIDATION DU RAPPORT
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
      
      // Vérifier que durationMinutes est présent
      if (
        row.durationMinutes === null ||
        row.durationMinutes === undefined
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
    }
  }
  
  return {
    valid: true,
    error: null
  };
}

// ============================================================================
// FORMATAGE DES DATES ET DURÉES
// ============================================================================

/**
 * Formate une date ISO en format français (DD/MM/YYYY)
 * Utilise directement les composants de la chaîne pour éviter les décalages UTC
 * @param {string} dateIso - Date au format YYYY-MM-DD
 * @returns {string} Date formatée DD/MM/YYYY
 * @throws {Error} Si la date est invalide
 */
function formatDateIso(dateIso) {
  if (!isValidDateIso(dateIso)) {
    throw new Error('CraExportPdf: dateIso invalide - ' + String(dateIso));
  }
  
  const parts = dateIso.split('-');
  const day = parts[2];
  const month = parts[1];
  const year = parts[0];
  
  return day + '/' + month + '/' + year;
}

/**
 * Formate une durée en minutes en format français (XhYY)
 * @param {number} minutes - Durée en minutes
 * @returns {string} Durée formatée (ex: 1h30, 7h, 0h)
 * @throws {Error} Si la valeur est invalide
 */
function formatDurationMinutes(minutes) {
  if (
    minutes === null ||
    minutes === undefined ||
    minutes === ''
  ) {
    throw new Error('CraExportPdf: durationMinutes invalide - ' + String(minutes));
  }
  
  const num = Number(minutes);
  
  if (!Number.isFinite(num)) {
    throw new Error('CraExportPdf: durationMinutes invalide - ' + String(minutes));
  }
  
  if (num < 0) {
    throw new Error('CraExportPdf: durationMinutes négative - ' + String(minutes));
  }
  
  const rounded = Math.round(num);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  
  if (mins === 0) {
    return hours + 'h';
  }
  
  return hours + 'h' + String(mins).padStart(2, '0');
}

// ============================================================================
// NOM DU FICHIER
// ============================================================================

/**
 * Construit le nom du fichier PDF
 * @param {Object} report - Rapport CraExportModel
 * @param {Object} options - Options de nommage
 * @param {string} [options.filename] - Nom de fichier personnalisé
 * @returns {string} Nom du fichier avec extension .pdf
 */
function buildFilename(report, options) {
  const opts = options || {};
  
  // Nom personnalisé
  if (opts.filename && typeof opts.filename === 'string') {
    let name = opts.filename.trim();
    name = name.replace(INVALID_FILENAME_CHARS, '_');
    
    if (!name.toLowerCase().endsWith('.pdf')) {
      name += '.pdf';
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
    throw new Error('CraExportPdf: rapport invalide — période d\'export invalide.');
  }
  
  // Nom par défaut basé sur la période
  const startDate = report.period.startDateIso;
  const endDate = report.period.endDateIso;
  
  let name = 'feuilles-de-temps_' + startDate + '_' + endDate + '.pdf';
  name = name.replace(INVALID_FILENAME_CHARS, '_');
  
  return name;
}

// ============================================================================
// RÉSOLUTION DE PDFMAKE
// ============================================================================

/**
 * Résout le moteur pdfmake
 * @param {Object} candidate - Instance candidate fournie via options
 * @returns {Object} Instance pdfMake validée
 * @throws {Error} Si pdfmake est indisponible
 */
function resolvePdfMake(candidate) {
  const engine =
    candidate ||
    (
      typeof globalThis !== 'undefined'
        ? globalThis.pdfMake
        : null
    );
  
  if (
    !engine ||
    typeof engine.createPdf !== 'function'
  ) {
    throw new Error(
      'CraExportPdf: pdfmake indisponible. ' +
      'Une instance exposant createPdf est requise.'
    );
  }
  
  return engine;
}

// ============================================================================
// CRÉATION DE LA DÉFINITION DU DOCUMENT
// ============================================================================

/**
 * Crée la définition du document pdfmake
 * @param {Object} report - Rapport CraExportModel
 * @param {Object} options - Options de génération
 * @returns {Object} Définition du document pdfmake
 * @throws {Error} Si le rapport est invalide ou vide
 */
function createDocumentDefinition(report, options) {
  const opts = options || {};
  
  // Valider le rapport
  const validation = validateReport(report);
  if (!validation.valid) {
    throw new Error('CraExportPdf: rapport invalide — ' + validation.error);
  }
  
  // Filtrer les personnes sans lignes (défensivement)
  const activePersons = [];
  for (const person of report.persons) {
    if (person.rows && person.rows.length > 0) {
      activePersons.push(person);
    }
  }
  
  // Vérifier qu'il reste des données à exporter
  if (activePersons.length === 0) {
    throw new Error('CraExportPdf: aucune feuille de temps à exporter.');
  }
  
  // Construire le contenu du document
  const content = [];
  
  for (let i = 0; i < activePersons.length; i++) {
    const person = activePersons[i];
    
    // Saut de page avant chaque personne (sauf la première)
    if (i > 0) {
      // Le saut de page sera géré par la table elle-même
    }
    
    // Période formatée
    const periodLabel =
      'Période : ' +
      formatDateIso(report.period.startDateIso) +
      ' – ' +
      formatDateIso(report.period.endDateIso);
    
    // Total de la personne
    const totalLabel =
      'Total : ' + formatDurationMinutes(person.totalMinutes);
    
    // Lignes du tableau
    const tableBody = [];
    
    // Ligne d'en-tête 1 : informations fusionnées
    const headerRow1 = [
      {
        colSpan: 4,
        columns: [
          {
            width: '*',
            stack: [
              {
                text: 'FEUILLE DE TEMPS',
                style: 'headerTitle',
                margin: [0, 0, 0, 4]
              },
              {
                text: person.name || '',
                style: 'headerPerson',
                margin: [0, 0, 0, 4]
              }
            ]
          },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              {
                text: periodLabel,
                style: 'headerInfo',
                margin: [0, 0, 0, 2]
              },
              {
                text: totalLabel,
                style: 'headerInfo',
                margin: [0, 0, 0, 2]
              }
            ]
          }
        ],
        fillColor: '#1e3a5f',
        color: '#ffffff'
      },
      {},
      {},
      {}
    ];
    tableBody.push(headerRow1);
    
    // Ligne d'en-tête 2 : titres des colonnes
    const headerRow2 = [
      {
        text: 'Date',
        style: 'columnHeader',
        fillColor: '#e5e7eb'
      },
      {
        text: 'Durée',
        style: 'columnHeader',
        fillColor: '#e5e7eb'
      },
      {
        text: 'Projet',
        style: 'columnHeader',
        fillColor: '#e5e7eb'
      },
      {
        text: 'Tâche',
        style: 'columnHeader',
        fillColor: '#e5e7eb'
      }
    ];
    tableBody.push(headerRow2);
    
    // Lignes d'activité
    let previousDate = null;
    
    for (let j = 0; j < person.rows.length; j++) {
      const row = person.rows[j];
      const currentKey = row.dateIso;
      
      // Déterminer si c'est une nouvelle date (pour bordure supérieure)
      const isNewDate = previousDate !== currentKey;
      
      const tableRow = [
        {
          text: formatDateIso(row.dateIso),
          style: isNewDate ? 'cellDateNew' : 'cellDate',
          margin: [4, 4, 4, 4]
        },
        {
          text: formatDurationMinutes(row.durationMinutes),
          style: 'cellDuration',
          alignment: 'right',
          margin: [4, 4, 4, 4]
        },
        {
          text: row.projectName || '',
          style: 'cellText',
          margin: [4, 4, 4, 4]
        },
        {
          text: row.taskName || '',
          style: 'cellText',
          margin: [4, 4, 4, 4]
        }
      ];
      
      // Bordure supérieure plus marquée pour nouvelle date
      if (isNewDate && j > 0) {
        tableRow[0].border = { top: true, bottom: true, left: true, right: true };
        tableRow[1].border = { top: true, bottom: true, left: true, right: true };
        tableRow[2].border = { top: true, bottom: true, left: true, right: true };
        tableRow[3].border = { top: true, bottom: true, left: true, right: true };
        tableRow[0].fillColor = '#f9fafb';
        tableRow[1].fillColor = '#f9fafb';
        tableRow[2].fillColor = '#f9fafb';
        tableRow[3].fillColor = '#f9fafb';
      }
      
      tableBody.push(tableRow);
      
      previousDate = currentKey;
    }
    
    // Créer le tableau pour cette personne
    const personTable = {
      table: {
        headerRows: 2,
        widths: [74, 52, '35%', '*'],
        body: tableBody
      },
      layout: {
        hLineWidth: function(i, node) {
          if (i === 0 || i === node.table.body.length) {
            return 1;
          }
          if (i === 1 || i === 2) {
            return 1;
          }
          return 0.5;
        },
        vLineWidth: function() {
          return 0.5;
        },
        hLineColor: function(i, node) {
          if (i === 0 || i === node.table.body.length) {
            return '#374151';
          }
          if (i === 1 || i === 2) {
            return '#374151';
          }
          return '#d1d5db';
        },
        vLineColor: function() {
          return '#d1d5db';
        }
      },
      pageBreak: i > 0 ? 'before' : undefined,
      margin: [0, 0, 0, 16]
    };
    
    content.push(personTable);
  }
  
  // Définition complète du document
  const definition = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [32, 32, 32, 42],
    
    content: content,
    
    styles: {
      headerTitle: {
        fontSize: 14,
        bold: true,
        color: '#ffffff'
      },
      headerPerson: {
        fontSize: 12,
        bold: true,
        color: '#ffffff'
      },
      headerInfo: {
        fontSize: 9,
        color: '#ffffff'
      },
      columnHeader: {
        fontSize: 9,
        bold: true,
        color: '#1f2937',
        alignment: 'center',
        margin: [4, 6, 4, 6]
      },
      cellDate: {
        fontSize: 9,
        color: '#374151'
      },
      cellDateNew: {
        fontSize: 9,
        color: '#374151',
        bold: true
      },
      cellDuration: {
        fontSize: 9,
        color: '#374151'
      },
      cellText: {
        fontSize: 9,
        color: '#374151',
        wordWrap: true
      }
    },
    
    footer: function(currentPage, pageCount) {
      return {
        columns: [
          {
            text: 'Généré depuis Grist',
            alignment: 'left',
            fontSize: 8,
            color: '#64748b',
            margin: [32, 0, 0, 0]
          },
          {
            text: 'Page ' + currentPage + ' / ' + pageCount,
            alignment: 'right',
            fontSize: 8,
            color: '#64748b',
            margin: [0, 0, 32, 0]
          }
        ],
        margin: [0, 8, 0, 16]
      };
    },
    
    info: {
      title: 'Feuilles de temps',
      subject: 'Export CRA',
      creator: 'TaskFlow'
    }
  };
  
  return definition;
}

// ============================================================================
// CRÉATION DU DOCUMENT PDF
// ============================================================================

/**
 * Crée un document PDF à partir du rapport
 * @param {Object} report - Rapport CraExportModel
 * @param {Object} options - Options de génération
 * @param {Object} [options.pdfMake] - Instance pdfMake
 * @returns {Object} Document pdfMake
 * @throws {Error} Si le rapport est invalide ou si pdfMake est indisponible
 */
function createPdf(report, options) {
  const opts = options || {};
  
  // Construire la définition
  const definition = createDocumentDefinition(report, opts);
  
  // Résoudre pdfMake
  const pdfMake = resolvePdfMake(opts.pdfMake);
  
  // Créer le document
  return pdfMake.createPdf(definition);
}

// ============================================================================
// TÉLÉCHARGEMENT DU PDF
// ============================================================================

/**
 * Télécharge le PDF généré
 * @param {Object} report - Rapport CraExportModel
 * @param {Object} options - Options de génération et téléchargement
 * @param {Object} [options.pdfMake] - Instance pdfMake
 * @param {string} [options.filename] - Nom de fichier personnalisé
 * @returns {{ filename: string, pdf: Object }} Résultat du téléchargement
 * @throws {Error} Si le rapport est invalide, pdfMake indisponible ou download absent
 */
function download(report, options) {
  const opts = options || {};
  
  // Valider le rapport d'abord
  const validation = validateReport(report);
  if (!validation.valid) {
    throw new Error('CraExportPdf: rapport invalide — ' + validation.error);
  }
  
  // Construire le nom du fichier
  const filename = buildFilename(report, opts);
  
  // Créer le document PDF
  const pdf = createPdf(report, opts);
  
  // Vérifier que download est disponible
  if (typeof pdf.download !== 'function') {
    throw new Error(
      'CraExportPdf: le document pdfmake ne permet pas le téléchargement.'
    );
  }
  
  // Lancer le téléchargement
  pdf.download(filename);
  
  return {
    filename: filename,
    pdf: pdf
  };
}

// ============================================================================
// EXPORT PUBLIC
// ============================================================================

const CraExportPdf = {
  createDocumentDefinition,
  createPdf,
  download,
  buildFilename,
  formatDateIso,
  formatDurationMinutes,
  validateReport,
  resolvePdfMake
};

// Export navigateur
if (typeof global !== 'undefined' && global) {
  global.CraExportPdf = CraExportPdf;
}

// Export CommonJS (Node/Jest)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CraExportPdf;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
