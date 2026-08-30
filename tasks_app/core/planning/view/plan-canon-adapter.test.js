/**
 * Tests unitaires pour Plan Canon Adapter
 * 
 * Tests de l'adaptateur entre données canoniques et widget Plan :
 * - Chargement et normalisation des données Grist
 * - Calcul des capacités (remplacement de capPeriod/indispoFrac)
 * - Formatage de la matrice pour le rendu
 * - Détail des cellules (tasksInCell)
 */

'use strict';

var assert = require('assert');

// Charger les modules (compatible Node.js)
var PlanPeriodAggregation = require('./plan-period-aggregation.js');
var PlanCanonAdapter = require('./plan-canon-adapter.js');

var getCapacityForRow = PlanCanonAdapter.getCapacityForRow;
var isRowCapacityReduced = PlanCanonAdapter.isRowCapacityReduced;
var getTeamCapacity = PlanCanonAdapter.getTeamCapacity;
var getCapacityForMemberPeriod = PlanCanonAdapter.getCapacityForMemberPeriod;
var calculateMemberAvailability = PlanCanonAdapter.calculateMemberAvailability;

// ============================================================================
// TESTS DE CAPACITÉ (remplacement de capPeriod/indispoFrac)
// ============================================================================

describe('PlanCanonAdapter - Capacité', function() {
  
  describe('getCapacityForMemberPeriod', function() {
    it('doit calculer la capacité sur une semaine', function() {
      var dailyCapacities = [
        { membre: 1, date: '2024-01-08', capaciteDisponible: 7 },
        { membre: 1, date: '2024-01-09', capaciteDisponible: 7 },
        { membre: 1, date: '2024-01-10', capaciteDisponible: 7 },
        { membre: 1, date: '2024-01-11', capaciteDisponible: 7 },
        { membre: 1, date: '2024-01-12', capaciteDisponible: 7 }
      ];
      
      var capacity = getCapacityForMemberPeriod(1, '2024-W02', 'week', dailyCapacities);
      
      // 5 jours * 7h = 35h
      assert.strictEqual(capacity, 35);
    });
    
    it('doit calculer la capacité sur un mois', function() {
      var dailyCapacities = [];
      // Janvier 2024 : 31 jours, 23 jours ouvrés
      for (var day = 1; day <= 31; day++) {
        var date = new Date(Date.UTC(2024, 0, day));
        var dayOfWeek = date.getUTCDay();
        // Seulement lundi-vendredi
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          dailyCapacities.push({
            membre: 1,
            date: '2024-01-' + String(day).padStart(2, '0'),
            capaciteDisponible: 7
          });
        }
      }
      
      var capacity = getCapacityForMemberPeriod(1, '2024-01', 'month', dailyCapacities);
      
      // 23 jours ouvrés * 7h = 161h
      assert.strictEqual(capacity, 161);
    });
    
    it('doit gérer les absences partielles', function() {
      var dailyCapacities = [
        { membre: 1, date: '2024-01-08', capaciteDisponible: 7 },
        { membre: 1, date: '2024-01-09', capaciteDisponible: 3.5 }, // 50%
        { membre: 1, date: '2024-01-10', capaciteDisponible: 7 },
        { membre: 1, date: '2024-01-11', capaciteDisponible: 7 },
        { membre: 1, date: '2024-01-12', capaciteDisponible: 7 }
      ];
      
      var capacity = getCapacityForMemberPeriod(1, '2024-W02', 'week', dailyCapacities);
      
      // 7 + 3.5 + 7 + 7 + 7 = 31.5h
      assert.strictEqual(capacity, 31.5);
    });
    
    it('doit gérer les absences totales', function() {
      var dailyCapacities = [
        { membre: 1, date: '2024-01-08', capaciteDisponible: 0 },
        { membre: 1, date: '2024-01-09', capaciteDisponible: 0 },
        { membre: 1, date: '2024-01-10', capaciteDisponible: 7 },
        { membre: 1, date: '2024-01-11', capaciteDisponible: 7 },
        { membre: 1, date: '2024-01-12', capaciteDisponible: 7 }
      ];
      
      var capacity = getCapacityForMemberPeriod(1, '2024-W02', 'week', dailyCapacities);
      
      // 0 + 0 + 7 + 7 + 7 = 21h
      assert.strictEqual(capacity, 21);
    });
  });
  
  describe('getCapacityForRow', function() {
    it('doit calculer la capacité pour une ligne avec plusieurs membres', function() {
      var row = {
        members: [
          { id: 1 },
          { id: 2 }
        ]
      };
      
      var dailyCapacities = [
        { membre: 1, date: '2024-01-08', capaciteDisponible: 7 },
        { membre: 1, date: '2024-01-09', capaciteDisponible: 7 },
        { membre: 2, date: '2024-01-08', capaciteDisponible: 5 },
        { membre: 2, date: '2024-01-09', capaciteDisponible: 5 }
      ];
      
      var capacity = getCapacityForRow(row, '2024-W02', 'week', dailyCapacities);
      
      // Membre 1: 14h, Membre 2: 10h = 24h
      assert.strictEqual(capacity, 24);
    });
    
    it('doit retourner 0 pour une ligne sans membres', function() {
      var row = { members: [] };
      var dailyCapacities = [];
      
      var capacity = getCapacityForRow(row, '2024-W02', 'week', dailyCapacities);
      
      assert.strictEqual(capacity, 0);
    });
  });
  
  describe('isRowCapacityReduced', function() {
    it('doit détecter une capacité réduite (absence > 0)', function() {
      var row = {
        members: [{ id: 1 }]
      };
      
      var dailyCapacities = [
        { membre: 1, date: '2024-01-08', capaciteDisponible: 7, absenceHeures: 0 },
        { membre: 1, date: '2024-01-09', capaciteDisponible: 3.5, absenceHeures: 3.5 }
      ];
      
      var reduced = isRowCapacityReduced(row, '2024-W02', 'week', dailyCapacities);
      
      assert.strictEqual(reduced, true);
    });
    
    it('doit détecter une capacité réduite (ratio < 1)', function() {
      var row = {
        members: [{ id: 1 }]
      };
      
      var dailyCapacities = [
        { membre: 1, date: '2024-01-08', capaciteDisponible: 7, disponibiliteRatio: 0.5 }
      ];
      
      var reduced = isRowCapacityReduced(row, '2024-W02', 'week', dailyCapacities);
      
      assert.strictEqual(reduced, true);
    });
    
    it('doit retourner false si capacité normale', function() {
      var row = {
        members: [{ id: 1 }]
      };
      
      var dailyCapacities = [
        { membre: 1, date: '2024-01-08', capaciteDisponible: 7, absenceHeures: 0, disponibiliteRatio: 1 }
      ];
      
      var reduced = isRowCapacityReduced(row, '2024-W02', 'week', dailyCapacities);
      
      assert.strictEqual(reduced, false);
    });
  });
  
  describe('getTeamCapacity', function() {
    it('doit calculer la capacité totale de l\'équipe', function() {
      var team = [
        { id: 1, actif: true },
        { id: 2, actif: true },
        { id: 3, actif: false } // Inactif
      ];
      
      var dailyCapacities = [
        { membre: 1, date: '2024-01-08', capaciteDisponible: 7 },
        { membre: 2, date: '2024-01-08', capaciteDisponible: 5 },
        { membre: 3, date: '2024-01-08', capaciteDisponible: 7 } // Ne compte pas (inactif)
      ];
      
      var capacity = getTeamCapacity(team, '2024-W02', 'week', dailyCapacities);
      
      // Seulement membres 1 et 2 : 7 + 5 = 12h (pour 1 jour dans cet exemple)
      assert.strictEqual(capacity, 12);
    });
  });
  
  describe('calculateMemberAvailability', function() {
    it('doit calculer load, cap, free pour chaque membre', function() {
      var team = [
        { id: 1, actif: true },
        { id: 2, actif: true }
      ];
      
      var canonIndex = {
        byMemberPeriod: {
          '1:2024-W02': { plannedHours: 10 },
          '2:2024-W02': { plannedHours: 5 }
        }
      };
      
      var dailyCapacities = [
        { membre: 1, date: '2024-01-08', capaciteDisponible: 7 },
        { membre: 1, date: '2024-01-09', capaciteDisponible: 7 },
        { membre: 2, date: '2024-01-08', capaciteDisponible: 7 },
        { membre: 2, date: '2024-01-09', capaciteDisponible: 7 }
      ];
      
      var availability = calculateMemberAvailability(team, '2024-W02', 'week', canonIndex, dailyCapacities);
      
      assert.strictEqual(availability[1].load, 10);
      assert.strictEqual(availability[1].cap, 14);
      assert.strictEqual(availability[1].free, 4);
      
      assert.strictEqual(availability[2].load, 5);
      assert.strictEqual(availability[2].cap, 14);
      assert.strictEqual(availability[2].free, 9);
    });
  });
});

// ============================================================================
// TESTS D'INTÉGRATION
// ============================================================================

describe('PlanCanonAdapter - Intégration', function() {
  
  describe('Cohérence capacité row vs team', function() {
    it('La somme des capacités des rows doit égaler la capacité team', function() {
      var team = [
        { id: 1, actif: true },
        { id: 2, actif: true }
      ];
      
      var rows = [
        { members: [{ id: 1 }] },
        { members: [{ id: 2 }] }
      ];
      
      var dailyCapacities = [
        { membre: 1, date: '2024-01-08', capaciteDisponible: 7 },
        { membre: 1, date: '2024-01-09', capaciteDisponible: 7 },
        { membre: 2, date: '2024-01-08', capaciteDisponible: 5 },
        { membre: 2, date: '2024-01-09', capaciteDisponible: 5 }
      ];
      
      var row1Cap = getCapacityForRow(rows[0], '2024-W02', 'week', dailyCapacities);
      var row2Cap = getCapacityForRow(rows[1], '2024-W02', 'week', dailyCapacities);
      var teamCap = getTeamCapacity(team, '2024-W02', 'week', dailyCapacities);
      
      // row1 + row2 = team
      assert.strictEqual(row1Cap + row2Cap, teamCap);
    });
  });
  
  describe('Comparaison ancien vs nouveau calcul', function() {
    it('Ne doit pas utiliser capPeriod (approximation mensuelle)', function() {
      // Ancien calcul : capPeriod(35) = 35 * 52 / 12 = 151.67h/mois (approximation)
      // Nouveau calcul : somme des capacités quotidiennes réelles
      
      var dailyCapacities = [];
      // Février 2024 : 29 jours (bissextile), 21 jours ouvrés
      for (var day = 1; day <= 29; day++) {
        var date = new Date(Date.UTC(2024, 1, day));
        var dayOfWeek = date.getUTCDay();
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          dailyCapacities.push({
            membre: 1,
            date: '2024-02-' + String(day).padStart(2, '0'),
            capaciteDisponible: 7
          });
        }
      }
      
      var newCapacity = getCapacityForMemberPeriod(1, '2024-02', 'month', dailyCapacities);
      
      // 21 jours ouvrés * 7h = 147h (exact)
      // vs capPeriod(35) = 151.67h (approximation erronée)
      assert.strictEqual(newCapacity, 147);
      assert.notStrictEqual(newCapacity, 151.67);
    });
  });
});

// ============================================================================
// MOCK GRIST POUR TESTS D'INTÉGRATION COMPLÈTE
// ============================================================================

function createMockGrist() {
  var tables = {};
  
  return {
    setTable: function(tableId, data) {
      tables[tableId] = data;
    },
    
    docApi: {
      fetchTable: function(tableId) {
        var data = tables[tableId];
        if (!data) {
          return { id: [], columns: {} };
        }
        
        // Convertir en format colonnaire Grist
        var columnar = { id: [] };
        var columns = Object.keys(data[0] || {}).filter(function(column) { return column !== 'id'; });
        
        for (var i = 0; i < columns.length; i++) {
          columnar[columns[i]] = [];
        }
        
        for (var j = 0; j < data.length; j++) {
          columnar.id.push(data[j].id || j + 1);
          for (var k = 0; k < columns.length; k++) {
            columnar[columns[k]].push(data[j][columns[k]]);
          }
        }
        
        return columnar;
      }
    }
  };
}

describe('PlanCanonAdapter - loadCanonData (mock)', function() {
  
  it('doit charger et normaliser les données Grist', function() {
    var mockGrist = createMockGrist();
    
    mockGrist.setTable('Team', [
      { id: 1, nom: 'Alice', role: 'Dev', capaciteHebdo: 35, actif: true },
      { id: 2, nom: 'Bob', role: 'Dev', capaciteHebdo: 35, actif: true }
    ]);
    
    mockGrist.setTable('TaskAssignments', [
      { id: 101, tache: 1001, membre: 1, heuresAllouees: 20, actif: true }
    ]);
    
    mockGrist.setTable('Tasks', [
      { id: 1001, titre: 'Task A', projet: 501, statut: 'inprogress' }
    ]);
    
    mockGrist.setTable('Projects', [
      { id: 501, nom: 'Project X', programme: 101 }
    ]);
    
    mockGrist.setTable('Programmes', [
      { id: 101, nom: 'Program Alpha' }
    ]);
    
    mockGrist.setTable('TimeEntries', [
      { id: 1, affectation: 101, tache: 1001, membre: 1, date: 1704672000, heuresPrevues: 4, heures: null }
    ]);
    
    mockGrist.setTable('MemberDailyCapacities', [
      { id: 1, membre: 1, date: 1704672000, capaciteTheorique: 7, capaciteDisponible: 7, absenceHeures: 0 }
    ]);
    
    mockGrist.setTable('Feuilles', []);
    
    var state = {
      includeDone: false,
      statusCfg: { terminalValue: 'done' }
    };
    
    // Test de chargement (nécessite async)
    return PlanCanonAdapter.loadCanonData(mockGrist, state).then(function(data) {
      assert.strictEqual(data.team.length, 2);
      assert.strictEqual(data.assignments.length, 1);
      assert.strictEqual(data.tasks.length, 1);
      assert.strictEqual(data.timeEntries.length, 1);
    });
  });
});

describe('PlanCanonAdapter - projection glissante', function() {
  it('formate les micro-charges sans les supprimer', function() {
    var rollingIndex = {
      contributions: [{
        assignmentId: 10,
        taskId: 100,
        memberId: 1,
        periodKey: '2026-W35',
        hours: 0.02
      }],
      assignments: {
        10: { remainingHours: 0.02 }
      }
    };
    var canonData = {
      tasks: [{ id: 100, titre: 'Micro-tâche', projet: 5 }],
      projects: [{ id: 5, programme: 8 }],
      team: [{ id: 1, role: 'Dev' }]
    };

    var matrix = PlanCanonAdapter.formatRollingMatrixForRender(rollingIndex, 'project', canonData);
    assert.strictEqual(matrix['5|1']['2026-W35'], 0.02);

    var detail = PlanCanonAdapter.getRollingTasksInCell(
      rollingIndex, '5|1', '2026-W35', 'project', canonData
    );
    assert.strictEqual(detail.length, 1);
    assert.strictEqual(detail[0].slice, 0.02);
    assert.strictEqual(detail[0].virtual, true);
  });

  it('fusionne le continu effectif et le ponctuel virtuel', function() {
    var canonMatrix = {
      1: { '2026-W35': 28 }
    };
    var rollingMatrix = {
      1: { '2026-W35': 7, '2026-W36': 3.5 }
    };

    var planned = PlanCanonAdapter.mergeCanonAndRollingMatrices(
      canonMatrix,
      rollingMatrix,
      'prevu'
    );
    assert.strictEqual(planned[1]['2026-W35'], 35);
    assert.strictEqual(planned[1]['2026-W36'], 3.5);

    var available = PlanCanonAdapter.mergeCanonAndRollingMatrices(
      { 1: { '2026-W35': 7 } },
      rollingMatrix,
      'dispo'
    );
    assert.strictEqual(available[1]['2026-W35'], 0);
  });

    it('utilise le réalisé explicite comme charge effective du Plan', function() {
    var matrix = PlanCanonAdapter.formatCanonMatrixForRender({
      '1:2026-W35': {
        plannedHours: 35,
        actualHours: 28,
        effectiveHours: 28,
        availableCapacityHours: 35
      }
    }, 'person', 'prevu');

    assert.strictEqual(matrix[1]['2026-W35'], 28);
    });

    it('ventile la charge continue dans les clés tâche, projet et personne', function() {
      var byMemberPeriod = {
        '1:2026-W35': {
          memberId: 1,
          periodKey: '2026-W35',
          entries: [
            { memberId: 1, taskId: 10, plannedHours: 4, actualHours: null },
            { memberId: 1, taskId: 11, plannedHours: 6, actualHours: 2 }
          ]
        }
      };
      var data = {
        tasks: [
          { id: 10, projet: 100 },
          { id: 11, projet: 200 }
        ],
        projects: [],
        team: [{ id: 1, role: 'Dev' }]
      };

      var matrix = PlanCanonAdapter.formatCanonMatrixForRender(byMemberPeriod, 'project', 'prevu', data);
      var taskMatrix = PlanCanonAdapter.formatCanonMatrixForRender(byMemberPeriod, 'task', 'prevu', data);

      assert.strictEqual(matrix['100|1']['2026-W35'], 4);
      assert.strictEqual(matrix['200|1']['2026-W35'], 2);
      assert.strictEqual(taskMatrix['10|1']['2026-W35'], 4);
      assert.strictEqual(taskMatrix['11|1']['2026-W35'], 2);
    });

    it('filtre le détail matérialisé sur le projet de la cellule', function() {
      var index = {
        byMemberPeriod: {
          '1:2026-W35': {
            entries: [
              { memberId: 1, taskId: 10, plannedHours: 4, actualHours: null },
              { memberId: 1, taskId: 11, plannedHours: 6, actualHours: null }
            ]
          }
        }
      };
      var tasks = [{ id: 10, projet: 100, titre: 'A' }, { id: 11, projet: 200, titre: 'B' }];

      var details = PlanCanonAdapter.getTasksInCell(index, '100|1', '2026-W35', tasks, 'project', {
        projects: []
      });

      assert.deepStrictEqual(details.map(function(item) { return item.taskId; }), [10]);
    });

    it('filtre le détail matérialisé sur la tâche de la cellule', function() {
      var index = {
        byMemberPeriod: {
          '1:2026-W35': {
            entries: [
              { memberId: 1, taskId: 10, plannedHours: 4, actualHours: null },
              { memberId: 1, taskId: 11, plannedHours: 6, actualHours: null }
            ]
          }
        }
      };
      var tasks = [{ id: 10, titre: 'A' }, { id: 11, titre: 'B' }];

      var details = PlanCanonAdapter.getTasksInCell(index, '11|1', '2026-W35', tasks, 'task', {});

      assert.deepStrictEqual(details.map(function(item) { return item.taskId; }), [11]);
    });
});

// ============================================================================
// RUN TESTS
// ============================================================================

if (require.main === module) {
  console.log('Running PlanCanonAdapter tests...');
  console.log('Exécuter avec : npx mocha plan-canon-adapter.test.js');
}
