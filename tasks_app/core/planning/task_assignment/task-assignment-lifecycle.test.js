/* ============================================================================
 * task-assignment-lifecycle.test.js — Tests du cycle de vie complet
 * ----------------------------------------------------------------------------
 * Teste :
 * 1. Création avec affectations
 * 2. Format RefList ['L', 1]
 * 3. Charges JSON string
 * 4. Modification des dates
 * 5. Réparation des tâches endommagées
 * 6. Suppression simple
 * 7. Suppression avec TimeEntries mutables
 * 8. Suppression bloquée par TimeEntries verrouillés
 * ============================================================================ */

require('./task-assignment-service');
require('../gantt/gantt-task-assignment-integration');

const { createTaskAssignmentService } = global;
const { createGanttAssignmentIntegration } = global;

describe('Cycle de vie TaskAssignments - Intégration réelle', () => {
    let mockGrist;
    let integration;
    let tasksTable;
    let teamTable;
    let taskAssignmentsTable;
    let timeEntriesTable;

    beforeEach(() => {
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
            id: [1, 2],
            nom: ['Alice', 'Bob'],
            capaciteHebdo: [35, 35]
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
            feuille: [],
            sheetStatus: []
        };

        mockGrist = {
            docApi: {
                fetchTable: jest.fn().mockImplementation(async function(table) {
                    if (table === 'Tasks') return tasksTable;
                    if (table === 'Team') return teamTable;
                    if (table === 'TaskAssignments') return taskAssignmentsTable;
                    if (table === 'TimeEntries') return timeEntriesTable;
                    return { id: [] };
                }),
                applyUserActions: jest.fn().mockImplementation(async function(actions) {
                    const retValues = [];
                    
                    for (const action of actions) {
                        const [type, tableName, recordId, data] = action;
                        
                        if (type === 'AddRecord') {
                            const newId = (tasksTable.id.length > 0 ? Math.max(...tasksTable.id) : 0) + 1;
                            
                            if (tableName === 'Tasks') {
                                tasksTable.id.push(newId);
                                tasksTable.titre.push(data.titre || '');
                                tasksTable.dateDebut.push(data.dateDebut || null);
                                tasksTable.dateEcheance.push(data.dateEcheance || null);
                                tasksTable.assignees.push(data.assignees || []);
                                tasksTable.charges.push(data.charges || null);
                                tasksTable.parentTask.push(data.parentTask || null);
                            } else if (tableName === 'TaskAssignments') {
                                const assignId = (taskAssignmentsTable.id.length > 0 ? Math.max(...taskAssignmentsTable.id) : 0) + 1;
                                taskAssignmentsTable.id.push(assignId);
                                taskAssignmentsTable.tache.push(data.tache);
                                taskAssignmentsTable.membre.push(data.membre);
                                taskAssignmentsTable.heuresAllouees.push(data.heuresAllouees || 0);
                                taskAssignmentsTable.dateDebut.push(data.dateDebut || null);
                                taskAssignmentsTable.dateFin.push(data.dateFin || null);
                                taskAssignmentsTable.modeRepartition.push(data.modeRepartition || 'uniforme');
                                taskAssignmentsTable.actif.push(data.actif !== undefined ? data.actif : true);
                                taskAssignmentsTable.commentaire.push(data.commentaire || '');
                                retValues.push(assignId);
                            } else if (tableName === 'TimeEntries') {
                                const timeId = (timeEntriesTable.id.length > 0 ? Math.max(...timeEntriesTable.id) : 0) + 1;
                                timeEntriesTable.id.push(timeId);
                                retValues.push(timeId);
                            } else {
                                retValues.push(newId);
                            }
                        } else if (type === 'UpdateRecord') {
                            if (tableName === 'Tasks') {
                                const idx = tasksTable.id.indexOf(recordId);
                                if (idx >= 0) {
                                    Object.keys(data).forEach(key => {
                                        if (tasksTable[key]) {
                                            tasksTable[key][idx] = data[key];
                                        }
                                    });
                                }
                            } else if (tableName === 'TaskAssignments') {
                                const idx = taskAssignmentsTable.id.indexOf(recordId);
                                if (idx >= 0) {
                                    Object.keys(data).forEach(key => {
                                        if (taskAssignmentsTable[key]) {
                                            taskAssignmentsTable[key][idx] = data[key];
                                        }
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
                                    timeEntriesTable.feuille.splice(idx, 1);
                                    timeEntriesTable.sheetStatus.splice(idx, 1);
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
    });

    describe('1. Création réelle', () => {
        test('Création avec assignees et charges normales', async () => {
            const editData = {
                assignees: [1],
                charges: [{ teamId: 1, heures: 50 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            };

            const result = await integration.onTaskCreated(6, editData);

            expect(result.ok).toBe(true);
            expect(result.expectedAssignments).toBe(1);
            expect(result.createdIds).toHaveLength(1);
            expect(result.verifiedIds).toHaveLength(1);

            // Vérifier les données dans TaskAssignments
            expect(taskAssignmentsTable.id).toHaveLength(1);
            expect(taskAssignmentsTable.tache[0]).toBe(6);
            expect(taskAssignmentsTable.membre[0]).toBe(1);
            expect(taskAssignmentsTable.heuresAllouees[0]).toBe(50);
            expect(taskAssignmentsTable.dateDebut[0]).toBe(1784505600);
            expect(taskAssignmentsTable.dateFin[0]).toBe(1785456000);
            expect(taskAssignmentsTable.actif[0]).toBe(true);
        });

        test('Création avec format RefList [\'L\', 1]', async () => {
            const editData = {
                assignees: ['L', 1],
                charges: [{ teamId: 1, heures: 50 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            };

            const result = await integration.onTaskCreated(6, editData);

            expect(result.ok).toBe(true);
            expect(result.expectedAssignments).toBe(1);

            // Vérifier que 'L' a été filtré
            expect(taskAssignmentsTable.membre[0]).toBe(1);
        });

        test('Création avec charges JSON string', async () => {
            const editData = {
                assignees: [1],
                charges: '[{"teamId":1,"heures":50}]',
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            };

            const result = await integration.onTaskCreated(6, editData);

            expect(result.ok).toBe(true);
            expect(result.expectedAssignments).toBe(1);
            expect(taskAssignmentsTable.heuresAllouees[0]).toBe(50);
        });

        test('Aucun faux succès si affectation attendue mais pas créée', async () => {
            // Simuler un échec d'écriture
            mockGrist.docApi.applyUserActions.mockResolvedValueOnce({ retValues: [] });

            const editData = {
                assignees: [1],
                charges: [{ teamId: 1, heures: 50 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            };

            const result = await integration.onTaskCreated(6, editData);

            expect(result.ok).toBe(false);
            expect(result.code).toBe('ASSIGNMENT_CREATION_POSTCONDITION_FAILED');
        });

        test('Création sans affectations (aucun assigné)', async () => {
            const editData = {
                assignees: [],
                charges: [],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            };

            const result = await integration.onTaskCreated(6, editData);

            expect(result.ok).toBe(true);
            expect(result.expectedAssignments).toBe(0);
            expect(taskAssignmentsTable.id).toHaveLength(0);
        });
    });

    describe('2. Modification des dates', () => {
        beforeEach(async () => {
            // Créer une tâche avec affectation
            await integration.onTaskCreated(6, {
                assignees: [1],
                charges: [{ teamId: 1, heures: 50 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });
        });

        test('Modification des dates via onTaskUpdated', async () => {
            const newStart = 1784678400;
            const newEnd = 1788480000;

            const result = await integration.onTaskUpdated(6, {
                dateDebut: newStart,
                dateEcheance: newEnd,
                datesEdited: true,
                assignmentsEdited: false
            });

            expect(result.ok).toBe(true);

            // Vérifier que les dates sont mises à jour
            expect(taskAssignmentsTable.dateDebut[0]).toBe(newStart);
            expect(taskAssignmentsTable.dateFin[0]).toBe(newEnd);
            expect(taskAssignmentsTable.heuresAllouees[0]).toBe(50); // Préservé
            expect(taskAssignmentsTable.membre[0]).toBe(1); // Préservé
            expect(taskAssignmentsTable.id).toHaveLength(1); // Pas de doublon
        });

        test('Modification des dates conserve le même ID', async () => {
            const originalId = taskAssignmentsTable.id[0];

            await integration.onTaskUpdated(6, {
                dateDebut: 1784678400,
                dateEcheance: 1788480000,
                datesEdited: true,
                assignmentsEdited: false
            });

            expect(taskAssignmentsTable.id[0]).toBe(originalId);
        });
    });

    describe('3. Réparation des tâches endommagées', () => {
        test('Réparation d\'une tâche sans affectations', async () => {
            // Créer une tâche dans Tasks sans TaskAssignments
            tasksTable.id.push(6);
            tasksTable.titre.push('Test');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push([1]);
            tasksTable.charges.push('[{"teamId":1,"heures":50}]');
            tasksTable.parentTask.push(null);

            // TaskAssignments est vide
            expect(taskAssignmentsTable.id).toHaveLength(0);

            const result = await integration.repairMissingAssignmentsForTask(6);

            expect(result.ok).toBe(true);
            expect(result.repaired).toBe(true);
            expect(result.code).toBe('ASSIGNMENTS_REPAIRED_FROM_LEGACY');
            expect(taskAssignmentsTable.id).toHaveLength(1);
            expect(taskAssignmentsTable.membre[0]).toBe(1);
            expect(taskAssignmentsTable.heuresAllouees[0]).toBe(50);
        });
    });

    describe('4. Suppression', () => {
        beforeEach(async () => {
            // Créer une tâche avec affectation
            const createResult = await integration.onTaskCreated(6, {
                assignees: [1],
                charges: [{ teamId: 1, heures: 50 }],
                dateDebut: 1784505600,
                dateEcheance: 1785456000
            });
            
            // Vérifier que la création a réussi
            if (!createResult.ok) {
                console.error('Échec création:', createResult);
            }
            expect(createResult.ok).toBe(true);
        });

        test('Suppression simple sans TimeEntries', async () => {
            // Vérifier l'état avant suppression
            expect(taskAssignmentsTable.id).toHaveLength(1);
            expect(tasksTable.id).toContain(6);
            
            const result = await integration.deleteTasksWithAssignments([6]);

            expect(result.ok).toBe(true);
            expect(result.deletedTasks).toBe(1);
            expect(result.deletedAssignments).toBe(1);

            // Vérifier que tout est supprimé
            expect(tasksTable.id).not.toContain(6);
            expect(taskAssignmentsTable.id).toHaveLength(0);
        });

        test('Suppression avec TimeEntries mutables', async () => {
            // Ajouter un TimeEntry mutable
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784505600);
            timeEntriesTable.heures.push(0);
            timeEntriesTable.feuille.push(null);
            timeEntriesTable.sheetStatus.push(null);

            const result = await integration.deleteTasksWithAssignments([6]);

            expect(result.ok).toBe(true);
            expect(result.deletedTimeEntries).toBe(1);

            // TimeEntry mutable doit être supprimé
            expect(timeEntriesTable.id).toHaveLength(0);
        });

        test('Suppression bloquée par TimeEntries verrouillés', async () => {
            // Ajouter un TimeEntry verrouillé (heures > 0)
            timeEntriesTable.id.push(1);
            timeEntriesTable.tache.push(6);
            timeEntriesTable.membre.push(1);
            timeEntriesTable.date.push(1784505600);
            timeEntriesTable.heures.push(5);
            timeEntriesTable.feuille.push(null);
            timeEntriesTable.sheetStatus.push(null);

            const result = await integration.deleteTasksWithAssignments([6]);

            expect(result.ok).toBe(false);
            expect(result.code).toBe('TASK_DELETE_BLOCKED_BY_TIME_ENTRIES');

            // Rien ne doit être supprimé
            expect(tasksTable.id).toContain(6);
            expect(taskAssignmentsTable.id).toHaveLength(1);
            expect(timeEntriesTable.id).toHaveLength(1);
        });

        test('Suppression avec detachChildren', async () => {
            // Créer un enfant
            tasksTable.id.push(7);
            tasksTable.titre.push('Enfant');
            tasksTable.dateDebut.push(1784505600);
            tasksTable.dateEcheance.push(1785456000);
            tasksTable.assignees.push([]);
            tasksTable.charges.push(null);
            tasksTable.parentTask.push(6);

            const result = await integration.deleteTasksWithAssignments([6], {
                detachChildren: true,
                includeDescendants: false
            });

            expect(result.ok).toBe(true);

            // L'enfant doit être détaché (parentTask = null)
            const childIndex = tasksTable.id.indexOf(7);
            expect(childIndex).toBeGreaterThan(-1);
            expect(tasksTable.parentTask[childIndex]).toBe(null);
        });
    });

    describe('5. Helpers de normalisation', () => {
        test('normalizeAssigneeIds filtre \'L\'', () => {
            const result = integration._helpers.normalizeAssigneeIds(['L', 1, 2]);
            expect(result).toEqual([1, 2]);
        });

        test('normalizeAssigneeIds gère tableau simple', () => {
            const result = integration._helpers.normalizeAssigneeIds([1, 2]);
            expect(result).toEqual([1, 2]);
        });

        test('normalizeCharges parse JSON string', () => {
            const result = integration._helpers.normalizeCharges('[{"teamId":1,"heures":50}]');
            expect(result).toEqual([{ teamId: 1, heures: 50 }]);
        });

        test('normalizeCharges gère tableau objet', () => {
            const result = integration._helpers.normalizeCharges([{ teamId: 1, heures: 50 }]);
            expect(result).toEqual([{ teamId: 1, heures: 50 }]);
        });
    });
});
