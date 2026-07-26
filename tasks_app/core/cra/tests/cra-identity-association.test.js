/**
 * Tests pour le module CRA Identity Association
 * 
 * Couvre tous les scénarios requis :
 * 1. utilisateur déjà identifié
 * 2. association requise
 * 3. valeur 0 considérée comme non associée
 * 4. valeur null considérée comme non associée
 * 5. userId absent
 * 6. userId invalide
 * 7. gristUserId dupliqué
 * 8. email dupliqué
 * 9. email avec espaces
 * 10. email avec différence de casse
 * 11. ligne sans email exclue
 * 12. construction d'une action d'association valide
 * 13. tentative d'association sur une ligne déjà associée
 * 14. tentative avec un autre userId
 * 15. deuxième exécution idempotente
 */

'use strict';

const {
  IDENTITY_STATUS,
  normalizeGristUserId,
  normalizeEmail,
  isUnassociated,
  isValidGristUserId,
  findDuplicateGristUserIds,
  findDuplicateEmails,
  findMembersByGristUserId,
  resolveCurrentUserIdentity,
  listClaimableTeamMembers,
  buildIdentityClaim,
  isAssociationAlreadyApplied
} = require('../identity/cra-identity-association.js');

// ============================================================================
// HELPERS DE NORMALISATION
// ============================================================================

describe('normalizeGristUserId', () => {
  test('accepte un entier positif valide', () => {
    expect(normalizeGristUserId(155719)).toBe(155719);
    expect(normalizeGristUserId(1)).toBe(1);
    expect(normalizeGristUserId(999999)).toBe(999999);
  });

  test('rejette null', () => {
    expect(normalizeGristUserId(null)).toBeNull();
  });

  test('rejette undefined', () => {
    expect(normalizeGristUserId(undefined)).toBeNull();
  });

  test('rejette chaîne vide', () => {
    expect(normalizeGristUserId('')).toBeNull();
  });

  test('rejette 0', () => {
    expect(normalizeGristUserId(0)).toBeNull();
  });

  test('rejette "0"', () => {
    expect(normalizeGristUserId('0')).toBeNull();
  });

  test('rejette les nombres négatifs', () => {
    expect(normalizeGristUserId(-1)).toBeNull();
    expect(normalizeGristUserId(-100)).toBeNull();
  });

  test('rejette les nombres flottants', () => {
    expect(normalizeGristUserId(1.5)).toBeNull();
    expect(normalizeGristUserId(3.14)).toBeNull();
  });

  test('rejette les chaînes non numériques', () => {
    expect(normalizeGristUserId('abc')).toBeNull();
    expect(normalizeGristUserId('123abc')).toBeNull();
  });

  test('accepte une chaîne numérique valide', () => {
    expect(normalizeGristUserId('155719')).toBe(155719);
  });
});

describe('normalizeEmail', () => {
  test('normalise en lowercase', () => {
    expect(normalizeEmail('Jean-Louis@LASUITE.COOP')).toBe('jean-louis@lasuite.coop');
  });

  test('trim les espaces', () => {
    expect(normalizeEmail('  jean-louis@lasuite.coop  ')).toBe('jean-louis@lasuite.coop');
  });

  test('gère null', () => {
    expect(normalizeEmail(null)).toBe('');
  });

  test('gère undefined', () => {
    expect(normalizeEmail(undefined)).toBe('');
  });
});

describe('isUnassociated', () => {
  test('retourne true pour null', () => {
    expect(isUnassociated(null)).toBe(true);
  });

  test('retourne true pour undefined', () => {
    expect(isUnassociated(undefined)).toBe(true);
  });

  test('retourne true pour chaîne vide', () => {
    expect(isUnassociated('')).toBe(true);
  });

  test('retourne true pour 0', () => {
    expect(isUnassociated(0)).toBe(true);
  });

  test('retourne true pour "0"', () => {
    expect(isUnassociated('0')).toBe(true);
  });

  test('retourne false pour un entier positif', () => {
    expect(isUnassociated(155719)).toBe(false);
    expect(isUnassociated(1)).toBe(false);
  });
});

describe('isValidGristUserId', () => {
  test('retourne true pour un entier positif', () => {
    expect(isValidGristUserId(155719)).toBe(true);
    expect(isValidGristUserId(1)).toBe(true);
  });

  test('retourne false pour 0', () => {
    expect(isValidGristUserId(0)).toBe(false);
  });

  test('retourne false pour null', () => {
    expect(isValidGristUserId(null)).toBe(false);
  });

  test('retourne false pour undefined', () => {
    expect(isValidGristUserId(undefined)).toBe(false);
  });
});

// ============================================================================
// DÉTECTION DES CONFLITS
// ============================================================================

describe('findDuplicateGristUserIds', () => {
  test('détecte les doublons de gristUserId', () => {
    const team = [
      { id: 1, gristUserId: 100 },
      { id: 2, gristUserId: 100 },
      { id: 3, gristUserId: 200 }
    ];
    
    const duplicates = findDuplicateGristUserIds(team);
    expect(duplicates).toEqual([100]);
  });

  test('retourne tableau vide sans doublons', () => {
    const team = [
      { id: 1, gristUserId: 100 },
      { id: 2, gristUserId: 200 }
    ];
    
    const duplicates = findDuplicateGristUserIds(team);
    expect(duplicates).toEqual([]);
  });

  test('ignore les valeurs non associées', () => {
    const team = [
      { id: 1, gristUserId: 0 },
      { id: 2, gristUserId: null },
      { id: 3, gristUserId: '' }
    ];
    
    const duplicates = findDuplicateGristUserIds(team);
    expect(duplicates).toEqual([]);
  });
});

describe('findDuplicateEmails', () => {
  test('détecte les doublons d\'email', () => {
    const team = [
      { id: 1, email: 'alice@example.com' },
      { id: 2, email: 'ALICE@EXAMPLE.COM' },
      { id: 3, email: 'bob@example.com' }
    ];
    
    const duplicates = findDuplicateEmails(team);
    expect(duplicates.has('alice@example.com')).toBe(true);
    expect(duplicates.get('alice@example.com')).toHaveLength(2);
  });

  test('retourne Map vide sans doublons', () => {
    const team = [
      { id: 1, email: 'alice@example.com' },
      { id: 2, email: 'bob@example.com' }
    ];
    
    const duplicates = findDuplicateEmails(team);
    expect(duplicates.size).toBe(0);
  });

  test('ignore les emails vides', () => {
    const team = [
      { id: 1, email: '' },
      { id: 2, email: null },
      { id: 3, email: undefined }
    ];
    
    const duplicates = findDuplicateEmails(team);
    expect(duplicates.size).toBe(0);
  });
});

describe('findMembersByGristUserId', () => {
  test('trouve les membres avec un userId donné', () => {
    const team = [
      { id: 1, gristUserId: 100 },
      { id: 2, gristUserId: 200 },
      { id: 3, gristUserId: 100 }
    ];
    
    const members = findMembersByGristUserId(team, 100);
    expect(members).toHaveLength(2);
    expect(members.map(m => m.id)).toEqual([1, 3]);
  });

  test('retourne tableau vide si userId invalide', () => {
    const team = [
      { id: 1, gristUserId: 100 }
    ];
    
    const members = findMembersByGristUserId(team, 0);
    expect(members).toEqual([]);
  });
});

// ============================================================================
// RÉSOLUTION D'IDENTITÉ
// ============================================================================

describe('resolveCurrentUserIdentity', () => {
  // 1. Utilisateur déjà identifié
  test('1. retourne IDENTIFIED quand gristUserId correspond', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 155719 }
    ];
    
    const result = resolveCurrentUserIdentity({
      team,
      currentGristUserId: 155719
    });
    
    expect(result.status).toBe(IDENTITY_STATUS.IDENTIFIED);
    expect(result.currentUserMemberId).toBe(7);
    expect(result.member).toEqual(team[0]);
  });

  // 2. Association requise
  test('2. retourne ASSOCIATION_REQUIRED quand aucune correspondance', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 },
      { id: 8, nom: 'Marieke', email: 'marieke@example.com', gristUserId: null }
    ];
    
    const result = resolveCurrentUserIdentity({
      team,
      currentGristUserId: 155719
    });
    
    expect(result.status).toBe(IDENTITY_STATUS.ASSOCIATION_REQUIRED);
    expect(result.currentUserMemberId).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });

  // 3. Valeur 0 considérée comme non associée
  test('3. considère 0 comme non associé', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const result = resolveCurrentUserIdentity({
      team,
      currentGristUserId: 155719
    });
    
    expect(result.status).toBe(IDENTITY_STATUS.ASSOCIATION_REQUIRED);
  });

  // 4. Valeur null considérée comme non associée
  test('4. considère null comme non associé', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: null }
    ];
    
    const result = resolveCurrentUserIdentity({
      team,
      currentGristUserId: 155719
    });
    
    expect(result.status).toBe(IDENTITY_STATUS.ASSOCIATION_REQUIRED);
  });

  // 5. userId absent
  test('5. retourne INVALID_CURRENT_USER_ID si userId absent', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const result = resolveCurrentUserIdentity({
      team,
      currentGristUserId: null
    });
    
    expect(result.status).toBe(IDENTITY_STATUS.INVALID_CURRENT_USER_ID);
    expect(result.conflictCodes).toContain('INVALID_USER_ID');
  });

  // 6. userId invalide
  test('6. retourne INVALID_CURRENT_USER_ID si userId invalide', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const result = resolveCurrentUserIdentity({
      team,
      currentGristUserId: -1
    });
    
    expect(result.status).toBe(IDENTITY_STATUS.INVALID_CURRENT_USER_ID);
  });

  // 7. gristUserId dupliqué
  test('7. retourne GRIST_USER_ID_DUPLICATED si doublon', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 155719 },
      { id: 8, nom: 'Autre', email: 'autre@example.com', gristUserId: 155719 }
    ];
    
    const result = resolveCurrentUserIdentity({
      team,
      currentGristUserId: 999
    });
    
    expect(result.status).toBe(IDENTITY_STATUS.GRIST_USER_ID_DUPLICATED);
    expect(result.conflictCodes).toContain('GRIST_USER_ID_DUPLICATED');
  });

  // 8. email dupliqué (mode libre : ne bloque plus)
  test('8. emails dupliqués ne bloquent pas en mode libre', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 },
      { id: 8, nom: 'Autre', email: 'JL@EXAMPLE.COM', gristUserId: 0 }
    ];
    
    const result = resolveCurrentUserIdentity({
      team,
      currentGristUserId: 155719
    });
    
    // Ne bloque plus, retourne ASSOCIATION_REQUIRED avec candidats
    expect(result.status).toBe(IDENTITY_STATUS.ASSOCIATION_REQUIRED);
    expect(result.candidates).toHaveLength(2);
    // Mais signale les doublons pour diagnostic
    expect(result.duplicateEmails).toContain('jl@example.com');
  });

  // 9. Email avec espaces
  test('9. normalise les emails avec espaces', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: '  jl@example.com  ', gristUserId: 0 }
    ];
    
    const result = resolveCurrentUserIdentity({
      team,
      currentGristUserId: 155719,
      currentEmail: 'jl@example.com'
    });
    
    expect(result.status).toBe(IDENTITY_STATUS.ASSOCIATION_REQUIRED);
    expect(result.candidates).toHaveLength(1);
  });

  // 10. Email avec différence de casse
  test('10. ignore la casse pour les emails', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'JEAN-LOUIS@EXAMPLE.COM', gristUserId: 0 }
    ];
    
    const result = resolveCurrentUserIdentity({
      team,
      currentGristUserId: 155719,
      currentEmail: 'jean-louis@example.com'
    });
    
    // Ne crée pas de conflit, juste une différence de casse
    expect(result.status).toBe(IDENTITY_STATUS.ASSOCIATION_REQUIRED);
  });

  // 11. Ligne sans email exclue
  test('11. exclut les lignes sans email des candidats', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: '', gristUserId: 0 },
      { id: 8, nom: 'Marieke', email: 'marieke@example.com', gristUserId: 0 }
    ];
    
    const result = resolveCurrentUserIdentity({
      team,
      currentGristUserId: 155719
    });
    
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].id).toBe(8);
  });

  // 12. Construction d'une action d'association valide
  test('12. buildIdentityClaim retourne allowed=true pour association valide', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const result = buildIdentityClaim({
      team,
      selectedTeamMemberId: 7,
      currentGristUserId: 155719
    });
    
    expect(result.allowed).toBe(true);
    expect(result.teamMemberId).toBe(7);
    expect(result.gristUserId).toBe(155719);
  });

  // 13. Tentative d'association sur une ligne déjà associée
  test('13. buildIdentityClaim échoue si ligne déjà associée', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 999 }
    ];
    
    const result = buildIdentityClaim({
      team,
      selectedTeamMemberId: 7,
      currentGristUserId: 155719
    });
    
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('TEAM_MEMBER_ALREADY_ASSOCIATED');
  });

  // 14. Tentative avec un autre userId
  test('14. buildIdentityClaim échoue si userId déjà claimé', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 },
      { id: 8, nom: 'Autre', email: 'autre@example.com', gristUserId: 155719 }
    ];
    
    const result = buildIdentityClaim({
      team,
      selectedTeamMemberId: 7,
      currentGristUserId: 155719
    });
    
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('GRIST_USER_ID_ALREADY_CLAIMED');
  });

  // 15. Deuxième exécution idempotente
  test('15. isAssociationAlreadyApplied retourne true si déjà associé', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 155719 }
    ];
    
    const result = isAssociationAlreadyApplied({
      team,
      teamMemberId: 7,
      currentGristUserId: 155719
    });
    
    expect(result).toBe(true);
  });

  test('15b. isAssociationAlreadyApplied retourne false si pas encore associé', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const result = isAssociationAlreadyApplied({
      team,
      teamMemberId: 7,
      currentGristUserId: 155719
    });
    
    expect(result).toBe(false);
  });
});

// ============================================================================
// LISTE DES CANDIDATS
// ============================================================================

describe('listClaimableTeamMembers', () => {
  test('retourne uniquement les candidats claimables', () => {
    const team = [
      { id: 1, nom: 'Alice', email: 'alice@example.com', gristUserId: 0, actif: true },
      { id: 2, nom: 'Bob', email: 'bob@example.com', gristUserId: 100, actif: true },
      { id: 3, nom: 'Charlie', email: 'charlie@example.com', gristUserId: null, actif: false },
      { id: 4, nom: 'David', email: '', gristUserId: 0, actif: true },
      { id: 5, nom: 'Eve', email: 'eve@example.com', gristUserId: 0, actif: true }
    ];
    
    const candidates = listClaimableTeamMembers({
      team,
      currentGristUserId: 999
    });
    
    // Alice et Eve sont claimables (email, gristUserId=0, actif=true)
    // Bob: déjà associé
    // Charlie: inactif
    // David: pas d'email
    expect(candidates).toHaveLength(2);
    expect(candidates.map(c => c.id)).toEqual([1, 5]);
  });

  test('inclut les emails en conflit (mode libre)', () => {
    const team = [
      { id: 1, nom: 'Alice1', email: 'alice@example.com', gristUserId: 0 },
      { id: 2, nom: 'Alice2', email: 'ALICE@EXAMPLE.COM', gristUserId: 0 },
      { id: 3, nom: 'Bob', email: 'bob@example.com', gristUserId: 0 }
    ];
    
    const candidates = listClaimableTeamMembers({
      team,
      currentGristUserId: 999
    });
    
    // Mode libre : Alice1, Alice2 et Bob tous inclus
    expect(candidates).toHaveLength(3);
  });
});

// ============================================================================
// CAS SPÉCIAUX
// ============================================================================

describe('Mode libre - nouveaux tests', () => {
  // 1. email dupliqué sans association existante : candidats disponibles
  test('1. email dupliqué sans association : candidats disponibles', () => {
    const team = [
      { id: 1, nom: 'Alice1', email: 'alice@example.com', gristUserId: 0 },
      { id: 2, nom: 'Alice2', email: 'alice@example.com', gristUserId: 0 }
    ];
    
    const result = resolveCurrentUserIdentity({
      team,
      currentGristUserId: 999
    });
    
    expect(result.status).toBe(IDENTITY_STATUS.ASSOCIATION_REQUIRED);
    expect(result.candidates).toHaveLength(2);
  });

  // 2. email dupliqué avec utilisateur déjà identifié : IDENTIFIED
  test('2. email dupliqué avec utilisateur identifié : IDENTIFIED', () => {
    const team = [
      { id: 1, nom: 'Alice1', email: 'alice@example.com', gristUserId: 999 },
      { id: 2, nom: 'Alice2', email: 'alice@example.com', gristUserId: 0 }
    ];
    
    const result = resolveCurrentUserIdentity({
      team,
      currentGristUserId: 999
    });
    
    expect(result.status).toBe(IDENTITY_STATUS.IDENTIFIED);
    expect(result.currentUserMemberId).toBe(1);
  });

  // 3. ligne non associée proposée
  test('3. ligne non associée proposée', () => {
    const team = [
      { id: 1, nom: 'Alice', email: 'alice@example.com', gristUserId: 0 }
    ];
    
    const candidates = listClaimableTeamMembers({
      team,
      currentGristUserId: 999
    });
    
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe(1);
  });

  // 4. ligne déjà associée exclue
  test('4. ligne déjà associée exclue', () => {
    const team = [
      { id: 1, nom: 'Alice', email: 'alice@example.com', gristUserId: 999 },
      { id: 2, nom: 'Bob', email: 'bob@example.com', gristUserId: 0 }
    ];
    
    const candidates = listClaimableTeamMembers({
      team,
      currentGristUserId: 888
    });
    
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe(2);
  });

  // 5. gristUserId dupliqué toujours bloquant
  test('5. gristUserId dupliqué toujours bloquant', () => {
    const team = [
      { id: 1, nom: 'Alice', email: 'alice@example.com', gristUserId: 999 },
      { id: 2, nom: 'Bob', email: 'bob@example.com', gristUserId: 999 }
    ];
    
    const result = resolveCurrentUserIdentity({
      team,
      currentGristUserId: 888
    });
    
    expect(result.status).toBe(IDENTITY_STATUS.GRIST_USER_ID_DUPLICATED);
    expect(result.conflictCodes).toContain('GRIST_USER_ID_DUPLICATED');
  });

  // 6. deuxième association du même compte refusée
  test('6. deuxième association du même compte refusée', () => {
    const team = [
      { id: 1, nom: 'Alice', email: 'alice@example.com', gristUserId: 999 },
      { id: 2, nom: 'Bob', email: 'bob@example.com', gristUserId: 0 }
    ];
    
    const result = buildIdentityClaim({
      team,
      selectedTeamMemberId: 2,
      currentGristUserId: 999
    });
    
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('GRIST_USER_ID_ALREADY_CLAIMED');
  });
});

describe('Cas spéciaux', () => {
  test('équipe vide retourne NO_CLAIMABLE_TEAM_ROW', () => {
    const result = resolveCurrentUserIdentity({
      team: [],
      currentGristUserId: 155719
    });
    
    expect(result.status).toBe(IDENTITY_STATUS.NO_CLAIMABLE_TEAM_ROW);
    expect(result.candidates).toEqual([]);
  });

  test('membre avec email null est exclu', () => {
    const team = [
      { id: 1, nom: 'Test', email: null, gristUserId: 0 }
    ];
    
    const candidates = listClaimableTeamMembers({
      team,
      currentGristUserId: 999
    });
    
    expect(candidates).toEqual([]);
  });

  test('membre avec email undefined est exclu', () => {
    const team = [
      { id: 1, nom: 'Test', email: undefined, gristUserId: 0 }
    ];
    
    const candidates = listClaimableTeamMembers({
      team,
      currentGristUserId: 999
    });
    
    expect(candidates).toEqual([]);
  });

  test('buildIdentityClaim avec memberId invalide échoue', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const result = buildIdentityClaim({
      team,
      selectedTeamMemberId: 0,
      currentGristUserId: 155719
    });
    
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('INVALID_TEAM_MEMBER_ID');
  });

  test('buildIdentityClaim avec memberId inexistant échoue', () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const result = buildIdentityClaim({
      team,
      selectedTeamMemberId: 999,
      currentGristUserId: 155719
    });
    
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('TEAM_MEMBER_NOT_FOUND');
  });
});
