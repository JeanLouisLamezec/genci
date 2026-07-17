/* ============================================================================
 * task-assignment-dates-integration.test.js — Test du scénario réel de dates
 * ----------------------------------------------------------------------------
 * Scénario :
 * 1. Créer une tâche avec une affectation (2026-07-19 → 2026-10-04)
 * 2. Modifier les dates (2026-07-22 → 2026-09-04)
 * 3. Vérifier que TaskAssignments est mis à jour avec le même ID
 * 4. Vérifier qu'il n'y a pas de doublon
 * 5. Vérifier que la deuxième sauvegarde identique ne fait rien
 * ============================================================================ */

require('../planning/task-assignment-service');
require('../planning/gantt-task-assignment-integration');

const { createTaskAssignmentService } = global;
const { createGanttAssignmentIntegration } = global;

describe('Scénario réel - Modification de dates TaskAssignments', () => {
    let mockGrist;
    let assignmentService;
    let integration;
    let tasksTable;
    let teamTable;

    beforeEach(() => {
        tasksTable = {
            id: [1, 2, 3, 4, 5, 6],
            titre: ['Tâche 1', 'Tâche 2', 'Tâche 3', 'Tâche 4', 'Tâche 5', 'Tâche 6'],
            dateDebut: [null, null, null, null, null, 1784419200], // 2026-07-19
            dateEcheance: [null, null, null, null, null, 1790726400], // 2026-10-04
            assignees: [[], [], [], [], [], [1]],
            charges: ['', '', '', '', '', '[{"teamId":1,"heures":40}]']
        };

        teamTable = {
            id: [1, 2],
            nom: ['Alice', 'Bob'],
            capaciteHebdo: [35, 35]
        };

        let taskAssignmentsTable = {
            id: [1],
            tache: [6],
            membre: [1],
            heuresAllouees: [40],
            dateDebut: [1784419200], // 2026-07-19
            dateFin: [1790726400], // 2026-10-04
            modeRepartition: ['uniforme'],
            actif: [true],
            commentaire: ['']
        };

        mockGrist = {
            docApi: {
                fetchTable: jest.fn().mockImplementation(async function(table) {
                    if (table === 'Tasks') return tasksTable;
                    if (table === 'Team') return teamTable;
                    if (table === 'TaskAssignments') return taskAssignmentsTable;
                    return { id: [] };
                }),
                applyUserActions: jest.fn().mockImplementation(async function(actions) {
                    const retValues = [];
                    for (const action of actions) {
                        const [type, tableName, recordId, data] = action;
                        
                        if (type === 'UpdateRecord' && tableName === 'TaskAssignments') {
                            // Mettre à jour taskAssignmentsTable
                            const idx = taskAssignmentsTable.id.indexOf(recordId);
                            if (idx >= 0) {
                                Object.keys(data).forEach(key => {
                                    if (taskAssignmentsTable[key]) {
                                        taskAssignmentsTable[key][idx] = data[key];
                                    }
                                });
                            }
                        } else if (type === 'UpdateRecord' && tableName === 'Tasks') {
                            // Mettre à jour tasksTable
                            const idx = tasksTable.id.indexOf(recordId);
                            if (idx >= 0) {
                                Object.keys(data).forEach(key => {
                                    if (tasksTable[key]) {
                                        tasksTable[key][idx] = data[key];
                                    }
                                });
                            }
                        }
                    }
                    return { retValues };
                })
            }
        };

        assignmentService = createTaskAssignmentService(mockGrist);
        integration = createGanttAssignmentIntegration(mockGrist);
    });

    test('Scénario A: Création initiale (2026-07-19 → 2026-10-04)', async () => {
        // État initial déjà configuré dans beforeEach
        const assignments = await assignmentService.loadAssignmentsForTask(6);
        
        expect(assignments).toHaveLength(1);
        expect(assignments[0].membre).toBe(1);
        expect(assignments[0].heuresAllouees).toBe(40);
        expect(assignments[0].dateDebut).toBe(1784419200); // 2026-07-19
        expect(assignments[0].dateFin).toBe(1790726400); // 2026-10-04
    });

    test('Scénario B: Modification des dates (2026-07-22 → 2026-09-04)', async () => {
        const newStartDate = 1784678400; // 2026-07-22
        const newEndDate = 1788480000; // 2026-09-04

        // Appeler syncTaskDates
        const result = await integration.syncTaskDates(6, newStartDate, newEndDate);

        expect(result.ok).toBe(true);
        expect(result.updatedIds).toContain(1);
        expect(result.actionsExecuted).toBeGreaterThan(0);

        // Vérifier que TaskAssignments a été mis à jour
        const assignments = await assignmentService.loadAssignmentsForTask(6);
        
        expect(assignments).toHaveLength(1); // Pas de doublon
        expect(assignments[0].id).toBe(1); // Même ID
        expect(assignments[0].dateDebut).toBe(newStartDate);
        expect(assignments[0].dateFin).toBe(newEndDate);
        expect(assignments[0].heuresAllouees).toBe(40); // Préservé
        expect(assignments[0].membre).toBe(1); // Préservé
    });

    test('Scénario B2: Modification des dates via onTaskUpdated (chemin du panneau)', async () => {
        const newStartDate = 1784678400; // 2026-07-22
        const newEndDate = 1788480000; // 2026-09-04

        // Simuler l'appel depuis saveTaskToGrist avec datesEdited=true
        const editData = {
            dateDebut: newStartDate,
            dateEcheance: newEndDate,
            datesEdited: true,
            assignmentsEdited: false
        };

        const result = await integration.onTaskUpdated(6, editData);

        expect(result.ok).toBe(true);
        expect(result.updatedIds).toBeDefined();

        // Vérifier que TaskAssignments a été mis à jour
        const assignments = await assignmentService.loadAssignmentsForTask(6);
        
        expect(assignments).toHaveLength(1); // Pas de doublon
        expect(assignments[0].id).toBe(1); // Même ID
        expect(assignments[0].dateDebut).toBe(newStartDate);
        expect(assignments[0].dateFin).toBe(newEndDate);
        expect(assignments[0].heuresAllouees).toBe(40); // Préservé
        expect(assignments[0].membre).toBe(1); // Préservé
    });

    test('Scénario C: Deuxième sauvegarde identique = aucune écriture', async () => {
        const newStartDate = 1784678400; // 2026-07-22
        const newEndDate = 1788480000; // 2026-09-04

        // Première modification
        await integration.syncTaskDates(6, newStartDate, newEndDate);
        
        // Reset du compteur d'actions
        mockGrist.docApi.applyUserActions.mockClear();

        // Deuxième modification identique
        const result = await integration.syncTaskDates(6, newStartDate, newEndDate);

        expect(result.ok).toBe(true);
        expect(result.actionsExecuted).toBe(0); // Aucune écriture

        // Vérifier que applyUserActions n'a pas été appelé
        expect(mockGrist.docApi.applyUserActions).not.toHaveBeenCalled();
    });

    test('Scénario D: syncTaskDates préserve toutes les propriétés', async () => {
        // Configurer une affectation avec plus de propriétés
        const existingAssignment = {
            id: [1],
            tache: [6],
            membre: [1],
            heuresAllouees: [40],
            dateDebut: [1784419200],
            dateFin: [1790726400],
            modeRepartition: ['uniforme'],
            actif: [true],
            commentaire: ['Commentaire de test']
        };

        mockGrist.docApi.fetchTable.mockImplementation(async function(table) {
            if (table === 'Tasks') return tasksTable;
            if (table === 'Team') return teamTable;
            if (table === 'TaskAssignments') return existingAssignment;
            return { id: [] };
        });

        const newStartDate = 1784678400;
        const newEndDate = 1788480000;

        await integration.syncTaskDates(6, newStartDate, newEndDate);

        // Vérifier que le commentaire est préservé
        expect(existingAssignment.commentaire[0]).toBe('Commentaire de test');
        expect(existingAssignment.modeRepartition[0]).toBe('uniforme');
        expect(existingAssignment.heuresAllouees[0]).toBe(40);
    });
});

describe('Validation de doublon correcte', () => {
    let mockGrist;
    let assignmentService;

    beforeEach(() => {
        mockGrist = {
            docApi: {
                fetchTable: jest.fn().mockResolvedValue({
                    id: [1, 2, 3],
                    nom: ['Alice', 'Bob', 'Charlie']
                }),
                applyUserActions: jest.fn().mockResolvedValue({ retValues: [] })
            }
        };

        assignmentService = createTaskAssignmentService(mockGrist);
    });

    test('Une ligne existante n\'est PAS un doublon bloquant', async () => {
        const context = {
            existingAssignments: [
                { id: 1, membre: 1, heuresAllouees: 35, dateDebut: 1000, dateFin: 2000, actif: true }
            ],
            taskId: 1
        };

        const assignment = {
            id: 1, // Même ID que l'existant
            memberId: 1,
            allocatedHours: 40,
            startDate: 1000,
            endDate: 2000
        };

        const validation = assignmentService._helpers.validateAssignment(assignment, context);
        
        // Ne doit PAS être un échec de validation
        expect(validation.valid).toBe(true);
        expect(validation.errors).toHaveLength(0);
    });

    test('Deux lignes actives pour le même membre = conflit', async () => {
        const context = {
            existingAssignments: [
                { id: 1, membre: 1, heuresAllouees: 35, dateDebut: 1000, dateFin: 2000, actif: true },
                { id: 2, membre: 1, heuresAllouees: 20, dateDebut: 1000, dateFin: 2000, actif: true }
            ],
            taskId: 1
        };

        const assignment = {
            memberId: 1,
            allocatedHours: 40,
            startDate: 1000,
            endDate: 2000
        };

        const validation = assignmentService._helpers.validateAssignment(assignment, context);
        
        // Doit être un échec de validation
        expect(validation.valid).toBe(false);
        expect(validation.errors).toContainEqual(
            expect.stringContaining('Plusieurs affectations actives pour le membre 1')
        );
    });
});

describe('Champ absent vs suppression explicite', () => {
    let mockGrist;
    let integration;

    beforeEach(() => {
        mockGrist = {
            docApi: {
                fetchTable: jest.fn().mockResolvedValue({ id: [] }),
                applyUserActions: jest.fn().mockResolvedValue({ retValues: [] })
            }
        };

        integration = createGanttAssignmentIntegration(mockGrist);
    });

    test('buildDesiredAssignments sans assignmentsEdited retourne []', () => {
        const task = { id: 1, dateDebut: 1000, dateEcheance: 2000 };
        const editData = {
            assignees: [1],
            charges: [{ teamId: 1, heures: 35 }]
            // assignmentsEdited: false ou absent
        };

        const assignments = integration.buildDesiredAssignments(task, editData);
        
        expect(assignments).toEqual([]);
    });

    test('buildDesiredAssignments avec assignmentsEdited=true crée les affectations', () => {
        const task = { id: 1, dateDebut: 1000, dateEcheance: 2000 };
        const editData = {
            assignees: [1, 2],
            charges: [
                { teamId: 1, heures: 35 },
                { teamId: 2, heures: 20 }
            ],
            assignmentsEdited: true
        };

        const assignments = integration.buildDesiredAssignments(task, editData);
        
        expect(assignments).toHaveLength(2);
        expect(assignments[0].memberId).toBe(1);
        expect(assignments[0].allocatedHours).toBe(35);
        expect(assignments[1].memberId).toBe(2);
        expect(assignments[1].allocatedHours).toBe(20);
    });
});
