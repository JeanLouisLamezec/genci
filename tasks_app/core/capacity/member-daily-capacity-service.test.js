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
    
    test('devrait rejeter une dateDebut absente', () => {
      const result = validateCapacityInput({
        weeklyCapacity: 35,
        defaultWeeklyCapacity: 35,
        availabilities: [
          { dateFin: '2026-07-05', dispo: 0.5 }
        ]
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_AVAILABILITY_DATE')).toBe(true);
    });
    
    test('devrait rejeter une dateFin absente', () => {
      const result = validateCapacityInput({
        weeklyCapacity: 35,
        defaultWeeklyCapacity: 35,
        availabilities: [
          { dateDebut: '2026-07-01', dispo: 0.5 }
        ]
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_AVAILABILITY_DATE')).toBe(true);
    });
    
    test('devrait rejeter une date ISO invalide', () => {
      const result = validateCapacityInput({
        weeklyCapacity: 35,
        defaultWeeklyCapacity: 35,
        availabilities: [
          { dateDebut: 'not-a-date', dateFin: '2026-07-05', dispo: 0.5 }
        ]
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_AVAILABILITY_DATE')).toBe(true);
    });
    
    test('devrait rejeter une date civile impossible (2026-02-30)', () => {
      const result = validateCapacityInput({
        weeklyCapacity: 35,
        defaultWeeklyCapacity: 35,
        availabilities: [
          { dateDebut: '2026-02-30', dateFin: '2026-03-05', dispo: 0.5 }
        ]
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_AVAILABILITY_DATE')).toBe(true);
    });
    
    test('devrait accepter un timestamp Grist fini', () => {
      // 2026-07-01 00:00:00 UTC = 1783900800
      const result = validateCapacityInput({
        weeklyCapacity: 35,
        defaultWeeklyCapacity: 35,
        availabilities: [
          { dateDebut: 1783900800, dateFin: 1784160000, dispo: 0.5 }
        ]
      });
      
      expect(result.valid).toBe(true);
    });
    
    test('devrait rejeter Infinity comme timestamp', () => {
      const result = validateCapacityInput({
        weeklyCapacity: 35,
        defaultWeeklyCapacity: 35,
        availabilities: [
          { dateDebut: Infinity, dateFin: '2026-07-05', dispo: 0.5 }
        ]
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_AVAILABILITY_DATE')).toBe(true);
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
  
  describe('Doublons de capacités', () => {
    test('2 lignes existantes pour même membre + date → conflit avec les 2 IDs', () => {
      const existing = [
        { id: 1, membre: 1, date: '2026-07-15', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, revision: 1 },
        { id: 2, membre: 1, date: '2026-07-15', capaciteTheorique: 8, disponibiliteRatio: 1, capaciteDisponible: 8, absenceHeures: 0, revision: 1 }
      ];
      const desired = [
        { memberId: 1, date: '2026-07-15', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      
      const result = reconcileMemberDailyCapacities(existing, desired);
      
      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].code).toBe('DUPLICATE_MEMBER_DAILY_CAPACITY');
      expect(result.conflicts[0].entryIds).toEqual([1, 2]);
      expect(result.conflicts[0].memberId).toBe(1);
      expect(result.conflicts[0].date).toBe('2026-07-15');
      
      // Aucune mise à jour ne doit être produite
      expect(result.updates.length).toBe(0);
    });
    
    test('2 lignes désirées identiques → conflit, aucune création', () => {
      const existing = [];
      const desired = [
        { memberId: 1, date: '2026-07-15', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'calcul', revision: 1 },
        { memberId: 1, date: '2026-07-15', capaciteTheorique: 8, disponibiliteRatio: 1, capaciteDisponible: 8, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      
      const result = reconcileMemberDailyCapacities(existing, desired);
      
      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].code).toBe('DUPLICATE_MEMBER_DAILY_CAPACITY');
      
      // Aucune création ne doit être produite
      expect(result.creates.length).toBe(0);
    });
  });
  
  describe('Priorité des sources', () => {
    test('manuel existant + calcul désiré → aucune mise à jour', () => {
      const existing = [
        { id: 1, membre: 1, date: '2026-07-15', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'manuel', revision: 1 }
      ];
      const desired = [
        { memberId: 1, date: '2026-07-15', capaciteTheorique: 8, disponibiliteRatio: 1, capaciteDisponible: 8, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      
      const result = reconcileMemberDailyCapacities(existing, desired);
      
      expect(result.updates.length).toBe(0);
    });
    
    test('calcul existant + Lucca désiré → mise à jour', () => {
      const existing = [
        { id: 1, membre: 1, date: '2026-07-15', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      const desired = [
        { memberId: 1, date: '2026-07-15', capaciteTheorique: 8, disponibiliteRatio: 1, capaciteDisponible: 8, absenceHeures: 0, source: 'Lucca', revision: 1 }
      ];
      
      const result = reconcileMemberDailyCapacities(existing, desired);
      
      expect(result.updates.length).toBe(1);
      expect(result.updates[0].fields.source).toBe('Lucca');
    });
    
    test('Lucca existant + calcul désiré → aucune mise à jour', () => {
      const existing = [
        { id: 1, membre: 1, date: '2026-07-15', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'Lucca', revision: 1 }
      ];
      const desired = [
        { memberId: 1, date: '2026-07-15', capaciteTheorique: 8, disponibiliteRatio: 1, capaciteDisponible: 8, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      
      const result = reconcileMemberDailyCapacities(existing, desired);
      
      expect(result.updates.length).toBe(0);
    });
  });
  
  describe('Protection historique', () => {
    test('capacité passée différente → aucune mise à jour', () => {
      const existing = [
        { id: 1, membre: 1, date: '2026-07-10', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      const desired = [
        { memberId: 1, date: '2026-07-10', capaciteTheorique: 8, disponibiliteRatio: 1, capaciteDisponible: 8, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      
      const result = reconcileMemberDailyCapacities(existing, desired, {
        todayIso: '2026-07-15'
      });
      
      expect(result.updates.length).toBe(0);
    });
    
    test('forceHistoricalRebuild = true → mise à jour autorisée', () => {
      const existing = [
        { id: 1, membre: 1, date: '2026-07-10', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      const desired = [
        { memberId: 1, date: '2026-07-10', capaciteTheorique: 8, disponibiliteRatio: 1, capaciteDisponible: 8, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      
      const result = reconcileMemberDailyCapacities(existing, desired, {
        todayIso: '2026-07-15',
        forceHistoricalRebuild: true
      });
      
      expect(result.updates.length).toBe(1);
    });
    
    test('capacité future différente → mise à jour autorisée', () => {
      const existing = [
        { id: 1, membre: 1, date: '2026-07-20', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      const desired = [
        { memberId: 1, date: '2026-07-20', capaciteTheorique: 8, disponibiliteRatio: 1, capaciteDisponible: 8, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      
      const result = reconcileMemberDailyCapacities(existing, desired, {
        todayIso: '2026-07-15'
      });
      
    expect(result.updates.length).toBe(1);
  });
});

describe('Member Daily Capacity Service - Options de protection', () => {
  
  const { ensureMemberDailyCapacities } = require('./member-daily-capacity-service.js');
  const { createMockGrist } = require('../grist/mock-grist.js');
  
  test('Test A - passé protégé (todayIso = 2026-07-16)', async () => {
    const mockGrist = createMockGrist({
      initialData: {
        TaskAssignments: [],
        Tasks: [],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: [
          {
            id: 1,
            membre: 1,
            date: 1783814400, // 2026-07-15
            capaciteTheorique: 7,
            disponibiliteRatio: 1,
            capaciteDisponible: 7,
            absenceHeures: 0,
            source: 'calcul',
            revision: 1
          }
        ]
      }
    });
    
    // todayIso = 2026-07-16, donc 2026-07-15 est dans le passé protégé
    const result = await ensureMemberDailyCapacities(mockGrist, 1, '2026-07-15', '2026-07-15', {
      weeklyCapacity: 35,
      defaultWeeklyCapacity: 35,
      todayIso: '2026-07-16',
      forceHistoricalRebuild: false
    });
    
    expect(result.success).toBe(true);
    // Le passé est protégé : soit aucune action, soit seulement des créations si la capacité n'existait pas
    // Vérifions que la capacité existante n'a pas été modifiée
    const caps = await mockGrist.fetchTable('MemberDailyCapacities');
    const cap15 = caps.id.length > 0 && caps.date.includes(1783814400) ? 
      { capaciteTheorique: caps.capaciteTheorique[caps.date.indexOf(1783814400)] } : null;
    // La capacité du 2026-07-15 devrait être préservée (7h)
    expect(cap15).not.toBeNull();
    expect(cap15.capaciteTheorique).toBe(7);
  });
  
  test('Test B - futur recalculable', async () => {
    const mockGrist = createMockGrist({
      initialData: {
        TaskAssignments: [],
        Tasks: [],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: [] //vide au départ
      }
    });
    
    // todayIso = 2026-07-16, donc 2026-07-17 est dans le futur
    const result = await ensureMemberDailyCapacities(mockGrist, 1, '2026-07-17', '2026-07-17', {
      weeklyCapacity: 35,
      defaultWeeklyCapacity: 35,
      todayIso: '2026-07-16'
    });
    
    expect(result.success).toBe(true);
    // La capacité devrait être créée avec 7h (35/5)
    const caps = await mockGrist.fetchTable('MemberDailyCapacities');
    expect(caps.id.length).toBe(1);
    expect(caps.capaciteTheorique[0]).toBe(7);
  });
  
  test('Test C - reconstruction historique forcée', async () => {
    const mockGrist = createMockGrist({
      initialData: {
        TaskAssignments: [],
        Tasks: [],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: [] //vide au départ
      }
    });
    
    // todayIso = 2026-07-16, donc 2026-07-15 est dans le passé
    // Mais avec forceHistoricalRebuild=true, on peut créer dans le passé
    const result = await ensureMemberDailyCapacities(mockGrist, 1, '2026-07-15', '2026-07-15', {
      weeklyCapacity: 35,
      defaultWeeklyCapacity: 35,
      todayIso: '2026-07-16',
      forceHistoricalRebuild: true
    });
    
    expect(result.success).toBe(true);
    // La capacité devrait être créée même dans le passé
    const caps = await mockGrist.fetchTable('MemberDailyCapacities');
    expect(caps.id.length).toBe(1);
    expect(caps.capaciteTheorique[0]).toBe(7);
  });
  
  test('Test D - source manuelle protégée', () => {
    const { reconcileMemberDailyCapacities } = require('./member-daily-capacity-service.js');
    
    // Capacité existante avec source manuelle
    const existing = [
      { id: 1, membre: 1, date: '2026-07-17', capaciteTheorique: 5, disponibiliteRatio: 1, capaciteDisponible: 5, absenceHeures: 2, source: 'manuel', revision: 1 }
    ];
    // Capacité désirée avec source calcul
    const desired = [
      { memberId: 1, date: '2026-07-17', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'calcul', revision: 1 }
    ];
    
    const result = reconcileMemberDailyCapacities(existing, desired, {
      todayIso: '2026-07-16' // 2026-07-17 est dans le futur
    });
    
    // Aucune mise à jour car la source manuelle a priorité
    expect(result.updates.length).toBe(0);
  });
  
  test('Test E - override explicite', () => {
    const { reconcileMemberDailyCapacities } = require('./member-daily-capacity-service.js');
    
    // Capacité existante avec source manuelle
    const existing = [
      { id: 1, membre: 1, date: '2026-07-17', capaciteTheorique: 5, disponibiliteRatio: 1, capaciteDisponible: 5, absenceHeures: 2, source: 'manuel', revision: 1 }
    ];
    // Capacité désirée avec source calcul
    const desired = [
      { memberId: 1, date: '2026-07-17', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'calcul', revision: 1 }
    ];
    
    const result = reconcileMemberDailyCapacities(existing, desired, {
      todayIso: '2026-07-16',
      forceSourceOverride: true // Ignore la priorité des sources
    });
    
    // Mise à jour autorisée car forceSourceOverride = true
    expect(result.updates.length).toBe(1);
    expect(result.updates[0].fields.source).toBe('calcul');
  });
  
  test('Test F - propagation via l adaptateur', async () => {
    const { reconcileAssignmentPlan } = require('../grist/grist-planning-adapter.js');
    
    const mockGrist = createMockGrist({
      initialData: {
        TaskAssignments: [
          {
            id: 1,
            tache: 1,
            membre: 1,
            heuresAllouees: 35,
            dateDebut: 1783900800, // 2026-07-16
            dateFin: 1783987200,   // 2026-07-17 (1 jour seulement)
            actif: true
          }
        ],
        Tasks: [{ id: 1, titre: 'Tâche 1' }],
        Team: [{ id: 1, nom: 'Alice', capaciteHebdo: 35 }],
        TimeEntries: [],
        Feuilles: [],
        Disponibilites: [],
        MemberDailyCapacities: [
          {
            id: 1,
            membre: 1,
            date: 1783987200, // 2026-07-17
            capaciteTheorique: 5,
            disponibiliteRatio: 1,
            capaciteDisponible: 5,
            absenceHeures: 2,
            source: 'manuel',
            revision: 1
          }
        ]
      }
    });
    
    // todayIso = 2026-07-16, donc 2026-07-17 est dans le futur
    // Mais la source est 'manuel', donc protégée sauf override
    const result = await reconcileAssignmentPlan(mockGrist, 1, {
      dryRun: false,
      replanFromDate: '2026-07-16',
      todayIso: '2026-07-16'
      // forceSourceOverride n'est pas passé, donc la source manuelle est protégée
    });
    
    expect(result.success).toBe(true);
    
    // Vérifier que la capacité manuelle existe toujours
    const caps = await mockGrist.fetchTable('MemberDailyCapacities');
    expect(caps.id.length).toBeGreaterThan(0);
    
    // Trouver la capacité avec source manuelle
    const hasManuelSource = caps.source && caps.source.includes('manuel');
    expect(hasManuelSource).toBe(true);
  });
});

describe('Member Daily Capacity Service - Tests complémentaires (spécifications lot 1)', () => {
  
  const { isWeekdayIso } = require('../planning/planning-engine.js');
  
  describe('Helper isWeekdayIso', () => {
    test('devrait retourner true pour lundi-vendredi', () => {
      expect(isWeekdayIso('2026-07-13')).toBe(true); // Lundi
      expect(isWeekdayIso('2026-07-14')).toBe(true); // Mardi
      expect(isWeekdayIso('2026-07-15')).toBe(true); // Mercredi
      expect(isWeekdayIso('2026-07-16')).toBe(true); // Jeudi
      expect(isWeekdayIso('2026-07-17')).toBe(true); // Vendredi
    });
    
    test('devrait retourner false pour samedi-dimanche', () => {
      expect(isWeekdayIso('2026-07-11')).toBe(false); // Samedi
      expect(isWeekdayIso('2026-07-12')).toBe(false); // Dimanche
      expect(isWeekdayIso('2026-07-18')).toBe(false); // Samedi
      expect(isWeekdayIso('2026-07-19')).toBe(false); // Dimanche
    });
    
    test('devrait gérer les dates invalides', () => {
      expect(isWeekdayIso('invalid')).toBe(false);
      expect(isWeekdayIso('')).toBe(false);
      expect(isWeekdayIso(null)).toBe(false);
    });
  });
  
  describe('8.1. Semaine complète incluant le week-end (35h)', () => {
    test('devrait produire 7 lignes avec 35h théoriques totales', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 35,
        startDate: '2026-07-13', // Lundi
        endDate: '2026-07-19', // Dimanche
        defaultWeeklyCapacity: 35
      });
      
      expect(result.capacities.length).toBe(7);
      
      // Lundi à vendredi: 7h
      for (let i = 0; i < 5; i++) {
        expect(result.capacities[i].capaciteTheorique).toBe(7);
        expect(result.capacities[i].capaciteDisponible).toBe(7);
      }
      
      // Samedi et dimanche: 0h
      expect(result.capacities[5].capaciteTheorique).toBe(0);
      expect(result.capacities[5].capaciteDisponible).toBe(0);
      expect(result.capacities[6].capaciteTheorique).toBe(0);
      expect(result.capacities[6].capaciteDisponible).toBe(0);
      
      // Somme théorique: 35h
      const totalTheorique = result.capacities.reduce((sum, cap) => sum + cap.capaciteTheorique, 0);
      expect(totalTheorique).toBe(35);
      
      // Somme disponible: 35h
      const totalDisponible = result.capacities.reduce((sum, cap) => sum + cap.capaciteDisponible, 0);
      expect(totalDisponible).toBe(35);
    });
  });
  
  describe('8.2. Capacité hebdomadaire de 21h', () => {
    test('devrait produire 4,2h par jour ouvré', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 21,
        startDate: '2026-07-13',
        endDate: '2026-07-17',
        defaultWeeklyCapacity: 35
      });
      
      expect(result.capacities.length).toBe(5);
      
      for (const cap of result.capacities) {
        expect(cap.capaciteTheorique).toBe(4.2); // 21/5
        expect(cap.capaciteDisponible).toBe(4.2);
      }
    });
    
    test('devrait produire 0h le week-end', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 21,
        startDate: '2026-07-11',
        endDate: '2026-07-12',
        defaultWeeklyCapacity: 35
      });
      
      expect(result.capacities.length).toBe(2);
      
      for (const cap of result.capacities) {
        expect(cap.capaciteTheorique).toBe(0);
        expect(cap.capaciteDisponible).toBe(0);
      }
    });
  });
  
  describe('8.3. Mois réel de juillet 2026 (21h/semaine)', () => {
    test('devrait totaliser 96,6h sur 23 jours ouvrés', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 21,
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        defaultWeeklyCapacity: 35
      });
      
      // Juillet 2026: 1er (Mer) au 31 (Ven)
      // Jours ouvrés: 23 (sans jours fériés)
      expect(result.capacities.length).toBe(31);
      
      const weekdayCapacities = result.capacities.filter(cap => cap.capaciteTheorique > 0);
      expect(weekdayCapacities.length).toBe(23);
      
      const totalTheorique = result.capacities.reduce((sum, cap) => sum + cap.capaciteTheorique, 0);
      expect(totalTheorique).toBeCloseTo(96.6, 1); // 23 * 4.2 = 96.6
    });
  });
  
  describe('8.4. Mois réel d\'août 2026 (21h/semaine)', () => {
    test('devrait totaliser 88,2h sur 21 jours ouvrés', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 21,
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        defaultWeeklyCapacity: 35
      });
      
      expect(result.capacities.length).toBe(31);
      
      const weekdayCapacities = result.capacities.filter(cap => cap.capaciteTheorique > 0);
      expect(weekdayCapacities.length).toBe(21);
      
      const totalTheorique = result.capacities.reduce((sum, cap) => sum + cap.capaciteTheorique, 0);
      expect(totalTheorique).toBeCloseTo(88.2, 1); // 21 * 4.2 = 88.2
    });
  });
  
  describe('8.5. Mois de février non bissextile (2027)', () => {
    test('devrait avoir 28 jours sans débordement sur mars', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 35,
        startDate: '2027-02-01',
        endDate: '2027-02-28',
        defaultWeeklyCapacity: 35
      });
      
      expect(result.capacities.length).toBe(28);
      expect(result.capacities[0].date).toBe('2027-02-01');
      expect(result.capacities[27].date).toBe('2027-02-28');
      
      // Vérifier qu'aucune date de mars n'est incluse
      for (const cap of result.capacities) {
        expect(cap.date.startsWith('2027-02')).toBe(true);
      }
    });
  });
  
  describe('8.6. Mois de février bissextile (2028)', () => {
    test('devrait avoir 29 jours avec le 29 février', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 35,
        startDate: '2028-02-01',
        endDate: '2028-02-29',
        defaultWeeklyCapacity: 35
      });
      
      expect(result.capacities.length).toBe(29);
      expect(result.capacities[28].date).toBe('2028-02-29');
    });
  });
  
  describe('8.7. Absence totale sur une semaine ouvrée', () => {
    test('devrait avoir 0h disponible mais 7h théoriques', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 35,
        availabilities: [
          { dateDebut: '2026-07-13', dateFin: '2026-07-17', dispo: 0 }
        ],
        startDate: '2026-07-13',
        endDate: '2026-07-19',
        defaultWeeklyCapacity: 35
      });
      
      // Lundi à vendredi
      for (let i = 0; i < 5; i++) {
        expect(result.capacities[i].capaciteTheorique).toBe(7);
        expect(result.capacities[i].capaciteDisponible).toBe(0);
        expect(result.capacities[i].absenceHeures).toBe(7);
      }
      
      // Week-end
      expect(result.capacities[5].capaciteTheorique).toBe(0);
      expect(result.capacities[6].capaciteTheorique).toBe(0);
      
      // Somme disponible: 0h
      const totalDisponible = result.capacities.slice(0, 5).reduce((sum, cap) => sum + cap.capaciteDisponible, 0);
      expect(totalDisponible).toBe(0);
    });
  });
  
  describe('8.8. Absence limitée au week-end', () => {
    test('ne devrait avoir aucun effet sur les jours ouvrés', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 35,
        availabilities: [
          { dateDebut: '2026-07-11', dateFin: '2026-07-12', dispo: 0 }
        ],
        startDate: '2026-07-13',
        endDate: '2026-07-17',
        defaultWeeklyCapacity: 35
      });
      
      // Tous les jours ouvrés devraient avoir pleine capacité
      for (const cap of result.capacities) {
        expect(cap.capaciteTheorique).toBe(7);
        expect(cap.capaciteDisponible).toBe(7);
        expect(cap.absenceHeures).toBe(0);
      }
    });
  });
  
  describe('8.9. Disponibilité à 50%', () => {
    test('devrait réduire la capacité disponible de moitié', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 35,
        availabilities: [
          { dateDebut: '2026-07-15', dateFin: '2026-07-15', dispo: 0.5 } // Mercredi seulement
        ],
        startDate: '2026-07-15',
        endDate: '2026-07-15',
        defaultWeeklyCapacity: 35
      });
      
      expect(result.capacities.length).toBe(1);
      expect(result.capacities[0].capaciteTheorique).toBe(7);
      expect(result.capacities[0].disponibiliteRatio).toBe(0.5);
      expect(result.capacities[0].capaciteDisponible).toBe(3.5);
      expect(result.capacities[0].absenceHeures).toBe(3.5);
    });
  });
  
  describe('8.10. Chevauchement de disponibilités', () => {
    test('devrait appliquer le ratio minimum', () => {
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
      
      // Lundi: 0.8
      expect(result.capacities[0].disponibiliteRatio).toBe(0.8);
      
      // Mardi et mercredi: 0.5 (minimum)
      expect(result.capacities[1].disponibiliteRatio).toBe(0.5);
      expect(result.capacities[2].disponibiliteRatio).toBe(0.5);
      
      // Jeudi et vendredi: 0.8
      expect(result.capacities[3].disponibiliteRatio).toBe(0.8);
      expect(result.capacities[4].disponibiliteRatio).toBe(0.8);
    });
  });
  
  describe('8.11. Bornes inclusives', () => {
    test('devrait appliquer la disponibilité sur un seul jour', () => {
      const result = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 35,
        availabilities: [
          { dateDebut: '2026-07-15', dateFin: '2026-07-15', dispo: 0.5 }
        ],
        startDate: '2026-07-13',
        endDate: '2026-07-17',
        defaultWeeklyCapacity: 35
      });
      
      // Seul le mercredi (index 2) devrait avoir 0.5
      expect(result.capacities[0].disponibiliteRatio).toBe(1);
      expect(result.capacities[1].disponibiliteRatio).toBe(1);
      expect(result.capacities[2].disponibiliteRatio).toBe(0.5);
      expect(result.capacities[3].disponibiliteRatio).toBe(1);
      expect(result.capacities[4].disponibiliteRatio).toBe(1);
    });
  });
  
  describe('8.12. Formats de date (ISO vs timestamp Grist)', () => {
    test('devrait produire le même résultat avec ISO et timestamp', () => {
      // Format ISO
      const resultIso = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 35,
        availabilities: [
          { dateDebut: '2026-07-13', dateFin: '2026-07-15', dispo: 0.5 }
        ],
        startDate: '2026-07-13',
        endDate: '2026-07-15',
        defaultWeeklyCapacity: 35
      });
      
      // Format timestamp Grist (secondes Unix)
      // 2026-07-13 00:00:00 UTC = 1783900800
      // 2026-07-15 00:00:00 UTC = 1784073600
      const resultTimestamp = buildDesiredMemberDailyCapacities({
        memberId: 1,
        weeklyCapacity: 35,
        availabilities: [
          { dateDebut: 1783900800, dateFin: 1784073600, dispo: 0.5 }
        ],
        startDate: '2026-07-13',
        endDate: '2026-07-15',
        defaultWeeklyCapacity: 35
      });
      
      expect(resultIso.capacities.length).toBe(resultTimestamp.capacities.length);
      
      for (let i = 0; i < resultIso.capacities.length; i++) {
        expect(resultIso.capacities[i].date).toBe(resultTimestamp.capacities[i].date);
        expect(resultIso.capacities[i].capaciteTheorique).toBe(resultTimestamp.capacities[i].capaciteTheorique);
        expect(resultIso.capacities[i].capaciteDisponible).toBe(resultTimestamp.capacities[i].capaciteDisponible);
      }
    });
  });
  
  describe('8.14. Capacité future de week-end déjà incorrecte', () => {
    test('devrait corriger un samedi avec capacité positive', () => {
      const existing = [
        { id: 1, membre: 1, date: '2026-07-11', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      
      const desired = [
        { memberId: 1, date: '2026-07-11', capaciteTheorique: 0, disponibiliteRatio: 1, capaciteDisponible: 0, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      
      const result = reconcileMemberDailyCapacities(existing, desired, {
        todayIso: '2026-07-10'
      });
      
      expect(result.updates.length).toBe(1);
      expect(result.updates[0].fields.capaciteTheorique).toBe(0);
      expect(result.updates[0].fields.capaciteDisponible).toBe(0);
      expect(result.updates[0].fields.revision).toBe(2);
    });
  });
  
  describe('8.18. Idempotence', () => {
    test('devrait produire zéro action sur deuxième exécution', () => {
      const existing = [
        { id: 1, membre: 1, date: '2026-07-13', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      
      const desired = [
        { memberId: 1, date: '2026-07-13', capaciteTheorique: 7, disponibiliteRatio: 1, capaciteDisponible: 7, absenceHeures: 0, source: 'calcul', revision: 1 }
      ];
      
      const result = reconcileMemberDailyCapacities(existing, desired);
      
      expect(result.creates.length).toBe(0);
      expect(result.updates.length).toBe(0);
      expect(result.deletes.length).toBe(0);
    });
    
    test('devrait être idempotent avec ratio zéro', () => {
      const existing = [
        { id: 1, membre: 1, date: '2026-07-13', capaciteTheorique: 7, disponibiliteRatio: 0, capaciteDisponible: 0, absenceHeures: 7, source: 'calcul', revision: 1 }
      ];
      
      const desired = [
        { memberId: 1, date: '2026-07-13', capaciteTheorique: 7, disponibiliteRatio: 0, capaciteDisponible: 0, absenceHeures: 7, source: 'calcul', revision: 1 }
      ];
      
      const result = reconcileMemberDailyCapacities(existing, desired);
      
      expect(result.creates.length).toBe(0);
      expect(result.updates.length).toBe(0);
      expect(result.deletes.length).toBe(0);
    });
    
    test('deuxième réconciliation après absence totale → aucune action', () => {
      const existing = [
        { id: 1, membre: 1, date: '2026-07-13', capaciteTheorique: 7, disponibiliteRatio: 0, capaciteDisponible: 0, absenceHeures: 7, source: 'calcul', revision: 1 }
      ];
      
      const desired = [
        { memberId: 1, date: '2026-07-13', capaciteTheorique: 7, disponibiliteRatio: 0, capaciteDisponible: 0, absenceHeures: 7, source: 'calcul', revision: 1 }
      ];
      
      const result1 = reconcileMemberDailyCapacities(existing, desired);
      expect(result1.updates.length).toBe(0);
      
      // Deuxième appel identique
      const result2 = reconcileMemberDailyCapacities(existing, desired);
      expect(result2.updates.length).toBe(0);
      expect(result2.creates.length).toBe(0);
    });
  });
});
});
