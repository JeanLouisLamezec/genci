'use strict';

const identity = require('./taskflow-identity.js');

const { IDENTITY_STATUS } = identity;

describe('TaskFlowIdentity - normalisation', () => {
  test.each([
    [155719, 155719],
    ['155719', 155719],
    [null, null],
    ['', null],
    [0, null],
    [-1, null],
    [1.2, null],
    ['12x', null]
  ])('normalise un identifiant positif %#', (input, expected) => {
    expect(identity.normalizePositiveId(input)).toBe(expected);
  });

  test('normalise les emails sans les utiliser comme identité permanente', () => {
    expect(identity.normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
  });
});

describe('TaskFlowIdentity - résolution canonique', () => {
  test('identifie par gristUserId et expose le passe-droit admin', () => {
    const member = { id: 7, email: 'admin@example.com', gristUserId: 101, actif: true, estAdmin: true };
    const result = identity.resolveActorIdentity({ team: [member], currentGristUserId: 101, currentEmail: member.email });

    expect(result).toMatchObject({
      identified: true,
      status: IDENTITY_STATUS.IDENTIFIED,
      memberId: 7,
      currentUserMemberId: 7,
      isAdmin: true,
      associationCandidate: null
    });
  });

  test('refuse un membre associé mais inactif, y compris administrateur', () => {
    const result = identity.resolveActorIdentity({
      team: [{ id: 7, email: 'admin@example.com', gristUserId: 101, actif: false, estAdmin: true }],
      currentGristUserId: 101,
      currentEmail: 'admin@example.com'
    });

    expect(result.status).toBe(IDENTITY_STATUS.MEMBER_INACTIVE);
    expect(result.identified).toBe(false);
    expect(result.isAdmin).toBe(false);
  });

  test('échoue fermé en présence de gristUserId dupliqués dans Team', () => {
    const result = identity.resolveActorIdentity({
      team: [
        { id: 1, gristUserId: 101, actif: true },
        { id: 2, gristUserId: '101', actif: true }
      ],
      currentGristUserId: 999,
      currentEmail: 'new@example.com'
    });

    expect(result.status).toBe(IDENTITY_STATUS.GRIST_USER_ID_DUPLICATED);
    expect(result.duplicateUserIds).toEqual([101]);
  });

  test('propose seulement l’unique membre actif et libre portant le même email', () => {
    const result = identity.resolveActorIdentity({
      team: [
        { id: 7, nom: 'Alice', email: ' Alice@Example.com ', gristUserId: 0, actif: true },
        { id: 8, nom: 'Bob', email: 'bob@example.com', gristUserId: null, actif: true }
      ],
      currentGristUserId: 101,
      currentEmail: 'alice@example.com'
    });

    expect(result.status).toBe(IDENTITY_STATUS.ASSOCIATION_CONFIRMATION_REQUIRED);
    expect(result.associationCandidate).toEqual({ id: 7, nom: 'Alice', email: 'alice@example.com' });
    expect(result.memberId).toBeNull();
  });

  test('ne propose aucun profil lorsque l’email courant est absent', () => {
    const result = identity.resolveActorIdentity({
      team: [{ id: 7, email: 'alice@example.com', gristUserId: 0, actif: true }],
      currentGristUserId: 101,
      currentEmail: null
    });

    expect(result.status).toBe(IDENTITY_STATUS.ASSOCIATION_UNAVAILABLE);
    expect(result.conflictCodes).toContain('CURRENT_EMAIL_MISSING');
    expect(result.associationCandidate).toBeNull();
  });

  test('reste indisponible lorsqu’aucun profil Team ne porte le même email', () => {
    const result = identity.resolveActorIdentity({
      team: [{ id: 7, email: 'bob@example.com', gristUserId: 0, actif: true }],
      currentGristUserId: 101,
      currentEmail: 'alice@example.com'
    });

    expect(result.status).toBe(IDENTITY_STATUS.ASSOCIATION_UNAVAILABLE);
    expect(result.conflictCodes).toContain('TEAM_EMAIL_NOT_FOUND');
  });

  test('refuse une correspondance email ambiguë', () => {
    const result = identity.resolveActorIdentity({
      team: [
        { id: 7, email: 'alice@example.com', gristUserId: 0, actif: true },
        { id: 8, email: ' ALICE@example.com ', gristUserId: null, actif: true }
      ],
      currentGristUserId: 101,
      currentEmail: 'alice@example.com'
    });

    expect(result.status).toBe(IDENTITY_STATUS.EMAIL_DUPLICATED);
    expect(result.associationCandidate).toBeNull();
  });

  test('refuse un profil email déjà associé à un autre compte', () => {
    const result = identity.resolveActorIdentity({
      team: [{ id: 7, email: 'alice@example.com', gristUserId: 202, actif: true }],
      currentGristUserId: 101,
      currentEmail: 'alice@example.com'
    });

    expect(result.status).toBe(IDENTITY_STATUS.ASSOCIATION_UNAVAILABLE);
    expect(result.conflictCodes).toContain('TEAM_MEMBER_ALREADY_ASSOCIATED');
  });

  test('refuse un userId courant invalide', () => {
    const result = identity.resolveActorIdentity({ team: [], currentGristUserId: null, currentEmail: 'alice@example.com' });
    expect(result.status).toBe(IDENTITY_STATUS.INVALID_CURRENT_USER);
  });
});

describe('TaskFlowIdentity - demande d’association pure', () => {
  const team = [{ id: 7, nom: 'Alice', email: 'alice@example.com', gristUserId: 0, actif: true }];

  test('construit uniquement la mise à jour Team.gristUserId attendue', () => {
    const claim = identity.buildIdentityClaim({
      team,
      currentGristUserId: 101,
      currentEmail: 'alice@example.com',
      expectedTeamMemberId: 7
    });

    expect(claim.allowed).toBe(true);
    expect(claim.action).toEqual(['UpdateRecord', 'Team', 7, { gristUserId: 101 }]);
  });

  test('refuse un profil confirmé différent du candidat résolu', () => {
    const claim = identity.buildIdentityClaim({
      team,
      currentGristUserId: 101,
      currentEmail: 'alice@example.com',
      expectedTeamMemberId: 8
    });

    expect(claim.allowed).toBe(false);
    expect(claim.code).toBe('ASSOCIATION_CANDIDATE_CHANGED');
  });

  test('est idempotent lorsque l’association est déjà appliquée', () => {
    const claim = identity.buildIdentityClaim({
      team: [{ ...team[0], gristUserId: 101 }],
      currentGristUserId: 101,
      currentEmail: 'alice@example.com',
      expectedTeamMemberId: 7
    });

    expect(claim.allowed).toBe(true);
    expect(claim.idempotent).toBe(true);
    expect(claim.action).toBeNull();
  });

  test('une identité déjà associée ne peut pas revendiquer un autre profil', () => {
    const claim = identity.buildIdentityClaim({
      team: [{ ...team[0], gristUserId: 101 }],
      currentGristUserId: 101,
      currentEmail: 'alice@example.com',
      expectedTeamMemberId: 8
    });

    expect(claim.allowed).toBe(false);
    expect(claim.code).toBe('ACTOR_ALREADY_ASSOCIATED');
  });
});
