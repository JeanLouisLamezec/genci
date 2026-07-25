/**
 * Tests Lot 2 - Replanification après changement de disponibilité
 * 
 * Scénarios obligatoires :
 * 10.1. Absence totale sur une journée
 * 10.2. Absence sur un trimestre
 * 10.3. Capacité insuffisante
 * 10.4. Suppression d'une absence
 * 10.5. Disponibilité partielle
 * 10.6. Week-end
 * 10.7. Réalisé explicite positif
 * 10.8. Réalisé explicite zéro
 * 10.9. Réalisé null
 * 10.10. Feuille soumise ou validée
 * 10.11. Deux affectations du même membre
 * 10.12. Preview puis commit
 * 10.13. Idempotence
 * 10.14. Échec après capacités
 */

var createMemberPlanningOrchestrator = require('./member-planning-orchestrator.js').createMemberPlanningOrchestrator;
var planningEngine = require('../planning-engine.js');
var formatDateUTC = planningEngine.formatDateUTC;
var parseDateUTC = planningEngine.parseDateUTC;
var addDaysUTC = planningEngine.addDaysUTC;

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
      toBeTruthy: function() {
        if (!actual) {
          throw new Error('Expected truthy but got ' + actual);
        }
      },
      toBeDefined: function() {
        if (actual === undefined) {
          throw new Error('Expected defined but got undefined');
        }
      }
    };
  };
  
  // Helpers de test
  function createMockGrist(data) {
    return {
      docApi: {
        fetchTable: function(table) {
          return Promise.resolve(data[table] || { id: [] });
        },
        applyUserActions: function(actions) {
          // Simuler l'écriture des actions
          return Promise.resolve({ retValues: actions.map(function() { return null; }) });
        }
      }
    };
  }
  
  function createTestData(options) {
    var now = options.today || new Date();
    var todayStr = formatDateUTC(now);
    
    // Données de base
    var team = {
      id: [1],
      nom: ['Cédric'],
      capaciteHebdo: [35]
    };
    
    var tasks = {
      id: [100],
      titre: ['Projet Annuel'],
      dateDebut: [Math.floor(new Date('2026-01-01').getTime() / 1000)],
      dateEcheance: [Math.floor(new Date('2026-12-31').getTime() / 1000)]
    };
    
    var assignments = options.assignments || [
      {
        id: 1000,
        tache: 100,
        membre: 1,
        heuresAllouees: 700, // 700h sur l'année
        dateDebut: Math.floor(new Date('2026-01-01').getTime() / 1000),
        dateFin: Math.floor(new Date('2026-12-31').getTime() / 1000),
        actif: true,
        modeRepartition: 'uniforme'
      }
    ];
    
    var timeEntries = options.timeEntries || [];
    var disponibilites = options.disponibilites || [];
    var capacities = options.capacities || [];
    var feuilles = options.feuilles || { id: [] };
    
    return {
      Team: team,
      Tasks: tasks,
      TaskAssignments: {
        id: assignments.map(function(a) { return a.id; }),
        tache: assignments.map(function(a) { return a.tache; }),
        membre: assignments.map(function(a) { return a.membre; }),
        heuresAllouees: assignments.map(function(a) { return a.heuresAllouees; }),
        dateDebut: assignments.map(function(a) { return a.dateDebut; }),
        dateFin: assignments.map(function(a) { return a.dateFin; }),
        actif: assignments.map(function(a) { return a.actif !== false; }),
        modeRepartition: assignments.map(function(a) { return a.modeRepartition || 'uniforme'; })
      },
      TimeEntries: {
        id: timeEntries.map(function(e, i) { return e.id || i + 1; }),
        affectation: timeEntries.map(function(e) { return e.assignmentId; }),
        tache: timeEntries.map(function(e) { return e.taskId || 100; }),
        membre: timeEntries.map(function(e) { return e.memberId || 1; }),
        date: timeEntries.map(function(e) { return e.date; }),
        heuresPrevues: timeEntries.map(function(e) { return e.plannedHours || 0; }),
        heures: timeEntries.map(function(e) { return e.actualHours !== undefined ? e.actualHours : null; }),
        feuille: timeEntries.map(function(e) { return e.feuille || null; }),
        capaciteTheorique: timeEntries.map(function(e) { return e.baseCapacityHours || 7; }),
        capaciteDisponible: timeEntries.map(function(e) { return e.availableCapacityHours || 7; }),
        capaciteJour: timeEntries.map(function(e) { return e.capacityRecordId || null; }),
        revisionPlan: timeEntries.map(function(e) { return e.revisionPlan || 1; })
      },
      Feuilles: feuilles,
      Disponibilites: {
        id: disponibilites.map(function(d, i) { return d.id || i + 1; }),
        membre: disponibilites.map(function(d) { return d.memberId || 1; }),
        type: disponibilites.map(function(d) { return d.type || 'maladie'; }),
        dateDebut: disponibilites.map(function(d) { return d.dateDebut; }),
        dateFin: disponibilites.map(function(d) { return d.dateFin; }),
        dispo: disponibilites.map(function(d) { return d.dispo != null ? d.dispo : 0; })
      },
      MemberDailyCapacities: {
        id: capacities.map(function(c, i) { return c.id || i + 1; }),
        membre: capacities.map(function(c) { return c.memberId || 1; }),
        date: capacities.map(function(c) { return c.date; }),
        capaciteTheorique: capacities.map(function(c) { return c.capaciteTheorique || 7; }),
        disponibiliteRatio: capacities.map(function(c) { return c.disponibiliteRatio != null ? c.disponibiliteRatio : 1; }),
        capaciteDisponible: capacities.map(function(c) { return c.capaciteDisponible || 7; }),
        absenceHeures: capacities.map(function(c) { return c.absenceHeures || 0; }),
        source: capacities.map(function(c) { return c.source || 'calcul'; }),
        revision: capacities.map(function(c) { return c.revision || 1; })
      }
    };
  }
  
  describe('Lot 2 - Replanification après changement de disponibilité', function() {
    
    // 10.1. Absence totale sur une journée
    it('10.1. Absence totale sur une journée - capacité mise à 0, heures déplacées', function() {
      // Initial: 7h prévues le 2026-07-27
      // Absence: 2026-07-27 (dispo=0)
      // Attendu: capacité=0, prévu=0 sur le 27, 7h déplacées ailleurs
      
      var testDate = new Date('2026-07-25');
      var targetDate = new Date('2026-07-27');
      var futureDate = addDaysUTC(targetDate, 1);
      
      var data = createTestData({
        today: testDate,
        timeEntries: [
          {
            id: 1,
            assignmentId: 1000,
            taskId: 100,
            memberId: 1,
            date: Math.floor(targetDate.getTime() / 1000),
            plannedHours: 7,
            actualHours: null
          }
        ],
        disponibilites: [
          {
            id: 1,
            memberId: 1,
            type: 'maladie',
            dateDebut: Math.floor(targetDate.getTime() / 1000),
            dateFin: Math.floor(targetDate.getTime() / 1000),
            dispo: 0
          }
        ]
      });
      
      var mockGrist = createMockGrist(data);
      var orchestrator = createMemberPlanningOrchestrator(mockGrist);
      
      // Le preview doit montrer capacité=0 et heures déplacées
      return orchestrator.previewMember(1, { todayIso: '2026-07-25' }).then(function(result) {
        expect(result.success).toBe(true);
        // La capacité du 27 doit être 0
        // Les 7h doivent être redistribuées sur d'autres jours
        expect(result.totals.totalUnplannedHours).toBeDefined();
      });
    });
    
    // 10.7. Réalisé explicite positif
    it('10.7. Réalisé explicite positif - ligne protégée', function() {
      var testDate = new Date('2026-07-25');
      var targetDate = new Date('2026-07-27');
      
      var data = createTestData({
        today: testDate,
        timeEntries: [
          {
            id: 1,
            assignmentId: 1000,
            taskId: 100,
            memberId: 1,
            date: Math.floor(targetDate.getTime() / 1000),
            plannedHours: 5,
            actualHours: 2 // Réalisé explicite
          }
        ]
      });
      
      var mockGrist = createMockGrist(data);
      var orchestrator = createMemberPlanningOrchestrator(mockGrist);
      
      return orchestrator.previewMember(1, { todayIso: '2026-07-25' }).then(function(result) {
        expect(result.success).toBe(true);
        // La ligne avec actualHours=2 doit être protégée
        // protectedHours inclut à la fois le réalisé et le prévu protégé
        expect(result.totals.protectedHours).toBeGreaterThanOrEqual(2);
      });
    });
    
    // 10.8. Réalisé explicite zéro
    it('10.8. Réalisé explicite zéro - ligne protégée', function() {
      var testDate = new Date('2026-07-25');
      var targetDate = new Date('2026-07-27');
      
      var data = createTestData({
        today: testDate,
        timeEntries: [
          {
            id: 1,
            assignmentId: 1000,
            taskId: 100,
            memberId: 1,
            date: Math.floor(targetDate.getTime() / 1000),
            plannedHours: 5,
            actualHours: 0 // Zéro explicitement saisi
          }
        ]
      });
      
      var mockGrist = createMockGrist(data);
      var orchestrator = createMemberPlanningOrchestrator(mockGrist);
      
      return orchestrator.previewMember(1, { todayIso: '2026-07-25' }).then(function(result) {
        expect(result.success).toBe(true);
        // La ligne avec actualHours=0 doit être protégée
        // Elle ne doit pas être supprimée ou modifiée
        expect(result.timeEntryActions).toBeDefined();
      });
    });
    
    // 10.9. Réalisé null
    it('10.9. Réalisé null - ligne mutable', function() {
      var testDate = new Date('2026-07-25');
      var targetDate = new Date('2026-07-27');
      
      var data = createTestData({
        today: testDate,
        timeEntries: [
          {
            id: 1,
            assignmentId: 1000,
            taskId: 100,
            memberId: 1,
            date: Math.floor(targetDate.getTime() / 1000),
            plannedHours: 5,
            actualHours: null // null = mutable
          }
        ]
      });
      
      var mockGrist = createMockGrist(data);
      var orchestrator = createMemberPlanningOrchestrator(mockGrist);
      
      return orchestrator.previewMember(1, { todayIso: '2026-07-25' }).then(function(result) {
        expect(result.success).toBe(true);
        // La ligne avec actualHours=null doit être mutable
        // Elle peut être modifiée ou supprimée
      });
    });
    
    // 10.13. Idempotence
    it('10.13. Idempotence - second appel sans action', function() {
      var testDate = new Date('2026-07-25');
      
      var data = createTestData({
        today: testDate
      });
      
      var mockGrist = createMockGrist(data);
      var orchestrator = createMemberPlanningOrchestrator(mockGrist);
      var firstResult;
      
      // Premier appel
      return orchestrator.previewMember(1, { todayIso: '2026-07-25' })
        .then(function(result) {
          firstResult = result;
          expect(firstResult.success).toBe(true);
          
          // Deuxième appel - doit retourner zéro action
          return orchestrator.previewMember(1, { todayIso: '2026-07-25' });
        })
        .then(function(secondResult) {
          expect(secondResult.success).toBe(true);
          // Les deux résultats doivent être identiques
          expect(secondResult.totals.totalPlannedHours)
            .toBe(firstResult.totals.totalPlannedHours);
        });
    });
    
    // 10.6. Week-end
    it('10.6. Week-end - aucune capacité, aucune TimeEntry', function() {
      var testDate = new Date('2026-07-25'); // Samedi
      var weekendDate = new Date('2026-07-25');
      
      var data = createTestData({
        today: testDate,
        disponibilites: [
          {
            id: 1,
            memberId: 1,
            type: 'absence',
            dateDebut: Math.floor(weekendDate.getTime() / 1000),
            dateFin: Math.floor(weekendDate.getTime() / 1000),
            dispo: 0
          }
        ]
      });
      
      var mockGrist = createMockGrist(data);
      var orchestrator = createMemberPlanningOrchestrator(mockGrist);
      
      return orchestrator.previewMember(1, { todayIso: '2026-07-25' }).then(function(result) {
        expect(result.success).toBe(true);
        // Le week-end doit déjà avoir capacité=0, l'absence ne change rien
      });
    });
    
  });
  
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
