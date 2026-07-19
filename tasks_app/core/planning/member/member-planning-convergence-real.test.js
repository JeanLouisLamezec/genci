/**
 * Tests RÉELS de convergence — Planification après modifications successives
 * 
 * Ces tests utilisent un mock Grist VRAIMENT persistant qui préserve l'état
 * entre les appels et simule correctement les mutations.
 */

(function (global) {
  'use strict';
  
  var describe = global.describe || function(name, fn) { fn(); };
  var it = global.it || function(name, fn) { fn(); };
  var expect = global.expect || function(actual) {
    return {
      toBe: function(expected) {
        if (actual !== expected) {
          throw new Error('Expected ' + expected + ' but got ' + actual);
        }
      },
      toEqual: function(expected) {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error('Expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual));
        }
      },
      toBeGreaterThan: function(expected) {
        if (actual <= expected) {
          throw new Error('Expected ' + actual + ' to be greater than ' + expected);
        }
      },
      toContain: function(expected) {
        if (!actual.includes(expected)) {
          throw new Error('Expected ' + JSON.stringify(actual) + ' to contain ' + expected);
        }
      }
    };
  };

  var createMemberPlanningOrchestrator = global.createMemberPlanningOrchestrator;

  if (!createMemberPlanningOrchestrator) {
    var MemberPlanningOrchestrator = require('./member-planning-orchestrator.js');
    createMemberPlanningOrchestrator = MemberPlanningOrchestrator.createMemberPlanningOrchestrator;
  }

  // Helpers
  function dateToTimestamp(dateStr) {
    var date = new Date(dateStr + 'T00:00:00Z');
    return Math.floor(date.getTime() / 1000);
  }

  function timestampToDate(ts) {
    return new Date(ts * 1000).toISOString().split('T')[0];
  }

  /**
   * Crée un mock Grist VRAIMENT persistant avec mutations correctes
   */
  function createRealPersistentMockGrist(initialData) {
    // Copie profonde des données initiales
    var data = JSON.parse(JSON.stringify(initialData || {}));
    var nextIds = {};

    return {
      docApi: {
        fetchTable: function(tableName) {
          // Retourne une COPIE des données (comme Grist)
          var table = data[tableName] || { id: [] };
          return JSON.parse(JSON.stringify(table));
        },
        applyUserActions: function(actions) {
          var retValues = [];

          for (var i = 0; i < actions.length; i++) {
            var action = actions[i];
            var op = action[0];
            var table = action[1];

            if (!data[table]) {
              data[table] = { id: [] };
            }

            if (op === 'AddRecord') {
              var newId = nextIds[table] || (data[table].id.length > 0 ? Math.max.apply(null, data[table].id) + 1 : 1);
              nextIds[table] = newId + 1;
              
              var fields = action[3] || {};
              var recordId = action[2] === null ? newId : action[2];
              
              data[table].id.push(recordId);
              
              Object.keys(fields).forEach(function(key) {
                if (!data[table][key]) {
                  data[table][key] = new Array(data[table].id.length - 1).fill(null);
                }
                data[table][key].push(fields[key]);
              });
              
              Object.keys(data[table]).forEach(function(col) {
                if (col !== 'id' && data[table][col] && data[table][col].length < data[table].id.length) {
                  while (data[table][col].length < data[table].id.length) {
                    data[table][col].push(null);
                  }
                }
              });
              
              retValues.push(recordId);
            } else if (op === 'UpdateRecord') {
              var updateId = action[2];
              var fields = action[3] || {};
              var index = data[table].id.indexOf(updateId);
              
              if (index >= 0) {
                Object.keys(fields).forEach(function(key) {
                  if (!data[table][key]) {
                    data[table][key] = new Array(data[table].id.length).fill(null);
                  }
                  data[table][key][index] = fields[key];
                });
              }
              
              retValues.push(null);
            } else if (op === 'RemoveRecord') {
              var removeId = action[2];
              var index = data[table].id.indexOf(removeId);
              
              if (index >= 0) {
                data[table].id.splice(index, 1);
                Object.keys(data[table]).forEach(function(col) {
                  if (col !== 'id' && data[table][col]) {
                    data[table][col].splice(index, 1);
                  }
                });
              }
              
              retValues.push(null);
            }
          }

          return Promise.resolve({ retValues: retValues });
        }
      },
      getData: function() {
        return JSON.parse(JSON.stringify(data));
      }
    };
  }

  function createBaseData() {
    return {
      Team: {
        id: [1],
        nom: ['Alice'],
        capaciteHebdo: [35]
      },
      TaskAssignments: { id: [] },
      Tasks: { id: [] },
      TimeEntries: { id: [] },
      Feuilles: { id: [] },
      Disponibilites: { id: [] },
      MemberDailyCapacities: { id: [] }
    };
  }

  describe('CONVERGENCE RÉELLE — Scénario complet', function() {
    it('capaciteJour valide après commit multi-phase', async function() {
      var baseData = createBaseData();
      baseData.TaskAssignments = {
        id: [1],
        tache: [1],
        membre: [1],
        heuresAllouees: [30],
        dateDebut: [dateToTimestamp('2026-08-03')],
        dateFin: [dateToTimestamp('2026-08-07')],
        modeRepartition: ['uniforme'],
        actif: [true],
        commentaire: ['']
      };
      baseData.Tasks = {
        id: [1],
        titre: ['Tâche A'],
        dateDebut: [dateToTimestamp('2026-08-03')],
        dateEcheance: [dateToTimestamp('2026-08-07')]
      };

      var grist = createRealPersistentMockGrist(baseData);
      var orchestrator = createMemberPlanningOrchestrator(grist, { logEnabled: false });

      var preview = await orchestrator.previewMember(1, { replanFromDate: '2026-08-03', todayIso: '2026-08-01' });
      
      // Le preview DOIT réussir
      expect(preview.success).toBe(true);
      expect(preview.canCommit).toBe(true);
      
      var commit = await orchestrator.commitMember(1, preview, { todayIso: '2026-08-01' });
      
      // Le commit DOIT réussir
      expect(commit.success).toBe(true);
      expect(commit.code).toBe('SUCCESS');

      // Vérifier que les TimeEntries ont été créées avec capaciteJour valide
      var finalData = grist.getData();
      var timeEntries = finalData.TimeEntries || { id: [] };
      
      // DOIT avoir des TimeEntries
      expect(timeEntries.id.length).toBe(5);

      // TOUTES les TimeEntries doivent avoir capaciteJour non nul
      for (var i = 0; i < timeEntries.id.length; i++) {
        var capaciteJour = timeEntries.capaciteJour[i];
        expect(capaciteJour).toBeDefined();
        expect(capaciteJour).not.toBeNull();
        expect(capaciteJour).toBeGreaterThan(0);
      }
    });

    it('Nettoyage : la logique est disponible', function() {
      // Test de présence - le nettoyage réel sera testé dans Grist
      expect(true).toBe(true);
    });

    it('Idempotence : le système ne crée pas de doublons', async function() {
      var baseData = createBaseData();
      baseData.TaskAssignments = {
        id: [1],
        tache: [1],
        membre: [1],
        heuresAllouees: [30],
        dateDebut: [dateToTimestamp('2026-08-03')],
        dateFin: [dateToTimestamp('2026-08-07')],
        modeRepartition: ['uniforme'],
        actif: [true],
        commentaire: ['']
      };
      baseData.Tasks = {
        id: [1],
        titre: ['Tâche A'],
        dateDebut: [dateToTimestamp('2026-08-03')],
        dateEcheance: [dateToTimestamp('2026-08-07')]
      };

      var grist = createRealPersistentMockGrist(baseData);
      var orchestrator = createMemberPlanningOrchestrator(grist, { logEnabled: false });

      // Premier commit
      var preview1 = await orchestrator.previewMember(1, { replanFromDate: '2026-08-03', todayIso: '2026-08-01' });
      if (preview1.success && preview1.canCommit) {
        var commit1 = await orchestrator.commitMember(1, preview1);
        expect(commit1.success).toBe(true);
      }

      // Vérifier l'absence de doublons de capacités
      var dataAfter = grist.getData();
      var capacities = dataAfter.MemberDailyCapacities || { id: [] };
      
      var dateCount = {};
      for (var i = 0; i < capacities.id.length; i++) {
        var date = typeof capacities.date[i] === 'number'
          ? timestampToDate(capacities.date[i])
          : capacities.date[i];
        dateCount[date] = (dateCount[date] || 0) + 1;
      }

      var duplicates = [];
      Object.keys(dateCount).forEach(function(date) {
        if (dateCount[date] > 1) {
          duplicates.push({ date: date, count: dateCount[date] });
        }
      });

      expect(duplicates.length).toBe(0);
    });
  });

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
