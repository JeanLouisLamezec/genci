'use strict';

describe('CraWorkflowIntegration - régularisation rétroactive', () => {
  test('crée la feuille manager et rattache les TimeEntries prévisionnelles', async () => {
    jest.resetModules();
    delete global.CraWorkflowIntegration;
    require('../workflow/cra-workflow-integration.js');

    const mondaySeconds = Math.floor(new Date(2026, 1, 9, 12).getTime() / 1000);
    const wednesdaySeconds = Math.floor(new Date(2026, 1, 11, 12).getTime() / 1000);
    const state = {
      currentUserMemberId: 1,
      managerWorkspaceState: { directReportIds: [2] },
      feuilles: [],
      entries: [
        { id: 100, membre: 2, tache: 10, affectation: 20, date: wednesdaySeconds, heuresPrevues: 7, heures: null, feuille: null }
      ]
    };
    const applied = [];
    let enteredSheet = null;
    const grist = {
      docApi: {
        applyUserActions: jest.fn(async actions => {
          applied.push(...actions);
          return {};
        })
      }
    };
    const taskFlowCra = {
      service: {
        ensureWeeklySheet: jest.fn(async () => ({
          success: true,
          created: true,
          sheetId: 50,
          sheet: { id: 50, membre: 2, semaine: mondaySeconds, statut: 'brouillon' }
        }))
      },
      createUiAdapter: jest.fn(() => ({}))
    };

    global.CraWorkflowIntegration.configure({
      grist,
      taskFlowCra,
      getState: () => state,
      reload: async () => {
        state.feuilles = [{
          id: 50,
          membre: 2,
          semaine: mondaySeconds,
          statut: 'correction_manager',
          responsableValidation: 1
        }];
      },
      enterCorrectionMode: sheet => { enteredSheet = sheet; }
    });

    const result = await global.CraWorkflowIntegration.prepareRetroactiveCorrection(
      2,
      '2026-02-11',
      'Régularisation de février'
    );

    expect(result).toMatchObject({
      success: true,
      code: 'RETROACTIVE_CORRECTION_READY',
      sheetId: 50,
      linkedEntryCount: 1
    });
    expect(applied).toEqual([
      ['UpdateRecord', 'Feuilles', 50, {
        statut: 'correction_manager',
        responsableValidation: 1,
        motifCorrection: 'Régularisation de février'
      }],
      ['UpdateRecord', 'TimeEntries', 100, { feuille: 50 }]
    ]);
    expect(enteredSheet).toMatchObject({ id: 50, membre: 2, statut: 'correction_manager' });
  });
});
