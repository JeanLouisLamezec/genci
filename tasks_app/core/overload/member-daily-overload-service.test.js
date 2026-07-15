/**
 * Tests pour member-daily-overload-service.js
 */

'use strict';

const {
  detectMemberDailyOverloads,
  checkActiveAssignmentUnicity,
  checkTimeEntryUnicity,
  checkMemberDailyCapacityUnicity
} = require('./member-daily-overload-service.js');

describe('Member Daily Overload Service', () => {
  
  describe('detectMemberDailyOverloads', () => {
    test('devrait détecter une surcharge avec 2 tâches de 4h et capacité 7h', () => {
      const plannedEntries = [
        { memberId: 1, date: '2026-07-13', plannedHours: 4, assignmentId: 1, taskId: 1 },
        { memberId: 1, date: '2026-07-13', plannedHours: 4, assignmentId: 2, taskId: 2 }
      ];
      
      const memberDailyCapacities = [
        { memberId: 1, date: '2026-07-13', availableCapacityHours: 7 }
      ];
      
      const result = detectMemberDailyOverloads({ plannedEntries, memberDailyCapacities });
      
      expect(result.overloads.length).toBe(1);
      expect(result.overloads[0].overloadHours).toBe(1);
      expect(result.overloads[0].plannedHours).toBe(8);
      expect(result.overloads[0].availableCapacityHours).toBe(7);
    });
    
    test('devrait détecter une surcharge avec 3 tâches de 7h et capacité 7h', () => {
      const plannedEntries = [
        { memberId: 1, date: '2026-07-13', plannedHours: 7, assignmentId: 1, taskId: 1 },
        { memberId: 1, date: '2026-07-13', plannedHours: 7, assignmentId: 2, taskId: 2 },
        { memberId: 1, date: '2026-07-13', plannedHours: 7, assignmentId: 3, taskId: 3 }
      ];
      
      const memberDailyCapacities = [
        { memberId: 1, date: '2026-07-13', availableCapacityHours: 7 }
      ];
      
      const result = detectMemberDailyOverloads({ plannedEntries, memberDailyCapacities });
      
      expect(result.overloads.length).toBe(1);
      expect(result.overloads[0].overloadHours).toBe(14);
      expect(result.overloads[0].plannedHours).toBe(21);
    });
    
    test('devrait détecter une surcharge avec jour de congé (capacité 0) et plan 2h', () => {
      const plannedEntries = [
        { memberId: 1, date: '2026-07-14', plannedHours: 2, assignmentId: 1, taskId: 1 }
      ];
      
      const memberDailyCapacities = [
        { memberId: 1, date: '2026-07-14', availableCapacityHours: 0 } // Congé
      ];
      
      const result = detectMemberDailyOverloads({ plannedEntries, memberDailyCapacities });
      
      expect(result.overloads.length).toBe(1);
      expect(result.overloads[0].overloadHours).toBe(2);
    });
    
    test('devrait retourner MISSING_DAILY_CAPACITY si aucune capacité', () => {
      const plannedEntries = [
        { memberId: 1, date: '2026-07-13', plannedHours: 4, assignmentId: 1, taskId: 1 }
      ];
      
      const memberDailyCapacities = [];
      
      const result = detectMemberDailyOverloads({ plannedEntries, memberDailyCapacities });
      
      expect(result.overloads.length).toBe(0);
      expect(result.diagnostics.some(d => d.code === 'MISSING_DAILY_CAPACITY')).toBe(true);
    });
    
    test('ne devrait pas détecter de surcharge si plan <= capacité', () => {
      const plannedEntries = [
        { memberId: 1, date: '2026-07-13', plannedHours: 3.5, assignmentId: 1, taskId: 1 },
        { memberId: 1, date: '2026-07-13', plannedHours: 3.5, assignmentId: 2, taskId: 2 }
      ];
      
      const memberDailyCapacities = [
        { memberId: 1, date: '2026-07-13', availableCapacityHours: 7 }
      ];
      
      const result = detectMemberDailyOverloads({ plannedEntries, memberDailyCapacities });
      
      expect(result.overloads.length).toBe(0);
    });
    
    test('devrait agréger correctement sur plusieurs jours', () => {
      const plannedEntries = [
        { memberId: 1, date: '2026-07-13', plannedHours: 4, assignmentId: 1, taskId: 1 },
        { memberId: 1, date: '2026-07-13', plannedHours: 4, assignmentId: 2, taskId: 2 },
        { memberId: 1, date: '2026-07-14', plannedHours: 4, assignmentId: 1, taskId: 1 },
        { memberId: 1, date: '2026-07-14', plannedHours: 2, assignmentId: 2, taskId: 2 }
      ];
      
      const memberDailyCapacities = [
        { memberId: 1, date: '2026-07-13', availableCapacityHours: 7 },
        { memberId: 1, date: '2026-07-14', availableCapacityHours: 7 }
      ];
      
      const result = detectMemberDailyOverloads({ plannedEntries, memberDailyCapacities });
      
      expect(result.overloads.length).toBe(1);
      expect(result.overloads[0].date).toBe('2026-07-13');
      expect(result.overloads[0].overloadHours).toBe(1);
    });
    
    test('devrait retourner les assignmentIds et taskIds', () => {
      const plannedEntries = [
        { memberId: 1, date: '2026-07-13', plannedHours: 4, assignmentId: 10, taskId: 100 },
        { memberId: 1, date: '2026-07-13', plannedHours: 4, assignmentId: 20, taskId: 200 }
      ];
      
      const memberDailyCapacities = [
        { memberId: 1, date: '2026-07-13', availableCapacityHours: 7 }
      ];
      
      const result = detectMemberDailyOverloads({ plannedEntries, memberDailyCapacities });
      
      expect(result.overloads[0].assignmentIds).toEqual(expect.arrayContaining([10, 20]));
      expect(result.overloads[0].taskIds).toEqual(expect.arrayContaining([100, 200]));
    });
  });
  
  describe('checkActiveAssignmentUnicity', () => {
    test('devrait détecter 2 affectations actives identiques', () => {
      const assignments = [
        { id: 1, tache: 1, membre: 1, actif: true },
        { id: 2, tache: 1, membre: 1, actif: true }
      ];
      
      const result = checkActiveAssignmentUnicity(assignments);
      
      expect(result.hasViolations).toBe(true);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0].code).toBe('DUPLICATE_ACTIVE_ASSIGNMENT');
    });
    
    test('ne devrait pas détecter 1 active + 1 inactive', () => {
      const assignments = [
        { id: 1, tache: 1, membre: 1, actif: true },
        { id: 2, tache: 1, membre: 1, actif: false }
      ];
      
      const result = checkActiveAssignmentUnicity(assignments);
      
      expect(result.hasViolations).toBe(false);
    });
    
    test('ne devrait pas détecter 2 membres différents', () => {
      const assignments = [
        { id: 1, tache: 1, membre: 1, actif: true },
        { id: 2, tache: 1, membre: 2, actif: true }
      ];
      
      const result = checkActiveAssignmentUnicity(assignments);
      
      expect(result.hasViolations).toBe(false);
    });
    
    test('ne devrait pas détecter 2 tâches différentes', () => {
      const assignments = [
        { id: 1, tache: 1, membre: 1, actif: true },
        { id: 2, tache: 2, membre: 1, actif: true }
      ];
      
      const result = checkActiveAssignmentUnicity(assignments);
      
      expect(result.hasViolations).toBe(false);
    });
  });
  
  describe('checkTimeEntryUnicity', () => {
    test('devrait détecter un doublon affectation + date', () => {
      const entries = [
        { affectation: 1, date: '2026-07-13' },
        { affectation: 1, date: '2026-07-13' }
      ];
      
      const result = checkTimeEntryUnicity(entries);
      
      expect(result.hasViolations).toBe(true);
      expect(result.violations.length).toBe(1);
    });
  });
  
  describe('checkMemberDailyCapacityUnicity', () => {
    test('devrait détecter un doublon membre + date', () => {
      const capacities = [
        { memberId: 1, date: '2026-07-13' },
        { memberId: 1, date: '2026-07-13' }
      ];
      
      const result = checkMemberDailyCapacityUnicity(capacities);
      
      expect(result.hasViolations).toBe(true);
      expect(result.violations.length).toBe(1);
    });
  });
});
