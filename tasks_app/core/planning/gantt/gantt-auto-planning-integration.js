/* ============================================================================
 * gantt-auto-planning-integration.js — Planification automatique après synchro
 * ----------------------------------------------------------------------------
 * Ce module déclenche la planification automatique après la synchronisation
 * des TaskAssignments depuis le Gantt.
 * 
 * API :
 *   createGanttAutoPlanningIntegration(grist, options)
 * 
 * Retourne un objet avec :
 *   - autoPlanMembersAfterTaskSync(options) : planifie les membres après synchro
 * ============================================================================ */

(function (global) {
    'use strict';

    /**
     * Crée l'intégration de planification automatique pour le Gantt
     */
    function createGanttAutoPlanningIntegration(grist, options) {
        options = options || {};
        var logEnabled = options.logEnabled || false;
        var planningApi = options.planningApi || null;

        function log(message) {
            if (logEnabled && typeof console !== 'undefined') {
                console.log('[GanttAutoPlanning]', message);
            }
        }

        /**
         * Normalise une affectation (accepte les deux formats : Grist et domaine)
         * @param {Object} a - Affectation
         * @returns {Object} Affectation normalisée
         */
        function normalizeAssignment(a) {
            return {
                id: a.id || null,
                membre: Number(a.membre ?? a.memberId) || null,
                actif: (a.actif ?? a.active) !== false,
                dateDebut: a.dateDebut ?? a.startDate ?? null,
                dateFin: a.dateFin ?? a.endDate ?? null,
                heuresAllouees: a.heuresAllouees ?? a.allocatedHours ?? 0,
                modeRepartition: a.modeRepartition ?? a.distributionMode ?? 'uniforme'
            };
        }

        /**
         * Détermine la date de début de replanification
         * @param {Object} assignment - Affectation (format Grist ou domaine)
         * @param {string} operation - 'create' | 'update'
         * @returns {string} Date YYYY-MM-DD
         */
        function determineReplanFromDate(assignment, operation) {
            var today = new Date();
            var todayStr = formatDateUTC(today);
            
            // Normaliser la date de début (accepte les deux formats)
            var rawStartDate = assignment.dateDebut ?? assignment.startDate;
            var startDate = rawStartDate ? formatDateUTC(new Date(rawStartDate * 1000)) : null;
            
            if (operation === 'create') {
                // Pour une création, commencer à la date de début de l'affectation
                return startDate || todayStr;
            } else {
                // Pour une modification, max(today, dateDebut)
                if (startDate && startDate > todayStr) {
                    return startDate;
                }
                return todayStr;
            }
        }

        /**
         * Formate une date UTC en YYYY-MM-DD
         */
        function formatDateUTC(date) {
            var year = date.getUTCFullYear();
            var month = String(date.getUTCMonth() + 1).padStart(2, '0');
            var day = String(date.getUTCDate()).padStart(2, '0');
            return year + '-' + month + '-' + day;
        }

        /**
         * Planifie automatiquement les membres après une synchronisation TaskAssignments
         * @param {Object} params - Paramètres
         * @param {number} params.taskId - ID de la tâche
         * @param {Array} params.assignments - Affectations synchronisées
         * @param {string} params.operation - 'create' | 'update' | 'delete'
         * @param {Function} [params.onStatus] - Callback de statut optionnel
         * @returns {Promise<Object>} Résultat de la planification
         */
        async function autoPlanMembersAfterTaskSync(params) {
            var taskId = params.taskId;
            var assignments = params.assignments || [];
            var operation = params.operation || 'update';
            var onStatus = params.onStatus || null;

            log('autoPlanMembersAfterTaskSync pour tâche ' + taskId + ' (' + operation + ')');

            // 1. Normaliser et filtrer les affectations actives
            var normalizedAssignments = assignments.map(normalizeAssignment);
            var activeAssignments = normalizedAssignments.filter(function(a) {
                return a.actif !== false && a.membre != null && a.membre > 0;
            });

            if (activeAssignments.length === 0) {
                log('Aucune affectation active à planifier');
                return {
                    success: true,
                    taskId: taskId,
                    members: [],
                    committedMemberIds: [],
                    blockedMemberIds: [],
                    failedMemberIds: [],
                    code: 'NO_ACTIVE_ASSIGNMENTS'
                };
            }

            // 2. Dédupliquer les membres
            var memberIds = [];
            var memberAssignments = {};
            activeAssignments.forEach(function(a) {
                var memberId = Number(a.membre);
                if (memberIds.indexOf(memberId) < 0) {
                    memberIds.push(memberId);
                    memberAssignments[memberId] = [];
                }
                memberAssignments[memberId].push(a);
            });

            log('Membres concernés : ' + memberIds.join(', '));

            // 3. Vérifier si l'orchestrateur est disponible
            var orchestratorFactory = null;
            
            // Essayer planningApi en premier, puis global.TaskFlowPlanning, puis global
            if (planningApi && planningApi.createMemberPlanningOrchestrator) {
                orchestratorFactory = planningApi.createMemberPlanningOrchestrator;
            } else if (global.TaskFlowPlanning && global.TaskFlowPlanning.createMemberPlanningOrchestrator) {
                orchestratorFactory = global.TaskFlowPlanning.createMemberPlanningOrchestrator;
            } else if (global.createMemberPlanningOrchestrator) {
                orchestratorFactory = global.createMemberPlanningOrchestrator;
            }

            if (!orchestratorFactory) {
                log('Orchestrateur non disponible');
                return {
                    success: false,
                    taskId: taskId,
                    members: [],
                    committedMemberIds: [],
                    blockedMemberIds: [],
                    failedMemberIds: [],
                    code: 'ORCHESTRATOR_NOT_AVAILABLE'
                };
            }

            // 4. Créer l'orchestrateur
            var orchestrator = orchestratorFactory(grist, {
                logEnabled: logEnabled
            });

            // 5. Planifier chaque membre
            var results = [];
            var committedMemberIds = [];
            var blockedMemberIds = [];
            var failedMemberIds = [];

            for (var i = 0; i < memberIds.length; i++) {
                var memberId = memberIds[i];
                var memberAssigns = memberAssignments[memberId];

                log('Traitement membre ' + memberId + ' (' + memberAssigns.length + ' affectations)');

                try {
                    // Déterminer la date de replanification
                    // Pour une modification, utiliser la date la plus proche parmi les affectations modifiées
                    var replanFromDate = null;
                    if (operation === 'update') {
                        // Pour chaque affectation du membre, prendre la plus ancienne date de début
                        for (var j = 0; j < memberAssigns.length; j++) {
                            var assignReplan = determineReplanFromDate(memberAssigns[j], operation);
                            if (!replanFromDate || assignReplan < replanFromDate) {
                                replanFromDate = assignReplan;
                            }
                        }
                    } else {
                        // Pour une création, utiliser la date de début de la première affectation
                        replanFromDate = determineReplanFromDate(memberAssigns[0], operation);
                    }

                    log('replanFromDate pour membre ' + memberId + ' : ' + replanFromDate);

                    // Preview de la planification
                    if (onStatus) {
                        onStatus({
                            phase: 'preview',
                            memberId: memberId,
                            replanFromDate: replanFromDate
                        });
                    }

                    var preview = await orchestrator.previewMember(memberId, {
                        replanFromDate: replanFromDate
                    });

                    log('Preview membre ' + memberId + ' : ' + JSON.stringify({
                        success: preview.success,
                        canCommit: preview.canCommit,
                        code: preview.code,
                        actionCount: (preview.timeEntryActions || []).length
                    }));

                    // Examiner le résultat
                    if (!preview.success) {
                        log('Preview échoué pour membre ' + memberId + ' : ' + preview.code);
                        results.push({
                            memberId: memberId,
                            status: 'failed',
                            code: preview.code,
                            diagnostics: preview.diagnostics || []
                        });
                        failedMemberIds.push(memberId);
                        continue;
                    }

                    if (!preview.canCommit) {
                        log('Preview non committable pour membre ' + memberId + ' : ' + preview.code);
                        results.push({
                            memberId: memberId,
                            status: 'blocked',
                            code: preview.code,
                            diagnostics: preview.diagnostics || [],
                            actionCount: (preview.timeEntryActions || []).length
                        });
                        blockedMemberIds.push(memberId);
                        continue;
                    }

                    // Vérifier si des actions sont nécessaires
                    var actionCount = (preview.timeEntryActions || []).length + (preview.capacityActions || []).length;
                    
                    if (actionCount === 0) {
                        log('Planning déjà conforme pour membre ' + memberId);
                        results.push({
                            memberId: memberId,
                            status: 'already-conformant',
                            code: preview.code,
                            actionCount: 0
                        });
                        continue;
                    }

                    // Commit de la planification
                    if (onStatus) {
                        onStatus({
                            phase: 'commit',
                            memberId: memberId,
                            actionCount: actionCount
                        });
                    }

                    var commitResult = await orchestrator.commitMember(memberId, preview);

                    if (commitResult.success) {
                        log('Commit réussi pour membre ' + memberId + ' : ' + commitResult.actionsExecuted + ' actions');
                        results.push({
                            memberId: memberId,
                            status: 'committed',
                            actionCount: commitResult.actionsExecuted
                        });
                        committedMemberIds.push(memberId);
                    } else {
                        log('Commit échoué pour membre ' + memberId + ' : ' + commitResult.code);
                        results.push({
                            memberId: memberId,
                            status: 'failed',
                            code: commitResult.code,
                            diagnostics: []
                        });
                        failedMemberIds.push(memberId);
                    }

                } catch (e) {
                    log('Erreur traitement membre ' + memberId + ' : ' + e.message);
                    results.push({
                        memberId: memberId,
                        status: 'failed',
                        error: e.message,
                        diagnostics: []
                    });
                    failedMemberIds.push(memberId);
                }
            }

            // 6. Retourner le résultat global
            var allSuccess = failedMemberIds.length === 0 && blockedMemberIds.length === 0;
            var hasCommitted = committedMemberIds.length > 0;
            var hasBlocked = blockedMemberIds.length > 0;
            var hasFailed = failedMemberIds.length > 0;
            var hasAlreadyConformant = results.some(function(r) { return r.status === 'already-conformant'; });

            log('Résultat global : ' + JSON.stringify({
                success: allSuccess,
                committed: committedMemberIds.length,
                blocked: blockedMemberIds.length,
                failed: failedMemberIds.length,
                alreadyConformant: results.filter(function(r) { return r.status === 'already-conformant'; }).length
            }));

            // Déterminer le code de statut correct
            var code;
            if (hasFailed) {
                code = hasCommitted ? 'PARTIAL_FAILURE' : 'COMMIT_FAILED';
            } else if (hasBlocked) {
                code = hasCommitted ? 'PARTIAL_BLOCKED' : 'BLOCKED';
            } else if (hasCommitted) {
                code = 'SUCCESS';
            } else if (hasAlreadyConformant) {
                code = 'ALREADY_CONFORMANT';
            } else {
                code = 'NO_ACTIVE_ASSIGNMENTS';
            }

            return {
                success: allSuccess,
                taskId: taskId,
                members: results,
                committedMemberIds: committedMemberIds,
                blockedMemberIds: blockedMemberIds,
                failedMemberIds: failedMemberIds,
                code: code,
                summary: {
                    totalMembers: memberIds.length,
                    committed: committedMemberIds.length,
                    blocked: blockedMemberIds.length,
                    failed: failedMemberIds.length,
                    alreadyConformant: results.filter(function(r) { return r.status === 'already-conformant'; }).length
                }
            };
        }

        // API publique
        return {
            autoPlanMembersAfterTaskSync: autoPlanMembersAfterTaskSync,
            determineReplanFromDate: determineReplanFromDate
        };
    }

    // Export pour le navigateur
    global.createGanttAutoPlanningIntegration = createGanttAutoPlanningIntegration;

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));

// Export CommonJS pour tests et bundle (DOIT ÊTRE APRÈS l'IIFE)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createGanttAutoPlanningIntegration: globalThis.createGanttAutoPlanningIntegration
    };
}
