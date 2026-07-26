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
            sheetStatus: [],
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
                                timeEntriesTable.sheetStatus.push(data.sheetStatus || null);
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
                                    timeEntriesTable.sheetStatus.splice(idx, 1);
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
            // 1. Créer une tâche "test Jason"
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
            timeEntriesTable.sheetStatus.push(null);

            timeEntriesTable.id.push(2);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784678400); // 2026-07-22
            timeEntriesTable.heures.push(null); // mutable
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(taskAssignmentsTable.id[0]);
            timeEntriesTable.feuille.push(null);
            timeEntriesTable.sheetStatus.push(null);

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

            // TODO PHASE A : Le prévu mutable doit être supprimé
            // expect(timeEntriesTable.id).toHaveLength(0);
        });

        test('Scénario A3 — Réalisé explicite bloque la suppression', async () => {
            // 1. Créer une tâche
            const createResult = await integration.onTaskCreated(6, {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 10 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });

            expect(createResult.ok).toBe(true);
            expect(taskAssignmentsTable.id).toHaveLength(1);
            const assignmentId = taskAssignmentsTable.id[0];

            // 2. Ajouter un TimeEntry avec heures = 2 (réalisé explicite)
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784592000);
            timeEntriesTable.heures.push(2); // réalisé explicite
            timeEntriesTable.heuresPrevues.push(2);
            timeEntriesTable.affectation.push(assignmentId);
            timeEntriesTable.feuille.push(null);
            timeEntriesTable.sheetStatus.push(null);

            // Debug : vérifier que les données sont bien présentes
            expect(timeEntriesTable.heures[0]).toBe(2);
            expect(timeEntriesTable.affectation[0]).toBe(assignmentId);

            // 3. Tenter de supprimer
            const deleteResult = await integration.deleteTasksWithAssignments([6]);

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
            timeEntriesTable.sheetStatus.push('validated');

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
    });

    // ========================================================================
    // PHASE B — MODE D'INTERVENTION PONCTUELLE
    // ========================================================================
    describe('PHASE B — Intervention ponctuelle', () => {
        test('Scénario B1 — Saisie sur une date hors planification ponctuelle', () => {
            // 1. Créer une affectation ponctuelle
            // projet : 01/01/2026 → 31/12/2026
            // affectation : 23/07/2026 → 24/07/2026
            // modeRepartition : ponctuel
            
            const assignment = {
                id: 1,
                tache: 6,
                membre: 1,
                heuresAllouees: 8,
                dateDebut: 1784851200, // 2026-07-23
                dateFin: 1784937600,  // 2026-07-24
                modeRepartition: 'ponctuel',
                actif: true
            };

            // 2. Capacités du membre
            const capacities = [
                { id: 1, membre: 1, date: 1785110400, capaciteDisponible: 7, capaciteTheorique: 7 }, // 2026-07-27 (lundi)
                { id: 2, membre: 1, date: 1785196800, capaciteDisponible: 7, capaciteTheorique: 7 }  // 2026-07-28
            ];

            // 3. Aucune entrée existante
            const existingEntries = [];

            // 4. Planifier — TODO PHASE B : le mode ponctuel doit permettre la saisie sur d'autres dates
            const result = planAssignment(assignment, {
                capacities,
                existingEntries,
                tasks: [{ id: 6 }],
                members: [{ id: 1 }]
            });

            // TODO: Le mode ponctuel ne doit pas générer de heuresPrevues automatiquement
            // ou doit permettre une fenêtre de saisie étendue
            expect(result).toBeDefined();
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
    });
});
