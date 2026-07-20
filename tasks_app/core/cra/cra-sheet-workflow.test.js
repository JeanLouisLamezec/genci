/**
 * Tests pour CRA Sheet Workflow
 * 
 * Tests purs (sans Grist, sans DOM) de la logique métier
 */

'use strict';

const workflow = require('./cra-sheet-workflow');

describe('CRA Sheet Workflow - Statuts', () => {
  describe('normalizeSheetStatus', () => {
    it('devrait normaliser les statuts français', () => {
      expect(workflow.normalizeSheetStatus('brouillon')).toBe('draft');
      expect(workflow.normalizeSheetStatus('soumis')).toBe('submitted');
      expect(workflow.normalizeSheetStatus('valide')).toBe('validated');
      expect(workflow.normalizeSheetStatus('rejete')).toBe('rejected');
    });
    
    it('devrait normaliser les statuts anglais', () => {
      expect(workflow.normalizeSheetStatus('draft')).toBe('draft');
      expect(workflow.normalizeSheetStatus('submitted')).toBe('submitted');
      expect(workflow.normalizeSheetStatus('validated')).toBe('validated');
      expect(workflow.normalizeSheetStatus('rejected')).toBe('rejected');
    });
    
    it('devrait retourner null pour les statuts inconnus', () => {
      expect(workflow.normalizeSheetStatus(null)).toBeNull();
      expect(workflow.normalizeSheetStatus(undefined)).toBeNull();
      expect(workflow.normalizeSheetStatus('')).toBeNull();
      expect(workflow.normalizeSheetStatus('inconnu')).toBeNull();
    });
  });
  
  describe('isSheetLocked', () => {
    it('devrait verrouiller les feuilles soumises', () => {
      expect(workflow.isSheetLocked({ statut: 'soumis' })).toBe(true);
      expect(workflow.isSheetLocked({ statut: 'submitted' })).toBe(true);
    });
    
    it('devrait verrouiller les feuilles validées', () => {
      expect(workflow.isSheetLocked({ statut: 'valide' })).toBe(true);
      expect(workflow.isSheetLocked({ statut: 'validated' })).toBe(true);
    });
    
    it('devrait déverrouiller les feuilles brouillon', () => {
      expect(workflow.isSheetLocked({ statut: 'brouillon' })).toBe(false);
      expect(workflow.isSheetLocked({ statut: 'draft' })).toBe(false);
    });
    
    it('devrait déverrouiller les feuilles rejetées', () => {
      expect(workflow.isSheetLocked({ statut: 'rejete' })).toBe(false);
      expect(workflow.isSheetLocked({ statut: 'rejected' })).toBe(false);
    });
  });
  
  describe('isSheetTerminal', () => {
    it('devrait être terminal pour valide', () => {
      expect(workflow.isSheetTerminal({ statut: 'valide' })).toBe(true);
      expect(workflow.isSheetTerminal({ statut: 'validated' })).toBe(true);
    });
    
    it('devrait ne pas être terminal pour les autres statuts', () => {
      expect(workflow.isSheetTerminal({ statut: 'brouillon' })).toBe(false);
      expect(workflow.isSheetTerminal({ statut: 'soumis' })).toBe(false);
      expect(workflow.isSheetTerminal({ statut: 'rejete' })).toBe(false);
    });
  });
});

describe('CRA Sheet Workflow - Null / 0 / Réalisé explicite', () => {
  describe('hasExplicitActual', () => {
    it('devrait retourner true pour heures = 0', () => {
      expect(workflow.hasExplicitActual({ heures: 0 })).toBe(true);
      expect(workflow.hasExplicitActual({ heures: '0' })).toBe(true);
    });
    
    it('devrait retourner true pour heures > 0', () => {
      expect(workflow.hasExplicitActual({ heures: 3 })).toBe(true);
      expect(workflow.hasExplicitActual({ heures: 3.5 })).toBe(true);
    });
    
    it('devrait retourner false pour heures = null', () => {
      expect(workflow.hasExplicitActual({ heures: null })).toBe(false);
      expect(workflow.hasExplicitActual({ heures: undefined })).toBe(false);
      expect(workflow.hasExplicitActual({ heures: '' })).toBe(false);
    });
    
    it('devrait retourner false pour une entrée manquante', () => {
      expect(workflow.hasExplicitActual(null)).toBe(false);
      expect(workflow.hasExplicitActual(undefined)).toBe(false);
    });
  });
});

describe('CRA Sheet Workflow - Unicité de la feuille', () => {
  const sheets = [
    { id: 1, membre: 10, semaine: 1704672000 }, // 2024-01-08
    { id: 2, membre: 20, semaine: 1704672000 },
    { id: 3, membre: 10, semaine: 1705276800 }  // 2024-01-15
  ];
  
  describe('findUniqueSheetForWeek', () => {
    it('devrait trouver une feuille unique', () => {
      const result = workflow.findUniqueSheetForWeek(10, '2024-01-08', sheets);
      expect(result.status).toBe('found');
      expect(result.sheet.id).toBe(1);
    });
    
    it('devrait retourner none si aucune feuille', () => {
      const result = workflow.findUniqueSheetForWeek(30, '2024-01-08', sheets);
      expect(result.status).toBe('none');
      expect(result.sheet).toBeNull();
    });
    
    it('devrait détecter les doublons', () => {
      const duplicateSheets = [
        { id: 1, membre: 10, semaine: 1704672000 },
        { id: 2, membre: 10, semaine: 1704672000 } // Doublon
      ];
      const result = workflow.findUniqueSheetForWeek(10, '2024-01-08', duplicateSheets);
      expect(result.status).toBe('duplicate');
      expect(result.sheet).toBeNull();
      expect(result.duplicates).toHaveLength(2);
    });
    
    it('devrait gérer les paramètres manquants', () => {
      const result1 = workflow.findUniqueSheetForWeek(null, '2024-01-08', sheets);
      expect(result1.status).toBe('none');
      
      const result2 = workflow.findUniqueSheetForWeek(10, null, sheets);
      expect(result2.status).toBe('none');
    });
  });
});

describe('CRA Sheet Workflow - Hiérarchie', () => {
  const team = [
    { id: 1, nom: 'CEO', responsable: null },
    { id: 2, nom: 'Manager', responsable: 1 },
    { id: 3, nom: 'Employee', responsable: 2 },
    { id: 4, nom: 'Another Employee', responsable: 2 }
  ];
  
  describe('getDirectManagerId', () => {
    it('devrait retourner le responsable direct', () => {
      expect(workflow.getDirectManagerId(3, team)).toBe(2);
      expect(workflow.getDirectManagerId(2, team)).toBe(1);
    });
    
    it('devrait retourner null pour le CEO', () => {
      expect(workflow.getDirectManagerId(1, team)).toBeNull();
    });
    
    it('devrait retourner null pour un membre inexistant', () => {
      expect(workflow.getDirectManagerId(99, team)).toBeNull();
    });
  });
  
  describe('getDirectReportIds', () => {
    it('devrait retourner les subordonnés directs', () => {
      const reports = workflow.getDirectReportIds(2, team);
      expect(reports).toContain(3);
      expect(reports).toContain(4);
      expect(reports).not.toContain(1);
    });
    
    it('devrait retourner un tableau vide pour aucun subordonné', () => {
      const reports = workflow.getDirectReportIds(3, team);
      expect(reports).toHaveLength(0);
    });
  });
  
  describe('isDirectManager', () => {
    it('devrait retourner true pour le responsable direct', () => {
      expect(workflow.isDirectManager(2, 3, team)).toBe(true);
    });
    
    it('devrait retourner false pour un manager indirect', () => {
      expect(workflow.isDirectManager(1, 3, team)).toBe(false);
    });
    
    it('devrait retourner false pour un non-manager', () => {
      expect(workflow.isDirectManager(3, 2, team)).toBe(false);
    });
  });
});

describe('CRA Sheet Workflow - Autorisations : Soumission', () => {
  const team = [
    { id: 1, nom: 'Manager', responsable: null },
    { id: 2, nom: 'Employee', responsable: 1 }
  ];
  
  const sheets = [
    { id: 1, membre: 2, semaine: 1704672000, statut: 'brouillon' }
  ];
  
  describe('canSubmitSheet', () => {
    it('devrait autoriser la soumission par le membre', () => {
      const context = {
        actorMemberId: 2,
        sheet: sheets[0],
        team,
        sheets
      };
      const result = workflow.canSubmitSheet(context);
      expect(result.can).toBe(true);
      expect(result.code).toBe('OK');
    });
    
    it('devrait refuser la soumission par un autre membre', () => {
      const context = {
        actorMemberId: 1,
        sheet: sheets[0],
        team,
        sheets
      };
      const result = workflow.canSubmitSheet(context);
      expect(result.can).toBe(false);
      expect(result.code).toBe('NOT_SHEET_OWNER');
    });
    
    it('devrait refuser si acteur non identifié', () => {
      const context = {
        actorMemberId: null,
        sheet: sheets[0],
        team,
        sheets
      };
      const result = workflow.canSubmitSheet(context);
      expect(result.can).toBe(false);
      expect(result.code).toBe('ACTOR_NOT_IDENTIFIED');
    });
    
    it('devrait refuser une feuille déjà soumise', () => {
      const context = {
        actorMemberId: 2,
        sheet: { ...sheets[0], statut: 'soumis' },
        team,
        sheets
      };
      const result = workflow.canSubmitSheet(context);
      expect(result.can).toBe(false);
      expect(result.code).toBe('SHEET_NOT_EDITABLE');
    });
    
    it('devrait refuser une feuille validée', () => {
      const context = {
        actorMemberId: 2,
        sheet: { ...sheets[0], statut: 'valide' },
        team,
        sheets
      };
      const result = workflow.canSubmitSheet(context);
      expect(result.can).toBe(false);
      expect(result.code).toBe('SHEET_NOT_EDITABLE');
    });
    
    it('devrait autoriser la soumission après rejet', () => {
      const context = {
        actorMemberId: 2,
        sheet: { ...sheets[0], statut: 'rejete' },
        team,
        sheets
      };
      const result = workflow.canSubmitSheet(context);
      expect(result.can).toBe(true);
    });
  });
});

describe('CRA Sheet Workflow - Autorisations : Validation', () => {
  const team = [
    { id: 1, nom: 'Manager', responsable: null },
    { id: 2, nom: 'Employee', responsable: 1 }
  ];
  
  const sheets = [
    { id: 1, membre: 2, semaine: 1704672000, statut: 'soumis' }
  ];
  
  describe('canValidateSheet', () => {
    it('devrait autoriser la validation par le responsable direct', () => {
      const context = {
        actorMemberId: 1,
        sheet: sheets[0],
        team,
        sheets
      };
      const result = workflow.canValidateSheet(context);
      expect(result.can).toBe(true);
      expect(result.code).toBe('OK');
    });
    
    it('devrait interdire l\'auto-validation', () => {
      const context = {
        actorMemberId: 2,
        sheet: sheets[0],
        team,
        sheets
      };
      const result = workflow.canValidateSheet(context);
      expect(result.can).toBe(false);
      expect(result.code).toBe('SELF_VALIDATION_FORBIDDEN');
    });
    
    it('devrait refuser un manager indirect', () => {
      const context = {
        actorMemberId: 99,
        sheet: sheets[0],
        team,
        sheets
      };
      const result = workflow.canValidateSheet(context);
      expect(result.can).toBe(false);
      expect(result.code).toBe('NOT_DIRECT_MANAGER');
    });
    
    it('devrait refuser une feuille brouillon', () => {
      const context = {
        actorMemberId: 1,
        sheet: { ...sheets[0], statut: 'brouillon' },
        team,
        sheets
      };
      const result = workflow.canValidateSheet(context);
      expect(result.can).toBe(false);
      expect(result.code).toBe('SHEET_NOT_SUBMITTED');
    });
    
    it('devrait refuser une feuille validée', () => {
      const context = {
        actorMemberId: 1,
        sheet: { ...sheets[0], statut: 'valide' },
        team,
        sheets
      };
      const result = workflow.canValidateSheet(context);
      expect(result.can).toBe(false);
      expect(result.code).toBe('SHEET_NOT_SUBMITTED');
    });
    
    it('devrait refuser si acteur non identifié', () => {
      const context = {
        actorMemberId: null,
        sheet: sheets[0],
        team,
        sheets
      };
      const result = workflow.canValidateSheet(context);
      expect(result.can).toBe(false);
      expect(result.code).toBe('ACTOR_NOT_IDENTIFIED');
    });
  });
});

describe('CRA Sheet Workflow - Autorisations : Rejet', () => {
  const team = [
    { id: 1, nom: 'Manager', responsable: null },
    { id: 2, nom: 'Employee', responsable: 1 }
  ];
  
  const sheets = [
    { id: 1, membre: 2, semaine: 1704672000, statut: 'soumis' }
  ];
  
  describe('canRejectSheet', () => {
    it('devrait autoriser le rejet par le responsable direct avec motif', () => {
      const context = {
        actorMemberId: 1,
        sheet: sheets[0],
        team,
        sheets,
        rejectReason: 'Travail incomplet'
      };
      const result = workflow.canRejectSheet(context);
      expect(result.can).toBe(true);
      expect(result.code).toBe('OK');
    });
    
    it('devrait refuser sans motif', () => {
      const context = {
        actorMemberId: 1,
        sheet: sheets[0],
        team,
        sheets,
        rejectReason: ''
      };
      const result = workflow.canRejectSheet(context);
      expect(result.can).toBe(false);
      expect(result.code).toBe('MISSING_REJECT_REASON');
    });
    
    it('devrait interdire l\'auto-rejet', () => {
      const context = {
        actorMemberId: 2,
        sheet: sheets[0],
        team,
        sheets,
        rejectReason: 'Erreur'
      };
      const result = workflow.canRejectSheet(context);
      expect(result.can).toBe(false);
      expect(result.code).toBe('SELF_REJECTION_FORBIDDEN');
    });
    
    it('devrait refuser un manager indirect', () => {
      const context = {
        actorMemberId: 99,
        sheet: sheets[0],
        team,
        sheets,
        rejectReason: 'Erreur'
      };
      const result = workflow.canRejectSheet(context);
      expect(result.can).toBe(false);
      expect(result.code).toBe('NOT_DIRECT_MANAGER');
    });
  });
});

describe('CRA Sheet Workflow - Actions Grist', () => {
  describe('buildSubmissionActions', () => {
    it('devrait matérialiser les propositions null', () => {
      const timeEntries = [
        { id: 1, heures: null, heuresPrevues: 3, feuille: null }
      ];
      const result = workflow.buildSubmissionActions({
        sheetId: 100,
        timeEntries
      });
      
      expect(result.actions).toHaveLength(2);
      
      // UpdateRecord TimeEntries
      expect(result.actions[0][0]).toBe('UpdateRecord');
      expect(result.actions[0][1]).toBe('TimeEntries');
      expect(result.actions[0][2]).toBe(1);
      expect(result.actions[0][3].heures).toBe(3);
      expect(result.actions[0][3].feuille).toBe(100);
      
      // UpdateRecord Feuilles
      expect(result.actions[1][0]).toBe('UpdateRecord');
      expect(result.actions[1][1]).toBe('Feuilles');
      expect(result.actions[1][2]).toBe(100);
      expect(result.actions[1][3].statut).toBe('soumis');
    });
    
    it('devrait conserver les valeurs explicites heures = 0', () => {
      const timeEntries = [
        { id: 1, heures: 0, heuresPrevues: 3, feuille: null }
      ];
      const result = workflow.buildSubmissionActions({
        sheetId: 100,
        timeEntries
      });
      
      // heures = 0 est explicite, ne pas modifier
      expect(result.actions[0][3].heures).toBeUndefined();
      expect(result.actions[0][3].feuille).toBe(100);
    });
    
    it('devrait conserver les valeurs explicites heures = 2', () => {
      const timeEntries = [
        { id: 1, heures: 2, heuresPrevues: 3, feuille: null }
      ];
      const result = workflow.buildSubmissionActions({
        sheetId: 100,
        timeEntries
      });
      
      // heures = 2 est explicite, ne pas modifier
      expect(result.actions[0][3].heures).toBeUndefined();
      expect(result.actions[0][3].feuille).toBe(100);
    });
    
    it('devrait gérer plusieurs TimeEntries', () => {
      const timeEntries = [
        { id: 1, heures: null, heuresPrevues: 3, feuille: null },
        { id: 2, heures: 2, heuresPrevues: 3, feuille: null },
        { id: 3, heures: 0, heuresPrevues: 3, feuille: 100 }
      ];
      const result = workflow.buildSubmissionActions({
        sheetId: 100,
        timeEntries
      });
      
      // 3 TimeEntries + 1 Feuille = 4 actions
      // Mais la 3ème a déjà feuille=100 et heures=0, donc pas de mise à jour
      expect(result.actions.length).toBeGreaterThanOrEqual(3);
    });
  });
  
  describe('buildValidationAction', () => {
    it('devrait produire une seule action sur Feuilles', () => {
      const result = workflow.buildValidationAction({
        sheetId: 100,
        validatorId: 1,
        validationDate: 1704672000
      });
      
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0][0]).toBe('UpdateRecord');
      expect(result.actions[0][1]).toBe('Feuilles');
      expect(result.actions[0][2]).toBe(100);
      expect(result.actions[0][3].statut).toBe('valide');
      expect(result.actions[0][3].validePar).toBe(1);
      expect(result.actions[0][3].dateValidation).toBe(1704672000);
      expect(result.actions[0][3].motifRejet).toBe('');
    });
    
    it('devrait utiliser le timestamp actuel si non fourni', () => {
      const result = workflow.buildValidationAction({
        sheetId: 100,
        validatorId: 1
      });
      
      expect(result.actions[0][3].dateValidation).toBeGreaterThan(0);
    });
  });
  
  describe('buildRejectionAction', () => {
    it('devrait produire une seule action sur Feuilles avec motif', () => {
      const result = workflow.buildRejectionAction({
        sheetId: 100,
        rejectReason: 'Travail incomplet'
      });
      
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0][3].statut).toBe('rejete');
      expect(result.actions[0][3].motifRejet).toBe('Travail incomplet');
      expect(result.actions[0][3].validePar).toBeNull();
      expect(result.actions[0][3].dateValidation).toBeNull();
    });
    
    it('devrait refuser sans motif', () => {
      const result = workflow.buildRejectionAction({
        sheetId: 100,
        rejectReason: ''
      });
      
      expect(result.actions).toHaveLength(0);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('MISSING_REJECT_REASON');
    });
  });
  
  describe('buildWithdrawActions', () => {
    it('devrait produire une action pour repasser en brouillon', () => {
      const result = workflow.buildWithdrawActions({
        sheetId: 100
      });
      
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0][3].statut).toBe('brouillon');
    });
  });
});

describe('CRA Sheet Workflow - Helpers dates', () => {
  describe('isoToGristDate', () => {
    it('devrait convertir ISO en timestamp Grist', () => {
      const result = workflow.isoToGristDate('2024-01-08');
      expect(result).toBe(1704672000);
    });
    
    it('devrait retourner null pour une date invalide', () => {
      expect(workflow.isoToGristDate(null)).toBeNull();
      expect(workflow.isoToGristDate('invalid')).toBeNull();
    });
  });
  
  describe('gristDateToIso', () => {
    it('devrait convertir timestamp Grist en ISO', () => {
      const result = workflow.gristDateToIso(1704672000);
      expect(result).toBe('2024-01-08');
    });
    
    it('devrait retourner null pour une date invalide', () => {
      expect(workflow.gristDateToIso(null)).toBeNull();
      expect(workflow.gristDateToIso('invalid')).toBeNull();
    });
  });
});
