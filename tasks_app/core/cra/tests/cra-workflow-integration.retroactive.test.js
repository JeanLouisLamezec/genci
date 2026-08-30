'use strict';

describe('CraWorkflowIntegration - régularisation rétroactive', () => {
  test('un admin peut soumettre puis retirer la feuille affichée d’un autre membre', async () => {
    jest.resetModules();
    delete global.CraWorkflowIntegration;
    require('../workflow/cra-workflow-integration.js');

    const mondaySeconds = Math.floor(new Date(2026, 7, 31, 12).getTime() / 1000);
    const targetSheet = {
      id: 50,
      membre: 2,
      semaine: mondaySeconds,
      statut: 'brouillon'
    };
    const adapter = {
      submit: jest.fn(async () => ({ success: true })),
      withdraw: jest.fn(async () => ({ success: true }))
    };

    global.CraWorkflowIntegration.configure({
      grist: { docApi: { applyUserActions: jest.fn() } },
      taskFlowCra: {
        service: {},
        createUiAdapter: jest.fn(() => adapter)
      },
      getState: () => ({
        currentUserMemberId: 1,
        currentUserActor: { isAdmin: true },
        weekStart: mondaySeconds,
        feuilles: [targetSheet],
        entries: []
      })
    });

    await expect(global.CraWorkflowIntegration.submitCurrentWeek(2))
      .resolves.toMatchObject({ success: true });
    await expect(global.CraWorkflowIntegration.withdrawCurrentWeek(2))
      .resolves.toMatchObject({ success: true });
    expect(adapter.submit).toHaveBeenCalledWith(50);
    expect(adapter.withdraw).toHaveBeenCalledWith(50);
  });

  test('un non-admin ne peut pas piloter directement la feuille d’un autre membre', async () => {
    jest.resetModules();
    delete global.CraWorkflowIntegration;
    require('../workflow/cra-workflow-integration.js');

    const adapter = {
      submit: jest.fn(),
      withdraw: jest.fn()
    };
    global.CraWorkflowIntegration.configure({
      grist: { docApi: {} },
      taskFlowCra: { service: {}, createUiAdapter: jest.fn(() => adapter) },
      getState: () => ({
        currentUserMemberId: 1,
        currentUserActor: { isAdmin: false },
        weekStart: Math.floor(new Date(2026, 7, 31, 12).getTime() / 1000),
        feuilles: [],
        entries: []
      })
    });

    await expect(global.CraWorkflowIntegration.submitCurrentWeek(2))
      .resolves.toMatchObject({ success: false, code: 'NOT_SHEET_OWNER' });
    await expect(global.CraWorkflowIntegration.withdrawCurrentWeek(2))
      .resolves.toMatchObject({ success: false, code: 'NOT_SHEET_OWNER' });
    expect(adapter.submit).not.toHaveBeenCalled();
    expect(adapter.withdraw).not.toHaveBeenCalled();
  });

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

  test('un admin entre dans une correction photographiée sur un autre valideur', async () => {
    jest.resetModules();
    delete global.CraWorkflowIntegration;
    require('../workflow/cra-workflow-integration.js');

    const correctionSheet = {
      id: 50,
      membre: 2,
      statut: 'correction_manager',
      responsableValidation: 9
    };
    let enteredSheet = null;
    global.CraWorkflowIntegration.configure({
      grist: { docApi: {} },
      taskFlowCra: { service: {}, createUiAdapter: jest.fn(() => ({})) },
      getState: () => ({
        currentUserMemberId: 1,
        currentUserActor: { isAdmin: true },
        feuilles: [correctionSheet]
      }),
      enterCorrectionMode: sheet => { enteredSheet = sheet; }
    });

    const result = await global.CraWorkflowIntegration.enterManagerCorrection(50);

    expect(result).toMatchObject({ success: true, code: 'MANAGER_CORRECTION_MODE_ENTERED' });
    expect(enteredSheet).toBe(correctionSheet);
  });
});
