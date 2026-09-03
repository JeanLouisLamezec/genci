'use strict';

const runtimeModule = require('./taskflow-identity-runtime.js');
const identity = require('./taskflow-identity.js');

function token(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

function makeGrist({ payload, team, fetchError } = {}) {
  const docApi = {
    getAccessToken: jest.fn(async () => ({ token: token(payload || {}) })),
    fetchTable: jest.fn(async table => {
      if (fetchError) throw fetchError;
      if (table !== 'Team') throw new Error(`Table inattendue: ${table}`);
      return team || { id: [], email: [], gristUserId: [], actif: [], estAdmin: [] };
    })
  };
  return { docApi };
}

describe('TaskFlowIdentityRuntime', () => {
  test('charge le compte Grist et résout le membre par le domaine commun', async () => {
    const grist = makeGrist({
      payload: { userId: 101, email: 'admin@example.com' },
      team: {
        id: [7], email: ['admin@example.com'], gristUserId: [101], actif: [true], estAdmin: [true]
      }
    });
    const runtime = runtimeModule.createGristIdentityRuntime(grist);

    const state = await runtime.refresh();

    expect(state.actor.status).toBe(identity.IDENTITY_STATUS.IDENTIFIED);
    expect(state.actor.memberId).toBe(7);
    expect(state.actor.isAdmin).toBe(true);
    expect(runtime.getActor()).toBe(state.actor);
  });

  test('propose une confirmation sur correspondance email unique', async () => {
    const runtime = runtimeModule.createGristIdentityRuntime(makeGrist({
      payload: { userId: 101, email: 'alice@example.com' },
      team: { id: [7], nom: ['Alice'], email: ['alice@example.com'], gristUserId: [0], actif: [true] }
    }));

    const state = await runtime.refresh();
    expect(state.actor.status).toBe(identity.IDENTITY_STATUS.ASSOCIATION_CONFIRMATION_REQUIRED);
    expect(state.actor.associationCandidate.id).toBe(7);
  });

  test('résout automatiquement le profil Team avec une sonde serveur transitoire', async () => {
    const team = {
      id: [7], nom: ['Alice'], email: ['alice@example.com'],
      gristUserId: [0], actif: [true], estAdmin: [false]
    };
    let probeRows = [];
    let nextProbeId = 1;
    const applyUserActions = jest.fn(async actions => {
      actions.forEach(action => {
        if (action[0] === 'AddRecord') {
          probeRows.push(Object.assign({
            id: nextProbeId++,
            teamCandidate: 7,
            matchStatus: 'matched'
          }, action[3]));
        } else if (action[0] === 'RemoveRecord') {
          probeRows = probeRows.filter(row => row.id !== action[2]);
        }
      });
      return [];
    });
    const grist = {
      docApi: {
        getAccessToken: jest.fn(async () => ({ token: token({ userId: 101, docId: 'doc-1' }) })),
        listTables: jest.fn(async () => ['Team', 'TaskFlowIdentityProbe']),
        applyUserActions,
        fetchTable: jest.fn(async table => {
          if (table === 'Team') return team;
          if (table === 'TaskFlowIdentityProbe') {
            const columns = { id: [], gristUserId: [], nonce: [], teamCandidate: [], matchStatus: [] };
            probeRows.forEach(row => Object.keys(columns).forEach(key => columns[key].push(row[key])));
            return columns;
          }
          throw new Error(`Table inattendue: ${table}`);
        })
      }
    };
    const runtime = runtimeModule.createGristIdentityRuntime(grist, { fetch: null });

    const state = await runtime.refresh();

    expect(state.currentUser).toMatchObject({
      userId: 101,
      email: 'alice@example.com',
      source: 'grist-identity-probe'
    });
    expect(state.actor.status).toBe(identity.IDENTITY_STATUS.ASSOCIATION_CONFIRMATION_REQUIRED);
    expect(state.actor.associationCandidate.id).toBe(7);
    expect(applyUserActions.mock.calls.flatMap(call => call[0]).map(action => action[0]))
      .toEqual(['AddRecord', 'RemoveRecord']);
    expect(probeRows).toEqual([]);
  });

  test('reste en échec fermé quand la table de sonde v8 manque', async () => {
    const grist = makeGrist({
      payload: { userId: 101 },
      team: { id: [7], email: ['alice@example.com'], gristUserId: [0], actif: [true] }
    });
    grist.docApi.listTables = jest.fn(async () => ['Team']);
    grist.docApi.applyUserActions = jest.fn();
    const runtime = runtimeModule.createGristIdentityRuntime(grist, { fetch: null });

    const state = await runtime.refresh();

    expect(state.actor.conflictCodes).toContain('CURRENT_EMAIL_MISSING');
    expect(state.actor.identityProbeCode).toBe('IDENTITY_PROBE_TABLE_MISSING');
    expect(grist.docApi.applyUserActions).not.toHaveBeenCalled();
  });

  test('met les erreurs de chargement en échec fermé', async () => {
    const error = new Error('Team indisponible');
    const onError = jest.fn();
    const runtime = runtimeModule.createGristIdentityRuntime(makeGrist({
      payload: { userId: 101, email: 'alice@example.com' },
      fetchError: error
    }), { onError });

    const state = await runtime.refresh();
    expect(state.actor.status).toBe(identity.IDENTITY_STATUS.IDENTITY_DATA_UNAVAILABLE);
    expect(state.actor.identified).toBe(false);
    expect(onError).toHaveBeenCalledWith(error);
  });

  test('cache le snapshot puis le recharge après invalidation', async () => {
    const grist = makeGrist({ payload: { userId: 101 }, team: { id: [], gristUserId: [] } });
    const runtime = runtimeModule.createGristIdentityRuntime(grist);

    await runtime.refresh();
    await runtime.refresh();
    expect(grist.docApi.fetchTable).toHaveBeenCalledTimes(1);

    runtime.invalidate();
    await runtime.refresh();
    expect(grist.docApi.fetchTable).toHaveBeenCalledTimes(2);
  });

  test('recharge Team avant de reconstruire une demande d’association', async () => {
    const grist = makeGrist({
      payload: { userId: 101, email: 'alice@example.com' },
      team: { id: [7], nom: ['Alice'], email: ['alice@example.com'], gristUserId: [0], actif: [true] }
    });
    const runtime = runtimeModule.createGristIdentityRuntime(grist);

    const claim = await runtime.buildClaim(7);
    expect(claim.allowed).toBe(true);
    expect(claim.action).toEqual(['UpdateRecord', 'Team', 7, { gristUserId: 101 }]);
    expect(grist.docApi.fetchTable).toHaveBeenCalledTimes(1);
  });
});
