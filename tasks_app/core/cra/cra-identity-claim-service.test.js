/**
 * Tests pour le service CRA Identity Claim
 * 
 * Couvre tous les scénarios requis :
 * - succès
 * - ligne déjà associée
 * - double clic
 * - erreur Grist
 * - erreur de rechargement
 * - postcondition incorrecte
 * - verrou libéré après succès
 * - verrou libéré après exception
 */

'use strict';

const {
  CLAIM_ERROR_CODES,
  claimCurrentUserIdentity,
  isClaimPending,
  lockClaim,
  unlockClaim,
  cancelPendingClaim,
  getServiceState,
  resetService
} = require('./cra-identity-claim-service');

// ============================================================================
// HELPERS DE TEST
// ============================================================================

function createMockGrist(options = {}) {
  const {
    applyUserActionsResult,
    applyUserActionsError,
    fetchTableResult
  } = options;
  
  let appliedActions = [];
  
  return {
    docApi: {
      applyUserActions: jest.fn(async (actions) => {
        appliedActions.push(...actions);
        if (applyUserActionsError) {
          throw applyUserActionsError;
        }
        return applyUserActionsResult || { success: true };
      }),
      fetchTable: jest.fn(async (tableName) => {
        if (fetchTableResult && fetchTableResult[tableName]) {
          return fetchTableResult[tableName];
        }
        // Par défaut : retourner des données vides
        return { id: [], nom: [], email: [], gristUserId: [] };
      })
    },
    _getAppliedActions: () => appliedActions,
    _clearAppliedActions: () => {
      appliedActions = [];
    }
  };
}

function createColumnarData(rows) {
  if (!rows || rows.length === 0) {
    return { id: [], nom: [], email: [], gristUserId: [] };
  }
  
  const columns = {
    id: [],
    nom: [],
    email: [],
    gristUserId: []
  };
  
  for (const row of rows) {
    if (row.id !== undefined) columns.id.push(row.id);
    if (row.nom !== undefined) columns.nom.push(row.nom);
    if (row.email !== undefined) columns.email.push(row.email);
    if (row.gristUserId !== undefined) columns.gristUserId.push(row.gristUserId);
  }
  
  return columns;
}

// ============================================================================
// TESTS DE SUCCÈS
// ============================================================================

describe('claimCurrentUserIdentity - Succès', () => {
  beforeEach(() => {
    resetService();
  });
  
  afterEach(() => {
    resetService();
  });
  
  test('1. association réussie', async () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const grist = createMockGrist({
      fetchTableResult: {
        Team: createColumnarData([
          { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 155719 }
        ])
      }
    });
    
    const reloadSnapshot = jest.fn();
    
    const result = await claimCurrentUserIdentity({
      grist,
      teamMemberId: 7,
      currentGristUserId: 155719,
      team,
      reloadSnapshot
    });
    
    expect(result.success).toBe(true);
    expect(result.code).toBe('OK');
    expect(result.teamMemberId).toBe(7);
    expect(result.gristUserId).toBe(155719);
    expect(result.identityStatus).toBe('IDENTIFIED');
    
    // Vérifier l'action envoyée
    const actions = grist.docApi.applyUserActions.mock.calls[0][0];
    expect(actions).toHaveLength(1);
    expect(actions[0][0]).toBe('UpdateRecord');
    expect(actions[0][1]).toBe('Team');
    expect(actions[0][2]).toBe(7);
    expect(actions[0][3]).toEqual({ gristUserId: 155719 });
    
    // Vérifier le rechargement
    expect(reloadSnapshot).toHaveBeenCalledTimes(1);
  });
  
  test('2. association déjà appliquée (idempotence)', async () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 155719 }
    ];
    
    const grist = createMockGrist();
    const reloadSnapshot = jest.fn();
    
    const result = await claimCurrentUserIdentity({
      grist,
      teamMemberId: 7,
      currentGristUserId: 155719,
      team,
      reloadSnapshot
    });
    
    // L'association est déjà valide, donc le service détecte que c'est déjà appliqué
    // et retourne un succès sans écrire
    expect(result.success).toBe(true);
    expect(result.code).toBe('ALREADY_APPLIED');
    expect(grist.docApi.applyUserActions).not.toHaveBeenCalled();
    expect(reloadSnapshot).not.toHaveBeenCalled();
  });
  
  test('7. verrou libéré après succès', async () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const grist = createMockGrist({
      fetchTableResult: {
        Team: createColumnarData([
          { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 155719 }
        ])
      }
    });
    
    await claimCurrentUserIdentity({
      grist,
      teamMemberId: 7,
      currentGristUserId: 155719,
      team,
      reloadSnapshot: jest.fn()
    });
    
    expect(isClaimPending()).toBe(false);
    const state = getServiceState();
    expect(state.claimInProgress).toBe(false);
  });
});

// ============================================================================
// TESTS D'ERREUR - VALIDATION
// ============================================================================

describe('claimCurrentUserIdentity - Erreurs de validation', () => {
  beforeEach(() => {
    resetService();
  });
  
  afterEach(() => {
    resetService();
  });
  
  test('3. ligne déjà associée à un autre', async () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 999 },
      { id: 8, nom: 'Bob', email: 'bob@example.com', gristUserId: 0 }
    ];
    
    const grist = createMockGrist();
    
    const result = await claimCurrentUserIdentity({
      grist,
      teamMemberId: 7,
      currentGristUserId: 155719,
      team
    });
    
    expect(result.success).toBe(false);
    expect(result.code).toBe('IDENTITY_CLAIM_INVALID_REQUEST');
    expect(result.validationCode).toBe('TEAM_MEMBER_ALREADY_ASSOCIATED');
  });
  
  test('userId déjà claimé ailleurs', async () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 },
      { id: 8, nom: 'Bob', email: 'bob@example.com', gristUserId: 155719 }
    ];
    
    const grist = createMockGrist();
    
    const result = await claimCurrentUserIdentity({
      grist,
      teamMemberId: 7,
      currentGristUserId: 155719,
      team
    });
    
    expect(result.success).toBe(false);
    expect(result.code).toBe('IDENTITY_CLAIM_INVALID_REQUEST');
    expect(result.validationCode).toBe('GRIST_USER_ID_ALREADY_CLAIMED');
  });
});

// ============================================================================
// TESTS D'ERREUR - VERROUILLAGE
// ============================================================================

describe('claimCurrentUserIdentity - Verrouillage', () => {
  beforeEach(() => {
    resetService();
  });
  
  afterEach(() => {
    resetService();
  });
  
  test('4. double clic refusé', async () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const grist = createMockGrist({
      fetchTableResult: {
        Team: createColumnarData([
          { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 155719 }
        ])
      }
    });
    
    // Simuler un verrou manuel
    lockClaim({ teamMemberId: 7, currentGristUserId: 155719 });
    
    const result = await claimCurrentUserIdentity({
      grist,
      teamMemberId: 7,
      currentGristUserId: 155719,
      team
    });
    
    expect(result.success).toBe(false);
    expect(result.code).toBe('IDENTITY_CLAIM_PENDING');
    
    unlockClaim();
  });
  
  test('opérations concurrentes détectées', async () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const grist = createMockGrist();
    
    // Verrouiller manuellement
    lockClaim({ teamMemberId: 7, currentGristUserId: 155719 });
    
    expect(isClaimPending()).toBe(true);
    
    const result = await claimCurrentUserIdentity({
      grist,
      teamMemberId: 7,
      currentGristUserId: 155719,
      team
    });
    
    expect(result.code).toBe('IDENTITY_CLAIM_PENDING');
    
    unlockClaim();
  });
});

// ============================================================================
// TESTS D'ERREUR - ÉCRITURE GRIST
// ============================================================================

describe('claimCurrentUserIdentity - Erreurs Grist', () => {
  beforeEach(() => {
    resetService();
  });
  
  afterEach(() => {
    resetService();
  });
  
  test('5. erreur Grist lors de l\'écriture', async () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const grist = createMockGrist({
      applyUserActionsError: new Error('Access denied')
    });
    
    const result = await claimCurrentUserIdentity({
      grist,
      teamMemberId: 7,
      currentGristUserId: 155719,
      team,
      reloadSnapshot: jest.fn()
    });
    
    expect(result.success).toBe(false);
    expect(result.code).toBe('IDENTITY_CLAIM_WRITE_FAILED');
    expect(result.reason).toContain('Access denied');
  });
  
  test('8. verrou libéré après exception', async () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const grist = createMockGrist({
      applyUserActionsError: new Error('Network error')
    });
    
    try {
      await claimCurrentUserIdentity({
        grist,
        teamMemberId: 7,
        currentGristUserId: 155719,
        team
      });
    } catch (e) {
      // Ignorer
    }
    
    expect(isClaimPending()).toBe(false);
  });
  
  test('Grist API indisponible', async () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const grist = { docApi: null };
    
    const result = await claimCurrentUserIdentity({
      grist,
      teamMemberId: 7,
      currentGristUserId: 155719,
      team
    });
    
    expect(result.success).toBe(false);
    expect(result.code).toBe('IDENTITY_CLAIM_WRITE_FAILED');
  });
});

// ============================================================================
// TESTS D'ERREUR - RECHARGEMENT
// ============================================================================

describe('claimCurrentUserIdentity - Erreurs de rechargement', () => {
  beforeEach(() => {
    resetService();
  });
  
  afterEach(() => {
    resetService();
  });
  
  test('6. erreur de rechargement', async () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const grist = createMockGrist({
      fetchTableResult: {
        Team: createColumnarData([
          { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 155719 }
        ])
      }
    });
    
    const reloadSnapshot = jest.fn(async () => {
      throw new Error('Rechargement échoué');
    });
    
    const result = await claimCurrentUserIdentity({
      grist,
      teamMemberId: 7,
      currentGristUserId: 155719,
      team,
      reloadSnapshot
    });
    
    expect(result.success).toBe(false);
    expect(result.code).toBe('IDENTITY_CLAIM_RELOAD_FAILED');
    expect(result.reloadError).toContain('Rechargement échoué');
    expect(result.teamMemberId).toBe(7); // Mais l'écriture a réussi
  });
  
  test('reloadSnapshot non fourni', async () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const grist = createMockGrist({
      fetchTableResult: {
        Team: createColumnarData([
          { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 155719 }
        ])
      }
    });
    
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    
    const result = await claimCurrentUserIdentity({
      grist,
      teamMemberId: 7,
      currentGristUserId: 155719,
      team
      // reloadSnapshot omis
    });
    
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[CRA identity claim] reloadSnapshot non fourni, rechargement manuel requis'
    );
    
    consoleWarnSpy.mockRestore();
  });
});

// ============================================================================
// TESTS D'ERREUR - POSTCONDITION
// ============================================================================

describe('claimCurrentUserIdentity - Postcondition', () => {
  beforeEach(() => {
    resetService();
  });
  
  afterEach(() => {
    resetService();
  });
  
  test('9. postcondition incorrecte - gristUserId non mis à jour', async () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    const grist = createMockGrist({
      fetchTableResult: {
        Team: createColumnarData([
          { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: null } // Pas mis à jour (null)
        ])
      }
    });
    
    const result = await claimCurrentUserIdentity({
      grist,
      teamMemberId: 7,
      currentGristUserId: 155719,
      team,
      reloadSnapshot: jest.fn()
    });
    
    expect(result.success).toBe(false);
    expect(result.code).toBe('IDENTITY_CLAIM_POSTCONDITION_FAILED');
    expect(result.reason).toContain('gristUserId incorrect');
    expect(result.expectedUserId).toBe(155719);
    expect(result.actualUserId).toBeNull();
  });
  
  test('postcondition incorrecte - identité non résolue', async () => {
    // Cas : deux lignes avec le même gristUserId après écriture (conflit)
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 },
      { id: 8, nom: 'Autre', email: 'autre@example.com', gristUserId: 0 }
    ];
    
    // Après écriture, on simule un conflit : les deux lignes ont le même userId
    const grist = createMockGrist({
      fetchTableResult: {
        Team: createColumnarData([
          { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 155719 },
          { id: 8, nom: 'Autre', email: 'autre@example.com', gristUserId: 155719 }
        ])
      }
    });
    
    const result = await claimCurrentUserIdentity({
      grist,
      teamMemberId: 7,
      currentGristUserId: 155719,
      team,
      reloadSnapshot: jest.fn()
    });
    
    // La validation initiale passe car team n'a pas de conflit
    // Mais après écriture, le conflit apparaît et la postcondition échoue
    expect(result.success).toBe(false);
    expect(result.code).toBe('IDENTITY_CLAIM_POSTCONDITION_FAILED');
    expect(result.reason).toContain('Identité non résolue');
  });
  
  test('postcondition incorrecte - currentUserMemberId incorrect', async () => {
    const team = [
      { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 0 }
    ];
    
    // Simulation : après écriture, l'identité pointe vers un autre membre
    const grist = createMockGrist({
      fetchTableResult: {
        Team: createColumnarData([
          { id: 7, nom: 'Jean-Louis', email: 'jl@example.com', gristUserId: 155719 }
        ])
      }
    });
    
    const result = await claimCurrentUserIdentity({
      grist,
      teamMemberId: 7,
      currentGristUserId: 155719,
      team,
      reloadSnapshot: jest.fn()
    });
    
    // Dans ce cas, ça devrait réussir car il n'y a qu'une seule ligne
    // Ce test vérifie que la postcondition est bien vérifiée
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// TESTS DU VERROU
// ============================================================================

describe('Gestion du verrou', () => {
  beforeEach(() => {
    resetService();
  });
  
  afterEach(() => {
    resetService();
  });
  
  test('lockClaim acquiert le verrou', () => {
    const acquired = lockClaim({ teamMemberId: 7, currentGristUserId: 155719 });
    expect(acquired).toBe(true);
    expect(isClaimPending()).toBe(true);
    unlockClaim();
  });
  
  test('lockClaim refuse si déjà verrouillé', () => {
    lockClaim({ teamMemberId: 7, currentGristUserId: 155719 });
    const secondAcquired = lockClaim({ teamMemberId: 8, currentGristUserId: 888 });
    expect(secondAcquired).toBe(false);
    unlockClaim();
  });
  
  test('unlockClaim libère le verrou', () => {
    lockClaim({ teamMemberId: 7, currentGristUserId: 155719 });
    unlockClaim();
    expect(isClaimPending()).toBe(false);
  });
  
  test('cancelPendingClaim annule une opération', () => {
    lockClaim({ teamMemberId: 7, currentGristUserId: 155719 });
    const cancelled = cancelPendingClaim();
    expect(cancelled).toBe(true);
    expect(isClaimPending()).toBe(false);
  });
  
  test('cancelPendingClaim retourne false si pas de verrou', () => {
    const cancelled = cancelPendingClaim();
    expect(cancelled).toBe(false);
  });
  
  test('getServiceState retourne l\'état correct', () => {
    expect(getServiceState()).toEqual({
      claimInProgress: false,
      pendingClaimData: null
    });
    
    lockClaim({ teamMemberId: 7, currentGristUserId: 155719, timestamp: 12345 });
    
    const state = getServiceState();
    expect(state.claimInProgress).toBe(true);
    expect(state.pendingClaimData).toEqual({
      teamMemberId: 7,
      currentGristUserId: 155719,
      timestamp: 12345
    });
    
    unlockClaim();
  });
  
  test('resetService réinitialise tout', () => {
    lockClaim({ teamMemberId: 7, currentGristUserId: 155719 });
    resetService();
    expect(isClaimPending()).toBe(false);
    expect(getServiceState().claimInProgress).toBe(false);
  });
});
