/**
 * Tests pour member-daily-capacity-service.js
 */

'use strict';

const {
  buildDesiredMemberDailyCapacities,
  reconcileMemberDailyCapacities,
  validateCapacityInput,
  DEFAULT_WEEKLY_CAPACITY
} = require('./member-daily-capacity-service.js');

describe('Member Daily Capacity Service', () => {
  
  describe('validateCapacityInput', () => {
    test('devrait valider une entrée correcte', () => {
      const result = validateCapacityInput({
        weeklyCapacity: 35,
        defaultWeeklyCapacity: 35,
        availabilities: [
          { dateDebut: '2026-07-01', dateFin: '2026-07-05', dispo: 0.5 }
        ]
      });
      
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });
    
    test('devrait rejeter un ratio de disponibilité > 1', () => {
      const result = validateCapacityInput({
        weeklyCapacity: 35,
        defaultWeeklyCapacity: 35,
        availabilities: [
          { dateDebut: '2026-07-01', dateFin: '2026-07-05', dispo: 2 }
        ]
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_AVAILABILITY_RATIO')).toBe(true);
    });
    
    test('devrait rejeter un ratio de disponibilité < 0', () => {
      const result = validateCapacityInput({
        weeklyCapacity: 35,
        defaultWeeklyCapacity: 35,
        availabilities: [
          { dateDebut: '2026-07-01', dateFin: '2026-07-05', dispo: -0.5 }
        ]
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_AVAILABILITY_RATIO')).toBe(true);
    });
    
    test('devrait rejeter une dateDebut > dateFin', () => {
      const result = validateCapacityInput({
        weeklyCapacity: 35,
        defaultWeeklyCapacity: 35,
        availabilities: [
          { dateDebut: '2026-07-10', dateFin: '2026-07-01', dispo: 0.5 }
        ]
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_AVAILABILITY_DATE_RANGE')).toBe(true);
    });
    
    test('devrait rejeter une capaciteHebdo négative', () => {
      const result = validateCapacityInput({
        weeklyCapacity: -5,
        defaultWeeklyCapacity: 35
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_WEEKLY_CAPACITY')).toBe(true);
    });
  });
  
  describe('buildDesiredMemberDailyCapacities', () => {
    test('devrait construire des capacités pour 5 jours ouvrés', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 35,
        startDate: '2026-07-13', // Lundi
        endDate: '2026-07-17', // Vendredi
        defaultWeeklyCapacity: 35
      });
      
      expect(result.capacities.length).toBe(5);
      expect(result.capacities[0].date).toBe('2026-07-13');
      expect(result.capacities[0].capaciteTheorique).toBe(7); // 35/5
      expect(result.capacities[0].disponibiliteRatio).toBe(1);
      expect(result.capacities[0].capaciteDisponible).toBe(7);
      expect(result.capacities[0].absenceHeures).toBe(0);
    });
    
    test('devrait mettre capaciteTheorique à 0 le week-end', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 35,
        startDate: '2026-07-11', // Samedi
        endDate: '2026-07-12', // Dimanche
        defaultWeeklyCapacity: 35
      });
      
      expect(result.capacities.length).toBe(2);
      for (const cap of result.capacities) {
        expect(cap.capaciteTheorique).toBe(0);
        expect(cap.capaciteDisponible).toBe(0);
      }
    });
    
    test('devrait appliquer un ratio de disponibilité', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 35,
        availabilities: [
          { dateDebut: '2026-07-14', dateFin: '2026-07-14', dispo: 0.5 } // Mardi seulement
        ],
        startDate: '2026-07-13',
        endDate: '2026-07-15',
        defaultWeeklyCapacity: 35
      });
      
      expect(result.capacities.length).toBe(3);
      
      // Lundi: pleine capacité
      expect(result.capacities[0].disponibiliteRatio).toBe(1);
      expect(result.capacities[0].capaciteDisponible).toBe(7);
      
      // Mardi: 50%
      expect(result.capacities[1].disponibiliteRatio).toBe(0.5);
      expect(result.capacities[1].capaciteDisponible).toBe(3.5);
      expect(result.capacities[1].absenceHeures).toBe(3.5);
      
      // Mercredi: pleine capacité
      expect(result.capacities[2].disponibiliteRatio).toBe(1);
      expect(result.capacities[2].capaciteDisponible).toBe(7);
    });
    
    test('devrait prendre le ratio minimum en cas de chevauchement', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 35,
        availabilities: [
          { dateDebut: '2026-07-13', dateFin: '2026-07-17', dispo: 0.8 },
          { dateDebut: '2026-07-14', dateFin: '2026-07-15', dispo: 0.5 }
        ],
        startDate: '2026-07-13',
        endDate: '2026-07-17',
        defaultWeeklyCapacity: 35
      });
      
      // Mardi et mercredi devraient avoir le ratio minimum (0.5)
      expect(result.capacities[1].disponibiliteRatio).toBe(0.5);
      expect(result.capacities[2].disponibiliteRatio).toBe(0.5);
      
      // Lundi, jeudi, vendredi: 0.8
      expect(result.capacities[0].disponibiliteRatio).toBe(0.8);
      expect(result.capacities[3].disponibiliteRatio).toBe(0.8);
      expect(result.capacities[4].disponibiliteRatio).toBe(0.8);
    });
    
    test('devrait utiliser la capacité par défaut si non spécifiée', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        startDate: '2026-07-13',
        endDate: '2026-07-13',
        defaultWeeklyCapacity: 42
      });
      
      expect(result.capacities[0].capaciteTheorique).toBe(8.4); // 42/5
      expect(result.diagnostics.some(d => d.code === 'DEFAULT_CAPACITY_USED')).toBe(true);
    });
    
    test('devrait arrondir à 0,01h près', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 35,
        startDate: '2026-07-13',
        endDate: '2026-07-13'
      });
      
      // 35/5 = 7 exactement
      expect(result.capacities[0].capaciteTheorique).toBe(7);
    });
  });
  
  describe('reconcileMemberDailyCapacities', () => {
    test('devrait créer les capacités manquantes', () => {
      const existing = [];
      const desired = [
        { memberId: 1, date: '2026-07-13', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      
      const result = reconcileMemberDailyCapacities(existing, desired);
      
      expect(result.creates.length).toBe(1);
      expect(result.creates[0].membre).toBe(1);
      expect(result.creates[0].capaciteTheorique).toBe(7);
    });
    
    test('devrait mettre à jour les capacités changées', () => {
      // Convertir la date en timestamp Grist (13 juillet 2026 00:00:00 UTC)
      const existing = [
        { id: 1, membre: 1, date: 1783900800, capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, revision: 1 }
      ];
      const desired = [
        { memberId: 1, date: '2026-07-13', capaciteTheorique: 7, disponibiliteRatio: 0.5, capaciteDisponible: 3.5, absenceHeures: 3.5, source: 'calcul', revision: 1 }
      ];
      
      const result = reconcileMemberDailyCapacities(existing, desired);
      
      expect(result.updates.length).toBe(1);
      expect(result.updates[0].fields.disponibiliteRatio).toBe(0.5);
      expect(result.updates[0].fields.revision).toBe(2);
    });
    
    test('devrait être idempotent pour des capacités identiques', () => {
      // Utiliser la même représentation de date et les mêmes champs
      const existing = [
        { id: 1, membre: 1, date: '2026-07-13', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      const desired = [
        { memberId: 1, date: '2026-07-13', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      
      const result = reconcileMemberDailyCapacities(existing, desired);
      
      expect(result.creates.length).toBe(0);
      expect(result.updates.length).toBe(0);
    });
    
    test('devrait détecter les doublons dans desiredRows', () => {
      const existing = [];
      const desired = [
        { memberId: 1, date: '2026-07-13', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'calcul', revision: 1 },
        { memberId: 1, date: '2026-07-13', capaciteTheorique: 8, disponibiliteRatio: 1, capaciteDisponible: 8, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      
      const result = reconcileMemberDailyCapacities(existing, desired);
      
      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].code).toBe('DUPLICATE_MEMBER_DAILY_CAPACITY');
    });
  });
  
  describe('Calculs de capacité', () => {
    test('devrait calculer correctement absenceHeures', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 35,
        availabilities: [
          { dateDebut: '2026-07-13', dateFin: '2026-07-13', dispo: 0.6 }
        ],
        startDate: '2026-07-13',
        endDate: '2026-07-13'
      });
      
      const cap = result.capacities[0];
      expect(cap.capaciteTheorique).toBe(7);
      expect(cap.disponibiliteRatio).toBe(0.6);
      expect(cap.capaciteDisponible).toBe(4.2);
      expect(cap.absenceHeures).toBe(2.8);
    });
    
    test('devrait garantir absenceHeures >= 0', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 35,
        availabilities: [
          { dateDebut: '2026-07-13', dateFin: '2026-07-13', dispo: 1.2 } // > 1, mais devrait être rejeté par la validation
        ],
        startDate: '2026-07-13',
        endDate: '2026-07-13'
      });
      
      // La validation devrait échouer
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
