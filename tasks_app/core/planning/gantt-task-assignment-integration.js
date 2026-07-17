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

        // File d'attente par taskId pour éviter les courses
        var taskQueues = {};

        function log(message) {
            if (logEnabled && typeof console !== 'undefined') {
                console.log('[GanttAssignmentIntegration]', message);
            }
        }

        /**
         * Exécute une opération en file d'attente par taskId
         * @param {number} taskId - ID de la tâche
         * @param {Function} operation - Fonction async à exécuter
         * @returns {Promise<Object>} Résultat de l'opération
         */
        async function enqueueTaskOperation(taskId, operation) {
            if (!taskQueues[taskId]) {
                taskQueues[taskId] = Promise.resolve();
            }

            var previousOp = taskQueues[taskId];
            
            taskQueues[taskId] = (async function() {
                try {
                    await previousOp;
                    return await operation();
                } catch (e) {
                    log('Erreur dans opération file: ' + e.message);
                    throw e;
                }
            })();

            return taskQueues[taskId];
        }

        /**
         * Construit les affectations désirées depuis les données du formulaire Gantt
         * @param {Object} task - La tâche (avec id, dateDebut, dateEcheance)
         * @param {Object} editData - Données du formulaire (assignees, charges)
         * @param {Object} options - Options pour contrôler le comportement
         * @returns {Array} Tableau d'affectations normalisées
         */
        function buildDesiredAssignments(task, editData, options) {
            options = options || {};
            if (!task || !editData) return [];

            // CRITIQUE: Distinguer champ absent et suppression explicite
            // Si editData.assignmentsEdited === true, on respecte assignees/charges
            // Si editData.assignmentsEdited === false ou absent, on préserve les affectations existantes
            var assignmentsEdited = editData.assignmentsEdited === true;
            
            // Pour une modification de dates uniquement (drag-and-drop), assignmentsEdited n'est pas positionné
            // Dans ce cas, on ne doit PAS reconstruire les affectations depuis assignees/charges
            // C'est syncTaskDates() qui doit être utilisé à la place
            if (!assignmentsEdited) {
                // Ce cas ne devrait plus arriver si syncTaskDates() est utilisé correctement
                // Mais on garde une sécurité : retourner tableau vide pour ne rien casser
                log('buildDesiredAssignments appelé sans assignmentsEdited, retourne []');
                return [];
            }

            var assignees = editData.assignees || [];
            var charges = editData.charges || [];
            var assignments = [];

            // Pour chaque assigné, créer une affectation si une charge est définie
            assignees.forEach(function(memberId) {
                // Trouver la charge pour ce membre
                var chargeEntry = charges.find(function(c) { return c.teamId === memberId; });
                var allocatedHours = chargeEntry ? Number(chargeEntry.heures) : 0;

                // Règle : ne créer une affectation que si la charge est strictement positive
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

            // Utiliser la file d'attente
            return enqueueTaskOperation(taskId, async function() {
                try {
                    // Construire les affectations désirées
                    var taskData = {
                        id: taskId,
                        dateDebut: editData.dateDebut,
                        dateEcheance: editData.dateEcheance
                    };

                    var desiredAssignments = buildDesiredAssignments(taskData, editData, { assignmentsEdited: true });

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
            });
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

            // Utiliser la file d'attente
            return enqueueTaskOperation(taskId, async function() {
                try {
                    // Déterminer le type de modification
                    var assignmentsEdited = editData.assignmentsEdited === true;
                    var datesEdited = editData.datesEdited === true;
                    
                    // CAS 1: Modification des affectations explicite (panneau ou formulaire)
                    if (assignmentsEdited) {
                        log('Modification explicite des affectations pour tâche ' + taskId);
                        
                        var taskData = {
                            id: taskId,
                            dateDebut: editData.dateDebut,
                            dateEcheance: editData.dateEcheance
                        };

                        var desiredAssignments = buildDesiredAssignments(taskData, editData, { assignmentsEdited: true });

                        // Synchroniser
                        var result = await assignmentService.syncTaskAssignments(taskId, desiredAssignments, {
                            updateLegacy: true
                        });

                        log('Synchronisation après modification explicite : ' + JSON.stringify(result));
                        
                        if (!result.ok || result.code === 'LEGACY_SYNC_PARTIAL') {
                            return {
                                ok: false,
                                code: result.code || 'SYNC_ERROR',
                                message: result.message,
                                details: result.details
                            };
                        }
                        
                        return result;
                    }
                    
                    // CAS 2: Modification de dates uniquement (drag-and-drop ou panneau)
                    if (datesEdited) {
                        log('Modification de dates uniquement pour tâche ' + taskId);
                        
                        // Appel direct à la version interne (déjà dans la file)
                        return await syncTaskDatesInternal(taskId, editData.dateDebut, editData.dateEcheance);
                    }
                    
                    // CAS 3: Modification mixte (dates + autres champs sans affectations)
                    // On préserve les affectations existantes
                    log('Modification sans affectations pour tâche ' + taskId);
                    return { ok: true, code: 'NO_ASSIGNMENT_CHANGE', actionsExecuted: 0 };

                } catch (e) {
                    log('Erreur : ' + e.message);
                    return {
                        ok: false,
                        code: 'SYNC_ERROR',
                        message: e.message
                    };
                }
            });
        }

        /**
         * Synchronise uniquement les dates des affectations (pour le drag-and-drop)
         * Version interne - NE met PAS en file d'attente (doit être appelée depuis une fonction déjà en file)
         * @param {number} taskId - ID de la tâche
         * @param {number} newStartDate - Nouvelle date de début
         * @param {number} newEndDate - Nouvelle date de fin
         * @returns {Promise<Object>} Résultat
         */
        async function syncTaskDatesInternal(taskId, newStartDate, newEndDate) {
            if (!assignmentService) {
                return { ok: false, code: 'SERVICE_NOT_AVAILABLE' };
            }

            try {
                // 1. Charger les affectations existantes
                var existing = await assignmentService.loadAssignmentsForTask(taskId);
                log('syncTaskDatesInternal: ' + existing.length + ' affectations existantes pour tâche ' + taskId);

                if (existing.length === 0) {
                    log('Aucune affectation à mettre à jour');
                    return { ok: true, actionsExecuted: 0, updatedIds: [] };
                }

                // 2. Mettre à jour les dates pour chaque affectation active
                // CRITIQUE: Préserver TOUTES les propriétés existantes
                var desiredAssignments = existing
                    .filter(function(a) { return a.actif !== false; })
                    .map(function(a) {
                        return {
                            id: a.id, // IMPORTANT: conserver l'ID pour la mise à jour
                            memberId: a.membre,
                            allocatedHours: a.heuresAllouees,
                            startDate: newStartDate,
                            endDate: newEndDate,
                            distributionMode: a.modeRepartition || 'uniforme',
                            active: a.actif !== false,
                            comment: a.commentaire || ''
                        };
                    });

                if (desiredAssignments.length === 0) {
                    return { ok: true, actionsExecuted: 0, updatedIds: [] };
                }

                // 3. Synchroniser
                var result = await assignmentService.syncTaskAssignments(taskId, desiredAssignments, {
                    updateLegacy: true
                });

                // 4. Vérifier le résultat
                if (!result.ok) {
                    log('Échec syncTaskDatesInternal: ' + JSON.stringify(result));
                    return result;
                }

                // 5. VÉRIFICATION POST-CONDITION : relire et vérifier que les dates sont correctes
                var updated = await assignmentService.loadAssignmentsForTask(taskId);
                var mismatches = [];
                
                for (var i = 0; i < updated.length; i++) {
                    var a = updated[i];
                    if (a.actif !== false) {
                        if (a.dateDebut !== newStartDate || a.dateFin !== newEndDate) {
                            mismatches.push({
                                assignmentId: a.id,
                                expected: { dateDebut: newStartDate, dateFin: newEndDate },
                                actual: { dateDebut: a.dateDebut, dateFin: a.dateFin }
                            });
                        }
                    }
                }
                
                if (mismatches.length > 0) {
                    log('Post-condition échouée : ' + JSON.stringify(mismatches));
                    return {
                        ok: false,
                        code: 'ASSIGNMENT_DATE_POSTCONDITION_FAILED',
                        taskId: taskId,
                        expected: { dateDebut: newStartDate, dateFin: newEndDate },
                        mismatches: mismatches
                    };
                }

                log('syncTaskDatesInternal réussi: ' + JSON.stringify({
                    updatedIds: result.updatedIds,
                    actionsExecuted: result.actionsExecuted
                }));

                return result;

            } catch (e) {
                log('Erreur syncTaskDatesInternal: ' + e.message);
                return {
                    ok: false,
                    code: 'SYNC_ERROR',
                    message: e.message,
                    details: e.stack
                };
            }
        }

        /**
         * Synchronise uniquement les dates des affectations (pour le drag-and-drop)
         * Version publique - met en file d'attente
         * @param {number} taskId - ID de la tâche
         * @param {number} newStartDate - Nouvelle date de début
         * @param {number} newEndDate - Nouvelle date de fin
         * @returns {Promise<Object>} Résultat
         */
        async function syncTaskDates(taskId, newStartDate, newEndDate) {
            return enqueueTaskOperation(taskId, function() {
                return syncTaskDatesInternal(taskId, newStartDate, newEndDate);
            });
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
