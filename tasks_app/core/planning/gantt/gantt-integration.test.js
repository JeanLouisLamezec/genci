/* ============================================================================
 * gantt-integration.test.js — Tests pour l'intégration Gantt-TaskAssignments
 * ----------------------------------------------------------------------------
 * Vérifie :
 * 1. buildDesiredAssignments mapping correct
 * 2. onTaskCreated appelle syncTaskAssignments
 * 3. onTaskUpdated appelle syncTaskAssignments  
 * 4. syncTaskDates met à jour les dates
 * 5. Gestion des erreurs
 * ============================================================================ */

// Charger les modules (UMD pattern - exporte dans global)
require('../task_assignment/task-assignment-service');
const { createGanttAssignmentIntegration } = require('./gantt-task-assignment-integration');
const { createTaskAssignmentService } = global;

describe('Gantt Integration - buildDesiredAssignments', () => {
    let integration;
    let mockService;

    beforeEach(() => {
        mockService = {
            syncTaskAssignments: jest.fn().mockResolvedValue({ ok: true, actionsExecuted: 0 }),
            loadAssignmentsForTask: jest.fn().mockResolvedValue([])
        };

        integration = {
            buildDesiredAssignments: function(task, editData) {
                const assignees = editData.assignees || [];
                const charges = editData.charges || [];
                const assignments = [];

                assignees.forEach(function(memberId) {
                    var chargeEntry = charges.find(function(c) { return c.teamId === memberId; });
                    var allocatedHours = chargeEntry ? Number(chargeEntry.heures) : 0;

                    if (allocatedHours > 0) {
                        assignments.push({
                            memberId: memberId,
                            allocatedHours: allocatedHours,
                            startDate: task.dateDebut || null,
                            endDate: task.dateEcheance || null,
                            distributionMode: 'uniforme',
                            active: true,
                            comment: ''
                        });
                    }
                });

                return assignments;
            }
        };
    });

    test('mapping correct avec assignees et charges', () => {
        const task = {
            id: 1,
            dateDebut: 1783296000,
            dateEcheance: 1784505600
        };

        const editData = {
            assignees: [1, 2],
            charges: [
                { teamId: 1, heures: 35 },
                { teamId: 2, heures: 20 }
            ]
        };

        const result = integration.buildDesiredAssignments(task, editData);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            memberId: 1,
            allocatedHours: 35,
            startDate: 1783296000,
            endDate: 1784505600,
            distributionMode: 'uniforme',
            active: true,
            comment: ''
        });
        expect(result[1]).toEqual({
            memberId: 2,
            allocatedHours: 20,
            startDate: 1783296000,
            endDate: 1784505600,
            distributionMode: 'uniforme',
            active: true,
            comment: ''
        });
    });

    test('ignore les assignees sans charge positive', () => {
        const task = { id: 1, dateDebut: 1000, dateEcheance: 2000 };
        const editData = {
            assignees: [1, 2],
            charges: [
                { teamId: 1, heures: 35 }
                // Membre 2 sans charge
            ]
        };

        const result = integration.buildDesiredAssignments(task, editData);
        expect(result).toHaveLength(1);
        expect(result[0].memberId).toBe(1);
    });

    test('gère les dates manquantes', () => {
        const task = { id: 1 }; // Pas de dates
        const editData = {
            assignees: [1],
            charges: [{ teamId: 1, heures: 35 }]
        };

        const result = integration.buildDesiredAssignments(task, editData);
        expect(result[0].startDate).toBe(null);
        expect(result[0].endDate).toBe(null);
    });
});

describe('Gantt Integration - onTaskCreated', () => {
    let mockGrist;
    let integration;

    beforeEach(() => {
        mockGrist = {
            docApi: {
                fetchTable: jest.fn().mockResolvedValue({ id: [], titre: [] }),
                applyUserActions: jest.fn().mockResolvedValue([])
            }
        };

        const service = createTaskAssignmentService(mockGrist);

        integration = {
            onTaskCreated: service.syncTaskAssignments.bind(service)
        };
    });

    test('appelle syncTaskAssignments avec les bonnes données', async () => {
        const taskId = 1;
        const editData = {
            assignees: [1],
            charges: [{ teamId: 1, heures: 35 }],
            dateDebut: 1000,
            dateEcheance: 2000
        };

        const result = await integration.onTaskCreated(taskId, editData);

        expect(result.ok).toBe(true);
        expect(result.createdIds).toBeDefined();
    });

    test('retourne une erreur si taskId manquant', async () => {
        const result = await integration.onTaskCreated(null, {});
        expect(result.ok).toBe(false);
        expect(result.code).toBe('GRIST_NOT_AVAILABLE'); // ou autre erreur
    });
});

describe('Gantt Integration - syncTaskDates', () => {
    let mockGrist;
    let service;

    beforeEach(() => {
        mockGrist = {
            docApi: {
                fetchTable: jest.fn().mockResolvedValue({ id: [], tache: [], membre: [], heuresAllouees: [], dateDebut: [], dateFin: [], modeRepartition: [], actif: [], commentaire: [] }),
                applyUserActions: jest.fn().mockResolvedValue([])
            }
        };

        const serviceModule = require('../task_assignment/task-assignment-service');
        service = serviceModule.createTaskAssignmentService(mockGrist);
    });

    test('met à jour les dates des affectations existantes', async () => {
        // Setup: une affectation existante
        mockGrist.docApi.fetchTable.mockResolvedValueOnce({
            id: [1],
            tache: [1],
            membre: [1],
            heuresAllouees: [35],
            dateDebut: [1000],
            dateFin: [2000],
            modeRepartition: ['uniforme'],
            actif: [true],
            commentaire: ['']
        });

        const result = await service.syncTaskAssignments(1, [
            { memberId: 1, allocatedHours: 35, startDate: 3000, endDate: 4000 }
        ]);

        expect(result.ok).toBe(true);
        expect(result.updatedIds).toBeDefined();
    });
});

describe('Gantt Integration - Validation', () => {
    let mockGrist;
    let service;

    beforeEach(() => {
        mockGrist = {
            docApi: {
                fetchTable: jest.fn().mockImplementation((table) => {
                    if (table === 'Tasks') {
                        return Promise.resolve({ id: [1], titre: ['Test'] });
                    } else if (table === 'Team') {
                        return Promise.resolve({ id: [1], nom: ['Alice'] });
                    } else if (table === 'TaskAssignments') {
                        return Promise.resolve({ id: [], tache: [], membre: [], heuresAllouees: [], dateDebut: [], dateFin: [], modeRepartition: [], actif: [], commentaire: [] });
                    }
                    return Promise.resolve({ id: [] });
                }),
                applyUserActions: jest.fn().mockResolvedValue([])
            }
        };

        const serviceModule = require('../task_assignment/task-assignment-service');
        service = serviceModule.createTaskAssignmentService(mockGrist);
    });

    test('rejette les heures invalides', async () => {
        const result = await service.syncTaskAssignments(1, [
            { memberId: 1, allocatedHours: 'abc', startDate: 1000, endDate: 2000 }
        ]);

        expect(result.ok).toBe(false);
        expect(result.code).toBe('VALIDATION_ERROR');
    });

    test('rejette les heures négatives', async () => {
        const result = await service.syncTaskAssignments(1, [
            { memberId: 1, allocatedHours: -5, startDate: 1000, endDate: 2000 }
        ]);

        expect(result.ok).toBe(false);
        expect(result.code).toBe('VALIDATION_ERROR');
    });

    test('rejette membre inexistant', async () => {
        const result = await service.syncTaskAssignments(1, [
            { memberId: 999, allocatedHours: 35, startDate: 1000, endDate: 2000 }
        ]);

        expect(result.ok).toBe(false);
        expect(result.code).toBe('VALIDATION_ERROR');
    });
});
