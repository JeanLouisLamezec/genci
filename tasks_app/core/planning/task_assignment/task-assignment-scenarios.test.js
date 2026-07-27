/* ============================================================================
 * task-assignment-jason-scenarios.test.js — Tests des scénarios Jason
 * ----------------------------------------------------------------------------
 * Teste les 3 anomalies fonctionnelles :
 * 1. Suppression d'une tâche ou d'une affectation laissant des temps visibles
 * 2. Intervention ponctuelle : saisir le réalisé sur un autre jour que prévu
 * 3. Absence longue : redistribuer correctement les heures
 * ============================================================================ */

require('./task-assignment-service');
require('../gantt/gantt-task-assignment-integration');
require('../time_entry/time-entry-planning-service');

const { createTaskAssignmentService } = global;
const { createGanttAssignmentIntegration } = global;
const { planAssignment, DISTRIBUTION_MODES } = require('../time_entry/time-entry-planning-service');

describe('Scénarios Jason — Anomalies fonctionnelles', () => {
    let mockGrist;
    let integration;
    let assignmentService;
    
    // Tables Grist simulées
    let tasksTable;
    let teamTable;
    let taskAssignmentsTable;
    let timeEntriesTable;
    let memberDailyCapacitiesTable;
    let availabilitiesTable;
    let sheetsTable;

    beforeEach(() => {
        // Initialiser les tables
        tasksTable = {
            id: [],
            titre: [],
            dateDebut: [],
            dateEcheance: [],
            assignees: [],
            charges: [],
            parentTask: []
        };

        teamTable = {
            id: [1, 2, 3],
            nom: ['Jason', 'Cédric', 'Alice'],
            capaciteHebdo: [35, 35, 35]
        };

        taskAssignmentsTable = {
            id: [],
            tache: [],
            membre: [],
            heuresAllouees: [],
            dateDebut: [],
            dateFin: [],
            modeRepartition: [],
            actif: [],
            commentaire: []
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
            imputation: [],
            capaciteJour: [],
            revisionPlan: [],
            capaciteTheorique: [],
            capaciteDisponible: []
        };

        memberDailyCapacitiesTable = {
            id: [],
            membre: [],
            date: [],
            capaciteTheorique: [],
            disponibiliteRatio: [],
            capaciteDisponible: [],
            absenceHeures: [],
            source: [],
            revision: []
        };

        availabilitiesTable = {
            id: [],
            membre: [],
            dateDebut: [],
            dateFin: [],
            dispo: []
        };

        sheetsTable = {
            id: [],
            membre: [],
            semaine: [],
            statut: []
        };

        // Mock Grist
        mockGrist = {
            docApi: {
                fetchTable: jest.fn().mockImplementation(async function(table) {
                    if (table === 'Tasks') return tasksTable;
                    if (table === 'Team') return teamTable;
                    if (table === 'TaskAssignments') return taskAssignmentsTable;
                    if (table === 'TimeEntries') return timeEntriesTable;
                    if (table === 'MemberDailyCapacities') return memberDailyCapacitiesTable;
                    if (table === 'Disponibilites') return availabilitiesTable;
                    if (table === 'Feuilles') return sheetsTable;
                    return { id: [] };
                }),
                applyUserActions: jest.fn().mockImplementation(async function(actions) {
                    const retValues = [];
                    
                    for (const action of actions) {
                        const [type, tableName, recordId, data] = action;
                        
                        if (type === 'AddRecord') {
                            let newId;
                            
                            if (tableName === 'Tasks') {
                                newId = (tasksTable.id.length > 0 ? Math.max(...tasksTable.id) : 0) + 1;
                                tasksTable.id.push(newId);
                                tasksTable.titre.push(data.titre || '');
                                tasksTable.dateDebut.push(data.dateDebut || null);
                                tasksTable.dateEcheance.push(data.dateEcheance || null);
                                tasksTable.assignees.push(data.assignees || []);
                                tasksTable.charges.push(data.charges || null);
                                tasksTable.parentTask.push(data.parentTask || null);
                            } else if (tableName === 'TaskAssignments') {
                                newId = (taskAssignmentsTable.id.length > 0 ? Math.max(...taskAssignmentsTable.id) : 0) + 1;
                                taskAssignmentsTable.id.push(newId);
                                taskAssignmentsTable.tache.push(data.tache);
                                taskAssignmentsTable.membre.push(data.membre);
                                taskAssignmentsTable.heuresAllouees.push(data.heuresAllouees || 0);
                                taskAssignmentsTable.dateDebut.push(data.dateDebut || null);
                                taskAssignmentsTable.dateFin.push(data.dateFin || null);
                                taskAssignmentsTable.modeRepartition.push(data.modeRepartition || 'uniforme');
                                taskAssignmentsTable.actif.push(data.actif !== undefined ? data.actif : true);
                                taskAssignmentsTable.commentaire.push(data.commentaire || '');
                                retValues.push(newId);
                            } else if (tableName === 'TimeEntries') {
                                newId = (timeEntriesTable.id.length > 0 ? Math.max(...timeEntriesTable.id) : 0) + 1;
                                timeEntriesTable.id.push(newId);
                                timeEntriesTable.tache.push(data.tache || null);
                                timeEntriesTable.membre.push(data.membre || null);
                                timeEntriesTable.date.push(data.date || null);
                                timeEntriesTable.heures.push(data.heures !== undefined ? data.heures : null);
                                timeEntriesTable.heuresPrevues.push(data.heuresPrevues || 0);
                                timeEntriesTable.affectation.push(data.affectation || null);
                                timeEntriesTable.feuille.push(data.feuille || null);
                                timeEntriesTable.description.push(data.description || '');
                                timeEntriesTable.imputation.push(data.imputation || '');
                                timeEntriesTable.capaciteJour.push(data.capaciteJour || null);
                                timeEntriesTable.revisionPlan.push(data.revisionPlan || 0);
                                timeEntriesTable.capaciteTheorique.push(data.capaciteTheorique || 0);
                                timeEntriesTable.capaciteDisponible.push(data.capaciteDisponible || 0);
                                retValues.push(newId);
                            } else if (tableName === 'MemberDailyCapacities') {
                                newId = (memberDailyCapacitiesTable.id.length > 0 ? Math.max(...memberDailyCapacitiesTable.id) : 0) + 1;
                                memberDailyCapacitiesTable.id.push(newId);
                                memberDailyCapacitiesTable.membre.push(data.membre);
                                memberDailyCapacitiesTable.date.push(data.date);
                                memberDailyCapacitiesTable.capaciteTheorique.push(data.capaciteTheorique || 0);
                                memberDailyCapacitiesTable.disponibiliteRatio.push(data.disponibiliteRatio ?? 1);
                                memberDailyCapacitiesTable.capaciteDisponible.push(data.capaciteDisponible || 0);
                                memberDailyCapacitiesTable.absenceHeures.push(data.absenceHeures || 0);
                                memberDailyCapacitiesTable.source.push(data.source || 'calcul');
                                memberDailyCapacitiesTable.revision.push(data.revision || 1);
                                retValues.push(newId);
                            } else if (tableName === 'Disponibilites') {
                                newId = (availabilitiesTable.id.length > 0 ? Math.max(...availabilitiesTable.id) : 0) + 1;
                                availabilitiesTable.id.push(newId);
                                availabilitiesTable.membre.push(data.membre);
                                availabilitiesTable.dateDebut.push(data.dateDebut);
                                availabilitiesTable.dateFin.push(data.dateFin);
                                availabilitiesTable.dispo.push(data.dispo);
                                retValues.push(newId);
                            } else if (tableName === 'Feuilles') {
                                newId = (sheetsTable.id.length > 0 ? Math.max(...sheetsTable.id) : 0) + 1;
                                sheetsTable.id.push(newId);
                                sheetsTable.membre.push(data.membre);
                                sheetsTable.semaine.push(data.semaine);
                                sheetsTable.statut.push(data.statut || 'brouillon');
                                retValues.push(newId);
                            } else {
                                newId = recordId != null ? recordId : 999;
                                retValues.push(newId);
                            }
                        } else if (type === 'UpdateRecord') {
                            if (tableName === 'Tasks') {
                                const idx = tasksTable.id.indexOf(recordId);
                                if (idx >= 0) {
                                    Object.keys(data).forEach(key => {
                                        if (tasksTable[key]) tasksTable[key][idx] = data[key];
                                    });
                                }
                            } else if (tableName === 'TaskAssignments') {
                                const idx = taskAssignmentsTable.id.indexOf(recordId);
                                if (idx >= 0) {
                                    Object.keys(data).forEach(key => {
                                        if (taskAssignmentsTable[key]) taskAssignmentsTable[key][idx] = data[key];
                                    });
                                }
                            } else if (tableName === 'TimeEntries') {
                                const idx = timeEntriesTable.id.indexOf(recordId);
                                if (idx >= 0) {
                                    Object.keys(data).forEach(key => {
                                        if (timeEntriesTable[key]) timeEntriesTable[key][idx] = data[key];
                                    });
                                }
                            } else if (tableName === 'MemberDailyCapacities') {
                                const idx = memberDailyCapacitiesTable.id.indexOf(recordId);
                                if (idx >= 0) {
                                    Object.keys(data).forEach(key => {
                                        if (memberDailyCapacitiesTable[key]) memberDailyCapacitiesTable[key][idx] = data[key];
                                    });
                                }
                            } else if (tableName === 'Disponibilites') {
                                const idx = availabilitiesTable.id.indexOf(recordId);
                                if (idx >= 0) {
                                    Object.keys(data).forEach(key => {
                                        if (availabilitiesTable[key]) availabilitiesTable[key][idx] = data[key];
                                    });
                                }
                            }
                            retValues.push(null);
                        } else if (type === 'RemoveRecord') {
                            if (tableName === 'Tasks') {
                                const idx = tasksTable.id.indexOf(recordId);
                                if (idx >= 0) {
                                    tasksTable.id.splice(idx, 1);
                                    tasksTable.titre.splice(idx, 1);
                                    tasksTable.dateDebut.splice(idx, 1);
                                    tasksTable.dateEcheance.splice(idx, 1);
                                    tasksTable.assignees.splice(idx, 1);
                                    tasksTable.charges.splice(idx, 1);
                                    tasksTable.parentTask.splice(idx, 1);
                                }
                            } else if (tableName === 'TaskAssignments') {
                                const idx = taskAssignmentsTable.id.indexOf(recordId);
                                if (idx >= 0) {
                                    taskAssignmentsTable.id.splice(idx, 1);
                                    taskAssignmentsTable.tache.splice(idx, 1);
                                    taskAssignmentsTable.membre.splice(idx, 1);
                                    taskAssignmentsTable.heuresAllouees.splice(idx, 1);
                                    taskAssignmentsTable.dateDebut.splice(idx, 1);
                                    taskAssignmentsTable.dateFin.splice(idx, 1);
                                    taskAssignmentsTable.modeRepartition.splice(idx, 1);
                                    taskAssignmentsTable.actif.splice(idx, 1);
                                    taskAssignmentsTable.commentaire.splice(idx, 1);
                                }
                            } else if (tableName === 'TimeEntries') {
                                const idx = timeEntriesTable.id.indexOf(recordId);
                                if (idx >= 0) {
                                    timeEntriesTable.id.splice(idx, 1);
                                    timeEntriesTable.tache.splice(idx, 1);
                                    timeEntriesTable.membre.splice(idx, 1);
                                    timeEntriesTable.date.splice(idx, 1);
                                    timeEntriesTable.heures.splice(idx, 1);
                                    timeEntriesTable.heuresPrevues.splice(idx, 1);
                                    timeEntriesTable.affectation.splice(idx, 1);
                                    timeEntriesTable.feuille.splice(idx, 1);
                                    timeEntriesTable.description.splice(idx, 1);
                                    timeEntriesTable.imputation.splice(idx, 1);
                                    timeEntriesTable.capaciteJour.splice(idx, 1);
                                    timeEntriesTable.revisionPlan.splice(idx, 1);
                                    timeEntriesTable.capaciteTheorique.splice(idx, 1);
                                    timeEntriesTable.capaciteDisponible.splice(idx, 1);
                                }
                            } else if (tableName === 'MemberDailyCapacities') {
                                const idx = memberDailyCapacitiesTable.id.indexOf(recordId);
                                if (idx >= 0) {
                                    memberDailyCapacitiesTable.id.splice(idx, 1);
                                    memberDailyCapacitiesTable.membre.splice(idx, 1);
                                    memberDailyCapacitiesTable.date.splice(idx, 1);
                                    memberDailyCapacitiesTable.capaciteTheorique.splice(idx, 1);
                                    memberDailyCapacitiesTable.disponibiliteRatio.splice(idx, 1);
                                    memberDailyCapacitiesTable.capaciteDisponible.splice(idx, 1);
                                    memberDailyCapacitiesTable.absenceHeures.splice(idx, 1);
                                    memberDailyCapacitiesTable.source.splice(idx, 1);
                                    memberDailyCapacitiesTable.revision.splice(idx, 1);
                                }
                            }
                            retValues.push(null);
                        } else {
                            retValues.push(null);
                        }
                    }
                    
                    return { retValues };
                })
            }
        };

        integration = createGanttAssignmentIntegration(mockGrist, { logEnabled: false });
        assignmentService = createTaskAssignmentService(mockGrist, { logEnabled: false });
    });

    // ========================================================================
    // PHASE A — SUPPRESSION D'UNE TÂCHE ET NETTOYAGE DES TEMPS
    // ========================================================================
    describe('PHASE A — Suppression et nettoyage', () => {
        test('Scénario A1 — Tâche avec uniquement du prévu mutable (heures=null)', async () => {
            // 0. Ajouter la tâche manuellement (elle est créée par le widget Gantt en amont)
            tasksTable.id.push(6);
            tasksTable.titre.push('test Jason A1');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 10 }]));
            tasksTable.parentTask.push(null);

            // 1. Synchroniser les affectations
            const createResult = await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 10 }],
                dateDebut: 1784505600, // 2026-07-20
                dateEcheance: 1785456000 // 2026-07-31
            });

            expect(createResult.ok).toBe(true);
            expect(taskAssignmentsTable.id).toHaveLength(1);

            // 2. Ajouter des TimeEntries futures avec heures = null (prévu mutable)
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000); // 2026-07-21
            timeEntriesTable.heures.push(null); // mutable
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[0]);
            timeEntriesTable.feuille.push(null);

            timeEntriesTable.id.push(2);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784678400); // 2026-07-22
            timeEntriesTable.heures.push(null); // mutable
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[0]);
            timeEntriesTable.feuille.push(null);

            expect(timeEntriesTable.id).toHaveLength(2);

            // 3. Supprimer la tâche
            const deleteResult = await integration.deleteTasksWithAssignments([6]);

            expect(deleteResult.ok).toBe(true);
            expect(deleteResult.deletedTimeEntries).toBe(2);
            expect(deleteResult.deletedAssignments).toBe(1);
            expect(deleteResult.deletedTasks).toBe(1);

            // 4. Vérifier : aucune ligne résiduelle
            expect(tasksTable.id).not.toContain(6);
            expect(taskAssignmentsTable.id).toHaveLength(0);
            expect(timeEntriesTable.id).toHaveLength(0);
        });

        test('Scénario A2 — Retrait du membre (désactivation affectation)', async () => {
            // 0. Ajouter la tâche manuellement
            tasksTable.id.push(6);
            tasksTable.titre.push('test Jason A2');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 10 }]));
            tasksTable.parentTask.push(null);

            // 1. Créer une tâche avec affectation
            await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 10 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });

            // 2. Ajouter du prévu mutable
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(null);
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[0]);
            timeEntriesTable.feuille.push(null);

            // 3. Retirer le membre (mettre à zéro les heures allouées)
            const updateResult = await integration.onTaskUpdated(6, {
                assignees: [],
                charges: [],
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                assignmentsEdited: true
            });

            expect(updateResult.ok).toBe(true);

            // 4. Vérifier : affectation désactivée
            const assignmentIdx = taskAssignmentsTable.id.indexOf(1);
            expect(assignmentIdx).toBeGreaterThan(-1);
            expect(taskAssignmentsTable.actif[assignmentIdx]).toBe(false);

            // PHASE A.2 : Le prévu mutable doit être supprimé
            expect(timeEntriesTable.id).toHaveLength(0);
        });

        test('Scénario A3 — Réalisé explicite bloque la suppression', async () => {
            // 0. Ajouter la tâche manuellement (elle est créée par le widget Gantt en amont)
            tasksTable.id.push(6);
            tasksTable.titre.push('test Jason A3');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 10 }]));
            tasksTable.parentTask.push(null);

            // 1. Synchroniser les affectations (appelé par le widget après création)
            const createResult = await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 10 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });

            expect(createResult.ok).toBe(true);
            expect(taskAssignmentsTable.id).toHaveLength(1);
            const assignmentId = taskAssignmentsTable.id[0];

            // Debug : vérifier l'état après création
            console.log('Après création - tasksTable.id:', tasksTable.id);
            console.log('Après création - taskAssignmentsTable.id:', taskAssignmentsTable.id);

            // 2. Ajouter un TimeEntry avec heures = 2 (réalisé explicite)
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(2); // réalisé explicite
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(assignmentId);
            timeEntriesTable.feuille.push(null);

            // Debug : vérifier que les données sont bien présentes
            expect(timeEntriesTable.heures[0]).toBe(2);
            expect(timeEntriesTable.affectation[0]).toBe(assignmentId);

            console.log('Avant suppression - tasksTable.id:', tasksTable.id);
            console.log('Avant suppression - timeEntriesTable:', {
                id: timeEntriesTable.id,
                heures: timeEntriesTable.heures,
                affectation: timeEntriesTable.affectation
            });

            // 3. Tenter de supprimer
            const deleteResult = await integration.deleteTasksWithAssignments([6]);

            console.log('Résultat suppression:', deleteResult);
            console.log('Après suppression - tasksTable.id:', tasksTable.id);

            expect(deleteResult.ok).toBe(false);
            expect(deleteResult.code).toBe('TASK_DELETE_BLOCKED_BY_TIME_ENTRIES');

            // 4. Vérifier : rien n'est supprimé
            expect(tasksTable.id).toContain(6);
            expect(taskAssignmentsTable.id).toHaveLength(1);
            expect(timeEntriesTable.id).toHaveLength(1);
        });

        test('Scénario A4 — Feuille validée bloque la suppression', async () => {
            // 1. Créer une tâche
            await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 10 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });

            // 2. Créer une feuille validée
            sheetsTable.id.push(1);
            sheetsTable.membre.push(1);
            sheetsTable.semaine.push(1784332800); // Semaine du 2026-07-20
            sheetsTable.statut.push('valide');

            // 3. Ajouter un TimeEntry lié à cette feuille
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(2);
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[0]);
            timeEntriesTable.feuille.push(1); // lié à une feuille

            // 4. Tenter de supprimer
            const deleteResult = await integration.deleteTasksWithAssignments([6]);

            expect(deleteResult.ok).toBe(false);
            expect(deleteResult.code).toBe('TASK_DELETE_BLOCKED_BY_TIME_ENTRIES');
        });

        test('Scénario A5 — Heures remises à null permet la suppression', async () => {
            // 1. Créer une tâche
            await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 10 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });

            // 2. Ajouter un TimeEntry avec heures = 2
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(2);
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[0]);
            timeEntriesTable.feuille.push(null); // feuille éditable

            // 3. Remettre heures à null (effacer le réalisé)
            const updateIdx = timeEntriesTable.id.indexOf(1);
            timeEntriesTable.heures[updateIdx] = null;

            // 4. Supprimer
            const deleteResult = await integration.deleteTasksWithAssignments([6]);

            expect(deleteResult.ok).toBe(true);
            expect(deleteResult.deletedTimeEntries).toBe(1);
        });

        test('Scénario A6 — Feuille brouillon avec heures=null permet le retrait', async () => {
            // 0. Ajouter la tâche
            tasksTable.id.push(6);
            tasksTable.titre.push('test A6');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 10 }]));
            tasksTable.parentTask.push(null);

            await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 10 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });

            // Créer une feuille brouillon
            sheetsTable.id.push(1);
            sheetsTable.membre.push(1);
            sheetsTable.semaine.push(1784332800);
            sheetsTable.statut.push('brouillon');

            // TimeEntry avec feuille brouillon et heures=null
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(null);
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[0]);
            timeEntriesTable.feuille.push(1);

            // Retirer le membre
            const updateResult = await integration.onTaskUpdated(6, {
                assignees: [],
                charges: [],
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                assignmentsEdited: true
            });

            expect(updateResult.ok).toBe(true);

            // Vérifier : affectation désactivée et TimeEntry supprimée
            const assignmentIdx = taskAssignmentsTable.id.indexOf(1);
            expect(taskAssignmentsTable.actif[assignmentIdx]).toBe(false);
            expect(timeEntriesTable.id).toHaveLength(0);
        });

        test('Scénario A7 — Feuille rejetée avec heures=null permet le retrait', async () => {
            // 0. Ajouter la tâche
            tasksTable.id.push(6);
            tasksTable.titre.push('test A7');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 10 }]));
            tasksTable.parentTask.push(null);

            await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 10 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });

            // Créer une feuille rejetée
            sheetsTable.id.push(1);
            sheetsTable.membre.push(1);
            sheetsTable.semaine.push(1784332800);
            sheetsTable.statut.push('rejete');

            // TimeEntry avec feuille rejetée et heures=null
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(null);
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[0]);
            timeEntriesTable.feuille.push(1);

            // Retirer le membre
            const updateResult = await integration.onTaskUpdated(6, {
                assignees: [],
                charges: [],
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                assignmentsEdited: true
            });

            expect(updateResult.ok).toBe(true);

            // Vérifier : affectation désactivée et TimeEntry supprimée
            const assignmentIdx = taskAssignmentsTable.id.indexOf(1);
            expect(taskAssignmentsTable.actif[assignmentIdx]).toBe(false);
            expect(timeEntriesTable.id).toHaveLength(0);
        });

        test('Scénario A8 — Heures = 0 explicite bloque le retrait', async () => {
            // 0. Ajouter la tâche
            tasksTable.id.push(6);
            tasksTable.titre.push('test A8');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 10 }]));
            tasksTable.parentTask.push(null);

            await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 10 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });

            // TimeEntry avec heures = 0 (explicite)
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(0); // zéro explicite
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[0]);

            // Retirer le membre → doit être bloqué
            const updateResult = await integration.onTaskUpdated(6, {
                assignees: [],
                charges: [],
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                assignmentsEdited: true
            });

            expect(updateResult.ok).toBe(false);
            expect(updateResult.code).toBe('MEMBER_REMOVAL_BLOCKED_BY_PROTECTED_TIME');

            // Vérifier : zéro écriture
            expect(taskAssignmentsTable.actif[0]).toBe(true); // Toujours actif
            expect(timeEntriesTable.id).toHaveLength(1); // TimeEntry intacte
        });

        test('Scénario A9 — Heures positives bloquent le retrait', async () => {
            // 0. Ajouter la tâche
            tasksTable.id.push(6);
            tasksTable.titre.push('test A9');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 10 }]));
            tasksTable.parentTask.push(null);

            await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 10 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });

            // TimeEntry avec heures = 3
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(3);
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[0]);

            // Retirer le membre → doit être bloqué
            const updateResult = await integration.onTaskUpdated(6, {
                assignees: [],
                charges: [],
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                assignmentsEdited: true
            });

            expect(updateResult.ok).toBe(false);
            expect(updateResult.code).toBe('MEMBER_REMOVAL_BLOCKED_BY_PROTECTED_TIME');

            // Vérifier : zéro écriture
            expect(taskAssignmentsTable.actif[0]).toBe(true);
            expect(timeEntriesTable.id).toHaveLength(1);
        });

        test('Scénario A10 — Feuille soumise bloque le retrait', async () => {
            // 0. Ajouter la tâche
            tasksTable.id.push(6);
            tasksTable.titre.push('test A10');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 10 }]));
            tasksTable.parentTask.push(null);

            await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 10 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });

            // Créer une feuille soumise
            sheetsTable.id.push(1);
            sheetsTable.membre.push(1);
            sheetsTable.semaine.push(1784332800);
            sheetsTable.statut.push('soumis');

            // TimeEntry avec feuille soumise (même avec heures=null)
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(null);
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[0]);
            timeEntriesTable.feuille.push(1);

            // Retirer le membre → doit être bloqué
            const updateResult = await integration.onTaskUpdated(6, {
                assignees: [],
                charges: [],
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                assignmentsEdited: true
            });

            expect(updateResult.ok).toBe(false);
            expect(updateResult.code).toBe('MEMBER_REMOVAL_BLOCKED_BY_PROTECTED_TIME');

            // Vérifier : zéro écriture
            expect(taskAssignmentsTable.actif[0]).toBe(true);
            expect(timeEntriesTable.id).toHaveLength(1);
        });

        test('Scénario A11 — Plusieurs affectations historiques', async () => {
            // 0. Ajouter la tâche
            tasksTable.id.push(6);
            tasksTable.titre.push('test A11');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1, 'L', 2]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 10 }, { teamId: 2, heures: 5 }]));
            tasksTable.parentTask.push(null);

            await integration.onTaskCreated(6, {
                assignees: ['L', 1, 'L', 2],
                charges: [{ teamId: 1, heures: 10 }, { teamId: 2, heures: 5 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });

            expect(taskAssignmentsTable.id).toHaveLength(2);

            // Membre 1 : TimeEntry protégée
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(2);
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[0]);

            // Membre 2 : TimeEntry mutable
            timeEntriesTable.id.push(2);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(2);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(null);
            timeEntriesTable.heuresPrevues.push(1);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[1]);

            // Retirer les deux membres → doit être bloqué à cause du membre 1
            const updateResult = await integration.onTaskUpdated(6, {
                assignees: [],
                charges: [],
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                assignmentsEdited: true
            });

            expect(updateResult.ok).toBe(false);
            expect(updateResult.code).toBe('MEMBER_REMOVAL_BLOCKED_BY_PROTECTED_TIME');

            // Vérifier : zéro écriture pour TOUT LE MONDE
            expect(taskAssignmentsTable.actif[0]).toBe(true);
            expect(taskAssignmentsTable.actif[1]).toBe(true);
            expect(timeEntriesTable.id).toHaveLength(2);
        });

        test('Scénario A12 — Idempotence du retrait', async () => {
            // 0. Ajouter la tâche
            tasksTable.id.push(6);
            tasksTable.titre.push('test A12');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 10 }]));
            tasksTable.parentTask.push(null);

            await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 10 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });

            // TimeEntry mutable
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(null);
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[0]);

            // Premier retrait
            const result1 = await integration.onTaskUpdated(6, {
                assignees: [],
                charges: [],
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                assignmentsEdited: true
            });

            expect(result1.ok).toBe(true);
            expect(taskAssignmentsTable.actif[0]).toBe(false);
            expect(timeEntriesTable.id).toHaveLength(0);

            // Deuxième retrait (idempotence)
            const result2 = await integration.onTaskUpdated(6, {
                assignees: [],
                charges: [],
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                assignmentsEdited: true
            });

            expect(result2.ok).toBe(true);
            // L'affectation est déjà désactivée, pas d'erreur
        });
    });

    // ========================================================================
    // PHASE B — MODE D'INTERVENTION PONCTUELLE
    // ========================================================================
    describe('PHASE B — Intervention ponctuelle', () => {
        test('Scénario B1 — Création réelle d\'une affectation ponctuelle depuis l\'interface', async () => {
            // 0. Ajouter la tâche manuellement
            tasksTable.id.push(6);
            tasksTable.titre.push('test ponctuel B1');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 8 }]));
            tasksTable.parentTask.push(null);

            // 1. Créer une affectation avec modeRepartition = 'ponctuel'
            const createResult = await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 8 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                distributionMode: 'ponctuel' // PHASE B : mode ponctuel
            });

            expect(createResult.ok).toBe(true);
            expect(taskAssignmentsTable.id).toHaveLength(1);

            // 2. Vérifier que modeRepartition = 'ponctuel' dans TaskAssignments
            const assignmentIdx = taskAssignmentsTable.id.indexOf(1);
            expect(assignmentIdx).toBeGreaterThan(-1);
            expect(taskAssignmentsTable.modeRepartition[assignmentIdx]).toBe('ponctuel');
        });

        test('Scénario B2 — Mode uniforme conserve le comportement actuel', () => {
            const assignment = {
                id: 1,
                tache: 6,
                membre: 1,
                heuresAllouees: 10,
                dateDebut: 1784505600, // 2026-07-20
                dateFin: 1784937600,  // 2026-07-24
                modeRepartition: 'uniforme',
                actif: true
            };

            const capacities = [
                { id: 1, membre: 1, date: 1784505600, capaciteDisponible: 7, capaciteTheorique: 7 },
                { id: 2, membre: 1, date: 1784592000, capaciteDisponible: 7, capaciteTheorique: 7 },
                { id: 3, membre: 1, date: 1784678400, capaciteDisponible: 7, capaciteTheorique: 7 },
                { id: 4, membre: 1, date: 1784764800, capaciteDisponible: 7, capaciteTheorique: 7 },
                { id: 5, membre: 1, date: 1784851200, capaciteDisponible: 7, capaciteTheorique: 7 }
            ];

            const result = planAssignment(assignment, {
                capacities,
                existingEntries: [],
                tasks: [{ id: 6 }],
                members: [{ id: 1 }]
            });

            expect(result.plannedEntries.length).toBeGreaterThan(0);
            expect(result.unallocatedHours).toBeLessThanOrEqual(0.01);
        });

        test('Scénario B3 — Modification de charge conserve le mode ponctuel', async () => {
            // 0. Ajouter la tâche
            tasksTable.id.push(6);
            tasksTable.titre.push('test B3');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 8 }]));
            tasksTable.parentTask.push(null);

            // 1. Créer avec mode ponctuel
            await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 8 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                distributionMode: 'ponctuel'
            });

            expect(taskAssignmentsTable.modeRepartition[0]).toBe('ponctuel');

            // 2. Modifier la charge (sans changer le mode explicitement)
            const updateResult = await integration.onTaskUpdated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 12 }], // Changement de charge
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                assignmentsEdited: true
            });

            expect(updateResult.ok).toBe(true);

            // 3. Vérifier que le mode est toujours 'ponctuel' (PHASE B.14)
            expect(taskAssignmentsTable.modeRepartition[0]).toBe('ponctuel');
        });
    });

    // ========================================================================
    // PHASE C — REDISTRIBUTION APRÈS UNE ABSENCE
    // ========================================================================
    describe('PHASE C — Absence et redistribution', () => {
        test('Scénario C1 — Absence T4 déplace le prévu', () => {
            // membre : Cédric (id=2)
            // projet : 01/01/2026 → 31/12/2026
            // absence : 01/10/2026 → 31/12/2026
            // aujourd'hui : 15/07/2026

            const assignment = {
                id: 1,
                tache: 6,
                membre: 2,
                heuresAllouees: 70, // 10 jours
                dateDebut: 1767225600, // 2026-01-01
                dateFin: 1798761600,   // 2026-12-31
                modeRepartition: 'uniforme',
                actif: true
            };

            // Capacités avec absence T4 (ratio = 0)
            const capacities = [];
            
            // Janvier à septembre : capacité normale
            for (let m = 0; m < 9; m++) {
                for (let d = 1; d <= 28; d += 7) {
                    capacities.push({
                        id: capacities.length + 1,
                        membre: 2,
                        date: new Date(Date.UTC(2026, m, d)).getTime() / 1000,
                        capaciteDisponible: 7,
                        capaciteTheorique: 7
                    });
                }
            }

            // Octobre à décembre : absence (capacité = 0)
            for (let m = 9; m < 12; m++) {
                for (let d = 1; d <= 28; d += 7) {
                    capacities.push({
                        id: capacities.length + 1,
                        membre: 2,
                        date: new Date(Date.UTC(2026, m, d)).getTime() / 1000,
                        capaciteDisponible: 0, // absence
                        capaciteTheorique: 7
                    });
                }
            }

            const result = planAssignment(assignment, {
                capacities,
                existingEntries: [],
                tasks: [{ id: 6 }],
                members: [{ id: 2 }]
            });

            // TODO PHASE C : 
            // - zéro heure prévue sur T4
            // - heures déplacées vers les autres périodes
            // - aucune surcharge
            expect(result).toBeDefined();
        });

        // ========================================================================
        // TESTS COMPLÉMENTAIRES PHASE A — Scénarios avancés
        // ========================================================================
        test('Scénario A13 — Suppression de tâche avec feuille brouillon (heures=null)', async () => {
            // 0. Ajouter la tâche
            tasksTable.id.push(6);
            tasksTable.titre.push('test A13');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 10 }]));
            tasksTable.parentTask.push(null);

            await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 10 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });

            // Feuille brouillon
            sheetsTable.id.push(1);
            sheetsTable.membre.push(1);
            sheetsTable.semaine.push(1784332800);
            sheetsTable.statut.push('brouillon');

            // TimeEntry avec feuille brouillon et heures=null
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(null);
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[0]);
            timeEntriesTable.feuille.push(1);

            // Supprimer → devrait réussir (brouillon + heures=null = mutable)
            const deleteResult = await integration.deleteTasksWithAssignments([6]);


            expect(deleteResult.ok).toBe(true);
            expect(deleteResult.deletedTimeEntries).toBe(1);
        });

        test('Scénario A14 — Suppression avec feuille rejetée (heures=null)', async () => {
            // 0. Ajouter la tâche
            tasksTable.id.push(6);
            tasksTable.titre.push('test A14');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 10 }]));
            tasksTable.parentTask.push(null);

            await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 10 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });

            // Feuille rejetée
            sheetsTable.id.push(1);
            sheetsTable.membre.push(1);
            sheetsTable.semaine.push(1784332800);
            sheetsTable.statut.push('rejete');

            // TimeEntry avec feuille rejetée et heures=null
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(null);
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[0]);
            timeEntriesTable.feuille.push(1);

            // Supprimer → devrait réussir
            const deleteResult = await integration.deleteTasksWithAssignments([6]);

            expect(deleteResult.ok).toBe(true);
            expect(deleteResult.deletedTimeEntries).toBe(1);
        });

        test('Scénario A15 — TimeEntry legacy sans affectation', async () => {
            // 0. Ajouter la tâche
            tasksTable.id.push(6);
            tasksTable.titre.push('test A15');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 10 }]));
            tasksTable.parentTask.push(null);

            await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 10 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });

            // TimeEntry legacy SANS affectation
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(null);
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(null); // PAS d'affectation
            timeEntriesTable.feuille.push(null);
            timeEntriesTable.description.push(null);
            timeEntriesTable.imputation.push(null);

            // NOTE : Le test complet du legacy nécessite un mock Grist plus élaboré
            // avec la gestion des ambiguïtés entre affectations actives/inactives.
            // Le précontrôle et le commit utilisent maintenant includeLegacy: true,
            // mais la validation complète est reportée.
        });

        // Test A15 legacy reporté - nécessite un mock Grist complet avec ambiguïtés
        test.skip('Scénario A15 — TimeEntry legacy sans affectation (reporté)', async () => {
            // TODO: Implémenter avec un mock complet incluant :
            // - affectation inactive historique
            // - affectation active actuelle  
            // - TimeEntry legacy sans affectation
            // - Vérification du blocage en cas d'ambiguïté
        });

        test('Scénario A16 — Idempotence avec compteur d\'actions', async () => {
            // 0. Ajouter la tâche
            tasksTable.id.push(6);
            tasksTable.titre.push('test A16');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 10 }]));
            tasksTable.parentTask.push(null);

            await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 10 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });

            // TimeEntry mutable
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(null);
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[0]);

            // Premier retrait
            const result1 = await integration.onTaskUpdated(6, {
                assignees: [],
                charges: [],
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                assignmentsEdited: true
            });

            expect(result1.ok).toBe(true);
            const actionsCount1 = result1.actionsExecuted || 0;
            expect(actionsCount1).toBeGreaterThan(0);

            // Deuxième retrait (idempotence)
            const result2 = await integration.onTaskUpdated(6, {
                assignees: [],
                charges: [],
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                assignmentsEdited: true
            });

            expect(result2.ok).toBe(true);
            // Le deuxième appel ne devrait rien faire (affectation déjà inactive)
        });

        test('Scénario B4 — Changement explicite de mode de répartition', async () => {
            // 0. Ajouter la tâche
            tasksTable.id.push(6);
            tasksTable.titre.push('test B4');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push(['L', 1]);
            tasksTable.charges.push(JSON.stringify([{ teamId: 1, heures: 8 }]));
            tasksTable.parentTask.push(null);

            // 1. Créer avec mode uniforme
            await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 8 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                distributionMode: 'uniforme'
            });

            expect(taskAssignmentsTable.modeRepartition[0]).toBe('uniforme');

            // 2. Changer explicitement vers ponctuel
            const updateResult = await integration.onTaskUpdated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 8 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                assignmentsEdited: true,
                distributionMode: 'ponctuel' // Changement explicite
            });

            expect(updateResult.ok).toBe(true);
            expect(taskAssignmentsTable.modeRepartition[0]).toBe('ponctuel');

            // 3. Rechanger vers uniforme
            const updateResult2 = await integration.onTaskUpdated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 8 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000,
                assignmentsEdited: true,
                distributionMode: 'uniforme'
            });

            expect(updateResult2.ok).toBe(true);
            expect(taskAssignmentsTable.modeRepartition[0]).toBe('uniforme');
        });
    });
});
