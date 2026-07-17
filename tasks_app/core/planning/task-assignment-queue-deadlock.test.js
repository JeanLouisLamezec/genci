/* ============================================================================
 * task-assignment-queue-deadlock.test.js — Test d'absence de deadlock
 * ----------------------------------------------------------------------------
 * Vérifie que :
 * 1. onTaskUpdated avec datesEdited=true ne provoque pas de deadlock
 * 2. Les opérations imbriquées dans la file s'exécutent correctement
 * 3. La post-condition de vérification des dates fonctionne
 * ============================================================================ */

require('../planning/task-assignment-service');
require('../planning/gantt-task-assignment-integration');

const { createTaskAssignmentService } = global;
const { createGanttAssignmentIntegration } = global;

describe('Queue Deadlock Tests', () => {
    let mockGrist;
    let integration;
    let taskAssignmentsTable;

    beforeEach(() => {
        taskAssignmentsTable = {
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
                    if (table === 'Tasks') {
                        return {
                            id: [6],
                            titre: ['Test'],
                            dateDebut: [1784419200],
                            dateEcheance: [1790726400]
                        };
                    }
                    if (table === 'Team') {
                        return { id: [1], nom: ['Alice'] };
                    }
                    if (table === 'TaskAssignments') {
                        return taskAssignmentsTable;
                    }
                    return { id: [] };
                }),
                applyUserActions: jest.fn().mockImplementation(async function(actions) {
                    const retValues = [];
                    for (const action of actions) {
                        const [type, tableName, recordId, data] = action;
                        
                        if (type === 'UpdateRecord' && tableName === 'TaskAssignments') {
                            const idx = taskAssignmentsTable.id.indexOf(recordId);
                            if (idx >= 0) {
                                Object.keys(data).forEach(key => {
                                    if (taskAssignmentsTable[key]) {
                                        taskAssignmentsTable[key][idx] = data[key];
                                    }
                                });
                            }
                        }
                    }
                    return { retValues };
                })
            }
        };

        integration = createGanttAssignmentIntegration(mockGrist);
    });

    test('onTaskUpdated avec datesEdited=true ne provoque pas de deadlock', async () => {
        const newStartDate = 1784678400; // 2026-07-22
        const newEndDate = 1788480000; // 2026-09-04

        const editData = {
            dateDebut: newStartDate,
            dateEcheance: newEndDate,
            datesEdited: true,
            assignmentsEdited: false
        };

        // Cet appel ne doit pas bloquer (pas de deadlock)
        const result = await Promise.race([
            integration.onTaskUpdated(6, editData),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('TIMEOUT: Deadlock détecté')), 5000)
            )
        ]);

        expect(result.ok).toBe(true);
        
        // Vérifier que les dates ont été mises à jour
        expect(taskAssignmentsTable.dateDebut[0]).toBe(newStartDate);
        expect(taskAssignmentsTable.dateFin[0]).toBe(newEndDate);
    });

    test('Deux appels consécutifs à onTaskUpdated ne bloquent pas', async () => {
        const newStartDate = 1784678400;
        const newEndDate = 1788480000;

        const editData1 = {
            dateDebut: newStartDate,
            dateEcheance: newEndDate,
            datesEdited: true,
            assignmentsEdited: false
        };

        const editData2 = {
            dateDebut: newStartDate + 86400, // +1 jour
            dateEcheance: newEndDate + 86400,
            datesEdited: true,
            assignmentsEdited: false
        };

        // Les deux appels doivent s'exécuter séquentiellement sans deadlock
        const [result1, result2] = await Promise.all([
            integration.onTaskUpdated(6, editData1),
            integration.onTaskUpdated(6, editData2)
        ]);

        expect(result1.ok).toBe(true);
        expect(result2.ok).toBe(true);

        // Le dernier devrait gagner
        expect(taskAssignmentsTable.dateDebut[0]).toBe(newStartDate + 86400);
        expect(taskAssignmentsTable.dateFin[0]).toBe(newEndDate + 86400);
    });

    test('syncTaskDates appelé directement vs via onTaskUpdated', async () => {
        const newStartDate = 1784678400;
        const newEndDate = 1788480000;

        // Appel direct
        const result1 = await integration.syncTaskDates(6, newStartDate, newEndDate);
        expect(result1.ok).toBe(true);

        const datesAfterDirect = {
            dateDebut: taskAssignmentsTable.dateDebut[0],
            dateFin: taskAssignmentsTable.dateFin[0]
        };

        // Reset
        taskAssignmentsTable.dateDebut[0] = 1784419200;
        taskAssignmentsTable.dateFin[0] = 1790726400;

        // Appel via onTaskUpdated
        const result2 = await integration.onTaskUpdated(6, {
            dateDebut: newStartDate,
            dateEcheance: newEndDate,
            datesEdited: true,
            assignmentsEdited: false
        });
        expect(result2.ok).toBe(true);

        const datesViaOnUpdated = {
            dateDebut: taskAssignmentsTable.dateDebut[0],
            dateFin: taskAssignmentsTable.dateFin[0]
        };

        // Les deux chemins doivent produire le même résultat
        expect(datesAfterDirect).toEqual(datesViaOnUpdated);
    });

    test('Post-condition échoue si les dates ne sont pas mises à jour', async () => {
        // Simuler un échec de mise à jour
        mockGrist.docApi.applyUserActions.mockImplementation(async function(actions) {
            // Ne pas appliquer les mises à jour
            return { retValues: [] };
        });

        const newStartDate = 1784678400;
        const newEndDate = 1788480000;

        const result = await integration.syncTaskDates(6, newStartDate, newEndDate);

        // Doit échouer car la post-condition ne sera pas satisfaite
        expect(result.ok).toBe(false);
        expect(result.code).toBe('ASSIGNMENT_DATE_POSTCONDITION_FAILED');
        expect(result.mismatches).toBeDefined();
        expect(result.mismatches.length).toBeGreaterThan(0);
    });
});
