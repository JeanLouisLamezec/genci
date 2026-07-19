/**
 * Tests pour CRA Time Entry Controller
 * 
 * CONTRATS TESTÉS (Phase 2) :
 * 1. heuresPrevues = lecture seule
 * 2. heures = éditable
 * 3. affectation + date = clé canonique
 * 4. record ID conservé
 * 5. feuille soumis/validée = verrouillée
 * 6. aucune écriture dans les capacités
 * 7. aucune mutation de TaskAssignments
 * 8. création contrôlée (pas de doublons)
 */

'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const {
  resolveActiveAssignment,
  resolveEditableCellEntry,
  canDeleteEmptyManualEntry,
  hasPlanningFields,
  hasSheetLink,
  determineEntryAction,
  isPersonWeekLocked,
  localDayKeyFromMs,
  gristDateKey,
  dailyCapacityForPersonAndDate
} = require('./cra-time-entry-controller.js');

describe('CRA Time Entry Controller', () => {
  
  describe('Export navigateur (TODO 1)', () => {
    test('CRAController est disponible dans un environnement navigateur simulé', () => {
      const scriptPath = path.resolve(__dirname, 'cra-time-entry-controller.js');
      const scriptCode = fs.readFileSync(scriptPath, 'utf-8');
      
      const sandbox = {
        globalThis: {},
        module: undefined,
        exports: undefined
      };
      
      vm.runInNewContext(scriptCode, sandbox);
      
      expect(sandbox.globalThis.CRAController).toBeDefined();
      expect(typeof sandbox.globalThis.CRAController.resolveActiveAssignment).toBe('function');
      expect(typeof sandbox.globalThis.CRAController.resolveEditableCellEntry).toBe('function');
      expect(typeof sandbox.globalThis.CRAController.canDeleteEmptyManualEntry).toBe('function');
      expect(typeof sandbox.globalThis.CRAController.hasPlanningFields).toBe('function');
      expect(typeof sandbox.globalThis.CRAController.hasSheetLink).toBe('function');
      expect(typeof sandbox.globalThis.CRAController.determineEntryAction).toBe('function');
    });
    
    test('CRAController fonctionne sans objet module', () => {
      const scriptPath = path.resolve(__dirname, 'cra-time-entry-controller.js');
      const scriptCode = fs.readFileSync(scriptPath, 'utf-8');
      
      const sandbox = {
        globalThis: {},
        module: undefined,
        exports: undefined,
        console: console
      };
      
      expect(() => {
        vm.runInNewContext(scriptCode, sandbox);
      }).not.toThrow();
      
      expect(sandbox.globalThis.CRAController).toBeDefined();
    });
  });
  
  // ============================================================================
  // TESTS DE CONTRATS - PHASE 2
  // ============================================================================
  
  describe('Contrats de résolution (affectation + date)', () => {
    test('resolveEditableCellEntry utilise affectation comme clé principale', () => {
      const entries = [
        { id: 1, membre: 1, tache: 10, date: 1705276800, heures: 2, affectation: 100 },
        { id: 2, membre: 1, tache: 10, date: 1705276800, heures: 3, affectation: 200 },
        { id: 3, membre: 1, tache: 10, date: 1705276800, heures: 4, affectation: null }
      ];
      
      const activeAssignment = { id: 100, tache: 10, membre: 1 };
      const result = resolveEditableCellEntry(entries, 10, '2024-01-15', 1, activeAssignment);
      
      expect(result.status).toBe('found');
      expect(result.entry.id).toBe(1); // Celle avec affectation=100
      expect(result.entry.affectation).toBe(100);
    });
    
    test('resolveEditableCellEntry retourne multiple si plusieurs entrées avec même affectation', () => {
      const entries = [
        { id: 1, membre: 1, tache: 10, date: 1705276800, heures: 2, affectation: 100 },
        { id: 2, membre: 1, tache: 10, date: 1705276800, heures: 3, affectation: 100 }
      ];
      
      const activeAssignment = { id: 100, tache: 10, membre: 1 };
      const result = resolveEditableCellEntry(entries, 10, '2024-01-15', 1, activeAssignment);
      
      expect(result.status).toBe('multiple');
      expect(result.reason).toBe('MULTIPLE_ASSIGNMENT_ENTRIES');
    });
    
    test('resolveEditableCellEntry gère les entrées legacy sans affectation', () => {
      const entries = [
        { id: 1, membre: 1, tache: 10, date: 1705276800, heures: 2, affectation: null }
      ];
      
      const activeAssignment = { id: 100, tache: 10, membre: 1 };
      const result = resolveEditableCellEntry(entries, 10, '2024-01-15', 1, activeAssignment);
      
      expect(result.status).toBe('found');
      expect(result.entry.id).toBe(1);
      expect(result.isLegacy).toBe(true);
    });
    
    test('resolveEditableCellEntry retourne none si aucune entrée', () => {
      const entries = [];
      const activeAssignment = { id: 100, tache: 10, membre: 1 };
      const result = resolveEditableCellEntry(entries, 10, '2024-01-15', 1, activeAssignment);
      
      expect(result.status).toBe('none');
      expect(result.entry).toBeNull();
    });
  });
  
  describe('Contrats de sauvegarde (UPDATE minimaliste)', () => {
    test('determineEntryAction ne modifie QUE heures sur ligne existante', () => {
      const existing = {
        id: 42,
        membre: 1,
        tache: 10,
        date: 1705276800,
        heures: 2,
        heuresPrevues: 6,
        affectation: 100,
        capaciteJour: 5,
        revisionPlan: 1
      };
      
      const result = determineEntryAction(existing, 4.5, null, null, true);
      
      expect(result.action).toBe('update');
      expect(result.reason).toBe('UPDATE_EXISTING_ENTRY');
      
      // CONTRAT : Seul le champ 'heures' est dans fields
      expect(Object.keys(result.fields).length).toBe(1);
      expect(result.fields.heures).toBe(4.5);
      expect(result.fields.heuresPrevues).toBeUndefined();
      expect(result.fields.affectation).toBeUndefined();
      expect(result.fields.capaciteJour).toBeUndefined();
      expect(result.fields.revisionPlan).toBeUndefined();
    });
    
    test('determineEntryAction préserve heuresPrevues à 0 sur ligne planifiée', () => {
      const existing = {
        id: 42,
        membre: 1,
        tache: 10,
        date: 1705276800,
        heures: 3,
        heuresPrevues: 6,
        affectation: 100
      };
      
      const result = determineEntryAction(existing, 0, null, null, true);
      
      expect(result.action).toBe('update');
      expect(result.fields.heures).toBe(0);
      expect(result.fields.heuresPrevues).toBeUndefined(); // JAMAIS modifié
    });
    
    test('determineEntryAction crée avec affectation OBLIGATOIRE', () => {
      const activeAssignment = { id: 100, tache: 10, membre: 1 };
      const currentSheet = { id: 50 };
      
      const result = determineEntryAction(null, 4.5, activeAssignment, currentSheet, false);
      
      expect(result.action).toBe('create');
      expect(result.fields.heures).toBe(4.5);
      expect(result.fields.affectation).toBe(100);
      expect(result.fields.feuille).toBe(50);
      expect(result.fields.heuresPrevues).toBeUndefined(); // Sera mis à 0 par défaut
    });
    
    test('determineEntryAction bloque création sans affectation (PHASE 1.1.4)', () => {
      const result = determineEntryAction(null, 4.5, null, null, false);
      
      expect(result.action).toBe('blocked');
      expect(result.reason).toBe('MISSING_ACTIVE_ASSIGNMENT');
      expect(result.fields).toBeNull();
    });
    
    test('determineEntryAction permet création avec affectation (PHASE 1.1.4)', () => {
      const activeAssignment = { id: 100, tache: 10, membre: 1, actif: true };
      
      const result = determineEntryAction(null, 4.5, activeAssignment, null, false);
      
      expect(result.action).toBe('create');
      expect(result.fields.heures).toBe(4.5);
      expect(result.fields.affectation).toBe(100);
    });
    
    test('determineEntryAction permet modification ligne legacy sans affectation', () => {
      const existing = {
        id: 42,
        membre: 1,
        tache: 10,
        date: 1705276800,
        heures: 2,
        affectation: null  // Ligne legacy
      };
      
      const result = determineEntryAction(existing, 4.5, null, null, false);
      
      expect(result.action).toBe('update');
      expect(result.fields.heures).toBe(4.5);
    });
  });
  
  // Anciens tests à supprimer ou mettre à jour
  test('determineEntryAction crée nouvelle ligne sans affectation', () => {
    // PHASE 1.1.4 : Ce comportement est maintenant BLOQUÉ
    const result = determineEntryAction(null, 3, null, null, false);
    
    expect(result.action).toBe('blocked');
    expect(result.reason).toBe('MISSING_ACTIVE_ASSIGNMENT');
  });
  
  test('determineEntryAction crée nouvelle ligne avec feuille', () => {
    // PHASE 1.1.4 : Ce test nécessite une affectation maintenant
    const activeAssignment = { id: 100, tache: 10, membre: 1 };
    const currentSheet = { id: 50 };
    
    const result = determineEntryAction(null, 3, activeAssignment, currentSheet, false);
    
    expect(result.action).toBe('create');
    expect(result.fields.heures).toBe(3);
    expect(result.fields.feuille).toBe(50);
    expect(result.fields.affectation).toBe(100);
  });
  
  describe('Contrats de verrouillage', () => {
    test('isPersonWeekLocked verrouille soumis et valide', () => {
      const sheets = [
        { id: 1, membre: 1, semaine: '2024-01-15', statut: 'soumis' },
        { id: 2, membre: 2, semaine: '2024-01-15', statut: 'valide' },
        { id: 3, membre: 3, semaine: '2024-01-15', statut: 'submitted' },
        { id: 4, membre: 4, semaine: '2024-01-15', statut: 'validated' }
      ];
      
      expect(isPersonWeekLocked(1, '2024-01-15', sheets).locked).toBe(true);
      expect(isPersonWeekLocked(2, '2024-01-15', sheets).locked).toBe(true);
      expect(isPersonWeekLocked(3, '2024-01-15', sheets).locked).toBe(true);
      expect(isPersonWeekLocked(4, '2024-01-15', sheets).locked).toBe(true);
    });
    
    test('isPersonWeekLocked permet édition sur brouillon et rejete', () => {
      const sheets = [
        { id: 1, membre: 1, semaine: '2024-01-15', statut: 'brouillon' },
        { id: 2, membre: 2, semaine: '2024-01-15', statut: 'rejete' },
        { id: 3, membre: 3, semaine: '2024-01-15', statut: 'draft' },
        { id: 4, membre: 4, semaine: '2024-01-15', statut: 'rejected' }
      ];
      
      expect(isPersonWeekLocked(1, '2024-01-15', sheets).locked).toBe(false);
      expect(isPersonWeekLocked(2, '2024-01-15', sheets).locked).toBe(false);
      expect(isPersonWeekLocked(3, '2024-01-15', sheets).locked).toBe(false);
      expect(isPersonWeekLocked(4, '2024-01-15', sheets).locked).toBe(false);
    });
  });
  
  describe('resolveActiveAssignment', () => {
    test('retourne missing quand aucune affectation active', () => {
      const assignments = [
        { id: 1, tache: 1, membre: 1, actif: false },
        { id: 2, tache: 2, membre: 1, actif: true }
      ];
      
      const result = resolveActiveAssignment(1, 1, '2024-01-15', assignments);
      
      expect(result.status).toBe('missing');
      expect(result.assignment).toBeNull();
      expect(result.assignments).toEqual([]);
    });
    
    test('retourne found quand une affectation active existe', () => {
      const assignments = [
        { id: 1, tache: 1, membre: 1, actif: true, dateDebut: 1704067200, dateFin: 1706745600 },
        { id: 2, tache: 2, membre: 1, actif: true, dateDebut: 1704067200, dateFin: 1706745600 }
      ];
      
      const result = resolveActiveAssignment(1, 1, '2024-01-15', assignments);
      
      expect(result.status).toBe('found');
      expect(result.assignment).toEqual(assignments[0]);
      expect(result.assignments).toEqual([assignments[0]]);
    });
    
    test('retourne ambiguous quand plusieurs affectations actives', () => {
      const assignments = [
        { id: 1, tache: 1, membre: 1, actif: true, dateDebut: 1704067200, dateFin: 1706745600 },
        { id: 2, tache: 1, membre: 1, actif: true, dateDebut: 1704067200, dateFin: 1706745600 }
      ];
      
      const result = resolveActiveAssignment(1, 1, '2024-01-15', assignments);
      
      expect(result.status).toBe('ambiguous');
      expect(result.assignment).toBeNull();
      expect(result.assignments).toEqual(assignments);
    });
    
    test('ignore les affectations inactives', () => {
      const assignments = [
        { id: 1, tache: 1, membre: 1, actif: false, dateDebut: 1704067200, dateFin: 1706745600 },
        { id: 2, tache: 1, membre: 1, actif: true, dateDebut: 1704067200, dateFin: 1706745600 }
      ];
      
      const result = resolveActiveAssignment(1, 1, '2024-01-15', assignments);
      
      expect(result.status).toBe('found');
      expect(result.assignment).toEqual(assignments[1]);
    });
    
    test('ignore les affectations en dehors de la date (PHASE 1.1.3)', () => {
      // Timestamps Grist en secondes
      const assignments = [
        { id: 1, tache: 1, membre: 1, actif: true, dateDebut: 1704067200, dateFin: 1705276800 }, // Fin le 15/01/2024 à 00:00
        { id: 2, tache: 1, membre: 1, actif: true, dateDebut: 1705622400, dateFin: 1706745600 }  // Début le 19/01/2024 à 00:00
      ];
      
      // Date = 17/01/2024 (entre les deux affectations)
      const result = resolveActiveAssignment(1, 1, '2024-01-17', assignments);
      
      expect(result.status).toBe('missing');
      expect(result.assignment).toBeNull();
    });
    
    test('trouve l\'affectation qui couvre la date (PHASE 1.1.3)', () => {
      // Timestamps Grist en secondes
      const assignments = [
        { id: 1, tache: 1, membre: 1, actif: true, dateDebut: 1704067200, dateFin: 1705363200 }, // Fin le 16/01/2024
        { id: 2, tache: 1, membre: 1, actif: true, dateDebut: 1705449600, dateFin: 1706745600 }  // Début le 18/01/2024
      ];
      
      // Date = 10/01/2024, seule la première affectation couvre
      const result = resolveActiveAssignment(1, 1, '2024-01-10', assignments);
      
      expect(result.status).toBe('found');
      expect(result.assignment).toEqual(assignments[0]);
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
    
    test('bloque création sans affectation (PHASE 1.1.4)', () => {
      const result = determineEntryAction(null, 3, null, null, false);
      
      expect(result.action).toBe('blocked');
      expect(result.reason).toBe('MISSING_ACTIVE_ASSIGNMENT');
    });
    
    test('bloque création avec feuille mais sans affectation (PHASE 1.1.4)', () => {
      const currentSheet = { id: 50 };
      const result = determineEntryAction(null, 3, null, currentSheet, false);
      
      expect(result.action).toBe('blocked');
      expect(result.reason).toBe('MISSING_ACTIVE_ASSIGNMENT');
    });
    
    test('retourne none si heures <= 0 et pas de ligne', () => {
      const result = determineEntryAction(null, 0, null, null, false);
      
      expect(result.action).toBe('none');
      expect(result.reason).toBe('NO_ACTION_NEEDED');
    });
  });
  
  describe('isPersonWeekLocked (TODO 2)', () => {
    test('retourne unlocked quand aucune feuille', () => {
      const result = isPersonWeekLocked(1, '2024-01-15', []);
      
      expect(result.locked).toBe(false);
      expect(result.sheet).toBeNull();
      expect(result.reason).toBe('NO_SHEET');
    });
    
    test('retourne unlocked pour une feuille brouillon', () => {
      const sheets = [
        { id: 1, membre: 1, semaine: '2024-01-15', statut: 'brouillon' }
      ];
      const result = isPersonWeekLocked(1, '2024-01-15', sheets);
      
      expect(result.locked).toBe(false);
      expect(result.sheet).toEqual(sheets[0]);
    });
    
    test('retourne unlocked pour une feuille rejete', () => {
      const sheets = [
        { id: 1, membre: 1, semaine: '2024-01-15', statut: 'rejete' }
      ];
      const result = isPersonWeekLocked(1, '2024-01-15', sheets);
      
      expect(result.locked).toBe(false);
      expect(result.sheet).toEqual(sheets[0]);
    });
    
    test('retourne locked pour une feuille soumis', () => {
      const sheets = [
        { id: 1, membre: 1, semaine: '2024-01-15', statut: 'soumis' }
      ];
      const result = isPersonWeekLocked(1, '2024-01-15', sheets);
      
      expect(result.locked).toBe(true);
      expect(result.reason).toBe('SHEET_SOUMIS');
    });
    
    test('retourne locked pour une feuille valide', () => {
      const sheets = [
        { id: 1, membre: 1, semaine: '2024-01-15', statut: 'valide' }
      ];
      const result = isPersonWeekLocked(1, '2024-01-15', sheets);
      
      expect(result.locked).toBe(true);
      expect(result.reason).toBe('SHEET_VALIDE');
    });
    
    test('retourne locked pour une feuille submitted', () => {
      const sheets = [
        { id: 1, membre: 1, semaine: '2024-01-15', statut: 'submitted' }
      ];
      const result = isPersonWeekLocked(1, '2024-01-15', sheets);
      
      expect(result.locked).toBe(true);
      expect(result.reason).toBe('SHEET_SUBMITTED');
    });
    
    test('retourne locked pour une feuille validated', () => {
      const sheets = [
        { id: 1, membre: 1, semaine: '2024-01-15', statut: 'validated' }
      ];
      const result = isPersonWeekLocked(1, '2024-01-15', sheets);
      
      expect(result.locked).toBe(true);
      expect(result.reason).toBe('SHEET_VALIDATED');
    });
    
    test('gère les dates Grist en secondes Unix', () => {
      const sheets = [
        { id: 1, membre: 1, semaine: 1705276800, statut: 'soumis' }
      ];
      const result = isPersonWeekLocked(1, '2024-01-15', sheets);
      
      expect(result.locked).toBe(true);
    });
    
    test('personne A verrouillée, personne B éditable sur même semaine', () => {
      const sheets = [
        { id: 1, membre: 1, semaine: '2024-01-15', statut: 'soumis' },
        { id: 2, membre: 2, semaine: '2024-01-15', statut: 'brouillon' }
      ];
      
      const resultA = isPersonWeekLocked(1, '2024-01-15', sheets);
      const resultB = isPersonWeekLocked(2, '2024-01-15', sheets);
      
      expect(resultA.locked).toBe(true);
      expect(resultB.locked).toBe(false);
    });
    
    test('retourne unlocked quand params manquants', () => {
      const result1 = isPersonWeekLocked(null, '2024-01-15', []);
      const result2 = isPersonWeekLocked(1, null, []);
      
      expect(result1.locked).toBe(false);
      expect(result2.locked).toBe(false);
    });
  });
  
  describe('localDayKeyFromMs (TODO 5)', () => {
    test('convertit correctement une date locale', () => {
      const date = new Date('2024-01-15T10:00:00');
      const result = localDayKeyFromMs(date.getTime());
      expect(result).toBe('2024-01-15');
    });
    
    test('gère les dates autour des changements d\'heure', () => {
      process.env.TZ = 'Europe/Paris';
      
      const date15 = new Date('2024-07-16T12:00:00+02:00');
      expect(localDayKeyFromMs(date15.getTime())).toBe('2024-07-16');
    });
  });
  
  describe('gristDateKey (TODO 5)', () => {
    test('convertit les secondes Unix Grist', () => {
      const result = gristDateKey(1705276800);
      expect(result).toBe('2024-01-15');
    });
    
    test('gère les chaînes ISO', () => {
      expect(gristDateKey('2024-01-15')).toBe('2024-01-15');
    });
    
    test('retourne null pour les valeurs invalides', () => {
      expect(gristDateKey(null)).toBeNull();
      expect(gristDateKey(undefined)).toBeNull();
      expect(gristDateKey('')).toBeNull();
    });
  });
  
  describe('resolveEditableCellEntry - ambiguïté (TODO 6)', () => {
    test('retourne multiple quand deux lignes sans affectation', () => {
      const entries = [
        { id: 1, tache: 1, membre: 1, date: 1705276800, heures: 2, affectation: null },
        { id: 2, tache: 1, membre: 1, date: 1705276800, heures: 3, affectation: null }
      ];
      
      const result = resolveEditableCellEntry(entries, 1, '2024-01-15', 1, null);
      
      expect(result.status).toBe('multiple');
      expect(result.entry).toBeNull();
      expect(result.entries).toHaveLength(2);
    });
    
    test('retourne multiple quand deux lignes avec même affectation active', () => {
      const entries = [
        { id: 1, tache: 1, membre: 1, date: 1705276800, heures: 2, affectation: 10 },
        { id: 2, tache: 1, membre: 1, date: 1705276800, heures: 3, affectation: 10 }
      ];
      const activeAssignment = { id: 10, tache: 1, membre: 1 };
      
      const result = resolveEditableCellEntry(entries, 1, '2024-01-15', 1, activeAssignment);
      
      expect(result.status).toBe('multiple');
      expect(result.reason).toBe('MULTIPLE_ASSIGNMENT_ENTRIES');
    });
    
    test('retourne found avec une ligne correspondant à l\'affectation et une legacy', () => {
      const entries = [
        { id: 1, tache: 1, membre: 1, date: 1705276800, heures: 2, affectation: 10 },
        { id: 2, tache: 1, membre: 1, date: 1705276800, heures: 3, affectation: null }
      ];
      const activeAssignment = { id: 10, tache: 1, membre: 1 };
      
      const result = resolveEditableCellEntry(entries, 1, '2024-01-15', 1, activeAssignment);
      
      expect(result.status).toBe('found');
      expect(result.entry.id).toBe(1);
    });
    
    test('retourne multiple avec deux lignes affectation + une legacy', () => {
      const entries = [
        { id: 1, tache: 1, membre: 1, date: 1705276800, heures: 2, affectation: 10 },
        { id: 2, tache: 1, membre: 1, date: 1705276800, heures: 3, affectation: 10 },
        { id: 3, tache: 1, membre: 1, date: 1705276800, heures: 4, affectation: null }
      ];
      const activeAssignment = { id: 10, tache: 1, membre: 1 };
      
      const result = resolveEditableCellEntry(entries, 1, '2024-01-15', 1, activeAssignment);
      
      expect(result.status).toBe('multiple');
      expect(result.reason).toBe('MULTIPLE_ASSIGNMENT_ENTRIES');
    });
  });
  
  describe('dailyCapacityForPersonAndDate (TODO 7, 14)', () => {
    const team = [
      { id: 1, nom: 'Alice', capaciteHebdo: 35 },
      { id: 2, nom: 'Bob', capaciteHebdo: 28 }
    ];
    
    const dailyCapacities = [
      { id: 1, membre: 1, date: 1705276800, capaciteTheorique: 7, capaciteDisponible: 5 },
      { id: 2, membre: 1, date: 1705363200, capaciteTheorique: 7, capaciteDisponible: 0 },
      { id: 3, membre: 2, date: 1705276800, capaciteTheorique: 6, capaciteDisponible: 6 }
    ];
    
    test('utilise capaciteDisponible en priorité', () => {
      const result = dailyCapacityForPersonAndDate(1, 1705276800 * 1000, dailyCapacities, team, []);
      
      expect(result.capacity).toBe(5);
      expect(result.source).toBe('daily_available');
    });
    
    test('utilise capaciteDisponible = 0 (TODO 14)', () => {
      const result = dailyCapacityForPersonAndDate(1, 1705363200 * 1000, dailyCapacities, team, []);
      
      expect(result.capacity).toBe(0);
      expect(result.source).toBe('daily_available');
    });
    
    test('replie sur capaciteTheorique si capaciteDisponible manquant', () => {
      const capacitiesWithoutAvailable = [
        { id: 1, membre: 1, date: 1705276800, capaciteTheorique: 7, capaciteDisponible: null }
      ];
      
      const result = dailyCapacityForPersonAndDate(1, 1705276800 * 1000, capacitiesWithoutAvailable, team, []);
      
      expect(result.capacity).toBe(7);
      expect(result.source).toBe('daily_theoretical');
    });
    
    test('replie legacy si aucune capacité quotidienne', () => {
      const result = dailyCapacityForPersonAndDate(1, 1705536000 * 1000, [], team, []);
      
      expect(result.capacity).toBe(7);
      expect(result.source).toBe('legacy');
    });
    
    test('applique les indisponibilités legacy', () => {
      const availabilities = [
        { id: 1, membre: 1, dateDebut: 1705536000, dateFin: 1705622400, dispo: 50 }
      ];
      
      const result = dailyCapacityForPersonAndDate(1, 1705536000 * 1000, [], team, availabilities);
      
      expect(result.capacity).toBe(3.5);
      expect(result.source).toBe('legacy');
    });
    
    test('ignore indisponibilités legacy si capacité quotidienne existe', () => {
      const availabilities = [
        { id: 1, membre: 1, dateDebut: 1705276800, dateFin: 1705276800, dispo: 50 }
      ];
      
      const result = dailyCapacityForPersonAndDate(1, 1705276800 * 1000, dailyCapacities, team, availabilities);
      
      expect(result.capacity).toBe(5);
      expect(result.source).toBe('daily_available');
    });
    
    test('gère les doublons de capacité (prend la révision la plus élevée)', () => {
      const duplicateCapacities = [
        { id: 1, membre: 1, date: 1705276800, capaciteTheorique: 7, capaciteDisponible: 5, revision: 1 },
        { id: 2, membre: 1, date: 1705276800, capaciteTheorique: 8, capaciteDisponible: 6, revision: 2 }
      ];
      
      const result = dailyCapacityForPersonAndDate(1, 1705276800 * 1000, duplicateCapacities, team, []);
      
      expect(result.capacity).toBe(6);
      expect(result.warning).toContain('Doublon');
    });
  });
});
