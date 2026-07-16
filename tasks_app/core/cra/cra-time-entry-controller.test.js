/**
 * Tests pour CRA Time Entry Controller
 */

'use strict';

const {
  resolveActiveAssignment,
  resolveEditableCellEntry,
  canDeleteEmptyManualEntry,
  hasPlanningFields,
  hasSheetLink,
  determineEntryAction
} = require('./cra-time-entry-controller.js');

describe('CRA Time Entry Controller', () => {
  
  describe('resolveActiveAssignment', () => {
    test('retourne missing quand aucune affectation active', () => {
      const assignments = [
        { id: 1, tache: 1, membre: 1, actif: false },
        { id: 2, tache: 2, membre: 1, actif: true }
      ];
      
      const result = resolveActiveAssignment(1, 1, assignments);
      
      expect(result.status).toBe('missing');
      expect(result.assignment).toBeNull();
      expect(result.assignments).toEqual([]);
    });
    
    test('retourne found quand une affectation active existe', () => {
      const assignments = [
        { id: 1, tache: 1, membre: 1, actif: true },
        { id: 2, tache: 2, membre: 1, actif: true }
      ];
      
      const result = resolveActiveAssignment(1, 1, assignments);
      
      expect(result.status).toBe('found');
      expect(result.assignment).toEqual(assignments[0]);
      expect(result.assignments).toEqual([assignments[0]]);
    });
    
    test('retourne ambiguous quand plusieurs affectations actives', () => {
      const assignments = [
        { id: 1, tache: 1, membre: 1, actif: true },
        { id: 2, tache: 1, membre: 1, actif: true }
      ];
      
      const result = resolveActiveAssignment(1, 1, assignments);
      
      expect(result.status).toBe('ambiguous');
      expect(result.assignment).toBeNull();
      expect(result.assignments).toEqual(assignments);
    });
    
    test('ignore les affectations inactives', () => {
      const assignments = [
        { id: 1, tache: 1, membre: 1, actif: false },
        { id: 2, tache: 1, membre: 1, actif: true }
      ];
      
      const result = resolveActiveAssignment(1, 1, assignments);
      
      expect(result.status).toBe('found');
      expect(result.assignment).toEqual(assignments[1]);
    });
  });
  
  describe('resolveEditableCellEntry', () => {
    test('retourne none quand aucune entrée', () => {
      const entries = [];
      const result = resolveEditableCellEntry(entries, 1, '2024-01-15', 1, null);
      
      expect(result.status).toBe('none');
      expect(result.entry).toBeNull();
    });
    
    test('retourne found quand une entrée correspond', () => {
      const entries = [
        { id: 1, tache: 1, membre: 1, date: 1705276800, heures: 2 },
        { id: 2, tache: 2, membre: 1, date: 1705276800, heures: 3 }
      ];
      
      const result = resolveEditableCellEntry(entries, 1, '2024-01-15', 1, null);
      
      expect(result.status).toBe('found');
      expect(result.entry).toEqual(entries[0]);
    });
    
    test('priorise l\'entrée avec affectation correspondante', () => {
      const entries = [
        { id: 1, tache: 1, membre: 1, date: 1705276800, heures: 2, affectation: 10 },
        { id: 2, tache: 1, membre: 1, date: 1705276800, heures: 3, affectation: 20 }
      ];
      const activeAssignment = { id: 20, tache: 1, membre: 1 };
      
      const result = resolveEditableCellEntry(entries, 1, '2024-01-15', 1, activeAssignment);
      
      expect(result.status).toBe('found');
      expect(result.entry).toEqual(entries[1]);
    });
    
    test('retourne multiple en cas d\'ambiguïté non résolue', () => {
      const entries = [
        { id: 1, tache: 1, membre: 1, date: 1705276800, heures: 2 },
        { id: 2, tache: 1, membre: 1, date: 1705276800, heures: 3 }
      ];
      
      const result = resolveEditableCellEntry(entries, 1, '2024-01-15', 1, null);
      
      expect(result.status).toBe('multiple');
      expect(result.entry).toBeNull();
      expect(result.entries).toHaveLength(2);
    });
  });
  
  describe('canDeleteEmptyManualEntry', () => {
    test('autorise la suppression d\'une ligne manuelle vide', () => {
      const entry = {
        id: 1,
        affectation: null,
        heuresPrevues: 0,
        capaciteJour: null,
        revisionPlan: 0,
        feuille: null,
        description: '',
        imputation: '',
        heures: 0
      };
      
      expect(canDeleteEmptyManualEntry(entry)).toBe(true);
    });
    
    test('refuse la suppression si affectation présente', () => {
      const entry = {
        id: 1,
        affectation: 5,
        heuresPrevues: 0,
        capaciteJour: null,
        revisionPlan: 0,
        feuille: null,
        description: '',
        imputation: '',
        heures: 0
      };
      
      expect(canDeleteEmptyManualEntry(entry)).toBe(false);
    });
    
    test('refuse la suppression si heuresPrevues > 0', () => {
      const entry = {
        id: 1,
        affectation: null,
        heuresPrevues: 4,
        capaciteJour: null,
        revisionPlan: 0,
        feuille: null,
        description: '',
        imputation: '',
        heures: 0
      };
      
      expect(canDeleteEmptyManualEntry(entry)).toBe(false);
    });
    
    test('refuse la suppression si capaciteJour présent', () => {
      const entry = {
        id: 1,
        affectation: null,
        heuresPrevues: 0,
        capaciteJour: 100,
        revisionPlan: 0,
        feuille: null,
        description: '',
        imputation: '',
        heures: 0
      };
      
      expect(canDeleteEmptyManualEntry(entry)).toBe(false);
    });
    
    test('refuse la suppression si revisionPlan > 0', () => {
      const entry = {
        id: 1,
        affectation: null,
        heuresPrevues: 0,
        capaciteJour: null,
        revisionPlan: 3,
        feuille: null,
        description: '',
        imputation: '',
        heures: 0
      };
      
      expect(canDeleteEmptyManualEntry(entry)).toBe(false);
    });
    
    test('refuse la suppression si feuille liée', () => {
      const entry = {
        id: 1,
        affectation: null,
        heuresPrevues: 0,
        capaciteJour: null,
        revisionPlan: 0,
        feuille: 50,
        description: '',
        imputation: '',
        heures: 0
      };
      
      expect(canDeleteEmptyManualEntry(entry)).toBe(false);
    });
    
    test('refuse la suppression si description présente', () => {
      const entry = {
        id: 1,
        affectation: null,
        heuresPrevues: 0,
        capaciteJour: null,
        revisionPlan: 0,
        feuille: null,
        description: 'Note importante',
        imputation: '',
        heures: 0
      };
      
      expect(canDeleteEmptyManualEntry(entry)).toBe(false);
    });
    
    test('refuse la suppression si imputation présente', () => {
      const entry = {
        id: 1,
        affectation: null,
        heuresPrevues: 0,
        capaciteJour: null,
        revisionPlan: 0,
        feuille: null,
        description: '',
        imputation: 'PROJ-001',
        heures: 0
      };
      
      expect(canDeleteEmptyManualEntry(entry)).toBe(false);
    });
  });
  
  describe('hasPlanningFields', () => {
    test('retourne true si affectation présente', () => {
      const entry = { affectation: 5, heuresPrevues: 0 };
      expect(hasPlanningFields(entry)).toBe(true);
    });
    
    test('retourne true si heuresPrevues > 0', () => {
      const entry = { affectation: null, heuresPrevues: 4 };
      expect(hasPlanningFields(entry)).toBe(true);
    });
    
    test('retourne true si capaciteJour présent', () => {
      const entry = { affectation: null, heuresPrevues: 0, capaciteJour: 100 };
      expect(hasPlanningFields(entry)).toBe(true);
    });
    
    test('retourne true si revisionPlan > 0', () => {
      const entry = { affectation: null, heuresPrevues: 0, revisionPlan: 1 };
      expect(hasPlanningFields(entry)).toBe(true);
    });
    
    test('retourne false si aucun champ de planning', () => {
      const entry = { affectation: null, heuresPrevues: 0, capaciteJour: null, revisionPlan: 0 };
      expect(hasPlanningFields(entry)).toBe(false);
    });
  });
  
  describe('hasSheetLink', () => {
    test('retourne true si feuille liée', () => {
      const entry = { feuille: 50 };
      expect(hasSheetLink(entry)).toBe(true);
    });
    
    test('retourne false si feuille null', () => {
      const entry = { feuille: null };
      expect(hasSheetLink(entry)).toBe(false);
    });
    
    test('retourne false si feuille = 0', () => {
      const entry = { feuille: 0 };
      expect(hasSheetLink(entry)).toBe(false);
    });
  });
  
  describe('determineEntryAction', () => {
    test('met à jour heures sur ligne existante avec saisie positive', () => {
      const existing = { id: 10, heures: 2 };
      const result = determineEntryAction(existing, 4, null, null, false);
      
      expect(result.action).toBe('update');
      expect(result.fields).toEqual({ heures: 4 });
    });
    
    test('met heures à 0 sur ligne planifiée remise à zéro', () => {
      const existing = { 
        id: 10, 
        heures: 3, 
        affectation: 5, 
        heuresPrevues: 4 
      };
      const result = determineEntryAction(existing, 0, null, null, true);
      
      expect(result.action).toBe('update');
      expect(result.fields).toEqual({ heures: 0 });
      expect(result.reason).toBe('ZERO_PLANNED_OR_SHEET_ENTRY');
    });
    
    test('supprime ligne manuelle vide remise à zéro', () => {
      const existing = { 
        id: 10, 
        heures: 2, 
        affectation: null, 
        heuresPrevues: 0,
        capaciteJour: null,
        revisionPlan: 0,
        feuille: null,
        description: '',
        imputation: ''
      };
      const result = determineEntryAction(existing, 0, null, null, false);
      
      expect(result.action).toBe('delete');
      expect(result.reason).toBe('DELETE_EMPTY_MANUAL_ENTRY');
    });
    
    test('crée nouvelle ligne avec affectation', () => {
      const activeAssignment = { id: 5, tache: 1, membre: 1 };
      const result = determineEntryAction(null, 3, activeAssignment, null, false);
      
      expect(result.action).toBe('create');
      expect(result.fields.heures).toBe(3);
      expect(result.fields.affectation).toBe(5);
    });
    
    test('crée nouvelle ligne sans affectation', () => {
      const result = determineEntryAction(null, 3, null, null, false);
      
      expect(result.action).toBe('create');
      expect(result.fields.heures).toBe(3);
      expect(result.fields.affectation).toBeUndefined();
    });
    
    test('crée nouvelle ligne avec feuille', () => {
      const currentSheet = { id: 50 };
      const result = determineEntryAction(null, 3, null, currentSheet, false);
      
      expect(result.action).toBe('create');
      expect(result.fields.heures).toBe(3);
      expect(result.fields.feuille).toBe(50);
    });
    
    test('retourne none si heures <= 0 et pas de ligne', () => {
      const result = determineEntryAction(null, 0, null, null, false);
      
      expect(result.action).toBe('none');
      expect(result.reason).toBe('NO_ACTION_NEEDED');
    });
  });
});
