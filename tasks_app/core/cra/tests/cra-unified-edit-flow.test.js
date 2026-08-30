'use strict';

const CRAController = require('../controller/cra-time-entry-controller');

const TASK_ID = 7;
const MEMBER_ID = 3;
const DATE_ISO = '2026-08-25';
const WEEK_ISO = '2026-08-24';

function ts(iso) {
  return Date.parse(iso + 'T00:00:00Z') / 1000;
}

function dependencies(overrides) {
  const applyUserActions = jest.fn().mockResolvedValue({ retValues: [101] });
  return Object.assign({
    tasks: [{ id: TASK_ID, projet: 9 }],
    projects: [{ id: 9, dateDebut: ts('2026-01-01'), dateFin: ts('2026-12-31') }],
    assignments: [{
      id: 40,
      tache: TASK_ID,
      membre: MEMBER_ID,
      actif: true,
      modeRepartition: 'uniforme',
      dateDebut: ts('2026-08-01'),
      dateFin: ts('2026-08-31')
    }],
    entries: [],
    sheets: [{
      id: 50,
      membre: MEMBER_ID,
      semaine: ts(WEEK_ISO),
      statut: 'brouillon'
    }],
    dailyCapacities: [],
    team: [{ id: MEMBER_ID, capaciteHebdo: 35 }],
    grist: { docApi: { applyUserActions } },
    ensureWeeklySheet: null
  }, overrides || {});
}

describe('workflow unifié de saisie CRA', () => {
  test('une saisie historique existante reste modifiable après désactivation de son affectation', async () => {
    const deps = dependencies({
      assignments: [{
        id: 40,
        tache: TASK_ID,
        membre: MEMBER_ID,
        actif: false,
        modeRepartition: 'uniforme',
        dateDebut: ts('2026-08-01'),
        dateFin: ts('2026-08-10')
      }],
      entries: [{
        id: 80,
        tache: TASK_ID,
        membre: MEMBER_ID,
        date: ts(DATE_ISO),
        heures: 2,
        affectation: 40,
        feuille: 50
      }]
    });

    const result = await CRAController.saveCraCellChange({
      taskId: TASK_ID,
      personId: MEMBER_ID,
      dateIso: DATE_ISO,
      hours: 4
    }, deps);

    expect(result).toMatchObject({
      ok: true,
      action: 'update',
      entryId: 80,
      assignmentId: 40,
      sheetId: 50
    });
    expect(deps.grist.docApi.applyUserActions).toHaveBeenCalledWith([
      ['UpdateRecord', 'TimeEntries', 80, { heures: 4 }]
    ]);
  });

  test('une ancienne saisie orpheline crée la feuille puis est rattachée avant modification', async () => {
    const ensuredSheet = {
      id: 51,
      membre: MEMBER_ID,
      semaine: ts(WEEK_ISO),
      statut: 'brouillon'
    };
    const ensureWeeklySheet = jest.fn().mockResolvedValue({
      success: true,
      created: true,
      sheet: ensuredSheet,
      sheetId: 51
    });
    const deps = dependencies({
      assignments: [],
      sheets: [],
      entries: [{
        id: 81,
        tache: TASK_ID,
        membre: MEMBER_ID,
        date: ts(DATE_ISO),
        heures: 1,
        affectation: null,
        feuille: null
      }],
      ensureWeeklySheet
    });

    const result = await CRAController.saveCraCellChange({
      taskId: TASK_ID,
      personId: MEMBER_ID,
      dateIso: DATE_ISO,
      hours: 3
    }, deps);

    expect(ensureWeeklySheet).toHaveBeenCalledWith(expect.objectContaining({
      memberId: MEMBER_ID,
      weekStartIso: WEEK_ISO,
      createOnlyWhenEntriesExist: false
    }));
    expect(deps.grist.docApi.applyUserActions).toHaveBeenCalledWith([
      ['UpdateRecord', 'TimeEntries', 81, { feuille: 51 }],
      ['UpdateRecord', 'TimeEntries', 81, { heures: 3 }]
    ]);
    expect(result).toMatchObject({
      ok: true,
      action: 'update',
      sheetId: 51,
      fields: { heures: 3, feuille: 51 },
      actionsExecuted: 2
    });
  });

  test('une nouvelle saisie sans affectation valide reste interdite et ne crée pas de feuille', async () => {
    const ensureWeeklySheet = jest.fn();
    const deps = dependencies({ assignments: [], sheets: [], ensureWeeklySheet });

    const result = await CRAController.saveCraCellChange({
      taskId: TASK_ID,
      personId: MEMBER_ID,
      dateIso: DATE_ISO,
      hours: 2
    }, deps);

    expect(result).toMatchObject({ ok: false, code: 'MISSING_ACTIVE_ASSIGNMENT' });
    expect(ensureWeeklySheet).not.toHaveBeenCalled();
    expect(deps.grist.docApi.applyUserActions).not.toHaveBeenCalled();
  });

  test('la première nouvelle saisie matérialise automatiquement sa feuille', async () => {
    const ensuredSheet = {
      id: 52,
      membre: MEMBER_ID,
      semaine: ts(WEEK_ISO),
      statut: 'brouillon'
    };
    const deps = dependencies({
      sheets: [],
      ensureWeeklySheet: jest.fn().mockResolvedValue({
        success: true,
        created: true,
        sheet: ensuredSheet,
        sheetId: 52
      })
    });

    const result = await CRAController.saveCraCellChange({
      taskId: TASK_ID,
      personId: MEMBER_ID,
      dateIso: DATE_ISO,
      hours: 2
    }, deps);

    expect(result).toMatchObject({
      ok: true,
      action: 'create',
      sheetId: 52,
      sheet: ensuredSheet,
      sheetCreated: true
    });
    expect(result.fields).toMatchObject({
      membre: MEMBER_ID,
      tache: TASK_ID,
      affectation: 40,
      feuille: 52,
      heures: 2
    });
  });

  test('une deuxième édition retrouve dans Grist la feuille absente du cache local', async () => {
    const fetchedSheet = {
      id: [52],
      membre: [MEMBER_ID],
      semaine: [ts(WEEK_ISO)],
      statut: ['brouillon']
    };
    const ensureWeeklySheet = jest.fn();
    const deps = dependencies({
      sheets: [],
      entries: [{
        id: 84,
        tache: TASK_ID,
        membre: MEMBER_ID,
        date: ts(DATE_ISO),
        heures: 7,
        affectation: 40,
        feuille: 52
      }],
      ensureWeeklySheet
    });
    deps.grist.docApi.fetchTable = jest.fn().mockResolvedValue(fetchedSheet);

    const result = await CRAController.saveCraCellChange({
      taskId: TASK_ID,
      personId: MEMBER_ID,
      dateIso: DATE_ISO,
      hours: 6
    }, deps);

    expect(deps.grist.docApi.fetchTable).toHaveBeenCalledWith('Feuilles');
    expect(ensureWeeklySheet).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      action: 'update',
      entryId: 84,
      sheetId: 52,
      sheet: expect.objectContaining({ id: 52, membre: MEMBER_ID }),
      fields: { heures: 6 }
    });
    expect(deps.grist.docApi.applyUserActions).toHaveBeenCalledWith([
      ['UpdateRecord', 'TimeEntries', 84, { heures: 6 }]
    ]);
  });

  test.each(['soumis', 'valide', 'correction_manager'])(
    'la saisie normale est verrouillée pour une feuille %s',
    async (statut) => {
      const deps = dependencies({
        sheets: [{ id: 50, membre: MEMBER_ID, semaine: ts(WEEK_ISO), statut }],
        entries: [{
          id: 82,
          tache: TASK_ID,
          membre: MEMBER_ID,
          date: ts(DATE_ISO),
          heures: 2,
          affectation: 40,
          feuille: 50
        }]
      });

      const result = await CRAController.saveCraCellChange({
        taskId: TASK_ID,
        personId: MEMBER_ID,
        dateIso: DATE_ISO,
        hours: 3
      }, deps);

      expect(result).toMatchObject({ ok: false, code: 'SHEET_LOCKED', sheetStatus: statut });
      expect(deps.grist.docApi.applyUserActions).not.toHaveBeenCalled();
    }
  );

  test('une saisie liée à la mauvaise semaine est bloquée sans réparation implicite', async () => {
    const deps = dependencies({
      sheets: [{ id: 60, membre: MEMBER_ID, semaine: ts('2026-08-17'), statut: 'brouillon' }],
      entries: [{
        id: 83,
        tache: TASK_ID,
        membre: MEMBER_ID,
        date: ts(DATE_ISO),
        heures: 2,
        affectation: 40,
        feuille: 60
      }]
    });

    const result = await CRAController.saveCraCellChange({
      taskId: TASK_ID,
      personId: MEMBER_ID,
      dateIso: DATE_ISO,
      hours: 3
    }, deps);

    expect(result).toMatchObject({ ok: false, code: 'TIME_ENTRY_SHEET_MISMATCH', sheetId: 60 });
    expect(deps.grist.docApi.applyUserActions).not.toHaveBeenCalled();
  });

  test('correction_manager est aussi verrouillé par isPersonWeekLocked', () => {
    const result = CRAController.isPersonWeekLocked(MEMBER_ID, WEEK_ISO, [{
      id: 70,
      membre: MEMBER_ID,
      semaine: ts(WEEK_ISO),
      statut: 'correction_manager'
    }]);

    expect(result.locked).toBe(true);
  });
});
