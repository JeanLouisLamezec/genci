'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const permissions = require('./taskflow-permissions.js');

function loadCore() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'taskflow-core.js'), 'utf8');
  const context = {
    console,
    URLSearchParams,
    location: { search: '' },
    setTimeout,
    clearTimeout,
    TaskFlowPermissions: permissions
  };
  context.globalThis = context;
  vm.runInNewContext(`${source}\nglobalThis.__TF = TF;`, context);
  return context.__TF;
}

describe('TaskFlow guardWrites - permissions fonctionnelles', () => {
  test('autorise puis invalide une mutation métier acceptée', async () => {
    const TF = loadCore();
    const raw = jest.fn(async () => ({ ok: true }));
    const runtime = {
      authorize: jest.fn(async () => ({ allowed: true })),
      invalidate: jest.fn()
    };
    const grist = { docApi: { applyUserActions: raw } };

    TF.guardWrites(grist, { permissionRuntime: runtime });
    await grist.docApi.applyUserActions([['UpdateRecord', 'Tasks', 1, { titre: 'X' }]]);

    expect(runtime.authorize).toHaveBeenCalledTimes(1);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(runtime.invalidate).toHaveBeenCalledTimes(1);
  });

  test('refuse tout le lot avant l’écriture et transmet le motif', async () => {
    const TF = loadCore();
    const raw = jest.fn();
    const decision = { allowed: false, code: 'TASK_OUTSIDE_SCOPE', message: 'Tâche hors périmètre' };
    const runtime = {
      authorize: jest.fn(async () => decision),
      invalidate: jest.fn()
    };
    const onPermissionDenied = jest.fn();
    const grist = { docApi: { applyUserActions: raw } };

    TF.guardWrites(grist, { permissionRuntime: runtime, onPermissionDenied });

    await expect(grist.docApi.applyUserActions([
      ['UpdateRecord', 'Tasks', 1, { dateDebut: 1 }],
      ['UpdateRecord', 'Tasks', 2, { dateDebut: 1 }]
    ])).rejects.toMatchObject({
      tfPermissionDenied: true,
      permissionDecision: decision
    });

    expect(raw).not.toHaveBeenCalled();
    expect(onPermissionDenied).toHaveBeenCalledWith(expect.objectContaining({ tfPermissionDenied: true }), decision);
  });

  test('laisse passer les écritures techniques non contrôlées', async () => {
    const TF = loadCore();
    const raw = jest.fn(async () => 'ok');
    const runtime = {
      authorize: jest.fn(),
      invalidate: jest.fn()
    };
    const grist = { docApi: { applyUserActions: raw } };

    TF.guardWrites(grist, { permissionRuntime: runtime });
    await grist.docApi.applyUserActions([['UpdateRecord', 'TaskAssignments', 1, { heuresAllouees: 10 }]]);

    expect(runtime.authorize).not.toHaveBeenCalled();
    expect(raw).toHaveBeenCalledTimes(1);
  });

  test('un second appel à guardWrites enrichit la garde existante', async () => {
    const TF = loadCore();
    const raw = jest.fn(async () => 'ok');
    const runtime = {
      authorize: jest.fn(async () => ({ allowed: true })),
      invalidate: jest.fn()
    };
    const grist = { docApi: { applyUserActions: raw } };

    TF.guardWrites(grist, { onDenied: jest.fn() });
    TF.guardWrites(grist, { permissionRuntime: runtime });
    await grist.docApi.applyUserActions([['UpdateRecord', 'Tasks', 1, { titre: 'X' }]]);

    expect(runtime.authorize).toHaveBeenCalledTimes(1);
  });
});
