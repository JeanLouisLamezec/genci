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
});
