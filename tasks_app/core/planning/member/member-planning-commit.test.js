/**
 * Tests pour le commit de la planification - Member Planning Orchestrator
 * Vérifie la génération des actions Grist et l'idempotence
 */

'use strict';

var OrchestratorModule = require('./member-planning-orchestrator.js');
var createMemberPlanningOrchestrator = OrchestratorModule.createMemberPlanningOrchestrator;

describe('Member Planning Orchestrator - Commit et actions Grist', function() {
  
  function createMockGristWithData(data) {
    var expectedColumns = {
      'Team': ['id', 'nom', 'capaciteHebdo'],
      'TaskAssignments': ['id', 'tache', 'membre', 'heuresAllouees', 'dateDebut', 'dateFin', 'actif', 'modeRepartition'],
      'Tasks': ['id', 'titre', 'dateDebut', 'dateEcheance'],
      'TimeEntries': ['id', 'affectation', 'tache', 'membre', 'date', 'heuresPrevues', 'heures', 'feuille', 'capaciteTheorique', 'capaciteDisponible', 'capaciteJour', 'revisionPlan'],
      'Feuilles': ['id', 'membre', 'semaine', 'statut'],
      'Disponibilites': ['id', 'membre', 'type', 'dateDebut', 'dateFin', 'dispo'],
      'MemberDailyCapacities': ['id', 'membre', 'date', 'capaciteTheorique', 'disponibiliteRatio', 'capaciteDisponible', 'absenceHeures', 'source', 'revision']
    };
    
    var appliedActions = [];
    
    var mockApi = {
      docApi: {
        fetchTable: function(table) {
          var tableData = data[table] || [];
          var columns = expectedColumns[table] || ['id'];
          var result = {};
          
          for (var i = 0; i < columns.length; i++) {
            result[columns[i]] = [];
          }
          
          for (var i = 0; i < tableData.length; i++) {
            for (var j = 0; j < columns.length; j++) {
              var col = columns[j];
              result[col].push(tableData[i][col] !== undefined ? tableData[i][col] : null);
            }
          }
          
          return Promise.resolve(result);
        },
        applyUserActions: function(actions) {
          for (var i = 0; i < actions.length; i++) {
            appliedActions.push(actions[i]);
          }
          return Promise.resolve({ retValues: actions.map(function() { return 1; }) });
        },
        getAppliedActions: function() {
          return appliedActions;
        },
        resetActions: function() {
          appliedActions = [];
        }
      }
    };
    
    return mockApi;
  }
  
  it('Scénario 4: Preview sans écriture', async function() {
    var monday = new Date(Date.UTC(2026, 6, 20)).getTime() / 1000;
    var friday = new Date(Date.UTC(2026, 6, 24)).getTime() / 1000;
    
    var applyCalled = false;
    var mockGrist = createMockGristWithData({
      'Team': [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
      'TaskAssignments': [{ id: 1, tache: 1, membre: 1, heuresAllouees: 35, dateDebut: monday, dateFin: friday, actif: true }],
      'Tasks': [{ id: 1, titre: 'Tâche A' }],
      'TimeEntries': [],
      'Feuilles': [],
      'Disponibilites': [],
      'MemberDailyCapacities': [
        { id: 1, membre: 1, date: monday, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 2, membre: 1, date: monday + 86400, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 3, membre: 1, date: monday + 2 * 86400, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 4, membre: 1, date: monday + 3 * 86400, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 5, membre: 1, date: monday + 4 * 86400, capaciteTheorique: 7, capaciteDisponible: 7 }
      ]
    });
    
    mockGrist.docApi.applyUserActions = function(actions) {
      applyCalled = true;
      throw new Error('applyUserActions should not be called during preview');
    };
    
    var orchestrator = createMemberPlanningOrchestrator(mockGrist);
    var result = await orchestrator.previewMember(1);
    
    expect(applyCalled).toBe(false);
    expect(result.success).toBe(true);
    expect(result.timeEntryActions.length).toBeGreaterThan(0);
  });
  
  it('Scénario 5: Commit réel avec actions Grist', async function() {
    var monday = new Date(Date.UTC(2026, 6, 20)).getTime() / 1000;
    var friday = new Date(Date.UTC(2026, 6, 24)).getTime() / 1000;
    
    var mockGrist = createMockGristWithData({
      'Team': [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
      'TaskAssignments': [{ id: 1, tache: 1, membre: 1, heuresAllouees: 35, dateDebut: monday, dateFin: friday, actif: true }],
      'Tasks': [{ id: 1, titre: 'Tâche A' }],
      'TimeEntries': [],
      'Feuilles': [],
      'Disponibilites': [],
      'MemberDailyCapacities': [
        { id: 1, membre: 1, date: monday, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 2, membre: 1, date: monday + 86400, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 3, membre: 1, date: monday + 2 * 86400, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 4, membre: 1, date: monday + 3 * 86400, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 5, membre: 1, date: monday + 4 * 86400, capaciteTheorique: 7, capaciteDisponible: 7 }
      ]
    });
    
    var orchestrator = createMemberPlanningOrchestrator(mockGrist);
    var preview = await orchestrator.previewMember(1);
    
    expect(preview.success).toBe(true);
    expect(preview.canCommit).toBe(true);
    expect(preview.timeEntryActions.length).toBe(5);
    
    var commitResult = await orchestrator.commitMember(1, preview);
    
    expect(commitResult.success).toBe(true);
    expect(commitResult.totalActionsExecuted).toBe(5);
    
    var appliedActions = mockGrist.docApi.getAppliedActions();
    expect(appliedActions.length).toBe(5);
    
    for (var i = 0; i < appliedActions.length; i++) {
      var action = appliedActions[i];
      expect(action[0]).toBe('AddRecord');
      expect(action[1]).toBe('TimeEntries');
      expect(action[3].heuresPrevues).toBe(7);
      expect(action[3].affectation).toBe(1);
    }
  });
  
  it('Scénario 6: Idempotence - deuxième commit = 0 action', async function() {
    var monday = new Date(Date.UTC(2026, 6, 20)).getTime() / 1000;
    var friday = new Date(Date.UTC(2026, 6, 24)).getTime() / 1000;
    
    // Après un premier commit, les TimeEntries ont capaciteJour renseigné
    var timeEntriesAfterCommit = [
      { id: 1, affectation: 1, tache: 1, membre: 1, date: monday, heuresPrevues: 7, heures: 0, capaciteTheorique: 7, capaciteDisponible: 7, capaciteJour: 1, revisionPlan: 1 },
      { id: 2, affectation: 1, tache: 1, membre: 1, date: monday + 86400, heuresPrevues: 7, heures: 0, capaciteTheorique: 7, capaciteDisponible: 7, capaciteJour: 2, revisionPlan: 1 },
      { id: 3, affectation: 1, tache: 1, membre: 1, date: monday + 2 * 86400, heuresPrevues: 7, heures: 0, capaciteTheorique: 7, capaciteDisponible: 7, capaciteJour: 3, revisionPlan: 1 },
      { id: 4, affectation: 1, tache: 1, membre: 1, date: monday + 3 * 86400, heuresPrevues: 7, heures: 0, capaciteTheorique: 7, capaciteDisponible: 7, capaciteJour: 4, revisionPlan: 1 },
      { id: 5, affectation: 1, tache: 1, membre: 1, date: monday + 4 * 86400, heuresPrevues: 7, heures: 0, capaciteTheorique: 7, capaciteDisponible: 7, capaciteJour: 5, revisionPlan: 1 }
    ];
    
    var mockGrist = createMockGristWithData({
      'Team': [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
      'TaskAssignments': [{ id: 1, tache: 1, membre: 1, heuresAllouees: 35, dateDebut: monday, dateFin: friday, actif: true }],
      'Tasks': [{ id: 1, titre: 'Tâche A' }],
      'TimeEntries': timeEntriesAfterCommit,
      'Feuilles': [],
      'Disponibilites': [],
      'MemberDailyCapacities': [
        { id: 1, membre: 1, date: monday, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 2, membre: 1, date: monday + 86400, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 3, membre: 1, date: monday + 2 * 86400, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 4, membre: 1, date: monday + 3 * 86400, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 5, membre: 1, date: monday + 4 * 86400, capaciteTheorique: 7, capaciteDisponible: 7 }
      ]
    });
    
    var orchestrator = createMemberPlanningOrchestrator(mockGrist);
    var preview = await orchestrator.previewMember(1);
    
    expect(preview.success).toBe(true);
    expect(preview.reconciliation.creates.length).toBe(0);
    expect(preview.reconciliation.updates.length).toBe(0);
    expect(preview.reconciliation.deletes.length).toBe(0);
    expect(preview.timeEntryActions.length).toBe(0);
    
    var commitResult = await orchestrator.commitMember(1, preview);
    
    expect(commitResult.success).toBe(true);
    expect(commitResult.totalActionsExecuted).toBe(0);
  });
  
  it('Scénario 7: Entrée protégée - feuille soumise de 4h le lundi', async function() {
    var monday = new Date(Date.UTC(2026, 6, 20)).getTime() / 1000;
    var friday = new Date(Date.UTC(2026, 6, 24)).getTime() / 1000;
    
    var mockGrist = createMockGristWithData({
      'Team': [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
      'TaskAssignments': [{ id: 1, tache: 1, membre: 1, heuresAllouees: 35, dateDebut: monday, dateFin: friday, actif: true }],
      'Tasks': [{ id: 1, titre: 'Tâche A' }],
      'TimeEntries': [
        { id: 1, affectation: 1, tache: 1, membre: 1, date: monday, heuresPrevues: 4, heures: 0, feuille: 1 }
      ],
      'Feuilles': [
        { id: 1, membre: 1, semaine: '2026-W29', statut: 'soumis' }
      ],
      'Disponibilites': [],
      'MemberDailyCapacities': [
        { id: 1, membre: 1, date: monday, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 2, membre: 1, date: monday + 86400, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 3, membre: 1, date: monday + 2 * 86400, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 4, membre: 1, date: monday + 3 * 86400, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 5, membre: 1, date: monday + 4 * 86400, capaciteTheorique: 7, capaciteDisponible: 7 }
      ]
    });
    
    var orchestrator = createMemberPlanningOrchestrator(mockGrist);
    var preview = await orchestrator.previewMember(1);
    
    expect(preview.success).toBe(true);
    expect(preview.totals.protectedHours).toBe(4);
    
    var mondayEntry = preview.capacities.find(function(c) { return c.date === '2026-07-20'; });
    expect(mondayEntry.protectedHours).toBe(4);
    expect(mondayEntry.remainingCapacityHours).toBeLessThanOrEqual(3);
    
    var totalPlanned = preview.totals.totalPlannedHours;
    expect(totalPlanned).toBeLessThanOrEqual(31);
    
    var mondayPlan = preview.reconciliation.creates.find(function(c) { return c.date === '2026-07-20'; });
    expect(mondayPlan).toBeUndefined();
  });
  
  it('Scénario 8: Refus du commit quand canCommit=false', async function() {
    var monday = new Date(Date.UTC(2026, 6, 20)).getTime() / 1000;
    var friday = new Date(Date.UTC(2026, 6, 24)).getTime() / 1000;
    
    var mockGrist = createMockGristWithData({
      'Team': [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
      'TaskAssignments': [
        { id: 1, tache: 1, membre: 1, heuresAllouees: 30, dateDebut: monday, dateFin: friday, actif: true },
        { id: 2, tache: 2, membre: 1, heuresAllouees: 30, dateDebut: monday, dateFin: friday, actif: true }
      ],
      'Tasks': [
        { id: 1, titre: 'Tâche A' },
        { id: 2, titre: 'Tâche B' }
      ],
      'TimeEntries': [],
      'Feuilles': [],
      'Disponibilites': [],
      'MemberDailyCapacities': [
        { id: 1, membre: 1, date: monday, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 2, membre: 1, date: monday + 86400, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 3, membre: 1, date: monday + 2 * 86400, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 4, membre: 1, date: monday + 3 * 86400, capaciteTheorique: 7, capaciteDisponible: 7 },
        { id: 5, membre: 1, date: monday + 4 * 86400, capaciteTheorique: 7, capaciteDisponible: 7 }
      ]
    });
    
    var orchestrator = createMemberPlanningOrchestrator(mockGrist);
    var preview = await orchestrator.previewMember(1);
    
    expect(preview.success).toBe(true);
    expect(preview.canCommit).toBe(false);
    expect(preview.code).toBe('INSUFFICIENT_SHARED_CAPACITY');
    
    var commitResult = await orchestrator.commitMember(1, preview);
    
    expect(commitResult.success).toBe(false);
    expect(commitResult.code).toBe('INSUFFICIENT_SHARED_CAPACITY');
  });
});
