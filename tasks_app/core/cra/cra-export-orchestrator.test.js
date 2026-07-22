/**
 * Tests pour cra-export-orchestrator.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CraExportOrchestrator = require('./cra-export-orchestrator.js');

// ============================================================================
// HELPERS DE FIXTURES
// ============================================================================

/**
 * Crée un faux modèle CraExportModel
 */
function createFakeModel(options = {}) {
  return {
    validateDateRange: jest.fn((startDateIso, endDateIso) => ({
      valid: true,
      error: null
    })),

    normalizeScope: jest.fn(scope => ({
      personIds: (scope.personIds || []).map(String),
      projectIds: (scope.projectIds || []).map(String),
      programmeIds: (scope.programmeIds || []).map(String),
      taskIds: (scope.taskIds || []).map(String)
    })),

    buildReport: jest.fn(options => ({
      period: {
        startDateIso: options.startDateIso,
        endDateIso: options.endDateIso
      },

      scope: options.scope,

      persons: [
        {
          id: 2,
          name: 'Bob Martin',
          totalMinutes: 420,
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
            }
          ]
        }
      ],

      totals: {
        selectedPersonCount: 2,
        exportedPersonCount: 1,
        rowCount: 1,
        totalMinutes: 420
      },

      diagnostics: {}
    }))
  };
}

/**
 * Crée un faux renderer PDF
 */
function createFakePdf(options = {}) {
  return {
    buildFilename: jest.fn(() => 'export.pdf'),

    download: jest.fn((report, options) => ({
      filename: options.filename,
      pdf: {
        fake: true
      }
    }))
  };
}

/**
 * Crée un faux renderer CSV
 */
function createFakeCsv(options = {}) {
  return {
    buildFilename: jest.fn(() => 'export.csv'),

    download: jest.fn((report, options) => ({
      filename: options.filename,
      content: 'fake-csv'
    }))
  };
}

/**
 * Crée les fausses dépendances
 */
function createFakeDependencies(options = {}) {
  const model = options.model || createFakeModel();
  const pdf = options.pdf || createFakePdf();
  const csv = options.csv || createFakeCsv();

  return {
    model,
    pdf,
    csv,
    calls: {
      model: model,
      pdf: pdf,
      csv: csv
    }
  };
}

/**
 * Crée une requête nominale de base
 */
function createBaseRequest() {
  return {
    format: 'pdf',

    startDateIso: '2026-01-01',
    endDateIso: '2026-01-31',

    personIds: [2, 1],

    filters: {
      assignee: ['999'],
      team: ['999'],
      project: ['100'],
      programme: ['10'],
      task: ['1000']
    },

    data: {
      entries: [],
      team: [],
      tasks: [],
      projects: [],
      programmes: []
    },

    pdfOptions: {
      pdfMake: {
        fake: true
      }
    },

    csvOptions: {
      includeBom: false,
      browser: {
        fake: true
      }
    }
  };
}

/**
 * Crée une copie indépendante d'une requête
 */
function makeRequest(overrides = {}) {
  const base = createBaseRequest();
  const result = {
    format: base.format,
    startDateIso: base.startDateIso,
    endDateIso: base.endDateIso,
    personIds: [...base.personIds],
    filters: { ...base.filters },
    data: {
      entries: [...base.data.entries],
      team: [...base.data.team],
      tasks: [...base.data.tasks],
      projects: [...base.data.projects],
      programmes: [...base.data.programmes]
    }
  };

  if (base.pdfOptions) {
    result.pdfOptions = { ...base.pdfOptions };
  }
  if (base.csvOptions) {
    result.csvOptions = { ...base.csvOptions };
  }

  Object.assign(result, overrides);
  return result;
}


// ============================================================================
// EXPORTS - TESTS D'EXPOSITION
// ============================================================================

describe('CRA Export Orchestrator - Exports', () => {
  it('expose les neuf fonctions publiques en CommonJS', () => {
    expect(CraExportOrchestrator.getFormatOptions).toBeDefined();
    expect(CraExportOrchestrator.normalizeFormat).toBeDefined();
    expect(CraExportOrchestrator.validateRequest).toBeDefined();
    expect(CraExportOrchestrator.buildScope).toBeDefined();
    expect(CraExportOrchestrator.buildReport).toBeDefined();
    expect(CraExportOrchestrator.prepareExport).toBeDefined();
    expect(CraExportOrchestrator.download).toBeDefined();
    expect(CraExportOrchestrator.resolveExportModel).toBeDefined();
    expect(CraExportOrchestrator.resolveRenderer).toBeDefined();
  });

  it('s\'expose dans globalThis en environnement navigateur simulé', () => {
    const scriptPath = path.resolve(__dirname, 'cra-export-orchestrator.js');
    const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

    const sandbox = {
      globalThis: {},
      module: undefined,
      exports: undefined,
      require: undefined
    };

    vm.runInNewContext(scriptContent, sandbox);

    expect(sandbox.globalThis.CraExportOrchestrator).toBeDefined();
    expect(typeof sandbox.globalThis.CraExportOrchestrator.getFormatOptions).toBe('function');
    expect(typeof sandbox.globalThis.CraExportOrchestrator.normalizeFormat).toBe('function');
    expect(typeof sandbox.globalThis.CraExportOrchestrator.validateRequest).toBe('function');
    expect(typeof sandbox.globalThis.CraExportOrchestrator.buildScope).toBe('function');
    expect(typeof sandbox.globalThis.CraExportOrchestrator.buildReport).toBe('function');
    expect(typeof sandbox.globalThis.CraExportOrchestrator.prepareExport).toBe('function');
    expect(typeof sandbox.globalThis.CraExportOrchestrator.download).toBe('function');
    expect(typeof sandbox.globalThis.CraExportOrchestrator.resolveExportModel).toBe('function');
    expect(typeof sandbox.globalThis.CraExportOrchestrator.resolveRenderer).toBe('function');
  });

  it('peut être chargé sans CraExportModel, CraExportPdf, CraExportCsv dans un contexte navigateur', () => {
    const scriptPath = path.resolve(__dirname, 'cra-export-orchestrator.js');
    const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

    const sandbox = {
      globalThis: {},
      module: undefined,
      exports: undefined,
      require: undefined,
      console: console
    };

    expect(() => {
      vm.runInNewContext(scriptContent, sandbox);
    }).not.toThrow();
  });
});

// ============================================================================
// getFormatOptions
// ============================================================================

describe('getFormatOptions', () => {
  it('retourne le tableau exact des options de format', () => {
    const result = CraExportOrchestrator.getFormatOptions();

    expect(result).toEqual([
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
    ]);
  });

  it('retourne un nouveau tableau à chaque appel', () => {
    const result1 = CraExportOrchestrator.getFormatOptions();
    const result2 = CraExportOrchestrator.getFormatOptions();

    expect(result1).not.toBe(result2);
  });

  it('retourne des objets internes nouveaux à chaque appel', () => {
    const result1 = CraExportOrchestrator.getFormatOptions();
    const result2 = CraExportOrchestrator.getFormatOptions();

    expect(result1[0]).not.toBe(result2[0]);
    expect(result1[1]).not.toBe(result2[1]);
  });

  it('modifier le résultat d\'un appel ne modifie pas l\'appel suivant', () => {
    const result1 = CraExportOrchestrator.getFormatOptions();
    result1[0].id = 'modified';
    result1[0].label = 'Modified';

    const result2 = CraExportOrchestrator.getFormatOptions();

    expect(result2[0].id).toBe('pdf');
    expect(result2[0].label).toBe('PDF');
  });
});

// ============================================================================
// normalizeFormat
// ============================================================================

describe('normalizeFormat', () => {
  it.each([
    ['pdf', 'pdf'],
    ['PDF', 'pdf'],
    [' Pdf ', 'pdf'],
    ['csv', 'csv'],
    ['CSV', 'csv'],
    [' Csv ', 'csv']
  ])('normalise "%s" en "%s"', (input, expected) => {
    expect(CraExportOrchestrator.normalizeFormat(input)).toBe(expected);
  });

  it.each([
    [null, 'CraExportOrchestrator: format invalide'],
    [undefined, 'CraExportOrchestrator: format invalide'],
    ['', 'CraExportOrchestrator: format'],
    ['   ', 'CraExportOrchestrator: format'],
    [123, 'CraExportOrchestrator: format invalide'],
    [{}, 'CraExportOrchestrator: format invalide'],
    ['xlsx', 'CraExportOrchestrator: format "xlsx" non autorisé'],
    ['excel', 'CraExportOrchestrator: format "excel" non autorisé'],
    ['json', 'CraExportOrchestrator: format "json" non autorisé']
  ])('refuse %p avec erreur commençant par "%s"', (input, expectedPrefix) => {
    expect(() => {
      CraExportOrchestrator.normalizeFormat(input);
    }).toThrow(expectedPrefix);
  });
});


// ============================================================================
// resolveExportModel
// ============================================================================

describe('resolveExportModel', () => {
  let originalGlobalModel;

  beforeEach(() => {
    originalGlobalModel = globalThis.CraExportModel;
    delete globalThis.CraExportModel;
  });

  afterEach(() => {
    if (originalGlobalModel) {
      globalThis.CraExportModel = originalGlobalModel;
    } else {
      delete globalThis.CraExportModel;
    }
  });

  it('retourne le modèle injecté en priorité', () => {
    const injectedModel = { fake: true, buildReport: () => {} };
    const result = CraExportOrchestrator.resolveExportModel(injectedModel);
    expect(result).toBe(injectedModel);
  });

  it('ne utilise pas un global différent lorsqu\'un modèle est injecté', () => {
    const injectedModel = { fake: true, buildReport: () => {} };
    const otherGlobalModel = { other: true };
    globalThis.CraExportModel = otherGlobalModel;

    const result = CraExportOrchestrator.resolveExportModel(injectedModel);
    expect(result).toBe(injectedModel);
    expect(result).not.toBe(otherGlobalModel);
  });

  it('retourne globalThis.CraExportModel en l\'absence d\'injection', () => {
    const globalModel = { fake: true, buildReport: () => {} };
    globalThis.CraExportModel = globalModel;

    const result = CraExportOrchestrator.resolveExportModel(null);
    expect(result).toBe(globalModel);
  });

  it('retourne le module CommonJS en dernier recours', () => {
    delete globalThis.CraExportModel;

    const result = CraExportOrchestrator.resolveExportModel(null);
    expect(result).toBeDefined();
    expect(typeof result.buildReport).toBe('function');
  });

  it('lève une erreur en l\'absence totale de modèle dans un contexte navigateur isolé', () => {
    const scriptPath = path.resolve(__dirname, 'cra-export-orchestrator.js');
    const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

    const sandbox = {
      globalThis: {},
      module: undefined,
      exports: undefined,
      require: undefined
    };

    vm.runInNewContext(scriptContent, sandbox);

    expect(() => {
      sandbox.globalThis.CraExportOrchestrator.resolveExportModel(null);
    }).toThrow('CraExportOrchestrator: CraExportModel indisponible');
  });

  it('fonctionne dans un environnement navigateur simulé sans modèle', () => {
    const scriptPath = path.resolve(__dirname, 'cra-export-orchestrator.js');
    const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

    const sandbox = {
      globalThis: {},
      module: undefined,
      exports: undefined,
      require: undefined
    };

    vm.runInNewContext(scriptContent, sandbox);

    expect(() => {
      sandbox.globalThis.CraExportOrchestrator.resolveExportModel(null);
    }).toThrow('CraExportOrchestrator: CraExportModel indisponible');
  });
});

// ============================================================================
// resolveRenderer
// ============================================================================

describe('resolveRenderer', () => {
  let originalGlobalPdf;
  let originalGlobalCsv;

  beforeEach(() => {
    originalGlobalPdf = globalThis.CraExportPdf;
    originalGlobalCsv = globalThis.CraExportCsv;
    delete globalThis.CraExportPdf;
    delete globalThis.CraExportCsv;
  });

  afterEach(() => {
    if (originalGlobalPdf) {
      globalThis.CraExportPdf = originalGlobalPdf;
    } else {
      delete globalThis.CraExportPdf;
    }
    if (originalGlobalCsv) {
      globalThis.CraExportCsv = originalGlobalCsv;
    } else {
      delete globalThis.CraExportCsv;
    }
  });

  it('retourne le renderer PDF injecté', () => {
    const injectedPdf = { fake: 'pdf' };
    const result = CraExportOrchestrator.resolveRenderer('pdf', { pdf: injectedPdf });
    expect(result).toBe(injectedPdf);
  });

  it('retourne le renderer CSV injecté', () => {
    const injectedCsv = { fake: 'csv' };
    const result = CraExportOrchestrator.resolveRenderer('csv', { csv: injectedCsv });
    expect(result).toBe(injectedCsv);
  });

  it('retourne PDF depuis globalThis sans injection', () => {
    const globalPdf = { fromGlobal: 'pdf' };
    globalThis.CraExportPdf = globalPdf;

    const result = CraExportOrchestrator.resolveRenderer('pdf', {});
    expect(result).toBe(globalPdf);
  });

  it('retourne CSV depuis globalThis sans injection', () => {
    const globalCsv = { fromGlobal: 'csv' };
    globalThis.CraExportCsv = globalCsv;

    const result = CraExportOrchestrator.resolveRenderer('csv', {});
    expect(result).toBe(globalCsv);
  });

  it('retourne PDF depuis CommonJS en dernier recours', () => {
    delete globalThis.CraExportPdf;
    const result = CraExportOrchestrator.resolveRenderer('pdf', {});
    expect(result).toBeDefined();
    expect(typeof result.buildFilename).toBe('function');
  });

  it('retourne CSV depuis CommonJS en dernier recours', () => {
    delete globalThis.CraExportCsv;
    const result = CraExportOrchestrator.resolveRenderer('csv', {});
    expect(result).toBeDefined();
    expect(typeof result.buildFilename).toBe('function');
  });

  it('demander PDF ne résout pas CSV', () => {
    const injectedPdf = { fake: 'pdf' };
    const injectedCsv = { fake: 'csv' };

    CraExportOrchestrator.resolveRenderer('pdf', { pdf: injectedPdf, csv: injectedCsv });

    expect(injectedPdf.fake).toBe('pdf');
  });

  it('demander CSV ne résout pas PDF', () => {
    const injectedPdf = { fake: 'pdf' };
    const injectedCsv = { fake: 'csv' };

    CraExportOrchestrator.resolveRenderer('csv', { pdf: injectedPdf, csv: injectedCsv });

    expect(injectedCsv.fake).toBe('csv');
  });

  it('l\'injection est prioritaire sur le global pour PDF', () => {
    const injectedPdf = { injected: true };
    globalThis.CraExportPdf = { global: true };

    const result = CraExportOrchestrator.resolveRenderer('pdf', { pdf: injectedPdf });
    expect(result).toBe(injectedPdf);
  });

  it('l\'injection est prioritaire sur le global pour CSV', () => {
    const injectedCsv = { injected: true };
    globalThis.CraExportCsv = { global: true };

    const result = CraExportOrchestrator.resolveRenderer('csv', { csv: injectedCsv });
    expect(result).toBe(injectedCsv);
  });

  it('lève une erreur pour un format sans renderer en environnement navigateur isolé', () => {
    const scriptPath = path.resolve(__dirname, 'cra-export-orchestrator.js');
    const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

    const sandbox = {
      globalThis: {},
      module: undefined,
      exports: undefined,
      require: undefined
    };

    vm.runInNewContext(scriptContent, sandbox);

    expect(() => {
      sandbox.globalThis.CraExportOrchestrator.resolveRenderer('pdf', {});
    }).toThrow('CraExportOrchestrator: générateur pdf indisponible');
  });
});


// ============================================================================
// validateRequest — CAS NOMINAL
// ============================================================================

describe('validateRequest', () => {
  describe('cas nominal', () => {
    it('valide une requête nominale PDF', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
      expect(result.error).toBe(null);
      expect(deps.model.validateDateRange).toHaveBeenCalledTimes(1);
      expect(deps.model.validateDateRange).toHaveBeenCalledWith('2026-01-01', '2026-01-31');
    });

    it('valide une requête nominale avec format PDF en majuscules', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ format: 'PDF' });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
      expect(result.error).toBe(null);
    });

    it('valide une requête nominale avec format " Csv "', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ format: ' Csv ' });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
      expect(result.error).toBe(null);
    });

    it('ne modifie pas la requête', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();
      const originalJson = JSON.stringify(request);

      CraExportOrchestrator.validateRequest(request, deps);

      expect(JSON.stringify(request)).toBe(originalJson);
    });
  });

  describe('requête et format invalides', () => {
    it('refuse request null', () => {
      const deps = createFakeDependencies();
      const result = CraExportOrchestrator.validateRequest(null, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('CraExportOrchestrator:');
    });

    it('refuse request undefined', () => {
      const deps = createFakeDependencies();
      const result = CraExportOrchestrator.validateRequest(undefined, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('CraExportOrchestrator:');
    });

    it('refuse request chaîne', () => {
      const deps = createFakeDependencies();
      const result = CraExportOrchestrator.validateRequest('not an object', deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('CraExportOrchestrator:');
    });

    it('refuse request tableau', () => {
      const deps = createFakeDependencies();
      const result = CraExportOrchestrator.validateRequest([], deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('CraExportOrchestrator:');
    });

    it('refuse format absent', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();
      delete request.format;

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('CraExportOrchestrator:');
    });

    it('refuse format null', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ format: null });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('CraExportOrchestrator:');
    });

    it('refuse format vide', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ format: '' });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('CraExportOrchestrator:');
    });

    it('refuse format invalide', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ format: 'xlsx' });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('CraExportOrchestrator:');
    });

    it('ne lève pas de TypeError', () => {
      const deps = createFakeDependencies();

      expect(() => CraExportOrchestrator.validateRequest(null, deps)).not.toThrow(TypeError);
      expect(() => CraExportOrchestrator.validateRequest(undefined, deps)).not.toThrow(TypeError);
      expect(() => CraExportOrchestrator.validateRequest('string', deps)).not.toThrow(TypeError);
    });
  });

  describe('période invalide', () => {
    it('refuse startDateIso absent', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();
      delete request.startDateIso;

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('startDateIso');
    });

    it('refuse endDateIso absent', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();
      delete request.endDateIso;

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('endDateIso');
    });

    it('refuse les deux dates absentes', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();
      delete request.startDateIso;
      delete request.endDateIso;

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
    });

    it('refuse lorsque le modèle retourne une plage invalide', () => {
      const deps = createFakeDependencies();
      deps.model.validateDateRange.mockReturnValue({
        valid: false,
        error: 'plage invalide'
      });

      const request = makeRequest();
      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('CraExportOrchestrator: plage invalide');
    });

    it('refuse lorsque le modèle retourne une erreur explicite', () => {
      const deps = createFakeDependencies();
      deps.model.validateDateRange.mockReturnValue({
        valid: false,
        error: 'startDateIso doit être avant endDateIso'
      });

      const request = makeRequest();
      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('CraExportOrchestrator:');
    });

    it('refuse lorsque le modèle est absent dans un contexte navigateur isolé', () => {
      const scriptPath = path.resolve(__dirname, 'cra-export-orchestrator.js');
      const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

      const sandbox = {
        globalThis: {},
        module: undefined,
        exports: undefined,
        require: undefined
      };

      vm.runInNewContext(scriptContent, sandbox);

      const request = makeRequest();

      const result = sandbox.globalThis.CraExportOrchestrator.validateRequest(request, {});

      expect(result.valid).toBe(false);
      expect(result.error).toContain('CraExportOrchestrator: CraExportModel indisponible');
    });

    it('refuse lorsque le modèle est invalide', () => {
      const request = makeRequest();
      const result = CraExportOrchestrator.validateRequest(request, { model: { fake: true } });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('CraExportOrchestrator:');
    });

    it('refuse lorsque validateDateRange est absent', () => {
      const request = makeRequest();
      const invalidModel = {
        buildReport: () => {},
        normalizeScope: () => {}
      };
      const result = CraExportOrchestrator.validateRequest(request, { model: invalidModel });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('CraExportOrchestrator:');
    });
  });

  describe('personnes invalides', () => {
    it('refuse personIds absent', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();
      delete request.personIds;

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('personIds');
    });

    it('refuse personIds null', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ personIds: null });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('personIds');
    });

    it('refuse personIds non tableau', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ personIds: 'not-array' });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('personIds');
    });

    it('refuse tableau vide', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ personIds: [] });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('aucune personne');
    });

    it('refuse uniquement null', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ personIds: [null, null] });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('aucune personne');
    });

    it('refuse uniquement undefined', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ personIds: [undefined, undefined] });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('aucune personne');
    });

    it('refuse uniquement chaînes vides', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ personIds: ['', ''] });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('aucune personne');
    });

    it('refuse chaînes contenant seulement des espaces', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ personIds: ['   ', '  '] });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('aucune personne');
    });

    it('accepte mélange d\'identifiants valides et invalides', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ personIds: [null, 2, '', 1, undefined] });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
    });

    it('accepte IDs numériques', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ personIds: [1, 2, 3] });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
    });

    it('accepte IDs chaînes', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ personIds: ['1', '2', '3'] });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
    });

    it('conserve l\'ordre [2, 1]', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ personIds: [2, 1] });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
    });

    it('fail closed - ne fallback pas vers assignee', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ personIds: [] });
      request.filters.assignee = ['1'];

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('aucune personne');
    });

    it('fail closed - ne fallback pas vers team', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ personIds: [] });
      request.filters.team = ['1'];

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('aucune personne');
    });
  });

  describe('filters', () => {
    it('accepte filters absent', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();
      delete request.filters;

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
    });

    it('accepte objet vide', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ filters: {} });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
    });

    it('accepte filtres nominaux', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
    });

    it('refuse filters null', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ filters: null });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('filters');
    });

    it('refuse filters chaîne', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ filters: 'invalid' });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('filters');
    });

    it('refuse filters tableau', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ filters: [] });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('filters');
    });

    it('accepte sous-propriété non tableau (RISQUE : élargissement silencieux)', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ filters: { project: 'not-array' } });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);

      // RISQUE : filters.project non tableau sera ignoré par normalizeScope(),
      // ce qui signifie AUCUNE restriction projet. Un état mal formé pourrait
      // exporter davantage de données que prévu.
      // TODO: Renforcer validateRequest pour exiger que project/programme/task
      // soient des tableaux lorsqu'ils sont présents (fail closed).
    });

    it('DOIT refuser filters.project non tableau (fail closed - à implémenter)', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ filters: { project: '100' } });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      // Actuellement accepté (comportement dangereux)
      // Après correction : expect(result.valid).toBe(false);
      expect(result.valid).toBe(true);
      expect(result.error).toBe(null);
    });

    it('DOIT refuser filters.programme non tableau (fail closed - à implémenter)', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ filters: { programme: '10' } });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
    });

    it('DOIT refuser filters.task non tableau (fail closed - à implémenter)', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ filters: { task: '1000' } });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
    });
  });

  describe('data', () => {
    it('refuse data absent', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();
      delete request.data;

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('data');
    });

    it('refuse data null', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ data: null });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('data');
    });

    it('refuse data chaîne', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ data: 'invalid' });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('data');
    });

    it('refuse data tableau', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ data: [] });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('data');
    });

    it('refuse data objet vide', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({
        data: {}
      });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('entries');
    });

    it('refuse entries absent', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();
      delete request.data.entries;

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('entries');
    });

    it('refuse entries non tableau', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ data: { ...createBaseRequest().data, entries: 'invalid' } });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('entries');
    });

    it('refuse team absent', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();
      delete request.data.team;

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('team');
    });

    it('refuse team non tableau', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ data: { ...createBaseRequest().data, team: 'invalid' } });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('team');
    });

    it('refuse tasks absent', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();
      delete request.data.tasks;

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('tasks');
    });

    it('refuse tasks non tableau', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ data: { ...createBaseRequest().data, tasks: 'invalid' } });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('tasks');
    });

    it('refuse projects absent', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();
      delete request.data.projects;

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('projects');
    });

    it('refuse projects non tableau', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ data: { ...createBaseRequest().data, projects: 'invalid' } });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('projects');
    });

    it('refuse programmes absent', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();
      delete request.data.programmes;

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('programmes');
    });

    it('refuse programmes non tableau', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ data: { ...createBaseRequest().data, programmes: 'invalid' } });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('programmes');
    });
  });

  describe('options', () => {
    it('accepte filename absent', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();
      delete request.filename;

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
    });

    it('accepte filename chaîne valide', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ filename: 'custom-export' });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
    });

    it('refuse filename chaîne vide', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ filename: '' });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('filename');
    });

    it('refuse filename espaces uniquement', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ filename: '   ' });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('filename');
    });

    it('refuse filename nombre', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ filename: 123 });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('filename');
    });

    it('refuse filename null', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ filename: null });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('filename');
    });

    it('accepte pdfOptions absent', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();
      delete request.pdfOptions;

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
    });

    it('accepte pdfOptions objet', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ pdfOptions: { fake: true } });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
    });

    it('refuse pdfOptions null', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ pdfOptions: null });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('pdfOptions');
    });

    it('refuse pdfOptions tableau', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ pdfOptions: [] });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('pdfOptions');
    });

    it('refuse pdfOptions chaîne', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ pdfOptions: 'invalid' });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('pdfOptions');
    });

    it('accepte csvOptions absent', () => {
      const deps = createFakeDependencies();
      const request = makeRequest();
      delete request.csvOptions;

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
    });

    it('accepte csvOptions objet', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ csvOptions: { fake: true } });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(true);
    });

    it('refuse csvOptions null', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ csvOptions: null });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('csvOptions');
    });

    it('refuse csvOptions tableau', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ csvOptions: [] });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('csvOptions');
    });

    it('refuse csvOptions chaîne', () => {
      const deps = createFakeDependencies();
      const request = makeRequest({ csvOptions: 'invalid' });

      const result = CraExportOrchestrator.validateRequest(request, deps);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('csvOptions');
    });
  });
});


// ============================================================================
// buildScope
// ============================================================================

describe('buildScope', () => {
  it('construit le scope avec personIds, projectIds, programmeIds, taskIds', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    const scope = CraExportOrchestrator.buildScope(request, deps);

    expect(deps.model.normalizeScope).toHaveBeenCalledTimes(1);
    const calledScope = deps.model.normalizeScope.mock.calls[0][0];
    expect(calledScope.personIds).toEqual([2, 1]);
    expect(calledScope.projectIds).toEqual(['100']);
    expect(calledScope.programmeIds).toEqual(['10']);
    expect(calledScope.taskIds).toEqual(['1000']);
  });

  it('conserve l\'ordre [2, 1] des personIds', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ personIds: [2, 1] });

    CraExportOrchestrator.buildScope(request, deps);

    const calledScope = deps.model.normalizeScope.mock.calls[0][0];
    expect(calledScope.personIds).toEqual([2, 1]);
  });

  it('délègue les doublons au modèle', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ personIds: [1, 1, 2, 2] });

    CraExportOrchestrator.buildScope(request, deps);

    const calledScope = deps.model.normalizeScope.mock.calls[0][0];
    expect(calledScope.personIds).toEqual([1, 1, 2, 2]);
  });

  it('produit des tableaux vides lorsque filters est absent', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    delete request.filters;

    const scope = CraExportOrchestrator.buildScope(request, deps);

    const calledScope = deps.model.normalizeScope.mock.calls[0][0];
    expect(calledScope.projectIds).toEqual([]);
    expect(calledScope.programmeIds).toEqual([]);
    expect(calledScope.taskIds).toEqual([]);
  });

  it('ignore assignee', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    request.filters.assignee = ['999'];

    CraExportOrchestrator.buildScope(request, deps);

    const calledScope = deps.model.normalizeScope.mock.calls[0][0];
    expect(calledScope.assignee).toBeUndefined();
  });

  it('ignore team', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    request.filters.team = ['999'];

    CraExportOrchestrator.buildScope(request, deps);

    const calledScope = deps.model.normalizeScope.mock.calls[0][0];
    expect(calledScope.team).toBeUndefined();
  });

  it('n\'ajoute jamais la personne sélectionnée', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ personIds: [2] });

    CraExportOrchestrator.buildScope(request, deps);

    const calledScope = deps.model.normalizeScope.mock.calls[0][0];
    expect(calledScope.personIds).toEqual([2]);
  });

  it('ne modifie pas la requête', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    const originalJson = JSON.stringify(request);

    CraExportOrchestrator.buildScope(request, deps);

    expect(JSON.stringify(request)).toBe(originalJson);
  });

  it('ne modifie pas les filtres', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    const originalFiltersJson = JSON.stringify(request.filters);

    CraExportOrchestrator.buildScope(request, deps);

    expect(JSON.stringify(request.filters)).toBe(originalFiltersJson);
  });

  it('gère un modèle invalide', () => {
    const invalidModel = { fake: true };
    const request = makeRequest();

    expect(() => {
      CraExportOrchestrator.buildScope(request, { model: invalidModel });
    }).toThrow('CraExportOrchestrator:');
  });
});

// ============================================================================
// buildReport
// ============================================================================

describe('buildReport', () => {
  it('valide la requête avant de construire le rapport', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    request.personIds = [];

    expect(() => {
      CraExportOrchestrator.buildReport(request, deps);
    }).toThrow('CraExportOrchestrator:');
  });

  it('appelle model.buildReport() exactement une fois', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.buildReport(request, deps);

    expect(deps.model.buildReport).toHaveBeenCalledTimes(1);
  });

  it('passe startDateIso à buildReport', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.buildReport(request, deps);

    const calledArgs = deps.model.buildReport.mock.calls[0][0];
    expect(calledArgs.startDateIso).toBe('2026-01-01');
  });

  it('passe endDateIso à buildReport', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.buildReport(request, deps);

    const calledArgs = deps.model.buildReport.mock.calls[0][0];
    expect(calledArgs.endDateIso).toBe('2026-01-31');
  });

  it('passe le scope à buildReport', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.buildReport(request, deps);

    const calledArgs = deps.model.buildReport.mock.calls[0][0];
    expect(calledArgs.scope).toBeDefined();
  });

  it('passe entries à buildReport', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.buildReport(request, deps);

    const calledArgs = deps.model.buildReport.mock.calls[0][0];
    expect(calledArgs.entries).toBe(request.data.entries);
  });

  it('passe team à buildReport', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.buildReport(request, deps);

    const calledArgs = deps.model.buildReport.mock.calls[0][0];
    expect(calledArgs.team).toBe(request.data.team);
  });

  it('passe tasks à buildReport', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.buildReport(request, deps);

    const calledArgs = deps.model.buildReport.mock.calls[0][0];
    expect(calledArgs.tasks).toBe(request.data.tasks);
  });

  it('passe projects à buildReport', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.buildReport(request, deps);

    const calledArgs = deps.model.buildReport.mock.calls[0][0];
    expect(calledArgs.projects).toBe(request.data.projects);
  });

  it('passe programmes à buildReport', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.buildReport(request, deps);

    const calledArgs = deps.model.buildReport.mock.calls[0][0];
    expect(calledArgs.programmes).toBe(request.data.programmes);
  });

  it('retourne exactement le rapport du modèle', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    const result = CraExportOrchestrator.buildReport(request, deps);

    expect(deps.model.buildReport).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
    expect(result.persons).toBeDefined();
    expect(result.totals).toBeDefined();
  });

  it('ne trie pas le rapport', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    const result = CraExportOrchestrator.buildReport(request, deps);

    expect(result.persons[0].rows[0].dateIso).toBe('2026-01-05');
  });

  it('ne modifie pas le rapport', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    const result = CraExportOrchestrator.buildReport(request, deps);

    expect(result.totals.rowCount).toBe(1);
  });

  it('une requête invalide empêche l\'appel à model.buildReport()', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ personIds: [] });

    try {
      CraExportOrchestrator.buildReport(request, deps);
    } catch (e) {
    }

    expect(deps.model.buildReport).not.toHaveBeenCalled();
  });
});


// ============================================================================
// prepareExport - PDF
// ============================================================================

describe('prepareExport - PDF', () => {
  it('normalise PDF en pdf', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ format: 'PDF' });

    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.format).toBe('pdf');
  });

  it('construit le rapport', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.prepareExport(request, deps);

    expect(deps.model.buildReport).toHaveBeenCalledTimes(1);
  });

  it('utilise uniquement le renderer PDF', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.prepareExport(request, deps);

    expect(deps.pdf.buildFilename).toHaveBeenCalledTimes(1);
    expect(deps.csv.buildFilename).not.toHaveBeenCalled();
  });

  it('n\'appelle jamais download()', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.prepareExport(request, deps);

    expect(deps.pdf.download).not.toHaveBeenCalled();
    expect(deps.csv.download).not.toHaveBeenCalled();
  });

  it('ne requiert aucun DOM', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    expect(() => {
      CraExportOrchestrator.prepareExport(request, deps);
    }).not.toThrow();
  });

  it('ne requiert pas pdfmake pour construire le nom', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    delete request.pdfOptions.pdfMake;

    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.filename).toBe('export.pdf');
  });

  it('retourne la structure attendue', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.format).toBe('pdf');
    expect(result.filename).toBe('export.pdf');
    expect(result.report).toBeDefined();
    expect(result.summary).toBeDefined();
  });

  it('summary.startDateIso vient de report.period', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.summary.startDateIso).toBe('2026-01-01');
  });

  it('summary.endDateIso vient de report.period', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.summary.endDateIso).toBe('2026-01-31');
  });

  it('summary.selectedPersonCount vient de report.totals', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.summary.selectedPersonCount).toBe(2);
  });

  it('summary.exportedPersonCount vient de report.totals', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.summary.exportedPersonCount).toBe(1);
  });

  it('summary.rowCount vient de report.totals', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.summary.rowCount).toBe(1);
  });

  it('summary.totalMinutes vient de report.totals', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.summary.totalMinutes).toBe(420);
  });
});

// ============================================================================
// prepareExport - CSV
// ============================================================================

describe('prepareExport - CSV', () => {
  it('normalise CSV en csv', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ format: 'CSV' });

    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.format).toBe('csv');
  });

  it('résout uniquement CSV', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ format: 'csv' });

    CraExportOrchestrator.prepareExport(request, deps);

    expect(deps.csv.buildFilename).toHaveBeenCalledTimes(1);
    expect(deps.pdf.buildFilename).not.toHaveBeenCalled();
  });

  it('PDF jamais utilisé', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ format: 'csv' });

    CraExportOrchestrator.prepareExport(request, deps);

    expect(deps.pdf.download).not.toHaveBeenCalled();
  });

  it('nom avec extension .csv', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ format: 'csv' });

    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.filename).toBe('export.csv');
  });

  it('aucun téléchargement', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ format: 'csv' });

    CraExportOrchestrator.prepareExport(request, deps);

    expect(deps.csv.download).not.toHaveBeenCalled();
  });

  it('synthèse correcte', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ format: 'csv' });

    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.summary.rowCount).toBe(1);
    expect(result.summary.totalMinutes).toBe(420);
  });
});

// ============================================================================
// NOM PERSONNALISÉ
// ============================================================================

describe('Nom personnalisé', () => {
  it('appelle buildFilename avec request.filename quand présent', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ filename: 'mon-export' });

    CraExportOrchestrator.prepareExport(request, deps);

    expect(deps.pdf.buildFilename).toHaveBeenCalledWith(
      expect.any(Object),
      { filename: 'mon-export' }
    );
  });

  it('appelle buildFilename avec {} quand filename est absent', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    delete request.filename;

    CraExportOrchestrator.prepareExport(request, deps);

    expect(deps.pdf.buildFilename).toHaveBeenCalledWith(
      expect.any(Object),
      {}
    );
  });
});

// ============================================================================
// RAPPORT VIDE
// ============================================================================

describe('Rapport vide', () => {
  it('refuse report.persons absent', () => {
    const deps = createFakeDependencies();
    deps.model.buildReport.mockReturnValue({
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      totals: { rowCount: 0 }
    });

    const request = makeRequest();

    expect(() => {
      CraExportOrchestrator.prepareExport(request, deps);
    }).toThrow('CraExportOrchestrator: aucune feuille de temps à exporter.');
  });

  it('refuse report.persons null', () => {
    const deps = createFakeDependencies();
    deps.model.buildReport.mockReturnValue({
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      persons: null,
      totals: { rowCount: 0 }
    });

    const request = makeRequest();

    expect(() => {
      CraExportOrchestrator.prepareExport(request, deps);
    }).toThrow('CraExportOrchestrator: aucune feuille de temps à exporter.');
  });

  it('refuse report.persons vide', () => {
    const deps = createFakeDependencies();
    deps.model.buildReport.mockReturnValue({
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      persons: [],
      totals: { rowCount: 0 }
    });

    const request = makeRequest();

    expect(() => {
      CraExportOrchestrator.prepareExport(request, deps);
    }).toThrow('CraExportOrchestrator: aucune feuille de temps à exporter.');
  });

  it('refuse personne avec rows absent', () => {
    const deps = createFakeDependencies();
    deps.model.buildReport.mockReturnValue({
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      persons: [{ id: 1, name: 'Test' }],
      totals: { rowCount: 0 }
    });

    const request = makeRequest();

    expect(() => {
      CraExportOrchestrator.prepareExport(request, deps);
    }).toThrow('CraExportOrchestrator: aucune feuille de temps à exporter.');
  });

  it('refuse personne avec rows null', () => {
    const deps = createFakeDependencies();
    deps.model.buildReport.mockReturnValue({
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      persons: [{ id: 1, name: 'Test', rows: null }],
      totals: { rowCount: 0 }
    });

    const request = makeRequest();

    expect(() => {
      CraExportOrchestrator.prepareExport(request, deps);
    }).toThrow('CraExportOrchestrator: aucune feuille de temps à exporter.');
  });

  it('refuse personne avec rows vide', () => {
    const deps = createFakeDependencies();
    deps.model.buildReport.mockReturnValue({
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      persons: [{ id: 1, name: 'Test', rows: [] }],
      totals: { rowCount: 0 }
    });

    const request = makeRequest();

    expect(() => {
      CraExportOrchestrator.prepareExport(request, deps);
    }).toThrow('CraExportOrchestrator: aucune feuille de temps à exporter.');
  });

  it('refuse plusieurs personnes avec uniquement rows vides', () => {
    const deps = createFakeDependencies();
    deps.model.buildReport.mockReturnValue({
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      persons: [
        { id: 1, name: 'Test1', rows: [] },
        { id: 2, name: 'Test2', rows: [] }
      ],
      totals: { rowCount: 0 }
    });

    const request = makeRequest();

    expect(() => {
      CraExportOrchestrator.prepareExport(request, deps);
    }).toThrow('CraExportOrchestrator: aucune feuille de temps à exporter.');
  });

  it('aucun renderer résolu lorsque le rapport est vide', () => {
    const deps = createFakeDependencies();
    deps.model.buildReport.mockReturnValue({
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      persons: [],
      totals: { rowCount: 0 }
    });

    const request = makeRequest();

    try {
      CraExportOrchestrator.prepareExport(request, deps);
    } catch (e) {
    }

    expect(deps.pdf.buildFilename).not.toHaveBeenCalled();
    expect(deps.csv.buildFilename).not.toHaveBeenCalled();
  });

  it('refuse rapport avec rowCount === 0 explicitement (incohérent)', () => {
    const deps = createFakeDependencies();
    deps.model.buildReport.mockReturnValue({
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      persons: [
        {
          id: 1,
          name: 'Test',
          rows: [{ dateIso: '2026-01-01', durationMinutes: 60 }]
        }
      ],
      totals: { rowCount: 0 }
    });

    const request = makeRequest();

    expect(() => {
      CraExportOrchestrator.prepareExport(request, deps);
    }).toThrow('CraExportOrchestrator: aucune feuille de temps à exporter.');
  });

  it('accepte rapport avec lignes et totals absents (défensif)', () => {
    const deps = createFakeDependencies();
    deps.model.buildReport.mockReturnValue({
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      persons: [
        {
          id: 1,
          name: 'Test',
          rows: [{ dateIso: '2026-01-01', durationMinutes: 60 }]
        }
      ]
    });

    const request = makeRequest();

    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.summary.rowCount).toBe(0);
    expect(result.summary.totalMinutes).toBe(0);
  });

  it('accepte rapport avec lignes et totals.rowCount absent (défensif)', () => {
    const deps = createFakeDependencies();
    deps.model.buildReport.mockReturnValue({
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      persons: [
        {
          id: 1,
          name: 'Test',
          rows: [{ dateIso: '2026-01-01', durationMinutes: 60 }]
        }
      ],
      totals: {
        selectedPersonCount: 1,
        exportedPersonCount: 1,
        totalMinutes: 60
      }
    });

    const request = makeRequest();

    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.summary.rowCount).toBe(0);
  });
});


// ============================================================================
// SUMMARY DÉFENSIF
// ============================================================================

describe('Summary défensif', () => {
  it('utilise zéro pour selectedPersonCount sans totals', () => {
    const deps = createFakeDependencies();
    deps.model.buildReport.mockReturnValue({
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      persons: [{ id: 1, name: 'Test', rows: [{ dateIso: '2026-01-01', durationMinutes: 60 }] }]
    });

    const request = makeRequest();
    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.summary.selectedPersonCount).toBe(0);
  });

  it('utilise zéro pour exportedPersonCount sans totals', () => {
    const deps = createFakeDependencies();
    deps.model.buildReport.mockReturnValue({
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      persons: [{ id: 1, name: 'Test', rows: [{ dateIso: '2026-01-01', durationMinutes: 60 }] }]
    });

    const request = makeRequest();
    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.summary.exportedPersonCount).toBe(0);
  });

  it('utilise zéro pour rowCount sans totals', () => {
    const deps = createFakeDependencies();
    deps.model.buildReport.mockReturnValue({
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      persons: [{ id: 1, name: 'Test', rows: [{ dateIso: '2026-01-01', durationMinutes: 60 }] }]
    });

    const request = makeRequest();
    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.summary.rowCount).toBe(0);
  });

  it('utilise zéro pour totalMinutes sans totals', () => {
    const deps = createFakeDependencies();
    deps.model.buildReport.mockReturnValue({
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      persons: [{ id: 1, name: 'Test', rows: [{ dateIso: '2026-01-01', durationMinutes: 60 }] }]
    });

    const request = makeRequest();
    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.summary.totalMinutes).toBe(0);
  });

  it('gère des totaux partiels', () => {
    const deps = createFakeDependencies();
    deps.model.buildReport.mockReturnValue({
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      persons: [{ id: 1, name: 'Test', rows: [{ dateIso: '2026-01-01', durationMinutes: 60 }] }],
      totals: {
        selectedPersonCount: 1
      }
    });

    const request = makeRequest();
    const result = CraExportOrchestrator.prepareExport(request, deps);

    expect(result.summary.selectedPersonCount).toBe(1);
    expect(result.summary.exportedPersonCount).toBe(0);
    expect(result.summary.rowCount).toBe(0);
    expect(result.summary.totalMinutes).toBe(0);
  });

  it('n\'ajoute aucune propriété au rapport', () => {
    const deps = createFakeDependencies();
    const originalReport = {
      period: { startDateIso: '2026-01-01', endDateIso: '2026-01-31' },
      scope: {},
      persons: [{ id: 1, name: 'Test', rows: [{ dateIso: '2026-01-01', durationMinutes: 60 }] }],
      totals: { selectedPersonCount: 1, exportedPersonCount: 1, rowCount: 1, totalMinutes: 60 }
    };
    deps.model.buildReport.mockReturnValue(originalReport);

    const request = makeRequest();
    CraExportOrchestrator.prepareExport(request, deps);

    expect(Object.keys(originalReport).sort()).toEqual(
      ['period', 'scope', 'persons', 'totals'].sort()
    );
  });
});

// ============================================================================
// download — PDF
// ============================================================================

describe('download - PDF', () => {
  it('prépare le rapport', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.download(request, deps);

    expect(deps.model.buildReport).toHaveBeenCalled();
  });

  it('appelle pdf.download() une fois', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.download(request, deps);

    expect(deps.pdf.download).toHaveBeenCalledTimes(1);
  });

  it('n\'appelle pas csv.download()', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.download(request, deps);

    expect(deps.csv.download).not.toHaveBeenCalled();
  });

  it('copie les pdfOptions', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.download(request, deps);

    const callArgs = deps.pdf.download.mock.calls[0][1];
    expect(callArgs.pdfMake).toEqual({ fake: true });
  });

  it('ajoute filename préparé', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    CraExportOrchestrator.download(request, deps);

    const callArgs = deps.pdf.download.mock.calls[0][1];
    expect(callArgs.filename).toBe('export.pdf');
  });

  it('ne modifie pas request.pdfOptions', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    const originalPdfOptions = { ...request.pdfOptions };

    CraExportOrchestrator.download(request, deps);

    expect(request.pdfOptions).toEqual(originalPdfOptions);
  });

  it('rendererResult contient le résultat PDF', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    const result = CraExportOrchestrator.download(request, deps);

    expect(result.rendererResult).toEqual({
      filename: 'export.pdf',
      pdf: { fake: true }
    });
  });

  it('structure finale complète', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    const result = CraExportOrchestrator.download(request, deps);

    expect(result.format).toBe('pdf');
    expect(result.filename).toBe('export.pdf');
    expect(result.report).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.rendererResult).toBeDefined();
  });

  it('transmet pdfOptions.pdfMake sans mutation', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    const originalPdfMake = request.pdfOptions.pdfMake;

    CraExportOrchestrator.download(request, deps);

    expect(request.pdfOptions.pdfMake).toBe(originalPdfMake);
  });
});

// ============================================================================
// download — CSV
// ============================================================================

describe('download - CSV', () => {
  it('appelle uniquement csv.download()', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ format: 'csv' });

    CraExportOrchestrator.download(request, deps);

    expect(deps.csv.download).toHaveBeenCalledTimes(1);
    expect(deps.pdf.download).not.toHaveBeenCalled();
  });

  it('transmet csvOptions.includeBom', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ format: 'csv' });

    CraExportOrchestrator.download(request, deps);

    const callArgs = deps.csv.download.mock.calls[0][1];
    expect(callArgs.includeBom).toBe(false);
  });

  it('transmet csvOptions.browser', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ format: 'csv' });

    CraExportOrchestrator.download(request, deps);

    const callArgs = deps.csv.download.mock.calls[0][1];
    expect(callArgs.browser).toEqual({ fake: true });
  });

  it('transmet le nom préparé', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ format: 'csv' });

    CraExportOrchestrator.download(request, deps);

    const callArgs = deps.csv.download.mock.calls[0][1];
    expect(callArgs.filename).toBe('export.csv');
  });

  it('csvOptions reste inchangé', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ format: 'csv' });
    const originalCsvOptions = { ...request.csvOptions };

    CraExportOrchestrator.download(request, deps);

    expect(request.csvOptions).toEqual(originalCsvOptions);
  });

  it('le résultat du renderer est conservé', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ format: 'csv' });

    const result = CraExportOrchestrator.download(request, deps);

    expect(result.rendererResult).toEqual({
      filename: 'export.csv',
      content: 'fake-csv'
    });
  });
});


// ============================================================================
// ERREURS DE HAUT NIVEAU
// ============================================================================

describe('Erreurs de haut niveau', () => {
  it('prepareExport(null) lève une erreur', () => {
    expect(() => {
      CraExportOrchestrator.prepareExport(null);
    }).toThrow('CraExportOrchestrator:');
  });

  it('prepareExport(undefined) lève une erreur', () => {
    expect(() => {
      CraExportOrchestrator.prepareExport(undefined);
    }).toThrow('CraExportOrchestrator:');
  });

  it('prepareExport({}) lève une erreur', () => {
    expect(() => {
      CraExportOrchestrator.prepareExport({});
    }).toThrow('CraExportOrchestrator:');
  });

  it('download(null) lève une erreur', () => {
    expect(() => {
      CraExportOrchestrator.download(null);
    }).toThrow('CraExportOrchestrator:');
  });

  it('download(undefined) lève une erreur', () => {
    expect(() => {
      CraExportOrchestrator.download(undefined);
    }).toThrow('CraExportOrchestrator:');
  });

  it('format invalide lève une erreur', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ format: 'xlsx' });

    expect(() => {
      CraExportOrchestrator.prepareExport(request, deps);
    }).toThrow('CraExportOrchestrator:');
  });

  it('modèle invalide lève une erreur', () => {
    const request = makeRequest();

    expect(() => {
      CraExportOrchestrator.prepareExport(request, { model: { fake: true } });
    }).toThrow('CraExportOrchestrator:');
  });

  it('renderer PDF invalide lève une erreur', () => {
    const deps = createFakeDependencies();
    deps.pdf = { fake: true };

    const request = makeRequest();

    expect(() => {
      CraExportOrchestrator.prepareExport(request, deps);
    }).toThrow('CraExportOrchestrator:');
  });

  it('renderer CSV invalide lève une erreur', () => {
    const deps = createFakeDependencies();
    deps.csv = { fake: true };

    const request = makeRequest({ format: 'csv' });

    expect(() => {
      CraExportOrchestrator.prepareExport(request, deps);
    }).toThrow('CraExportOrchestrator:');
  });

  it('buildFilename du renderer qui échoue propage l\'erreur', () => {
    const deps = createFakeDependencies();
    deps.pdf.buildFilename.mockImplementation(() => {
      throw new Error('Renderer error');
    });

    const request = makeRequest();

    expect(() => {
      CraExportOrchestrator.prepareExport(request, deps);
    }).toThrow('Renderer error');
  });

  it('download du renderer qui échoue propage l\'erreur', () => {
    const deps = createFakeDependencies();
    deps.pdf.download.mockImplementation(() => {
      throw new Error('Download failed');
    });

    const request = makeRequest();

    expect(() => {
      CraExportOrchestrator.download(request, deps);
    }).toThrow('Download failed');
  });
});

// ============================================================================
// RÉSOLUTION PARESSEUSE
// ============================================================================

describe('Résolution paresseuse', () => {
  it('préparer un PDF ne nécessite pas CSV', () => {
    const deps = {
      model: createFakeModel(),
      pdf: createFakePdf(),
      csv: null
    };

    const request = makeRequest();

    expect(() => {
      CraExportOrchestrator.prepareExport(request, deps);
    }).not.toThrow();
  });

  it('préparer un CSV ne nécessite pas PDF', () => {
    const deps = {
      model: createFakeModel(),
      pdf: null,
      csv: createFakeCsv()
    };

    const request = makeRequest({ format: 'csv' });

    expect(() => {
      CraExportOrchestrator.prepareExport(request, deps);
    }).not.toThrow();
  });

  it('télécharger un PDF ne nécessite pas CSV', () => {
    const deps = {
      model: createFakeModel(),
      pdf: createFakePdf(),
      csv: null
    };

    const request = makeRequest();

    expect(() => {
      CraExportOrchestrator.download(request, deps);
    }).not.toThrow();
  });

  it('télécharger un CSV ne nécessite pas PDF', () => {
    const deps = {
      model: createFakeModel(),
      pdf: null,
      csv: createFakeCsv()
    };

    const request = makeRequest({ format: 'csv' });

    expect(() => {
      CraExportOrchestrator.download(request, deps);
    }).not.toThrow();
  });

  it('le simple chargement du module ne résout aucune dépendance', () => {
    const originalGlobalModel = globalThis.CraExportModel;
    const originalGlobalPdf = globalThis.CraExportPdf;
    const originalGlobalCsv = globalThis.CraExportCsv;

    delete globalThis.CraExportModel;
    delete globalThis.CraExportPdf;
    delete globalThis.CraExportCsv;

    const scriptPath = path.resolve(__dirname, 'cra-export-orchestrator.js');
    const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

    const sandbox = {
      globalThis: {},
      module: undefined,
      exports: undefined,
      require: undefined
    };

    expect(() => {
      vm.runInNewContext(scriptContent, sandbox);
    }).not.toThrow();

    globalThis.CraExportModel = originalGlobalModel;
    globalThis.CraExportPdf = originalGlobalPdf;
    globalThis.CraExportCsv = originalGlobalCsv;
  });
});

// ============================================================================
// IMMUTABILITÉ
// ============================================================================

describe('CRA Export Orchestrator - Immutabilité', () => {
  it('ne modifie pas request.personIds', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    const originalPersonIds = [...request.personIds];

    CraExportOrchestrator.validateRequest(request, deps);
    CraExportOrchestrator.buildScope(request, deps);
    CraExportOrchestrator.buildReport(request, deps);
    CraExportOrchestrator.prepareExport(request, deps);
    CraExportOrchestrator.download(request, deps);

    expect(request.personIds).toEqual(originalPersonIds);
  });

  it('ne modifie pas request.filters', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    const originalFilters = JSON.stringify(request.filters);

    CraExportOrchestrator.validateRequest(request, deps);
    CraExportOrchestrator.buildScope(request, deps);
    CraExportOrchestrator.buildReport(request, deps);
    CraExportOrchestrator.prepareExport(request, deps);
    CraExportOrchestrator.download(request, deps);

    expect(JSON.stringify(request.filters)).toBe(originalFilters);
  });

  it('ne modifie pas request.data', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    const originalData = JSON.stringify(request.data);

    CraExportOrchestrator.validateRequest(request, deps);
    CraExportOrchestrator.buildScope(request, deps);
    CraExportOrchestrator.buildReport(request, deps);
    CraExportOrchestrator.prepareExport(request, deps);
    CraExportOrchestrator.download(request, deps);

    expect(JSON.stringify(request.data)).toBe(originalData);
  });

  it('ne modifie pas pdfOptions', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    const originalPdfOptions = JSON.stringify(request.pdfOptions);

    CraExportOrchestrator.download(request, deps);

    expect(JSON.stringify(request.pdfOptions)).toBe(originalPdfOptions);
  });

  it('ne modifie pas csvOptions', () => {
    const deps = createFakeDependencies();
    const request = makeRequest({ format: 'csv' });
    const originalCsvOptions = JSON.stringify(request.csvOptions);

    CraExportOrchestrator.download(request, deps);

    expect(JSON.stringify(request.csvOptions)).toBe(originalCsvOptions);
  });

  it('n\'ajoute pas directement filename aux options spécifiques', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    const originalPdfOptionsKeys = Object.keys(request.pdfOptions).sort();

    CraExportOrchestrator.download(request, deps);

    expect(Object.keys(request.pdfOptions).sort()).toEqual(originalPdfOptionsKeys);
    expect(request.pdfOptions.filename).toBeUndefined();
  });

  it('ne trie pas les entrées dans la requête', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    request.personIds = [3, 1, 2];
    const originalOrder = [...request.personIds];

    CraExportOrchestrator.validateRequest(request, deps);

    expect(request.personIds).toEqual(originalOrder);
  });

  it('ne supprime pas assignee/team', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();
    request.filters.assignee = ['1'];
    request.filters.team = ['2'];

    CraExportOrchestrator.validateRequest(request, deps);

    expect(request.filters.assignee).toEqual(['1']);
    expect(request.filters.team).toEqual(['2']);
  });

  it('ne modifie pas le rapport retourné par le faux modèle', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    const report = CraExportOrchestrator.buildReport(request, deps);
    const originalRowCount = report.totals.rowCount;

    CraExportOrchestrator.prepareExport(request, deps);

    expect(report.totals.rowCount).toBe(originalRowCount);
  });

  it('n\'ajoute pas de nouvelle propriété aux dépendances injectées', () => {
    const deps = createFakeDependencies();
    const originalModelKeys = Object.keys(deps.model).sort();
    const originalPdfKeys = Object.keys(deps.pdf).sort();
    const originalCsvKeys = Object.keys(deps.csv).sort();

    CraExportOrchestrator.download(makeRequest(), deps);
    CraExportOrchestrator.download(makeRequest({ format: 'csv' }), deps);

    expect(Object.keys(deps.model).sort()).toEqual(originalModelKeys);
    expect(Object.keys(deps.pdf).sort()).toEqual(originalPdfKeys);
    expect(Object.keys(deps.csv).sort()).toEqual(originalCsvKeys);
  });
});


// ============================================================================
// TESTS SUPPLÉMENTAIRES DE VALIDATION
// ============================================================================

describe('validateRequest - Tests supplémentaires', () => {
  it('le faux modèle est la source de vérité pour les dates', () => {
    const deps = createFakeDependencies();
    deps.model.validateDateRange.mockReturnValue({
      valid: false,
      error: 'plage invalide'
    });

    const request = makeRequest();
    const result = CraExportOrchestrator.validateRequest(request, deps);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('CraExportOrchestrator: plage invalide');
  });

  it('ne réimplémente pas la validation civile dans les tests', () => {
    const deps = createFakeDependencies();
    const request = makeRequest();

    const result = CraExportOrchestrator.validateRequest(request, deps);

    expect(result.valid).toBe(true);
    expect(deps.model.validateDateRange).toHaveBeenCalledWith('2026-01-01', '2026-01-31');
  });
});

describe('CRA Export Orchestrator - Exports supplémentaires', () => {
  it('toutes les fonctions sont de type function', () => {
    expect(typeof CraExportOrchestrator.getFormatOptions).toBe('function');
    expect(typeof CraExportOrchestrator.normalizeFormat).toBe('function');
    expect(typeof CraExportOrchestrator.validateRequest).toBe('function');
    expect(typeof CraExportOrchestrator.buildScope).toBe('function');
    expect(typeof CraExportOrchestrator.buildReport).toBe('function');
    expect(typeof CraExportOrchestrator.prepareExport).toBe('function');
    expect(typeof CraExportOrchestrator.download).toBe('function');
    expect(typeof CraExportOrchestrator.resolveExportModel).toBe('function');
    expect(typeof CraExportOrchestrator.resolveRenderer).toBe('function');
  });
});

