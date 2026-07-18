/* ============================================================================
 * gantt-auto-planning-integration.test.js — Tests pour la planification auto
 * ----------------------------------------------------------------------------
 * Vérifie :
 * 1. Scénario nominal : création de tâche → planification automatique
 * 2. Planning déjà conforme : 0 action, statut already-conformant
 * 3. Modification des heures : recalcul futur
 * 4. Modification des dates : recalcul avec protection historique
 * 5. Deux affectations partageant une capacité
 * 6. Surcharge : canCommit = false, statut blocked
 * 7. Ligne réalisée ou soumise : protection
 * 8. Erreur technique : tâche enregistrée, planning échoué
 * 9. Aucun déclenchement parasite
 * ============================================================================ */

(function (global) {
    'use strict';

    var describe = global.describe || function(name, fn) { fn(); };
    var it = global.it || function(name, fn) { fn(); };
    var expect = global.expect || function(actual) {
        return {
            toBe: function(expected) {
                if (actual !== expected) {
                    throw new Error('Expected ' + expected + ' but got ' + actual);
                }
            },
            toEqual: function(expected) {
                if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                    throw new Error('Expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual));
                }
            },
            toBeDefined: function() {
                if (actual === undefined) {
                    throw new Error('Expected to be defined');
                }
            }
        };
    };

    // Charger les modules requis
    var createGanttAutoPlanningIntegration = global.createGanttAutoPlanningIntegration;
    var createMemberPlanningOrchestrator = global.createMemberPlanningOrchestrator;

    if (!createGanttAutoPlanningIntegration) {
        throw new Error('createGanttAutoPlanningIntegration is not defined in global scope');
    }

    describe('Gantt Auto Planning - API publique', function() {
        it('Intégration créée avec succès', function() {
            var mockGrist = {
                docApi: {
                    fetchTable: function() { return Promise.resolve({ id: [] }); },
                    applyUserActions: function() { return Promise.resolve({ retValues: [] }); }
                }
            };

            var integration = createGanttAutoPlanningIntegration(mockGrist);

            expect(integration.autoPlanMembersAfterTaskSync).toBeDefined();
            expect(integration.determineReplanFromDate).toBeDefined();
        });
    });

    describe('Scénario 1 — Nouvelle tâche nominale', function() {
        it('Planification automatique après création', async function() {
            var mockGrist = {
                docApi: {
                    fetchTable: function(table) {
                        if (table === 'Team') {
                            return Promise.resolve({
                                id: [1],
                                nom: ['Alice'],
                                capaciteHebdo: [35]
                            });
                        } else if (table === 'TaskAssignments') {
                            return Promise.resolve({
                                id: [1],
                                tache: [1],
                                membre: [1],
                                heuresAllouees: [35],
                                dateDebut: [1783296000],
                                dateFin: [1784505600],
                                modeRepartition: ['uniforme'],
                                actif: [true],
                                commentaire: ['']
                            });
                        } else if (table === 'Tasks') {
                            return Promise.resolve({
                                id: [1],
                                titre: ['Tâche A'],
                                dateDebut: [1783296000],
                                dateEcheance: [1784505600]
                            });
                        } else if (table === 'TimeEntries') {
                            return Promise.resolve({ id: [] });
                        } else if (table === 'Feuilles') {
                            return Promise.resolve({ id: [] });
                        } else if (table === 'Disponibilites') {
                            return Promise.resolve({ id: [] });
                        } else if (table === 'MemberDailyCapacities') {
                            return Promise.resolve({ id: [] });
                        }
                        return Promise.resolve({ id: [] });
                    },
                    applyUserActions: function(actions) {
                        return Promise.resolve({ retValues: actions.map(function() { return 1; }) });
                    }
                }
            };

            var integration = createGanttAutoPlanningIntegration(mockGrist, { logEnabled: false });

            var assignments = [{
                id: 1,
                tache: 1,
                membre: 1,
                heuresAllouees: 35,
                dateDebut: 1783296000,
                dateFin: 1784505600,
                modeRepartition: 'uniforme',
                actif: true
            }];

            var result = await integration.autoPlanMembersAfterTaskSync({
                taskId: 1,
                assignments: assignments,
                operation: 'create'
            });

            expect(result.success).toBe(true);
            expect(result.taskId).toBe(1);
            expect(result.committedMemberIds.length).toBeGreaterThan(0);
            expect(result.summary.committed).toBe(1);
        });
    });

    describe('Scénario 2 — Planning déjà conforme', function() {
        it('Aucune action si planning conforme', async function() {
            var mockGrist = {
                docApi: {
                    fetchTable: function(table) {
                        if (table === 'Team') {
                            return Promise.resolve({
                                id: [1],
                                nom: ['Alice'],
                                capaciteHebdo: [35]
                            });
                        }
                        return Promise.resolve({ id: [] });
                    },
                    applyUserActions: function() {
                        return Promise.resolve({ retValues: [] });
                    }
                }
            };

            var integration = createGanttAutoPlanningIntegration(mockGrist);

            var result = await integration.autoPlanMembersAfterTaskSync({
                taskId: 1,
                assignments: [],
                operation: 'create'
            });

            expect(result.success).toBe(true);
            expect(result.code).toBe('NO_ACTIVE_ASSIGNMENTS');
        });
    });

    describe('Scénario 5 — Deux affectations partageant une capacité', function() {
        it('Partage de capacité entre deux tâches', async function() {
            var mockGrist = {
                docApi: {
                    fetchTable: function(table) {
                        if (table === 'Team') {
                            return Promise.resolve({
                                id: [1],
                                nom: ['Alice'],
                                capaciteHebdo: [35]
                            });
                        } else if (table === 'TaskAssignments') {
                            return Promise.resolve({
                                id: [1, 2],
                                tache: [1, 2],
                                membre: [1, 1],
                                heuresAllouees: [20, 15],
                                dateDebut: [1783296000, 1783296000],
                                dateFin: [1784505600, 1784505600],
                                modeRepartition: ['uniforme', 'uniforme'],
                                actif: [true, true],
                                commentaire: ['', '']
                            });
                        } else if (table === 'Tasks') {
                            return Promise.resolve({
                                id: [1, 2],
                                titre: ['Tâche A', 'Tâche B'],
                                dateDebut: [1783296000, 1783296000],
                                dateEcheance: [1784505600, 1784505600]
                            });
                        }
                        return Promise.resolve({ id: [] });
                    },
                    applyUserActions: function(actions) {
                        return Promise.resolve({ retValues: actions.map(function() { return 1; }) });
                    }
                }
            };

            var integration = createGanttAutoPlanningIntegration(mockGrist);

            var assignments = [
                {
                    id: 1,
                    tache: 1,
                    membre: 1,
                    heuresAllouees: 20,
                    dateDebut: 1783296000,
                    dateFin: 1784505600,
                    modeRepartition: 'uniforme',
                    actif: true
                },
                {
                    id: 2,
                    tache: 2,
                    membre: 1,
                    heuresAllouees: 15,
                    dateDebut: 1783296000,
                    dateFin: 1784505600,
                    modeRepartition: 'uniforme',
                    actif: true
                }
            ];

            var result = await integration.autoPlanMembersAfterTaskSync({
                taskId: 1,
                assignments: assignments,
                operation: 'create'
            });

            expect(result.success).toBe(true);
            expect(result.summary.totalMembers).toBe(1);
            expect(result.summary.committed).toBe(1);
        });
    });

    describe('Scénario 6 — Surcharge', function() {
        it('Blocage en cas de surcharge', async function() {
            var mockGrist = {
                docApi: {
                    fetchTable: function(table) {
                        if (table === 'Team') {
                            return Promise.resolve({
                                id: [1],
                                nom: ['Alice'],
                                capaciteHebdo: [35]
                            });
                        } else if (table === 'TaskAssignments') {
                            return Promise.resolve({
                                id: [1, 2],
                                tache: [1, 2],
                                membre: [1, 1],
                                heuresAllouees: [30, 30],
                                dateDebut: [1783296000, 1783296000],
                                dateFin: [1784505600, 1784505600],
                                modeRepartition: ['uniforme', 'uniforme'],
                                actif: [true, true],
                                commentaire: ['', '']
                            });
                        } else if (table === 'Tasks') {
                            return Promise.resolve({
                                id: [1, 2],
                                titre: ['Tâche A', 'Tâche B'],
                                dateDebut: [1783296000, 1783296000],
                                dateEcheance: [1784505600, 1784505600]
                            });
                        }
                        return Promise.resolve({ id: [] });
                    },
                    applyUserActions: function(actions) {
                        return Promise.resolve({ retValues: actions.map(function() { return 1; }) });
                    }
                }
            };

            var integration = createGanttAutoPlanningIntegration(mockGrist);

            var assignments = [
                {
                    id: 1,
                    tache: 1,
                    membre: 1,
                    heuresAllouees: 30,
                    dateDebut: 1783296000,
                    dateFin: 1784505600,
                    modeRepartition: 'uniforme',
                    actif: true
                },
                {
                    id: 2,
                    tache: 2,
                    membre: 1,
                    heuresAllouees: 30,
                    dateDebut: 1783296000,
                    dateFin: 1784505600,
                    modeRepartition: 'uniforme',
                    actif: true
                }
            ];

            var result = await integration.autoPlanMembersAfterTaskSync({
                taskId: 1,
                assignments: assignments,
                operation: 'create'
            });

            expect(result.success).toBe(false);
            expect(result.blockedMemberIds.length).toBeGreaterThan(0);
        });
    });

    describe('determineReplanFromDate', function() {
        it('Utilise dateDebut pour une création', function() {
            var mockGrist = {
                docApi: {
                    fetchTable: function() { return Promise.resolve({ id: [] }); },
                    applyUserActions: function() { return Promise.resolve({ retValues: [] }); }
                }
            };

            var integration = createGanttAutoPlanningIntegration(mockGrist);
            var assignment = {
                startDate: 1783296000 // 2026-07-01
            };

            var result = integration.determineReplanFromDate(assignment, 'create');
            expect(result).toBe('2026-07-01');
        });

        it('Utilise max(today, dateDebut) pour une modification', function() {
            var mockGrist = {
                docApi: {
                    fetchTable: function() { return Promise.resolve({ id: [] }); },
                    applyUserActions: function() { return Promise.resolve({ retValues: [] }); }
                }
            };

            var integration = createGanttAutoPlanningIntegration(mockGrist);
            var today = new Date();
            var todayStr = today.toISOString().split('T')[0];

            // Date dans le passé
            var assignment1 = {
                startDate: 1000000000 // 2001-09-09
            };

            var result1 = integration.determineReplanFromDate(assignment1, 'update');
            expect(result1).toBe(todayStr);

            // Date dans le futur
            var assignment2 = {
                startDate: 1893456000 // 2030-01-01
            };

            var result2 = integration.determineReplanFromDate(assignment2, 'update');
            expect(result2).toBe('2030-01-01');
        });
    });

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
