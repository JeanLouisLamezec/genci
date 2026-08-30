/**
 * Tests pour le module CRA Manager Workspace
 * 
 * Couvre tous les scénarios requis :
 * 1. Manager avec un subordonné actif, aucune feuille
 * 2. Utilisateur sans subordonné et sans feuille accessible
 * 3. Utilisateur sans subordonné actuel mais responsable snapshoté d'une feuille
 * 4. Subordonné inactif uniquement
 * 5. Feuille soumise
 * 6. Feuille validée
 * 7. Feuille en correction manager
 * 8. Feuille d'un subordonné dont responsableValidation désigne un autre manager
 * 9. currentUserMemberId absent
 * 10. IDs sous forme numérique et chaîne numérique
 */

'use strict';

const {
  resolveManagerWorkspaceState,
  normalizeId,
  normalizeStatus,
  ACCESSIBLE_MANAGER_STATUSES,
  PENDING_STATUSES
} = require('../manager/cra-manager-workspace.js');

// ============================================================================
// HELPERS DE NORMALISATION
// ============================================================================

describe('normalizeId', () => {
  test('accepte un entier positif', () => {
    expect(normalizeId(155719)).toBe(155719);
    expect(normalizeId(1)).toBe(1);
  });

  test('accepte une chaîne numérique', () => {
    expect(normalizeId('155719')).toBe(155719);
  });

  test('rejette null', () => {
    expect(normalizeId(null)).toBeNull();
  });

  test('rejette undefined', () => {
    expect(normalizeId(undefined)).toBeNull();
  });

  test('rejette chaîne vide', () => {
    expect(normalizeId('')).toBeNull();
  });

  test('rejette 0', () => {
    expect(normalizeId(0)).toBeNull();
  });
});

describe('normalizeStatus', () => {
  test('normalise en lowercase', () => {
    expect(normalizeStatus('SOUMIS')).toBe('soumis');
    expect(normalizeStatus('Submitted')).toBe('submitted');
  });

  test('gère null et undefined', () => {
    expect(normalizeStatus(null)).toBe('');
    expect(normalizeStatus(undefined)).toBe('');
  });
});

// ============================================================================
// RÉSOLUTION DE L'ÉTAT MANAGER
// ============================================================================

describe('resolveManagerWorkspaceState', () => {
  test('un administrateur voit toutes les feuilles accessibles du workflow', () => {
    const team = [
      { id: 1, actif: true, estAdmin: true },
      { id: 2, actif: true, responsable: 9 },
      { id: 3, actif: true, responsable: 2 }
    ];
    const sheets = [
      { id: 50, membre: 2, statut: 'soumis', responsableValidation: 9 },
      { id: 51, membre: 3, statut: 'valide', responsableValidation: 2 },
      { id: 52, membre: 3, statut: 'brouillon', responsableValidation: null }
    ];

    const result = resolveManagerWorkspaceState({
      team,
      sheets,
      currentUserMemberId: 1,
      isAdmin: true
    });

    expect(result.shouldShowManagerTab).toBe(true);
    expect(result.accessibleSheets.map(sheet => sheet.id)).toEqual([50, 51]);
    expect(result.pendingCount).toBe(1);
    expect(result.isAdmin).toBe(true);
  });

  test('un administrateur peut préparer l’historique d’un membre inactif', () => {
    const result = resolveManagerWorkspaceState({
      team: [
        { id: 1, actif: true, estAdmin: true },
        { id: 2, actif: false, responsable: 9 }
      ],
      sheets: [],
      currentUserMemberId: 1,
      isAdmin: true
    });

    expect(result.directReportIds).toEqual([2]);
    expect(result.managesSomeone).toBe(true);
  });

  // 1. Manager avec un subordonné actif, aucune feuille
  test('1. manager avec subordonné actif, aucune feuille', () => {
    const team = [
      { id: 1, nom: 'Jean-Louis', actif: true, responsable: null },
      { id: 12, nom: 'Raphaëlle', actif: true, responsable: 1 }
    ];
    const sheets = [];
    const currentUserMemberId = 1;
    
    const result = resolveManagerWorkspaceState({ team, sheets, currentUserMemberId });
    
    expect(result.isIdentified).toBe(true);
    expect(result.managesSomeone).toBe(true);
    expect(result.directReportIds).toEqual([12]);
    expect(result.directReportCount).toBe(1);
    expect(result.hasAccessibleSheets).toBe(false);
    expect(result.shouldShowManagerTab).toBe(true);
    expect(result.pendingCount).toBe(0);
  });

  // 2. Utilisateur sans subordonné et sans feuille accessible
  test('2. utilisateur sans subordonné et sans feuille', () => {
    const team = [
      { id: 1, nom: 'Jean-Louis', actif: true, responsable: null },
      { id: 2, nom: 'Alice', actif: true, responsable: 3 }
    ];
    const sheets = [];
    const currentUserMemberId = 1;
    
    const result = resolveManagerWorkspaceState({ team, sheets, currentUserMemberId });
    
    expect(result.managesSomeone).toBe(false);
    expect(result.hasAccessibleSheets).toBe(false);
    expect(result.shouldShowManagerTab).toBe(false);
  });

  // 3. Utilisateur sans subordonné actuel mais responsable snapshoté d'une feuille
  test('3. responsable snapshoté sans subordonné actuel', () => {
    const team = [
      { id: 1, nom: 'Jean-Louis', actif: true, responsable: null },
      { id: 12, nom: 'Raphaëlle', actif: true, responsable: 3 } // Responsable = quelqu'un d'autre
    ];
    const sheets = [
      { id: 50, membre: 12, statut: 'soumis', responsableValidation: 1 }
    ];
    const currentUserMemberId = 1;
    
    const result = resolveManagerWorkspaceState({ team, sheets, currentUserMemberId });
    
    expect(result.managesSomeone).toBe(false);
    expect(result.hasAccessibleSheets).toBe(true);
    expect(result.accessibleSheets).toHaveLength(1);
    expect(result.shouldShowManagerTab).toBe(true);
    expect(result.pendingCount).toBe(1);
  });

  // 4. Subordonné inactif uniquement
  test('4. subordonné inactif uniquement', () => {
    const team = [
      { id: 1, nom: 'Jean-Louis', actif: true, responsable: null },
      { id: 12, nom: 'Raphaëlle', actif: false, responsable: 1 } // Inactif
    ];
    const sheets = [];
    const currentUserMemberId = 1;
    
    const result = resolveManagerWorkspaceState({ team, sheets, currentUserMemberId });
    
    expect(result.managesSomeone).toBe(false);
    expect(result.directReportCount).toBe(0);
    
    // Mais si une feuille historique existe, shouldShowManagerTab = true
    expect(result.shouldShowManagerTab).toBe(false);
  });

  test('4b. subordonné inactif avec feuille historique', () => {
    const team = [
      { id: 1, nom: 'Jean-Louis', actif: true, responsable: null },
      { id: 12, nom: 'Raphaëlle', actif: false, responsable: 1 }
    ];
    const sheets = [
      { id: 50, membre: 12, statut: 'valide', responsableValidation: 1 }
    ];
    const currentUserMemberId = 1;
    
    const result = resolveManagerWorkspaceState({ team, sheets, currentUserMemberId });
    
    expect(result.managesSomeone).toBe(false); // Inactif
    expect(result.hasAccessibleSheets).toBe(true); // Mais feuille accessible
    expect(result.shouldShowManagerTab).toBe(true); // Visible grâce à la feuille
  });

  // 5. Feuille soumise
  test('5. feuille soumise', () => {
    const team = [
      { id: 1, nom: 'Jean-Louis', actif: true, responsable: null },
      { id: 12, nom: 'Raphaëlle', actif: true, responsable: 1 }
    ];
    const sheets = [
      { id: 50, membre: 12, statut: 'soumis', responsableValidation: 1 }
    ];
    const currentUserMemberId = 1;
    
    const result = resolveManagerWorkspaceState({ team, sheets, currentUserMemberId });
    
    expect(result.pendingCount).toBe(1);
    expect(result.pendingSheets).toHaveLength(1);
    expect(result.validatedCount).toBe(0);
    expect(result.correctionCount).toBe(0);
  });

  // 6. Feuille validée
  test('6. feuille validée', () => {
    const team = [
      { id: 1, nom: 'Jean-Louis', actif: true, responsable: null },
      { id: 12, nom: 'Raphaëlle', actif: true, responsable: 1 }
    ];
    const sheets = [
      { id: 50, membre: 12, statut: 'valide', responsableValidation: 1 }
    ];
    const currentUserMemberId = 1;
    
    const result = resolveManagerWorkspaceState({ team, sheets, currentUserMemberId });
    
    expect(result.pendingCount).toBe(0);
    expect(result.validatedCount).toBe(1);
    expect(result.hasAccessibleSheets).toBe(true);
    expect(result.shouldShowManagerTab).toBe(true);
  });

  // 7. Feuille en correction manager
  test('7. feuille en correction manager', () => {
    const team = [
      { id: 1, nom: 'Jean-Louis', actif: true, responsable: null },
      { id: 12, nom: 'Raphaëlle', actif: true, responsable: 1 }
    ];
    const sheets = [
      { id: 50, membre: 12, statut: 'correction_manager', responsableValidation: 1 }
    ];
    const currentUserMemberId = 1;
    
    const result = resolveManagerWorkspaceState({ team, sheets, currentUserMemberId });
    
    expect(result.pendingCount).toBe(0);
    expect(result.correctionCount).toBe(1);
    expect(result.hasAccessibleSheets).toBe(true);
  });

  // 8. Feuille d'un subordonné dont responsableValidation désigne un autre manager
  test('8. feuille avec autre responsableValidation', () => {
    const team = [
      { id: 1, nom: 'Jean-Louis', actif: true, responsable: null },
      { id: 12, nom: 'Raphaëlle', actif: true, responsable: 1 }
    ];
    const sheets = [
      { id: 50, membre: 12, statut: 'soumis', responsableValidation: 99 } // Autre manager
    ];
    const currentUserMemberId = 1;
    
    const result = resolveManagerWorkspaceState({ team, sheets, currentUserMemberId });
    
    expect(result.managesSomeone).toBe(true); // Jean-Louis gère Raphaëlle
    expect(result.shouldShowManagerTab).toBe(true); // Onglet visible
    expect(result.hasAccessibleSheets).toBe(false); // Mais cette feuille n'est pas accessible
    expect(result.accessibleSheets).toHaveLength(0);
  });

  // 9. currentUserMemberId absent
  test('9. currentUserMemberId absent', () => {
    const team = [
      { id: 1, nom: 'Jean-Louis', actif: true, responsable: null }
    ];
    const sheets = [];
    const currentUserMemberId = null;
    
    const result = resolveManagerWorkspaceState({ team, sheets, currentUserMemberId });
    
    expect(result.isIdentified).toBe(false);
    expect(result.shouldShowManagerTab).toBe(false);
  });

  // 10. IDs sous forme numérique et chaîne numérique
  test('10. IDs numériques et chaînes', () => {
    const team = [
      { id: '1', nom: 'Jean-Louis', actif: true, responsable: null },
      { id: '12', nom: 'Raphaëlle', actif: true, responsable: '1' }
    ];
    const sheets = [
      { id: '50', membre: '12', statut: 'soumis', responsableValidation: '1' }
    ];
    const currentUserMemberId = '1';
    
    const result = resolveManagerWorkspaceState({ team, sheets, currentUserMemberId });
    
    expect(result.managesSomeone).toBe(true);
    expect(result.directReportIds).toEqual([12]);
    expect(result.pendingCount).toBe(1);
    expect(result.shouldShowManagerTab).toBe(true);
  });

  // Test d'intégration complet
  test('intégration : scénario Jean-Louis / Raphaëlle', () => {
    const team = [
      { id: 1, nom: 'Jean-Louis Lamezec', actif: true, responsable: null, email: 'jl@example.com' },
      { id: 12, nom: 'Raphaëlle Achach', actif: true, responsable: 1, email: 'raphaelle@example.com' }
    ];
    
    // Cas A : Aucune feuille
    let result = resolveManagerWorkspaceState({
      team,
      sheets: [],
      currentUserMemberId: 1
    });
    
    expect(result.shouldShowManagerTab).toBe(true);
    expect(result.managesSomeone).toBe(true);
    expect(result.directReportCount).toBe(1);
    expect(result.pendingCount).toBe(0);
    
    // Cas B : Feuille soumise
    result = resolveManagerWorkspaceState({
      team,
      sheets: [
        { id: 50, membre: 12, statut: 'soumis', responsableValidation: 1 }
      ],
      currentUserMemberId: 1
    });
    
    expect(result.shouldShowManagerTab).toBe(true);
    expect(result.pendingCount).toBe(1);
    expect(result.accessibleSheets).toHaveLength(1);
    
    // Cas C : Feuille avec autre responsableValidation
    result = resolveManagerWorkspaceState({
      team,
      sheets: [
        { id: 50, membre: 12, statut: 'soumis', responsableValidation: 99 }
      ],
      currentUserMemberId: 1
    });
    
    expect(result.shouldShowManagerTab).toBe(true); // Visible car manager
    expect(result.accessibleSheets).toHaveLength(0); // Mais feuille non accessible
  });
});

// ============================================================================
// CONSTANTES
// ============================================================================

describe('CONSTANTES', () => {
  test('ACCESSIBLE_MANAGER_STATUSES contient les bons statuts', () => {
    expect(ACCESSIBLE_MANAGER_STATUSES).toContain('soumis');
    expect(ACCESSIBLE_MANAGER_STATUSES).toContain('submitted');
    expect(ACCESSIBLE_MANAGER_STATUSES).toContain('valide');
    expect(ACCESSIBLE_MANAGER_STATUSES).toContain('validated');
    expect(ACCESSIBLE_MANAGER_STATUSES).toContain('correction_manager');
  });

  test('PENDING_STATUSES contient uniquement les statuts en attente', () => {
    expect(PENDING_STATUSES).toEqual(['soumis', 'submitted']);
  });
});
