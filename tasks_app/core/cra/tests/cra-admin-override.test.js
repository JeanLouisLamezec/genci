'use strict';

const workflow = require('../workflow/cra-sheet-workflow.js');
const controller = require('../controller/cra-time-entry-controller.js');

const WEEK = '2026-08-24';

function sheet(overrides = {}) {
  return {
    id: 50,
    membre: 1,
    semaine: WEEK,
    statut: 'soumis',
    responsableValidation: null,
    ...overrides
  };
}

describe('CRA - passe-droit administrateur fonctionnel', () => {
  test('un admin peut saisir directement dans le brouillon d’un autre membre', () => {
    expect(controller.canDirectEditPersonSheet(1, true, 2)).toBe(true);
    expect(controller.canDirectEditPersonSheet(1, false, 2)).toBe(false);
    expect(controller.canDirectEditPersonSheet(2, false, 2)).toBe(true);
  });

  test('un admin peut valider sa propre feuille même sans responsable photographié', () => {
    const current = sheet();

    expect(workflow.canValidateSheet({
      actorMemberId: 1,
      actorIsAdmin: true,
      sheet: current,
      sheets: [current],
      validationResult: { valid: true }
    }).can).toBe(true);

    expect(workflow.canValidateSheet({
      actorMemberId: 1,
      actorIsAdmin: false,
      sheet: current,
      sheets: [current],
      validationResult: { valid: true }
    }).code).toBe('SELF_VALIDATION_FORBIDDEN');
  });

  test('un admin peut rejeter une feuille hors de son périmètre', () => {
    const current = sheet({ membre: 2, responsableValidation: 3 });
    const result = workflow.canRejectSheet({
      actorMemberId: 1,
      actorIsAdmin: true,
      sheet: current,
      sheets: [current],
      rejectReason: 'Correction nécessaire'
    });
    expect(result.can).toBe(true);
  });

  test('un admin peut ouvrir et éditer une correction manager', () => {
    const validated = sheet({ membre: 2, statut: 'valide', responsableValidation: 3 });
    expect(workflow.canOpenManagerCorrection({
      actorMemberId: 1,
      actorIsAdmin: true,
      sheet: validated,
      sheets: [validated],
      correctionReason: 'Régularisation'
    }).can).toBe(true);

    const correction = { ...validated, statut: 'correction_manager' };
    expect(workflow.canManagerEditActual({
      actorMemberId: 1,
      actorIsAdmin: true,
      sheet: correction,
      timeEntry: { id: 70, membre: 2, feuille: 50, date: WEEK }
    }).can).toBe(true);
  });

  test('un admin peut soumettre la feuille d’un autre membre si les invariants sont valides', () => {
    const draft = sheet({ membre: 2, statut: 'brouillon', responsableValidation: null });
    const result = workflow.canSubmitSheet({
      actorMemberId: 1,
      actorIsAdmin: true,
      sheet: draft,
      sheets: [draft],
      team: [
        { id: 1, actif: true, estAdmin: true },
        { id: 2, actif: true, responsable: 3 },
        { id: 3, actif: true }
      ],
      timeEntries: []
    });
    expect(result.can).toBe(true);
  });
});
