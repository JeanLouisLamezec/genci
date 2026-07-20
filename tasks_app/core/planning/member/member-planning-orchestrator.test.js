/**
 * Tests pour Member Planning Orchestrator
 * Vérifie le partage de capacité entre plusieurs affectations
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
      }
    };
  };
  
  var createMemberPlanningOrchestrator = global.createMemberPlanningOrchestrator;
  
  if (!createMemberPlanningOrchestrator) {
    throw new Error('createMemberPlanningOrchestrator is not defined in global scope');
  }
  
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
    
    it('PreviewMember retourne un résultat structuré', async function() {
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
      
      expect(result.success).toBeDefined();
      expect(result.memberId).toBe(1);
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
  
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
