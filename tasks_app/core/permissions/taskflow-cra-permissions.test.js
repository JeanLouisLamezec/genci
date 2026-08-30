'use strict';

const permissions = require('./taskflow-permissions.js');

function snapshot(actorId, isAdmin = false, sheetStatus = 'brouillon') {
  return permissions.createSnapshot({
    Team: [
      { id: 1, actif: true, estAdmin: isAdmin, responsable: null },
      { id: 2, actif: true, estAdmin: false, responsable: 1 }
    ],
    Feuilles: [{
      id: 10,
      membre: 2,
      semaine: 1704672000,
      statut: sheetStatus,
      responsableValidation: ['soumis', 'valide', 'correction_manager'].includes(sheetStatus) ? 1 : null,
      revisionValidation: 0
    }],
    TimeEntries: [{ id: 20, membre: 2, tache: 30, feuille: 10, heures: 4, affectation: 40 }],
    TaskAssignments: [{ id: 40, membre: 2, tache: 30, actif: true }]
  }, {
    identified: true,
    status: 'IDENTIFIED',
    memberId: actorId,
    isAdmin
  });
}

describe('permissions communes CRA', () => {
  test('le proprietaire cree sa feuille avec les seuls champs initiaux', () => {
    const result = permissions.authorizeMutationBatch(snapshot(2), [[
      'AddRecord', 'Feuilles', null,
      { membre: 2, semaine: 1704672000, statut: 'brouillon', revisionValidation: 0 }
    ]]);
    expect(result.allowed).toBe(true);
  });

  test('un executant ne forge pas le valideur photographie lors de la soumission', () => {
    const result = permissions.authorizeMutationBatch(snapshot(2), [[
      'UpdateRecord', 'Feuilles', 10,
      {
        statut: 'soumis', responsableValidation: 99, soumisPar: 2, dateSoumission: 1704672000,
        validePar: null, dateValidation: null, motifRejet: '', motifCorrection: '', revisionValidation: 0
      }
    ]]);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('CRA_SHEET_TRANSITION_FORBIDDEN');
  });

  test('le responsable photographie valide avec les champs exacts du workflow', () => {
    const result = permissions.authorizeMutationBatch(snapshot(1, false, 'soumis'), [[
      'UpdateRecord', 'Feuilles', 10,
      { statut: 'valide', validePar: 1, dateValidation: 1704672000, revisionValidation: 1, motifRejet: '' }
    ]]);
    expect(result.allowed).toBe(true);
  });

  test('un champ systeme supplementaire invalide une transition', () => {
    const result = permissions.authorizeMutationBatch(snapshot(1, false, 'soumis'), [[
      'UpdateRecord', 'Feuilles', 10,
      { statut: 'valide', validePar: 1, dateValidation: 1704672000, revisionValidation: 1, motifRejet: '', soumisPar: 1 }
    ]]);
    expect(result.allowed).toBe(false);
  });

  test('une saisie creee exige la bonne affectation active', () => {
    const accepted = permissions.authorizeMutationBatch(snapshot(2), [[
      'AddRecord', 'TimeEntries', null,
      { membre: 2, tache: 30, date: 1704672000, heures: 3, affectation: 40, feuille: 10 }
    ]]);
    const denied = permissions.authorizeMutationBatch(snapshot(2), [[
      'AddRecord', 'TimeEntries', null,
      { membre: 2, tache: 30, date: 1704672000, heures: 3, affectation: 999, feuille: 10 }
    ]]);
    expect(accepted.allowed).toBe(true);
    expect(denied.allowed).toBe(false);
    expect(denied.code).toBe('CRA_TIME_ENTRY_ASSIGNMENT_REQUIRED');
  });

  test('le rattachement puis la correction d une saisie orpheline reste reserve au proprietaire', () => {
    const ownerSnapshot = snapshot(2);
    ownerSnapshot.tables.TimeEntries[0].feuille = null;
    ownerSnapshot.indexes = null;

    const ownerResult = permissions.authorizeMutationBatch(ownerSnapshot, [
      ['UpdateRecord', 'TimeEntries', 20, { feuille: 10 }],
      ['UpdateRecord', 'TimeEntries', 20, { heures: 6 }]
    ]);

    const managerSnapshot = snapshot(1);
    managerSnapshot.tables.TimeEntries[0].feuille = null;
    managerSnapshot.indexes = null;
    const managerResult = permissions.authorizeMutationBatch(managerSnapshot, [
      ['UpdateRecord', 'TimeEntries', 20, { feuille: 10 }],
      ['UpdateRecord', 'TimeEntries', 20, { heures: 6 }]
    ]);

    expect(ownerResult.allowed).toBe(true);
    expect(managerResult.allowed).toBe(false);
    expect(managerResult.code).toBe('CRA_TIME_ENTRY_UPDATE_FORBIDDEN');
  });

  test('le responsable ne corrige que les heures en correction manager', () => {
    const accepted = permissions.authorizeMutationBatch(snapshot(1, false, 'correction_manager'), [[
      'UpdateRecord', 'TimeEntries', 20, { heures: 6 }
    ]]);
    const denied = permissions.authorizeMutationBatch(snapshot(1, false, 'correction_manager'), [[
      'UpdateRecord', 'TimeEntries', 20, { heures: 6, membre: 1 }
    ]]);
    expect(accepted.allowed).toBe(true);
    expect(denied.allowed).toBe(false);
  });

  test('un administrateur peut toute mutation CRA', () => {
    const result = permissions.authorizeMutationBatch(snapshot(1, true, 'valide'), [
      ['UpdateRecord', 'Feuilles', 10, { statut: 'brouillon', membre: 1 }],
      ['UpdateRecord', 'TimeEntries', 20, { membre: 1, heures: 12 }]
    ]);
    expect(result.allowed).toBe(true);
  });

  test('un responsable projet peut recalculer uniquement le prévisionnel de ses affectations', () => {
    const planningSnapshot = permissions.createSnapshot({
      Team: [
        { id: 1, actif: true, estAdmin: false },
        { id: 2, actif: true, estAdmin: false }
      ],
      Projects: [{ id: 10, responsable: 1 }],
      Tasks: [{ id: 30, projet: 10, assignees: ['L', 2] }],
      TaskAssignments: [{ id: 40, membre: 2, tache: 30, actif: true }],
      TimeEntries: [
        { id: 20, membre: 2, tache: 30, affectation: 40, heures: null, heuresPrevues: 4, feuille: null },
        { id: 21, membre: 2, tache: 30, affectation: 40, heures: 3, heuresPrevues: 4, feuille: null }
      ],
      Feuilles: []
    }, {
      identified: true,
      status: 'IDENTIFIED',
      memberId: 1,
      isAdmin: false
    });

    const creation = permissions.authorizeMutationBatch(planningSnapshot, [[
      'AddRecord', 'TimeEntries', null, {
        affectation: 40, tache: 30, membre: 2, date: 1704672000,
        heuresPrevues: 2, heures: null, capaciteTheorique: 7,
        capaciteDisponible: 7, capaciteJour: 50, revisionPlan: 1,
        description: null, imputation: null
      }
    ]]);
    const update = permissions.authorizeMutationBatch(planningSnapshot, [[
      'UpdateRecord', 'TimeEntries', 20,
      { heuresPrevues: 2, capaciteDisponible: 6, revisionPlan: 2 }
    ]]);
    const deletion = permissions.authorizeMutationBatch(planningSnapshot, [[
      'RemoveRecord', 'TimeEntries', 20
    ]]);

    expect(creation).toMatchObject({ allowed: true, code: 'BATCH_ALLOWED' });
    expect(update).toMatchObject({ allowed: true, code: 'BATCH_ALLOWED' });
    expect(deletion).toMatchObject({ allowed: true, code: 'BATCH_ALLOWED' });
  });

  test('un responsable projet ne peut pas transformer le recalcul en modification du réalisé', () => {
    const planningSnapshot = permissions.createSnapshot({
      Team: [{ id: 1, actif: true }, { id: 2, actif: true }],
      Projects: [{ id: 10, responsable: 1 }],
      Tasks: [{ id: 30, projet: 10 }],
      TaskAssignments: [{ id: 40, membre: 2, tache: 30, actif: true }],
      TimeEntries: [{ id: 20, membre: 2, tache: 30, affectation: 40, heures: 3, heuresPrevues: 4, feuille: null }],
      Feuilles: []
    }, { identified: true, status: 'IDENTIFIED', memberId: 1, isAdmin: false });

    const actualUpdate = permissions.authorizeMutationBatch(planningSnapshot, [[
      'UpdateRecord', 'TimeEntries', 20, { heures: 8 }
    ]]);
    const actualDelete = permissions.authorizeMutationBatch(planningSnapshot, [[
      'RemoveRecord', 'TimeEntries', 20
    ]]);

    expect(actualUpdate.allowed).toBe(false);
    expect(actualDelete.allowed).toBe(false);
  });
});
