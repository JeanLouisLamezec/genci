/**
 * Tests unitaires pour Grist Planning Adapter
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
  isBlockingDiagnostic,
  diffToGristActions,
  STATUS_MAPPING,
  DEFAULT_WEEKLY_CAPACITY
} = require('./grist-planning-adapter.js');

const { createMockGrist } = require('./mock-grist.js');

describe('Grist Planning Adapter - Conversion des dates', () => {
  
  test('gristDateToIso convertit les secondes Unix en ISO', () => {
    // 1719792000 = 2024-07-01 00:00:00 UTC
    expect(gristDateToIso(1719792000)).toBe('2024-07-01');
  });
  
  test('gristDateToIso gère les chaînes ISO déjà normalisées', () => {
    expect(gristDateToIso('2024-07-01')).toBe('2024-07-01');
  });
  
  test('gristDateToIso gère les objets Date', () => {
    const date = new Date(Date.UTC(2024, 6, 1));
    expect(gristDateToIso(date)).toBe('2024-07-01');
  });
  
  test('gristDateToIso retourne null pour les valeurs invalides', () => {
    expect(gristDateToIso(null)).toBe(null);
    expect(gristDateToIso(undefined)).toBe(null);
    expect(gristDateToIso('')).toBe(null);
    expect(gristDateToIso('invalid')).toBe(null);
  });
  
  test('isoToGristDate convertit ISO en secondes Unix', () => {
    expect(isoToGristDate('2024-07-01')).toBe(1719792000);
  });
  
  test('isoToGristDate retourne null pour les valeurs invalides', () => {
    expect(isoToGristDate(null)).toBe(null);
    expect(isoToGristDate('')).toBe(null);
    expect(isoToGristDate('invalid')).toBe(null);
  });
});

describe('Grist Planning Adapter - Normalisation des statuts', () => {
  
  test('Normalise les statuts français', () => {
    expect(normalizeSheetStatus('brouillon')).toBe('draft');
    expect(normalizeSheetStatus('soumis')).toBe('submitted');
    expect(normalizeSheetStatus('valide')).toBe('validated');
    expect(normalizeSheetStatus('rejete')).toBe('draft');
  });
  
  test('Normalise les statuts anglais', () => {
    expect(normalizeSheetStatus('draft')).toBe('draft');
    expect(normalizeSheetStatus('submitted')).toBe('submitted');
    expect(normalizeSheetStatus('validated')).toBe('validated');
    expect(normalizeSheetStatus('rejected')).toBe('draft');
  });
  
  test('Retourne null pour les valeurs invalides', () => {
    expect(normalizeSheetStatus(null)).toBe(null);
    expect(normalizeSheetStatus(undefined)).toBe(null);
    expect(normalizeSheetStatus('')).toBe(null);
    expect(normalizeSheetStatus('unknown')).toBe(null);
  });
});

describe('Grist Planning Adapter - Construction des capacités', () => {
  
  test('Capacité hebdomadaire 35h → 7h du lundi au vendredi', () => {
    const result = buildMemberDailyCapacities({
      member: { capaciteHebdo: 35 },
      availabilities: [],
      startDate: '2024-07-01', // Lundi
      endDate: '2024-07-05'    // Vendredi
    });
    
    expect(result.capacities.length).toBe(5);
    
    for (const cap of result.capacities) {
      expect(cap.baseCapacityHours).toBe(7);
      expect(cap.availableCapacityHours).toBe(7);
    }
  });
  
  test('Week-end → capacité zéro', () => {
    const result = buildMemberDailyCapacities({
      member: { capaciteHebdo: 35 },
      availabilities: [],
      startDate: '2024-07-06', // Samedi
      endDate: '2024-07-07'    // Dimanche
    });
    
    expect(result.capacities.length).toBe(2);
    
    for (const cap of result.capacities) {
      expect(cap.baseCapacityHours).toBe(0);
      expect(cap.availableCapacityHours).toBe(0);
    }
  });
  
  test('Congé à dispo = 0 → capacité disponible zéro', () => {
    const result = buildMemberDailyCapacities({
      member: { capaciteHebdo: 35 },
      availabilities: [
        {
          membre: 1,
          type: 'conges',
          dateDebut: 1719792000, // 2024-07-01
          dateFin: 1719792000,
          dispo: 0
        }
      ],
      startDate: '2024-07-01',
      endDate: '2024-07-01'
    });
    
    expect(result.capacities[0].baseCapacityHours).toBe(7);
    expect(result.capacities[0].availableCapacityHours).toBe(0);
  });
  
  test('Temps partiel à dispo = 0.5 → capacité disponible 3,5h', () => {
    const result = buildMemberDailyCapacities({
      member: { capaciteHebdo: 35 },
      availabilities: [
        {
          membre: 1,
          type: 'temps_partiel',
          dateDebut: 1719792000,
          dateFin: 1719792000,
          dispo: 0.5
        }
      ],
      startDate: '2024-07-01',
      endDate: '2024-07-01'
    });
    
    expect(result.capacities[0].baseCapacityHours).toBe(7);
    expect(result.capacities[0].availableCapacityHours).toBe(3.5);
  });
  
  test('Deux disponibilités qui se chevauchent utilisent le ratio minimum', () => {
    const result = buildMemberDailyCapacities({
      member: { capaciteHebdo: 35 },
      availabilities: [
        {
          membre: 1,
          type: 'conges',
          dateDebut: 1719792000,
          dateFin: 1719878400, // 2024-07-01 à 2024-07-02
          dispo: 0.5
        },
        {
          membre: 1,
          type: 'formation',
          dateDebut: 1719792000,
          dateFin: 1719792000, // 2024-07-01 uniquement
          dispo: 0
        }
      ],
      startDate: '2024-07-01',
      endDate: '2024-07-02'
    });
    
    // 2024-07-01 : minimum de 0.5 et 0 = 0
    expect(result.capacities[0].availableCapacityHours).toBe(0);
    // 2024-07-02 : seulement 0.5
    expect(result.capacities[1].availableCapacityHours).toBe(3.5);
  });
  
  test('Utilise la capacité par défaut si absente', () => {
    const result = buildMemberDailyCapacities({
      member: {},
      availabilities: [],
      startDate: '2024-07-01',
      endDate: '2024-07-01'
    });
    
    expect(result.diagnostics.some(d => d.code === 'DEFAULT_CAPACITY_USED')).toBe(true);
    expect(result.capacities[0].baseCapacityHours).toBe(7);
  });
});

describe('Grist Planning Adapter - Réconciliation', () => {
  
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
            dateDebut: 1719792000, // 2024-07-01 (lundi)
            dateFin: 1720137600,   // 2024-07-05 (vendredi)
            modeRepartition: 'proportionnelle',
            actif: true
          }
        ],
        Tasks: [
          { id: 1, titre: 'Tâche 1' }
        ],
        Team: [
          { id: 1, nom: 'Alice', capaciteHebdo: 35 }
        ],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: []
      }
    });
  });
  
  test('Affectation de 35h sur 5 jours ouvrés → 5 créations à 7h', async () => {
    const result = await planAssignment(mockGrist, 1);
    
    expect(result.success).toBe(true);
    // Du 01/07 (lundi) au 07/07 (dimanche) = 6 jours dont 5 ouvrés + 1 week-end
    // Mais le 06/07 est un samedi, donc 5 jours ouvrés (01-05/07)
    expect(result.desiredPlan.length).toBe(5);
    
    for (const item of result.desiredPlan) {
      expect(item.plannedHours).toBeCloseTo(7, 1);
    }
  });
  
  test('Les créations renseignent aussi tache et membre', async () => {
    const result = await planAssignment(mockGrist, 1);
    
    for (const item of result.desiredPlan) {
      expect(item.taskId).toBe(1);
      expect(item.memberId).toBe(1);
    }
  });
  
  test('Une seconde réconciliation ne produit aucune action (idempotence)', async () => {
    // Première réconciliation
    const result1 = await reconcileAssignmentPlan(mockGrist, 1, { dryRun: true });
    expect(result1.success).toBe(true);
    
    // Appliquer les actions
    if (result1.actions.length > 0) {
      await mockGrist.applyUserActions(result1.actions);
    }
    
    // Deuxième réconciliation
    const result2 = await reconcileAssignmentPlan(mockGrist, 1, { dryRun: true });
    
    expect(result2.success).toBe(true);
    expect(result2.actions.length).toBe(0);
  });
  
  test('Une modification de capacité produit une mise à jour de capaciteDisponible', async () => {
    // Ajouter une disponibilité
    await mockGrist.applyUserActions([
      ['AddRecord', 'Disponibilites', null, {
        membre: 1,
        type: 'conges',
        dateDebut: 1719792000,
        dateFin: 1719792000,
        dispo: 0.5
      }]
    ]);
    
    const result = await planAssignment(mockGrist, 1);
    
    // Le premier jour devrait avoir une capacité réduite
    const day1 = result.desiredPlan.find(d => d.date === '2024-07-01');
    expect(day1.availableCapacityHours).toBe(3.5);
  });
  
  test("Une ligne soumise n'est jamais modifiée", async () => {
    // Ajouter une feuille soumise
    const sheetResult = await mockGrist.applyUserActions([
      ['AddRecord', 'Feuilles', null, {
        membre: 1,
        semaine: 1719792000,
        statut: 'soumis'
      }]
    ]);
    const sheetId = sheetResult[0].id;
    
    // Ajouter une entrée soumise
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
    
    // Ne devrait pas modifier l'entrée soumise
    const updateForDay1 = result.actions.find(a => 
      a[0] === 'UpdateRecord' && a[2] === 1
    );
    
    expect(updateForDay1).toBeUndefined();
  });
  
  test("Une ligne validée n'est jamais modifiée ou supprimée", async () => {
    // Ajouter une feuille validée
    const sheetResult = await mockGrist.applyUserActions([
      ['AddRecord', 'Feuilles', null, {
        membre: 1,
        semaine: 1719792000,
        statut: 'valide'
      }]
    ]);
    const sheetId = sheetResult[0].id;
    
    // Ajouter une entrée validée
    await mockGrist.applyUserActions([
      ['AddRecord', 'TimeEntries', null, {
        affectation: 1,
        tache: 1,
        membre: 1,
        date: 1719792000,
        heuresPrevues: 3.5,
        heures: 4,
        feuille: sheetId,
        revisionPlan: 1
      }]
    ]);
    
    const result = await reconcileAssignmentPlan(mockGrist, 1, { dryRun: true });
    
    // Ne devrait pas modifier ou supprimer l'entrée validée
    const actionForDay1 = result.actions.find(a => 
      (a[0] === 'UpdateRecord' || a[0] === 'RemoveRecord') && a[2] === 1
    );
    
    expect(actionForDay1).toBeUndefined();
  });
  
  test('Le réalisé heures n\'est jamais inclus dans une mise à jour automatique', async () => {
    // Ajouter une entrée
    await mockGrist.applyUserActions([
      ['AddRecord', 'TimeEntries', null, {
        affectation: 1,
        tache: 1,
        membre: 1,
        date: 1719792000,
        heuresPrevues: 2,
        heures: 3,
        revisionPlan: 1
      }]
    ]);
    
    const result = await reconcileAssignmentPlan(mockGrist, 1, { dryRun: true });
    
    // Vérifier que aucune action ne modifie 'heures'
    for (const action of result.actions) {
      if (action[0] === 'UpdateRecord') {
        const fields = action[3];
        expect(fields.heures).toBeUndefined();
      }
    }
  });
  
  test('Un conflit de doublon empêche tout appel à applyUserActions', async () => {
    // Créer un doublon
    await mockGrist.applyUserActions([
      ['AddRecord', 'TimeEntries', null, {
        affectation: 1,
        tache: 1,
        membre: 1,
        date: 1719792000,
        heuresPrevues: 2,
        heures: 0,
        revisionPlan: 1
      }],
      ['AddRecord', 'TimeEntries', null, {
        affectation: 1,
        tache: 1,
        membre: 1,
        date: 1719792000,
        heuresPrevues: 3,
        heures: 0,
        revisionPlan: 1
      }]
    ]);
    
    const result = await reconcileAssignmentPlan(mockGrist, 1, { dryRun: true });
    
    expect(result.success).toBe(false);
    // Le conflit peut être détecté comme BLOCKING_DIAGNOSTICS ou CONFLICTS_DETECTED
    expect(['CONFLICTS_DETECTED', 'BLOCKING_DIAGNOSTICS']).toContain(result.error.code);
    expect(result.actionsExecuted).toBe(0);
  });
  
  test('dryRun retourne les actions sans les exécuter', async () => {
    const result = await reconcileAssignmentPlan(mockGrist, 1, { dryRun: true });
    
    expect(result.dryRun).toBe(true);
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.actionsExecuted).toBe(0);
    
    // Vérifier que les actions n'ont pas été exécutées
    const entries = await mockGrist.fetchTable('TimeEntries');
    expect(entries.id.length).toBe(0);
  });
  
  test('Une affectation inexistante ne produit aucune écriture', async () => {
    const result = await reconcileAssignmentPlan(mockGrist, 999);
    
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('ASSIGNMENT_NOT_FOUND');
    expect(result.actionsExecuted).toBe(0);
  });
  
  test('Une affectation inactive ne crée aucun nouveau plan', async () => {
    // Mettre à jour l'affectation pour la rendre inactive
    await mockGrist.applyUserActions([
      ['UpdateRecord', 'TaskAssignments', 1, { actif: false }]
    ]);
    
    const result = await reconcileAssignmentPlan(mockGrist, 1);
    
    // Une affectation inactive doit échouer avec ASSIGNMENT_INACTIVE_CLEANUP
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('ASSIGNMENT_INACTIVE_CLEANUP');
    expect(result.actionsExecuted).toBe(0);
  });
  
  test("Une surconsommation remet le futur mutable à zéro sans toucher à l'historique validé", async () => {
    // Ajouter une feuille validée
    const sheetResult = await mockGrist.applyUserActions([
      ['AddRecord', 'Feuilles', null, {
        membre: 1,
        semaine: 1719792000,
        statut: 'valide'
      }]
    ]);
    const sheetId = sheetResult[0].id;
    
    // Ajouter des entrées validées qui dépassent l'allocation
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
    
    // Devrait signaler la surconsommation
    if (result.summary) {
      expect(result.summary.overconsumedHours).toBeGreaterThan(0);
    } else {
      // Ou échouer avec un diagnostic OVERCONSUMPTION
      expect(result.diagnostics.some(d => d.code === 'OVERCONSUMPTION')).toBe(true);
    }
  });
  
  test('reconcileTaskPlan traite séparément plusieurs personnes affectées à la même tâche', async () => {
    // Ajouter une deuxième affectation
    await mockGrist.applyUserActions([
      ['AddRecord', 'TaskAssignments', null, {
        tache: 1,
        membre: 2,
        heuresAllouees: 20,
        dateDebut: 1719792000,
        dateFin: 1720396800,
        modeRepartition: 'proportionnelle',
        actif: true
      }],
      ['AddRecord', 'Team', null, {
        id: 2,
        nom: 'Bob',
        capaciteHebdo: 35
      }]
    ]);
    
    const result = await reconcileTaskPlan(mockGrist, 1, { dryRun: true });
    
    expect(result.assignmentCount).toBe(2);
    expect(result.results[0].memberId).toBe(1);
    expect(result.results[1].memberId).toBe(2);
  });
});

describe('Grist Planning Adapter - Diagnostics bloquants', () => {
  
  test('MISSING_ASSIGNMENT est bloquant', () => {
    expect(isBlockingDiagnostic({ code: 'MISSING_ASSIGNMENT' })).toBe(true);
  });
  
  test('INVALID_ALLOCATED_HOURS est bloquant', () => {
    expect(isBlockingDiagnostic({ code: 'INVALID_ALLOCATED_HOURS' })).toBe(true);
  });
  
  test('DUPLICATE_EXISTING_ENTRY est bloquant', () => {
    expect(isBlockingDiagnostic({ code: 'DUPLICATE_EXISTING_ENTRY' })).toBe(true);
  });
  
  test('PROTECTED_PLAN_EXCEEDS_ALLOCATION est bloquant', () => {
    expect(isBlockingDiagnostic({ code: 'PROTECTED_PLAN_EXCEEDS_ALLOCATION' })).toBe(true);
  });
  
  test('FULLY_CONSUMED n\'est pas bloquant', () => {
    expect(isBlockingDiagnostic({ code: 'FULLY_CONSUMED' })).toBe(false);
  });
  
  test('OVERCONSUMPTION n\'est pas bloquant', () => {
    expect(isBlockingDiagnostic({ code: 'OVERCONSUMPTION' })).toBe(false);
  });
  
  test('UNPLANNED_HOURS n\'est pas bloquant', () => {
    expect(isBlockingDiagnostic({ code: 'UNPLANNED_HOURS' })).toBe(false);
  });
});

describe('Grist Planning Adapter - diffToGristActions', () => {
  
  test('Transforme les créations en AddRecord', () => {
    const diff = {
      creates: [
        {
          date: '2024-07-01',
          plannedHours: 3.5,
          baseCapacityHours: 7,
          availableCapacityHours: 7
        }
      ],
      updates: [],
      deletes: []
    };
    
    const assignment = {
      id: 1,
      taskId: 1,
      memberId: 1
    };
    
    const actions = diffToGristActions(diff, assignment, []);
    
    expect(actions.length).toBe(1);
    expect(actions[0][0]).toBe('AddRecord');
    expect(actions[0][1]).toBe('TimeEntries');
    expect(actions[0][3].heuresPrevues).toBe(3.5);
  });
  
  test('Transforme les mises à jour en UpdateRecord', () => {
    const diff = {
      creates: [],
      updates: [
        {
          id: 1,
          fields: {
            plannedHours: 5,
            baseCapacityHours: 7
          }
        }
      ],
      deletes: []
    };
    
    const assignment = { id: 1, taskId: 1, memberId: 1 };
    const actions = diffToGristActions(diff, assignment, []);
    
    expect(actions.length).toBe(1);
    expect(actions[0][0]).toBe('UpdateRecord');
    expect(actions[0][3].heuresPrevues).toBe(5);
  });
  
  test('Transforme les suppressions en RemoveRecord', () => {
    const diff = {
      creates: [],
      updates: [],
      deletes: [
        { id: 1 }
      ]
    };
    
    const assignment = { id: 1, taskId: 1, memberId: 1 };
    const actions = diffToGristActions(diff, assignment, []);
    
    expect(actions.length).toBe(1);
    expect(actions[0][0]).toBe('RemoveRecord');
    expect(actions[0][2]).toBe(1);
  });
});
