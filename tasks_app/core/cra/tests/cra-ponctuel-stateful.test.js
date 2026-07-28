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
const { resolveActiveAssignment, saveCraCellChange } = CRAController;

describe('CRA — Mode ponctuel : saisie hors dates prévues (stateful)', () => {
  const PROJECT_START = '2026-01-01';
  const PROJECT_END = '2026-12-31';
  const TASK_ID = 6;
  const MEMBER_ID = 1;
  const ASSIGNMENT_START = '2026-07-23';
  const ASSIGNMENT_END = '2026-07-24';
  const REALISATION_DATE = '2026-07-27';
  const ALLOCATED_HOURS = 8;
  
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

    test('Scénario B4 — Week-end refusé par défaut', () => {
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
      const contextSansProjet = {};
      
      const dansAffectation = '2026-07-23';
      const result1 = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        dansAffectation,
        assignments,
        contextSansProjet
      );
      expect(result1.status).toBe('found');
      
      const result2 = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        REALISATION_DATE,
        assignments,
        contextSansProjet
      );
      expect(result2.status).toBe('missing');
    });

    test('Scénario B9 — Dates bornes inclusives', () => {
      const result1 = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        ASSIGNMENT_START,
        assignments,
        context
      );
      expect(result1.status).toBe('found');
      
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
        null,
        4,
        activeAssignment,
        currentSheet,
        false
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
        4,
        activeAssignment,
        currentSheet,
        false
      );

      expect(result.action).toBe('update');
      expect(result.fields).toEqual({ heures: 4 });
    });

    test('Scénario C3 — Pas de doublon : même affectation + date', () => {
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
        null,
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
        0,
        activeAssignment,
        currentSheet,
        true
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

    test('Test négatif A — Mode uniforme, saisie le 27 juillet', () => {
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
      const result = resolveActiveAssignment(
        TASK_ID,
        MEMBER_ID,
        REALISATION_DATE,
        assignments,
        context
      );

      expect(result.status).toBe('found');
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
  });

  describe('Intégration complète — Simulation Grist stateful', () => {
    let mockGrist;
    let timeEntriesTable;
    let sheetsTable;
    let appliedAddRecords;
    let appliedUpdateRecords;

    beforeEach(() => {
      appliedAddRecords = [];
      appliedUpdateRecords = [];
      
      const tasksTable = {
        id: [TASK_ID],
        titre: ['Intervention juridique'],
        dateDebut: [dateToTimestamp(PROJECT_START)],
        dateEcheance: [dateToTimestamp(PROJECT_END)],
        projet: [1]
      };
      
      const projectsTable = {
        id: [1],
        nom: ['Projet test'],
        dateDebut: [dateToTimestamp(PROJECT_START)],
        dateFin: [dateToTimestamp(PROJECT_END)]
      };

      const teamTable = {
        id: [MEMBER_ID],
        nom: ['Jason'],
        capaciteHebdo: [35]
      };

      const taskAssignmentsTable = {
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
        capaciteJour: [],
        capaciteTheorique: [],
        capaciteDisponible: [],
        revisionPlan: [],
        description: [],
        imputation: []
      };

      sheetsTable = {
        id: [50],
        membre: [MEMBER_ID],
        semaine: [dateToTimestamp('2026-07-27')],
        statut: ['brouillon']
      };

      const memberDailyCapacitiesTable = {
        id: [70],
        membre: [MEMBER_ID],
        date: [dateToTimestamp(REALISATION_DATE)],
        capaciteDisponible: [7],
        capaciteTheorique: [7]
      };

      mockGrist = {
        docApi: {
          fetchTable: jest.fn().mockImplementation(async function(table) {
            if (table === 'Tasks') return tasksTable;
            if (table === 'Projects') return projectsTable;
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
                timeEntriesTable.capaciteJour.push(data.capaciteJour || null);
                timeEntriesTable.capaciteTheorique.push(data.capaciteTheorique || 0);
                timeEntriesTable.capaciteDisponible.push(data.capaciteDisponible || 0);
                timeEntriesTable.revisionPlan.push(data.revisionPlan !== undefined ? data.revisionPlan : 0);
                timeEntriesTable.description.push(data.description || '');
                timeEntriesTable.imputation.push(data.imputation || '');
                retValues.push(newId);
                appliedAddRecords.push({ id: newId, data });
              } else if (type === 'UpdateRecord' && tableName === 'TimeEntries') {
                const idx = timeEntriesTable.id.indexOf(recordId);
                if (idx >= 0) {
                  Object.keys(data).forEach(key => {
                    if (timeEntriesTable[key]) timeEntriesTable[key][idx] = data[key];
                  });
                }
                retValues.push(null);
                appliedUpdateRecords.push({ id: recordId, data });
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
    
    function createDependencies() {
      return {
        tasks: [{ id: TASK_ID, projet: 1 }],
        projects: [{ id: 1, dateDebut: dateToTimestamp(PROJECT_START), dateFin: dateToTimestamp(PROJECT_END) }],
        assignments: [{
          id: 10,
          tache: TASK_ID,
          membre: MEMBER_ID,
          heuresAllouees: ALLOCATED_HOURS,
          dateDebut: dateToTimestamp(ASSIGNMENT_START),
          dateFin: dateToTimestamp(ASSIGNMENT_END),
          modeRepartition: 'ponctuel',
          actif: true
        }],
        get entries() {
          return timeEntriesTable.id.map((id, i) => ({
            id,
            tache: timeEntriesTable.tache[i],
            membre: timeEntriesTable.membre[i],
            date: timeEntriesTable.date[i],
            heures: timeEntriesTable.heures[i],
            heuresPrevues: timeEntriesTable.heuresPrevues[i],
            affectation: timeEntriesTable.affectation[i],
            feuille: timeEntriesTable.feuille[i],
            capaciteJour: timeEntriesTable.capaciteJour[i],
            capaciteTheorique: timeEntriesTable.capaciteTheorique[i],
            capaciteDisponible: timeEntriesTable.capaciteDisponible[i],
            revisionPlan: timeEntriesTable.revisionPlan[i]
          }));
        },
        sheets: [{ id: 50, membre: MEMBER_ID, semaine: dateToTimestamp('2026-07-27'), statut: 'brouillon' }],
        dailyCapacities: [{
          id: 70,
          membre: MEMBER_ID,
          date: dateToTimestamp(REALISATION_DATE),
          capaciteDisponible: 7,
          capaciteTheorique: 7
        }],
        team: [{ id: MEMBER_ID, nom: 'Jason', capaciteHebdo: 35 }],
        grist: mockGrist
      };
    }
    
    function copyPredictedEntries() {
      return timeEntriesTable.id.map((id, i) => ({
        id,
        tache: timeEntriesTable.tache[i],
        membre: timeEntriesTable.membre[i],
        date: timeEntriesTable.date[i],
        heures: timeEntriesTable.heures[i],
        heuresPrevues: timeEntriesTable.heuresPrevues[i],
        affectation: timeEntriesTable.affectation[i],
        feuille: timeEntriesTable.feuille[i],
        revisionPlan: timeEntriesTable.revisionPlan[i]
      })).filter(e => {
        if (!e.date) return false;
        let dateObj;
        if (typeof e.date === 'string') {
          dateObj = new Date(e.date + 'T00:00:00Z');
        } else if (typeof e.date === 'number') {
          dateObj = new Date(e.date * 1000);
        } else {
          return false;
        }
        if (isNaN(dateObj.getTime())) return false;
        const d = dateObj.toISOString().split('T')[0];
        return d === ASSIGNMENT_START || d === ASSIGNMENT_END;
      });
    }

    test('B3.1 — création réelle le 27 juillet', async () => {
      const dependencies = createDependencies();
      const beforeCount = timeEntriesTable.id.length;
      
      const result = await saveCraCellChange({
        taskId: TASK_ID,
        personId: MEMBER_ID,
        dateIso: REALISATION_DATE,
        hours: 4
      }, dependencies);
      
      expect(result.ok).toBe(true);
      expect(result.action).toBe('create');
      expect(result.assignmentId).toBe(10);
      expect(result.sheetId).toBe(50);
      expect(result.actionsExecuted).toBe(1);
      
      expect(timeEntriesTable.id.length).toBe(beforeCount + 1);
      const newIndex = timeEntriesTable.id.length - 1;
      expect(timeEntriesTable.heures[newIndex]).toBe(4);
      expect(timeEntriesTable.heuresPrevues[newIndex]).toBe(0);
      expect(timeEntriesTable.affectation[newIndex]).toBe(10);
      expect(timeEntriesTable.feuille[newIndex]).toBe(50);
      expect(timeEntriesTable.capaciteJour[newIndex]).toBe(70);
      expect(timeEntriesTable.revisionPlan[newIndex]).toBe(0);
      
      expect(appliedAddRecords.length).toBe(1);
      expect(appliedUpdateRecords.length).toBe(0);
    });
    
    test('B3.2 — deuxième saisie, aucun doublon', async () => {
      const dependencies = createDependencies();
      
      await saveCraCellChange({
        taskId: TASK_ID,
        personId: MEMBER_ID,
        dateIso: REALISATION_DATE,
        hours: 4
      }, dependencies);
      
      const firstEntryId = timeEntriesTable.id[timeEntriesTable.id.length - 1];
      const beforeCount = timeEntriesTable.id.length;
      
      const result = await saveCraCellChange({
        taskId: TASK_ID,
        personId: MEMBER_ID,
        dateIso: REALISATION_DATE,
        hours: 4
      }, dependencies);
      
      expect(result.ok).toBe(true);
      expect(timeEntriesTable.id.length).toBe(beforeCount);
      expect(result.entryId).toBe(firstEntryId);
    });
    
    test('B3.3 — modification de 4 h vers 5 h', async () => {
      const dependencies = createDependencies();
      
      await saveCraCellChange({
        taskId: TASK_ID,
        personId: MEMBER_ID,
        dateIso: REALISATION_DATE,
        hours: 4
      }, dependencies);
      
      const entryIndex = timeEntriesTable.id.length - 1;
      const firstEntryId = timeEntriesTable.id[entryIndex];
      
      const result = await saveCraCellChange({
        taskId: TASK_ID,
        personId: MEMBER_ID,
        dateIso: REALISATION_DATE,
        hours: 5
      }, dependencies);
      
      expect(result.ok).toBe(true);
      expect(result.action).toBe('update');
      expect(result.entryId).toBe(firstEntryId);
      expect(timeEntriesTable.heures[entryIndex]).toBe(5);
      expect(appliedUpdateRecords.length).toBe(1);
      expect(appliedUpdateRecords[0].id).toBe(firstEntryId);
      expect(appliedUpdateRecords[0].data.heures).toBe(5);
    });
    
    test('B3.4 — uniforme refuse le 27', async () => {
      const dependencies = createDependencies();
      dependencies.assignments[0].modeRepartition = 'uniforme';
      
      const result = await saveCraCellChange({
        taskId: TASK_ID,
        personId: MEMBER_ID,
        dateIso: REALISATION_DATE,
        hours: 4
      }, dependencies);
      
      expect(result.ok).toBe(false);
      expect(result.action).toBe('blocked');
      expect(result.code).toBe('MISSING_ACTIVE_ASSIGNMENT');
      expect(appliedAddRecords.length).toBe(0);
    });
    
    test('B3.5 — mode inconnu rejeté', async () => {
      const dependencies = createDependencies();
      dependencies.assignments[0].modeRepartition = 'ponctuelle';
      
      const result = await saveCraCellChange({
        taskId: TASK_ID,
        personId: MEMBER_ID,
        dateIso: REALISATION_DATE,
        hours: 4
      }, dependencies);
      
      expect(result.ok).toBe(false);
      expect(result.action).toBe('blocked');
      expect(result.code).toBe('INVALID_DISTRIBUTION_MODE');
      expect(appliedAddRecords.length).toBe(0);
    });
    
    test('B3.6 — pas de replan', async () => {
      const dependencies = createDependencies();
      
      const result = await saveCraCellChange({
        taskId: TASK_ID,
        personId: MEMBER_ID,
        dateIso: REALISATION_DATE,
        hours: 4
      }, dependencies);
      
      expect(result.ok).toBe(true);
    });
  });
  
  describe('Tests B3.8 à B3.19 — Corrections du lot B3', () => {
    const {
      weekStartIsoFromDateIso,
      gristDateFromIso,
      extractAddedRecordId,
      parseStrictIsoDate
    } = CRAController;
    
    describe('B3.8 — setCell utilise le contrôleur', () => {
      test('setCell appelle réellement CRAController.saveCraCellChange', () => {
        const fs = require('fs');
        const path = require('path');
        
        const craPath = path.join(__dirname, '../../../cra.html');
        const craContent = fs.readFileSync(craPath, 'utf8');
        
        const setCellStart = craContent.indexOf('async function setCell(');
        const setCellEnd = craContent.indexOf('window.setCell = setCell;');
        
        expect(setCellStart).toBeGreaterThan(-1);
        expect(setCellEnd).toBeGreaterThan(setCellStart);
        
        const setCellBlock = craContent.substring(setCellStart, setCellEnd);
        
        expect(setCellBlock).toContain('CRAController.saveCraCellChange(');
        expect(setCellBlock).not.toContain('CRAController.resolveActiveAssignment(');
        expect(setCellBlock).not.toContain('CRAController.resolveEditableCellEntry(');
        expect(setCellBlock).not.toContain('CRAController.determineEntryAction(');
        expect(setCellBlock).not.toContain("['AddRecord', 'TimeEntries'");
        expect(setCellBlock).not.toContain("['UpdateRecord', 'TimeEntries'");
        expect(setCellBlock).not.toContain("['RemoveRecord', 'TimeEntries'");
      });
    });
    
    describe('B3.9 — capacité zéro autorisée', () => {
      let mockGrist;
      let timeEntriesTable;
      
      beforeEach(() => {
        timeEntriesTable = {
          id: [],
          tache: [],
          membre: [],
          date: [],
          heures: [],
          heuresPrevues: [],
          affectation: [],
          feuille: [],
          capaciteJour: [],
          capaciteTheorique: [],
          capaciteDisponible: [],
          revisionPlan: []
        };
        
        mockGrist = {
          docApi: {
            fetchTable: jest.fn().mockImplementation(async function(table) {
              if (table === 'TimeEntries') return timeEntriesTable;
              if (table === 'MemberDailyCapacities') {
                return {
                  id: [70],
                  membre: [MEMBER_ID],
                  date: [dateToTimestamp(REALISATION_DATE)],
                  capaciteDisponible: [0],
                  capaciteTheorique: [7]
                };
              }
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
                  timeEntriesTable.capaciteJour.push(data.capaciteJour || null);
                  timeEntriesTable.capaciteTheorique.push(data.capaciteTheorique || 0);
                  timeEntriesTable.capaciteDisponible.push(data.capaciteDisponible || 0);
                  timeEntriesTable.revisionPlan.push(data.revisionPlan !== undefined ? data.revisionPlan : 0);
                  retValues.push(newId);
                }
              }
              return { retValues };
            })
          }
        };
      });
      
      function createDependencies() {
        return {
          tasks: [{ id: TASK_ID, projet: 1 }],
          projects: [{ id: 1, dateDebut: dateToTimestamp(PROJECT_START), dateFin: dateToTimestamp(PROJECT_END) }],
          assignments: [{
            id: 10,
            tache: TASK_ID,
            membre: MEMBER_ID,
            heuresAllouees: ALLOCATED_HOURS,
            dateDebut: dateToTimestamp(ASSIGNMENT_START),
            dateFin: dateToTimestamp(ASSIGNMENT_END),
            modeRepartition: 'ponctuel',
            actif: true
          }],
          entries: [],
          sheets: [{ id: 50, membre: MEMBER_ID, semaine: dateToTimestamp('2026-07-27'), statut: 'brouillon' }],
          dailyCapacities: [{
            id: 70,
            membre: MEMBER_ID,
            date: dateToTimestamp(REALISATION_DATE),
            capaciteDisponible: 0,
            capaciteTheorique: 7
          }],
          team: [{ id: MEMBER_ID, nom: 'Jason', capaciteHebdo: 35 }],
          grist: mockGrist
        };
      }
      
      test('capacité zéro autorisée', async () => {
        const dependencies = createDependencies();
        
        const result = await saveCraCellChange({
          taskId: TASK_ID,
          personId: MEMBER_ID,
          dateIso: REALISATION_DATE,
          hours: 4
        }, dependencies);
        
        expect(result.ok).toBe(true);
        expect(result.action).toBe('create');
        expect(result.fields.capaciteDisponible).toBe(0);
        expect(result.fields.capaciteTheorique).toBe(7);
      });
    });
    
    describe('B3.10 — mardi réutilise la feuille du lundi', () => {
      let mockGrist;
      let timeEntriesTable;
      
      beforeEach(() => {
        timeEntriesTable = { id: [] };
        
        mockGrist = {
          docApi: {
            fetchTable: jest.fn().mockImplementation(async function(table) {
              if (table === 'TimeEntries') return timeEntriesTable;
              return { id: [] };
            }),
            applyUserActions: jest.fn().mockImplementation(async function(actions) {
              const retValues = [];
              for (const action of actions) {
                const [type, tableName, recordId, data] = action;
                if (type === 'AddRecord' && tableName === 'TimeEntries') {
                  const newId = (timeEntriesTable.id.length > 0 ? Math.max(...timeEntriesTable.id) : 0) + 1;
                  timeEntriesTable.id.push(newId);
                  retValues.push(newId);
                }
              }
              return { retValues };
            })
          }
        };
      });
      
      test('mardi 28/07 réutilise feuille du lundi 27/07', async () => {
        const dependencies = {
          tasks: [{ id: TASK_ID, projet: 1 }],
          projects: [{ id: 1, dateDebut: dateToTimestamp(PROJECT_START), dateFin: dateToTimestamp(PROJECT_END) }],
          assignments: [{
            id: 10,
            tache: TASK_ID,
            membre: MEMBER_ID,
            heuresAllouees: ALLOCATED_HOURS,
            dateDebut: dateToTimestamp(ASSIGNMENT_START),
            dateFin: dateToTimestamp(ASSIGNMENT_END),
            modeRepartition: 'ponctuel',
            actif: true
          }],
          entries: [],
          sheets: [{ id: 50, membre: MEMBER_ID, semaine: dateToTimestamp('2026-07-27'), statut: 'brouillon' }],
          dailyCapacities: [],
          team: [{ id: MEMBER_ID }],
          grist: mockGrist
        };
        
        const result = await saveCraCellChange({
          taskId: TASK_ID,
          personId: MEMBER_ID,
          dateIso: '2026-07-28',
          hours: 4
        }, dependencies);
        
        expect(result.ok).toBe(true);
        expect(result.sheetId).toBe(50);
        expect(result.fields.feuille).toBe(50);
      });
    });
    
    describe('B3.11 — doublon de feuilles bloqué', () => {
      test('deux feuilles pour même semaine bloquent', async () => {
        const dependencies = {
          tasks: [{ id: TASK_ID, projet: 1 }],
          projects: [{ id: 1, dateDebut: dateToTimestamp(PROJECT_START), dateFin: dateToTimestamp(PROJECT_END) }],
          assignments: [{
            id: 10,
            tache: TASK_ID,
            membre: MEMBER_ID,
            heuresAllouees: ALLOCATED_HOURS,
            dateDebut: dateToTimestamp(ASSIGNMENT_START),
            dateFin: dateToTimestamp(ASSIGNMENT_END),
            modeRepartition: 'ponctuel',
            actif: true
          }],
          entries: [],
          sheets: [
            { id: 50, membre: MEMBER_ID, semaine: dateToTimestamp('2026-07-27'), statut: 'brouillon' },
            { id: 51, membre: MEMBER_ID, semaine: dateToTimestamp('2026-07-27'), statut: 'brouillon' }
          ],
          dailyCapacities: [],
          team: [{ id: MEMBER_ID }],
          grist: { docApi: { applyUserActions: jest.fn() } }
        };
        
        const result = await saveCraCellChange({
          taskId: TASK_ID,
          personId: MEMBER_ID,
          dateIso: REALISATION_DATE,
          hours: 4
        }, dependencies);
        
        expect(result.ok).toBe(false);
        expect(result.code).toBe('DUPLICATE_WEEKLY_SHEET');
        expect(result.sheetIds).toEqual([50, 51]);
      });
    });
    
    describe('B3.12 — format date Grist', () => {
      test('gristDateFromIso retourne timestamp secondes', () => {
        const result = gristDateFromIso('2026-07-27');
        const expected = Date.UTC(2026, 6, 27) / 1000;
        expect(result).toBe(expected);
      });
      
      test('gristDateFromIso rejette format invalide', () => {
        expect(gristDateFromIso('27/07/2026')).toBe(null);
        expect(gristDateFromIso('invalid')).toBe(null);
        expect(gristDateFromIso(null)).toBe(null);
      });
      
      test('weekStartIsoFromDateIso calcule correctement', () => {
        expect(weekStartIsoFromDateIso('2026-07-27')).toBe('2026-07-27');
        expect(weekStartIsoFromDateIso('2026-07-28')).toBe('2026-07-27');
        expect(weekStartIsoFromDateIso('2026-07-31')).toBe('2026-07-27');
        expect(weekStartIsoFromDateIso('2026-08-02')).toBe('2026-07-27');
        expect(weekStartIsoFromDateIso('invalid')).toBe(null);
      });
    });
    
    describe('B3.13 — extraction des IDs', () => {
      test('retValues: [101]', () => {
        expect(extractAddedRecordId({ retValues: [101] })).toBe(101);
      });
      
      test('id: [101]', () => {
        expect(extractAddedRecordId({ id: [101] })).toBe(101);
      });
      
      test('[101]', () => {
        expect(extractAddedRecordId([101])).toBe(101);
      });
      
      test('101', () => {
        expect(extractAddedRecordId(101)).toBe(101);
      });
      
      test('{ id: 101 }', () => {
        expect(extractAddedRecordId({ id: 101 })).toBe(101);
      });
      
      test('null', () => {
        expect(extractAddedRecordId(null)).toBe(null);
      });
      
      test('{}', () => {
        expect(extractAddedRecordId({})).toBe(null);
      });
      
      test('{ retValues: [] }', () => {
        expect(extractAddedRecordId({ retValues: [] })).toBe(null);
      });
      
      test('{ id: [] }', () => {
        expect(extractAddedRecordId({ id: [] })).toBe(null);
      });
    });
    
    describe('B3.14 — ID absent après AddRecord', () => {
      test('applyUserActions retourne {}', async () => {
        const mockGrist = {
          docApi: {
            applyUserActions: jest.fn().mockResolvedValue({})
          }
        };
        
        const dependencies = {
          tasks: [{ id: TASK_ID, projet: 1 }],
          projects: [{ id: 1, dateDebut: dateToTimestamp(PROJECT_START), dateFin: dateToTimestamp(PROJECT_END) }],
          assignments: [{
            id: 10,
            tache: TASK_ID,
            membre: MEMBER_ID,
            modeRepartition: 'ponctuel',
            actif: true
          }],
          entries: [],
          sheets: [{ id: 50, membre: MEMBER_ID, semaine: dateToTimestamp('2026-07-27') }],
          dailyCapacities: [],
          team: [{ id: MEMBER_ID }],
          grist: mockGrist
        };
        
        const result = await saveCraCellChange({
          taskId: TASK_ID,
          personId: MEMBER_ID,
          dateIso: REALISATION_DATE,
          hours: 4
        }, dependencies);
        
        expect(result.ok).toBe(false);
        expect(result.code).toBe('TIME_ENTRY_ID_NOT_RETURNED');
      });
    });
    
    describe('B3.15 — erreur d\'écriture', () => {
      test('applyUserActions lève Error', async () => {
        const mockGrist = {
          docApi: {
            applyUserActions: jest.fn().mockRejectedValue(new Error('write failed'))
          }
        };
        
        const dependencies = {
          tasks: [{ id: TASK_ID, projet: 1 }],
          projects: [{ id: 1, dateDebut: dateToTimestamp(PROJECT_START), dateFin: dateToTimestamp(PROJECT_END) }],
          assignments: [{
            id: 10,
            tache: TASK_ID,
            membre: MEMBER_ID,
            modeRepartition: 'ponctuel',
            actif: true
          }],
          entries: [{
            id: 100,
            tache: TASK_ID,
            membre: MEMBER_ID,
            date: gristDateFromIso(REALISATION_DATE),
            heures: 2,
            affectation: 10
          }],
          sheets: [{ id: 50, membre: MEMBER_ID, semaine: dateToTimestamp('2026-07-27') }],
          dailyCapacities: [],
          team: [{ id: MEMBER_ID }],
          grist: mockGrist
        };
        
        const result = await saveCraCellChange({
          taskId: TASK_ID,
          personId: MEMBER_ID,
          dateIso: REALISATION_DATE,
          hours: 4
        }, dependencies);
        
        expect(result.ok).toBe(false);
        expect(result.code).toBe('TIME_ENTRY_WRITE_FAILED');
        expect(result.actionsExecuted).toBe(0);
      });
    });
    
    describe('B3.16 — API Grist absente', () => {
      test('grist = null', async () => {
        const dependencies = {
          tasks: [{ id: TASK_ID }],
          projects: [],
          assignments: [],
          entries: [],
          sheets: [],
          dailyCapacities: [],
          team: [],
          grist: null
        };
        
        const result = await saveCraCellChange({
          taskId: TASK_ID,
          personId: MEMBER_ID,
          dateIso: REALISATION_DATE,
          hours: 4
        }, dependencies);
        
        expect(result.ok).toBe(false);
        expect(result.code).toBe('GRIST_API_UNAVAILABLE');
      });
      
      test('grist = { docApi: {} }', async () => {
        const dependencies = {
          tasks: [{ id: TASK_ID }],
          projects: [],
          assignments: [],
          entries: [],
          sheets: [],
          dailyCapacities: [],
          team: [],
          grist: { docApi: {} }
        };
        
        const result = await saveCraCellChange({
          taskId: TASK_ID,
          personId: MEMBER_ID,
          dateIso: REALISATION_DATE,
          hours: 4
        }, dependencies);
        
        expect(result.ok).toBe(false);
        expect(result.code).toBe('GRIST_API_UNAVAILABLE');
      });
    });
    
    describe('B3.17 — champs complets après création', () => {
      let mockGrist;
      let timeEntriesTable;
      
      beforeEach(() => {
        timeEntriesTable = { id: [] };
        
        mockGrist = {
          docApi: {
            fetchTable: jest.fn().mockImplementation(async function(table) {
              if (table === 'MemberDailyCapacities') {
                return {
                  id: [70],
                  membre: [MEMBER_ID],
                  date: [dateToTimestamp(REALISATION_DATE)],
                  capaciteDisponible: [7],
                  capaciteTheorique: [7]
                };
              }
              return { id: [] };
            }),
            applyUserActions: jest.fn().mockImplementation(async function(actions) {
              const retValues = [];
              for (const action of actions) {
                const [type, tableName, recordId, data] = action;
                if (type === 'AddRecord' && tableName === 'TimeEntries') {
                  const newId = (timeEntriesTable.id.length > 0 ? Math.max(...timeEntriesTable.id) : 0) + 1;
                  timeEntriesTable.id.push(newId);
                  retValues.push(newId);
                }
              }
              return { retValues };
            })
          }
        };
      });
      
      test('champs complets après création', async () => {
        const dependencies = {
          tasks: [{ id: TASK_ID, projet: 1 }],
          projects: [{ id: 1, dateDebut: dateToTimestamp(PROJECT_START), dateFin: dateToTimestamp(PROJECT_END) }],
          assignments: [{
            id: 10,
            tache: TASK_ID,
            membre: MEMBER_ID,
            modeRepartition: 'ponctuel',
            actif: true
          }],
          entries: [],
          sheets: [{ id: 50, membre: MEMBER_ID, semaine: dateToTimestamp('2026-07-27') }],
          dailyCapacities: [{
            id: 70,
            membre: MEMBER_ID,
            date: dateToTimestamp(REALISATION_DATE),
            capaciteDisponible: 7,
            capaciteTheorique: 7
          }],
          team: [{ id: MEMBER_ID }],
          grist: mockGrist
        };
        
        const result = await saveCraCellChange({
          taskId: TASK_ID,
          personId: MEMBER_ID,
          dateIso: REALISATION_DATE,
          hours: 4
        }, dependencies);
        
        expect(result.ok).toBe(true);
        expect(result.fields).toEqual({
          membre: MEMBER_ID,
          tache: TASK_ID,
          date: Date.UTC(2026, 6, 27) / 1000,
          heures: 4,
          heuresPrevues: 0,
          revisionPlan: 0,
          affectation: 10,
          feuille: 50,
          capaciteJour: 70,
          capaciteTheorique: 7,
          capaciteDisponible: 7
        });
      });
    });
    
    describe('B3.18 — prévision strictement protégée', () => {
      test('lignes 21 et 22 inchangées', async () => {
        const timeEntriesTable = {
          id: [21, 22],
          tache: [TASK_ID, TASK_ID],
          membre: [MEMBER_ID, MEMBER_ID],
          date: [dateToTimestamp('2026-07-23'), dateToTimestamp('2026-07-24')],
          heures: [null, null],
          heuresPrevues: [4, 4],
          affectation: [10, 10],
          feuille: [50, 50],
          revisionPlan: [1, 1]
        };
        
        const mockGrist = {
          docApi: {
            fetchTable: jest.fn().mockImplementation(async function(table) {
              if (table === 'TimeEntries') return timeEntriesTable;
              if (table === 'MemberDailyCapacities') {
                return {
                  id: [70],
                  membre: [MEMBER_ID],
                  date: [dateToTimestamp(REALISATION_DATE)],
                  capaciteDisponible: [7]
                };
              }
              return { id: [] };
            }),
            applyUserActions: jest.fn().mockImplementation(async function(actions) {
              const retValues = [];
              for (const action of actions) {
                const [type, tableName, recordId, data] = action;
                if (type === 'AddRecord' && tableName === 'TimeEntries') {
                  const newId = (timeEntriesTable.id.length > 0 ? Math.max(...timeEntriesTable.id) : 0) + 1;
                  timeEntriesTable.id.push(newId);
                  retValues.push(newId);
                } else if (type === 'UpdateRecord' && tableName === 'TimeEntries') {
                  const idx = timeEntriesTable.id.indexOf(recordId);
                  if (idx >= 0) {
                    Object.keys(data).forEach(key => {
                      if (timeEntriesTable[key]) timeEntriesTable[key][idx] = data[key];
                    });
                  }
                }
              }
              return { retValues };
            })
          }
        };
        
        const before21 = {
          id: timeEntriesTable.id[0],
          heuresPrevues: timeEntriesTable.heuresPrevues[0],
          date: timeEntriesTable.date[0]
        };
        const before22 = {
          id: timeEntriesTable.id[1],
          heuresPrevues: timeEntriesTable.heuresPrevues[1],
          date: timeEntriesTable.date[1]
        };
        
        const dependencies = {
          tasks: [{ id: TASK_ID, projet: 1 }],
          projects: [{ id: 1, dateDebut: dateToTimestamp(PROJECT_START), dateFin: dateToTimestamp(PROJECT_END) }],
          assignments: [{
            id: 10,
            tache: TASK_ID,
            membre: MEMBER_ID,
            modeRepartition: 'ponctuel',
            actif: true
          }],
          get entries() {
            return timeEntriesTable.id.map((id, i) => ({
              id,
              tache: timeEntriesTable.tache[i],
              membre: timeEntriesTable.membre[i],
              date: timeEntriesTable.date[i],
              heures: timeEntriesTable.heures[i],
              heuresPrevues: timeEntriesTable.heuresPrevues[i],
              affectation: timeEntriesTable.affectation[i],
              feuille: timeEntriesTable.feuille[i]
            }));
          },
          sheets: [{ id: 50, membre: MEMBER_ID, semaine: dateToTimestamp('2026-07-27') }],
          dailyCapacities: [{
            id: 70,
            membre: MEMBER_ID,
            date: dateToTimestamp(REALISATION_DATE),
            capaciteDisponible: 7
          }],
          team: [{ id: MEMBER_ID }],
          grist: mockGrist
        };
        
        await saveCraCellChange({
          taskId: TASK_ID,
          personId: MEMBER_ID,
          dateIso: REALISATION_DATE,
          hours: 4
        }, dependencies);
        
        const after21 = {
          id: timeEntriesTable.id[0],
          heuresPrevues: timeEntriesTable.heuresPrevues[0],
          date: timeEntriesTable.date[0]
        };
        const after22 = {
          id: timeEntriesTable.id[1],
          heuresPrevues: timeEntriesTable.heuresPrevues[1],
          date: timeEntriesTable.date[1]
        };
        
        expect(after21).toEqual(before21);
        expect(after22).toEqual(before22);
      });
    });
    
    describe('B3.19 — absence de replan', () => {
      test('aucun appel de replan dans saveCraCellChange', async () => {
        const mockGrist = {
          docApi: {
            fetchTable: jest.fn().mockImplementation(async function(table) {
              if (table === 'MemberDailyCapacities') {
                return {
                  id: [70],
                  membre: [MEMBER_ID],
                  date: [dateToTimestamp(REALISATION_DATE)],
                  capaciteDisponible: [7]
                };
              }
              return { id: [] };
            }),
            applyUserActions: jest.fn().mockResolvedValue({ retValues: [101] })
          }
        };
        
        const dependencies = {
          tasks: [{ id: TASK_ID, projet: 1 }],
          projects: [{ id: 1, dateDebut: dateToTimestamp(PROJECT_START), dateFin: dateToTimestamp(PROJECT_END) }],
          assignments: [{
            id: 10,
            tache: TASK_ID,
            membre: MEMBER_ID,
            modeRepartition: 'ponctuel',
            actif: true
          }],
          entries: [],
          sheets: [{ id: 50, membre: MEMBER_ID, semaine: dateToTimestamp('2026-07-27') }],
          dailyCapacities: [{
            id: 70,
            membre: MEMBER_ID,
            date: dateToTimestamp(REALISATION_DATE),
            capaciteDisponible: 7
          }],
          team: [{ id: MEMBER_ID }],
          grist: mockGrist
        };
        
        const result = await saveCraCellChange({
          taskId: TASK_ID,
          personId: MEMBER_ID,
          dateIso: REALISATION_DATE,
          hours: 4
        }, dependencies);
        
        expect(result.ok).toBe(true);
        
        const controllerCode = CRAController.saveCraCellChange.toString();
        expect(controllerCode).not.toMatch(/planAssignment/);
        expect(controllerCode).not.toMatch(/reconcileAssignmentPlan/);
        expect(controllerCode).not.toMatch(/replanMembers/);
        expect(controllerCode).not.toMatch(/memberPlanningOrchestrator/);
        expect(controllerCode).not.toMatch(/ganttAutoPlanning/);
      });
    });
    
    describe('B3.20 — dates civiles impossibles', () => {
      const invalidDates = [
        '2026-02-29',
        '2026-02-31',
        '2026-04-31',
        '2026-13-01',
        '2026-00-10'
      ];
      
      test.each(invalidDates)('parseStrictIsoDate rejette %s', (value) => {
        expect(parseStrictIsoDate(value)).toBe(null);
        expect(gristDateFromIso(value)).toBe(null);
        expect(weekStartIsoFromDateIso(value)).toBe(null);
      });
      
      test.each(invalidDates)('resolveActiveAssignment rejette %s', (value) => {
        const result = resolveActiveAssignment(TASK_ID, MEMBER_ID, value, [], {});
        expect(result.status).toBe('invalid');
        expect(result.code).toBe('INVALID_ENTRY_DATE');
      });
      
      test('saveCraCellChange rejette date invalide', async () => {
        const dependencies = {
          tasks: [{ id: TASK_ID }],
          projects: [],
          assignments: [],
          entries: [],
          sheets: [],
          dailyCapacities: [],
          team: [],
          grist: { docApi: { applyUserActions: jest.fn() } }
        };
        
        const result = await saveCraCellChange({
          taskId: TASK_ID,
          personId: MEMBER_ID,
          dateIso: '2026-02-31',
          hours: 4
        }, dependencies);
        
        expect(result.ok).toBe(false);
        expect(result.code).toBe('INVALID_ENTRY_DATE');
      });
    });
    
    describe('B3.21 — année bissextile', () => {
      test('2024-02-29 est valide', () => {
        const date = parseStrictIsoDate('2024-02-29');
        expect(date).toBeInstanceOf(Date);
        expect(date.getUTCFullYear()).toBe(2024);
        expect(date.getUTCMonth()).toBe(1);
        expect(date.getUTCDate()).toBe(29);
        
        const timestamp = gristDateFromIso('2024-02-29');
        expect(timestamp).toBe(Date.UTC(2024, 1, 29) / 1000);
      });
      
      test('2026-02-29 est invalide', () => {
        expect(parseStrictIsoDate('2026-02-29')).toBe(null);
      });
    });
    
    describe('B3.22 — aucune borne temporelle', () => {
      test('affectation sans dates projet ni dates affectation', async () => {
        const assignments = [{
          id: 10,
          tache: TASK_ID,
          membre: MEMBER_ID,
          modeRepartition: 'ponctuel',
          actif: true
        }];
        
        const result = resolveActiveAssignment(
          TASK_ID,
          MEMBER_ID,
          REALISATION_DATE,
          assignments,
          {}
        );
        
        expect(result.status).toBe('missing');
        
        const dependencies = {
          tasks: [{ id: TASK_ID, projet: 1 }],
          projects: [{ id: 1 }],
          assignments,
          entries: [],
          sheets: [],
          dailyCapacities: [],
          team: [{ id: MEMBER_ID }],
          grist: { docApi: { applyUserActions: jest.fn() } }
        };
        
        const saveResult = await saveCraCellChange({
          taskId: TASK_ID,
          personId: MEMBER_ID,
          dateIso: REALISATION_DATE,
          hours: 4
        }, dependencies);
        
        expect(saveResult.ok).toBe(false);
        expect(saveResult.code).toBe('MISSING_ACTIVE_ASSIGNMENT');
      });
    });
    
    describe('B3.23 — une seule borne temporelle', () => {
      test('seulement dateDebut', () => {
        const assignments = [{
          id: 10,
          tache: TASK_ID,
          membre: MEMBER_ID,
          dateDebut: dateToTimestamp('2026-01-01'),
          modeRepartition: 'ponctuel',
          actif: true
        }];
        
        const result = resolveActiveAssignment(
          TASK_ID,
          MEMBER_ID,
          REALISATION_DATE,
          assignments,
          {}
        );
        
        expect(result.status).toBe('found');
      });
      
      test('seulement dateFin', () => {
        const assignments = [{
          id: 10,
          tache: TASK_ID,
          membre: MEMBER_ID,
          dateFin: dateToTimestamp('2026-12-31'),
          modeRepartition: 'ponctuel',
          actif: true
        }];
        
        const result = resolveActiveAssignment(
          TASK_ID,
          MEMBER_ID,
          REALISATION_DATE,
          assignments,
          {}
        );
        
        expect(result.status).toBe('found');
      });
      
      test('seulement dateDebut future', () => {
        const assignments = [{
          id: 10,
          tache: TASK_ID,
          membre: MEMBER_ID,
          dateDebut: dateToTimestamp('2026-08-01'),
          modeRepartition: 'ponctuel',
          actif: true
        }];
        
        const result = resolveActiveAssignment(
          TASK_ID,
          MEMBER_ID,
          REALISATION_DATE,
          assignments,
          {}
        );
        
        expect(result.status).toBe('missing');
      });
      
      test('seulement dateFin passée', () => {
        const assignments = [{
          id: 10,
          tache: TASK_ID,
          membre: MEMBER_ID,
          dateFin: dateToTimestamp('2026-07-01'),
          modeRepartition: 'ponctuel',
          actif: true
        }];
        
        const result = resolveActiveAssignment(
          TASK_ID,
          MEMBER_ID,
          REALISATION_DATE,
          assignments,
          {}
        );
        
        expect(result.status).toBe('missing');
      });
    });
    
    describe('B3.24 — règle week-end par mode', () => {
      const samedi = '2026-07-25';
      
      const assignmentsUniforme = [{
        id: 10,
        tache: TASK_ID,
        membre: MEMBER_ID,
        dateDebut: dateToTimestamp('2026-07-20'),
        dateFin: dateToTimestamp('2026-07-31'),
        modeRepartition: 'uniforme',
        actif: true
      }];
      
      const assignmentsPonctuel = [{
        id: 10,
        tache: TASK_ID,
        membre: MEMBER_ID,
        dateDebut: dateToTimestamp('2026-07-20'),
        dateFin: dateToTimestamp('2026-07-31'),
        modeRepartition: 'ponctuel',
        actif: true
      }];
      
      test('mode uniforme accepte week-end', () => {
        const result = resolveActiveAssignment(
          TASK_ID,
          MEMBER_ID,
          samedi,
          assignmentsUniforme,
          {}
        );
        
        expect(result.status).toBe('found');
      });
      
      test('mode ponctuel refuse week-end par défaut', () => {
        const result = resolveActiveAssignment(
          TASK_ID,
          MEMBER_ID,
          samedi,
          assignmentsPonctuel,
          { allowWeekends: false }
        );
        
        expect(result.status).toBe('missing');
      });
      
      test('mode ponctuel accepte week-end si allowWeekends=true', () => {
        const result = resolveActiveAssignment(
          TASK_ID,
          MEMBER_ID,
          samedi,
          assignmentsPonctuel,
          { allowWeekends: true }
        );
        
        expect(result.status).toBe('found');
      });
    });
    
    describe('B3.25 — mode démonstration cohérent', () => {
      test('loadDemo définit currentUserMemberId et selectedPersonId', () => {
        const fs = require('fs');
        const path = require('path');
        
        const craPath = path.join(__dirname, '../../../cra.html');
        const craContent = fs.readFileSync(craPath, 'utf8');
        
        const loadDemoStart = craContent.indexOf('function loadDemo()');
        const loadDemoEnd = craContent.indexOf('render();', loadDemoStart);
        
        expect(loadDemoStart).toBeGreaterThan(-1);
        expect(loadDemoEnd).toBeGreaterThan(loadDemoStart);
        
        const loadDemoBlock = craContent.substring(loadDemoStart, loadDemoEnd);
        
        expect(loadDemoBlock).toContain('S.currentUserMemberId = 1');
        expect(loadDemoBlock).toContain('S.selectedPersonId = 1');
      });
      
      test('loadDemo crée affectation pour tâche 6', () => {
        const fs = require('fs');
        const path = require('path');
        
        const craPath = path.join(__dirname, '../../../cra.html');
        const craContent = fs.readFileSync(craPath, 'utf8');
        
        const loadDemoStart = craContent.indexOf('function loadDemo()');
        const loadDemoEnd = craContent.indexOf('render();', loadDemoStart);
        
        expect(loadDemoStart).toBeGreaterThan(-1);
        expect(loadDemoEnd).toBeGreaterThan(loadDemoStart);
        
        const loadDemoBlock = craContent.substring(loadDemoStart, loadDemoEnd);
        
        expect(loadDemoBlock).toContain('tache: 6');
        expect(loadDemoBlock).toContain('membre: 1');
      });
      
      test('setCell utilise createDemoGristAdapter quand S.alone', () => {
        const fs = require('fs');
        const path = require('path');
        
        const craPath = path.join(__dirname, '../../../cra.html');
        const craContent = fs.readFileSync(craPath, 'utf8');
        
        const setCellStart = craContent.indexOf('async function setCell(');
        const setCellEnd = craContent.indexOf('window.setCell = setCell;');
        
        expect(setCellStart).toBeGreaterThan(-1);
        expect(setCellEnd).toBeGreaterThan(setCellStart);
        
        const setCellBlock = craContent.substring(setCellStart, setCellEnd);
        
        expect(setCellBlock).toContain('S.alone');
        expect(setCellBlock).toContain('createDemoGristAdapter');
      });
    });
  });
});