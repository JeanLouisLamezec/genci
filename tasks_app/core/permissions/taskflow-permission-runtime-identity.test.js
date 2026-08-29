'use strict';

const permissions = require('./taskflow-permissions.js');

function token(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

function gristFixture() {
  const tables = {
    Team: {
      id: [7],
      nom: ['Alice'],
      email: ['alice@example.com'],
      gristUserId: [0],
      actif: [true],
      estAdmin: [false]
    },
    Tasks: { id: [1], titre: ['Interdite'], projet: [0], assignees: [null] }
  };
  return {
    docApi: {
      getAccessToken: jest.fn(async () => ({ token: token({ userId: 101, email: 'alice@example.com' }) })),
      listTables: jest.fn(async () => Object.keys(tables)),
      fetchTable: jest.fn(async table => tables[table] || { id: [] })
    }
  };
}

describe('Runtime permissions - identité commune', () => {
  test('expose le candidat d’association résolu avec l’email du jeton', async () => {
    const grist = gristFixture();
    const onIdentity = jest.fn();
    const runtime = permissions.createGristPermissionRuntime(grist, { onIdentity });

    await runtime.refresh();

    expect(runtime.getActor()).toMatchObject({
      status: 'ASSOCIATION_CONFIRMATION_REQUIRED',
      email: 'alice@example.com',
      associationCandidate: { id: 7 }
    });
    expect(runtime.getIdentityRuntime()).toBeDefined();
    expect(onIdentity).toHaveBeenCalledTimes(1);
  });

  test('recharge l’identité avant chaque décision d’écriture', async () => {
    const grist = gristFixture();
    const runtime = permissions.createGristPermissionRuntime(grist);
    await runtime.refresh();

    const decision = await runtime.authorize([
      ['UpdateRecord', 'Tasks', 1, { titre: 'Interdit sans association' }]
    ]);

    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('ASSOCIATION_CONFIRMATION_REQUIRED');
    expect(grist.docApi.getAccessToken).toHaveBeenCalledTimes(2);
    expect(grist.docApi.fetchTable.mock.calls.filter(([table]) => table === 'Team')).toHaveLength(2);
  });

  test('autorise uniquement l’écriture exacte de la première association', async () => {
    const grist = gristFixture();
    const runtime = permissions.createGristPermissionRuntime(grist);

    await expect(runtime.authorize([
      ['UpdateRecord', 'Team', 7, { gristUserId: 101 }]
    ])).resolves.toMatchObject({ allowed: true, code: 'IDENTITY_CLAIM_ALLOWED' });

    await expect(runtime.authorize([
      ['UpdateRecord', 'Team', 7, { gristUserId: 101, nom: 'Intrusion' }]
    ])).resolves.toMatchObject({ allowed: false, code: 'ASSOCIATION_CONFIRMATION_REQUIRED' });
  });
});
