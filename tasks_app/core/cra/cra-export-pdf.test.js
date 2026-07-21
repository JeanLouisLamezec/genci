/**
 * Tests unitaires pour CRA Export PDF
 * 
 * Cette suite de tests verrouille le contrat fonctionnel du générateur PDF
 * pour les feuilles de temps CRA.
 * 
 * Usage: npm test -- cra-export-pdf.test.js --runInBand
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CraExportPdf = require('./cra-export-pdf.js');

const {
  createDocumentDefinition,
  createPdf,
  download,
  buildFilename,
  formatDateIso,
  formatDurationMinutes,
  validateReport,
  resolvePdfMake
} = CraExportPdf;

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
    report.period = { ...report.period, ...overrides.period };
  }

  if (overrides.persons !== undefined) {
    report.persons = overrides.persons;
  }

  if (overrides.totals) {
    report.totals = { ...report.totals, ...overrides.totals };
  }

  if (overrides.diagnostics) {
    report.diagnostics = { ...report.diagnostics, ...overrides.diagnostics };
  }

  return report;
}

function collectTexts(value, result = []) {
  if (typeof value === 'string') {
    result.push(value);
    return result;
  }

  if (Array.isArray(value)) {
    value.forEach(item => collectTexts(item, result));
    return result;
  }

  if (value && typeof value === 'object') {
    Object.values(value)
      .forEach(item => collectTexts(item, result));
  }

  return result;
}

function createFakePdfMake() {
  const calls = [];

  const document = {
    download: jest.fn()
  };

  const pdfMake = {
    createPdf: jest.fn(definition => {
      calls.push(definition);
      return document;
    })
  };

  return {
    pdfMake,
    document,
    calls
  };
}

// ============================================================================
// EXPORTS DU MODULE
// ============================================================================

describe('CRA Export PDF - Exports', () => {

  test('CommonJS expose les fonctions requises', () => {
    expect(typeof createDocumentDefinition).toBe('function');
    expect(typeof createPdf).toBe('function');
    expect(typeof download).toBe('function');
    expect(typeof buildFilename).toBe('function');
    expect(typeof formatDateIso).toBe('function');
    expect(typeof formatDurationMinutes).toBe('function');
    expect(typeof validateReport).toBe('function');
    expect(typeof resolvePdfMake).toBe('function');
  });

  test('Export navigateur avec vm', () => {
    const pdfPath = path.resolve(__dirname, 'cra-export-pdf.js');
    const pdfCode = fs.readFileSync(pdfPath, 'utf-8');

    const sandbox = {
      globalThis: {},
      module: undefined,
      exports: undefined,
      require: undefined
    };

    vm.runInNewContext(pdfCode, sandbox);

    expect(sandbox.globalThis.CraExportPdf).toBeDefined();
    expect(typeof sandbox.globalThis.CraExportPdf.createDocumentDefinition).toBe('function');
    expect(typeof sandbox.globalThis.CraExportPdf.createPdf).toBe('function');
    expect(typeof sandbox.globalThis.CraExportPdf.download).toBe('function');
    expect(typeof sandbox.globalThis.CraExportPdf.buildFilename).toBe('function');
    expect(typeof sandbox.globalThis.CraExportPdf.formatDateIso).toBe('function');
    expect(typeof sandbox.globalThis.CraExportPdf.formatDurationMinutes).toBe('function');
    expect(typeof sandbox.globalThis.CraExportPdf.validateReport).toBe('function');
    expect(typeof sandbox.globalThis.CraExportPdf.resolvePdfMake).toBe('function');
  });

  test('Export navigateur réussit sans pdfmake, DOM, Grist ou CRAController', () => {
    const pdfPath = path.resolve(__dirname, 'cra-export-pdf.js');
    const pdfCode = fs.readFileSync(pdfPath, 'utf-8');

    const sandbox = {
      globalThis: {},
      module: undefined,
      exports: undefined,
      require: undefined,
      document: undefined,
      grist: undefined,
      CRAController: undefined
    };

    expect(() => {
      vm.runInNewContext(pdfCode, sandbox);
    }).not.toThrow();

    expect(sandbox.globalThis.CraExportPdf).toBeDefined();
  });
});

// ============================================================================
// validateReport
// ============================================================================

describe('validateReport', () => {

  test('rapport valide', () => {
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

  test('period absent', () => {
    const report = makeReport();
    delete report.period;
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('period');
  });

  test('startDateIso absent', () => {
    const report = makeReport({ period: { startDateIso: null, endDateIso: '2026-01-31' } });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('startDateIso');
  });

  test('endDateIso absent', () => {
    const report = makeReport({ period: { startDateIso: '2026-01-01', endDateIso: null } });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('endDateIso');
  });

  test('format de date invalide', () => {
    const report = makeReport({ period: { startDateIso: '01/01/2026', endDateIso: '2026-01-31' } });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('startDateIso');
  });

  test('date civile impossible', () => {
    const report = makeReport({ period: { startDateIso: '2026-02-30', endDateIso: '2026-03-01' } });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
  });

  test('début après la fin', () => {
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

  test('durée non numérique', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        totalMinutes: 100,
        rows: [{ dateIso: '2026-01-01', durationMinutes: 'abc', personId: 1 }]
      }]
    });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('durationMinutes');
  });

  test('durée infinie', () => {
    const report = makeReport({
      persons: [{
        id: 1,
        name: 'Test',
        totalMinutes: 100,
        rows: [{ dateIso: '2026-01-01', durationMinutes: Infinity, personId: 1 }]
      }]
    });
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('durationMinutes');
  });
});

// ============================================================================
// formatDateIso
// ============================================================================

describe('formatDateIso', () => {

  test('2026-01-05 → 05/01/2026', () => {
    expect(formatDateIso('2026-01-05')).toBe('05/01/2026');
  });

  test('2026-12-31 → 31/12/2026', () => {
    expect(formatDateIso('2026-12-31')).toBe('31/12/2026');
  });

  test('2024-02-29 → 29/02/2024', () => {
    expect(formatDateIso('2024-02-29')).toBe('29/02/2024');
  });

  test('mauvais format', () => {
    expect(() => formatDateIso('01/01/2026')).toThrow(/invalide/);
  });

  test('mois invalide', () => {
    expect(() => formatDateIso('2026-13-01')).toThrow(/invalide/);
  });

  test('jour invalide', () => {
    expect(() => formatDateIso('2026-02-30')).toThrow(/invalide/);
  });

  test('valeur null', () => {
    expect(() => formatDateIso(null)).toThrow(/invalide/);
  });

  test('valeur non chaîne', () => {
    expect(() => formatDateIso(123)).toThrow(/invalide/);
  });

  test('indépendant du fuseau horaire', () => {
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      const resultNy = formatDateIso('2026-01-15');

      process.env.TZ = 'Asia/Tokyo';
      const resultTokyo = formatDateIso('2026-01-15');

      expect(resultNy).toBe('15/01/2026');
      expect(resultTokyo).toBe('15/01/2026');
    } finally {
      process.env.TZ = originalTz;
    }
  });
});

// ============================================================================
// formatDurationMinutes
// ============================================================================

describe('formatDurationMinutes', () => {

  test('0 → 0h', () => {
    expect(formatDurationMinutes(0)).toBe('0h');
  });

  test('1 → 0h01', () => {
    expect(formatDurationMinutes(1)).toBe('0h01');
  });

  test('30 → 0h30', () => {
    expect(formatDurationMinutes(30)).toBe('0h30');
  });

  test('59 → 0h59', () => {
    expect(formatDurationMinutes(59)).toBe('0h59');
  });

  test('60 → 1h', () => {
    expect(formatDurationMinutes(60)).toBe('1h');
  });

  test('61 → 1h01', () => {
    expect(formatDurationMinutes(61)).toBe('1h01');
  });

  test('90 → 1h30', () => {
    expect(formatDurationMinutes(90)).toBe('1h30');
  });

  test('420 → 7h', () => {
    expect(formatDurationMinutes(420)).toBe('7h');
  });

  test('435 → 7h15', () => {
    expect(formatDurationMinutes(435)).toBe('7h15');
  });

  test('660 → 11h', () => {
    expect(formatDurationMinutes(660)).toBe('11h');
  });

  test('nombre décimal arrondi', () => {
    expect(formatDurationMinutes(60.4)).toBe('1h');
    expect(formatDurationMinutes(60.5)).toBe('1h01');
    expect(formatDurationMinutes(60.6)).toBe('1h01');
  });

  test('chaîne numérique', () => {
    expect(formatDurationMinutes('60')).toBe('1h');
  });

  test('valeur négative', () => {
    expect(() => formatDurationMinutes(-1)).toThrow(/négative/);
  });

  test('NaN', () => {
    expect(() => formatDurationMinutes(NaN)).toThrow(/invalide/);
  });

  test('Infinity', () => {
    expect(() => formatDurationMinutes(Infinity)).toThrow(/invalide/);
  });

  test('null', () => {
    expect(() => formatDurationMinutes(null)).toThrow(/invalide/);
  });

  test('chaîne non numérique', () => {
    expect(() => formatDurationMinutes('abc')).toThrow(/invalide/);
  });
});

// ============================================================================
// buildFilename
// ============================================================================

describe('buildFilename', () => {

  test('nom par défaut', () => {
    const report = makeReport();
    const result = buildFilename(report, {});
    expect(result).toBe('feuilles-de-temps_2026-01-01_2026-01-31.pdf');
  });

  test('période annuelle', () => {
    const report = makeReport({ period: { startDateIso: '2026-01-01', endDateIso: '2026-12-31' } });
    const result = buildFilename(report, {});
    expect(result).toBe('feuilles-de-temps_2026-01-01_2026-12-31.pdf');
  });

  test('options.filename personnalisé', () => {
    const report = makeReport();
    const result = buildFilename(report, { filename: 'mon-export' });
    expect(result).toBe('mon-export.pdf');
  });

  test('ajout automatique de .pdf', () => {
    const report = makeReport();
    const result = buildFilename(report, { filename: 'test' });
    expect(result).toBe('test.pdf');
  });

  test('conservation d une seule extension .pdf', () => {
    const report = makeReport();
    const result1 = buildFilename(report, { filename: 'test.pdf' });
    const result2 = buildFilename(report, { filename: 'test.PDF' });
    expect(result1).toBe('test.pdf');
    expect(result2).toBe('test.PDF');
  });

  test('nettoyage des caractères interdits', () => {
    const report = makeReport();
    const result = buildFilename(report, { filename: 'test\\/:*?"<>|file' });
    expect(result).toBe('test_________file.pdf');
  });

  test('options absentes', () => {
    const report = makeReport();
    const result = buildFilename(report, null);
    expect(result).toBe('feuilles-de-temps_2026-01-01_2026-01-31.pdf');
  });

  test('objet options non modifié', () => {
    const report = makeReport();
    const options = { filename: 'original' };
    const optionsCopy = JSON.parse(JSON.stringify(options));
    buildFilename(report, options);
    expect(options).toEqual(optionsCopy);
  });

  test('période invalide correctement refusée', () => {
    const report = { period: { startDateIso: null, endDateIso: null } };
    expect(() => buildFilename(report, {})).toThrow(/CraExportPdf:/);
    expect(() => buildFilename(report, {})).toThrow(/période d'export invalide/);
  });

  test('ne contient pas automatiquement le nom d une personne', () => {
    const report = makeReport();
    const result = buildFilename(report, {});
    expect(result).not.toContain('Bob');
    expect(result).not.toContain('Alice');
  });

  test('ne contient pas l heure actuelle', () => {
    const report = makeReport();
    const result = buildFilename(report, {});
    expect(result).not.toMatch(/\d{2}h\d{2}/);
  });

  test('ne contient pas le mot Lucca', () => {
    const report = makeReport();
    const result = buildFilename(report, {});
    expect(result.toLowerCase()).not.toContain('lucca');
  });
});

// ============================================================================
// createDocumentDefinition
// ============================================================================

describe('createDocumentDefinition', () => {

  test('configuration générale', () => {
    const report = makeReport();
    const definition = createDocumentDefinition(report);

    expect(definition.pageSize).toBe('A4');
    expect(definition.pageOrientation).toBe('portrait');
    expect(definition.pageMargins).toBeDefined();
    expect(Array.isArray(definition.content)).toBe(true);
    expect(typeof definition.footer).toBe('function');
    expect(typeof definition.styles).toBe('object');
    expect(definition.info.title).toBeDefined();
  });

  test('une seule personne', () => {
    const report = makeReport({
      persons: [baseReport.persons[0]]
    });
    const definition = createDocumentDefinition(report);
    const texts = collectTexts(definition);

    expect(definition.content.length).toBe(1);
    expect(definition.content[0].table.headerRows).toBe(2);
    expect(definition.content[0].table.body.length).toBeGreaterThan(2);

    expect(texts).toContain('Bob Martin');
    expect(texts).toContain('Période : 01/01/2026 – 31/01/2026');
    expect(texts).toContain('Total : 11h');
    expect(texts).toContain('Date');
    expect(texts).toContain('Durée');
    expect(texts).toContain('Projet');
    expect(texts).toContain('Tâche');
  });

  test('quatre colonnes', () => {
    const report = makeReport({
      persons: [baseReport.persons[0]]
    });
    const definition = createDocumentDefinition(report);
    const headerRow2 = definition.content[0].table.body[1];

    expect(headerRow2.length).toBe(4);
    expect(headerRow2[0].text).toBe('Date');
    expect(headerRow2[1].text).toBe('Durée');
    expect(headerRow2[2].text).toBe('Projet');
    expect(headerRow2[3].text).toBe('Tâche');
  });

  test('ne contient pas Programme comme colonne', () => {
    const report = makeReport({
      persons: [baseReport.persons[0]]
    });
    const definition = createDocumentDefinition(report);
    const headerRow2 = definition.content[0].table.body[1];
    const headerTexts = headerRow2.map(cell => cell.text);

    expect(headerTexts).not.toContain('Programme');
  });

  test('ne contient pas Écart comme colonne', () => {
    const report = makeReport({
      persons: [baseReport.persons[0]]
    });
    const definition = createDocumentDefinition(report);
    const headerRow2 = definition.content[0].table.body[1];
    const headerTexts = headerRow2.map(cell => cell.text);

    expect(headerTexts).not.toContain('Écart');
  });

  test('ne contient pas Heures prévues comme colonne', () => {
    const report = makeReport({
      persons: [baseReport.persons[0]]
    });
    const definition = createDocumentDefinition(report);
    const headerRow2 = definition.content[0].table.body[1];
    const headerTexts = headerRow2.map(cell => cell.text);

    expect(headerTexts).not.toContain('Heures prévues');
  });

  test('ne contient pas Signature comme colonne', () => {
    const report = makeReport({
      persons: [baseReport.persons[0]]
    });
    const definition = createDocumentDefinition(report);
    const headerRow2 = definition.content[0].table.body[1];
    const headerTexts = headerRow2.map(cell => cell.text);

    expect(headerTexts).not.toContain('Signature');
  });

  test('chaque ligne d activité apparaît', () => {
    const report = makeReport({
      persons: [baseReport.persons[0]]
    });
    const definition = createDocumentDefinition(report);
    const texts = collectTexts(definition);

    expect(texts).toContain('Projet Alpha');
    expect(texts).toContain('Pilotage');
    expect(texts).toContain('Projet Beta');
    expect(texts).toContain('Recette');
  });
});

// ============================================================================
// ORDRE DES PERSONNES
// ============================================================================

describe('createDocumentDefinition - Ordre des personnes', () => {

  test('Bob précède Alice', () => {
    const report = makeReport();
    const definition = createDocumentDefinition(report);

    const texts = collectTexts(definition.content);
    const bobIndex = texts.findIndex(t => t === 'Bob Martin');
    const aliceIndex = texts.findIndex(t => t === 'Alice Durand');

    expect(bobIndex).toBeLessThan(aliceIndex);
  });

  test('Alice a pageBreak before', () => {
    const report = makeReport();
    const definition = createDocumentDefinition(report);

    expect(definition.content[0].pageBreak).toBeUndefined();
    expect(definition.content[1].pageBreak).toBe('before');
  });

  test('Bob n a pas de pageBreak', () => {
    const report = makeReport();
    const definition = createDocumentDefinition(report);

    expect(definition.content[0].pageBreak).toBeUndefined();
  });
});

// ============================================================================
// SAUTS DE PAGE
// ============================================================================

describe('createDocumentDefinition - Sauts de page', () => {

  test('trois personnes avec sauts', () => {
    const report = makeReport({
      persons: [
        {
          id: 1,
          name: 'Personne 1',
          totalMinutes: 60,
          rows: [{ dateIso: '2026-01-01', durationMinutes: 60, personId: 1, personName: 'Personne 1', taskId: 1, taskName: 'Tâche', projectId: 1, projectName: 'Projet', programmeId: 1, programmeName: 'Programme' }]
        },
        {
          id: 2,
          name: 'Personne 2',
          totalMinutes: 60,
          rows: [{ dateIso: '2026-01-01', durationMinutes: 60, personId: 2, personName: 'Personne 2', taskId: 1, taskName: 'Tâche', projectId: 1, projectName: 'Projet', programmeId: 1, programmeName: 'Programme' }]
        },
        {
          id: 3,
          name: 'Personne 3',
          totalMinutes: 60,
          rows: [{ dateIso: '2026-01-01', durationMinutes: 60, personId: 3, personName: 'Personne 3', taskId: 1, taskName: 'Tâche', projectId: 1, projectName: 'Projet', programmeId: 1, programmeName: 'Programme' }]
        }
      ]
    });

    const definition = createDocumentDefinition(report);

    expect(definition.content.length).toBe(3);
    expect(definition.content[0].pageBreak).toBeUndefined();
    expect(definition.content[1].pageBreak).toBe('before');
    expect(definition.content[2].pageBreak).toBe('before');
  });

  test('chaque personne a son propre tableau', () => {
    const report = makeReport({
      persons: [
        {
          id: 1,
          name: 'Personne 1',
          totalMinutes: 60,
          rows: [{ dateIso: '2026-01-01', durationMinutes: 60, personId: 1, personName: 'Personne 1', taskId: 1, taskName: 'Tâche', projectId: 1, projectName: 'Projet', programmeId: 1, programmeName: 'Programme' }]
        },
        {
          id: 2,
          name: 'Personne 2',
          totalMinutes: 60,
          rows: [{ dateIso: '2026-01-01', durationMinutes: 60, personId: 2, personName: 'Personne 2', taskId: 1, taskName: 'Tâche', projectId: 1, projectName: 'Projet', programmeId: 1, programmeName: 'Programme' }]
        }
      ]
    });

    const definition = createDocumentDefinition(report);

    expect(definition.content[0].table).toBeDefined();
    expect(definition.content[1].table).toBeDefined();
  });
});

// ============================================================================
// EN-TÊTE RÉPÉTÉ
// ============================================================================

describe('createDocumentDefinition - En-tête répété', () => {

  test('headerRows === 2', () => {
    const report = makeReport();
    const definition = createDocumentDefinition(report);

    definition.content.forEach(table => {
      expect(table.table.headerRows).toBe(2);
    });
  });

  test('première ligne contient informations personne', () => {
    const report = makeReport({
      persons: [baseReport.persons[0]]
    });
    const definition = createDocumentDefinition(report);
    const headerRow1 = definition.content[0].table.body[0];

    const texts = collectTexts(headerRow1);
    expect(texts).toContain('FEUILLE DE TEMPS');
    expect(texts).toContain('Bob Martin');
  });

  test('seconde ligne contient titres colonnes', () => {
    const report = makeReport({
      persons: [baseReport.persons[0]]
    });
    const definition = createDocumentDefinition(report);
    const headerRow2 = definition.content[0].table.body[1];

    expect(headerRow2[0].text).toBe('Date');
    expect(headerRow2[1].text).toBe('Durée');
    expect(headerRow2[2].text).toBe('Projet');
    expect(headerRow2[3].text).toBe('Tâche');
  });
});

// ============================================================================
// ORDRE DES LIGNES
// ============================================================================

describe('createDocumentDefinition - Ordre des lignes', () => {

  test('conserve l ordre non trié des lignes', () => {
    const report = makeReport({
      persons: [
        {
          id: 1,
          name: 'Test',
          totalMinutes: 300,
          rows: [
            { dateIso: '2026-01-10', durationMinutes: 100, personId: 1, personName: 'Test', taskId: 3, taskName: 'Z', projectId: 3, projectName: 'Projet Z', programmeId: 1, programmeName: 'P' },
            { dateIso: '2026-01-05', durationMinutes: 100, personId: 1, personName: 'Test', taskId: 1, taskName: 'A', projectId: 1, projectName: 'Projet A', programmeId: 1, programmeName: 'P' },
            { dateIso: '2026-01-08', durationMinutes: 100, personId: 1, personName: 'Test', taskId: 2, taskName: 'B', projectId: 2, projectName: 'Projet B', programmeId: 1, programmeName: 'P' }
          ]
        }
      ]
    });

    const definition = createDocumentDefinition(report);
    const body = definition.content[0].table.body;

    const row1Date = body[2][0].text;
    const row2Date = body[3][0].text;
    const row3Date = body[4][0].text;

    expect(row1Date).toBe('10/01/2026');
    expect(row2Date).toBe('05/01/2026');
    expect(row3Date).toBe('08/01/2026');
  });
});

// ============================================================================
// CELLULES VIDES ET TEXTES LONGS
// ============================================================================

describe('createDocumentDefinition - Cellules vides et textes longs', () => {

  test('ligne avec projectName et taskName vides', () => {
    const report = makeReport({
      persons: [
        {
          id: 1,
          name: 'Test',
          totalMinutes: 60,
          rows: [
            { dateIso: '2026-01-01', durationMinutes: 60, personId: 1, personName: 'Test', taskId: 1, taskName: '', projectId: null, projectName: '', programmeId: null, programmeName: '' }
          ]
        }
      ]
    });

    const definition = createDocumentDefinition(report);
    const body = definition.content[0].table.body;
    const row = body[2];

    expect(row[2].text).toBe('');
    expect(row[3].text).toBe('');
  });

  test('projet et tâche très longs', () => {
    const longProject = 'A'.repeat(200);
    const longTask = 'B'.repeat(200);

    const report = makeReport({
      persons: [
        {
          id: 1,
          name: 'Test',
          totalMinutes: 60,
          rows: [
            { dateIso: '2026-01-01', durationMinutes: 60, personId: 1, personName: 'Test', taskId: 1, taskName: longTask, projectId: 1, projectName: longProject, programmeId: 1, programmeName: 'P' }
          ]
        }
      ]
    });

    const definition = createDocumentDefinition(report);
    const body = definition.content[0].table.body;
    const row = body[2];

    expect(row[2].text).toBe(longProject);
    expect(row[3].text).toBe(longTask);
  });
});

// ============================================================================
// RAPPORT VIDE
// ============================================================================

describe('createDocumentDefinition - Rapport vide', () => {

  test('persons = []', () => {
    const report = makeReport({ persons: [] });

    expect(() => {
      createDocumentDefinition(report);
    }).toThrow(/CraExportPdf:/);
    expect(() => {
      createDocumentDefinition(report);
    }).toThrow(/aucune feuille de temps/);
  });

  test('une personne avec rows = []', () => {
    const report = makeReport({
      persons: [
        {
          id: 1,
          name: 'Test',
          totalMinutes: 0,
          rows: []
        }
      ]
    });

    expect(() => {
      createDocumentDefinition(report);
    }).toThrow(/CraExportPdf:/);
    expect(() => {
      createDocumentDefinition(report);
    }).toThrow(/aucune feuille de temps/);
  });

  test('plusieurs personnes avec tableaux vides', () => {
    const report = makeReport({
      persons: [
        { id: 1, name: 'Test 1', totalMinutes: 0, rows: [] },
        { id: 2, name: 'Test 2', totalMinutes: 0, rows: [] }
      ]
    });

    expect(() => {
      createDocumentDefinition(report);
    }).toThrow(/CraExportPdf:/);
  });
});

// ============================================================================
// PIED DE PAGE
// ============================================================================

describe('createDocumentDefinition - Pied de page', () => {

  test('footer(3, 12) contient les informations attendues', () => {
    const report = makeReport();
    const definition = createDocumentDefinition(report);
    const footer = definition.footer(3, 12);

    const texts = collectTexts(footer);
    expect(texts).toContain('Généré depuis Grist');
    expect(texts).toContain('Page 3 / 12');
  });

  test('footer a deux zones', () => {
    const report = makeReport();
    const definition = createDocumentDefinition(report);
    const footer = definition.footer(3, 12);

    expect(footer.columns).toBeDefined();
    expect(footer.columns.length).toBe(2);
    expect(footer.columns[0].alignment).toBe('left');
    expect(footer.columns[1].alignment).toBe('right');
  });
});

// ============================================================================
// resolvePdfMake
// ============================================================================

describe('resolvePdfMake', () => {

  let originalPdfMake;

  beforeEach(() => {
    originalPdfMake = globalThis.pdfMake;
    delete globalThis.pdfMake;
  });

  afterEach(() => {
    if (originalPdfMake) {
      globalThis.pdfMake = originalPdfMake;
    } else {
      delete globalThis.pdfMake;
    }
  });

  test('moteur injecté avec createPdf est retourné', () => {
    const fake = { createPdf: () => {} };
    const result = resolvePdfMake(fake);
    expect(result).toBe(fake);
  });

  test('moteur injecté prioritaire sur globalThis.pdfMake', () => {
    const injected = { createPdf: () => {} };
    const global = { createPdf: () => {} };
    globalThis.pdfMake = global;

    const result = resolvePdfMake(injected);
    expect(result).toBe(injected);
  });

  test('globalThis.pdfMake utilisé en l absence de candidat', () => {
    const global = { createPdf: () => {} };
    globalThis.pdfMake = global;

    const result = resolvePdfMake(null);
    expect(result).toBe(global);
  });

  test('moteur absent → erreur explicite', () => {
    expect(() => {
      resolvePdfMake(null);
    }).toThrow(/CraExportPdf:/);
    expect(() => {
      resolvePdfMake(null);
    }).toThrow(/pdfmake indisponible/);
  });

  test('objet vide → erreur explicite', () => {
    expect(() => {
      resolvePdfMake({});
    }).toThrow(/CraExportPdf:/);
  });

  test('createPdf non fonctionnel → erreur explicite', () => {
    expect(() => {
      resolvePdfMake({ createPdf: null });
    }).toThrow(/CraExportPdf:/);
  });
});

// ============================================================================
// createPdf
// ============================================================================

describe('createPdf', () => {

  test('appelle pdfMake.createPdf exactement une fois', () => {
    const fake = createFakePdfMake();
    const report = makeReport();

    createPdf(report, { pdfMake: fake.pdfMake });

    expect(fake.pdfMake.createPdf).toHaveBeenCalledTimes(1);
  });

  test('transmet la définition produite', () => {
    const fake = createFakePdfMake();
    const report = makeReport();

    createPdf(report, { pdfMake: fake.pdfMake });

    const definition = fake.calls[0];
    expect(definition.pageSize).toBe('A4');
    expect(definition.pageOrientation).toBe('portrait');
  });

  test('retourne exactement le document retourné par pdfmake', () => {
    const fake = createFakePdfMake();
    const report = makeReport();

    const result = createPdf(report, { pdfMake: fake.pdfMake });

    expect(result).toBe(fake.document);
  });

  test('ne déclenche pas download', () => {
    const fake = createFakePdfMake();
    const report = makeReport();

    createPdf(report, { pdfMake: fake.pdfMake });

    expect(fake.document.download).not.toHaveBeenCalled();
  });

  test('fonctionne avec options.pdfMake', () => {
    const fake = createFakePdfMake();
    const report = makeReport();

    expect(() => {
      createPdf(report, { pdfMake: fake.pdfMake });
    }).not.toThrow();
  });

  test('refuse un rapport invalide', () => {
    const fake = createFakePdfMake();

    expect(() => {
      createPdf(null, { pdfMake: fake.pdfMake });
    }).toThrow(/CraExportPdf:/);
  });

  test('refuse un moteur absent', () => {
    const report = makeReport();
    const originalPdfMake = globalThis.pdfMake;
    delete globalThis.pdfMake;

    try {
      expect(() => {
        createPdf(report, {});
      }).toThrow(/CraExportPdf:/);
    } finally {
      globalThis.pdfMake = originalPdfMake;
    }
  });
});

// ============================================================================
// download
// ============================================================================

describe('download', () => {

  test('appelle createPdf une fois', () => {
    const fake = createFakePdfMake();
    const report = makeReport();

    download(report, { pdfMake: fake.pdfMake });

    expect(fake.pdfMake.createPdf).toHaveBeenCalledTimes(1);
  });

  test('appelle document.download une fois', () => {
    const fake = createFakePdfMake();
    const report = makeReport();

    download(report, { pdfMake: fake.pdfMake });

    expect(fake.document.download).toHaveBeenCalledTimes(1);
  });

  test('utilise le nom de fichier par défaut', () => {
    const fake = createFakePdfMake();
    const report = makeReport();

    download(report, { pdfMake: fake.pdfMake });

    expect(fake.document.download).toHaveBeenCalledWith('feuilles-de-temps_2026-01-01_2026-01-31.pdf');
  });

  test('accepte un nom personnalisé', () => {
    const fake = createFakePdfMake();
    const report = makeReport();

    download(report, { pdfMake: fake.pdfMake, filename: 'custom.pdf' });

    expect(fake.document.download).toHaveBeenCalledWith('custom.pdf');
  });

  test('transmet le nom nettoyé', () => {
    const fake = createFakePdfMake();
    const report = makeReport();

    download(report, { pdfMake: fake.pdfMake, filename: 'test<>file' });

    expect(fake.document.download).toHaveBeenCalledWith('test__file.pdf');
  });

  test('retourne la structure documentée', () => {
    const fake = createFakePdfMake();
    const report = makeReport();

    const result = download(report, { pdfMake: fake.pdfMake });

    expect(result.filename).toBeDefined();
    expect(result.pdf).toBeDefined();
  });

  test('refuse un document sans download', () => {
    const fakePdfMake = {
      createPdf() {
        return {};
      }
    };
    const report = makeReport();

    expect(() => {
      download(report, { pdfMake: fakePdfMake });
    }).toThrow(/CraExportPdf:/);
    expect(() => {
      download(report, { pdfMake: fakePdfMake });
    }).toThrow(/téléchargement/);
  });
});

// ============================================================================
// IMMUTABILITÉ
// ============================================================================

describe('CRA Export PDF - Immutabilité', () => {

  test('ne modifie pas le rapport source', () => {
    const report = makeReport();
    const reportCopy = JSON.parse(JSON.stringify(report));

    const fake = createFakePdfMake();

    createDocumentDefinition(report);
    buildFilename(report, {});
    createPdf(report, { pdfMake: fake.pdfMake });
    download(report, { pdfMake: fake.pdfMake });

    expect(report).toEqual(reportCopy);
  });

  test('ne modifie pas report.persons', () => {
    const report = makeReport();
    const personsCopy = JSON.parse(JSON.stringify(report.persons));

    const fake = createFakePdfMake();
    createDocumentDefinition(report, { pdfMake: fake.pdfMake });

    expect(report.persons).toEqual(personsCopy);
  });

  test('aucun pageBreak ajouté aux personnes sources', () => {
    const report = makeReport();
    const fake = createFakePdfMake();

    createDocumentDefinition(report, { pdfMake: fake.pdfMake });

    report.persons.forEach(person => {
      expect(person.pageBreak).toBeUndefined();
    });
  });

  test('aucune propriété pdfmake ajoutée aux lignes', () => {
    const report = makeReport();
    const fake = createFakePdfMake();

    createDocumentDefinition(report, { pdfMake: fake.pdfMake });

    report.persons.forEach(person => {
      person.rows.forEach(row => {
        expect(row.border).toBeUndefined();
        expect(row.fillColor).toBeUndefined();
      });
    });
  });

  test('options.filename non modifié', () => {
    const report = makeReport();
    const options = { filename: 'original.pdf' };
    const optionsCopy = { ...options };

    buildFilename(report, options);

    expect(options).toEqual(optionsCopy);
  });
});

// ============================================================================
// ABSENCE DE DONNÉES NON DÉSIRÉES
// ============================================================================

describe('createDocumentDefinition - Absence de données non désirées', () => {

  test('Programme Alpha n apparaît pas', () => {
    const report = makeReport();
    const definition = createDocumentDefinition(report);
    const texts = collectTexts(definition);

    expect(texts).not.toContain('Programme Alpha');
    expect(texts).not.toContain('Programme Beta');
    expect(texts).not.toContain('Programme Gamma');
  });

  test('diagnostics n apparaît pas', () => {
    const report = makeReport();
    const definition = createDocumentDefinition(report);
    const texts = collectTexts(definition);

    expect(texts).not.toContain('skippedOutsidePeriod');
    expect(texts).not.toContain('skippedOutsideScope');
  });

  test('Lucca n apparaît pas', () => {
    const report = makeReport();
    const definition = createDocumentDefinition(report);
    const texts = collectTexts(definition);

    const luccaFound = texts.some(t => t.toLowerCase().includes('lucca'));
    expect(luccaFound).toBe(false);
  });

  test('Signature n apparaît pas', () => {
    const report = makeReport();
    const definition = createDocumentDefinition(report);
    const texts = collectTexts(definition);

    expect(texts).not.toContain('Signature');
  });

  test('Total global n apparaît pas', () => {
    const report = makeReport();
    const definition = createDocumentDefinition(report);
    const texts = collectTexts(definition);

    expect(texts).not.toContain('Total global');
  });

  test('le total de chaque personne apparaît', () => {
    const report = makeReport();
    const definition = createDocumentDefinition(report);
    const texts = collectTexts(definition);

    expect(texts).toContain('Total : 11h');
    expect(texts).toContain('Total : 7h30');
  });
});

// ============================================================================
// ERREURS DES FONCTIONS DE HAUT NIVEAU
// ============================================================================

describe('Erreurs des fonctions de haut niveau', () => {

  test('createDocumentDefinition(null) lève une erreur', () => {
    expect(() => {
      createDocumentDefinition(null);
    }).toThrow(/CraExportPdf:/);
  });

  test('createPdf(null, ...) lève une erreur', () => {
    const fake = createFakePdfMake();
    expect(() => {
      createPdf(null, { pdfMake: fake.pdfMake });
    }).toThrow(/CraExportPdf:/);
  });

  test('download(null, ...) lève une erreur', () => {
    const fake = createFakePdfMake();
    expect(() => {
      download(null, { pdfMake: fake.pdfMake });
    }).toThrow(/CraExportPdf:/);
  });

  test('createPdf(validReport) sans moteur lève une erreur', () => {
    const report = makeReport();
    const originalPdfMake = globalThis.pdfMake;
    delete globalThis.pdfMake;

    try {
      expect(() => {
        createPdf(report, {});
      }).toThrow(/CraExportPdf:/);
    } finally {
      globalThis.pdfMake = originalPdfMake;
    }
  });

  test('download(validReport) sans moteur lève une erreur', () => {
    const report = makeReport();
    const originalPdfMake = globalThis.pdfMake;
    delete globalThis.pdfMake;

    try {
      expect(() => {
        download(report, {});
      }).toThrow(/CraExportPdf:/);
    } finally {
      globalThis.pdfMake = originalPdfMake;
    }
  });
});
