/**
 * Tests pour Member Planning Orchestrator - Version Node.js
 * Vérifie le partage de capacité entre plusieurs affectations
 */

'use strict';

var PlanningEngine = require('../planning-engine.js');
var PlanningReconciliation = require('../reconciliation/planning-reconciliation.js');
var OrchestratorModule = require('./member-planning-orchestrator.js');

var createMemberPlanningOrchestrator = OrchestratorModule.createMemberPlanningOrchestrator;

describe('Member Planning Orchestrator - API publique', function() {
  
  it('Orchestrateur créé avec succès', function() {
    var mockGrist = {
      docApi: {
        fetchTable: function() { return Promise.resolve({ id: [] }); },
        applyUserActions: function() { return Promise.resolve({ retValues: [] }); }
      }
    };
    
    var orchestrator = createMemberPlanningOrchestrator(mockGrist);
    
    expect(orchestrator.previewMember).toBeDefined();
    expect(orchestrator.commitMember).toBeDefined();
    expect(orchestrator.replanMembers).toBeDefined();
    expect(orchestrator.replanTask).toBeDefined();
    expect(orchestrator.replanTasks).toBeDefined();
  });
  
  it('PreviewMember sans affectations retourne NO_ASSIGNMENTS', async function() {
    var mockGrist = {
      docApi: {
        fetchTable: function(table) {
          if (table === 'Team') {
            return Promise.resolve({ id: [1], nom: ['Alice'], capaciteHebdo: [35] });
          }
          return Promise.resolve({ id: [] });
        },
        applyUserActions: function() { return Promise.resolve({ retValues: [] }); }
      }
    };
    
    var orchestrator = createMemberPlanningOrchestrator(mockGrist);
    var result = await orchestrator.previewMember(1);
    
    expect(result.success).toBe(true);
    expect(result.code).toBe('NO_ASSIGNMENTS');
  });
});

describe('Member Planning Orchestrator - Scénarios métier', function() {
  
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
    
    return {
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
          return Promise.resolve({ retValues: actions.map(function() { return 1; }) });
        }
      }
    };
  }
  
  it('Scénario 1: Une affectation de 35h sur 5 jours', async function() {
    var monday = new Date(Date.UTC(2026, 6, 20)).getTime() / 1000;
    var friday = new Date(Date.UTC(2026, 6, 24)).getTime() / 1000;
    
    var mockGrist = createMockGristWithData({
      'Team': [
        { id: 1, nom: 'Alice', capaciteHebdo: 35 }
      ],
      'TaskAssignments': [
        { id: 1, tache: 1, membre: 1, heuresAllouees: 35, dateDebut: monday, dateFin: friday, actif: true }
      ],
      'Tasks': [
        { id: 1, titre: 'Tâche A' }
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
    var result = await orchestrator.previewMember(1);
    
    expect(result.success).toBe(true);
    expect(typeof result.totals.totalAllocatedHours).toBe('number');
    expect(typeof result.totals.totalPlannedHours).toBe('number');
    expect(result.totals.totalAllocatedHours).toBe(35);
    expect(result.totals.totalPlannedHours).toBe(35);
    expect(result.totals.totalUnplannedHours).toBe(0);
    expect(result.canCommit).toBe(true);
  });
  
  it('Scénario 2: Capacité partagée 20h + 15h = 35h', async function() {
    var monday = new Date(Date.UTC(2026, 6, 20)).getTime() / 1000;
    var friday = new Date(Date.UTC(2026, 6, 24)).getTime() / 1000;
    
    var mockGrist = createMockGristWithData({
      'Team': [
        { id: 1, nom: 'Alice', capaciteHebdo: 35 }
      ],
      'TaskAssignments': [
        { id: 1, tache: 1, membre: 1, heuresAllouees: 20, dateDebut: monday, dateFin: friday, actif: true },
        { id: 2, tache: 2, membre: 1, heuresAllouees: 15, dateDebut: monday, dateFin: friday, actif: true }
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
    var result = await orchestrator.previewMember(1);
    
    expect(result.success).toBe(true);
    expect(typeof result.totals.totalAllocatedHours).toBe('number');
    expect(typeof result.totals.totalPlannedHours).toBe('number');
    expect(result.totals.totalAllocatedHours).toBe(35);
    expect(result.totals.totalPlannedHours).toBe(35);
    expect(result.totals.totalUnplannedHours).toBe(0);
    expect(result.canCommit).toBe(true);
  });
  
  it('Scénario 3: Surcharge 30h + 30h = 60h alloués, 35h planifiés', async function() {
    var monday = new Date(Date.UTC(2026, 6, 20)).getTime() / 1000;
    var friday = new Date(Date.UTC(2026, 6, 24)).getTime() / 1000;
    
    var mockGrist = createMockGristWithData({
      'Team': [
        { id: 1, nom: 'Alice', capaciteHebdo: 35 }
      ],
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
    var result = await orchestrator.previewMember(1);
    
    expect(result.success).toBe(true);
    expect(typeof result.totals.totalAllocatedHours).toBe('number');
    expect(typeof result.totals.totalPlannedHours).toBe('number');
    expect(result.totals.totalAllocatedHours).toBe(60);
    expect(result.totals.totalPlannedHours).toBe(35);
    expect(result.totals.totalUnplannedHours).toBe(25);
    expect(result.canCommit).toBe(false);
    expect(result.code).toBe('INSUFFICIENT_SHARED_CAPACITY');
  });
});
