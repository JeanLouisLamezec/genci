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
    Tasks: { id: [1], titre: ['Interdite'], projet: [0], assignees: [null] },
    TaskFlowIdentityProbe: {
      id: [44, 45],
      gristUserId: [101, 202],
      nonce: ['own-probe', 'foreign-probe']
    },
    MemberDailyCapacities: { id: [], membre: [], date: [] }
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

  test('une révocation admin ne peut pas être masquée par un chargement déjà en cours', async () => {
    let releaseFirstTeamLoad;
    let teamReadCount = 0;
    const adminTeam = {
      id: [7], nom: ['Alice'], email: ['alice@example.com'],
      gristUserId: [101], actif: [true], estAdmin: [true]
    };
    const revokedTeam = {
      id: [7], nom: ['Alice'], email: ['alice@example.com'],
      gristUserId: [101], actif: [true], estAdmin: [false]
    };
    const tables = {
      Tasks: { id: [1], titre: ['Hors périmètre'], projet: [0], assignees: [null] }
    };
    const grist = {
      docApi: {
        getAccessToken: jest.fn(async () => ({ token: token({ userId: 101, email: 'alice@example.com' }) })),
        listTables: jest.fn(async () => ['Team', 'Tasks']),
        fetchTable: jest.fn(async table => {
          if (table !== 'Team') return tables[table] || { id: [] };
          teamReadCount += 1;
          if (teamReadCount === 1) {
            return new Promise(resolve => { releaseFirstTeamLoad = () => resolve(adminTeam); });
          }
          return revokedTeam;
        })
      }
    };
    const runtime = permissions.createGristPermissionRuntime(grist);

    const initialLoad = runtime.refresh();
    while (!releaseFirstTeamLoad) await Promise.resolve();
    const decisionPromise = runtime.authorize([
      ['UpdateRecord', 'Tasks', 1, { titre: 'Modification interdite' }]
    ]);

    releaseFirstTeamLoad();
    await initialLoad;
    const decision = await decisionPromise;

    expect(runtime.getActor().isAdmin).toBe(false);
    expect(decision.allowed).toBe(false);
    expect(teamReadCount).toBeGreaterThanOrEqual(2);
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

  test('autorise uniquement une sonde d’identité liée au compte courant', async () => {
    const grist = gristFixture();
    const runtime = permissions.createGristPermissionRuntime(grist);

    await expect(runtime.authorize([[
      'AddRecord', 'TaskFlowIdentityProbe', null, { gristUserId: 101, nonce: 'nonce-1' }
    ]])).resolves.toMatchObject({ allowed: true, code: 'IDENTITY_PROBE_CREATE_ALLOWED' });

    await expect(runtime.authorize([[
      'AddRecord', 'TaskFlowIdentityProbe', null, { gristUserId: 202, nonce: 'nonce-2' }
    ]])).resolves.toMatchObject({ allowed: false, code: 'IDENTITY_PROBE_CREATE_FORBIDDEN' });

    await expect(runtime.authorize([
      ['RemoveRecord', 'TaskFlowIdentityProbe', 44]
    ])).resolves.toMatchObject({ allowed: true, code: 'IDENTITY_PROBE_DELETE_ALLOWED' });

    await expect(runtime.authorize([
      ['RemoveRecord', 'TaskFlowIdentityProbe', 45]
    ])).resolves.toMatchObject({ allowed: false, code: 'IDENTITY_PROBE_DELETE_FORBIDDEN' });
  });

  test('ne charge les capacités quotidiennes que pour une mutation qui les vise', async () => {
    const grist = gristFixture();
    const runtime = permissions.createGristPermissionRuntime(grist);

    await runtime.authorize([
      ['UpdateRecord', 'Tasks', 1, { titre: 'Toujours interdite' }]
    ]);
    expect(grist.docApi.fetchTable.mock.calls.some(([table]) => table === 'MemberDailyCapacities')).toBe(false);

    await runtime.authorize([[
      'AddRecord', 'MemberDailyCapacities', null, { membre: 7, date: 1 }
    ]]);
    expect(grist.docApi.fetchTable.mock.calls.some(([table]) => table === 'MemberDailyCapacities')).toBe(true);
  });
});
