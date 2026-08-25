/* ============================================================================
 * gantt-assignment-modes-integration.test.js — Tests stateful des modes de répartition
 * ----------------------------------------------------------------------------
 * Vérifie la persistance des modes uniforme/ponctuel par membre dans TaskAssignments
 * ============================================================================ */

require('../task_assignment/task-assignment-service');
const { createGanttAssignmentIntegration } = require('./gantt-task-assignment-integration');

function columnarToRows(tableData) {
    const rows = [];
    const columns = Object.keys(tableData);
    const rowCount = tableData[columns[0]] ? tableData[columns[0]].length : 0;
    
    for (let i = 0; i < rowCount; i++) {
        const row = { id: tableData.id ? tableData.id[i] : null };
        for (const col of columns) {
            if (col !== 'id') {
                row[col] = tableData[col] ? tableData[col][i] : null;
            }
        }
        rows.push(row);
    }
    return rows;
}

function createStatefulGrist(initialState) {
    const state = JSON.parse(JSON.stringify(initialState));
    const appliedBatches = [];
    const appliedActions = [];
    const nextIds = {
        TaskAssignments: 100,
        Tasks: 1000,
        TimeEntries: 2000,
        Feuilles: 3000,
        Team: 4000
    };

    function rowsToColumnar(rows, columns) {
        const result = {};
        columns.forEach(col => result[col] = []);
        
        rows.forEach(row => {
            columns.forEach(col => {
                result[col].push(row[col] !== undefined ? row[col] : null);
            });
        });
        
        return result;
    }

    const mockGrist = {
        docApi: {
            fetchTable: async (tableName) => {
                if (!state[tableName]) {
                    state[tableName] = rowsToColumnar([], ['id']);
                }
                return state[tableName];
            },

            applyUserActions: async (actions) => {
                appliedBatches.push(JSON.parse(JSON.stringify(actions)));
                
                const retValues = [];
                
                for (const action of actions) {
                    const [op, tableName, recordId, data] = action;
                    appliedActions.push(JSON.parse(JSON.stringify(action)));
                    
                    if (!state[tableName]) {
                        state[tableName] = { id: [] };
                    }
                    
                    if (op === 'AddRecord') {
                        const newId = nextIds[tableName]++;
                        const newRow = { id: newId, ...data };
                        
                        // Ajouter d'abord l'ID pour avoir la bonne longueur de référence
                        state[tableName].id.push(newId);
                        const targetLength = state[tableName].id.length;
                        
                        // Ajouter les autres colonnes
                        for (const col of Object.keys(newRow)) {
                            if (col === 'id') continue;
                            if (!state[tableName][col]) {
                                state[tableName][col] = [];
                            }
                            // Aligner la longueur de la colonne
                            while (state[tableName][col].length < targetLength - 1) {
                                state[tableName][col].push(null);
                            }
                            state[tableName][col].push(newRow[col]);
                        }
                        
                        retValues.push(newId);
                    } else if (op === 'UpdateRecord') {
                        const rows = columnarToRows(state[tableName]);
                        const rowIndex = rows.findIndex(r => r.id === recordId);
                        
                        if (rowIndex >= 0) {
                            for (const key of Object.keys(data)) {
                                state[tableName][key][rowIndex] = data[key];
                            }
                        }
                        retValues.push(null);
                    } else if (op === 'RemoveRecord') {
                        const rows = columnarToRows(state[tableName]);
                        const rowIndex = rows.findIndex(r => r.id === recordId);
                        
                        if (rowIndex >= 0) {
                            for (const col of Object.keys(state[tableName])) {
                                state[tableName][col].splice(rowIndex, 1);
                            }
                        }
                        retValues.push(null);
                    } else {
                        retValues.push(null);
                    }
                }
                
                return { retValues };
            }
        },
        
        getState: () => JSON.parse(JSON.stringify(state)),
        setState: (newState) => {
            for (const key of Object.keys(newState)) {
                const value = newState[key];
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    // Pour les tables colonnaires, copier chaque colonne
                    if (!state[key]) {
                        state[key] = {};
                    }
                    for (const col of Object.keys(value)) {
                        state[key][col] = JSON.parse(JSON.stringify(value[col]));
                    }
                } else {
                    state[key] = JSON.parse(JSON.stringify(value));
                }
            }
        },
        getAppliedBatches: () => JSON.parse(JSON.stringify(appliedBatches)),
        getAppliedActions: () => JSON.parse(JSON.stringify(appliedActions)),
        reset: () => {
            appliedBatches.length = 0;
            appliedActions.length = 0;
        }
    };
    
    return mockGrist;
}

const initialState = {
    Tasks: {
        id: [1],
        assignees: [['L', 1, 2]],
        charges: [JSON.stringify([
            { teamId: 1, heures: 8 },
            { teamId: 2, heures: 20 }
        ])],
        dateDebut: [1000],
        dateEcheance: [2000]
    },
    TaskAssignments: {
        id: [],
        tache: [],
        membre: [],
        heuresAllouees: [],
        dateDebut: [],
        dateFin: [],
        modeRepartition: [],
        actif: [],
        commentaire: []
    },
    Team: {
        id: [1, 2],
        nom: ['Jason', 'Cédric']
    },
    Feuilles: {
        id: [],
        statut: []
    },
    TimeEntries: {
        id: [],
        heures: [],
        feuille: [],
        affectation: [],
        tache: [],
        membre: [],
        description: [],
        imputation: []
    }
};

describe('Gantt Assignment Modes - Integration stateful', () => {
    let mockGrist;
    let integration;

    beforeEach(() => {
        // Réinitialiser l'état initial pour chaque test
        const freshInitialState = JSON.parse(JSON.stringify(initialState));
        mockGrist = createStatefulGrist(freshInitialState);
        integration = createGanttAssignmentIntegration(mockGrist, {
            logEnabled: false,
            enableAutoPlanning: false
        });
    });

    test('B2.1 - Mapping distinct Jason / Cédric (test pure)', () => {
        const task = {
            id: 1,
            dateDebut: 1783296000,
            dateEcheance: 1784505600
        };

        const editData = {
            assignees: [1, 2],
            charges: [
                { teamId: 1, heures: 8 },
                { teamId: 2, heures: 20 }
            ],
            assignmentModes: {
                1: 'ponctuel',
                2: 'uniforme'
            }
        };

        const result = integration.buildDesiredAssignments(task, editData);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(2);
        expect(result.find(a => a.memberId === 1).distributionMode).toBe('ponctuel');
        expect(result.find(a => a.memberId === 2).distributionMode).toBe('uniforme');
    });

    test('B2.2 - Conservation du mode existant (test pure)', () => {
        const task = {
            id: 1,
            dateDebut: 1783296000,
            dateEcheance: 1784505600
        };

        const editData = {
            assignees: [1],
            charges: [{ teamId: 1, heures: 8 }],
            assignmentModes: {}
        };

        const context = {
            existingAssignments: [
                { id: 100, membre: 1, actif: true, modeRepartition: 'ponctuel' }
            ]
        };

        const result = integration.buildDesiredAssignments(task, editData, {}, context);

        expect(result.length).toBe(1);
        expect(result[0].distributionMode).toBe('ponctuel');
    });

    test('B2.2b - Mode existant null → fallback uniforme', () => {
        const task = {
            id: 1,
            dateDebut: 1783296000,
            dateEcheance: 1784505600
        };

        const editData = {
            assignees: [1],
            charges: [{ teamId: 1, heures: 8 }],
            assignmentModes: {}
        };

        const context = {
            existingAssignments: [
                { id: 100, membre: 1, actif: true, modeRepartition: null }
            ]
        };

        const result = integration.buildDesiredAssignments(task, editData, {}, context);

        expect(result.length).toBe(1);
        expect(result[0].distributionMode).toBe('uniforme');
    });

    test('B2.3 - Mode existant invalide rejeté', () => {
        const task = {
            id: 1,
            dateDebut: 1000,
            dateEcheance: 2000
        };

        const editData = {
            assignees: [1],
            charges: [{ teamId: 1, heures: 8 }],
            assignmentModes: {}
        };

        const context = {
            existingAssignments: [
                { id: 100, membre: 1, actif: true, modeRepartition: 'ponctuelle' }
            ]
        };

        const result = integration.buildDesiredAssignments(task, editData, {}, context);

        expect(result.ok).toBe(false);
        expect(result.code).toBe('INVALID_DISTRIBUTION_MODE');
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].memberId).toBe(1);
        expect(result.errors[0].value).toBe('ponctuelle');
    });

    test('B2.4 - Création réelle de deux affectations avec persistance', async () => {
        mockGrist.reset();
        const result = await integration.onTaskCreated(1, {
            assignees: [1, 2],
            charges: [
                { teamId: 1, heures: 8 },
                { teamId: 2, heures: 20 }
            ],
            assignmentModes: {
                1: 'ponctuel',
                2: 'uniforme'
            },
            dateDebut: 1000,
            dateEcheance: 2000
        });

        expect(result.ok).toBe(true);
        expect(result.actionsExecuted).toBeGreaterThan(0);

        const assignmentsTable = await mockGrist.docApi.fetchTable('TaskAssignments');
        const assignments = columnarToRows(assignmentsTable);
        const activeAssignments = assignments.filter(a => a.actif !== false);

        expect(activeAssignments.length).toBe(2);

        const member1 = activeAssignments.find(a => a.membre === 1);
        const member2 = activeAssignments.find(a => a.membre === 2);

        expect(member1).toBeDefined();
        expect(member1.tache).toBe(1);
        expect(member1.membre).toBe(1);
        expect(member1.heuresAllouees).toBe(8);
        expect(member1.dateDebut).toBe(1000);
        expect(member1.dateFin).toBe(2000);
        expect(member1.modeRepartition).toBe('ponctuel');
        expect(member1.actif).toBe(true);

        expect(member2).toBeDefined();
        expect(member2.tache).toBe(1);
        expect(member2.membre).toBe(2);
        expect(member2.heuresAllouees).toBe(20);
        expect(member2.dateDebut).toBe(1000);
        expect(member2.dateFin).toBe(2000);
        expect(member2.modeRepartition).toBe('uniforme');
        expect(member2.actif).toBe(true);

        const duplicateCheck = {};
        activeAssignments.forEach(a => {
            const key = `${a.tache}-${a.membre}`;
            expect(duplicateCheck[key]).toBeUndefined();
            duplicateCheck[key] = true;
        });
    });

    test('B2.5 - Valeur invalide, zéro écriture', async () => {
        const result = await integration.onTaskCreated(1, {
            assignees: [1],
            charges: [{ teamId: 1, heures: 8 }],
            assignmentModes: {
                1: 'ponctuelle'
            },
            dateDebut: 1000,
            dateEcheance: 2000
        });

        expect(result.ok).toBe(false);
        expect(result.code).toBe('INVALID_DISTRIBUTION_MODE');

        const assignmentsTable = await mockGrist.docApi.fetchTable('TaskAssignments');
        const assignments = columnarToRows(assignmentsTable);
        const activeAssignments = assignments.filter(a => a.actif !== false);

        expect(activeAssignments.length).toBe(0);
        expect(mockGrist.getAppliedBatches().length).toBe(0);
        expect(mockGrist.getAppliedActions().length).toBe(0);
    });

    test('B2.6 - Modification du mode seul conserve l ID existant', async () => {
        mockGrist.reset();
        mockGrist.setState({
            TaskAssignments: {
                id: [100],
                tache: [1],
                membre: [1],
                heuresAllouees: [8],
                dateDebut: [1000],
                dateFin: [2000],
                modeRepartition: ['uniforme'],
                actif: [true],
                commentaire: ['']
            }
        });

        const result = await integration.onTaskUpdated(1, {
            assignees: [1],
            charges: [{ teamId: 1, heures: 8 }],
            assignmentModes: {
                1: 'ponctuel'
            },
            dateDebut: 1000,
            dateEcheance: 2000,
            assignmentsEdited: true,
            datesEdited: false
        });

        expect(result.ok).toBe(true);

        const assignmentsTable = await mockGrist.docApi.fetchTable('TaskAssignments');
        const assignments = columnarToRows(assignmentsTable);
        const activeAssignments = assignments.filter(a => a.actif !== false);

        expect(activeAssignments.length).toBe(1);
        expect(activeAssignments[0].id).toBe(100);
        expect(activeAssignments[0].modeRepartition).toBe('ponctuel');
        expect(activeAssignments[0].heuresAllouees).toBe(8);
        expect(activeAssignments[0].dateDebut).toBe(1000);
        expect(activeAssignments[0].dateFin).toBe(2000);
        expect(activeAssignments[0].actif).toBe(true);

        const appliedActions = mockGrist.getAppliedActions();
        const updateActions = appliedActions.filter(a => a[0] === 'UpdateRecord' && a[1] === 'TaskAssignments');
        const addActions = appliedActions.filter(a => a[0] === 'AddRecord' && a[1] === 'TaskAssignments');
        const removeActions = appliedActions.filter(a => a[0] === 'RemoveRecord' && a[1] === 'TaskAssignments');

        expect(updateActions.length).toBeGreaterThanOrEqual(1);
        expect(addActions.length).toBe(0);
        expect(removeActions.length).toBe(0);
    });

    test('B2.7 - Deux membres, un seul mode change', async () => {
        mockGrist.reset();
        let state = mockGrist.getState();
        state.TaskAssignments = {
            id: [100, 101],
            tache: [1, 1],
            membre: [1, 2],
            heuresAllouees: [8, 20],
            dateDebut: [1000, 1000],
            dateFin: [2000, 2000],
            modeRepartition: ['uniforme', 'uniforme'],
            actif: [true, true],
            commentaire: ['', '']
        };
        mockGrist.setState(state);

        const result = await integration.onTaskUpdated(1, {
            assignees: [1, 2],
            charges: [
                { teamId: 1, heures: 8 },
                { teamId: 2, heures: 20 }
            ],
            assignmentModes: {
                1: 'ponctuel',
                2: 'uniforme'
            },
            dateDebut: 1000,
            dateEcheance: 2000,
            assignmentsEdited: true,
            datesEdited: false
        });

        expect(result.ok).toBe(true);

        const assignmentsTable = await mockGrist.docApi.fetchTable('TaskAssignments');
        const assignments = columnarToRows(assignmentsTable);
        const activeAssignments = assignments.filter(a => a.actif !== false);

        expect(activeAssignments.length).toBe(2);
        expect(activeAssignments.map(a => a.id).sort()).toEqual([100, 101]);

        const member1 = activeAssignments.find(a => a.membre === 1);
        const member2 = activeAssignments.find(a => a.membre === 2);

        expect(member1.modeRepartition).toBe('ponctuel');
        expect(member2.modeRepartition).toBe('uniforme');

        const appliedActions = mockGrist.getAppliedActions();
        const addActions = appliedActions.filter(a => a[0] === 'AddRecord' && a[1] === 'TaskAssignments');
        const removeActions = appliedActions.filter(a => a[0] === 'RemoveRecord' && a[1] === 'TaskAssignments');

        expect(addActions.length).toBe(0);
        expect(removeActions.length).toBe(0);
    });

    test('B2.8 - Idempotence réelle', async () => {
        mockGrist.reset();
        let state = mockGrist.getState();
        state.TaskAssignments = {
            id: [100, 101],
            tache: [1, 1],
            membre: [1, 2],
            heuresAllouees: [8, 20],
            dateDebut: [1000, 1000],
            dateFin: [2000, 2000],
            modeRepartition: ['ponctuel', 'uniforme'],
            actif: [true, true],
            commentaire: ['', '']
        };

        const editData = {
            assignees: [1, 2],
            charges: [
                { teamId: 1, heures: 8 },
                { teamId: 2, heures: 20 }
            ],
            assignmentModes: {
                1: 'ponctuel',
                2: 'uniforme'
            },
            dateDebut: 1000,
            dateEcheance: 2000,
            assignmentsEdited: true,
            datesEdited: false
        };

        const first = await integration.onTaskUpdated(1, editData);
        expect(first.ok).toBe(true);

        const batchCountAfterFirst = mockGrist.getAppliedBatches().length;
        const actionCountAfterFirst = mockGrist.getAppliedActions().length;
        const stateAfterFirst = mockGrist.getState();

        const second = await integration.onTaskUpdated(1, editData);
        expect(second.ok).toBe(true);
        expect(second.actionsExecuted).toBe(0);

        const batchCountAfterSecond = mockGrist.getAppliedBatches().length;
        const actionCountAfterSecond = mockGrist.getAppliedActions().length;

        expect(batchCountAfterSecond).toBe(batchCountAfterFirst);
        expect(actionCountAfterSecond).toBe(actionCountAfterFirst);

        const assignmentsTable = await mockGrist.docApi.fetchTable('TaskAssignments');
        const assignments = columnarToRows(assignmentsTable);
        const activeAssignments = assignments.filter(a => a.actif !== false);

        expect(activeAssignments.length).toBe(2);
        expect(activeAssignments.map(a => a.id).sort()).toEqual([100, 101]);

        const duplicateCheck = {};
        activeAssignments.forEach(a => {
            const key = `${a.tache}-${a.membre}`;
            expect(duplicateCheck[key]).toBeUndefined();
            duplicateCheck[key] = true;
        });
    });

    test('B2.9 - Mode seul ne déclenche pas d auto-planning (enableAutoPlanning=false)', async () => {
        const result = await integration.onTaskCreated(1, {
            assignees: [1, 2],
            charges: [
                { teamId: 1, heures: 8 },
                { teamId: 2, heures: 20 }
            ],
            assignmentModes: {
                1: 'ponctuel',
                2: 'uniforme'
            },
            dateDebut: 1000,
            dateEcheance: 2000
        });

        expect(result.ok).toBe(true);
    });
});

describe('Gantt Assignment Modes - projection virtuelle ponctuelle', () => {
    test('le moteur matériel ignore les affectations ponctuelles', () => {
        const grist = createStatefulGrist({ TaskAssignments: { id: [] } });
        const subject = createGanttAssignmentIntegration(grist, { enableAutoPlanning: false });
        const filtered = subject._helpers.assignmentsRequiringMaterializedPlanning([
            { id: 1, modeRepartition: 'ponctuel' },
            { id: 2, modeRepartition: 'uniforme' },
            { id: 3, modeRepartition: null }
        ]);

        expect(filtered.map(a => a.id)).toEqual([2, 3]);
    });
});
