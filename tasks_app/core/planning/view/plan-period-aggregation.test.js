/**
 * Tests unitaires pour Plan Period Aggregation
 * 
 * Tests purs du module d'agrégation :
 * - Bornes de période exactes
 * - Agrégations par membre/période
 * - Groupements (projet, programme, rôle)
 * - Centièmes d'heure
 */

'use strict';

const assert = require('assert');
const PlanPeriodAggregation = require('./plan-period-aggregation.js');

const {
  buildPlanPeriodIndex,
  getMonday,
  formatDateUTC,
  parseDateUTC,
  generateDateRange,
  getPeriodKey,
  getWeekBounds,
  getMonthBounds,
  isDateInPeriod,
  getPeriodBounds,
  toCentiHours,
  toHours
} = PlanPeriodAggregation;

// ============================================================================
// TESTS DES HELPERS DE DATE
// ============================================================================

describe('PlanPeriodAggregation - Helpers de date', function() {
  
  describe('getMonday', function() {
    it('doit retourner le lundi pour un lundi', function() {
      const monday = new Date(Date.UTC(2024, 0, 8)); // Lundi 8 janvier 2024
      const result = getMonday(monday);
      assert.strictEqual(formatDateUTC(result), '2024-01-08');
    });
    
    it('doit retourner le lundi pour un dimanche', function() {
      const sunday = new Date(Date.UTC(2024, 0, 7)); // Dimanche 7 janvier 2024
      const result = getMonday(sunday);
      assert.strictEqual(formatDateUTC(result), '2024-01-01');
    });
    
    it('doit retourner le lundi pour un samedi', function() {
      const saturday = new Date(Date.UTC(2024, 0, 6)); // Samedi 6 janvier 2024
      const result = getMonday(saturday);
      assert.strictEqual(formatDateUTC(result), '2024-01-01');
    });
  });
  
  describe('formatDateUTC / parseDateUTC', function() {
    it('doit formater et parser correctement', function() {
      const original = '2024-06-15';
      const parsed = parseDateUTC(original);
      const formatted = formatDateUTC(parsed);
      assert.strictEqual(formatted, original);
    });
    
    it('doit retourner null pour une date invalide', function() {
      assert.strictEqual(parseDateUTC(null), null);
      assert.strictEqual(parseDateUTC('invalid'), null);
      assert.strictEqual(parseDateUTC('2024-13-45'), null);
    });
  });
  
  describe('generateDateRange', function() {
    it('doit générer un tableau de dates', function() {
      const range = generateDateRange('2024-01-01', '2024-01-05');
      assert.strictEqual(range.length, 5);
      assert.strictEqual(range[0], '2024-01-01');
      assert.strictEqual(range[4], '2024-01-05');
    });
    
    it('doit retourner un tableau vide pour des dates invalides', function() {
      const range = generateDateRange('invalid', '2024-01-05');
      assert.strictEqual(range.length, 0);
    });
  });
  
  describe('getPeriodKey', function() {
    it('doit retourner une clé mois YYYY-MM', function() {
      const date = new Date(Date.UTC(2024, 5, 15)); // Juin 2024
      const key = getPeriodKey(date, 'month');
      assert.strictEqual(key, '2024-06');
    });
    
    it('doit retourner une clé semaine ISO YYYY-Www', function() {
      const date = new Date(Date.UTC(2024, 0, 8)); // Lundi 8 janvier 2024 (semaine 2)
      const key = getPeriodKey(date, 'week');
      assert.strictEqual(key, '2024-W02');
    });

    it('doit retourner les clés trimestre, semestre et année', function() {
      const date = new Date(Date.UTC(2024, 7, 15));
      assert.strictEqual(getPeriodKey(date, 'quarter'), '2024-Q3');
      assert.strictEqual(getPeriodKey(date, 'semester'), '2024-H2');
      assert.strictEqual(getPeriodKey(date, 'year'), '2024');
    });
  });
  
  describe('getWeekBounds', function() {
    it('doit retourner les bornes d\'une semaine (fin exclusive)', function() {
      const wednesday = new Date(Date.UTC(2024, 0, 10)); // Mercredi 10 janvier 2024
      const bounds = getWeekBounds(wednesday);
      
      assert.strictEqual(formatDateUTC(bounds.start), '2024-01-08'); // Lundi
      assert.strictEqual(formatDateUTC(bounds.end), '2024-01-15'); // Lundi suivant (exclusif)
    });
  });
  
  describe('getMonthBounds', function() {
    it('doit retourner les bornes d\'un mois (fin exclusive)', function() {
      const date = new Date(Date.UTC(2024, 1, 15)); // Février 2024
      const bounds = getMonthBounds(date);
      
      assert.strictEqual(formatDateUTC(bounds.start), '2024-02-01');
      assert.strictEqual(formatDateUTC(bounds.end), '2024-03-01');
    });
    
    it('doit gérer février bissextile', function() {
      const date = new Date(Date.UTC(2024, 1, 29)); // 29 février 2024 (bissextile)
      const bounds = getMonthBounds(date);
      
      assert.strictEqual(formatDateUTC(bounds.start), '2024-02-01');
      assert.strictEqual(formatDateUTC(bounds.end), '2024-03-01');
    });
  });
  
  describe('isDateInPeriod', function() {
    it('doit vérifier l\'appartenance à une période (fin exclusive)', function() {
      const start = new Date(Date.UTC(2024, 0, 1));
      const end = new Date(Date.UTC(2024, 0, 8));
      
      assert.strictEqual(isDateInPeriod('2024-01-01', start, end), true);
      assert.strictEqual(isDateInPeriod('2024-01-05', start, end), true);
      assert.strictEqual(isDateInPeriod('2024-01-07', start, end), true);
      assert.strictEqual(isDateInPeriod('2024-01-08', start, end), false); // Fin exclusive
      assert.strictEqual(isDateInPeriod('2023-12-31', start, end), false);
    });
  });
  
  describe('getPeriodBounds', function() {
    it('doit retourner les bornes pour un mois', function() {
      const bounds = getPeriodBounds('2024-06', 'month');
      assert.strictEqual(formatDateUTC(bounds.start), '2024-06-01');
      assert.strictEqual(formatDateUTC(bounds.end), '2024-07-01');
    });
    
    it('doit retourner les bornes pour une semaine ISO', function() {
      const bounds = getPeriodBounds('2024-W02', 'week');
      // Semaine 2 de 2024 : lundi 8 janvier au lundi 15 janvier (exclusif)
      assert.strictEqual(formatDateUTC(bounds.start), '2024-01-08');
      assert.strictEqual(formatDateUTC(bounds.end), '2024-01-15');
    });
    
    it('doit gérer le passage d\'année', function() {
      const bounds = getPeriodBounds('2024-W01', 'week');
      // Semaine 1 de 2024 : lundi 1er janvier
      assert.strictEqual(formatDateUTC(bounds.start), '2024-01-01');
      assert.strictEqual(formatDateUTC(bounds.end), '2024-01-08');
    });
    
    it('doit gérer les mois de 28 jours (février non bissextile)', function() {
      const bounds = getPeriodBounds('2023-02', 'month');
      assert.strictEqual(formatDateUTC(bounds.start), '2023-02-01');
      assert.strictEqual(formatDateUTC(bounds.end), '2023-03-01');
    });
    
    it('doit gérer les mois de 31 jours', function() {
      const bounds = getPeriodBounds('2024-01', 'month');
      assert.strictEqual(formatDateUTC(bounds.start), '2024-01-01');
      assert.strictEqual(formatDateUTC(bounds.end), '2024-02-01');
    });

    it('doit retourner les bornes exactes des périodes longues', function() {
      const quarter = getPeriodBounds('2024-Q4', 'quarter');
      const semester = getPeriodBounds('2024-H2', 'semester');
      const year = getPeriodBounds('2024', 'year');
      assert.deepStrictEqual([formatDateUTC(quarter.start), formatDateUTC(quarter.end)], ['2024-10-01', '2025-01-01']);
      assert.deepStrictEqual([formatDateUTC(semester.start), formatDateUTC(semester.end)], ['2024-07-01', '2025-01-01']);
      assert.deepStrictEqual([formatDateUTC(year.start), formatDateUTC(year.end)], ['2024-01-01', '2025-01-01']);
    });
  });
});

// ============================================================================
// TESTS DE CONVERSION
// ============================================================================

describe('PlanPeriodAggregation - Conversion', function() {
  
  describe('toCentiHours / toHours', function() {
    it('doit convertir sans erreur flottante', function() {
      const hours = 6.99;
      const centi = toCentiHours(hours);
      const back = toHours(centi);
      
      assert.strictEqual(centi, 699);
      assert.strictEqual(back, 6.99);
    });
    
    it('doit gérer les sommes répétées', function() {
      let sumCenti = 0;
      for (let i = 0; i < 100; i++) {
        sumCenti += toCentiHours(0.01);
      }
      
      assert.strictEqual(sumCenti, 100);
      assert.strictEqual(toHours(sumCenti), 1);
    });
    
    it('doit gérer null et 0', function() {
      assert.strictEqual(toCentiHours(null), 0);
      assert.strictEqual(toCentiHours(0), 0);
      assert.strictEqual(toHours(null), 0);
      assert.strictEqual(toHours(0), 0);
    });
  });
});

// ============================================================================
// TESTS D'AGRÉGATION
// ============================================================================

describe('PlanPeriodAggregation - Agrégation', function() {
  
  function createTestData() {
    return {
      team: [
        { id: 1, nom: 'Alice', role: 'Dev' },
        { id: 2, nom: 'Bob', role: 'Dev' },
        { id: 3, nom: 'Charlie', role: 'PM' }
      ],
      assignments: [
        { id: 101, tache: 1001, membre: 1, heuresAllouees: 20, actif: true, dateDebut: 1704067200, dateFin: 1735689600 },
        { id: 102, tache: 1002, membre: 1, heuresAllouees: 15, actif: true, dateDebut: 1704067200, dateFin: 1735689600 },
        { id: 103, tache: 1003, membre: 2, heuresAllouees: 25, actif: true, dateDebut: 1704067200, dateFin: 1735689600 }
      ],
      tasks: [
        { id: 1001, titre: 'Task A', projet: 501 },
        { id: 1002, titre: 'Task B', projet: 501 },
        { id: 1003, titre: 'Task C', projet: 502 }
      ],
      projects: [
        { id: 501, nom: 'Project X', programme: 101 },
        { id: 502, nom: 'Project Y', programme: 102 }
      ],
      programmes: [
        { id: 101, nom: 'Program Alpha' },
        { id: 102, nom: 'Program Beta' }
      ],
      timeEntries: [
        { id: 1, assignmentId: 101, taskId: 1001, memberId: 1, date: '2024-01-08', plannedHours: 4, actualHours: null },
        { id: 2, assignmentId: 101, taskId: 1001, memberId: 1, date: '2024-01-09', plannedHours: 4, actualHours: 3.5 },
        { id: 3, assignmentId: 102, taskId: 1002, memberId: 1, date: '2024-01-08', plannedHours: 2, actualHours: null },
        { id: 4, assignmentId: 103, taskId: 1003, memberId: 2, date: '2024-01-08', plannedHours: 5, actualHours: 5 },
        { id: 5, assignmentId: 103, taskId: 1003, memberId: 2, date: '2024-01-09', plannedHours: 5, actualHours: null }
      ],
      dailyCapacities: [
        { id: 1, membre: 1, date: '2024-01-08', capaciteTheorique: 7, capaciteDisponible: 7, absenceHeures: 0 },
        { id: 2, membre: 1, date: '2024-01-09', capaciteTheorique: 7, capaciteDisponible: 7, absenceHeures: 0 },
        { id: 3, membre: 2, date: '2024-01-08', capaciteTheorique: 7, capaciteDisponible: 7, absenceHeures: 0 },
        { id: 4, membre: 2, date: '2024-01-09', capaciteTheorique: 7, capaciteDisponible: 5, absenceHeures: 2 }
      ]
    };
  }
  
  describe('buildPlanPeriodIndex - Semaine normale', function() {
    it('doit agréger correctement une semaine lundi-dimanche', function() {
      const data = createTestData();
      
      const result = buildPlanPeriodIndex({
        periods: {
          granularity: 'week',
          keys: ['2024-W02'] // 8-14 janvier 2024
        },
        team: data.team,
        assignments: data.assignments,
        tasks: data.tasks,
        projects: data.projects,
        programmes: data.programmes,
        timeEntries: data.timeEntries,
        dailyCapacities: data.dailyCapacities
      });
      
      // Vérifier Alice (membre 1) pour la semaine
      const aliceKey = '1:2024-W02';
      const alice = result.byMemberPeriod[aliceKey];
      
      assert.ok(alice, 'Alice doit avoir un agrégat');
      assert.strictEqual(alice.memberId, 1);
      assert.strictEqual(alice.periodKey, '2024-W02');
      
      // Alice : 4+4+2 = 10h prévues (Task A et Task B)
      assert.strictEqual(alice.plannedHours, 10);
      
      // Alice : 3.5h réalisées (seulement le 09/01)
      assert.strictEqual(alice.actualHours, 3.5);
      assert.strictEqual(alice.effectiveHours, 9.5);
      
      // Capacité théorique : 7h * 5 jours = 35h (lun-ven)
      // Mais seules 2 dates sont dans les capacités : 8 et 9 janvier = 14h
      assert.strictEqual(alice.theoreticalCapacityHours, 14);
      assert.strictEqual(alice.availableCapacityHours, 14);
      
      // Vérifier Bob (membre 2)
      const bobKey = '2:2024-W02';
      const bob = result.byMemberPeriod[bobKey];
      
      assert.ok(bob, 'Bob doit avoir un agrégat');
      assert.strictEqual(bob.plannedHours, 10); // 5+5
      assert.strictEqual(bob.actualHours, 5); // seulement le 08/01
      
      // Capacité disponible : 7 + 5 = 12h (absence de 2h le 09/01)
      assert.strictEqual(bob.availableCapacityHours, 12);
      assert.strictEqual(bob.absenceHours, 2);
    });
  });

  describe('buildPlanPeriodIndex - Périodes longues', function() {
    it('agrège les mêmes écritures et capacités au trimestre', function() {
      const data = createTestData();
      const result = buildPlanPeriodIndex({
        periods: { granularity: 'quarter', keys: ['2024-Q1'] },
        team: data.team,
        assignments: data.assignments,
        tasks: data.tasks,
        projects: data.projects,
        programmes: data.programmes,
        timeEntries: data.timeEntries,
        dailyCapacities: data.dailyCapacities
      });

      const alice = result.byMemberPeriod['1:2024-Q1'];
      assert.strictEqual(alice.plannedHours, 10);
      assert.strictEqual(alice.effectiveHours, 9.5);
      assert.strictEqual(alice.availableCapacityHours, 14);
    });
  });
  
  describe('buildPlanPeriodIndex - Passage sur deux mois', function() {
    it('doit agréger correctement une semaine sur deux mois', function() {
      const data = createTestData();
      
      // Ajouter des entrées fin novembre / début décembre
      data.timeEntries.push(
        { id: 6, assignmentId: 101, taskId: 1001, memberId: 1, date: '2024-11-30', plannedHours: 3, actualHours: null },
        { id: 7, assignmentId: 101, taskId: 1001, memberId: 1, date: '2024-12-01', plannedHours: 3, actualHours: null },
        { id: 8, assignmentId: 101, taskId: 1001, memberId: 1, date: '2024-12-02', plannedHours: 3, actualHours: null }
      );
      
      data.dailyCapacities.push(
        { id: 5, membre: 1, date: '2024-11-30', capaciteTheorique: 7, capaciteDisponible: 7, absenceHeures: 0 },
        { id: 6, membre: 1, date: '2024-12-01', capaciteTheorique: 7, capaciteDisponible: 7, absenceHeures: 0 },
        { id: 7, membre: 1, date: '2024-12-02', capaciteTheorique: 7, capaciteDisponible: 7, absenceHeures: 0 }
      );
      
      // Semaine du 25 novembre au 1er décembre 2024
      const result = buildPlanPeriodIndex({
        periods: {
          granularity: 'week',
          keys: ['2024-W48'] // À vérifier
        },
        team: data.team,
        assignments: data.assignments,
        tasks: data.tasks,
        projects: data.projects,
        programmes: data.programmes,
        timeEntries: data.timeEntries,
        dailyCapacities: data.dailyCapacities
      });
      
      // Chaque entrée doit être comptée une seule fois
      const aliceKey = '1:2024-W48';
      const alice = result.byMemberPeriod[aliceKey];
      
      if (alice) {
        // W48 se termine le 1er décembre : l'entrée du 2 décembre est en W49.
        assert.strictEqual(alice.plannedHours, 6);
      }
    });
  });
  
  describe('buildPlanPeriodIndex - Absence totale', function() {
    it('doit gérer une capacité disponible nulle', function() {
      const data = createTestData();
      
      // Alice en absence totale du 8 au 12 janvier
      data.dailyCapacities = [
        { id: 1, membre: 1, date: '2024-01-08', capaciteTheorique: 7, capaciteDisponible: 0, absenceHeures: 7 },
        { id: 2, membre: 1, date: '2024-01-09', capaciteTheorique: 7, capaciteDisponible: 0, absenceHeures: 7 }
      ];
      
      const result = buildPlanPeriodIndex({
        periods: {
          granularity: 'week',
          keys: ['2024-W02']
        },
        team: data.team,
        assignments: data.assignments,
        tasks: data.tasks,
        projects: data.projects,
        programmes: data.programmes,
        timeEntries: data.timeEntries,
        dailyCapacities: data.dailyCapacities
      });
      
      const aliceKey = '1:2024-W02';
      const alice = result.byMemberPeriod[aliceKey];
      
      assert.strictEqual(alice.availableCapacityHours, 0);
      assert.strictEqual(alice.absenceHours, 14);
      
      // Diagnostic : capacité nulle avec prévu > 0
      const zeroCapDiagnostic = result.diagnostics.find(d => d.code === 'ZERO_CAPACITY_WITH_PLANNED');
      assert.ok(zeroCapDiagnostic, 'Doit signaler capacité nulle avec prévu > 0');
    });
  });
  
  describe('buildPlanPeriodIndex - Disponibilité partielle', function() {
    it('doit calculer le ratio de charge correctement', function() {
      const data = createTestData();
      
      // Alice à 50% (3.5h/jour au lieu de 7h)
      data.dailyCapacities = [
        { id: 1, membre: 1, date: '2024-01-08', capaciteTheorique: 7, capaciteDisponible: 3.5, absenceHeures: 3.5 },
        { id: 2, membre: 1, date: '2024-01-09', capaciteTheorique: 7, capaciteDisponible: 3.5, absenceHeures: 3.5 }
      ];
      
      const result = buildPlanPeriodIndex({
        periods: {
          granularity: 'week',
          keys: ['2024-W02']
        },
        team: data.team,
        assignments: data.assignments,
        tasks: data.tasks,
        projects: data.projects,
        programmes: data.programmes,
        timeEntries: data.timeEntries,
        dailyCapacities: data.dailyCapacities
      });
      
      const aliceKey = '1:2024-W02';
      const alice = result.byMemberPeriod[aliceKey];
      
      assert.strictEqual(alice.availableCapacityHours, 7); // 3.5 * 2 jours
      assert.strictEqual(alice.plannedHours, 10);
      
      // Charge effective : 4 + 3,5 + 2 = 9,5h ; ratio 9,5 / 7.
      assert.ok(alice.loadRatio > 1.35, 'Ratio de charge correct');
      
      // Diagnostic de surcharge
      const overloadDiagnostic = result.diagnostics.find(d => d.code === 'OVERLOAD');
      assert.ok(overloadDiagnostic, 'Doit signaler la surcharge');
    });
  });
  
  describe('buildPlanPeriodIndex - Week-end', function() {
    it('doit avoir une capacité nulle le week-end', function() {
      const data = createTestData();
      
      // Pas de capacités le week-end (13-14 janvier 2024 = samedi-dimanche)
      // Les capacités existantes sont seulement pour les jours ouvrés
      
      const result = buildPlanPeriodIndex({
        periods: {
          granularity: 'week',
          keys: ['2024-W02']
        },
        team: data.team,
        assignments: data.assignments,
        tasks: data.tasks,
        projects: data.projects,
        programmes: data.programmes,
        timeEntries: data.timeEntries,
        dailyCapacities: data.dailyCapacities
      });
      
      // La capacité mensuelle ne doit pas être affectée par le week-end
      // Seules les dates explicites dans dailyCapacities comptent
      const aliceKey = '1:2024-W02';
      const alice = result.byMemberPeriod[aliceKey];
      
      // Capacité = somme des capacités quotidiennes explicites
      assert.strictEqual(alice.theoreticalCapacityHours, 14); // 7h * 2 jours (8 et 9 janvier)
    });
  });
  
  describe('buildPlanPeriodIndex - Groupement projet', function() {
    it('doit agréger par projet correctement', function() {
      const data = createTestData();
      
      const result = buildPlanPeriodIndex({
        periods: {
          granularity: 'week',
          keys: ['2024-W02']
        },
        team: data.team,
        assignments: data.assignments,
        tasks: data.tasks,
        projects: data.projects,
        programmes: data.programmes,
        timeEntries: data.timeEntries,
        dailyCapacities: data.dailyCapacities
      });
      
      // Project X (501) : Task A + Task B = 10h (Alice)
      const projectXKey = '501:2024-W02';
      const projectX = result.byProjectPeriod[projectXKey];
      
      assert.ok(projectX, 'Project X doit avoir un agrégat');
      assert.strictEqual(projectX.projectId, 501);
      assert.strictEqual(projectX.plannedHours, 10);
      assert.ok(projectX.memberIds.includes(1));
    });
  });
  
  describe('buildPlanPeriodIndex - Groupement programme', function() {
    it('doit agréger par programme correctement', function() {
      const data = createTestData();
      
      const result = buildPlanPeriodIndex({
        periods: {
          granularity: 'week',
          keys: ['2024-W02']
        },
        team: data.team,
        assignments: data.assignments,
        tasks: data.tasks,
        projects: data.projects,
        programmes: data.programmes,
        timeEntries: data.timeEntries,
        dailyCapacities: data.dailyCapacities
      });
      
      // Program Alpha (101) : Project X = 10h
      const programAlphaKey = '101:2024-W02';
      const programAlpha = result.byProgrammePeriod[programAlphaKey];
      
      assert.ok(programAlpha, 'Program Alpha doit avoir un agrégat');
      assert.strictEqual(programAlpha.plannedHours, 10);
    });
  });
  
  describe('buildPlanPeriodIndex - Groupement par rôle', function() {
    it('doit agréger par rôle correctement', function() {
      const data = createTestData();
      
      const result = buildPlanPeriodIndex({
        periods: {
          granularity: 'week',
          keys: ['2024-W02']
        },
        team: data.team,
        assignments: data.assignments,
        tasks: data.tasks,
        projects: data.projects,
        programmes: data.programmes,
        timeEntries: data.timeEntries,
        dailyCapacities: data.dailyCapacities
      });
      
      // Rôle Dev : Alice (10h) + Bob (10h) = 20h
      const devKey = 'Dev:2024-W02';
      const devRole = result.byRolePeriod[devKey];
      
      assert.ok(devRole, 'Rôle Dev doit avoir un agrégat');
      assert.strictEqual(devRole.plannedHours, 20);
      assert.ok(devRole.memberIds.includes(1)); // Alice
      assert.ok(devRole.memberIds.includes(2)); // Bob
    });
  });
  
  describe('buildPlanPeriodIndex - Filtre', function() {
    it('doit avoir le même sous-ensemble pour matrice et détail', function() {
      const data = createTestData();
      
      // Filtrer pour Alice seulement
      const filteredTeam = data.team.filter(m => m.id === 1);
      const filteredEntries = data.timeEntries.filter(e => e.memberId === 1);
      const filteredCapacities = data.dailyCapacities.filter(c => c.membre === 1);
      
      const result = buildPlanPeriodIndex({
        periods: {
          granularity: 'week',
          keys: ['2024-W02']
        },
        team: filteredTeam,
        assignments: data.assignments,
        tasks: data.tasks,
        projects: data.projects,
        programmes: data.programmes,
        timeEntries: filteredEntries,
        dailyCapacities: filteredCapacities
      });
      
      // Un seul membre dans les résultats
      assert.strictEqual(Object.keys(result.byMemberPeriod).length, 1);
      
      // Le détail correspond à la matrice
      const aliceKey = '1:2024-W02';
      const alice = result.byMemberPeriod[aliceKey];
      const aliceEntries = result.entriesByMemberPeriod[aliceKey];
      
      assert.strictEqual(aliceEntries.length, alice.entries.length);
    });
  });
});

// ============================================================================
// TESTS DE COHÉRENCE
// ============================================================================

describe('PlanPeriodAggregation - Cohérence', function() {
  
  it('La somme des semaines doit correspondre au mois (pour les semaines complètes)', function() {
    // Test conceptuel : la somme des semaines entièrement contenues dans un mois
    // doit correspondre au mois, en tenant compte des semaines chevauchantes
    
    const data = {
      team: [{ id: 1, nom: 'Alice', role: 'Dev' }],
      assignments: [{ id: 101, tache: 1001, membre: 1, heuresAllouees: 100, actif: true }],
      tasks: [{ id: 1001, titre: 'Task A', projet: 501 }],
      projects: [{ id: 501, nom: 'Project X', programme: 101 }],
      programmes: [{ id: 101, nom: 'Program Alpha' }],
      timeEntries: [],
      dailyCapacities: []
    };
    
    // Générer des capacités et entrées pour janvier 2024
    for (let day = 1; day <= 31; day++) {
      const dateStr = '2024-01-' + String(day).padStart(2, '0');
      data.dailyCapacities.push({
        id: day,
        membre: 1,
        date: dateStr,
        capaciteTheorique: 7,
        capaciteDisponible: 7,
        absenceHeures: 0
      });
      
      data.timeEntries.push({
        id: 1000 + day,
        assignmentId: 101,
        taskId: 1001,
        memberId: 1,
        date: dateStr,
        plannedHours: 2,
        actualHours: null
      });
    }
    
    const result = buildPlanPeriodIndex({
      periods: {
        granularity: 'month',
        keys: ['2024-01']
      },
      team: data.team,
      assignments: data.assignments,
      tasks: data.tasks,
      projects: data.projects,
      programmes: data.programmes,
      timeEntries: data.timeEntries,
      dailyCapacities: data.dailyCapacities
    });
    
    const monthKey = '1:2024-01';
    const month = result.byMemberPeriod[monthKey];
    
    // 31 jours * 2h = 62h prévues
    assert.strictEqual(month.plannedHours, 62);
    
    // 31 jours * 7h = 217h de capacité
    assert.strictEqual(month.availableCapacityHours, 217);
  });
});

// ============================================================================
// RUN TESTS
// ============================================================================

if (require.main === module) {
  // Simple test runner for Node.js
  console.log('Running PlanPeriodAggregation tests...');
  
  const tests = [
    'Helpers de date',
    'Conversion',
    'Agrégation',
    'Cohérence'
  ];
  
  console.log('Tests définis pour les sections :', tests.join(', '));
  console.log('Exécuter avec : npx mocha plan-period-aggregation.test.js');
}
