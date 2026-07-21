/**
 * Tests unitaires pour CRA Export Model
 * 
 * Cette suite de tests verrouille le contrat fonctionnel du modèle d'export
 * du CRA, utilisé ultérieurement par les générateurs PDF et CSV.
 * 
 * Contrats testés :
 * - Valeur affichée = heures si explicite, sinon heuresPrevues
 * - heures = null ≠ heures = 0
 * - Regroupement par cellule (personne + date + tâche)
 * - Ordre des personnes conservé selon scope.personIds
 * - Durées en minutes entières
 * - Immutabilité des données reçues
 * 
 * Usage: npm test -- cra-export-model.test.js --runInBand
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Charger le contrôleur CRA en premier (requis par le modèle)
require('./cra-time-entry-controller.js');

const CraExportModel = require('./cra-export-model.js');

const {
  buildReport,
  normalizeScope,
  validateDateRange,
  isValidDateIso,
  hoursToMinutes,
  resolveCraController
} = CraExportModel;

// ============================================================================
// FIXTURES
// ============================================================================

const baseTeam = [
  { id: 1, nom: 'Alice' },
  { id: 2, nom: 'Bob' },
  { id: 3, nom: 'Claire' }
];

const baseProgrammes = [
  { id: 10, nom: 'Programme Alpha' },
  { id: 20, nom: 'Programme Beta' },
  { id: 300, nom: 'Programme Legacy' }
];

const baseProjects = [
  {
    id: 100,
    nom: 'Projet Alpha',
    programme: 10,
    portefeuille: 999
  },
  {
    id: 200,
    nom: 'Projet Beta',
    programme: 20
  },
  {
    id: 300,
    nom: 'Projet Legacy',
    portefeuille: 300
  }
];

const baseTasks = [
  { id: 1000, titre: 'Pilotage', projet: 100 },
  { id: 1001, titre: 'Développement', projet: 100 },
  { id: 2000, titre: 'Recette', projet: 200 },
  { id: 3000, titre: 'Legacy', projet: 300 },
  { id: 4000, titre: 'Sans projet', projet: null }
];

// Helper pour construire des options de test
function makeOptions(overrides = {}) {
  const base = {
    startDateIso: '2026-01-01',
    endDateIso: '2026-01-31',
    scope: {
      personIds: [1],
      projectIds: [],
      programmeIds: [],
      taskIds: []
    },
    entries: [],
    team: baseTeam,
    tasks: baseTasks,
    projects: baseProjects,
    programmes: baseProgrammes
  };
  
  // Fusion profonde pour le scope uniquement
  const result = { ...base, ...overrides };
  if (overrides.scope) {
    result.scope = {
      ...base.scope,
      ...overrides.scope
    };
  }
  
  return result;
}

// Helper pour créer un timestamp Grist (secondes Unix)
function gristTimestamp(year, month, day) {
  // month est 1-indexé (1 = janvier)
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return Math.floor(date.getTime() / 1000);
}

// ============================================================================
// EXPORTS DU MODULE
// ============================================================================

describe('CRA Export Model - Exports', () => {
  
  test('CommonJS expose les fonctions requises', () => {
    expect(typeof buildReport).toBe('function');
    expect(typeof normalizeScope).toBe('function');
    expect(typeof validateDateRange).toBe('function');
    expect(typeof isValidDateIso).toBe('function');
    expect(typeof hoursToMinutes).toBe('function');
  });
  
  test('Export navigateur avec CRAController valide', () => {
    const controllerPath = path.resolve(__dirname, 'cra-time-entry-controller.js');
    const controllerCode = fs.readFileSync(controllerPath, 'utf-8');
    
    const modelPath = path.resolve(__dirname, 'cra-export-model.js');
    const modelCode = fs.readFileSync(modelPath, 'utf-8');
    
    const sandbox = {
      globalThis: {},
      module: undefined,
      exports: undefined,
      require: undefined
    };
    
    // Exécuter d'abord le contrôleur
    vm.runInNewContext(controllerCode, sandbox);
    
    // Puis le modèle
    vm.runInNewContext(modelCode, sandbox);
    
    expect(sandbox.globalThis.CRAController).toBeDefined();
    expect(sandbox.globalThis.CraExportModel).toBeDefined();
    expect(typeof sandbox.globalThis.CraExportModel.buildReport).toBe('function');
  });
  
  test('Export navigateur avec CRAController vide produit une erreur explicite', () => {
    const modelPath = path.resolve(__dirname, 'cra-export-model.js');
    const modelCode = fs.readFileSync(modelPath, 'utf-8');
    
    const sandbox = {
      globalThis: {
        CRAController: {}
      },
      module: undefined,
      exports: undefined,
      require: undefined
    };
    
    vm.runInNewContext(modelCode, sandbox);
    
    // Tenter d'utiliser le modèle
    expect(() => {
      sandbox.globalThis.CraExportModel.buildReport({
        startDateIso: '2026-01-01',
        endDateIso: '2026-01-31',
        scope: { personIds: [1] },
        entries: [],
        team: [],
        tasks: [],
        projects: [],
        programmes: []
      });
    }).toThrow(/CRAController invalide/);
  });
});

// ============================================================================
// NORMALISATION DU SCOPE
// ============================================================================

describe('normalizeScope', () => {
  
  test('convertit les nombres en chaînes', () => {
    const result = normalizeScope({
      personIds: [1, 2, 3],
      projectIds: [],
      programmeIds: [],
      taskIds: []
    });
    
    expect(result.personIds).toEqual(['1', '2', '3']);
  });
  
  test('supprime les doublons', () => {
    const result = normalizeScope({
      personIds: [1, '1', 2, 1, '2'],
      projectIds: [],
      programmeIds: [],
      taskIds: []
    });
    
    expect(result.personIds).toEqual(['1', '2']);
  });
  
  test('conserve l ordre de première apparition', () => {
    const result = normalizeScope({
      personIds: [2, '1', 2, 3, '1'],
      projectIds: [],
      programmeIds: [],
      taskIds: []
    });
    
    expect(result.personIds).toEqual(['2', '1', '3']);
  });
  
  test('ignore null, undefined et chaînes vides', () => {
    const result = normalizeScope({
      personIds: [1, null, '2', undefined, '', 3],
      projectIds: [],
      programmeIds: [],
      taskIds: []
    });
    
    expect(result.personIds).toEqual(['1', '2', '3']);
  });
  
  test('retourne toujours les quatre clés', () => {
    const result = normalizeScope({});
    
    expect(result).toHaveProperty('personIds');
    expect(result).toHaveProperty('projectIds');
    expect(result).toHaveProperty('programmeIds');
    expect(result).toHaveProperty('taskIds');
    expect(Array.isArray(result.personIds)).toBe(true);
  });
  
  test('gère un scope null ou absent', () => {
    expect(normalizeScope(null).personIds).toEqual([]);
    expect(normalizeScope(undefined).personIds).toEqual([]);
    expect(normalizeScope({}).personIds).toEqual([]);
  });
  
  test('ne modifie pas l objet reçu', () => {
    const input = {
      personIds: [1, 2],
      projectIds: [100],
      programmeIds: [],
      taskIds: []
    };
    const inputCopy = JSON.parse(JSON.stringify(input));
    
    normalizeScope(input);
    
    expect(input).toEqual(inputCopy);
  });
  
  test('ne trie pas les personIds', () => {
    const result = normalizeScope({
      personIds: [3, 1, 2],
      projectIds: [],
      programmeIds: [],
      taskIds: []
    });
    
    expect(result.personIds).toEqual(['3', '1', '2']);
  });
});

// ============================================================================
// VALIDATION DES DATES
// ============================================================================

describe('Validation des dates', () => {
  
  test('plage valide', () => {
    const result = validateDateRange('2026-01-01', '2026-01-31');
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });
  
  test('plage d un seul jour', () => {
    const result = validateDateRange('2026-01-15', '2026-01-15');
    expect(result.valid).toBe(true);
  });
  
  test('date de début manquante', () => {
    const result = validateDateRange(null, '2026-01-31');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('obligatoires');
  });
  
  test('date de fin manquante', () => {
    const result = validateDateRange('2026-01-01', null);
    expect(result.valid).toBe(false);
  });
  
  test('mauvais format', () => {
    expect(validateDateRange('01/01/2026', '2026-01-31').valid).toBe(false);
    expect(validateDateRange('2026-1-1', '2026-01-31').valid).toBe(false);
  });
  
  test('mois invalide', () => {
    expect(validateDateRange('2026-13-01', '2026-13-31').valid).toBe(false);
    expect(validateDateRange('2026-00-01', '2026-01-31').valid).toBe(false);
  });
  
  test('jour invalide', () => {
    expect(validateDateRange('2026-01-32', '2026-01-31').valid).toBe(false);
    expect(validateDateRange('2026-02-30', '2026-03-01').valid).toBe(false);
  });
  
  test('année bissextile valide', () => {
    expect(validateDateRange('2024-02-29', '2024-02-29').valid).toBe(true);
  });
  
  test('année non bissextile invalide', () => {
    expect(validateDateRange('2025-02-29', '2025-03-01').valid).toBe(false);
  });
  
  test('date de début après la date de fin', () => {
    const result = validateDateRange('2026-01-31', '2026-01-01');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('antérieur');
  });
  
  test('buildReport lève une erreur pour une plage invalide', () => {
    expect(() => {
      buildReport({
        startDateIso: '2026-01-31',
        endDateIso: '2026-01-01',
        scope: { personIds: [1] },
        entries: [],
        team: baseTeam,
        tasks: baseTasks,
        projects: baseProjects,
        programmes: baseProgrammes
      });
    }).toThrow(/antérieur/);
  });
});

// ============================================================================
// CONVERSION EN MINUTES
// ============================================================================

describe('hoursToMinutes', () => {
  
  test('1 heure = 60 minutes', () => {
    expect(hoursToMinutes(1)).toBe(60);
  });
  
  test('3,5 heures = 210 minutes', () => {
    expect(hoursToMinutes(3.5)).toBe(210);
  });
  
  test('0,8 heure = 48 minutes', () => {
    expect(hoursToMinutes(0.8)).toBe(48);
  });
  
  test('1,333333 heure = arrondi entier', () => {
    expect(hoursToMinutes(1.333333)).toBe(80);
  });
  
  test('0 = 0', () => {
    expect(hoursToMinutes(0)).toBe(0);
  });
  
  test('valeur non numérique = 0', () => {
    expect(hoursToMinutes('abc')).toBe(0);
    expect(hoursToMinutes(null)).toBe(0);
    expect(hoursToMinutes(undefined)).toBe(0);
  });
});

// ============================================================================
// buildReport - VALEUR AFFICHÉE DES CELLULES
// ============================================================================

describe('buildReport - Valeur affichée des cellules', () => {
  
  test('Proposition non modifiée (heures = null)', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: null,
        heuresPrevues: 3
      }
    ];
    
    const report = buildReport(makeOptions({ entries }));
    
    expect(report.totals.rowCount).toBe(1);
    expect(report.totals.totalMinutes).toBe(180);
    expect(report.persons[0].rows[0].durationMinutes).toBe(180);
  });
  
  test('Réalisé explicite prioritaire', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 3
      }
    ];
    
    const report = buildReport(makeOptions({ entries }));
    
    expect(report.totals.rowCount).toBe(1);
    expect(report.totals.totalMinutes).toBe(120);
    expect(report.persons[0].rows[0].durationMinutes).toBe(120);
  });
  
  test('Zéro explicite exclut la ligne', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 0,
        heuresPrevues: 3
      }
    ];
    
    const report = buildReport(makeOptions({ entries }));
    
    expect(report.totals.rowCount).toBe(0);
    expect(report.totals.totalMinutes).toBe(0);
    expect(report.diagnostics.skippedZeroDurationCells).toBe(1);
    expect(report.diagnostics.selectedPersonsWithoutRows).toContain('1');
  });
  
  test('Plusieurs entrées dans la même cellule', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: null,
        heuresPrevues: 3
      },
      {
        id: 2,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 1,
        heuresPrevues: 2
      }
    ];
    
    const report = buildReport(makeOptions({ entries }));
    
    expect(report.totals.rowCount).toBe(1);
    expect(report.totals.totalMinutes).toBe(240);
    expect(report.persons[0].rows.length).toBe(1);
    expect(report.persons[0].rows[0].durationMinutes).toBe(240);
  });
  
  test('Deux tâches différentes = deux lignes', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      },
      {
        id: 2,
        membre: 1,
        tache: 1001,
        date: gristTimestamp(2026, 1, 5),
        heures: 3,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({ entries }));
    
    expect(report.totals.rowCount).toBe(2);
    expect(report.persons[0].rows.length).toBe(2);
  });
  
  test('Même tâche, deux dates différentes = deux lignes', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      },
      {
        id: 2,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 6),
        heures: 3,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({ entries }));
    
    expect(report.totals.rowCount).toBe(2);
    expect(report.persons[0].rows.length).toBe(2);
  });
  
  test('Deux personnes, même tâche, même date = deux lignes séparées', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      },
      {
        id: 2,
        membre: 2,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 3,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      scope: { personIds: [1, 2] },
      entries
    }));
    
    expect(report.totals.rowCount).toBe(2);
    expect(report.totals.exportedPersonCount).toBe(2);
    expect(report.persons[0].rows.length).toBe(1);
    expect(report.persons[1].rows.length).toBe(1);
  });
});

// ============================================================================
// buildReport - PÉRIODE
// ============================================================================

describe('buildReport - Période', () => {
  
  test('Date de début inclusive', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 1),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      startDateIso: '2026-01-01',
      endDateIso: '2026-01-31',
      entries
    }));
    
    expect(report.totals.rowCount).toBe(1);
  });
  
  test('Date de fin inclusive', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 31),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      startDateIso: '2026-01-01',
      endDateIso: '2026-01-31',
      entries
    }));
    
    expect(report.totals.rowCount).toBe(1);
  });
  
  test('Entrée avant le début est exclue', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2025, 12, 31),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      startDateIso: '2026-01-01',
      endDateIso: '2026-01-31',
      entries
    }));
    
    expect(report.totals.rowCount).toBe(0);
    expect(report.diagnostics.skippedOutsidePeriod).toBe(1);
  });
  
  test('Entrée après la fin est exclue', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 2, 1),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      startDateIso: '2026-01-01',
      endDateIso: '2026-01-31',
      entries
    }));
    
    expect(report.totals.rowCount).toBe(0);
    expect(report.diagnostics.skippedOutsidePeriod).toBe(1);
  });
  
  test('Timestamp Grist en secondes Unix', () => {
    // 2026-01-05 à midi UTC
    const timestamp = Date.UTC(2026, 0, 5, 12, 0, 0) / 1000;
    
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: timestamp,
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      startDateIso: '2026-01-05',
      endDateIso: '2026-01-05',
      entries
    }));
    
    expect(report.totals.rowCount).toBe(1);
  });
});

// ============================================================================
// buildReport - PERSONNES
// ============================================================================

describe('buildReport - Personnes', () => {
  
  test('Scope vide sécurisé (personIds = [])', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      scope: { personIds: [] },
      entries
    }));
    
    expect(report.persons).toEqual([]);
    expect(report.totals.selectedPersonCount).toBe(0);
    expect(report.totals.exportedPersonCount).toBe(0);
    expect(report.totals.rowCount).toBe(0);
  });
  
  test('Personne hors scope', () => {
    const entries = [
      {
        id: 1,
        membre: 2,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      scope: { personIds: [1] },
      entries
    }));
    
    expect(report.totals.rowCount).toBe(0);
    expect(report.diagnostics.skippedOutsideScope).toBe(1);
  });
  
  test('Ordre explicite conservé', () => {
    const entries = [
      {
        id: 1,
        membre: 2,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      },
      {
        id: 2,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 3,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      scope: { personIds: [2, 1] },
      entries
    }));
    
    expect(report.persons.length).toBe(2);
    expect(report.persons[0].id).toBe(2);
    expect(report.persons[1].id).toBe(1);
  });
  
  test('Personne sans ligne dans diagnostics', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      scope: { personIds: [1, 2] },
      entries
    }));
    
    expect(report.persons.length).toBe(1);
    expect(report.persons[0].id).toBe(1);
    expect(report.diagnostics.selectedPersonsWithoutRows).toContain('2');
  });
  
  test('Personne inconnue', () => {
    const entries = [
      {
        id: 1,
        membre: 999,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      scope: { personIds: [999] },
      entries
    }));
    
    expect(report.totals.rowCount).toBe(0);
    expect(report.diagnostics.skippedUnknownPerson).toBe(1);
  });
});

// ============================================================================
// buildReport - SCOPE ANALYTIQUE (PROJET, PROGRAMME, TÂCHE)
// ============================================================================

describe('buildReport - Scope analytique', () => {
  
  test('Filtre par tâche', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      },
      {
        id: 2,
        membre: 1,
        tache: 1001,
        date: gristTimestamp(2026, 1, 5),
        heures: 3,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      scope: { taskIds: [1000] },
      entries
    }));
    
    expect(report.totals.rowCount).toBe(1);
    expect(report.persons[0].rows[0].taskId).toBe(1000);
  });
  
  test('Filtre par projet', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      },
      {
        id: 2,
        membre: 1,
        tache: 2000,
        date: gristTimestamp(2026, 1, 5),
        heures: 3,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      scope: { projectIds: [100] },
      entries
    }));
    
    expect(report.totals.rowCount).toBe(1);
    expect(report.persons[0].rows[0].taskId).toBe(1000);
  });
  
  test('Filtre par programme', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      },
      {
        id: 2,
        membre: 1,
        tache: 2000,
        date: gristTimestamp(2026, 1, 5),
        heures: 3,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      scope: { programmeIds: [10] },
      entries
    }));
    
    expect(report.totals.rowCount).toBe(1);
    expect(report.persons[0].rows[0].programmeId).toBe('10');
  });
  
  test('Priorité programme sur portefeuille', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    // Projet avec programme: 10, portefeuille: 999
    const reportProgramme = buildReport(makeOptions({
      scope: { programmeIds: [10] },
      entries
    }));
    
    const reportPortefeuille = buildReport(makeOptions({
      scope: { programmeIds: [999] },
      entries
    }));
    
    expect(reportProgramme.totals.rowCount).toBe(1);
    expect(reportPortefeuille.totals.rowCount).toBe(0);
  });
  
  test('Repli sur portefeuille', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 3000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    // Projet Legacy: programme: null, portefeuille: 300
    const report = buildReport(makeOptions({
      scope: { programmeIds: [300] },
      entries
    }));
    
    expect(report.totals.rowCount).toBe(1);
    expect(report.persons[0].rows[0].programmeId).toBe('300');
  });
  
  test('Programme non correspondant exclut la ligne', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      scope: { programmeIds: [20] },
      entries
    }));
    
    expect(report.totals.rowCount).toBe(0);
    expect(report.diagnostics.skippedOutsideScope).toBe(1);
  });
  
  test('Tableau vide = aucune restriction', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      scope: {
        projectIds: [],
        programmeIds: [],
        taskIds: []
      },
      entries
    }));
    
    expect(report.totals.rowCount).toBe(1);
  });
  
  test('IDs nombres et chaînes compatibles', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const reportNombres = buildReport(makeOptions({
      scope: { projectIds: [100] },
      entries
    }));
    
    const reportChaines = buildReport(makeOptions({
      scope: { projectIds: ['100'] },
      entries
    }));
    
    expect(reportNombres.totals.rowCount).toBe(1);
    expect(reportChaines.totals.rowCount).toBe(1);
  });
});

// ============================================================================
// buildReport - LIBELLÉS
// ============================================================================

describe('buildReport - Libellés', () => {
  
  test('Ligne nominale avec tous les libellés', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({ entries }));
    const row = report.persons[0].rows[0];
    
    expect(row.personId).toBe(1);
    expect(row.personName).toBe('Alice');
    expect(row.taskId).toBe(1000);
    expect(row.taskName).toBe('Pilotage');
    expect(row.projectId).toBe(100);
    expect(row.projectName).toBe('Projet Alpha');
    expect(row.programmeId).toBe('10');
    expect(row.programmeName).toBe('Programme Alpha');
  });
  
  test('Tâche sans projet', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 4000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({ entries }));
    const row = report.persons[0].rows[0];
    
    expect(row.projectId).toBeNull();
    expect(row.projectName).toBe('');
    expect(row.programmeId).toBeNull();
    expect(row.programmeName).toBe('');
  });
  
  test('Projet avec programme inconnu', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    // Programme 999 n'existe pas dans baseProgrammes
    const report = buildReport(makeOptions({
      entries,
      programmes: []
    }));
    
    const row = report.persons[0].rows[0];
    expect(row.programmeId).toBe('10');
    expect(row.programmeName).toBe('');
  });
  
  test('Tâche inconnue', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 9999,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({ entries }));
    
    expect(report.totals.rowCount).toBe(0);
    expect(report.diagnostics.skippedUnknownTask).toBe(1);
  });
});

// ============================================================================
// buildReport - TRI
// ============================================================================

describe('buildReport - Tri', () => {
  
  test('Tri des lignes par date, projet, tâche', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1001,
        date: gristTimestamp(2026, 1, 6),
        heures: 2,
        heuresPrevues: 0
      },
      {
        id: 2,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 3,
        heuresPrevues: 0
      },
      {
        id: 3,
        membre: 1,
        tache: 1001,
        date: gristTimestamp(2026, 1, 5),
        heures: 4,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({ entries }));
    const rows = report.persons[0].rows;
    
    // Ordre attendu :
    // 1. 2026-01-05 / Projet Alpha / Développement (1001)
    // 2. 2026-01-05 / Projet Alpha / Pilotage (1000)
    // 3. 2026-01-06 / Projet Alpha / Développement (1001)
    
    expect(rows[0].dateIso).toBe('2026-01-05');
    expect(rows[0].taskId).toBe(1001);
    
    expect(rows[1].dateIso).toBe('2026-01-05');
    expect(rows[1].taskId).toBe(1000);
    
    expect(rows[2].dateIso).toBe('2026-01-06');
  });
  
  test('Ordre des personnes selon scope', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      },
      {
        id: 2,
        membre: 2,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 3,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      scope: { personIds: [2, 1] },
      entries
    }));
    
    expect(report.persons[0].id).toBe(2);
    expect(report.persons[1].id).toBe(1);
  });
});

// ============================================================================
// buildReport - TOTAUX ET DIAGNOSTICS
// ============================================================================

describe('buildReport - Totaux et diagnostics', () => {
  
  test('Totaux avec plusieurs personnes et lignes', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      },
      {
        id: 2,
        membre: 1,
        tache: 1001,
        date: gristTimestamp(2026, 1, 5),
        heures: 3,
        heuresPrevues: 0
      },
      {
        id: 3,
        membre: 2,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 4,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      scope: { personIds: [1, 2] },
      entries
    }));
    
    expect(report.totals.selectedPersonCount).toBe(2);
    expect(report.totals.exportedPersonCount).toBe(2);
    expect(report.totals.rowCount).toBe(3);
    expect(report.totals.totalMinutes).toBe(540); // (2+3)*60 + 4*60
    
    expect(report.persons[0].totalMinutes).toBe(300); // (2+3)*60
    expect(report.persons[1].totalMinutes).toBe(240); // 4*60
  });
  
  test('Diagnostics skippedOutsidePeriod', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2025, 12, 31),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      startDateIso: '2026-01-01',
      endDateIso: '2026-01-31',
      entries
    }));
    
    expect(report.diagnostics.skippedOutsidePeriod).toBe(1);
  });
  
  test('Diagnostics skippedOutsideScope', () => {
    const entries = [
      {
        id: 1,
        membre: 2,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({
      scope: { personIds: [1] },
      entries
    }));
    
    expect(report.diagnostics.skippedOutsideScope).toBe(1);
  });
});

// ============================================================================
// buildReport - IMMUTABILITÉ
// ============================================================================

describe('buildReport - Immutabilité', () => {
  
  test('Ne modifie pas les données reçues', () => {
    const scope = { personIds: [1], projectIds: [], programmeIds: [], taskIds: [] };
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    const team = JSON.parse(JSON.stringify(baseTeam));
    const tasks = JSON.parse(JSON.stringify(baseTasks));
    const projects = JSON.parse(JSON.stringify(baseProjects));
    const programmes = JSON.parse(JSON.stringify(baseProgrammes));
    
    const scopeCopy = JSON.parse(JSON.stringify(scope));
    const entriesCopy = JSON.parse(JSON.stringify(entries));
    const teamCopy = JSON.parse(JSON.stringify(team));
    const tasksCopy = JSON.parse(JSON.stringify(tasks));
    const projectsCopy = JSON.parse(JSON.stringify(projects));
    const programmesCopy = JSON.parse(JSON.stringify(programmes));
    
    buildReport({
      startDateIso: '2026-01-01',
      endDateIso: '2026-01-31',
      scope,
      entries,
      team,
      tasks,
      projects,
      programmes
    });
    
    expect(scope).toEqual(scopeCopy);
    expect(entries).toEqual(entriesCopy);
    expect(team).toEqual(teamCopy);
    expect(tasks).toEqual(tasksCopy);
    expect(projects).toEqual(projectsCopy);
    expect(programmes).toEqual(programmesCopy);
  });
});

// ============================================================================
// buildReport - ROBUSTESSE
// ============================================================================

describe('buildReport - Robustesse', () => {
  
  test('buildReport() sans options lève une erreur', () => {
    expect(() => {
      buildReport();
    }).toThrow(/options requises/);
  });
  
  test('Tableaux undefined ne font pas planter', () => {
    expect(() => {
      buildReport({
        startDateIso: '2026-01-01',
        endDateIso: '2026-01-31',
        scope: { personIds: [1] },
        entries: undefined,
        team: undefined,
        tasks: undefined,
        projects: undefined,
        programmes: undefined
      });
    }).not.toThrow();
  });
  
  test('Aucune entrée produit un rapport vide', () => {
    const report = buildReport(makeOptions({ entries: [] }));
    
    expect(report.persons).toEqual([]);
    expect(report.totals.rowCount).toBe(0);
    expect(report.totals.totalMinutes).toBe(0);
  });
  
  test('Scope incomplet est normalisé', () => {
    const report = buildReport({
      startDateIso: '2026-01-01',
      endDateIso: '2026-01-31',
      scope: { personIds: [1] },
      entries: [],
      team: baseTeam,
      tasks: baseTasks,
      projects: baseProjects,
      programmes: baseProgrammes
    });
    
    expect(report.scope).toHaveProperty('personIds');
    expect(report.scope).toHaveProperty('projectIds');
    expect(report.scope).toHaveProperty('programmeIds');
    expect(report.scope).toHaveProperty('taskIds');
  });
  
  test('Projet inconnu avec libellés vides', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 4000,
        date: gristTimestamp(2026, 1, 5),
        heures: 2,
        heuresPrevues: 0
      }
    ];
    
    const report = buildReport(makeOptions({ entries }));
    
    expect(report.totals.rowCount).toBe(1);
    expect(report.persons[0].rows[0].projectName).toBe('');
    expect(report.persons[0].rows[0].programmeName).toBe('');
  });
  
  test('Valeurs non numériques ne produisent pas de ligne positive', () => {
    const entries = [
      {
        id: 1,
        membre: 1,
        tache: 1000,
        date: gristTimestamp(2026, 1, 5),
        heures: 'abc',
        heuresPrevues: 'xyz'
      }
    ];
    
    const report = buildReport(makeOptions({ entries }));
    
    expect(report.totals.rowCount).toBe(0);
  });
});
