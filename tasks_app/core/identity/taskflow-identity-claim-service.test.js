'use strict';

const { CLAIM_STATUS, createIdentityClaimService } = require('./taskflow-identity-claim-service.js');

function validClaim() {
  return {
    allowed: true,
    idempotent: false,
    code: 'ASSOCIATION_ALLOWED',
    teamMemberId: 7,
    gristUserId: 101,
    action: ['UpdateRecord', 'Team', 7, { gristUserId: 101 }]
  };
}

describe('TaskFlowIdentityClaimService', () => {
  test('applique la seule action validée puis vérifie la postcondition', async () => {
    const grist = { docApi: { applyUserActions: jest.fn(async () => undefined) } };
    const identityRuntime = {
      buildClaim: jest.fn(async () => validClaim()),
      invalidate: jest.fn(),
      refresh: jest.fn(async () => ({ actor: { identified: true, memberId: 7 } }))
    };
    const reloadSnapshot = jest.fn(async () => undefined);
    const service = createIdentityClaimService({ grist, identityRuntime, reloadSnapshot });

    const result = await service.claim(7);

    expect(result).toMatchObject({ success: true, code: CLAIM_STATUS.APPLIED, teamMemberId: 7 });
    expect(grist.docApi.applyUserActions).toHaveBeenCalledWith([
      ['UpdateRecord', 'Team', 7, { gristUserId: 101 }]
    ]);
    expect(identityRuntime.invalidate).toHaveBeenCalledTimes(1);
    expect(reloadSnapshot).toHaveBeenCalledTimes(1);
    expect(identityRuntime.refresh).toHaveBeenCalledWith({ force: true });
  });

  test('reste dans l’état non associé quand le domaine refuse la demande', async () => {
    const grist = { docApi: { applyUserActions: jest.fn() } };
    const identityRuntime = {
      buildClaim: jest.fn(async () => ({ allowed: false, code: 'TEAM_EMAIL_NOT_FOUND', reason: 'Profil absent' }))
    };
    const service = createIdentityClaimService({ grist, identityRuntime });

    const result = await service.claim(null);

    expect(result).toMatchObject({ success: false, code: CLAIM_STATUS.NOT_ALLOWED, validationCode: 'TEAM_EMAIL_NOT_FOUND' });
    expect(grist.docApi.applyUserActions).not.toHaveBeenCalled();
    expect(service.isPending()).toBe(false);
  });

  test('traite une association déjà appliquée comme un succès idempotent', async () => {
    const identityRuntime = {
      buildClaim: jest.fn(async () => ({ allowed: true, idempotent: true, teamMemberId: 7, identity: { memberId: 7 } }))
    };
    const grist = { docApi: { applyUserActions: jest.fn() } };

    const result = await createIdentityClaimService({ grist, identityRuntime }).claim(7);

    expect(result.code).toBe(CLAIM_STATUS.ALREADY_APPLIED);
    expect(result.success).toBe(true);
    expect(grist.docApi.applyUserActions).not.toHaveBeenCalled();
  });

  test('refuse un double clic pendant une demande en cours', async () => {
    let release;
    const buildClaim = jest.fn(() => new Promise(resolve => { release = () => resolve(validClaim()); }));
    const identityRuntime = {
      buildClaim,
      invalidate: jest.fn(),
      refresh: jest.fn(async () => ({ actor: { identified: true, memberId: 7 } }))
    };
    const grist = { docApi: { applyUserActions: jest.fn(async () => undefined) } };
    const service = createIdentityClaimService({ grist, identityRuntime });

    const first = service.claim(7);
    const second = await service.claim(7);
    expect(second).toEqual({ success: false, code: CLAIM_STATUS.PENDING });

    release();
    await first;
  });

  test('échoue si la postcondition ne retrouve pas le membre attendu', async () => {
    const identityRuntime = {
      buildClaim: jest.fn(async () => validClaim()),
      invalidate: jest.fn(),
      refresh: jest.fn(async () => ({ actor: { identified: false, memberId: null } }))
    };
    const grist = { docApi: { applyUserActions: jest.fn(async () => undefined) } };

    const result = await createIdentityClaimService({ grist, identityRuntime }).claim(7);
    expect(result.code).toBe(CLAIM_STATUS.POSTCONDITION_FAILED);
    expect(result.success).toBe(false);
  });
});
