/**
 * Tests unitaires pour CRA Export CSV
 * 
 * Cette suite de tests verrouille le contrat fonctionnel du générateur CSV
 * pour les feuilles de temps CRA.
 * 
 * Usage: npm test -- cra-export-csv.test.js --runInBand
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CraExportCsv = require('./cra-export-csv.js');

const {
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
} = CraExportCsv;

// ============================================================================
// FIXTURES
// ============================================================================

const baseReport = {
  period: {
    startDateIso: '2026-01-01',
    endDateIso: '2026-01-31'
  },

  persons: [
    {
      id: 2,
      name: 'Bob Martin',
      totalMinutes: 660,
      rows: [
        {
          dateIso: '2026-01-05',
          durationMinutes: 420,
          personId: 2,
          personName: 'Bob Martin',
          taskId: 1000,
          taskName: 'Pilotage',
          projectId: 100,
          projectName: 'Projet Alpha',
          programmeId: 10,
          programmeName: 'Programme Alpha'
        },
        {
          dateIso: '2026-01-06',
          durationMinutes: 240,
          personId: 2,
          personName: 'Bob Martin',
          taskId: 2000,
          taskName: 'Recette',
          projectId: 200,
          projectName: 'Projet Beta',
          programmeId: 20,
          programmeName: 'Programme Beta'
        }
      ]
    },

    {
      id: 1,
      name: 'Alice Durand',
      totalMinutes: 450,
      rows: [
        {
          dateIso: '2026-01-07',
          durationMinutes: 450,
          personId: 1,
          personName: 'Alice Durand',
          taskId: 3000,
          taskName: 'Développement',
          projectId: 300,
          projectName: 'Projet Gamma',
          programmeId: 30,
          programmeName: 'Programme Gamma'
        }
      ]
    }
  ],

  totals: {
    selectedPersonCount: 2,
    exportedPersonCount: 2,
    rowCount: 3,
    totalMinutes: 1110
  },

  diagnostics: {
    skippedOutsidePeriod: 0,
    skippedOutsideScope: 0,
    skippedUnknownPerson: 0,
    skippedUnknownTask: 0,
    skippedZeroDurationCells: 0,
    selectedPersonsWithoutRows: []
  }
};

function makeReport(overrides = {}) {
  const report = JSON.parse(JSON.stringify(baseReport));

  if (overrides.period) {
    report.period = {
      ...report.period,
      ...overrides.period
    };
  }

  if (Object.prototype.hasOwnProperty.call(overrides, 'persons')) {
    report.persons = overrides.persons;
  }

  if (overrides.totals) {
    report.totals = {
      ...report.totals,
      ...overrides.totals
    };
  }

  if (overrides.diagnostics) {
    report.diagnostics = {
      ...report.diagnostics,
      ...overrides.diagnostics
    };
  }

  return report;
}

function createFakeBrowser(options = {}) {
  const anchor = {
    href: '',
    download: '',
    parentNode: null,
    click: jest.fn()
  };

  const body = {
    appendChild: jest.fn(node => {
      node.parentNode = body;
    }),

    removeChild: jest.fn(node => {
      node.parentNode = null;
    })
  };

  const document = {
    body,
    createElement: jest.fn(tagName => {
      if (tagName !== 'a') {
        throw new Error('Élément inattendu');
      }
      return anchor;
    })
  };

  const BlobMock = jest.fn(function FakeBlob(parts, blobOptions) {
    this.parts = parts;
    this.options = blobOptions;
  });

  const URL = {
    createObjectURL: jest.fn(() => 'blob:fake'),
    revokeObjectURL: jest.fn()
  };

  return {
    Blob: BlobMock,
    document,
    URL,
    anchor,
    body
  };
}

// ============================================================================
// EXPORTS DU MODULE
// ============================================================================

describe('CRA Export CSV - Exports', () => {

  test('CommonJS expose toutes les fonctions publiques', () => {
    expect(typeof serialize).toBe('function');
    expect(typeof createRows).toBe('function');
    expect(typeof download).toBe('function');
    expect(typeof buildFilename).toBe('function');
    expect(typeof formatDurationMinutes).toBe('function');
    expect(typeof escapeCsvField).toBe('function');
    expect(typeof sanitizeSpreadsheetText).toBe('function');
    expect(typeof validateReport).toBe('function');
    expect(typeof resolveBrowserDependencies).toBe('function');
    expect(typeof isValidDateIso).toBe('function');
  });

  test('Export navigateur avec vm', () => {
    const csvPath = path.resolve(__dirname, 'cra-export-csv.js');
    const csvCode = fs.readFileSync(csvPath, 'utf-8');

    const sandbox = {
      globalThis: {},
      module: undefined,
      exports: undefined,
      require: undefined
    };

    vm.runInNewContext(csvCode, sandbox);

    expect(sandbox.globalThis.CraExportCsv).toBeDefined();
    expect(typeof sandbox.globalThis.CraExportCsv.serialize).toBe('function');
    expect(typeof sandbox.globalThis.CraExportCsv.createRows).toBe('function');
    expect(typeof sandbox.globalThis.CraExportCsv.download).toBe('function');
    expect(typeof sandbox.globalThis.CraExportCsv.buildFilename).toBe('function');
    expect(typeof sandbox.globalThis.CraExportCsv.formatDurationMinutes).toBe('function');
    expect(typeof sandbox.globalThis.CraExportCsv.escapeCsvField).toBe('function');
    expect(typeof sandbox.globalThis.CraExportCsv.sanitizeSpreadsheetText).toBe('function');
    expect(typeof sandbox.globalThis.CraExportCsv.validateReport).toBe('function');
    expect(typeof sandbox.globalThis.CraExportCsv.resolveBrowserDependencies).toBe('function');
    expect(typeof sandbox.globalThis.CraExportCsv.isValidDateIso).toBe('function');
  });

  test('Export navigateur réussit sans document, Blob, URL, Grist, CRAController ou pdfmake', () => {
    const csvPath = path.resolve(__dirname, 'cra-export-csv.js');
    const csvCode = fs.readFileSync(csvPath, 'utf-8');

    const sandbox = {
      globalThis: {},
      module: undefined,
      exports: undefined,
      require: undefined,
      document: undefined,
      Blob: undefined,
      URL: undefined,
      grist: undefined,
      CRAController: undefined,
      CraExportModel: undefined,
      pdfMake: undefined
    };

    expect(() => {
      vm.runInNewContext(csvCode, sandbox);
    }).not.toThrow();

    expect(sandbox.globalThis.CraExportCsv).toBeDefined();
  });
});

// ============================================================================
// isValidDateIso
// ============================================================================

describe('isValidDateIso', () => {

  test('2026-01-01 valide', () => {
    expect(isValidDateIso('2026-01-01')).toBe(true);
  });

  test('2026-12-31 valide', () => {
    expect(isValidDateIso('2026-12-31')).toBe(true);
  });

  test('2024-02-29 valide (bissextile)', () => {
    expect(isValidDateIso('2024-02-29')).toBe(true);
  });

  test('2025-02-29 invalide (non bissextile)', () => {
    expect(isValidDateIso('2025-02-29')).toBe(false);
  });

  test('2026-02-30 invalide', () => {
    expect(isValidDateIso('2026-02-30')).toBe(false);
  });

  test('mois 00 invalide', () => {
    expect(isValidDateIso('2026-00-01')).toBe(false);
  });

  test('mois 13 invalide', () => {
    expect(isValidDateIso('2026-13-01')).toBe(false);
  });

  test('mauvais format', () => {
    expect(isValidDateIso('01/01/2026')).toBe(false);
    expect(isValidDateIso('2026-1-1')).toBe(false);
    expect(isValidDateIso('2026/01/01')).toBe(false);
  });

  test('chaîne vide', () => {
    expect(isValidDateIso('')).toBe(false);
  });

  test('null', () => {
    expect(isValidDateIso(null)).toBe(false);
  });

  test('undefined', () => {
    expect(isValidDateIso(undefined)).toBe(false);
  });

  test('nombre', () => {
    expect(isValidDateIso(20260101)).toBe(false);
  });
});

// ============================================================================
// validateReport
// ============================================================================

describe('validateReport', () => {

  test('rapport nominal valide', () => {
    const result = validateReport(makeReport());
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  test('rapport null', () => {
    const result = validateReport(null);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('objet');
  });

  test('rapport non objet', () => {
    const result = validateReport('string');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('objet');
  });

  test('période absente', () => {
    const report = makeReport();
    delete report.period;
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('period');
  });

  test('date de début absente', () => {
    const report = makeReport({ period: { startDateIso: null, endDateIso: '2026-01-31' } });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('startDateIso');
  });

  test('date de fin absente', () => {
    const report = makeReport({ period: { startDateIso: '2026-01-01', endDateIso: null } });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('endDateIso');
  });

  test('date civile de début invalide', () => {
    const report = makeReport({ period: { startDateIso: '2026-02-30', endDateIso: '2026-03-01' } });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
  });

  test('date civile de fin invalide', () => {
    const report = makeReport({ period: { startDateIso: '2026-01-01', endDateIso: '2026-13-01' } });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
  });

  test('période inversée', () => {
    const report = makeReport({ period: { startDateIso: '2026-01-31', endDateIso: '2026-01-01' } });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('antérieur');
  });

  test('persons absent', () => {
    const report = makeReport();
    delete report.persons;
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('persons');
  });

  test('persons non tableau', () => {
    const report = makeReport({ persons: null });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('tableau');
  });

  test('personne null', () => {
    const report = makeReport({ persons: [null] });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('objet');
  });

  test('personne non objet', () => {
    const report = makeReport({ persons: ['string'] });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
  });

  test('personne sans rows', () => {
    const report = makeReport({ persons: [{ id: 1, name: 'Test' }] });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('rows');
  });

  test('rows non tableau', () => {
    const report = makeReport({ persons: [{ id: 1, name: 'Test', rows: null }] });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('tableau');
  });

  test('ligne null', () => {
    const report = makeReport({ persons: [{ id: 1, name: 'Test', rows: [null] }] });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('objet');
  });

  test('ligne non objet', () => {
    const report = makeReport({ persons: [{ id: 1, name: 'Test', rows: ['string'] }] });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
  });

  test('date de ligne absente', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        rows: [{ durationMinutes: 60 }]
      }]
    });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('dateIso');
  });

  test('date de ligne invalide', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        rows: [{ dateIso: 'invalid', durationMinutes: 60 }]
      }]
    });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
  });

  test('durationMinutes null', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        rows: [{ dateIso: '2026-01-01', durationMinutes: null }]
      }]
    });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('durationMinutes');
  });

  test('durationMinutes undefined', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        rows: [{ dateIso: '2026-01-01' }]
      }]
    });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('durationMinutes');
  });

  test('durationMinutes chaîne vide', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        rows: [{ dateIso: '2026-01-01', durationMinutes: '' }]
      }]
    });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
  });

  test('durationMinutes non numérique', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        rows: [{ dateIso: '2026-01-01', durationMinutes: 'abc' }]
      }]
    });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
  });

  test('durationMinutes NaN', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        rows: [{ dateIso: '2026-01-01', durationMinutes: NaN }]
      }]
    });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
  });

  test('durationMinutes Infinity', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        rows: [{ dateIso: '2026-01-01', durationMinutes: Infinity }]
      }]
    });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
  });

  test('durationMinutes négative', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        rows: [{ dateIso: '2026-01-01', durationMinutes: -10 }]
      }]
    });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('négatif');
  });

  test('durationMinutes zéro valide', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        rows: [{ dateIso: '2026-01-01', durationMinutes: 0 }]
      }]
    });
    const result = validateReport(report);
    expect(result.valid).toBe(true);
  });

  test('durationMinutes chaîne numérique valide', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        rows: [{ dateIso: '2026-01-01', durationMinutes: '60' }]
      }]
    });
    const result = validateReport(report);
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// formatDurationMinutes
// ============================================================================

describe('formatDurationMinutes', () => {

  test('0 → 0', () => {
    expect(formatDurationMinutes(0)).toBe('0');
  });

  test('1 → 0,0167', () => {
    expect(formatDurationMinutes(1)).toBe('0,0167');
  });

  test('15 → 0,25', () => {
    expect(formatDurationMinutes(15)).toBe('0,25');
  });

  test('30 → 0,5', () => {
    expect(formatDurationMinutes(30)).toBe('0,5');
  });

  test('45 → 0,75', () => {
    expect(formatDurationMinutes(45)).toBe('0,75');
  });

  test('48 → 0,8', () => {
    expect(formatDurationMinutes(48)).toBe('0,8');
  });

  test('60 → 1', () => {
    expect(formatDurationMinutes(60)).toBe('1');
  });

  test('90 → 1,5', () => {
    expect(formatDurationMinutes(90)).toBe('1,5');
  });

  test('120 → 2', () => {
    expect(formatDurationMinutes(120)).toBe('2');
  });

  test('420 → 7', () => {
    expect(formatDurationMinutes(420)).toBe('7');
  });

  test('435 → 7,25', () => {
    expect(formatDurationMinutes(435)).toBe('7,25');
  });

  test('450 → 7,5', () => {
    expect(formatDurationMinutes(450)).toBe('7,5');
  });

  test('60.4 → 1 (arrondi préalable)', () => {
    expect(formatDurationMinutes(60.4)).toBe('1');
  });

  test('60.5 → 1,0167 (arrondi préalable)', () => {
    expect(formatDurationMinutes(60.5)).toBe('1,0167');
  });

  test('60.6 → 1,0167 (arrondi préalable)', () => {
    expect(formatDurationMinutes(60.6)).toBe('1,0167');
  });

  test('chaîne numérique', () => {
    expect(formatDurationMinutes('60')).toBe('1');
  });

  test('null → erreur', () => {
    expect(() => formatDurationMinutes(null)).toThrow('CraExportCsv:');
  });

  test('undefined → erreur', () => {
    expect(() => formatDurationMinutes(undefined)).toThrow('CraExportCsv:');
  });

  test('chaîne vide → erreur', () => {
    expect(() => formatDurationMinutes('')).toThrow('CraExportCsv:');
  });

  test('chaîne non numérique → erreur', () => {
    expect(() => formatDurationMinutes('abc')).toThrow('CraExportCsv:');
  });

  test('NaN → erreur', () => {
    expect(() => formatDurationMinutes(NaN)).toThrow('CraExportCsv:');
  });

  test('Infinity → erreur', () => {
    expect(() => formatDurationMinutes(Infinity)).toThrow('CraExportCsv:');
  });

  test('valeur négative → erreur', () => {
    expect(() => formatDurationMinutes(-1)).toThrow('CraExportCsv:');
  });
});

// ============================================================================
// sanitizeSpreadsheetText
// ============================================================================

describe('sanitizeSpreadsheetText', () => {

  test('texte normal inchangé', () => {
    expect(sanitizeSpreadsheetText('Hello World')).toBe('Hello World');
    expect(sanitizeSpreadsheetText('Projet Alpha')).toBe('Projet Alpha');
  });

  test('null → chaîne vide', () => {
    expect(sanitizeSpreadsheetText(null)).toBe('');
  });

  test('undefined → chaîne vide', () => {
    expect(sanitizeSpreadsheetText(undefined)).toBe('');
  });

  test('nombre converti en chaîne', () => {
    expect(sanitizeSpreadsheetText(123)).toBe('123');
    expect(sanitizeSpreadsheetText(0)).toBe('0');
  });

  test('=FORMULE préfixé par apostrophe', () => {
    expect(sanitizeSpreadsheetText('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
  });

  test('+COMMANDE préfixé par apostrophe', () => {
    expect(sanitizeSpreadsheetText('+1+1')).toBe("'+1+1");
  });

  test('-COMMANDE préfixé par apostrophe', () => {
    expect(sanitizeSpreadsheetText('-1')).toBe("'-1");
  });

  test('@COMMANDE préfixé par apostrophe', () => {
    expect(sanitizeSpreadsheetText('@mention')).toBe("'@mention");
  });

  test('espaces initiaux avant formule détectés', () => {
    const result = sanitizeSpreadsheetText('  =SUM(A1:A2)');
    expect(result).toBe("'  =SUM(A1:A2)");
    expect(result.startsWith("'")).toBe(true);
  });

  test('texte contenant un signe au milieu non modifié', () => {
    expect(sanitizeSpreadsheetText('a=b')).toBe('a=b');
    expect(sanitizeSpreadsheetText('Projet-Beta')).toBe('Projet-Beta');
  });

  test('chaîne déjà préfixée par une apostrophe inchangée', () => {
    expect(sanitizeSpreadsheetText("'=SUM()")).toBe("'=SUM()");
  });

  test('valeur source non modifiée', () => {
    const original = '=FORMULE';
    const originalCopy = original;
    sanitizeSpreadsheetText(original);
    expect(original).toBe(originalCopy);
  });
});

// ============================================================================
// escapeCsvField
// ============================================================================

describe('escapeCsvField', () => {

  test('texte simple inchangé', () => {
    expect(escapeCsvField('Hello')).toBe('Hello');
    expect(escapeCsvField('Projet Alpha')).toBe('Projet Alpha');
  });

  test('chaîne vide inchangé', () => {
    expect(escapeCsvField('')).toBe('');
  });

  test('null → chaîne vide', () => {
    expect(escapeCsvField(null)).toBe('');
  });

  test('undefined → chaîne vide', () => {
    expect(escapeCsvField(undefined)).toBe('');
  });

  test('nombre converti en chaîne', () => {
    expect(escapeCsvField(123)).toBe('123');
  });

  test('champ contenant ; entouré de guillemets', () => {
    expect(escapeCsvField('Projet;Alpha')).toBe('"Projet;Alpha"');
  });

  test('guillemets internes doublés', () => {
    expect(escapeCsvField('Il a dit "bonjour"')).toBe('"Il a dit ""bonjour"""');
  });

  test('champ contenant \\n entouré de guillemets', () => {
    expect(escapeCsvField('ligne1\nligne2')).toBe('"ligne1\nligne2"');
  });

  test('champ contenant \\r entouré de guillemets', () => {
    expect(escapeCsvField('a\rb')).toBe('"a\rb"');
  });

  test('champ contenant \\r\\n correctement échappé', () => {
    expect(escapeCsvField('ligne1\r\nligne2')).toBe('"ligne1\r\nligne2"');
  });

  test('champ combinant point-virgule et guillemets', () => {
    expect(escapeCsvField('a;"b"')).toBe('"a;""b"""');
  });

  test('une virgule seule ne force pas les guillemets', () => {
    expect(escapeCsvField('a,b')).toBe('a,b');
  });
});

// ============================================================================
// createRows
// ============================================================================

describe('createRows', () => {

  test('en-tête exact', () => {
    const rows = createRows(makeReport());
    expect(rows[0]).toEqual(['Déclarant', 'Date', 'Durée', 'Projet', 'Tâche']);
  });

  test('chaque ligne contient exactement cinq colonnes', () => {
    const rows = createRows(makeReport());
    rows.forEach(row => {
      expect(row.length).toBe(5);
    });
  });

  test('ordre nominal : en-tête, Bob/5 janvier, Bob/6 janvier, Alice/7 janvier', () => {
    const rows = createRows(makeReport());
    expect(rows[0]).toEqual(['Déclarant', 'Date', 'Durée', 'Projet', 'Tâche']);
    expect(rows[1][0]).toBe('Bob Martin');
    expect(rows[1][1]).toBe('2026-01-05');
    expect(rows[2][0]).toBe('Bob Martin');
    expect(rows[2][1]).toBe('2026-01-06');
    expect(rows[3][0]).toBe('Alice Durand');
    expect(rows[3][1]).toBe('2026-01-07');
  });

  test('Bob précède Alice', () => {
    const rows = createRows(makeReport());
    const declarants = rows.slice(1).map(r => r[0]);
    const bobIndex = declarants.indexOf('Bob Martin');
    const aliceIndex = declarants.indexOf('Alice Durand');
    expect(bobIndex).toBeLessThan(aliceIndex);
  });

  test('les lignes de Bob restent dans leur ordre initial', () => {
    const rows = createRows(makeReport());
    expect(rows[1][1]).toBe('2026-01-05');
    expect(rows[2][1]).toBe('2026-01-06');
  });

  test('les dates restent au format ISO', () => {
    const rows = createRows(makeReport());
    expect(rows[1][1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rows[2][1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rows[3][1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('420 minutes produit 7', () => {
    const rows = createRows(makeReport());
    expect(rows[1][2]).toBe('7');
  });

  test('240 minutes produit 4', () => {
    const rows = createRows(makeReport());
    expect(rows[2][2]).toBe('4');
  });

  test('450 minutes produit 7,5', () => {
    const rows = createRows(makeReport());
    expect(rows[3][2]).toBe('7,5');
  });

  test('les noms de projets et tâches sont repris', () => {
    const rows = createRows(makeReport());
    expect(rows[1][3]).toBe('Projet Alpha');
    expect(rows[1][4]).toBe('Pilotage');
    expect(rows[2][3]).toBe('Projet Beta');
    expect(rows[2][4]).toBe('Recette');
  });

  test('les programmes ne sont pas ajoutés', () => {
    const rows = createRows(makeReport());
    const allTexts = rows.flat().join(' ');
    expect(allTexts).not.toContain('Programme Alpha');
    expect(allTexts).not.toContain('Programme Beta');
  });

  test('les IDs techniques ne sont pas ajoutés', () => {
    const rows = createRows(makeReport());
    const allTexts = rows.flat().join(' ');
    expect(allTexts).not.toContain('personId');
    expect(allTexts).not.toContain('projectId');
    expect(allTexts).not.toContain('taskId');
  });

  test('les totaux ne sont pas ajoutés', () => {
    const rows = createRows(makeReport());
    const allTexts = rows.flat().join(' ');
    expect(allTexts).not.toContain('totalMinutes');
    expect(allTexts).not.toContain('Total');
  });

  test('les diagnostics ne sont pas ajoutés', () => {
    const rows = createRows(makeReport());
    const allTexts = rows.flat().join(' ');
    expect(allTexts).not.toContain('skipped');
    expect(allTexts).not.toContain('diagnostics');
  });

  test('conserve l ordre désordonné des lignes', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        rows: [
          { dateIso: '2026-01-10', durationMinutes: 60, personId: 1, personName: 'Test', taskId: 1, taskName: 'Z', projectId: 1, projectName: 'P', programmeId: 1, programmeName: 'P' },
          { dateIso: '2026-01-05', durationMinutes: 60, personId: 1, personName: 'Test', taskId: 1, taskName: 'A', projectId: 1, projectName: 'P', programmeId: 1, programmeName: 'P' },
          { dateIso: '2026-01-08', durationMinutes: 60, personId: 1, personName: 'Test', taskId: 1, taskName: 'B', projectId: 1, projectName: 'P', programmeId: 1, programmeName: 'P' }
        ]
      }]
    });
    const rows = createRows(report);
    expect(rows[1][1]).toBe('2026-01-10');
    expect(rows[2][1]).toBe('2026-01-05');
    expect(rows[3][1]).toBe('2026-01-08');
  });
});

// ============================================================================
// PERSONNES SANS LIGNE
// ============================================================================

describe('Personnes sans ligne', () => {

  test('une personne avec rows=[] est ignorée lorsqu une autre personne possède des lignes', () => {
    const report = makeReport({
      persons: [
        ...makeReport().persons,
        { id: 3, name: 'Charlie', rows: [] }
      ]
    });
    const rows = createRows(report);
    const declarants = rows.slice(1).map(r => r[0]);
    expect(declarants).not.toContain('Charlie');
  });

  test('aucune ligne vide n est créée pour cette personne', () => {
    const report = makeReport({
      persons: [
        ...makeReport().persons,
        { id: 3, name: 'Charlie', rows: [] }
      ]
    });
    const rows = createRows(report);
    const charlieRows = rows.filter(r => r[0] === 'Charlie');
    expect(charlieRows.length).toBe(0);
  });

  test('persons: [] lève une erreur', () => {
    const report = makeReport({ persons: [] });
    expect(() => createRows(report)).toThrow('CraExportCsv:');
    expect(() => createRows(report)).toThrow('aucune feuille de temps à exporter');
  });

  test('une personne avec rows=[] seule lève une erreur', () => {
    const report = makeReport({
      persons: [{ id: 1, name: 'Test', rows: [] }]
    });
    expect(() => createRows(report)).toThrow('CraExportCsv:');
    expect(() => createRows(report)).toThrow('aucune feuille de temps à exporter');
  });

  test('plusieurs personnes avec uniquement des tableaux vides lèvent une erreur', () => {
    const report = makeReport({
      persons: [
        { id: 1, name: 'Test 1', rows: [] },
        { id: 2, name: 'Test 2', rows: [] }
      ]
    });
    expect(() => createRows(report)).toThrow('CraExportCsv:');
    expect(() => createRows(report)).toThrow('aucune feuille de temps à exporter');
  });
});

// ============================================================================
// PROTECTION CONTRE LES FORMULES DANS createRows
// ============================================================================

describe('Protection contre les formules dans createRows', () => {

  test('person.name = \'=DECLARANT\' est préfixé', () => {
    const report = makeReport();
    report.persons[0].name = '=DECLARANT';
    const rows = createRows(report);
    expect(rows[1][0]).toBe("'=DECLARANT");
  });

  test('row.projectName = \'+PROJET\' est préfixé', () => {
    const report = makeReport();
    report.persons[0].rows[0].projectName = '+PROJET';
    const rows = createRows(report);
    expect(rows[1][3]).toBe("'+PROJET");
  });

  test('row.taskName = \'@TACHE\' est préfixé', () => {
    const report = makeReport();
    report.persons[0].rows[0].taskName = '@TACHE';
    const rows = createRows(report);
    expect(rows[1][4]).toBe("'@TACHE");
  });

  test('row.projectName = \'-PROJET\' est préfixé', () => {
    const report = makeReport();
    report.persons[0].rows[0].projectName = '-PROJET';
    const rows = createRows(report);
    expect(rows[1][3]).toBe("'-PROJET");
  });

  test('row.dateIso n est pas protégé', () => {
    const report = makeReport();
    report.persons[0].rows[0].dateIso = '2026-01-01';
    const rows = createRows(report);
    expect(rows[1][1]).toBe('2026-01-01');
    expect(rows[1][1]).not.toMatch(/^'/);
  });

  test('la durée formatée n est pas protégée', () => {
    const report = makeReport();
    const rows = createRows(report);
    expect(rows[1][2]).toBe('7');
    expect(rows[1][2]).not.toMatch(/^'/);
  });
});

// ============================================================================
// serialize
// ============================================================================

describe('serialize', () => {

  test('le résultat est une chaîne', () => {
    const csv = serialize(makeReport());
    expect(typeof csv).toBe('string');
  });

  test('commence par \\uFEFF (BOM) par défaut', () => {
    const csv = serialize(makeReport());
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  test('commence exactement par \\uFEFFDéclarant;Date;Durée;Projet;Tâche\\r\\n', () => {
    const csv = serialize(makeReport());
    expect(csv.startsWith('\uFEFFDéclarant;Date;Durée;Projet;Tâche\r\n')).toBe(true);
  });

  test('utilise ; comme séparateur', () => {
    const csv = serialize(makeReport(), { includeBom: false });
    const lines = csv.split('\r\n').filter(l => l.length > 0);
    lines.forEach(line => {
      const fields = line.split(';');
      expect(fields.length).toBe(5);
    });
  });

  test('utilise uniquement \\r\\n comme fin de ligne', () => {
    const csv = serialize(makeReport());
    expect(csv).toContain('\r\n');
    const withoutCrlf = csv.replace(/\r\n/g, '');
    expect(withoutCrlf).not.toContain('\r');
    expect(withoutCrlf).not.toContain('\n');
  });

  test('se termine par \\r\\n', () => {
    const csv = serialize(makeReport());
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  test('contient les trois lignes métier', () => {
    const csv = serialize(makeReport(), { includeBom: false });
    const lines = csv.split('\r\n').filter(l => l.length > 0);
    expect(lines.length).toBe(4);
  });

  test('conserve l ordre Bob puis Alice', () => {
    const csv = serialize(makeReport(), { includeBom: false });
    const lines = csv.split('\r\n').filter(l => l.length > 0);
    expect(lines[1]).toContain('Bob Martin');
    expect(lines[2]).toContain('Bob Martin');
    expect(lines[3]).toContain('Alice Durand');
  });

  test('option includeBom: false supprime le BOM', () => {
    const csv = serialize(makeReport(), { includeBom: false });
    expect(csv.charCodeAt(0)).not.toBe(0xFEFF);
    expect(csv[0]).toBe('D');
  });

  test('l option reçue n est pas modifiée', () => {
    const options = { includeBom: true };
    const optionsCopy = { ...options };
    serialize(makeReport(), options);
    expect(options).toEqual(optionsCopy);
  });
});

// ============================================================================
// SÉRIALISATION DES CAS D ÉCHAPPEMENT
// ============================================================================

describe('Sérialisation des cas d échappement', () => {

  test('Projet; Beta est correctement échappé', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        rows: [{
          dateIso: '2026-01-01',
          durationMinutes: 60,
          personId: 1,
          personName: 'Test',
          taskId: 1,
          taskName: 'Tâche',
          projectId: 1,
          projectName: 'Projet; Beta',
          programmeId: 1,
          programmeName: 'Programme'
        }]
      }]
    });
    const csv = serialize(report, { includeBom: false });
    expect(csv).toContain('"Projet; Beta"');
  });

  test('Recette "finale" est correctement échappé', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        rows: [{
          dateIso: '2026-01-01',
          durationMinutes: 60,
          personId: 1,
          personName: 'Test',
          taskId: 1,
          taskName: 'Recette "finale"',
          projectId: 1,
          projectName: 'Projet',
          programmeId: 1,
          programmeName: 'Programme'
        }]
      }]
    });
    const csv = serialize(report, { includeBom: false });
    expect(csv).toContain('"Recette ""finale"""');
  });

  test('tâche avec retour à la ligne', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        rows: [{
          dateIso: '2026-01-01',
          durationMinutes: 60,
          personId: 1,
          personName: 'Test',
          taskId: 1,
          taskName: 'Tâche\navec retour',
          projectId: 1,
          projectName: 'Projet',
          programmeId: 1,
          programmeName: 'Programme'
        }]
      }]
    });
    const csv = serialize(report, { includeBom: false });
    expect(csv).toContain('"Tâche\navec retour"');
  });

  test('nom avec accent', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Côté Accent',
        rows: [{
          dateIso: '2026-01-01',
          durationMinutes: 60,
          personId: 1,
          personName: 'Côté Accent',
          taskId: 1,
          taskName: 'Tâche',
          projectId: 1,
          projectName: 'Projet',
          programmeId: 1,
          programmeName: 'Programme'
        }]
      }]
    });
    const csv = serialize(report, { includeBom: false });
    expect(csv).toContain('Côté Accent');
  });

  test('texte protégé contre les formules', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: '=FORMULE',
        rows: [{
          dateIso: '2026-01-01',
          durationMinutes: 60,
          personId: 1,
          personName: '=FORMULE',
          taskId: 1,
          taskName: '@TACHE',
          projectId: 1,
          projectName: '+PROJET',
          programmeId: 1,
          programmeName: 'Programme'
        }]
      }]
    });
    const csv = serialize(report, { includeBom: false });
    expect(csv).toContain("'=FORMULE");
    expect(csv).toContain("'+PROJET");
    expect(csv).toContain("'@TACHE");
  });
});

// ============================================================================
// ABSENCE DE DONNÉES NON ATTENDUES
// ============================================================================

describe('Absence de données non attendues', () => {

  test('le CSV ne contient pas Programme Alpha', () => {
    const csv = serialize(makeReport(), { includeBom: false });
    expect(csv).not.toContain('Programme Alpha');
  });

  test('le CSV ne contient pas Programme Beta', () => {
    const csv = serialize(makeReport(), { includeBom: false });
    expect(csv).not.toContain('Programme Beta');
  });

  test('le CSV ne contient pas programmeId', () => {
    const csv = serialize(makeReport(), { includeBom: false });
    expect(csv).not.toContain('programmeId');
  });

  test('le CSV ne contient pas personId', () => {
    const csv = serialize(makeReport(), { includeBom: false });
    expect(csv).not.toContain('personId');
  });

  test('le CSV ne contient pas projectId', () => {
    const csv = serialize(makeReport(), { includeBom: false });
    expect(csv).not.toContain('projectId');
  });

  test('le CSV ne contient pas taskId', () => {
    const csv = serialize(makeReport(), { includeBom: false });
    expect(csv).not.toContain('taskId');
  });

  test('le CSV ne contient pas les diagnostics', () => {
    const csv = serialize(makeReport(), { includeBom: false });
    expect(csv).not.toContain('skippedOutsidePeriod');
    expect(csv).not.toContain('skippedOutsideScope');
  });

  test('le CSV ne contient pas Total global', () => {
    const csv = serialize(makeReport(), { includeBom: false });
    expect(csv).not.toContain('Total global');
  });

  test('le CSV ne contient pas Lucca', () => {
    const csv = serialize(makeReport(), { includeBom: false });
    expect(csv.toLowerCase()).not.toContain('lucca');
  });

  test('le CSV ne contient pas Signature', () => {
    const csv = serialize(makeReport(), { includeBom: false });
    expect(csv).not.toContain('Signature');
  });

  test('le CSV ne contient pas de ligne de total par personne', () => {
    const csv = serialize(makeReport(), { includeBom: false });
    expect(csv).not.toContain('Total :');
  });
});

// ============================================================================
// buildFilename
// ============================================================================

describe('buildFilename', () => {

  test('nom par défaut', () => {
    const filename = buildFilename(makeReport());
    expect(filename).toBe('feuilles-de-temps_2026-01-01_2026-01-31.csv');
  });

  test('période annuelle', () => {
    const report = makeReport({ period: { startDateIso: '2026-01-01', endDateIso: '2026-12-31' } });
    const filename = buildFilename(report);
    expect(filename).toBe('feuilles-de-temps_2026-01-01_2026-12-31.csv');
  });

  test('nom personnalisé sans extension', () => {
    const filename = buildFilename(makeReport(), { filename: 'mon-export' });
    expect(filename).toBe('mon-export.csv');
  });

  test('nom personnalisé avec .csv', () => {
    const filename = buildFilename(makeReport(), { filename: 'test.csv' });
    expect(filename).toBe('test.csv');
  });

  test('nom personnalisé avec .CSV', () => {
    const filename = buildFilename(makeReport(), { filename: 'test.CSV' });
    expect(filename).toBe('test.CSV');
  });

  test('une seule extension conservée', () => {
    const filename = buildFilename(makeReport(), { filename: 'test.csv.csv' });
    expect(filename).toBe('test.csv');
  });

  test('nettoyage de \\\\ / : * ? " < > |', () => {
    const filename = buildFilename(makeReport(), { filename: 'test\\/:*?"<>|file' });
    expect(filename).toBe('test_________file.csv');
  });

  test('nom personnalisé vide', () => {
    expect(() => buildFilename(makeReport(), { filename: '' })).toThrow('CraExportCsv:');
  });

  test('nom personnalisé uniquement composé d espaces', () => {
    expect(() => buildFilename(makeReport(), { filename: '   ' })).toThrow('CraExportCsv:');
  });

  test('nom personnalisé non chaîne', () => {
    expect(() => buildFilename(makeReport(), { filename: 123 })).toThrow('CraExportCsv:');
  });

  test('options absentes', () => {
    const filename = buildFilename(makeReport(), null);
    expect(filename).toBe('feuilles-de-temps_2026-01-01_2026-01-31.csv');
  });

  test('période absente', () => {
    const report = makeReport();
    delete report.period;
    expect(() => buildFilename(report)).toThrow('CraExportCsv:');
  });

  test('date civile invalide', () => {
    const report = makeReport({ period: { startDateIso: '2026-02-30', endDateIso: '2026-03-01' } });
    expect(() => buildFilename(report)).toThrow('CraExportCsv:');
  });

  test('période inversée', () => {
    const report = makeReport({ period: { startDateIso: '2026-01-31', endDateIso: '2026-01-01' } });
    expect(() => buildFilename(report)).toThrow('CraExportCsv:');
  });

  test('options non modifiées', () => {
    const options = { filename: 'original' };
    const optionsCopy = { ...options };
    buildFilename(makeReport(), options);
    expect(options).toEqual(optionsCopy);
  });

  test('le nom par défaut ne contient pas le nom d une personne', () => {
    const filename = buildFilename(makeReport());
    expect(filename).not.toContain('Bob');
    expect(filename).not.toContain('Alice');
  });

  test('le nom par défaut ne contient pas l heure actuelle', () => {
    const filename = buildFilename(makeReport());
    expect(filename).not.toMatch(/\d{2}h\d{2}/);
  });

  test('le nom par défaut ne contient pas la date actuelle ajoutée artificiellement', () => {
    const filename = buildFilename(makeReport());
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    expect(filename).not.toContain(todayStr);
  });

  test('le nom par défaut ne contient pas le mot Lucca', () => {
    const filename = buildFilename(makeReport());
    expect(filename.toLowerCase()).not.toContain('lucca');
  });
});

// ============================================================================
// resolveBrowserDependencies
// ============================================================================

describe('resolveBrowserDependencies', () => {

  test('dépendances injectées valides', () => {
    const fake = createFakeBrowser();
    const deps = resolveBrowserDependencies({ browser: fake });
    expect(deps.Blob).toBe(fake.Blob);
    expect(deps.document).toBe(fake.document);
    expect(deps.URL).toBe(fake.URL);
  });

  test('les objets injectés sont retournés tels quels', () => {
    const fake = createFakeBrowser();
    const deps = resolveBrowserDependencies({ browser: fake });
    expect(deps.Blob).toBe(fake.Blob);
    expect(deps.document).toBe(fake.document);
    expect(deps.URL).toBe(fake.URL);
  });

  test('les dépendances injectées sont prioritaires sur les globales', () => {
    const fake = createFakeBrowser();
    const OriginalBlob = globalThis.Blob;
    const OriginalDocument = globalThis.document;
    const OriginalURL = globalThis.URL;

    try {
      globalThis.Blob = class DifferentBlob {};
      globalThis.document = { different: true };
      globalThis.URL = { different: true };

      const deps = resolveBrowserDependencies({ browser: fake });
      expect(deps.Blob).toBe(fake.Blob);
      expect(deps.document).toBe(fake.document);
      expect(deps.URL).toBe(fake.URL);
    } finally {
      globalThis.Blob = OriginalBlob;
      globalThis.document = OriginalDocument;
      globalThis.URL = OriginalURL;
    }
  });

  test('repli sur les objets globalThis', () => {
    const OriginalBlob = globalThis.Blob;
    const OriginalDocument = globalThis.document;
    const OriginalURL = globalThis.URL;

    try {
      // Créer des mocks au lieu de supprimer
      globalThis.Blob = class FakeBlob {};
      globalThis.document = { body: {} };
      globalThis.URL = { createObjectURL: () => {}, revokeObjectURL: () => {} };

      const deps = resolveBrowserDependencies({});
      expect(deps.Blob).toBe(globalThis.Blob);
      expect(deps.document).toBe(globalThis.document);
      expect(deps.URL).toBe(globalThis.URL);
    } finally {
      globalThis.Blob = OriginalBlob;
      globalThis.document = OriginalDocument;
      globalThis.URL = OriginalURL;
    }
  });

  test('Blob absent', () => {
    const OriginalBlob = globalThis.Blob;
    const OriginalDocument = globalThis.document;
    const OriginalURL = globalThis.URL;

    try {
      // Remplacer par undefined au lieu de supprimer
      globalThis.Blob = undefined;
      globalThis.document = undefined;
      globalThis.URL = undefined;

      expect(() => resolveBrowserDependencies({})).toThrow('CraExportCsv:');
    } finally {
      globalThis.Blob = OriginalBlob;
      globalThis.document = OriginalDocument;
      globalThis.URL = OriginalURL;
    }
  });

  test('document absent', () => {
    const OriginalBlob = globalThis.Blob;
    const OriginalDocument = globalThis.document;
    const OriginalURL = globalThis.URL;

    try {
      globalThis.Blob = class FakeBlob {};
      globalThis.document = undefined;
      globalThis.URL = undefined;

      expect(() => resolveBrowserDependencies({})).toThrow('CraExportCsv:');
    } finally {
      globalThis.Blob = OriginalBlob;
      globalThis.document = OriginalDocument;
      globalThis.URL = OriginalURL;
    }
  });

  test('URL absente', () => {
    const OriginalBlob = globalThis.Blob;
    const OriginalDocument = globalThis.document;
    const OriginalURL = globalThis.URL;

    try {
      globalThis.Blob = class FakeBlob {};
      globalThis.document = { body: {} };
      globalThis.URL = undefined;

      expect(() => resolveBrowserDependencies({})).toThrow('CraExportCsv:');
    } finally {
      globalThis.Blob = OriginalBlob;
      globalThis.document = OriginalDocument;
      globalThis.URL = OriginalURL;
    }
  });

  test('URL.createObjectURL absent', () => {
    const OriginalBlob = globalThis.Blob;
    const OriginalDocument = globalThis.document;
    const OriginalURL = globalThis.URL;

    try {
      globalThis.Blob = class FakeBlob {};
      globalThis.document = { body: {} };
      globalThis.URL = { revokeObjectURL: () => {} };

      expect(() => resolveBrowserDependencies({})).toThrow('CraExportCsv:');
    } finally {
      globalThis.Blob = OriginalBlob;
      globalThis.document = OriginalDocument;
      globalThis.URL = OriginalURL;
    }
  });

  test('URL.revokeObjectURL absent', () => {
    const OriginalBlob = globalThis.Blob;
    const OriginalDocument = globalThis.document;
    const OriginalURL = globalThis.URL;

    try {
      globalThis.Blob = class FakeBlob {};
      globalThis.document = { body: {} };
      globalThis.URL = { createObjectURL: () => {} };

      expect(() => resolveBrowserDependencies({})).toThrow('CraExportCsv:');
    } finally {
      globalThis.Blob = OriginalBlob;
      globalThis.document = OriginalDocument;
      globalThis.URL = OriginalURL;
    }
  });
});

// ============================================================================
// download - SCÉNARIO NOMINAL
// ============================================================================

describe('download', () => {

  test('scénario nominal', () => {
    const fake = createFakeBrowser();
    const report = makeReport();

    const result = download(report, { browser: fake });

    expect(fake.Blob).toHaveBeenCalledTimes(1);
    const blobCall = fake.Blob.mock.calls[0];
    expect(blobCall[0][0]).toContain('Déclarant;Date;Durée;Projet;Tâche');
    expect(blobCall[1]).toEqual({ type: 'text/csv;charset=utf-8' });

    expect(fake.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(fake.document.createElement).toHaveBeenCalledTimes(1);
    expect(fake.document.createElement).toHaveBeenCalledWith('a');

    expect(fake.body.appendChild).toHaveBeenCalledTimes(1);
    expect(fake.anchor.href).toBe('blob:fake');
    expect(fake.anchor.download).toContain('feuilles-de-temps');
    expect(fake.anchor.click).toHaveBeenCalledTimes(1);
    expect(fake.body.removeChild).toHaveBeenCalledTimes(1);
    expect(fake.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(fake.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');

    expect(result.filename).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.blob).toBeDefined();
  });

  test('nom personnalisé', () => {
    const fake = createFakeBrowser();
    const report = makeReport();

    download(report, { browser: fake, filename: 'custom-name' });

    expect(fake.anchor.download).toBe('custom-name.csv');
  });
});

// ============================================================================
// ORDRE DU NETTOYAGE
// ============================================================================

describe('Ordre du nettoyage', () => {

  test('ordre nominal : append, click, remove, revoke', () => {
    const fake = createFakeBrowser();
    const events = [];

    fake.body.appendChild.mockImplementation(() => {
      events.push('append');
    });

    fake.anchor.click.mockImplementation(() => {
      events.push('click');
    });

    fake.body.removeChild.mockImplementation(() => {
      events.push('remove');
    });

    fake.URL.revokeObjectURL.mockImplementation(() => {
      events.push('revoke');
    });

    download(makeReport(), { browser: fake });

    expect(events).toEqual(['append', 'click', 'remove', 'revoke']);
  });

  test('un lien ajouté est retiré avant la révocation de l URL', () => {
    const fake = createFakeBrowser();
    let removeCalled = false;
    let revokeCalledAfterRemove = false;

    fake.body.removeChild.mockImplementation(() => {
      removeCalled = true;
    });

    fake.URL.revokeObjectURL.mockImplementation(() => {
      if (removeCalled) {
        revokeCalledAfterRemove = true;
      }
    });

    download(makeReport(), { browser: fake });

    expect(revokeCalledAfterRemove).toBe(true);
  });

  test('la révocation reste garantie', () => {
    const fake = createFakeBrowser();
    download(makeReport(), { browser: fake });
    expect(fake.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// TESTS D ÉCHEC ET DE NETTOYAGE
// ============================================================================

describe('Tests d échec et de nettoyage', () => {

  test('document.createElement() échoue', () => {
    const fake = createFakeBrowser();
    fake.document.createElement.mockImplementation(() => {
      throw new Error('createElement failed');
    });

    expect(() => download(makeReport(), { browser: fake })).toThrow('createElement failed');
    expect(fake.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(fake.body.removeChild).not.toHaveBeenCalled();
  });

  test('appendChild() échoue', () => {
    const fake = createFakeBrowser();
    fake.body.appendChild.mockImplementation(() => {
      throw new Error('appendChild failed');
    });

    expect(() => download(makeReport(), { browser: fake })).toThrow('appendChild failed');
    expect(fake.anchor.click).not.toHaveBeenCalled();
    expect(fake.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  test('anchor.click() échoue', () => {
    const fake = createFakeBrowser();
    fake.anchor.click.mockImplementation(() => {
      throw new Error('click failed');
    });

    expect(() => download(makeReport(), { browser: fake })).toThrow('click failed');
    expect(fake.body.removeChild).toHaveBeenCalledTimes(1);
    expect(fake.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  test('removeChild() échoue', () => {
    const fake = createFakeBrowser();
    fake.body.removeChild.mockImplementation(() => {
      throw new Error('removeChild failed');
    });

    expect(() => download(makeReport(), { browser: fake })).not.toThrow();
    expect(fake.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  test('revokeObjectURL() échoue', () => {
    const fake = createFakeBrowser();
    fake.URL.revokeObjectURL.mockImplementation(() => {
      throw new Error('revokeObjectURL failed');
    });

    expect(() => download(makeReport(), { browser: fake })).toThrow('revokeObjectURL failed');
    expect(fake.body.removeChild).toHaveBeenCalledTimes(1);
  });

  test('appendChild() ne renseigne pas anchor.parentNode', () => {
    const fake = createFakeBrowser();
    fake.body.appendChild.mockImplementation(() => {});

    download(makeReport(), { browser: fake });

    // Le module a ajouté le lien (wasAdded = true), donc removeChild est appelé
    // même si parentNode n'a pas été renseigné par le faux DOM
    expect(fake.body.removeChild).toHaveBeenCalledTimes(1);
    expect(fake.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// LIEN DÉJÀ ATTACHÉ
// ============================================================================

describe('Lien déjà attaché', () => {

  test('lien avec parentNode existant', () => {
    const fake = createFakeBrowser();
    fake.anchor.parentNode = fake.body;

    download(makeReport(), { browser: fake });

    expect(fake.body.appendChild).not.toHaveBeenCalled();
    expect(fake.body.removeChild).not.toHaveBeenCalled();
    expect(fake.anchor.click).toHaveBeenCalledTimes(1);
    expect(fake.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// TESTS DES ERREURS DE HAUT NIVEAU
// ============================================================================

describe('Tests des erreurs de haut niveau', () => {

  test('createRows(null) lève une erreur', () => {
    expect(() => createRows(null)).toThrow('CraExportCsv:');
  });

  test('serialize(null) lève une erreur', () => {
    expect(() => serialize(null)).toThrow('CraExportCsv:');
  });

  test('download(null, ...) lève une erreur', () => {
    const fake = createFakeBrowser();
    expect(() => download(null, { browser: fake })).toThrow('CraExportCsv:');
  });

  test('download(validReport) sans environnement navigateur lève une erreur', () => {
    const OriginalBlob = globalThis.Blob;
    const OriginalDocument = globalThis.document;
    const OriginalURL = globalThis.URL;

    try {
      globalThis.Blob = undefined;
      globalThis.document = undefined;
      globalThis.URL = undefined;

      expect(() => download(makeReport(), {})).toThrow('CraExportCsv:');
    } finally {
      globalThis.Blob = OriginalBlob;
      globalThis.document = OriginalDocument;
      globalThis.URL = OriginalURL;
    }
  });

  test('un rapport vide est refusé avant la création du Blob', () => {
    const fake = createFakeBrowser();
    const report = makeReport({ persons: [] });

    expect(() => download(report, { browser: fake })).toThrow('CraExportCsv:');
    expect(fake.Blob).not.toHaveBeenCalled();
  });

  test('une durée invalide est refusée avant le téléchargement', () => {
    const fake = createFakeBrowser();
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        rows: [{ dateIso: '2026-01-01', durationMinutes: -1, personId: 1, personName: 'Test', taskId: 1, taskName: 'Tâche', projectId: 1, projectName: 'Projet', programmeId: 1, programmeName: 'Programme' }]
      }]
    });

    expect(() => download(report, { browser: fake })).toThrow('CraExportCsv:');
    expect(fake.Blob).not.toHaveBeenCalled();
  });
});

// ============================================================================
// CRA Export CSV - Immutabilité
// ============================================================================

describe('CRA Export CSV - Immutabilité', () => {

  test('le rapport est inchangé après validateReport', () => {
    const report = makeReport();
    const reportCopy = JSON.parse(JSON.stringify(report));
    validateReport(report);
    expect(report).toEqual(reportCopy);
  });

  test('le rapport est inchangé après createRows', () => {
    const report = makeReport();
    const reportCopy = JSON.parse(JSON.stringify(report));
    createRows(report);
    expect(report).toEqual(reportCopy);
  });

  test('le rapport est inchangé après serialize', () => {
    const report = makeReport();
    const reportCopy = JSON.parse(JSON.stringify(report));
    serialize(report);
    expect(report).toEqual(reportCopy);
  });

  test('le rapport est inchangé après buildFilename', () => {
    const report = makeReport();
    const reportCopy = JSON.parse(JSON.stringify(report));
    buildFilename(report);
    expect(report).toEqual(reportCopy);
  });

  test('le rapport est inchangé après download', () => {
    const fake = createFakeBrowser();
    const report = makeReport();
    const reportCopy = JSON.parse(JSON.stringify(report));
    download(report, { browser: fake });
    expect(report).toEqual(reportCopy);
  });

  test('l ordre des personnes est inchangé', () => {
    const report = makeReport();
    const originalOrder = report.persons.map(p => p.id);
    createRows(report);
    expect(report.persons.map(p => p.id)).toEqual(originalOrder);
  });

  test('l ordre des lignes est inchangé', () => {
    const report = makeReport();
    const originalOrder = report.persons[0].rows.map(r => r.dateIso);
    createRows(report);
    expect(report.persons[0].rows.map(r => r.dateIso)).toEqual(originalOrder);
  });

  test('aucun champ de durée n a été remplacé', () => {
    const report = makeReport();
    const originalDurations = report.persons.map(p => p.rows.map(r => r.durationMinutes));
    createRows(report);
    expect(report.persons.map(p => p.rows.map(r => r.durationMinutes))).toEqual(originalDurations);
  });

  test('aucun nom n a été préfixé directement dans le rapport', () => {
    const report = makeReport();
    const originalNames = report.persons.map(p => p.name);
    createRows(report);
    expect(report.persons.map(p => p.name)).toEqual(originalNames);
  });

  test('aucune propriété de téléchargement n a été ajoutée aux données', () => {
    const report = makeReport();
    const fake = createFakeBrowser();
    download(report, { browser: fake });
    expect(report.filename).toBeUndefined();
    expect(report.content).toBeUndefined();
    expect(report.blob).toBeUndefined();
  });

  test('les options sont inchangées', () => {
    const options = { includeBom: true, filename: 'test' };
    const optionsCopy = JSON.parse(JSON.stringify(options));
    serialize(makeReport(), options);
    buildFilename(makeReport(), options);
    expect(options).toEqual(optionsCopy);
  });
});
