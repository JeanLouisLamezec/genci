/**
 * Tests pour CRA Sheet Validation Service - Étape 4 Bis
 *
 * Tests du service transactionnel avec :
 * - Double lecture systématique
 * - Re-construction depuis snapshot 2 en cas de changement
 * - Re-validation fonctionnelle
 * - Vérification post-écriture complète
 */

'use strict';

const service = require('../workflow/cra-sheet-validation-service.js');
const workflow = require('../workflow/cra-sheet-workflow.js');
const { createMockGrist } = require('../../grist/mock-grist');

// ============================================================================
// HELPERS DE TEST
// ============================================================================

function createBaseData(options = {}) {
  const {
    sheetStatut = 'brouillon',
    sheetRevision = 0,
    entryHeures = null,
    entryHeuresPrevues = 7,
    entryFeuille = 1
  } = options;

  const hasValidationSnapshot = ['soumis', 'valide', 'correction_manager'].includes(sheetStatut);

  return {
    Team: [
      { id: 1, nom: 'Manager', responsable: null, email: 'manager@example.com' },
      { id: 2, nom: 'Employee', responsable: 1, email: 'employee@example.com' }
    ],
    Feuilles: [
      {
        id: 1,
        membre: 2,
        semaine: 1704672000,
        statut: sheetStatut,
        responsableValidation: hasValidationSnapshot ? 1 : null,
        soumisPar: hasValidationSnapshot ? 2 : null,
        dateSoumission: hasValidationSnapshot ? 1704672000 : null,
        revisionValidation: sheetRevision,
        validePar: null,
        dateValidation: null,
        motifRejet: '',
        motifCorrection: ''
      }
    ],
    TimeEntries: [
      {
        id: 1,
        membre: 2,
        tache: 1,
        date: 1704672000,
        heures: entryHeures,
        heuresPrevues: entryHeuresPrevues,
        feuille: entryFeuille
      }
    ],
    MemberDailyCapacities: [
      { id: 1, membre: 2, date: 1704672000, capaciteTheorique: 7, capaciteDisponible: 7, revision: 1 },
      { id: 2, membre: 2, date: 1704758400, capaciteTheorique: 7, capaciteDisponible: 7, revision: 1 },
      { id: 3, membre: 2, date: 1704844800, capaciteTheorique: 7, capaciteDisponible: 7, revision: 1 },
      { id: 4, membre: 2, date: 1704931200, capaciteTheorique: 7, capaciteDisponible: 7, revision: 1 },
      { id: 5, membre: 2, date: 1705017600, capaciteTheorique: 7, capaciteDisponible: 7, revision: 1 }
    ]
  };
}

function createMockGristWithData(data) {
  return createMockGrist({ initialData: data });
}

// ============================================================================
// TESTS : VALIDATION DES PARAMÈTRES
// ============================================================================

describe('CRA Sheet Validation Service - Validation des paramètres', () => {
  describe('submitSheet', () => {
    it('devrait rejeter sans grist', async () => {
      const result = await service.submitSheet({
        grist: null,
        actorMemberId: 2,
        sheetId: 1,
        nowUnixSeconds: 1704672000
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe('GRIST_API_UNAVAILABLE');
    });

    it('devrait rejeter avec sheetId invalide', async () => {
      const grist = createMockGristWithData(createBaseData());
      const result = await service.submitSheet({
        grist,
        actorMemberId: 2,
        sheetId: null,
        nowUnixSeconds: 1704672000
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe('SHEET_ID_INVALID');
    });

    it('devrait rejeter avec actorMemberId invalide', async () => {
      const grist = createMockGristWithData(createBaseData());
      const result = await service.submitSheet({
        grist,
        actorMemberId: null,
        sheetId: 1,
        nowUnixSeconds: 1704672000
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe('ACTOR_NOT_IDENTIFIED');
    });

    it('devrait rejeter avec timestamp invalide', async () => {
      const grist = createMockGristWithData(createBaseData());
      const result = await service.submitSheet({
        grist,
        actorMemberId: 2,
        sheetId: 1,
        nowUnixSeconds: null
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_NOW_UNIX_SECONDS');
    });
  });
});

// ============================================================================
// TESTS : SOUMISSION
// ============================================================================

describe('CRA Sheet Validation Service - Soumission', () => {
  it('devrait soumettre une feuille nominalement', async () => {
    const data = createBaseData();
    const grist = createMockGristWithData(data);

    const result = await service.submitSheet({
      grist,
      actorMemberId: 2,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(true);
    expect(result.code).toBe('OK');
    expect(result.sheetId).toBe(1);
    expect(result.transition).toBe('submit');
    expect(result.appliedActions).toBeGreaterThan(0);
  });

  it('devrait photographier le manager responsableValidation', async () => {
    const data = createBaseData();
    const grist = createMockGristWithData(data);

    const result = await service.submitSheet({
      grist,
      actorMemberId: 2,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(true);
    const sheets = await grist.docApi.fetchTable('Feuilles');
    const sheetIndex = sheets.id.indexOf(1);
    expect(sheets.responsableValidation[sheetIndex]).toBe(1);
  });

  it('devrait matérialiser les heures null avec heuresPrevues', async () => {
    const data = createBaseData();
    const grist = createMockGristWithData(data);

    const result = await service.submitSheet({
      grist,
      actorMemberId: 2,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(true);
    const entries = await grist.docApi.fetchTable('TimeEntries');
    const entryIndex = entries.id.indexOf(1);
    expect(entries.heures[entryIndex]).toBe(7);
  });

  it('devrait conserver les heures explicites', async () => {
    const data = createBaseData({ entryHeures: 2 });
    const grist = createMockGristWithData(data);

    const result = await service.submitSheet({
      grist,
      actorMemberId: 2,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(true);
    const entries = await grist.docApi.fetchTable('TimeEntries');
    const entryIndex = entries.id.indexOf(1);
    expect(entries.heures[entryIndex]).toBe(2);
  });

  it('devrait rejeter si acteur non propriétaire', async () => {
    const data = createBaseData();
    const grist = createMockGristWithData(data);

    const result = await service.submitSheet({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('NOT_SHEET_OWNER');
  });

  it('devrait rejeter si feuille absente', async () => {
    const data = createBaseData();
    const grist = createMockGristWithData(data);

    const result = await service.submitSheet({
      grist,
      actorMemberId: 2,
      sheetId: 99,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('SHEET_NOT_FOUND');
  });

  it('devrait rejeter si entrée sans feuille', async () => {
    const data = createBaseData({ entryFeuille: null });
    const grist = createMockGristWithData(data);

    const result = await service.submitSheet({
      grist,
      actorMemberId: 2,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('TIME_ENTRY_SCOPE_INCOMPLETE');
  });
});

// ============================================================================
// TESTS : RETRAIT
// ============================================================================

describe('CRA Sheet Validation Service - Retrait', () => {
  it('devrait retirer une soumission nominalement', async () => {
    const data = createBaseData({ sheetStatut: 'soumis' });
    const grist = createMockGristWithData(data);

    const result = await service.withdrawSheet({
      grist,
      actorMemberId: 2,
      sheetId: 1
    });

    expect(result.success).toBe(true);
    expect(result.code).toBe('OK');
    expect(result.transition).toBe('withdraw');

    const sheets = await grist.docApi.fetchTable('Feuilles');
    const sheetIndex = sheets.id.indexOf(1);
    expect(sheets.statut[sheetIndex]).toBe('brouillon');
  });

  it('devrait refuser si feuille validée', async () => {
    const data = createBaseData({ sheetStatut: 'soumis' });
    data.Feuilles[0].validePar = 1;
    data.Feuilles[0].dateValidation = 1704672000;
    const grist = createMockGristWithData(data);

    const result = await service.withdrawSheet({
      grist,
      actorMemberId: 2,
      sheetId: 1
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('SHEET_ALREADY_VALIDATED');
  });
});

// ============================================================================
// TESTS : VALIDATION
// ============================================================================

describe('CRA Sheet Validation Service - Validation', () => {
  it('devrait valider une feuille nominalement', async () => {
    const data = createBaseData({ sheetStatut: 'soumis' });
    const grist = createMockGristWithData(data);

    const result = await service.validateSheet({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(true);
    expect(result.code).toBe('OK');
    expect(result.transition).toBe('validate');

    const sheets = await grist.docApi.fetchTable('Feuilles');
    const sheetIndex = sheets.id.indexOf(1);
    expect(sheets.statut[sheetIndex]).toBe('valide');
    expect(sheets.validePar[sheetIndex]).toBe(1);
  });

  it('devrait appeler le validateur fonctionnel', async () => {
    const data = createBaseData({ sheetStatut: 'soumis' });
    const grist = createMockGristWithData(data);

    const result = await service.validateSheet({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.validation).toBeDefined();
    expect(result.validation.valid).toBe(true);
  });

  it('devrait incrémenter la révision', async () => {
    const data = createBaseData({ sheetStatut: 'soumis', sheetRevision: 1 });
    const grist = createMockGristWithData(data);

    const result = await service.validateSheet({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(true);
    const sheets = await grist.docApi.fetchTable('Feuilles');
    const sheetIndex = sheets.id.indexOf(1);
    expect(sheets.revisionValidation[sheetIndex]).toBe(2);
  });

  it('devrait refuser avec validation fonctionnelle invalide', async () => {
    const data = createBaseData({ sheetStatut: 'soumis', entryHeures: 50 });
    const grist = createMockGristWithData(data);

    const result = await service.validateSheet({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('TIMESHEET_VALIDATION_FAILED');
  });

  it('devrait utiliser le manager snapshoté', async () => {
    const data = createBaseData({ sheetStatut: 'soumis' });
    const grist = createMockGristWithData(data);

    const result = await service.validateSheet({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(true);
    const sheets = await grist.docApi.fetchTable('Feuilles');
    const sheetIndex = sheets.id.indexOf(1);
    expect(sheets.validePar[sheetIndex]).toBe(1);
  });
});

// ============================================================================
// TESTS : REJET
// ============================================================================

describe('CRA Sheet Validation Service - Rejet', () => {
  it('devrait rejeter une feuille nominalement', async () => {
    const data = createBaseData({ sheetStatut: 'soumis' });
    const grist = createMockGristWithData(data);

    const result = await service.rejectSheet({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      rejectReason: 'Travail incomplet'
    });

    expect(result.success).toBe(true);
    expect(result.code).toBe('OK');
    expect(result.transition).toBe('reject');

    const sheets = await grist.docApi.fetchTable('Feuilles');
    const sheetIndex = sheets.id.indexOf(1);
    expect(sheets.statut[sheetIndex]).toBe('rejete');
    expect(sheets.motifRejet[sheetIndex]).toBe('Travail incomplet');
  });

  it('devrait trimmer le motif', async () => {
    const data = createBaseData({ sheetStatut: 'soumis' });
    const grist = createMockGristWithData(data);

    const result = await service.rejectSheet({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      rejectReason: '  Travail incomplet  '
    });

    expect(result.success).toBe(true);
    const sheets = await grist.docApi.fetchTable('Feuilles');
    const sheetIndex = sheets.id.indexOf(1);
    expect(sheets.motifRejet[sheetIndex]).toBe('Travail incomplet');
  });

  it('devrait refuser sans motif', async () => {
    const data = createBaseData({ sheetStatut: 'soumis' });
    const grist = createMockGristWithData(data);

    const result = await service.rejectSheet({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      rejectReason: ''
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('MISSING_REJECT_REASON');
  });
});

// ============================================================================
// TESTS : CORRECTION MANAGER
// ============================================================================

describe('CRA Sheet Validation Service - Correction manager', () => {
  it('devrait ouvrir une correction nominalement', async () => {
    const data = createBaseData({ sheetStatut: 'valide' });
    data.Feuilles[0].validePar = 1;
    const grist = createMockGristWithData(data);

    const result = await service.openManagerCorrection({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      correctionReason: 'Erreur de saisie'
    });

    expect(result.success).toBe(true);
    expect(result.code).toBe('OK');
    expect(result.transition).toBe('open_correction');

    const sheets = await grist.docApi.fetchTable('Feuilles');
    const sheetIndex = sheets.id.indexOf(1);
    expect(sheets.statut[sheetIndex]).toBe('correction_manager');
    expect(sheets.motifCorrection[sheetIndex]).toBe('Erreur de saisie');
  });

  it('devrait refuser sans motif', async () => {
    const data = createBaseData({ sheetStatut: 'valide' });
    const grist = createMockGristWithData(data);

    const result = await service.openManagerCorrection({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      correctionReason: ''
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('MISSING_CORRECTION_REASON');
  });

  it('devrait refuser si feuille non validée', async () => {
    const data = createBaseData({ sheetStatut: 'brouillon' });
    const grist = createMockGristWithData(data);

    const result = await service.openManagerCorrection({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      correctionReason: 'Erreur'
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('SHEET_NOT_VALIDATED');
  });
});

// ============================================================================
// TESTS : REVALIDATION
// ============================================================================

describe('CRA Sheet Validation Service - Revalidation', () => {
  it('devrait revalider une feuille nominalement', async () => {
    const data = createBaseData({ sheetStatut: 'correction_manager' });
    data.Feuilles[0].motifCorrection = 'Erreur corrigée';
    const grist = createMockGristWithData(data);

    const result = await service.revalidateSheet({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(true);
    expect(result.code).toBe('OK');
    expect(result.transition).toBe('revalidate');

    const sheets = await grist.docApi.fetchTable('Feuilles');
    const sheetIndex = sheets.id.indexOf(1);
    expect(sheets.statut[sheetIndex]).toBe('valide');
  });

  it('devrait incrémenter la révision', async () => {
    const data = createBaseData({ sheetStatut: 'correction_manager', sheetRevision: 1 });
    const grist = createMockGristWithData(data);

    const result = await service.revalidateSheet({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(true);
    const sheets = await grist.docApi.fetchTable('Feuilles');
    const sheetIndex = sheets.id.indexOf(1);
    expect(sheets.revisionValidation[sheetIndex]).toBe(2);
  });

  it('devrait conserver le motifCorrection', async () => {
    const data = createBaseData({ sheetStatut: 'correction_manager' });
    data.Feuilles[0].motifCorrection = 'Erreur corrigée';
    const grist = createMockGristWithData(data);

    const result = await service.revalidateSheet({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(true);
    const sheets = await grist.docApi.fetchTable('Feuilles');
    const sheetIndex = sheets.id.indexOf(1);
    expect(sheets.motifCorrection[sheetIndex]).toBe('Erreur corrigée');
  });

  it('devrait requérir la validation fonctionnelle', async () => {
    const data = createBaseData({ sheetStatut: 'correction_manager', entryHeures: 50 });
    const grist = createMockGristWithData(data);

    const result = await service.revalidateSheet({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('TIMESHEET_VALIDATION_FAILED');
  });
});

// ============================================================================
// TESTS : EMPREINTE ET CONCURRENCE
// ============================================================================

describe('CRA Sheet Validation Service - Empreinte', () => {
  it('devrait construire une empreinte déterministe', () => {
    const sheet = {
      id: 1,
      membre: 2,
      semaine: 1704672000,
      statut: 'brouillon'
    };

    const timeEntries = [
      { id: 1, membre: 2, date: 1704672000, feuille: 1, heures: 3, heuresPrevues: 3 }
    ];

    const allMemberWeekEntries = [];
    const directManagerId = 1;

    const fingerprint1 = service.buildFingerprint(sheet, timeEntries, allMemberWeekEntries, directManagerId);
    const fingerprint2 = service.buildFingerprint(sheet, timeEntries, allMemberWeekEntries, directManagerId);

    expect(fingerprint1).toBe(fingerprint2);
  });

  it('devrait changer l\'empreinte si les heures changent', () => {
    const sheet = {
      id: 1,
      membre: 2,
      semaine: 1704672000,
      statut: 'brouillon'
    };

    const timeEntries1 = [
      { id: 1, membre: 2, date: 1704672000, feuille: 1, heures: 3, heuresPrevues: 3 }
    ];

    const timeEntries2 = [
      { id: 1, membre: 2, date: 1704672000, feuille: 1, heures: 4, heuresPrevues: 3 }
    ];

    const allMemberWeekEntries = [];
    const directManagerId = 1;

    const fingerprint1 = service.buildFingerprint(sheet, timeEntries1, allMemberWeekEntries, directManagerId);
    const fingerprint2 = service.buildFingerprint(sheet, timeEntries2, allMemberWeekEntries, directManagerId);

    expect(fingerprint1).not.toBe(fingerprint2);
  });

  it('devrait changer l\'empreinte si le manager change', () => {
    const sheet = {
      id: 1,
      membre: 2,
      semaine: 1704672000,
      statut: 'brouillon'
    };

    const timeEntries = [];
    const allMemberWeekEntries = [];

    const fingerprint1 = service.buildFingerprint(sheet, timeEntries, allMemberWeekEntries, 1);
    const fingerprint2 = service.buildFingerprint(sheet, timeEntries, allMemberWeekEntries, 3);

    expect(fingerprint1).not.toBe(fingerprint2);
  });

  it('devrait changer l\'empreinte si des entrées hors scope apparaissent', () => {
    const sheet = {
      id: 1,
      membre: 2,
      semaine: 1704672000,
      statut: 'brouillon'
    };

    const timeEntries = [];
    const allMemberWeekEntries1 = [];
    const allMemberWeekEntries2 = [
      { id: 99, membre: 2, date: 1704672000, feuille: null, heures: 3 }
    ];

    const fingerprint1 = service.buildFingerprint(sheet, timeEntries, allMemberWeekEntries1, 1);
    const fingerprint2 = service.buildFingerprint(sheet, timeEntries, allMemberWeekEntries2, 1);

    expect(fingerprint1).not.toBe(fingerprint2);
  });
});

// ============================================================================
// TESTS : LOAD SNAPSHOT
// ============================================================================

describe('CRA Sheet Validation Service - Load Snapshot', () => {
  it('devrait charger un snapshot complet', async () => {
    const data = createBaseData();
    const grist = createMockGristWithData(data);

    const snapshot = await service.loadWorkflowSnapshot(grist, 1);

    expect(snapshot.team).toBeDefined();
    expect(snapshot.sheets).toBeDefined();
    expect(snapshot.sheet).toBeDefined();
    expect(snapshot.timeEntries).toBeDefined();
    expect(snapshot.allMemberWeekEntries).toBeDefined();
    expect(snapshot.directManagerId).toBe(1);
    expect(snapshot.fingerprint).toBeDefined();
    expect(snapshot.sheet.id).toBe(1);
  });

  it('devrait échouer si feuille non trouvée', async () => {
    const data = createBaseData();
    const grist = createMockGristWithData(data);

    await expect(service.loadWorkflowSnapshot(grist, 99))
      .rejects
      .toThrow('Feuille non trouvée');
  });
});

// ============================================================================
// TESTS : CONCURRENCE RÉELLE
// ============================================================================

describe('CRA Sheet Validation Service - Concurrence réelle', () => {
  it('devrait détecter un changement de révision entre les lectures', async () => {
    const data = createBaseData({ sheetStatut: 'soumis', sheetRevision: 0 });
    const grist = createMockGristWithData(data);

    let sheetFetchCount = 0;
    const originalFetchTable = grist.docApi.fetchTable.bind(grist.docApi);
    grist.docApi.fetchTable = async (tableId) => {
      if (tableId === 'Feuilles') sheetFetchCount++;
      const currentSheetFetch = sheetFetchCount;
      const result = await originalFetchTable(tableId);
      
      if (tableId === 'Feuilles' && currentSheetFetch === 2) {
        result.revisionValidation = result.revisionValidation.map(() => 5);
      }
      
      return result;
    };

    const result = await service.validateSheet({
      grist,
      actorMemberId: 1,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(true);
    const sheets = await grist.docApi.fetchTable('Feuilles');
    const sheetIndex = sheets.id.indexOf(1);
    expect(sheets.revisionValidation[sheetIndex]).toBe(6);
  });

  it('devrait rejeter si le statut change pendant la transaction', async () => {
    const data = createBaseData({ sheetStatut: 'soumis' });
    const grist = createMockGristWithData(data);

    let sheetFetchCount = 0;
    const originalFetchTable = grist.docApi.fetchTable.bind(grist.docApi);
    grist.docApi.fetchTable = async (tableId) => {
      if (tableId === 'Feuilles') sheetFetchCount++;
      const currentSheetFetch = sheetFetchCount;
      const result = await originalFetchTable(tableId);
      
      if (tableId === 'Feuilles' && currentSheetFetch === 2) {
        result.statut = result.statut.map(() => 'valide');
      }
      
      return result;
    };

    const result = await service.withdrawSheet({
      grist,
      actorMemberId: 2,
      sheetId: 1
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('WORKFLOW_STATE_CHANGED');
  });

  it('devrait rejeter si des entrées hors scope apparaissent', async () => {
    const data = createBaseData();
    data.TimeEntries = [
      { id: 1, membre: 2, tache: 1, date: 1704672000, heures: null, heuresPrevues: 7, feuille: 1 }
    ];
    const grist = createMockGristWithData(data);

    let callCount = 0;
    const originalFetchTable = grist.docApi.fetchTable.bind(grist.docApi);
    grist.docApi.fetchTable = async (tableId) => {
      callCount++;
      const result = await originalFetchTable(tableId);
      
      if (callCount > 3 && tableId === 'TimeEntries') {
        result.id.push(99);
        result.membre.push(2);
        result.tache.push(1);
        result.date.push(1704672000);
        result.heures.push(null);
        result.heuresPrevues.push(3);
        result.feuille.push(null);
      }
      
      return result;
    };

    const result = await service.submitSheet({
      grist,
      actorMemberId: 2,
      sheetId: 1,
      nowUnixSeconds: 1704672000
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('TIME_ENTRY_SCOPE_INCOMPLETE');
  });
});
