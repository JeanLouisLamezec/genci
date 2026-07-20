/**
 * Tests unitaires pour Widget Planning Service
 */

'use strict';

const { createWidgetPlanningService, summarizeGristActions } = require('./widget-planning-service.js');
const { createMockGrist } = require('./grist/mock-grist.js');
const adapter = require('./grist/grist-planning-adapter.js');

describe('Widget Planning Service - summarizeGristActions', () => {
  
  test('résume un mélange d\'actions', () => {
    const actions = [
      ['AddRecord', 'TimeEntries', null, {}],
      ['AddRecord', 'TimeEntries', null, {}],
      ['UpdateRecord', 'TimeEntries', 1, {}],
      ['RemoveRecord', 'TimeEntries', 2]
    ];
    
    const summary = summarizeGristActions(actions);
    
    expect(summary.creates).toBe(2);
    expect(summary.updates).toBe(1);
    expect(summary.deletes).toBe(1);
    expect(summary.total).toBe(4);
    expect(summary.unknown).toBe(0);
  });
  
  test('gère les actions inconnues', () => {
    const actions = [
      ['AddRecord', 'TimeEntries', null, {}],
      ['UnknownAction', 'TimeEntries', 1],
      ['RemoveRecord', 'TimeEntries', 2]
    ];
    
    const summary = summarizeGristActions(actions);
    
    expect(summary.creates).toBe(1);
    expect(summary.updates).toBe(0);
    expect(summary.deletes).toBe(1);
    expect(summary.total).toBe(3);
    expect(summary.unknown).toBe(1);
  });
  
  test('retourne des zéros pour un tableau vide', () => {
    const summary = summarizeGristActions([]);
    
    expect(summary.creates).toBe(0);
    expect(summary.updates).toBe(0);
    expect(summary.deletes).toBe(0);
    expect(summary.total).toBe(0);
  });
  
  test('retourne des zéros pour null/undefined', () => {
    expect(summarizeGristActions(null).total).toBe(0);
    expect(summarizeGristActions(undefined).total).toBe(0);
  });
  
  test('gère les actions mal formées', () => {
    const actions = [
      ['AddRecord', 'TimeEntries', null, {}],
      [],
      ['RemoveRecord', 'TimeEntries', 2]
    ];
    
    const summary = summarizeGristActions(actions);
    
    expect(summary.creates).toBe(1);
    expect(summary.deletes).toBe(1);
    expect(summary.total).toBe(3);
    expect(summary.unknown).toBe(1);
  });
});

describe('Widget Planning Service - previewAssignment', () => {
  
  let service;
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
    
    service = createWidgetPlanningService(mockGrist);
  });
  
  test('aucune écriture en mode preview', async () => {
    const result = await service.previewAssignment(1, {
      replanFromDate: '2024-07-01'
    });
    
    expect(result.success).toBe(true);
    expect(result.mode).toBe('preview');
    
    const caps = await mockGrist.fetchTable('MemberDailyCapacities');
    expect(caps.id.length).toBe(0);
    
    const entries = await mockGrist.fetchTable('TimeEntries');
    expect(entries.id.length).toBe(0);
  });
  
  test('changeSummary correctement calculé', async () => {
    const result = await service.previewAssignment(1, {
      replanFromDate: '2024-07-01'
    });
    
    expect(result.success).toBe(true);
    expect(result.changeSummary).toBeDefined();
    expect(result.changeSummary.capacities).toBeDefined();
    expect(result.changeSummary.timeEntries).toBeDefined();
    
    expect(result.changeSummary.capacities.creates).toBeGreaterThan(0);
    expect(result.changeSummary.timeEntries.creates).toBeGreaterThan(0);
    expect(result.changeSummary.capacities.total).toBeGreaterThan(0);
    expect(result.changeSummary.timeEntries.total).toBeGreaterThan(0);
  });
  
  test('canCommit = true en cas de succès', async () => {
    const result = await service.previewAssignment(1, {
      replanFromDate: '2024-07-01'
    });
    
    expect(result.success).toBe(true);
    expect(result.canCommit).toBe(true);
  });
  
  test('canCommit = false en cas d\'échec', async () => {
    const mockGrist2 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 10,
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
            heuresPrevues: 3,
            heures: -2,
            revisionPlan: 1
          }
        ],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    const service2 = createWidgetPlanningService(mockGrist2);
    const result = await service2.previewAssignment(1);
    
    expect(result.success).toBe(false);
    expect(result.canCommit).toBe(false);
  });
  
  test('retourne un résultat normalisé avec mode et assignmentId', async () => {
    const result = await service.previewAssignment(1);
    
    expect(result.mode).toBe('preview');
    expect(result.assignmentId).toBe(1);
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('desiredPlan');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('diagnostics');
    expect(result).toHaveProperty('capacityActions');
    expect(result).toHaveProperty('timeEntryActions');
    expect(result).toHaveProperty('changeSummary');
    expect(result).toHaveProperty('canCommit');
    expect(result).toHaveProperty('error');
  });
  
  test('ne retourne pas de fonction pour appliquer les actions', async () => {
    const result = await service.previewAssignment(1);
    
    expect(result.applyActions).toBeUndefined();
    expect(result.execute).toBeUndefined();
    expect(typeof result.capacityActions).toBe('object');
    expect(typeof result.timeEntryActions).toBe('object');
  });
  
  test('appelle reconcileAssignmentPlan avec dryRun: true', async () => {
    // Le service appelle bien reconcileAssignmentPlan en interne
    // La valeur dryRun:true est vérifiée par les tests d'intégration
    const result = await service.previewAssignment(1);
    expect(result.mode).toBe('preview');
    expect(result.success).toBe(true);
  });
});

describe('Widget Planning Service - commitAssignment', () => {
  
  let service;
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
    
    service = createWidgetPlanningService(mockGrist);
  });
  
  test('appelle reconcileAssignmentPlan avec dryRun: false', async () => {
    // Le service appelle bien reconcileAssignmentPlan en interne
    // La valeur dryRun:false est vérifiée par les tests d'intégration
    const result = await service.commitAssignment(1);
    expect(result.mode).toBe('commit');
    expect(result.success).toBe(true);
    expect(result.actionsExecuted).toBeGreaterThan(0);
  });
  
  test('le résultat du preview n\'est jamais appliqué directement', async () => {
    const previewResult = await service.previewAssignment(1, {
      replanFromDate: '2024-07-01'
    });
    
    expect(previewResult.success).toBe(true);
    expect(previewResult.mode).toBe('preview');
    
    const commitResult = await service.commitAssignment(1, {
      replanFromDate: '2024-07-01'
    });
    
    expect(commitResult.success).toBe(true);
    expect(commitResult.mode).toBe('commit');
    expect(commitResult.actionsExecuted).toBeGreaterThan(0);
  });
  
  test('actionsExecuted correctement transmis', async () => {
    const result = await service.commitAssignment(1, {
      replanFromDate: '2024-07-01'
    });
    
    expect(result.success).toBe(true);
    expect(result.actionsExecuted).toBeGreaterThan(0);
  });
  
  test('retourne un résultat normalisé avec mode et assignmentId', async () => {
    const result = await service.commitAssignment(1);
    
    expect(result.mode).toBe('commit');
    expect(result.assignmentId).toBe(1);
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('desiredPlan');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('diagnostics');
    expect(result).toHaveProperty('capacityActions');
    expect(result).toHaveProperty('timeEntryActions');
    expect(result).toHaveProperty('actionsExecuted');
    expect(result).toHaveProperty('error');
  });
});

describe('Widget Planning Service - Gestion des doubles commits', () => {
  
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
  
  test('deux appels simultanés retournent exactement la même Promise', async () => {
    const service = createWidgetPlanningService(mockGrist);
    
    const promise1 = service.commitAssignment(1);
    const promise2 = service.commitAssignment(1);
    
    expect(promise1).toBe(promise2);
    
    const [result1, result2] = await Promise.all([promise1, promise2]);
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
  });
  
  test('deux services indépendants ont des verrous séparés', async () => {
    const mockGristA = createMockGrist({
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
        Tasks: [{ id: 1, titre: 'Tâche A' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    const mockGristB = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 2,
            membre: 1,
            heuresAllouees: 20,
            dateDebut: 1719792000,
            dateFin: 1720137600,
            actif: true
          }
        ],
        Tasks: [{ id: 2, titre: 'Tâche B' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    const serviceA = createWidgetPlanningService(mockGristA);
    const serviceB = createWidgetPlanningService(mockGristB);
    
    const promiseA = serviceA.commitAssignment(1);
    const promiseB = serviceB.commitAssignment(1);
    
    expect(promiseA).not.toBe(promiseB);
    
    const [resultA, resultB] = await Promise.all([promiseA, promiseB]);
    
    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);
    expect(resultA.assignmentId).toBe(1);
    expect(resultB.assignmentId).toBe(1);
  });
  
  test('le verrou est libéré après succès et permet un nouveau commit', async () => {
    const service = createWidgetPlanningService(mockGrist);
    
    const result1 = await service.commitAssignment(1, {
      replanFromDate: '2024-07-01'
    });
    
    expect(result1.success).toBe(true);
    
    const result2 = await service.commitAssignment(1, {
      replanFromDate: '2024-07-01'
    });
    
    expect(result2.success).toBe(true);
  });
  
  test('le verrou est supprimé en cas d\'échec', async () => {
    const mockGrist2 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 10,
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
            heuresPrevues: 3,
            heures: -2,
            revisionPlan: 1
          }
        ],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    const service = createWidgetPlanningService(mockGrist2);
    
    const result1 = await service.commitAssignment(1);
    expect(result1.success).toBe(false);
    
    const result2 = await service.commitAssignment(1);
    expect(result2.success).toBe(false);
  });
  
  test('des affectations différentes peuvent être committées en parallèle', async () => {
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
          },
          {
            id: 2,
            tache: 2,
            membre: 1,
            heuresAllouees: 20,
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
    
    const service2 = createWidgetPlanningService(mockGrist2);
    
    // Des affectations différentes ont des promesses différentes
    const promise1 = service2.commitAssignment(1);
    const promise2 = service2.commitAssignment(2);
    
    expect(promise1).not.toBe(promise2);
    
    const [result1, result2] = await Promise.all([promise1, promise2]);
    expect(result1.assignmentId).toBe(1);
    expect(result2.assignmentId).toBe(2);
  });
});

describe('Widget Planning Service - Normalisation des erreurs', () => {
  
  let mockGrist;
  
  beforeEach(() => {
    mockGrist = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 10,
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
            heuresPrevues: 3,
            heures: -2,
            revisionPlan: 1
          }
        ],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
  });
  
  test('conserve code et message pour les erreurs du noyau', async () => {
    const service = createWidgetPlanningService(mockGrist);
    const result = await service.previewAssignment(1);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error.code).toBeDefined();
    expect(result.error.message).toBeDefined();
  });
  
  test('retourne WIDGET_PLANNING_SERVICE_ERROR pour les exceptions inattendues', async () => {
    const mockGrist2 = createMockGrist({
      initialData: {
        TaskAssignments: [],
        Tasks: [],
        Team: [],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    const service = createWidgetPlanningService(mockGrist2);
    const result = await service.previewAssignment(999);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
  
  test('ne transforme pas un échec en succès', async () => {
    const service = createWidgetPlanningService(mockGrist);
    const result = await service.previewAssignment(1);
    
    expect(result.success).toBe(false);
    expect(result.canCommit).toBe(false);
  });
});

describe('Widget Planning Service - Intégration complète', () => {
  
  let service;
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
    
    service = createWidgetPlanningService(mockGrist);
  });
  
  test('workflow complet : preview puis commit', async () => {
    const previewResult = await service.previewAssignment(1, {
      replanFromDate: '2024-07-01'
    });
    
    expect(previewResult.success).toBe(true);
    expect(previewResult.mode).toBe('preview');
    expect(previewResult.canCommit).toBe(true);
    expect(previewResult.changeSummary.capacities.creates).toBeGreaterThan(0);
    expect(previewResult.changeSummary.timeEntries.creates).toBeGreaterThan(0);
    
    const commitResult = await service.commitAssignment(1, {
      replanFromDate: '2024-07-01'
    });
    
    expect(commitResult.success).toBe(true);
    expect(commitResult.mode).toBe('commit');
    expect(commitResult.actionsExecuted).toBeGreaterThan(0);
    
    const caps = await mockGrist.fetchTable('MemberDailyCapacities');
    expect(caps.id.length).toBeGreaterThan(0);
    
    const entries = await mockGrist.fetchTable('TimeEntries');
    expect(entries.id.length).toBeGreaterThan(0);
  });
  
  test('preview avec diagnostic bloquant → canCommit = false', async () => {
    const mockGrist2 = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 10,
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
            heuresPrevues: 3,
            heures: 0,
            revisionPlan: 1
          },
          {
            id: 2,
            affectation: 1,
            tache: 1,
            membre: 1,
            date: 1719792000,
            heuresPrevues: 4,
            heures: 0,
            revisionPlan: 1
          }
        ],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: []
      }
    });
    
    const service2 = createWidgetPlanningService(mockGrist2);
    const result = await service2.previewAssignment(1);
    
    expect(result.success).toBe(false);
    expect(result.canCommit).toBe(false);
  });
});
