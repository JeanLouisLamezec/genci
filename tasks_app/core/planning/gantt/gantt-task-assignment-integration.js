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
        var enableAutoPlanning = options.enableAutoPlanning !== false;
        var assignmentService = null;
        var autoPlanningIntegration = null;

        // Initialiser le service si disponible
        if (global.createTaskAssignmentService) {
            assignmentService = global.createTaskAssignmentService(grist, {
                logEnabled: logEnabled
            });
        }

        // Initialiser l'intégration de planification automatique
        if (enableAutoPlanning && global.createGanttAutoPlanningIntegration) {
            autoPlanningIntegration = global.createGanttAutoPlanningIntegration(grist, {
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

        // =========================================================================
        // Helpers de normalisation
        // =========================================================================
        
        /**
         * Normalise les assignees Grist en tableau d'IDs numériques
         * Grist peut retourner ['L', 1, 2] ou [1, 2]
         * @param {*} value - Valeur brute depuis Grist
         * @returns {number[]} Tableau d'IDs numériques triés
         */
        function normalizeAssigneeIds(value) {
            if (!Array.isArray(value)) return [];
            
            return value
                .filter(function(v) { return v !== 'L'; })
                .map(function(v) { return Number(v); })
                .filter(function(v) { return Number.isInteger(v) && v > 0; })
                .sort(function(a, b) { return a - b; });
        }
        
        /**
         * Normalise les charges en tableau d'objets {teamId, heures}
         * Peut être un tableau ou une chaîne JSON
         * @param {*} value - Valeur brute depuis Grist
         * @returns {Array} Tableau normalisé
         */
        function normalizeCharges(value) {
            if (!value) return [];
            
            // Si c'est une chaîne JSON, la parser
            var charges = value;
            if (typeof value === 'string') {
                try {
                    charges = JSON.parse(value);
                } catch (e) {
                    log('Erreur parsing charges JSON: ' + e.message);
                    return [];
                }
            }
            
            if (!Array.isArray(charges)) return [];
            
            return charges
                .map(function(c) {
                    return {
                        teamId: Number(c.teamId || 0),
                        heures: Number(c.heures || 0)
                    };
                })
                .filter(function(c) { return c.teamId > 0; })
                .sort(function(a, b) { return a.teamId - b.teamId; });
        }

        // =========================================================================
        // Fonction pure de mapping
        // =========================================================================

        /**
         * Construit les affectations désirées depuis les données du formulaire Gantt
         * Fonction PURE de mapping - ne décide PAS si une synchronisation est nécessaire
         * @param {Object} task - La tâche (avec id, dateDebut, dateEcheance)
         * @param {Object} editData - Données du formulaire (assignees, charges)
         * @returns {Array} Tableau d'affectations normalisées
         */
        function buildDesiredAssignments(task, editData) {
            if (!task || !editData) return [];

            // Normaliser les données d'entrée
            var assigneeIds = normalizeAssigneeIds(editData.assignees);
            var charges = normalizeCharges(editData.charges);
            
            var assignments = [];

            // Pour chaque assigné, créer une affectation si une charge est définie
            assigneeIds.forEach(function(memberId) {
                // Trouver la charge pour ce membre
                var chargeEntry = charges.find(function(c) { return c.teamId === memberId; });
                var allocatedHours = chargeEntry ? chargeEntry.heures : 0;

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
                    // 1. Construire les affectations désirées (TOUJOURS à la création)
                    var taskData = {
                        id: taskId,
                        dateDebut: editData.dateDebut,
                        dateEcheance: editData.dateEcheance
                    };

                    var desiredAssignments = buildDesiredAssignments(taskData, editData);
                    
                    console.info('[TaskAssignment lifecycle]', {
                        phase: 'create',
                        taskId: taskId,
                        rawAssignees: editData.assignees,
                        normalizedAssigneeIds: normalizeAssigneeIds(editData.assignees),
                        rawCharges: editData.charges,
                        normalizedCharges: normalizeCharges(editData.charges),
                        desiredAssignments: desiredAssignments
                    });

                    if (desiredAssignments.length === 0) {
                        log('Aucune affectation à créer (aucun assigné avec charge positive)');
                        return { ok: true, expectedAssignments: 0, createdIds: [], actionsExecuted: 0 };
                    }

                    // 2. Synchroniser
                    var result = await assignmentService.syncTaskAssignments(taskId, desiredAssignments, {
                        updateLegacy: true
                    });

                    log('Synchronisation après création : ' + JSON.stringify(result));
                    
                    // 3. Vérification POST-CONDITION : relire et vérifier que les affectations existent
                    var actualAssignments = await assignmentService.loadAssignmentsForTask(taskId);
                    var activeAssignments = actualAssignments.filter(function(a) { return a.actif !== false; });
                    
                    if (activeAssignments.length < desiredAssignments.length) {
                        log('Post-condition échouée : attendu ' + desiredAssignments.length + ' affectations, trouvé ' + activeAssignments.length);
                        return {
                            ok: false,
                            code: 'ASSIGNMENT_CREATION_POSTCONDITION_FAILED',
                            taskId: taskId,
                            expected: desiredAssignments.length,
                            actual: activeAssignments.length,
                            details: result
                        };
                    }
                    
                    // En cas d'échec partiel, marquer comme échec
                    if (!result.ok || result.code === 'LEGACY_SYNC_PARTIAL') {
                        return {
                            ok: false,
                            code: result.code || 'SYNC_ERROR',
                            message: result.message,
                            details: result.details
                        };
                    }
                    
                    log('Création réussie : ' + JSON.stringify({
                        expectedAssignments: desiredAssignments.length,
                        createdIds: result.createdIds,
                        verifiedIds: activeAssignments.map(function(a) { return a.id; })
                    }));
                    
                    // 4. Planification automatique (après la synchronisation réussie)
                    var planningResult = null;
                    if (autoPlanningIntegration && activeAssignments.length > 0) {
                        try {
                            log('Déclenchement planification automatique pour tâche ' + taskId);
                            planningResult = await autoPlanningIntegration.autoPlanMembersAfterTaskSync({
                                taskId: taskId,
                                assignments: activeAssignments, // Utiliser les affectations rechargées (format Grist)
                                operation: 'create'
                            });
                            
                            log('Planification automatique terminée : ' + JSON.stringify(planningResult.summary));
                        } catch (planError) {
                            log('Erreur planification automatique : ' + planError.message);
                            // Ne pas faire échouer la création de tâche
                        }
                    }
                    
                    var finalResult = {
                        ok: true,
                        taskId: taskId,
                        expectedAssignments: desiredAssignments.length,
                        createdIds: result.createdIds,
                        verifiedIds: activeAssignments.map(function(a) { return a.id; }),
                        actionsExecuted: result.actionsExecuted,
                        planningResult: planningResult
                    };
                    
                    return finalResult;

                } catch (e) {
                    log('Erreur : ' + e.message);
                    return {
                        ok: false,
                        code: 'SYNC_ERROR',
                        message: e.message,
                        details: e.stack
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
                        
                        // Recharger les affectations réelles après synchronisation
                        var actualAssignments = await assignmentService.loadAssignmentsForTask(taskId);
                        var activeAssignments = actualAssignments.filter(function(a) { return a.actif !== false; });
                        
                        // Planification automatique
                        var planningResult = null;
                        if (autoPlanningIntegration && activeAssignments.length > 0) {
                            try {
                                log('Déclenchement planification automatique pour tâche ' + taskId);
                                planningResult = await autoPlanningIntegration.autoPlanMembersAfterTaskSync({
                                    taskId: taskId,
                                    assignments: activeAssignments, // Utiliser les affectations rechargées (format Grist)
                                    operation: 'update'
                                });
                                
                                log('Planification automatique terminée : ' + JSON.stringify(planningResult.summary));
                            } catch (planError) {
                                log('Erreur planification automatique : ' + planError.message);
                                // Ne pas faire échouer la modification
                            }
                        }
                        
                        return {
                            ok: true,
                            taskId: taskId,
                            updatedIds: result.updatedIds,
                            actionsExecuted: result.actionsExecuted,
                            planningResult: planningResult
                        };
                    }
                    
                    // CAS 2: Modification de dates uniquement (drag-and-drop ou panneau)
                    if (datesEdited) {
                        log('Modification de dates uniquement pour tâche ' + taskId);
                        
                        // Appel direct à la version interne (déjà dans la file)
                        var dateSyncResult = await syncTaskDatesInternal(taskId, editData.dateDebut, editData.dateEcheance);
                        
                        // Planification automatique si succès
                        if (dateSyncResult.ok && autoPlanningIntegration) {
                            try {
                                // Charger les affectations pour la planification
                                var assignmentsForPlanning = await assignmentService.loadAssignmentsForTask(taskId);
                                var activeAssignments = assignmentsForPlanning.filter(function(a) { return a.actif !== false; });
                                
                                if (activeAssignments.length > 0) {
                                    log('Déclenchement planification automatique (dates) pour tâche ' + taskId);
                                    var planningResult = await autoPlanningIntegration.autoPlanMembersAfterTaskSync({
                                        taskId: taskId,
                                        assignments: activeAssignments,
                                        operation: 'update'
                                    });
                                    
                                    log('Planification automatique terminée : ' + JSON.stringify(planningResult.summary));
                                    dateSyncResult.planningResult = planningResult;
                                }
                            } catch (planError) {
                                log('Erreur planification automatique : ' + planError.message);
                                // Ne pas faire échouer la modification de dates
                            }
                        }
                        
                        return dateSyncResult;
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
         * Répare les affectations manquantes pour une tâche endommagée
         * Utilise les projections legacy (assignees, charges) pour reconstruire les affectations
         * @param {number} taskId - ID de la tâche
         * @param {Object} options - Options
         * @returns {Promise<Object>} Résultat de la réparation
         */
        async function repairMissingAssignmentsForTask(taskId, options) {
            options = options || {};
            
            if (!assignmentService) {
                return { ok: false, code: 'SERVICE_NOT_AVAILABLE' };
            }
            
            try {
                // 1. Charger la tâche et les affectations existantes
                var existing = await assignmentService.loadAssignmentsForTask(taskId);
                
                if (existing.length > 0) {
                    log('Tâche ' + taskId + ' a déjà des affectations, pas de réparation nécessaire');
                    return { ok: true, repaired: false, reason: 'ASSIGNMENTS_ALREADY_EXIST' };
                }
                
                // 2. Charger les données de la tâche (projections legacy)
                var tasksTable = await grist.docApi.fetchTable('Tasks');
                var taskIndex = -1;
                
                if (tasksTable.id) {
                    for (var i = 0; i < tasksTable.id.length; i++) {
                        if (tasksTable.id[i] === taskId) {
                            taskIndex = i;
                            break;
                        }
                    }
                }
                
                if (taskIndex < 0) {
                    return { ok: false, code: 'TASK_NOT_FOUND', taskId: taskId };
                }
                
                // 3. Lire les projections legacy
                var assignees = tasksTable.assignees ? tasksTable.assignees[taskIndex] : [];
                var chargesJson = tasksTable.charges ? tasksTable.charges[taskIndex] : null;
                var dateDebut = tasksTable.dateDebut ? tasksTable.dateDebut[taskIndex] : null;
                var dateEcheance = tasksTable.dateEcheance ? tasksTable.dateEcheance[taskIndex] : null;
                
                if (!assignees || assignees.length === 0) {
                    log('Tâche ' + taskId + ' sans assignees, pas de réparation');
                    return { ok: true, repaired: false, reason: 'NO_ASSIGNEES' };
                }
                
                // 4. Reconstruire les affectations
                var editData = {
                    assignees: assignees,
                    charges: chargesJson
                };
                
                var taskData = {
                    id: taskId,
                    dateDebut: dateDebut,
                    dateEcheance: dateEcheance
                };
                
                var desiredAssignments = buildDesiredAssignments(taskData, editData);
                
                console.info('[TaskAssignment lifecycle]', {
                    phase: 'repair',
                    taskId: taskId,
                    legacyAssignees: assignees,
                    legacyCharges: chargesJson,
                    desiredAssignments: desiredAssignments
                });
                
                if (desiredAssignments.length === 0) {
                    log('Aucune affectation à réparer pour tâche ' + taskId);
                    return { ok: true, repaired: false, reason: 'NO_VALID_ASSIGNMENTS' };
                }
                
                // 5. Créer les affectations manquantes
                var result = await assignmentService.syncTaskAssignments(taskId, desiredAssignments, {
                    updateLegacy: false // Ne pas mettre à jour legacy, on lit déjà depuis legacy
                });
                
                // 6. Vérification post-condition
                var actualAssignments = await assignmentService.loadAssignmentsForTask(taskId);
                var activeAssignments = actualAssignments.filter(function(a) { return a.actif !== false; });
                
                if (activeAssignments.length < desiredAssignments.length) {
                    return {
                        ok: false,
                        code: 'ASSIGNMENT_REPAIR_POSTCONDITION_FAILED',
                        taskId: taskId,
                        expected: desiredAssignments.length,
                        actual: activeAssignments.length
                    };
                }
                
                log('Réparation réussie pour tâche ' + taskId + ' : ' + activeAssignments.length + ' affectations créées');
                
                return {
                    ok: true,
                    repaired: true,
                    code: 'ASSIGNMENTS_REPAIRED_FROM_LEGACY',
                    taskId: taskId,
                    createdIds: result.createdIds,
                    count: activeAssignments.length
                };
                
            } catch (e) {
                log('Erreur réparation: ' + e.message);
                return {
                    ok: false,
                    code: 'REPAIR_ERROR',
                    message: e.message
                };
            }
        }
        
        /**
         * Supprime des tâches avec leurs affectations et TimeEntries associés
         * @param {Array} taskIds - IDs des tâches à supprimer
         * @param {Object} options - Options (detachChildren, includeDescendants)
         * @returns {Promise<Object>} Résultat de la suppression
         */
        async function deleteTasksWithAssignments(taskIds, options) {
            options = options || {};
            var detachChildren = options.detachChildren === true;
            var includeDescendants = options.includeDescendants === true;
            
            if (!assignmentService || !grist || !grist.docApi) {
                return { ok: false, code: 'SERVICE_NOT_AVAILABLE' };
            }
            
            if (!Array.isArray(taskIds) || taskIds.length === 0) {
                return { ok: false, code: 'INVALID_TASK_IDS' };
            }
            
            try {
                console.info('[TaskAssignment lifecycle]', {
                    phase: 'delete',
                    taskIds: taskIds,
                    detachChildren: detachChildren,
                    includeDescendants: includeDescendants
                });
                
                // 1. Collecter tous les IDs (avec descendants si nécessaire)
                var allTaskIds = taskIds.slice();
                
                if (includeDescendants) {
                    // Charger toutes les tâches pour trouver les descendants
                    var allTasksTable = await grist.docApi.fetchTable('Tasks');
                    var allTasks = [];
                    
                    if (allTasksTable.id) {
                        for (var i = 0; i < allTasksTable.id.length; i++) {
                            allTasks.push({
                                id: allTasksTable.id[i],
                                parentTask: allTasksTable.parentTask ? allTasksTable.parentTask[i] : null
                            });
                        }
                    }
                    
                    // Trouver tous les descendants récursivement
                    function findDescendants(parentId) {
                        var descendants = [];
                        for (var j = 0; j < allTasks.length; j++) {
                            if (allTasks[j].parentTask === parentId) {
                                descendants.push(allTasks[j].id);
                                descendants = descendants.concat(findDescendants(allTasks[j].id));
                            }
                        }
                        return descendants;
                    }
                    
                    for (var k = 0; k < taskIds.length; k++) {
                        var desc = findDescendants(taskIds[k]);
                        allTaskIds = allTaskIds.concat(desc);
                    }
                }
                
                // 2. Charger les TaskAssignments pour toutes les tâches
                var allAssignments = [];
                var assignmentsTable = await grist.docApi.fetchTable('TaskAssignments');
                
                if (assignmentsTable.id) {
                    for (var l = 0; l < assignmentsTable.id.length; l++) {
                        if (allTaskIds.indexOf(assignmentsTable.tache[l]) >= 0) {
                            allAssignments.push({
                                id: assignmentsTable.id[l],
                                tache: assignmentsTable.tache[l],
                                membre: assignmentsTable.membre[l],
                                actif: assignmentsTable.actif[l] !== false
                            });
                        }
                    }
                }
                
                var assignmentIds = allAssignments.map(function(a) { return a.id; });
                
                // 3. Charger les TimeEntries liés à ces affectations
                var timeEntriesTable = await grist.docApi.fetchTable('TimeEntries');
                var mutableTimeEntryIds = [];
                var lockedTimeEntryIds = [];
                
                if (timeEntriesTable.id) {
                    for (var m = 0; m < timeEntriesTable.id.length; m++) {
                        var tacheId = timeEntriesTable.tache ? timeEntriesTable.tache[m] : null;
                        var membreId = timeEntriesTable.membre ? timeEntriesTable.membre[m] : null;
                        
                        // Vérifier si ce TimeEntry est lié à une affectation qu'on va supprimer
                        var linkedAssignment = allAssignments.find(function(a) {
                            return a.tache === tacheId && a.membre === membreId;
                        });
                        
                        if (linkedAssignment) {
                            var heures = timeEntriesTable.heures ? timeEntriesTable.heures[m] : 0;
                            var feuille = timeEntriesTable.feuille ? timeEntriesTable.feuille[m] : null;
                            var sheetStatus = timeEntriesTable.sheetStatus ? timeEntriesTable.sheetStatus[m] : null;
                            
                            // Vérifier si verrouillé
                            var isLocked = (
                                heures > 0 ||
                                (feuille && feuille !== null) ||
                                sheetStatus === 'submitted' ||
                                sheetStatus === 'validated'
                            );
                            
                            if (isLocked) {
                                lockedTimeEntryIds.push(timeEntriesTable.id[m]);
                            } else {
                                mutableTimeEntryIds.push(timeEntriesTable.id[m]);
                            }
                        }
                    }
                }
                
                // 4. Si des TimeEntries verrouillés existent, bloquer la suppression
                if (lockedTimeEntryIds.length > 0) {
                    console.warn('[TaskAssignment lifecycle]', {
                        phase: 'delete-blocked',
                        taskIds: taskIds,
                        lockedTimeEntryIds: lockedTimeEntryIds
                    });
                    
                    return {
                        ok: false,
                        code: 'TASK_DELETE_BLOCKED_BY_TIME_ENTRIES',
                        taskIds: taskIds,
                        assignmentIds: assignmentIds,
                        timeEntryIds: lockedTimeEntryIds
                    };
                }
                
                // 5. Construire les actions de suppression
                var actions = [];
                
                // Supprimer les TimeEntries mutables
                mutableTimeEntryIds.forEach(function(id) {
                    actions.push(['RemoveRecord', 'TimeEntries', id]);
                });
                
                // Supprimer les TaskAssignments
                assignmentIds.forEach(function(id) {
                    actions.push(['RemoveRecord', 'TaskAssignments', id]);
                });
                
                // Détacher les enfants si nécessaire
                if (detachChildren) {
                    // Mettre parentTask = null sur les enfants directs des tâches supprimées
                    var allTasksTable2 = await grist.docApi.fetchTable('Tasks');
                    var childrenToDetach = [];
                    
                    if (allTasksTable2.id) {
                        for (var n = 0; n < allTasksTable2.id.length; n++) {
                            var parentTask = allTasksTable2.parentTask ? allTasksTable2.parentTask[n] : null;
                            if (taskIds.indexOf(parentTask) >= 0) {
                                // C'est un enfant direct d'une tâche à supprimer
                                childrenToDetach.push(allTasksTable2.id[n]);
                            }
                        }
                    }
                    
                    childrenToDetach.forEach(function(childId) {
                        actions.push(['UpdateRecord', 'Tasks', childId, { parentTask: null }]);
                    });
                }
                
                // Supprimer les tâches
                allTaskIds.forEach(function(id) {
                    actions.push(['RemoveRecord', 'Tasks', id]);
                });
                
                console.info('[TaskAssignment lifecycle]', {
                    phase: 'delete-actions',
                    mutableTimeEntries: mutableTimeEntryIds.length,
                    assignments: assignmentIds.length,
                    tasks: allTaskIds.length,
                    actions: actions.length
                });
                
                // 6. Exécuter les actions
                if (actions.length > 0) {
                    await grist.docApi.applyUserActions(actions);
                }
                
                // 7. Vérification post-condition
                var remainingTasks = 0;
                var remainingAssignments = 0;
                
                var checkTasksTable = await grist.docApi.fetchTable('Tasks');
                if (checkTasksTable.id) {
                    for (var p = 0; p < checkTasksTable.id.length; p++) {
                        if (allTaskIds.indexOf(checkTasksTable.id[p]) >= 0) {
                            remainingTasks++;
                        }
                    }
                }
                
                var checkAssignmentsTable = await grist.docApi.fetchTable('TaskAssignments');
                if (checkAssignmentsTable.id) {
                    for (var q = 0; q < checkAssignmentsTable.id.length; q++) {
                        if (assignmentIds.indexOf(checkAssignmentsTable.id[q]) >= 0) {
                            remainingAssignments++;
                        }
                    }
                }
                
                if (remainingTasks > 0 || remainingAssignments > 0) {
                    return {
                        ok: false,
                        code: 'DELETE_POSTCONDITION_FAILED',
                        expectedTasks: 0,
                        actualTasks: remainingTasks,
                        expectedAssignments: 0,
                        actualAssignments: remainingAssignments
                    };
                }
                
                log('Suppression réussie : ' + allTaskIds.length + ' tâches, ' + assignmentIds.length + ' affectations');
                
                return {
                    ok: true,
                    deletedTasks: allTaskIds.length,
                    deletedAssignments: assignmentIds.length,
                    deletedTimeEntries: mutableTimeEntryIds.length
                };
                
            } catch (e) {
                log('Erreur suppression: ' + e.message);
                return {
                    ok: false,
                    code: 'DELETE_ERROR',
                    message: e.message,
                    details: e.stack
                };
            }
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
         * Version publique - met en file d'attente et déclenche la planification automatique
         * @param {number} taskId - ID de la tâche
         * @param {number} newStartDate - Nouvelle date de début
         * @param {number} newEndDate - Nouvelle date de fin
         * @returns {Promise<Object>} Résultat
         */
        async function syncTaskDates(taskId, newStartDate, newEndDate) {
            return enqueueTaskOperation(taskId, async function() {
                // 1. Synchroniser les dates
                var result = await syncTaskDatesInternal(taskId, newStartDate, newEndDate);
                
                if (!result.ok || !autoPlanningIntegration) {
                    return result;
                }
                
                // 2. Recharger les affectations réelles
                try {
                    var assignments = await assignmentService.loadAssignmentsForTask(taskId);
                    var activeAssignments = assignments.filter(function(a) { return a.actif !== false; });
                    
                    if (activeAssignments.length > 0) {
                        log('Déclenchement planification automatique après modification des dates');
                        result.planningResult = await autoPlanningIntegration.autoPlanMembersAfterTaskSync({
                            taskId: taskId,
                            assignments: activeAssignments,
                            operation: 'update'
                        });
                        log('Planification automatique terminée : ' + JSON.stringify(result.planningResult.summary));
                    }
                } catch (error) {
                    log('Erreur planification automatique après dates : ' + error.message);
                    result.planningResult = {
                        success: false,
                        code: 'AUTO_PLANNING_ERROR',
                        failedMemberIds: [],
                        blockedMemberIds: []
                    };
                }
                
                return result;
            });
        }

        // API publique
        return {
            buildDesiredAssignments: buildDesiredAssignments,
            onTaskCreated: onTaskCreated,
            onTaskUpdated: onTaskUpdated,
            syncTaskDates: syncTaskDates,
            syncTaskDatesInternal: syncTaskDatesInternal,
            repairMissingAssignmentsForTask: repairMissingAssignmentsForTask,
            deleteTasksWithAssignments: deleteTasksWithAssignments,
            isAvailable: function() { return assignmentService !== null; },
            // Helpers exportés pour tests
            _helpers: {
                normalizeAssigneeIds: normalizeAssigneeIds,
                normalizeCharges: normalizeCharges
            }
        };
    }

    // Export
    global.createGanttAssignmentIntegration = createGanttAssignmentIntegration;

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
