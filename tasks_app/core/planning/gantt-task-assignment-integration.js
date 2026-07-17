/* ============================================================================
 * gantt-task-assignment-integration.js — Intégration du service TaskAssignments
 * ----------------------------------------------------------------------------
 * Ce module connecte le Gantt au service central des affectations.
 * 
 * API :
 *   createGanttAssignmentIntegration(grist, options)
 * 
 * Retourne un objet avec :
 *   - onTaskCreated(taskId, editData) : appelé après création d'une tâche
 *   - onTaskUpdated(taskId, editData) : appelé après modification d'une tâche
 *   - buildDesiredAssignments(task, editData) : construit l'état désiré
 * ============================================================================ */

(function (global) {
    'use strict';

    /**
     * Crée l'intégration Gantt pour les affectations
     */
    function createGanttAssignmentIntegration(grist, options) {
        options = options || {};
        var logEnabled = options.logEnabled || false;
        var assignmentService = null;

        // Initialiser le service si disponible
        if (global.createTaskAssignmentService) {
            assignmentService = global.createTaskAssignmentService(grist, {
                logEnabled: logEnabled
            });
        }

        function log(message) {
            if (logEnabled && typeof console !== 'undefined') {
                console.log('[GanttAssignmentIntegration]', message);
            }
        }

        /**
         * Construit les affectations désirées depuis les données du formulaire Gantt
         * @param {Object} task - La tâche (avec id, dateDebut, dateEcheance)
         * @param {Object} editData - Données du formulaire (assignees, charges)
         * @returns {Array} Tableau d'affectations normalisées
         */
        function buildDesiredAssignments(task, editData) {
            if (!task || !editData) return [];

            var assignees = editData.assignees || [];
            var charges = editData.charges || [];
            var assignments = [];

            // Pour chaque assigné, créer une affectation si une charge est définie
            assignees.forEach(function(memberId) {
                // Trouver la charge pour ce membre
                var chargeEntry = charges.find(function(c) { return c.teamId === memberId; });
                var allocatedHours = chargeEntry ? Number(chargeEntry.heures) : 0;

                // Règle : ne créer une affectation que si la charge est strictement positive
                // OU si une affectation active existe déjà avec une charge > 0
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

        /**
         * Appelé après la création d'une tâche dans le Gantt
         * @param {number} taskId - ID de la tâche créée
         * @param {Object} editData - Données du formulaire
         * @returns {Promise<Object>} Résultat de la synchronisation
         */
        async function onTaskCreated(taskId, editData) {
            if (!assignmentService) {
                log('Service non disponible');
                return { ok: false, code: 'SERVICE_NOT_AVAILABLE' };
            }

            if (!taskId) {
                log('Task ID manquant');
                return { ok: false, code: 'MISSING_TASK_ID' };
            }

            try {
                // Construire les affectations désirées
                var taskData = {
                    id: taskId,
                    dateDebut: editData.dateDebut,
                    dateEcheance: editData.dateEcheance
                };

                var desiredAssignments = buildDesiredAssignments(taskData, editData);

                if (desiredAssignments.length === 0) {
                    log('Aucune affectation à créer');
                    return { ok: true, createdIds: [], updatedIds: [], actionsExecuted: 0 };
                }

                // Synchroniser
                var result = await assignmentService.syncTaskAssignments(taskId, desiredAssignments, {
                    updateLegacy: true
                });

                log('Synchronisation après création : ' + JSON.stringify(result));
                
                // En cas d'échec partiel, marquer comme échec
                if (!result.ok || result.code === 'LEGACY_SYNC_PARTIAL') {
                    return {
                        ok: false,
                        code: result.code || 'SYNC_ERROR',
                        message: result.message,
                        details: result.details
                    };
                }
                
                return result;

            } catch (e) {
                log('Erreur : ' + e.message);
                return {
                    ok: false,
                    code: 'SYNC_ERROR',
                    message: e.message
                };
            }
        }

        /**
         * Appelé après la modification d'une tâche dans le Gantt
         * @param {number} taskId - ID de la tâche modifiée
         * @param {Object} editData - Données du formulaire
         * @returns {Promise<Object>} Résultat de la synchronisation
         */
        async function onTaskUpdated(taskId, editData) {
            if (!assignmentService) {
                log('Service non disponible');
                return { ok: false, code: 'SERVICE_NOT_AVAILABLE' };
            }

            if (!taskId) {
                log('Task ID manquant');
                return { ok: false, code: 'MISSING_TASK_ID' };
            }

            try {
                // Construire les affectations désirées
                var taskData = {
                    id: taskId,
                    dateDebut: editData.dateDebut,
                    dateEcheance: editData.dateEcheance
                };

                var desiredAssignments = buildDesiredAssignments(taskData, editData);

                // Synchroniser
                var result = await assignmentService.syncTaskAssignments(taskId, desiredAssignments, {
                    updateLegacy: true
                });

                log('Synchronisation après modification : ' + JSON.stringify(result));
                
                // En cas d'échec partiel, le signaler
                if (!result.ok || result.code === 'LEGACY_SYNC_PARTIAL') {
                    return {
                        ok: false,
                        code: result.code || 'SYNC_ERROR',
                        message: result.message,
                        details: result.details
                    };
                }
                
                return result;

            } catch (e) {
                log('Erreur : ' + e.message);
                return {
                    ok: false,
                    code: 'SYNC_ERROR',
                    message: e.message
                };
            }
        }

        /**
         * Synchronise uniquement les dates des affectations (pour le drag-and-drop)
         * @param {number} taskId - ID de la tâche
         * @param {number} newStartDate - Nouvelle date de début
         * @param {number} newEndDate - Nouvelle date de fin
         * @returns {Promise<Object>} Résultat
         */
        async function syncTaskDates(taskId, newStartDate, newEndDate) {
            if (!assignmentService) {
                return { ok: false, code: 'SERVICE_NOT_AVAILABLE' };
            }

            try {
                // Charger les affectations existantes
                var existing = await assignmentService.loadAssignmentsForTask(taskId);

                // Mettre à jour les dates pour chaque affectation active
                var desiredAssignments = existing
                    .filter(function(a) { return a.actif !== false; })
                    .map(function(a) {
                        return {
                            memberId: a.membre,
                            allocatedHours: a.heuresAllouees,
                            startDate: newStartDate,
                            endDate: newEndDate,
                            distributionMode: a.modeRepartition || 'uniforme',
                            active: true,
                            comment: a.commentaire || ''
                        };
                    });

                if (desiredAssignments.length === 0) {
                    return { ok: true, actionsExecuted: 0 };
                }

                return await assignmentService.syncTaskAssignments(taskId, desiredAssignments, {
                    updateLegacy: true
                });

            } catch (e) {
                return {
                    ok: false,
                    code: 'SYNC_ERROR',
                    message: e.message
                };
            }
        }

        // API publique
        return {
            buildDesiredAssignments: buildDesiredAssignments,
            onTaskCreated: onTaskCreated,
            onTaskUpdated: onTaskUpdated,
            syncTaskDates: syncTaskDates,
            isAvailable: function() { return assignmentService !== null; }
        };
    }

    // Export
    global.createGanttAssignmentIntegration = createGanttAssignmentIntegration;

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
