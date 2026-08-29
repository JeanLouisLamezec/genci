'use strict';

const permissions = require('../permissions/taskflow-permissions.js');
const craIdentity = require('../cra/identity/cra-identity-association.js');

describe('Identité legacy - caractérisation avant migration', () => {
  test('le résolveur v6 migré délègue maintenant au domaine commun', () => {
    const result = permissions.resolveActorIdentity({
      team: [{ id: 7, email: 'alice@example.com', gristUserId: 0, actif: true }],
      currentGristUserId: 101,
      currentEmail: 'alice@example.com'
    });

    expect(result.status).toBe('ASSOCIATION_CONFIRMATION_REQUIRED');
    expect(result.memberId).toBeNull();
    expect(result.associationCandidate.id).toBe(7);
  });

  test('le CRA legacy propose aussi les profils portant un autre email', () => {
    const result = craIdentity.resolveCurrentUserIdentity({
      team: [
        { id: 7, email: 'alice@example.com', gristUserId: 0, actif: true },
        { id: 8, email: 'bob@example.com', gristUserId: 0, actif: true }
      ],
      currentGristUserId: 101,
      currentEmail: 'alice@example.com'
    });

    expect(result.status).toBe(craIdentity.IDENTITY_STATUS.ASSOCIATION_REQUIRED);
    expect(result.candidates.map(candidate => candidate.id)).toEqual([7, 8]);
  });

  test('le CRA legacy identifie un membre déjà associé même s’il est inactif', () => {
    const result = craIdentity.resolveCurrentUserIdentity({
      team: [{ id: 7, email: 'alice@example.com', gristUserId: 101, actif: false }],
      currentGristUserId: 101,
      currentEmail: 'alice@example.com'
    });

    expect(result.status).toBe(craIdentity.IDENTITY_STATUS.IDENTIFIED);
    expect(result.currentUserMemberId).toBe(7);
  });
});
