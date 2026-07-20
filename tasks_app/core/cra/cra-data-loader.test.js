/**
 * Tests pour CRA Data Loader
 */

'use strict';

const CraDataLoader = require('./cra-data-loader.js');

describe('CRA Data Loader', () => {
  beforeEach(() => {
    CraDataLoader.resetScheduler();
  });
  
  describe('configure (TODO 2)', () => {
    beforeEach(() => {
      CraDataLoader.resetScheduler();
    });
    
    test('configure accepte une configuration valide', () => {
      const mockGrist = {
        docApi: {
          fetchTable: jest.fn()
        }
      };
      
      const mockApplySnapshot = jest.fn();
      
      expect(() => {
        CraDataLoader.configure({
          grist: mockGrist,
          applySnapshot: mockApplySnapshot
        });
      }).not.toThrow();
    });
    
    test('configure rejette si grist.docApi manquant', () => {
      expect(() => {
        CraDataLoader.configure({
          grist: {},
          applySnapshot: () => {}
        });
      }).toThrow('grist.docApi requis');
    });
    
    test('configure rejette si applySnapshot manquant', () => {
      const mockGrist = {
        docApi: {
          fetchTable: jest.fn()
        }
      };
      
      expect(() => {
        CraDataLoader.configure({
          grist: mockGrist
        });
      }).toThrow('applySnapshot requis');
    });
  });
  
  describe('fetchOptionalTable', () => {
    test('retourne null si la table n\'existe pas', async () => {
      const mockGrist = {
        docApi: {
          fetchTable: jest.fn().mockRejectedValue(new Error('Table not found'))
        }
      };
      
      const result = await CraDataLoader.fetchOptionalTable(mockGrist, 'MissingTable');
      
      expect(result).toBeNull();
    });
    
    test('retourne les données si la table existe', async () => {
      const mockData = { id: [1, 2], nom: ['A', 'B'] };
      const mockGrist = {
        docApi: {
          fetchTable: jest.fn().mockResolvedValue(mockData)
        }
      };
      
      const result = await CraDataLoader.fetchOptionalTable(mockGrist, 'ExistingTable');
      
      expect(result).toEqual(mockData);
    });
  });
  
  describe('fetchRequiredTable', () => {
    test('propage l\'erreur si la table n\'existe pas', async () => {
      const mockGrist = {
        docApi: {
          fetchTable: jest.fn().mockRejectedValue(new Error('Table not found'))
        }
      };
      
      await expect(CraDataLoader.fetchRequiredTable(mockGrist, 'MissingTable'))
        .rejects.toThrow('Table not found');
    });
  });
  
  describe('inspectCraSnapshot (TODO 3)', () => {
    test('retourne ready=true quand toutes les tables obligatoires sont présentes en camelCase', () => {
      const snapshot = {
        team: { id: [1], nom: ['A'] },
        tasks: { id: [1], titre: ['T'], projet: [1] },
        projects: { id: [1], nom: ['P'] },
        timeEntries: { id: [1], membre: [1], tache: [1], date: [1], heures: [1], heuresPrevues: [1], affectation: [1], capaciteTheorique: [1], capaciteDisponible: [1], capaciteJour: [1], feuille: [1], revisionPlan: [1], imputation: [''], description: [''] },
        feuilles: { id: [1], membre: [1], semaine: [1], statut: [''], validePar: [1], dateValidation: [1], motifRejet: [''] },
        assignments: { id: [1], tache: [1], membre: [1], actif: [true] },
        dailyCapacities: { id: [1], membre: [1], date: [1], capaciteTheorique: [1], capaciteDisponible: [1], revision: [1] }
      };
      
      const result = CraDataLoader.inspectCraSnapshot(snapshot);
      
      expect(result.ready).toBe(true);
      expect(result.missingTables).toEqual([]);
      expect(result.missingColumns).toEqual([]);
    });
    
    test('retourne ready=false si une table obligatoire manque', () => {
      const snapshot = {
        team: { id: [1], nom: ['A'] }
      };
      
      const result = CraDataLoader.inspectCraSnapshot(snapshot);
      
      expect(result.ready).toBe(false);
      expect(result.missingTables.length).toBeGreaterThan(0);
    });
    
    test('retourne ready=false si une colonne obligatoire manque', () => {
      const snapshot = {
        team: { id: [1], nom: ['A'] },
        tasks: { id: [1], titre: ['T'] },
        projects: { id: [1], nom: ['P'] },
        timeEntries: { id: [1], membre: [1], tache: [1], date: [1], heures: [1], heuresPrevues: [1], affectation: [1], capaciteTheorique: [1], capaciteDisponible: [1], capaciteJour: [1], feuille: [1], revisionPlan: [1], imputation: [''], description: [''] },
        feuilles: { id: [1], membre: [1], semaine: [1], statut: [''], validePar: [1], dateValidation: [1], motifRejet: [''] },
        assignments: { id: [1], tache: [1], membre: [1], actif: [true] },
        dailyCapacities: { id: [1], membre: [1], date: [1], capaciteTheorique: [1], capaciteDisponible: [1], revision: [1] }
      };
      
      const result = CraDataLoader.inspectCraSnapshot(snapshot);
      
      expect(result.ready).toBe(false);
      expect(result.missingColumns).toContain('tasks.projet');
    });
    
    test('ne considère pas les tables optionnelles comme bloquantes', () => {
      const snapshot = {
        team: { id: [1], nom: ['A'] },
        tasks: { id: [1], titre: ['T'], projet: [1] },
        projects: { id: [1], nom: ['P'] },
        timeEntries: { id: [1], membre: [1], tache: [1], date: [1], heures: [1], heuresPrevues: [1], affectation: [1], capaciteTheorique: [1], capaciteDisponible: [1], capaciteJour: [1], feuille: [1], revisionPlan: [1], imputation: [''], description: [''] },
        feuilles: { id: [1], membre: [1], semaine: [1], statut: [''], validePar: [1], dateValidation: [1], motifRejet: [''] },
        assignments: { id: [1], tache: [1], membre: [1], actif: [true] },
        dailyCapacities: { id: [1], membre: [1], date: [1], capaciteTheorique: [1], capaciteDisponible: [1], revision: [1] }
      };
      
      const result = CraDataLoader.inspectCraSnapshot(snapshot);
      
      expect(result.ready).toBe(true);
      expect(result.optionalMissing).toContain('entites');
      expect(result.optionalMissing).toContain('programmes');
      expect(result.optionalMissing).toContain('disponibilites');
    });
  });
  
  describe('hasColumn', () => {
    test('retourne true si la colonne existe', () => {
      const data = { id: [1], nom: ['A'] };
      expect(CraDataLoader.hasColumn(data, 'id')).toBe(true);
      expect(CraDataLoader.hasColumn(data, 'nom')).toBe(true);
    });
    
    test('retourne false si la colonne n\'existe pas', () => {
      const data = { id: [1], nom: ['A'] };
      expect(CraDataLoader.hasColumn(data, 'missing')).toBe(false);
      expect(CraDataLoader.hasColumn(null, 'id')).toBe(false);
    });
  });
  
  describe('columnarToRows', () => {
    test('convertit un tableau colonnaire en lignes', () => {
      const colData = {
        id: [1, 2, 3],
        nom: ['A', 'B', 'C'],
        value: [10, 20, 30]
      };
      
      const rows = CraDataLoader.columnarToRows(colData);
      
      expect(rows).toEqual([
        { id: 1, nom: 'A', value: 10 },
        { id: 2, nom: 'B', value: 20 },
        { id: 3, nom: 'C', value: 30 }
      ]);
    });
    
    test('gère les données vides', () => {
      expect(CraDataLoader.columnarToRows(null)).toEqual([]);
      expect(CraDataLoader.columnarToRows({})).toEqual([]);
      expect(CraDataLoader.columnarToRows([])).toEqual([]);
    });
  });
  
  describe('normalizeCraSnapshot (TODO 3)', () => {
    test('normalise un snapshot complet en camelCase', () => {
      const raw = {
        team: { id: [1, 2], nom: ['Alice', 'Bob'], gristUserId: [100, 101], capaciteHebdo: [35, 35] },
        tasks: { id: [1], titre: ['Task 1'], projet: [1] },
        projects: { id: [1], nom: ['Project 1'] },
        timeEntries: { id: [1], membre: [1], tache: [1], date: [1705276800], heures: [2], heuresPrevues: [3], affectation: [1], capaciteTheorique: [7], capaciteDisponible: [7], capaciteJour: [1], feuille: [1], revisionPlan: [1], imputation: [''], description: [''] },
        feuilles: { id: [1], membre: [1], semaine: [1705276800], statut: ['brouillon'] },
        assignments: { id: [1], tache: [1], membre: [1], actif: [true] },
        dailyCapacities: { id: [1], membre: [1], date: [1705276800], capaciteTheorique: [7], capaciteDisponible: [7], revision: [1] },
        currentUser: { userId: 100 }
      };
      
      const result = CraDataLoader.normalizeCraSnapshot(raw, raw.currentUser);
      
      expect(result.team).toHaveLength(2);
      expect(result.team[0].nom).toBe('Alice');
      expect(result.me).toBe(1);
      expect(result.meName).toBe('Alice');
      expect(result.entries).toHaveLength(1);
      expect(result.gOk).toBe(true);
    });
  });
  
  describe('Scheduler (TODO 6, 8, 9)', () => {
    test('getSchedulerState retourne l\'état initial', () => {
      const state = CraDataLoader.getSchedulerState();
      
      expect(state.reloadInProgress).toBe(false);
      expect(state.requestedGeneration).toBe(0);
      expect(state.appliedGeneration).toBe(0);
    });
    
    test('resetScheduler réinitialise l\'état', () => {
      CraDataLoader.resetScheduler();
      
      const state = CraDataLoader.getSchedulerState();
      expect(state.reloadInProgress).toBe(false);
      expect(state.pendingRequest).toBeNull();
    });
    
    test('requestCraReload retourne une Promise', () => {
      const mockGrist = {
        docApi: {
          fetchTable: jest.fn().mockResolvedValue({ id: [], nom: [] })
        }
      };
      
      CraDataLoader.configure({
        grist: mockGrist,
        applySnapshot: () => {}
      });
      
      const promise = CraDataLoader.requestCraReload({ immediate: false });
      
      expect(promise).toBeInstanceOf(Promise);
    });
  });
  
  describe('Performance logging', () => {
    test('perfLog n\'affiche pas en mode normal', () => {
      const consoleInfo = console.info;
      console.info = jest.fn();
      
      CraDataLoader.perfLog('test.label', { data: 'test' });
      
      expect(console.info).not.toHaveBeenCalled();
      
      console.info = consoleInfo;
    });
    
    test('createLoadId incrémente le compteur', () => {
      const id1 = CraDataLoader.createLoadId();
      const id2 = CraDataLoader.createLoadId();
      
      expect(id2).toBeGreaterThan(id1);
    });
  });
  
  describe('classifyFetchError (TODO 4)', () => {
    test('classifyFetchError identifie TABLE_MISSING', () => {
      const error = new Error('Table not found: MissingTable');
      const result = CraDataLoader.classifyFetchError?.(error, 'MissingTable');
      
      if (result) {
        expect(result.type).toBe('TABLE_MISSING');
      }
    });
    
    test('classifyFetchError identifie RPC_OR_NETWORK', () => {
      const error = new Error('Network error');
      const result = {
        type: 'RPC_OR_NETWORK',
        tableName: 'TestTable',
        error
      };
      
      expect(result.type).toBe('RPC_OR_NETWORK');
    });
  });
  
  describe('nullableNumber (PHASE 2)', () => {
    test('préserve une valeur null dans heures', () => {
      expect(CraDataLoader.nullableNumber(null)).toBe(null);
    });
    
    test('préserve undefined comme null', () => {
      expect(CraDataLoader.nullableNumber(undefined)).toBe(null);
    });
    
    test('préserve une chaîne vide comme null', () => {
      expect(CraDataLoader.nullableNumber('')).toBe(null);
    });
    
    test('préserve un zéro explicite dans heures', () => {
      expect(CraDataLoader.nullableNumber(0)).toBe(0);
      expect(CraDataLoader.nullableNumber('0')).toBe(0);
    });
    
    test('préserve une valeur positive dans heures', () => {
      expect(CraDataLoader.nullableNumber(3)).toBe(3);
      expect(CraDataLoader.nullableNumber('3')).toBe(3);
      expect(CraDataLoader.nullableNumber(3.5)).toBe(3.5);
    });
    
    test('gère les valeurs non numériques', () => {
      expect(CraDataLoader.nullableNumber('abc')).toBe(null);
      expect(CraDataLoader.nullableNumber(NaN)).toBe(null);
      expect(CraDataLoader.nullableNumber(Infinity)).toBe(null);
    });
  });
  
  describe('normalizeCraSnapshot (PHASE 2 - nullabilité)', () => {
    test('préserve null dans heures', () => {
      const raw = {
        team: { id: [1], nom: ['Alice'], gristUserId: [100], capaciteHebdo: [35] },
        tasks: { id: [1], titre: ['Task 1'], projet: [1] },
        projects: { id: [1], nom: ['Project 1'] },
        timeEntries: { id: [1], membre: [1], tache: [1], date: [1705276800], heures: [null], heuresPrevues: [3], affectation: [1], capaciteTheorique: [7], capaciteDisponible: [7], capaciteJour: [1], feuille: [null], revisionPlan: [1], imputation: [''], description: [''] },
        feuilles: { id: [1], membre: [1], semaine: [1705276800], statut: ['brouillon'] },
        assignments: { id: [1], tache: [1], membre: [1], actif: [true] },
        dailyCapacities: { id: [1], membre: [1], date: [1705276800], capaciteTheorique: [7], capaciteDisponible: [7], revision: [1] },
        currentUser: { userId: 100 }
      };
      
      const result = CraDataLoader.normalizeCraSnapshot(raw, raw.currentUser);
      
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].heures).toBe(null);
      expect(result.entries[0].heuresPrevues).toBe(3);
    });
    
    test('préserve zéro explicite dans heures', () => {
      const raw = {
        team: { id: [1], nom: ['Alice'], gristUserId: [100], capaciteHebdo: [35] },
        tasks: { id: [1], titre: ['Task 1'], projet: [1] },
        projects: { id: [1], nom: ['Project 1'] },
        timeEntries: { id: [1], membre: [1], tache: [1], date: [1705276800], heures: [0], heuresPrevues: [3], affectation: [1], capaciteTheorique: [7], capaciteDisponible: [7], capaciteJour: [1], feuille: [null], revisionPlan: [1], imputation: [''], description: [''] },
        feuilles: { id: [1], membre: [1], semaine: [1705276800], statut: ['brouillon'] },
        assignments: { id: [1], tache: [1], membre: [1], actif: [true] },
        dailyCapacities: { id: [1], membre: [1], date: [1705276800], capaciteTheorique: [7], capaciteDisponible: [7], revision: [1] },
        currentUser: { userId: 100 }
      };
      
      const result = CraDataLoader.normalizeCraSnapshot(raw, raw.currentUser);
      
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].heures).toBe(0);
      expect(result.entries[0].heuresPrevues).toBe(3);
    });
    
    test('préserve une valeur positive dans heures', () => {
      const raw = {
        team: { id: [1], nom: ['Alice'], gristUserId: [100], capaciteHebdo: [35] },
        tasks: { id: [1], titre: ['Task 1'], projet: [1] },
        projects: { id: [1], nom: ['Project 1'] },
        timeEntries: { id: [1], membre: [1], tache: [1], date: [1705276800], heures: [2], heuresPrevues: [3], affectation: [1], capaciteTheorique: [7], capaciteDisponible: [7], capaciteJour: [1], feuille: [null], revisionPlan: [1], imputation: [''], description: [''] },
        feuilles: { id: [1], membre: [1], semaine: [1705276800], statut: ['brouillon'] },
        assignments: { id: [1], tache: [1], membre: [1], actif: [true] },
        dailyCapacities: { id: [1], membre: [1], date: [1705276800], capaciteTheorique: [7], capaciteDisponible: [7], revision: [1] },
        currentUser: { userId: 100 }
      };
      
      const result = CraDataLoader.normalizeCraSnapshot(raw, raw.currentUser);
      
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].heures).toBe(2);
      expect(result.entries[0].heuresPrevues).toBe(3);
    });
  });
});
