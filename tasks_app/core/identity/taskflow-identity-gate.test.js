'use strict';

const { createIdentityGate } = require('./taskflow-identity-gate.js');

function flush() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('TaskFlowIdentityGate', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('ne bloque pas un acteur déjà identifié', async () => {
    const identityRuntime = {
      refresh: jest.fn(async () => ({ actor: { identified: true, status: 'IDENTIFIED', memberId: 7 } }))
    };
    const gate = createIdentityGate({ identityRuntime, document });

    await gate.start();
    expect(gate.getElement()).toBeNull();
  });

  test('propose uniquement le candidat correspondant résolu par le domaine', async () => {
    const actor = {
      identified: false,
      status: 'ASSOCIATION_CONFIRMATION_REQUIRED',
      associationCandidate: { id: 7, nom: 'Alice', email: 'alice@example.com' }
    };
    const identityRuntime = { refresh: jest.fn(async () => ({ actor })), getActor: () => actor };
    const claimService = { claim: jest.fn(async () => ({ success: true, actor: { identified: true, memberId: 7 } })) };
    const permissionRuntime = { invalidate: jest.fn(), refresh: jest.fn(async () => undefined) };
    const gate = createIdentityGate({ identityRuntime, claimService, permissionRuntime, document });

    await gate.start();
    expect(document.body.textContent).toContain('Alice');
    expect(document.body.textContent).toContain('alice@example.com');

    document.querySelector('[data-tf-identity-action="associate"]').click();
    await flush();
    await flush();

    expect(claimService.claim).toHaveBeenCalledWith(7);
    expect(permissionRuntime.invalidate).toHaveBeenCalled();
    expect(gate.getElement()).toBeNull();
  });

  test('reste à l’état initial et recharge Team lors d’une nouvelle tentative', async () => {
    const unavailable = {
      identified: false,
      status: 'ASSOCIATION_UNAVAILABLE',
      conflictCodes: ['TEAM_EMAIL_NOT_FOUND']
    };
    const candidate = {
      identified: false,
      status: 'ASSOCIATION_CONFIRMATION_REQUIRED',
      associationCandidate: { id: 7, nom: 'Alice', email: 'alice@example.com' }
    };
    const identityRuntime = {
      refresh: jest.fn()
        .mockResolvedValueOnce({ actor: unavailable })
        .mockResolvedValueOnce({ actor: candidate })
    };
    const gate = createIdentityGate({ identityRuntime, claimService: { claim: jest.fn() }, document });

    await gate.start();
    expect(document.body.textContent).toContain('Association impossible');
    expect(document.body.textContent).toContain('Réessayer');

    document.querySelector('[data-tf-identity-action="retry"]').click();
    await flush();
    await flush();

    expect(identityRuntime.refresh).toHaveBeenLastCalledWith({ force: true });
    expect(document.body.textContent).toContain('Alice');
  });

  test('explique la migration manquante sans demander l’email au compte', async () => {
    const unavailable = {
      identified: false,
      status: 'ASSOCIATION_UNAVAILABLE',
      conflictCodes: ['CURRENT_EMAIL_MISSING'],
      identityProbeCode: 'IDENTITY_PROBE_TABLE_MISSING'
    };
    const identityRuntime = {
      refresh: jest.fn(async () => ({ actor: unavailable })),
      getActor: () => unavailable
    };
    const gate = createIdentityGate({ identityRuntime, claimService: { claim: jest.fn() }, document });

    await gate.start();
    expect(document.body.textContent).toContain('migration TaskFlow v8');
    expect(document.body.textContent).not.toContain('Adresse e-mail Team');
    expect(document.querySelector('#taskflow-identity-email')).toBeNull();
    expect(document.querySelector('[data-tf-identity-action="retry"]')).not.toBeNull();
  });
});
