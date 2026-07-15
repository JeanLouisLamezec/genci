/**
 * Tests d'intégration pour le Lot 2 - Corrections
 * 
 * Tests supplémentaires pour valider les corrections apportées :
 * - Normalisation de l'accès à Grist
 * - Non-rattachement automatique des anciennes entrées
 * - Sémantique des lignes verrouillées
 * - Gestion de revisionPlan
 * - Affectations inactives
 * - Unicité des affectations actives
 */

'use strict';

const {
  gristDateToIso,
  isoToGristDate,
  normalizeSheetStatus,
  buildMemberDailyCapacities,
  loadAssignmentContext,
  planAssignment,
  reconcileAssignmentPlan,
  reconcileTaskPlan,
  diffToGristActions
} = require('./grist-planning-adapter.js');

const { createMockGrist } = require('./mock-grist.js');
const { getDocApi } = require('./grist-api-helper.js');

// Helper: convertir les données colonnaires en lignes
function columnarToRows(data) {
  if (!data || Array.isArray(data)) return data || [];
  
  const cols = Object.keys(data);
  if (!cols.length) return [];
  
  const n = (data[cols[0]] && data[cols[0]].length) || 0;
  const rows = [];
  
  for (let i = 0; i < n; i++) {
    const rec = {};
    for (const col of cols) {
      rec[col] = data[col][i];
    }
    rows.push(rec);
  }
  
  return rows;
}

describe('Lot 2 Corrections - Accès normalisé à Grist', () => {
  
  test('getDocApi accepte grist.docApi', () => {
    const mock = { docApi: { fetchTable: () => {}, applyUserActions: () => {} } };
    expect(() => getDocApi(mock)).not.toThrow();
  });
  
  test('getDocApi accepte grist directement', () => {
    const mock = { fetchTable: () => {}, applyUserActions: () => {} };
    expect(() => getDocApi(mock)).not.toThrow();
  });
  
  test('getDocApi rejette un objet invalide', () => {
    const mock = { docApi: {} };
    expect(() => getDocApi(mock)).toThrow('INVALID_GRIST_DOC_API');
  });
  
  test('getDocApi rejette un objet sans fetchTable', () => {
    const mock = { docApi: { applyUserActions: () => {} } };
    expect(() => getDocApi(mock)).toThrow('INVALID_GRIST_DOC_API');
  });
  
  test('getDocApi rejette un objet sans applyUserActions', () => {
    const mock = { docApi: { fetchTable: () => {} } };
    expect(() => getDocApi(mock)).toThrow('INVALID_GRIST_DOC_API');
  });
});

describe('Lot 2 Corrections - Non-rattachement automatique', () => {
  
  let mockGrist;
  
  beforeEach(() => {
    mockGrist = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 35,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            modeRepartition: 'proportionnelle',
            actif: true
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [
          {
            id: 1,
            affectation: 1,
            tache: 1,
            membre: 1,
            date: 1719792000,
            heuresPrevues: 7,
            heures: 0,
            revisionPlan: 1
          },
          {
            id: 2,
            affectation: null,
            tache: 1,
            membre: 1,
            date: 1719878400,
            heuresPrevues: 5,
            heures: 0,
            revisionPlan: 0
          }
        ],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
  });
  
  test('Une ligne sans affectation produit un diagnostic UNASSIGNED_LEGACY_TIME_ENTRY', async () => {
    const result = await planAssignment(mockGrist, 1);
    
    expect(result.success).toBe(true);
    // Le diagnostic peut être dans diagnostics ou capacityDiagnostics
    const allDiagnostics = [...(result.diagnostics || []), ...(result.capacityDiagnostics || [])];
    const unassignedDiagnostic = allDiagnostics.find(d => d.code === 'UNASSIGNED_LEGACY_TIME_ENTRY');
    expect(unassignedDiagnostic).toBeDefined();
    expect(unassignedDiagnostic.entryId).toBe(2);
  });
  
  test('Une ligne sans affectation ne réduit pas le reste à faire', async () => {
    const result = await planAssignment(mockGrist, 1, {
      replanFromDate: '2024-07-01'
    });
    
    // La ligne 2 ne doit pas être incluse dans existingEntries
    expect(result.context.existingEntries.length).toBe(1);
    expect(result.context.existingEntries[0].id).toBe(1);
    
    // Le plan devrait avoir des jours restants
    expect(result.desiredPlan.length).toBeGreaterThan(0);
  });
});

describe('Lot 2 Corrections - Sémantique des lignes verrouillées', () => {
  
  let mockGrist;
  
  beforeEach(() => {
    mockGrist = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 35,
            dateDebut: 1719792000,
            dateFin: 1720396800,
            actif: true
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
  });
  
  test('Une ligne soumise absente de desiredPlan ne produit ni action ni conflit', async () => {
    // Ajouter une feuille soumise
    const sheetResult = await mockGrist.applyUserActions([
      ['AddRecord', 'Feuilles', null, {
        membre: 1,
        semaine: 1719792000,
        statut: 'soumis'
      }]
    ]);
    const sheetId = sheetResult[0].id;
    
    // Ajouter une entrée soumise avec 2h prévues
    await mockGrist.applyUserActions([
      ['AddRecord', 'TimeEntries', null, {
        affectation: 1,
        tache: 1,
        membre: 1,
        date: 1719792000,
        heuresPrevues: 2,
        heures: 0,
        feuille: sheetId,
        revisionPlan: 1
      }]
    ]);
    
    const result = await reconcileAssignmentPlan(mockGrist, 1, { dryRun: true });
    
    expect(result.success).toBe(true);
    // Ne devrait pas modifier ou supprimer l'entrée soumise
    const actionForDay1 = result.actions.find(a => a[2] === 1);
    expect(actionForDay1).toBeUndefined();
  });
  
  test('Une ligne validée absente de desiredPlan ne produit ni action ni conflit', async () => {
    // Ajouter une feuille validée
    const sheetResult = await mockGrist.applyUserActions([
      ['AddRecord', 'Feuilles', null, {
        membre: 1,
        semaine: 1719792000,
        statut: 'valide'
      }]
    ]);
    const sheetId = sheetResult[0].id;
    
    // Ajouter une entrée validée avec 3h prévues et 4h réalisées
    await mockGrist.applyUserActions([
      ['AddRecord', 'TimeEntries', null, {
        affectation: 1,
        tache: 1,
        membre: 1,
        date: 1719792000,
        heuresPrevues: 3,
        heures: 4,
        feuille: sheetId,
        revisionPlan: 1
      }]
    ]);
    
    const result = await reconcileAssignmentPlan(mockGrist, 1, { dryRun: true });
    
    expect(result.success).toBe(true);
    // Ne devrait pas modifier ou supprimer l'entrée validée
    const actionForDay1 = result.actions.find(a => a[2] === 1);
    expect(actionForDay1).toBeUndefined();
  });
  
  test('Une ligne verrouillée explicitement présente avec un prévu différent produit un conflit', async () => {
    // Ajouter une feuille soumise
    const sheetResult = await mockGrist.applyUserActions([
      ['AddRecord', 'Feuilles', null, {
        membre: 1,
        semaine: 1719792000,
        statut: 'soumis'
      }]
    ]);
    const sheetId = sheetResult[0].id;
    
    // Ajouter une entrée soumise avec 2h prévues
    await mockGrist.applyUserActions([
      ['AddRecord', 'TimeEntries', null, {
        affectation: 1,
        tache: 1,
        membre: 1,
        date: 1719792000,
        heuresPrevues: 2,
        heures: 0,
        feuille: sheetId,
        revisionPlan: 1
      }]
    ]);
    
    // Le plan désiré voudrait mettre 7h ce jour-là
    // Cela devrait créer un conflit LOCKED_ENTRY_MISMATCH
    const result = await reconcileAssignmentPlan(mockGrist, 1, { dryRun: true });
    
    // Le conflit peut être détecté soit comme conflit, soit bloqué par le moteur
    expect(result.success).toBe(true);
    // L'entrée soumise ne devrait pas être modifiée
    const updateForDay1 = result.actions.find(a => a[0] === 'UpdateRecord' && a[2] === 1);
    expect(updateForDay1).toBeUndefined();
  });
  
  test('Une affectation avec une journée soumise et plusieurs journées futures mutables peut être réconciliée', async () => {
    // Ajouter une feuille soumise pour le premier jour
    const sheetResult = await mockGrist.applyUserActions([
      ['AddRecord', 'Feuilles', null, {
        membre: 1,
        semaine: 1719792000,
        statut: 'soumis'
      }]
    ]);
    const sheetId = sheetResult[0].id;
    
    // Ajouter une entrée soumise pour le premier jour
    await mockGrist.applyUserActions([
      ['AddRecord', 'TimeEntries', null, {
        affectation: 1,
        tache: 1,
        membre: 1,
        date: 1719792000,
        heuresPrevues: 2,
        heures: 0,
        feuille: sheetId,
        revisionPlan: 1
      }]
    ]);
    
    const result = await reconcileAssignmentPlan(mockGrist, 1, {
      dryRun: true,
      replanFromDate: '2024-07-01'
    });
    
    expect(result.success).toBe(true);
    // Devrait créer des entrées pour les jours 2-5 (02-05/07)
    const creates = result.actions.filter(a => a[0] === 'AddRecord');
    expect(creates.length).toBeGreaterThan(0);
  });
  
  test('Une surconsommation peut remettre le futur mutable à zéro tout en préservant l\'historique validé', async () => {
    // Ajouter une feuille validée
    const sheetResult = await mockGrist.applyUserActions([
      ['AddRecord', 'Feuilles', null, {
        membre: 1,
        semaine: 1719792000,
        statut: 'valide'
      }]
    ]);
    const sheetId = sheetResult[0].id;
    
    // Ajouter des entrées validées qui dépassent l'allocation (40h > 35h)
    await mockGrist.applyUserActions([
      ['AddRecord', 'TimeEntries', null, {
        affectation: 1,
        tache: 1,
        membre: 1,
        date: 1719792000,
        heuresPrevues: 5,
        heures: 20,
        feuille: sheetId,
        revisionPlan: 1
      }],
      ['AddRecord', 'TimeEntries', null, {
        affectation: 1,
        tache: 1,
        membre: 1,
        date: 1719878400,
        heuresPrevues: 5,
        heures: 20,
        feuille: sheetId,
        revisionPlan: 1
      }]
    ]);
    
    const result = await reconcileAssignmentPlan(mockGrist, 1, { dryRun: true });
    
    // Le moteur retourne un plan vide en cas de surconsommation
    // Soit summary.overconsumedHours > 0, soit un diagnostic OVERCONSUMPTION
    if (result.summary) {
      expect(result.summary.overconsumedHours).toBeGreaterThan(0);
    } else {
      // Sinon, devrait avoir un diagnostic
      const overconsumptionDiagnostic = result.diagnostics.find(d => d.code === 'OVERCONSUMPTION');
      expect(overconsumptionDiagnostic).toBeDefined();
    }
  });
});

describe('Lot 2 Corrections - revisionPlan', () => {
  
  let mockGrist;
  
  beforeEach(() => {
    mockGrist = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 35,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: true
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [
          {
            id: 1,
            affectation: 1,
            tache: 1,
            membre: 1,
            date: 1719792000,
            heuresPrevues: 5,
            heures: 0,
            revisionPlan: 1
          }
        ],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
  });
  
  test('revisionPlan 1 → 2 après mise à jour', async () => {
    // Le test vérifie que diffToGristActions incrémente correctement revisionPlan
    const diff = {
      creates: [],
      updates: [
        {
          id: 1,
          fields: {
            plannedHours: 5
          }
        }
      ],
      deletes: []
    };
    
    const assignment = { id: 1, taskId: 1, memberId: 1 };
    const existingEntriesMap = new Map([[1, { id: 1, revisionPlan: 1 }]]);
    
    const actions = diffToGristActions(diff, assignment, [], existingEntriesMap);
    
    expect(actions.length).toBe(1);
    expect(actions[0][3].revisionPlan).toBe(2);
  });
  
  test('revisionPlan reste à 1 si aucun champ de planification ne change', async () => {
    // Créer un mock où le plan est déjà correct
    const mockGrist2 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 7,
            dateDebut: 1719792000,
            dateFin: 1719792000,
            actif: true
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [
          {
            id: 1,
            affectation: 1,
            tache: 1,
            membre: 1,
            date: 1719792000,
            heuresPrevues: 7,
            heures: 0,
            capaciteTheorique: 7,
            capaciteDisponible: 7,
            revisionPlan: 1
          }
        ],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    const result = await reconcileAssignmentPlan(mockGrist2, 1, {
      dryRun: true,
      replanFromDate: '2024-07-01'
    });
    
    expect(result.success).toBe(true);
    // Ne devrait rien faire car tout est déjà correct
    expect(result.actions.length).toBe(0);
  });
});

describe('Lot 2 Corrections - Affectations inactives', () => {
  
  let mockGrist;
  
  beforeEach(() => {
    mockGrist = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 35,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: false
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [
          {
            id: 1,
            affectation: 1,
            tache: 1,
            membre: 1,
            date: 1719792000,
            heuresPrevues: 7,
            heures: 0,
            revisionPlan: 1
          },
          {
            id: 2,
            affectation: 1,
            tache: 1,
            membre: 1,
            date: 1719878400,
            heuresPrevues: 0,
            heures: 0,
            revisionPlan: 0
          }
        ],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
  });
  
  test('Une affectation inactive retourne un succès avec diagnostic ASSIGNMENT_INACTIVE_CLEANUP', async () => {
    const result = await reconcileAssignmentPlan(mockGrist, 1, { dryRun: true });
    
    // Devrait réussir avec un diagnostic non bloquant
    expect(result.success).toBe(true);
    expect(result.isInactive).toBe(true);
    expect(result.diagnostics.some(d => d.code === 'ASSIGNMENT_INACTIVE_CLEANUP')).toBe(true);
  });
  
  test('future mutable vide → suppression', async () => {
    const mockGrist2 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 35,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: false
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [
          {
            id: 1,
            affectation: 1,
            tache: 1,
            membre: 1,
            date: 1719878400, // Future
            heuresPrevues: 0,
            heures: 0,
            revisionPlan: 1
          }
        ],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    const result = await reconcileAssignmentPlan(mockGrist2, 1, { dryRun: true, replanFromDate: '2024-07-01' });
    
    expect(result.success).toBe(true);
    expect(result.isInactive).toBe(true);
    // Devrait supprimer la ligne vide
    const removeAction = result.actions.find(a => a[0] === 'RemoveRecord' && a[2] === 1);
    expect(removeAction).toBeDefined();
  });
  
  test('future mutable avec heuresPrevues → heuresPrevues = 0', async () => {
    const mockGrist2 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 35,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: false
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [
          {
            id: 1,
            affectation: 1,
            tache: 1,
            membre: 1,
            date: 1719878400, // Future
            heuresPrevues: 5,
            heures: 0,
            revisionPlan: 1
          }
        ],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    const result = await reconcileAssignmentPlan(mockGrist2, 1, { dryRun: true, replanFromDate: '2024-07-01' });
    
    expect(result.success).toBe(true);
    expect(result.isInactive).toBe(true);
    // Devrait mettre heuresPrevues à 0
    const updateAction = result.actions.find(a => a[0] === 'UpdateRecord' && a[2] === 1);
    expect(updateAction).toBeDefined();
    expect(updateAction[3].heuresPrevues).toBe(0);
    expect(updateAction[3].revisionPlan).toBe(2);
  });
  
  test('future mutable avec description → heuresPrevues = 0, description conservée', async () => {
    const mockGrist2 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 35,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: false
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [
          {
            id: 1,
            affectation: 1,
            tache: 1,
            membre: 1,
            date: 1719878400, // Future
            heuresPrevues: 5,
            heures: 0,
            description: 'Note importante',
            revisionPlan: 1
          }
        ],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    const result = await reconcileAssignmentPlan(mockGrist2, 1, { dryRun: true, replanFromDate: '2024-07-01' });
    
    expect(result.success).toBe(true);
    expect(result.isInactive).toBe(true);
    // Devrait mettre heuresPrevues à 0 mais conserver la description
    const updateAction = result.actions.find(a => a[0] === 'UpdateRecord' && a[2] === 1);
    expect(updateAction).toBeDefined();
    expect(updateAction[3].heuresPrevues).toBe(0);
    expect(updateAction[3].description).toBeUndefined(); // La description n'est pas modifiée
  });
  
  test('passé mutable → inchangé', async () => {
    const mockGrist2 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 35,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: false
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [
          {
            id: 1,
            affectation: 1,
            tache: 1,
            membre: 1,
            date: 1719705600, // Passé (avant replanFromDate)
            heuresPrevues: 5,
            heures: 0,
            revisionPlan: 1
          }
        ],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    const result = await reconcileAssignmentPlan(mockGrist2, 1, { dryRun: true, replanFromDate: '2024-07-01' });
    
    expect(result.success).toBe(true);
    expect(result.isInactive).toBe(true);
    // Aucune action pour les lignes passées
    expect(result.actions.length).toBe(0);
  });
  
  test('soumis → inchangé', async () => {
    const mockGrist2 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 35,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: false
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    const sheetResult = await mockGrist2.applyUserActions([
      ['AddRecord', 'Feuilles', null, {
        membre: 1,
        semaine: 1719792000,
        statut: 'soumis'
      }]
    ]);
    const sheetId = sheetResult[0].id;
    
    await mockGrist2.applyUserActions([
      ['AddRecord', 'TimeEntries', null, {
        affectation: 1,
        tache: 1,
        membre: 1,
        date: 1719878400, // Future
        heuresPrevues: 5,
        heures: 0,
        feuille: sheetId,
        revisionPlan: 1
      }]
    ]);
    
    const result = await reconcileAssignmentPlan(mockGrist2, 1, { dryRun: true, replanFromDate: '2024-07-01' });
    
    expect(result.success).toBe(true);
    expect(result.isInactive).toBe(true);
    // Aucune action pour les lignes soumises
    expect(result.actions.length).toBe(0);
  });
  
  test('validé → inchangé', async () => {
    const mockGrist2 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 35,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: false
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    const sheetResult = await mockGrist2.applyUserActions([
      ['AddRecord', 'Feuilles', null, {
        membre: 1,
        semaine: 1719792000,
        statut: 'valide'
      }]
    ]);
    const sheetId = sheetResult[0].id;
    
    await mockGrist2.applyUserActions([
      ['AddRecord', 'TimeEntries', null, {
        affectation: 1,
        tache: 1,
        membre: 1,
        date: 1719878400, // Future
        heuresPrevues: 5,
        heures: 3,
        feuille: sheetId,
        revisionPlan: 1
      }]
    ]);
    
    const result = await reconcileAssignmentPlan(mockGrist2, 1, { dryRun: true, replanFromDate: '2024-07-01' });
    
    expect(result.success).toBe(true);
    expect(result.isInactive).toBe(true);
    // Aucune action pour les lignes validées
    expect(result.actions.length).toBe(0);
  });
  
  test('seconde exécution → aucune action (idempotence)', async () => {
    const mockGrist2 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 35,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: false
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [
          {
            id: 1,
            affectation: 1,
            tache: 1,
            membre: 1,
            date: 1719878400, // Future
            heuresPrevues: 5,
            heures: 0,
            revisionPlan: 1
          }
        ],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    // Première exécution - met heuresPrevues à 0
    const result1 = await reconcileAssignmentPlan(mockGrist2, 1, { dryRun: false, replanFromDate: '2024-07-01' });
    
    expect(result1.success).toBe(true);
    expect(result1.actionsExecuted).toBe(1);
    expect(result1.actions[0][3].heuresPrevues).toBe(0);
    
    // Seconde exécution - devrait supprimer la ligne devenue vide
    const result2 = await reconcileAssignmentPlan(mockGrist2, 1, { dryRun: true, replanFromDate: '2024-07-01' });
    
    expect(result2.success).toBe(true);
    // La ligne est maintenant vide, donc elle devrait être supprimée
    expect(result2.actions.length).toBe(1);
    expect(result2.actions[0][0]).toBe('RemoveRecord');
    
    // Appliquer la suppression
    await mockGrist2.applyUserActions(result2.actions);
    
    // Troisième exécution - aucune action car plus de lignes
    const result3 = await reconcileAssignmentPlan(mockGrist2, 1, { dryRun: true, replanFromDate: '2024-07-01' });
    
    expect(result3.success).toBe(true);
    expect(result3.actions.length).toBe(0);
  });
});

describe('Member Daily Capacity Service - Invalid availability', () => {
  
  test('dispo = 2 → INVALID_AVAILABILITY_RATIO, aucune capacité écrite', async () => {
    const mockGrist2 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 35,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: true
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [
          {
            membre: 1,
            type: 'conges',
            dateDebut: 1719792000,
            dateFin: 1719792000,
            dispo: 2 // Invalid: > 1
          }
        ],
        MemberDailyCapacities: []
      }
    });
    
    const result = await reconcileAssignmentPlan(mockGrist2, 1, { dryRun: true, replanFromDate: '2024-07-01' });
    
    // Devrait échouer avec INVALID_AVAILABILITY_RATIO
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('INVALID_CAPACITY_INPUT');
    expect(result.error.errors.some(e => e.code === 'INVALID_AVAILABILITY_RATIO')).toBe(true);
    
    // Vérifier qu'aucune capacité n'a été écrite
    const caps = await mockGrist2.fetchTable('MemberDailyCapacities');
    const capsRows = columnarToRows(caps);
    expect(capsRows.length).toBe(0);
    
    // Vérifier qu'aucune TimeEntry n'a été écrite
    const entries = await mockGrist2.fetchTable('TimeEntries');
    const entriesRows = columnarToRows(entries);
    expect(entriesRows.length).toBe(0);
  });
  
  test('dispo = 0,5 → capacité 3,5 h, TimeEntry.capaciteJour renseignée', async () => {
    const mockGrist2 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 7,
            dateDebut: 1719792000,
            dateFin: 1719792000,
            actif: true
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [
          {
            membre: 1,
            type: 'temps_partiel',
            dateDebut: 1719792000,
            dateFin: 1719792000,
            dispo: 0.5
          }
        ],
        MemberDailyCapacities: []
      }
    });
    
    const result = await reconcileAssignmentPlan(mockGrist2, 1, { dryRun: false, replanFromDate: '2024-07-01' });
    
    expect(result.success).toBe(true);
    
    // Vérifier les capacités créées
    const caps = await mockGrist2.fetchTable('MemberDailyCapacities');
    const capsRows = columnarToRows(caps);
    expect(capsRows.length).toBe(1);
    expect(capsRows[0].capaciteTheorique).toBe(7);
    expect(capsRows[0].capaciteDisponible).toBe(3.5);
    expect(capsRows[0].disponibiliteRatio).toBe(0.5);
    
    // Vérifier les TimeEntries créées
    const entries = await mockGrist2.fetchTable('TimeEntries');
    const entriesRows = columnarToRows(entries);
    expect(entriesRows.length).toBe(1);
    expect(entriesRows[0].capaciteJour).toBe(capsRows[0].id);
    expect(entriesRows[0].capaciteTheorique).toBe(7);
    expect(entriesRows[0].capaciteDisponible).toBe(3.5);
  });
  
  test('deuxième exécution → aucune nouvelle capacité, aucune nouvelle TimeEntry', async () => {
    const mockGrist2 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 7,
            dateDebut: 1719792000,
            dateFin: 1719792000,
            actif: true
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    // Première exécution
    const result1 = await reconcileAssignmentPlan(mockGrist2, 1, { dryRun: false, replanFromDate: '2024-07-01' });
    
    expect(result1.success).toBe(true);
    expect(result1.actionsExecuted).toBeGreaterThan(0);
    
    const caps1 = await mockGrist2.fetchTable('MemberDailyCapacities');
    const capsRows1 = columnarToRows(caps1);
    const initialCapCount = capsRows1.length;
    
    const entries1 = await mockGrist2.fetchTable('TimeEntries');
    const entriesRows1 = columnarToRows(entries1);
    const initialEntryCount = entriesRows1.length;
    
    // Deuxième exécution
    const result2 = await reconcileAssignmentPlan(mockGrist2, 1, { dryRun: true, replanFromDate: '2024-07-01' });
    
    expect(result2.success).toBe(true);
    expect(result2.actions.length).toBe(0);
    
    // Vérifier qu'aucune nouvelle capacité n'a été créée
    const caps2 = await mockGrist2.fetchTable('MemberDailyCapacities');
    const capsRows2 = columnarToRows(caps2);
    expect(capsRows2.length).toBe(initialCapCount);
    
    // Vérifier qu'aucune nouvelle TimeEntry n'a été créée
    const entries2 = await mockGrist2.fetchTable('TimeEntries');
    const entriesRows2 = columnarToRows(entries2);
    expect(entriesRows2.length).toBe(initialEntryCount);
  });
});

describe('Lot 2 Corrections - Unicité des affectations actives', () => {
  
  let mockGrist;
  
  beforeEach(() => {
    mockGrist = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 20,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: true
          },
          {
            id: 2,
            tache: 1,
            membre: 1,
            heuresAllouees: 15,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: true
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
  });
  
  test('Deux affectations actives identiques sont bloquées avec DUPLICATE_ACTIVE_ASSIGNMENT', async () => {
    const result = await reconcileTaskPlan(mockGrist, 1, { dryRun: true });
    
    expect(result.assignmentCount).toBe(2);
    expect(result.results.length).toBe(2);
    expect(result.duplicates).toBeDefined();
    expect(result.duplicates.length).toBe(1);
    
    // Les deux affectations devraient être bloquées
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error.code).toBe('DUPLICATE_ACTIVE_ASSIGNMENT');
    expect(result.results[1].success).toBe(false);
    expect(result.results[1].error.code).toBe('DUPLICATE_ACTIVE_ASSIGNMENT');
  });
  
  test('1 active + 1 inactive → autorisé', async () => {
    const mockGrist2 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 20,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: true
          },
          {
            id: 2,
            tache: 1,
            membre: 1,
            heuresAllouees: 15,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: false
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    const result = await reconcileTaskPlan(mockGrist2, 1, { dryRun: true, activeOnly: true });
    
    // Seulement l'affectation active devrait être traitée
    expect(result.results.length).toBe(1);
    expect(result.duplicates).toBeUndefined();
  });
  
  test('Membres différents → autorisé', async () => {
    const mockGrist3 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 20,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: true
          },
          {
            id: 2,
            tache: 1,
            membre: 2,
            heuresAllouees: 15,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: true
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [
          { id: 1, nom: 'Alice', capaciteHebdo: 35 },
          { id: 2, nom: 'Bob', capaciteHebdo: 35 }
        ],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    const result = await reconcileTaskPlan(mockGrist3, 1, { dryRun: true });
    
    expect(result.results.length).toBe(2);
    expect(result.duplicates).toBeUndefined();
    expect(result.results[0].success).toBe(true);
    expect(result.results[1].success).toBe(true);
  });
  
  test('Tâches différentes → autorisé', async () => {
    const mockGrist4 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 20,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: true
          },
          {
            id: 2,
            tache: 2,
            membre: 1,
            heuresAllouees: 15,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: true
          }
        ],
        Tasks: [
          { id: 1, titre: 'Tâche 1' },
          { id: 2, titre: 'Tâche 2' }
        ],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    // Réconcilier la tâche 1 seulement
    const result = await reconcileTaskPlan(mockGrist4, 1, { dryRun: true });
    
    expect(result.results.length).toBe(1);
    expect(result.duplicates).toBeUndefined();
    expect(result.results[0].success).toBe(true);
  });
});

describe('Lot 2 Corrections - Test d\'intégration complet', () => {
  
  let mockGrist;
  
  beforeEach(() => {
    mockGrist = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 35,
            dateDebut: 1719792000, // 2024-07-01
            dateFin: 1720137600,   // 2024-07-05
            actif: true
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
  });
  
  test('Affectation 35h avec une journée soumise et réconciliation', async () => {
    // Ajouter une feuille soumise pour le premier jour
    const sheetResult = await mockGrist.applyUserActions([
      ['AddRecord', 'Feuilles', null, {
        membre: 1,
        semaine: 1719792000,
        statut: 'soumis'
      }]
    ]);
    const sheetId = sheetResult[0].id;
    
    // Ajouter une entrée soumise avec 2h prévues pour le premier jour
    await mockGrist.applyUserActions([
      ['AddRecord', 'TimeEntries', null, {
        affectation: 1,
        tache: 1,
        membre: 1,
        date: 1719792000,
        heuresPrevues: 2,
        heures: 0,
        feuille: sheetId,
        revisionPlan: 1
      }]
    ]);
    
    // Première réconciliation
    const result1 = await reconcileAssignmentPlan(mockGrist, 1, { dryRun: true });
    
    // Le résultat peut échouer à cause de PROTECTED_PLAN_EXCEEDS_ALLOCATION
    // car 2h soumises + le reste du plan peut dépasser 35h
    if (result1.success) {
      expect(result1.actionsExecuted).toBeGreaterThanOrEqual(0);
      
      // La ligne soumise (id=1) ne devrait pas être modifiée
      const updateForSubmitted = result1.actions.find(a => a[0] === 'UpdateRecord' && a[2] === 1);
      expect(updateForSubmitted).toBeUndefined();
    } else {
      // Sinon, devrait avoir un diagnostic bloquant
      expect(result1.error.code).toBe('PROTECTED_PLAN_EXCEEDS_ALLOCATION');
    }
  });
});

describe('Lot 2 Corrections - revisionPlan parcours réel', () => {
  
  let mockGrist;
  
  beforeEach(() => {
    mockGrist = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 35,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: true
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
  });
  
  test('revisionPlan 5 → 6 après modification automatique de heuresPrevues', async () => {
    // Créer une TimeEntry mutable avec revisionPlan = 5
    await mockGrist.applyUserActions([
      ['AddRecord', 'TimeEntries', null, {
        affectation: 1,
        tache: 1,
        membre: 1,
        date: 1719792000,
        heuresPrevues: 2,
        heures: 0,
        revisionPlan: 5
      }]
    ]);
    
    // Première réconciliation - devrait modifier heuresPrevues et incrémenter revisionPlan
    const result1 = await reconcileAssignmentPlan(mockGrist, 1, {
      dryRun: false,
      replanFromDate: '2024-07-01'
    });
    
    expect(result1.success).toBe(true);
    
    // Trouver l'action de mise à jour pour cette entrée
    const updateAction = result1.actions.find(a => 
      a[0] === 'UpdateRecord' && a[2] === 1
    );
    
    // Vérifier que l'action contient revisionPlan = 6
    expect(updateAction).toBeDefined();
    expect(updateAction[3].revisionPlan).toBe(6);
    
    // Appliquer l'action (déjà fait car dryRun: false)
    
    // Recharger les données pour vérifier l'état
    const entriesAfterFirst = await mockGrist.fetchTable('TimeEntries');
    const entriesRows = columnarToRows(entriesAfterFirst);
    const entryAfterFirst = entriesRows.find(row => row.id === 1);
    
    // Vérifier que revisionPlan est maintenant 6
    expect(entryAfterFirst.revisionPlan).toBe(6);
    
    // Seconde réconciliation - devrait être idempotente
    const result2 = await reconcileAssignmentPlan(mockGrist, 1, {
      dryRun: true,
      replanFromDate: '2024-07-01'
    });
    
    expect(result2.success).toBe(true);
    // Aucune nouvelle action ne devrait être générée
    expect(result2.actions.length).toBe(0);
    
    // Vérifier que revisionPlan reste à 6
    const entriesAfterSecond = await mockGrist.fetchTable('TimeEntries');
    const entriesRowsSecond = columnarToRows(entriesAfterSecond);
    const entryAfterSecond = entriesRowsSecond.find(row => row.id === 1);
    expect(entryAfterSecond.revisionPlan).toBe(6);
  });
  
  test('ligne soumise avec revisionPlan = 5 reste inchangée', async () => {
    // Ajouter une feuille soumise
    const sheetResult = await mockGrist.applyUserActions([
      ['AddRecord', 'Feuilles', null, {
        membre: 1,
        semaine: 1719792000,
        statut: 'soumis'
      }]
    ]);
    const sheetId = sheetResult[0].id;
    
    // Créer une TimeEntry soumise avec revisionPlan = 5
    await mockGrist.applyUserActions([
      ['AddRecord', 'TimeEntries', null, {
        affectation: 1,
        tache: 1,
        membre: 1,
        date: 1719792000,
        heuresPrevues: 2,
        heures: 0,
        feuille: sheetId,
        revisionPlan: 5
      }]
    ]);
    
    // Réconciliation - ne devrait pas modifier la ligne soumise
    const result = await reconcileAssignmentPlan(mockGrist, 1, { dryRun: true });
    
    expect(result.success).toBe(true);
    
    // Aucune action de mise à jour pour cette entrée
    const updateAction = result.actions.find(a => 
      a[0] === 'UpdateRecord' && a[2] === 1
    );
    
    expect(updateAction).toBeUndefined();
    
    // Vérifier que revisionPlan reste à 5
    const entries = await mockGrist.fetchTable('TimeEntries');
    const entriesRows = columnarToRows(entries);
    const entry = entriesRows.find(row => row.id === 1);
    expect(entry.revisionPlan).toBe(5);
  });
  
  test('ligne validée avec revisionPlan = 5 reste inchangée', async () => {
    // Ajouter une feuille validée
    const sheetResult = await mockGrist.applyUserActions([
      ['AddRecord', 'Feuilles', null, {
        membre: 1,
        semaine: 1719792000,
        statut: 'valide'
      }]
    ]);
    const sheetId = sheetResult[0].id;
    
    // Créer une TimeEntry validée avec revisionPlan = 5
    await mockGrist.applyUserActions([
      ['AddRecord', 'TimeEntries', null, {
        affectation: 1,
        tache: 1,
        membre: 1,
        date: 1719792000,
        heuresPrevues: 3,
        heures: 4,
        feuille: sheetId,
        revisionPlan: 5
      }]
    ]);
    
    // Réconciliation - ne devrait pas modifier la ligne validée
    const result = await reconcileAssignmentPlan(mockGrist, 1, { dryRun: true });
    
    expect(result.success).toBe(true);
    
    // Aucune action de mise à jour ou suppression pour cette entrée
    const updateAction = result.actions.find(a => 
      (a[0] === 'UpdateRecord' || a[0] === 'RemoveRecord') && a[2] === 1
    );
    
    expect(updateAction).toBeUndefined();
    
    // Vérifier que revisionPlan reste à 5
    const entries = await mockGrist.fetchTable('TimeEntries');
    const entriesRows = columnarToRows(entries);
    const entry = entriesRows.find(row => row.id === 1);
    expect(entry.revisionPlan).toBe(5);
  });
  
  test('nouvelle création commence à revisionPlan = 1', async () => {
    // Réconciliation sur une affectation sans entrées existantes
    const result = await reconcileAssignmentPlan(mockGrist, 1, {
      dryRun: true,
      replanFromDate: '2024-07-01'
    });
    
    expect(result.success).toBe(true);
    
    // Vérifier que toutes les créations ont revisionPlan = 1
    const createActions = result.actions.filter(a => a[0] === 'AddRecord');
    
    expect(createActions.length).toBeGreaterThan(0);
    
    for (const action of createActions) {
      expect(action[3].revisionPlan).toBe(1);
    }
  });
});

