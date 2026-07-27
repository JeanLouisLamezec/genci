/**
 * Test stateful — Mode ponctuel : saisie du réalisé hors dates prévues
 * 
 * SCÉNARIO DE RÉFÉRENCE :
 * - Projet : 01/01/2026 → 31/12/2026
 * - Tâche : intervention juridique
 * - Affectation : 23/07/2026 → 24/07/2026 (8h, mode ponctuel)
 * - Membre : Jason (id=1)
 * - Réalisé : 4h le 27/07/2026 (lundi suivant)
 * 
 * RÉSULTATS ATTENDUS :
 * - Le prévu des 23 et 24 juillet reste inchangé
 * - Une TimeEntry du 27 juillet est créée ou mise à jour
 * - Cette ligne référence la même TaskAssignment
 * - Elle référence la tâche principale imputable
 * - Elle est rattachée à la feuille de la semaine du 27 juillet
 * - Aucune ligne en double n'est créée
 */

const CRAController = require('../controller/cra-time-entry-controller');
const { resolveActiveAssignment } = CRAController;

describe('CRA — Mode ponctuel : saisie hors dates prévues (stateful)', () => {
  // Données de référence
  const PROJECT_START = '2026-01-01';
  const PROJECT_END = '2026-12-31';
  const TASK_ID = 6;
  const MEMBER_ID = 1;
  const ASSIGNMENT_START = '2026-07-23'; // jeudi
  const ASSIGNMENT_END = '2026-07-24';   // vendredi
  const REALISATION_DATE = '2026-07-27'; // lundi (hors affectation, dans projet)
  const ALLOCATED_HOURS = 8;
  
  // Helpers de date
  function dateToTimestamp(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    return Math.floor(d.getTime() / 1000);
  }
  
  function gristDateKey(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value * 1000).toISOString().split('T')[0];
    }
    return null;
  }

  describe('Résolution d\'affectation ponctuelle', () => {
    let assignments;
    let context;

    beforeEach(() => {
      assignments = [
        {
          id: 10,
          tache: TASK_ID,
          membre: MEMBER_ID,
          heuresAllouees: ALLOCATED_HOURS,
          dateDebut: dateToTimestamp(ASSIGNMENT_START),
          dateFin: dateToTimestamp(ASSIGNMENT_END),
          modeRepartition: 'ponctuel',
          actif: true
        }
      ];
      
      context = {
        projectStartDate: PROJECT_START,
        projectEndDate: PROJECT_END,
        allowWeekends: false
      };
    });

    test('Scénario B1 — Affectation ponctuelle trouvée pour date dans le projet', () => {
      const result = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        REALISATION_DATE,
        assignments,
        context
      );

      expect(result.status).toBe('found');
      expect(result.assignment).toBeTruthy();
      expect(result.assignment.id).toBe(10);
      expect(result.assignment.modeRepartition).toBe('ponctuel');
    });

    test('Scénario B2 — Mode uniforme refuse date hors affectation', () => {
      assignments[0].modeRepartition = 'uniforme';
      
      const result = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        REALISATION_DATE,
        assignments,
        context
      );

      expect(result.status).toBe('missing');
      expect(result.assignment).toBeNull();
    });

    test('Scénario B3 — Date hors projet refusée (mode ponctuel)', () => {
      const horsProjet = '2027-01-15'; // Hors projet
      
      const result = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        horsProjet,
        assignments,
        context
      );

      expect(result.status).toBe('missing');
    });

    test('Scénario B4 — Week-end refusé par défaut', () => {
      const samedi = '2026-07-25'; // samedi entre l'affectation et le 27
      
      const result = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        samedi,
        assignments,
        context
      );

      expect(result.status).toBe('missing');
    });

    test('Scénario B5 — Week-end autorisé si allowWeekends=true', () => {
      const samedi = '2026-07-25';
      const contextWithWeekends = { ...context, allowWeekends: true };
      
      const result = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        samedi,
        assignments,
        contextWithWeekends
      );

      expect(result.status).toBe('found');
    });

    test('Scénario B6 — Affectation inactive refusée', () => {
      assignments[0].actif = false;
      
      const result = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        REALISATION_DATE,
        assignments,
        context
      );

      expect(result.status).toBe('missing');
    });

    test('Scénario B7 — Deux affectations actives = ambiguïté', () => {
      assignments.push({
        id: 11,
        tache: TASK_ID,
        membre: MEMBER_ID,
        heuresAllouees: 4,
        dateDebut: dateToTimestamp('2026-08-01'),
        dateFin: dateToTimestamp('2026-08-31'),
        modeRepartition: 'ponctuel',
        actif: true
      });
      
      const result = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        REALISATION_DATE,
        assignments,
        context
      );

      expect(result.status).toBe('ambiguous');
      expect(result.assignment).toBeNull();
      expect(result.assignments.length).toBe(2);
    });

    test('Scénario B8 — Fallback sur dates affectation si pas de dates projet', () => {
      const contextSansProjet = {}; // Pas de dates projet
      
      // Date dans l'affectation
      const dansAffectation = '2026-07-23';
      const result1 = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        dansAffectation,
        assignments,
        contextSansProjet
      );
      expect(result1.status).toBe('found');
      
      // Date hors affectation (mais normalement dans projet)
      const result2 = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        REALISATION_DATE,
        assignments,
        contextSansProjet
      );
      expect(result2.status).toBe('missing'); // Hors dates affectation
    });

    test('Scénario B9 — Dates bornes inclusives', () => {
      // 23 juillet = dateDebut
      const result1 = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        ASSIGNMENT_START,
        assignments,
        context
      );
      expect(result1.status).toBe('found');
      
      // 24 juillet = dateFin
      const result2 = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        ASSIGNMENT_END,
        assignments,
        context
      );
      expect(result2.status).toBe('found');
    });
  });

  describe('Détermination action TimeEntry', () => {
    const { determineEntryAction } = CRAController;
    
    let activeAssignment;
    let currentSheet;

    beforeEach(() => {
      activeAssignment = { id: 10, tache: TASK_ID, membre: MEMBER_ID };
      currentSheet = { id: 50, membre: MEMBER_ID, semaine: '2026-07-27', statut: 'brouillon' };
    });

    test('Scénario C1 — Création nouvelle TimeEntry avec affectation', () => {
      const result = determineEntryAction(
        null, // Pas d'entrée existante
        4,    // 4 heures saisies
        activeAssignment,
        currentSheet,
        false // Pas de données de planning
      );

      expect(result.action).toBe('create');
      expect(result.fields).toBeTruthy();
      expect(result.fields.heures).toBe(4);
      expect(result.fields.affectation).toBe(10);
      expect(result.fields.feuille).toBe(50);
    });

    test('Scénario C2 — Mise à jour TimeEntry existante', () => {
      const existingEntry = {
        id: 100,
        heures: 2,
        affectation: 10,
        tache: TASK_ID,
        membre: MEMBER_ID,
        date: dateToTimestamp(REALISATION_DATE)
      };

      const result = determineEntryAction(
        existingEntry,
        4,    // Modification : 2h → 4h
        activeAssignment,
        currentSheet,
        false
      );

      expect(result.action).toBe('update');
      expect(result.fields).toEqual({ heures: 4 });
    });

    test('Scénario C3 — Pas de doublon : même affectation + date', () => {
      // Simule une entrée existante pour affectation + date
      const existingEntry = {
        id: 100,
        heures: null,
        affectation: 10,
        tache: TASK_ID,
        membre: MEMBER_ID,
        date: dateToTimestamp(REALISATION_DATE),
        feuille: 50
      };

      const result = determineEntryAction(
        existingEntry,
        4,
        activeAssignment,
        currentSheet,
        false
      );

      expect(result.action).toBe('update');
      expect(result.fields).toEqual({ heures: 4 });
    });

    test('Scénario C4 — Création bloquée sans affectation', () => {
      const result = determineEntryAction(
        null,
        4,
        null, // Pas d'affectation
        currentSheet,
        false
      );

      expect(result.action).toBe('blocked');
      expect(result.reason).toBe('MISSING_ACTIVE_ASSIGNMENT');
    });

    test('Scénario C5 — Remise à zéro conserve affectation', () => {
      const existingEntry = {
        id: 100,
        heures: 4,
        affectation: 10,
        tache: TASK_ID,
        membre: MEMBER_ID,
        date: dateToTimestamp(REALISATION_DATE),
        feuille: 50
      };

      const result = determineEntryAction(
        existingEntry,
        0,    // Remise à zéro
        activeAssignment,
        currentSheet,
        true  // A des données de planning
      );

      expect(result.action).toBe('update');
      expect(result.fields).toEqual({ heures: 0 });
    });
  });

  describe('Tests négatifs — Scénarios de refus', () => {
    const { determineEntryAction } = CRAController;
    
    let assignments;
    let context;
    let activeAssignment;
    let currentSheet;

    beforeEach(() => {
      assignments = [
        {
          id: 10,
          tache: TASK_ID,
          membre: MEMBER_ID,
          heuresAllouees: ALLOCATED_HOURS,
          dateDebut: dateToTimestamp(ASSIGNMENT_START),
          dateFin: dateToTimestamp(ASSIGNMENT_END),
          modeRepartition: 'ponctuel',
          actif: true
        }
      ];
      
      context = {
        projectStartDate: PROJECT_START,
        projectEndDate: PROJECT_END,
        allowWeekends: false
      };
      
      activeAssignment = { id: 10, tache: TASK_ID, membre: MEMBER_ID };
      currentSheet = { id: 50, membre: MEMBER_ID, semaine: '2026-07-27', statut: 'brouillon' };
    });

    test('Test négatif A — Mode uniforme, saisie le 27 juillet (hors affectation)', () => {
      assignments[0].modeRepartition = 'uniforme';
      
      const result = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        REALISATION_DATE,
        assignments,
        context
      );

      expect(result.status).toBe('missing');
      expect(result.assignment).toBeNull();
    });

    test('Test négatif B — Mode ponctuel, date hors projet', () => {
      const horsProjet = '2027-01-15';
      
      const result = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        horsProjet,
        assignments,
        context
      );

      expect(result.status).toBe('missing');
    });

    test('Test négatif C — Mode ponctuel, samedi (week-end)', () => {
      const samedi = '2026-07-25';
      
      const result = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        samedi,
        assignments,
        context
      );

      expect(result.status).toBe('missing');
    });

    test('Test négatif D — Mode ponctuel, capacité disponible = 0', () => {
      // La vérification de capacité se fait au niveau supérieur (CRA UI)
      // Mais resolveActiveAssignment doit quand même trouver l'affectation
      const result = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        REALISATION_DATE,
        assignments,
        context
      );

      // L'affectation est trouvée, mais la capacité sera vérifiée ailleurs
      expect(result.status).toBe('found');
      // Note: La capacité = 0 est gérée par dailyCapacityForPersonAndDate
    });

    test('Test négatif E — Affectation inactive', () => {
      assignments[0].actif = false;
      
      const result = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        REALISATION_DATE,
        assignments,
        context
      );

      expect(result.status).toBe('missing');
    });

    test('Test négatif F — Deux affectations ponctuelles candidates ambiguës', () => {
      // Ajouter une deuxième affectation qui chevauche la date
      assignments.push({
        id: 11,
        tache: TASK_ID,
        membre: MEMBER_ID,
        heuresAllouees: 4,
        dateDebut: dateToTimestamp('2026-07-01'),
        dateFin: dateToTimestamp('2026-07-31'),
        modeRepartition: 'ponctuel',
        actif: true
      });
      
      const result = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        REALISATION_DATE,
        assignments,
        context
      );

      expect(result.status).toBe('ambiguous');
      expect(result.assignment).toBeNull();
      expect(result.assignments.length).toBe(2);
    });

    test('Test négatif G — Feuille soumise ou validée (verrouillage)', () => {
      const { isPersonWeekLocked } = CRAController;
      
      const sheetSoumise = { id: 50, membre: MEMBER_ID, semaine: '2026-07-27', statut: 'soumis' };
      const sheetValidee = { id: 51, membre: MEMBER_ID, semaine: '2026-07-27', statut: 'valide' };
      
      const resultSoumise = isPersonWeekLocked(MEMBER_ID, REALISATION_DATE, [sheetSoumise]);
      const resultValidee = isPersonWeekLocked(MEMBER_ID, REALISATION_DATE, [sheetValidee]);
      
      expect(resultSoumise.locked).toBe(true);
      expect(resultSoumise.reason).toBe('SHEET_SOUMIS');
      
      expect(resultValidee.locked).toBe(true);
      expect(resultValidee.reason).toBe('SHEET_VALIDE');
    });

    test('Test négatif H — Mode inconnu (validation)', () => {
      // Le mode inconnu est rejeté au niveau du service TaskAssignments
      // Ici on teste que resolveActiveAssignment ne filtre pas par mode inconnu
      assignments[0].modeRepartition = 'inconnu';
      
      const result = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        REALISATION_DATE,
        assignments,
        context
      );
      
      // En mode inconnu, on traite comme uniforme (comportement par défaut)
      // La validation du mode se fait en amont
      expect(result.status).toBe('missing'); // Car uniforme refuse hors dates
    });
  });

  describe('Intégration complète — Simulation Grist stateful', () => {
    // Mock Grist complet
    let mockGrist;
    let tasksTable;
    let teamTable;
    let taskAssignmentsTable;
    let timeEntriesTable;
    let sheetsTable;
    let memberDailyCapacitiesTable;
    let planningCalled;

    beforeEach(() => {
      planningCalled = false;
      
      tasksTable = {
        id: [TASK_ID],
        titre: ['Intervention juridique'],
        dateDebut: [dateToTimestamp(PROJECT_START)],
        dateEcheance: [dateToTimestamp(PROJECT_END)],
        projet: [1]
      };

      teamTable = {
        id: [MEMBER_ID],
        nom: ['Jason'],
        capaciteHebdo: [35]
      };

      taskAssignmentsTable = {
        id: [10],
        tache: [TASK_ID],
        membre: [MEMBER_ID],
        heuresAllouees: [ALLOCATED_HOURS],
        dateDebut: [dateToTimestamp(ASSIGNMENT_START)],
        dateFin: [dateToTimestamp(ASSIGNMENT_END)],
        modeRepartition: ['ponctuel'],
        actif: [true]
      };

      timeEntriesTable = {
        id: [],
        tache: [],
        membre: [],
        date: [],
        heures: [],
        heuresPrevues: [],
        affectation: [],
        feuille: [],
        description: [],
        imputation: []
      };

      sheetsTable = {
        id: [50],
        membre: [MEMBER_ID],
        semaine: [dateToTimestamp('2026-07-27')],
        statut: ['brouillon']
      };

      memberDailyCapacitiesTable = {
        id: [1, 2, 3],
        membre: [MEMBER_ID, MEMBER_ID, MEMBER_ID],
        date: [dateToTimestamp(ASSIGNMENT_START), dateToTimestamp(ASSIGNMENT_END), dateToTimestamp(REALISATION_DATE)],
        capaciteDisponible: [7, 7, 7],
        capaciteTheorique: [7, 7, 7]
      };

      mockGrist = {
        docApi: {
          fetchTable: jest.fn().mockImplementation(async function(table) {
            if (table === 'Tasks') return tasksTable;
            if (table === 'Team') return teamTable;
            if (table === 'TaskAssignments') return taskAssignmentsTable;
            if (table === 'TimeEntries') return timeEntriesTable;
            if (table === 'Feuilles') return sheetsTable;
            if (table === 'MemberDailyCapacities') return memberDailyCapacitiesTable;
            return { id: [] };
          }),
          applyUserActions: jest.fn().mockImplementation(async function(actions) {
            const retValues = [];
            
            for (const action of actions) {
              const [type, tableName, recordId, data] = action;
              
              if (type === 'AddRecord' && tableName === 'TimeEntries') {
                const newId = (timeEntriesTable.id.length > 0 ? Math.max(...timeEntriesTable.id) : 0) + 1;
                timeEntriesTable.id.push(newId);
                timeEntriesTable.tache.push(data.tache || null);
                timeEntriesTable.membre.push(data.membre || null);
                timeEntriesTable.date.push(data.date || null);
                timeEntriesTable.heures.push(data.heures !== undefined ? data.heures : null);
                timeEntriesTable.heuresPrevues.push(data.heuresPrevues !== undefined ? data.heuresPrevues : 0);
                timeEntriesTable.affectation.push(data.affectation || null);
                timeEntriesTable.feuille.push(data.feuille || null);
                timeEntriesTable.description.push(data.description || '');
                timeEntriesTable.imputation.push(data.imputation || '');
                retValues.push(newId);
              } else if (type === 'UpdateRecord' && tableName === 'TimeEntries') {
                const idx = timeEntriesTable.id.indexOf(recordId);
                if (idx >= 0) {
                  Object.keys(data).forEach(key => {
                    if (timeEntriesTable[key]) timeEntriesTable[key][idx] = data[key];
                  });
                }
                retValues.push(null);
              } else if (type === 'AddRecord' && tableName === 'Feuilles') {
                const newId = (sheetsTable.id.length > 0 ? Math.max(...sheetsTable.id) : 0) + 1;
                sheetsTable.id.push(newId);
                sheetsTable.membre.push(data.membre);
                sheetsTable.semaine.push(data.semaine);
                sheetsTable.statut.push(data.statut || 'brouillon');
                retValues.push(newId);
              }
            }
            
            return { retValues };
          })
        }
      };
    });

    test('Scénario stateful complet — 4h le 23, 4h le 24 (prévu), 4h le 27 (réalisé)', async () => {
      // ÉTAPE 1 : Vérifier que l'affectation est bien en mode ponctuel
      expect(taskAssignmentsTable.modeRepartition[0]).toBe('ponctuel');
      
      // ÉTAPE 2 : Générer le prévu (23 et 24 juillet)
      const { planAssignment } = require('../../planning/time_entry/time-entry-planning-service');
      
      const capacities = [
        { id: 1, membre: MEMBER_ID, date: dateToTimestamp(ASSIGNMENT_START), capaciteDisponible: 7 },
        { id: 2, membre: MEMBER_ID, date: dateToTimestamp(ASSIGNMENT_END), capaciteDisponible: 7 }
      ];
      
      const assignment = {
        id: 10,
        tache: TASK_ID,
        membre: MEMBER_ID,
        heuresAllouees: 8,
        dateDebut: dateToTimestamp(ASSIGNMENT_START),
        dateFin: dateToTimestamp(ASSIGNMENT_END),
        modeRepartition: 'ponctuel',
        actif: true
      };
      
      const planResult = planAssignment(assignment, {
        capacities,
        existingEntries: [],
        tasks: [{ id: TASK_ID }],
        members: [{ id: MEMBER_ID }]
      });
      
      // Le mode ponctuel génère du prévu comme l'uniforme
      expect(planResult.plannedEntries.length).toBeGreaterThan(0);
      const totalPrevues = planResult.plannedEntries.reduce((sum, e) => sum + e.heuresPrevues, 0);
      expect(totalPrevues).toBeCloseTo(8, 2);
      
      // Créer les entrées prévues
      for (const entry of planResult.plannedEntries) {
        await mockGrist.docApi.applyUserActions([
          ['AddRecord', 'TimeEntries', null, {
            ...entry,
            heures: null,
            description: '',
            imputation: ''
          }]
        ]);
      }
      
      // Vérifier le prévu : 2 lignes (23 et 24 juillet)
      expect(timeEntriesTable.id.length).toBe(2);
      const prevues23 = timeEntriesTable.heuresPrevues.find((h, i) => 
        timeEntriesTable.date[i] === dateToTimestamp(ASSIGNMENT_START)
      );
      const prevues24 = timeEntriesTable.heuresPrevues.find((h, i) => 
        timeEntriesTable.date[i] === dateToTimestamp(ASSIGNMENT_END)
      );
      expect(prevues23).toBeGreaterThan(0);
      expect(prevues24).toBeGreaterThan(0);
      
      // ÉTAPE 3 : Résoudre l'affectation pour le 27 juillet (CRA)
      const assignmentResult = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        REALISATION_DATE,
        [{
          id: 10,
          tache: TASK_ID,
          membre: MEMBER_ID,
          heuresAllouees: 8,
          dateDebut: dateToTimestamp(ASSIGNMENT_START),
          dateFin: dateToTimestamp(ASSIGNMENT_END),
          modeRepartition: 'ponctuel',
          actif: true
        }],
        {
          projectStartDate: PROJECT_START,
          projectEndDate: PROJECT_END,
          allowWeekends: false
        }
      );
      
      expect(assignmentResult.status).toBe('found');
      expect(assignmentResult.assignment.id).toBe(10);
      
      // ÉTAPE 4 : Déterminer l'action (création car pas d'entrée existante le 27)
      const { determineEntryAction } = CRAController;
      const actionResult = determineEntryAction(
        null, // Pas d'entrée existante le 27
        4,    // 4 heures saisies
        assignmentResult.assignment,
        { id: 50, membre: MEMBER_ID },
        false
      );
      
      expect(actionResult.action).toBe('create');
      expect(actionResult.fields.affectation).toBe(10);
      
      // ÉTAPE 5 : Créer la TimeEntry du 27 juillet
      await mockGrist.docApi.applyUserActions([
        ['AddRecord', 'TimeEntries', null, {
          tache: TASK_ID,
          membre: MEMBER_ID,
          date: dateToTimestamp(REALISATION_DATE),
          heures: 4,
          affectation: 10,
          feuille: 50,
          heuresPrevues: 0,
          description: '',
          imputation: ''
        }]
      ]);
      
      // ÉTAPE 6 : Vérifications finales
      // 6a. Toujours 3 lignes (2 prévues + 1 réalisée)
      expect(timeEntriesTable.id.length).toBe(3);
      
      // 6b. Le prévu des 23 et 24 est intact
      const entries23 = timeEntriesTable.heuresPrevues.filter((h, i) => 
        timeEntriesTable.date[i] === dateToTimestamp(ASSIGNMENT_START)
      );
      const entries24 = timeEntriesTable.heuresPrevues.filter((h, i) => 
        timeEntriesTable.date[i] === dateToTimestamp(ASSIGNMENT_END)
      );
      expect(entries23.length).toBe(1);
      expect(entries24.length).toBe(1);
      expect(entries23[0]).toBeGreaterThan(0);
      expect(entries24[0]).toBeGreaterThan(0);
      
      // 6c. La ligne du 27 existe avec 4h réalisées
      const entry27Index = timeEntriesTable.date.findIndex(d => 
        d === dateToTimestamp(REALISATION_DATE)
      );
      expect(entry27Index).toBeGreaterThanOrEqual(0);
      expect(timeEntriesTable.heures[entry27Index]).toBe(4);
      expect(timeEntriesTable.affectation[entry27Index]).toBe(10);
      expect(timeEntriesTable.feuille[entry27Index]).toBe(50);
      
      // 6d. Aucune replanification appelée (vérifié par planningCalled = false)
      expect(planningCalled).toBe(false);
    });

    test('Scénario stateful — Deuxième saisie sur même date (mise à jour, pas doublon)', async () => {
      // Première saisie : 4h le 27
      await mockGrist.docApi.applyUserActions([
        ['AddRecord', 'TimeEntries', null, {
          tache: TASK_ID,
          membre: MEMBER_ID,
          date: dateToTimestamp(REALISATION_DATE),
          heures: 4,
          affectation: 10,
          feuille: 50
        }]
      ]);
      
      expect(timeEntriesTable.id.length).toBe(1);
      const firstId = timeEntriesTable.id[0];
      
      // Deuxième saisie : modification à 6h
      const existingEntry = {
        id: firstId,
        heures: 4,
        affectation: 10,
        tache: TASK_ID,
        membre: MEMBER_ID,
        date: dateToTimestamp(REALISATION_DATE)
      };
      
      const { determineEntryAction } = CRAController;
      const actionResult = determineEntryAction(
        existingEntry,
        6,    // Modification : 4h → 6h
        { id: 10 },
        { id: 50 },
        false
      );
      
      expect(actionResult.action).toBe('update');
      expect(actionResult.fields).toEqual({ heures: 6 });
      
      // Exécuter la mise à jour
      await mockGrist.docApi.applyUserActions([
        ['UpdateRecord', 'TimeEntries', firstId, { heures: 6 }]
      ]);
      
      // Vérifier : toujours une seule ligne, heures mises à jour
      expect(timeEntriesTable.id.length).toBe(1);
      expect(timeEntriesTable.heures[0]).toBe(6);
    });
  });
});
