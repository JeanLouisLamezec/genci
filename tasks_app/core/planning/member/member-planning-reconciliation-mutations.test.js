/**
 * Tests pour la réconciliation des TimeEntries après modification/suppression
 * Vérifie que les anciennes entrées sont correctement mises à jour/supprimées
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
      toBeDefined: function() {
        if (actual === undefined) {
          throw new Error('Expected to be defined');
        }
      }
    };
  };
  
  var reconcileDailyEntries = global.PlanningReconciliation?.reconcileDailyEntries;
  
  if (!reconcileDailyEntries) {
    // Fallback pour tests Node
    var PlanningReconciliation = require('../reconciliation/planning-reconciliation.js');
    reconcileDailyEntries = PlanningReconciliation.reconcileDailyEntries;
  }
  
  describe('Réconciliation - Déplacement de tâche', function() {
    
    it('Supprime les anciennes entrées quand une tâche est déplacée', function() {
      // Entrées existantes: tâche du 1er au 5 août (5 jours × 6h = 30h)
      var existingEntries = [
        { id: 1, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-01', plannedHours: 6, actualHours: 0, sheetStatus: null },
        { id: 2, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-02', plannedHours: 6, actualHours: 0, sheetStatus: null },
        { id: 3, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-03', plannedHours: 6, actualHours: 0, sheetStatus: null },
        { id: 4, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-04', plannedHours: 6, actualHours: 0, sheetStatus: null },
        { id: 5, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-05', plannedHours: 6, actualHours: 0, sheetStatus: null }
      ];
      
      // Nouvelle planification: tâche du 20 au 25 septembre (5 jours × 6h = 30h)
      var desiredEntries = [
        { assignmentId: 5, taskId: 6, memberId: 1, date: '2026-09-20', plannedHours: 6 },
        { assignmentId: 5, taskId: 6, memberId: 1, date: '2026-09-21', plannedHours: 6 },
        { assignmentId: 5, taskId: 6, memberId: 1, date: '2026-09-22', plannedHours: 6 },
        { assignmentId: 5, taskId: 6, memberId: 1, date: '2026-09-23', plannedHours: 6 },
        { assignmentId: 5, taskId: 6, memberId: 1, date: '2026-09-24', plannedHours: 6 }
      ];
      
      var result = reconcileDailyEntries(existingEntries, desiredEntries);
      
      // Les 5 anciennes entrées devraient être supprimées
      expect(result.deletes.length).toBe(5);
      result.deletes.forEach(function(del) {
        expect([1, 2, 3, 4, 5].includes(del.id)).toBe(true);
      });
      
      // Les 5 nouvelles entrées devraient être créées
      expect(result.creates.length).toBe(5);
      result.creates.forEach(function(create) {
        expect(create.plannedHours).toBe(6);
        expect(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'].includes(create.date)).toBe(true);
      });
      
      // Aucune mise à jour
      expect(result.updates.length).toBe(0);
    });
    
    it('Conserve les entrées avec du réalisé', function() {
      var existingEntries = [
        { id: 1, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-01', plannedHours: 6, actualHours: 4, sheetStatus: null },
        { id: 2, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-02', plannedHours: 6, actualHours: 0, sheetStatus: null }
      ];
      
      var desiredEntries = [
        { assignmentId: 5, taskId: 6, memberId: 1, date: '2026-09-20', plannedHours: 6 }
      ];
      
      var result = reconcileDailyEntries(existingEntries, desiredEntries);
      
      // L'entrée avec actualHours > 0 ne devrait PAS être dans les deletes
      // (elle est protégée)
      var deletedIds = result.deletes.map(function(d) { return d.id; });
      expect(deletedIds.includes(1)).toBe(false);
      
      // L'entrée sans réalisé devrait être supprimée
      expect(deletedIds.includes(2)).toBe(true);
    });
    
    it('Gère la réduction d\'heures (30h → 20h)', function() {
      var existingEntries = [
        { id: 1, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-01', plannedHours: 6, actualHours: 0, sheetStatus: null },
        { id: 2, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-02', plannedHours: 6, actualHours: 0, sheetStatus: null },
        { id: 3, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-03', plannedHours: 6, actualHours: 0, sheetStatus: null },
        { id: 4, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-04', plannedHours: 6, actualHours: 0, sheetStatus: null },
        { id: 5, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-05', plannedHours: 6, actualHours: 0, sheetStatus: null }
      ];
      
      // Nouvelle planification: 20h au lieu de 30h (4 jours × 5h)
      var desiredEntries = [
        { assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-01', plannedHours: 5 },
        { assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-02', plannedHours: 5 },
        { assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-03', plannedHours: 5 },
        { assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-04', plannedHours: 5 }
      ];
      
      var result = reconcileDailyEntries(existingEntries, desiredEntries);
      
      // 4 mises à jour (réduction de 6h → 5h)
      expect(result.updates.length).toBe(4);
      
      // 1 suppression (le 5ème jour n'est plus planifié)
      expect(result.deletes.length).toBe(1);
      expect(result.deletes[0].id).toBe(5);
    });
  });
  
  describe('Réconciliation - Suppression de tâche', function() {
    
    it('Supprime toutes les entrées quand une tâche est supprimée', function() {
      var existingEntries = [
        { id: 1, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-01', plannedHours: 6, actualHours: 0, sheetStatus: null },
        { id: 2, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-02', plannedHours: 6, actualHours: 0, sheetStatus: null },
        { id: 3, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-03', plannedHours: 6, actualHours: 0, sheetStatus: null }
      ];
      
      // Pas de nouvelle planification (tâche supprimée)
      var desiredEntries = [];
      
      var result = reconcileDailyEntries(existingEntries, desiredEntries);
      
      // Toutes les entrées devraient être supprimées
      expect(result.deletes.length).toBe(3);
      expect(result.creates.length).toBe(0);
      expect(result.updates.length).toBe(0);
    });
    
    it('Ne supprime pas les entrées avec du réalisé lors d\'une suppression', function() {
      var existingEntries = [
        { id: 1, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-01', plannedHours: 6, actualHours: 4, sheetStatus: null },
        { id: 2, assignmentId: 5, taskId: 6, memberId: 1, date: '2026-08-02', plannedHours: 6, actualHours: 0, sheetStatus: null }
      ];
      
      var desiredEntries = [];
      
      var result = reconcileDailyEntries(existingEntries, desiredEntries);
      
      // L'entrée avec réalisé ne devrait PAS être supprimée
      var deletedIds = result.deletes.map(function(d) { return d.id; });
      expect(deletedIds.includes(1)).toBe(false);
      
      // L'entrée sans réalisé devrait être supprimée
      expect(deletedIds.includes(2)).toBe(true);
    });
  });
  
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
