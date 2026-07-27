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
        // PHASE A — CLASSIFICATION CENTRALISÉE DES TIMEENTRIES
        // =========================================================================
        
        /**
         * Classification centralisée d'une TimeEntry
         * Réutilisée par : précontrôle, commit, suppression de tâche, removeMemberFromTask, postconditions
         * 
         * RÈGLES FAIL-CLOSED :
         * - feuille introuvable → CONFLIT
         * - statut inconnu → CONFLIT
         * - description/imputation non vide → PROTÉGÉ
         * - heures invalide → CONFLIT
         * 
         * @param {Object} entry - TimeEntry avec id, heures, feuille, affectation, tache, membre, description, imputation
         * @param {Object} sheetsById - Map { sheetId: { statut } }
         * @param {Object} [options] - Options : requireAssignment (défaut true), allowLegacy (défaut false)
         * @returns {{ status: 'MUTABLE' | 'PROTECTED' | 'CONFLICT', reason?: string, entryId: number }}
         */
        function classifyTimeEntry(entry, sheetsById, options) {
            options = options || {};
            var requireAssignment = options.requireAssignment !== false;
            var allowLegacy = options.allowLegacy === true;
            
            // Validation heures (fail-closed)
            var heures = entry.heures;
            if (heures !== null && heures !== undefined && heures !== '') {
                var heuresNum = Number(heures);
                if (!Number.isFinite(heuresNum)) {
                    // PHASE A.6 : heures invalide → CONFLIT
                    return {
                        status: 'CONFLICT',
                        reason: 'INVALID_HEURES_VALUE',
                        entryId: entry.id
                    };
                }
            }
            
            // PHASE A.5 : description/imputation → PROTÉGÉ
            var hasDescription = (entry.description && String(entry.description).trim() !== '');
            var hasImputation = (entry.imputation && String(entry.imputation).trim() !== '');
            if (hasDescription || hasImputation) {
                return {
                    status: 'PROTECTED',
                    reason: 'HAS_METADATA',
                    entryId: entry.id
                };
            }
            
            // PHASE A.6 : hasExplicitActual avec Number.isFinite(Number(value))
            var hasExplicitActual = (
                heures !== null &&
                heures !== undefined &&
                heures !== '' &&
                Number.isFinite(Number(heures))
            );
            
            if (hasExplicitActual) {
                // Réalisé explicite (y compris 0) → PROTÉGÉ
                return {
                    status: 'PROTECTED',
                    reason: heures === 0 ? 'EXPLICIT_ZERO' : 'EXPLICIT_ACTUAL',
                    entryId: entry.id
                };
            }
            
            // heures = null, vérifier la feuille
            var feuille = entry.feuille;
            var hasSheet = (feuille != null && feuille !== 0);
            
            if (hasSheet) {
                // PHASE A.4 : feuille présente, vérifier le statut
                var sheet = sheetsById[feuille];
                
                if (!sheet) {
                    // PHASE A.5 : feuille introuvable → CONFLIT (fail-closed)
                    return {
                        status: 'CONFLICT',
                        reason: 'SHEET_NOT_FOUND',
                        entryId: entry.id
                    };
                }
                
                var statutRaw = sheet.statut;
                if (statutRaw === null || statutRaw === undefined || statutRaw === '') {
                    // Statut inconnu → CONFLIT (fail-closed)
                    return {
                        status: 'CONFLICT',
                        reason: 'SHEET_STATUS_UNKNOWN',
                        entryId: entry.id
                    };
                }
                
                var statut = String(statutRaw).toLowerCase();
                
                // PHASE A.5 : soumis, valide, correction_manager → PROTÉGÉ
                if (statut === 'soumis' || statut === 'valide' || statut === 'correction_manager') {
                    return {
                        status: 'PROTECTED',
                        reason: 'SHEET_' + statut.toUpperCase(),
                        entryId: entry.id
                    };
                }
                
                // PHASE A.4 : brouillon, rejetée → MUTABLE (si heures = null)
                if (statut === 'brouillon' || statut === 'rejete') {
                    return {
                        status: 'MUTABLE',
                        reason: 'SHEET_' + statut + '_NULL_HEURES',
                        entryId: entry.id
                    };
                }
                
                // Statut inconnu → CONFLIT
                return {
                    status: 'CONFLICT',
                    reason: 'SHEET_STATUS_UNRECOGNIZED_' + statut,
                    entryId: entry.id
                };
            }
            
            // heures = null ET feuille = null → MUTABLE
            return {
                status: 'MUTABLE',
                reason: 'NULL_HEURES_NO_SHEET',
                entryId: entry.id
            };
        }
        
        /**
         * Charge les feuilles et retourne une map par ID
         * @returns {Promise<Object>} Map { sheetId: { statut } }
         */
        async function loadSheetsMap() {
            var sheetsTable = await grist.docApi.fetchTable('Feuilles');
            var sheetsById = {};
            
            if (sheetsTable.id) {
                for (var i = 0; i < sheetsTable.id.length; i++) {
                    sheetsById[sheetsTable.id[i]] = {
                        statut: sheetsTable.statut ? sheetsTable.statut[i] : null
                    };
                }
            }
            
            return sheetsById;
        }
        
        /**
         * Trouve les TimeEntries liées à une affectation ou à une tâche+membre (legacy)
         * PHASE A.2 : Inclut les TimeEntries legacy sans affectation
         * @param {number} assignmentId - ID de l'affectation
         * @param {number} taskId - ID de la tâche
         * @param {number} memberId - ID du membre
         * @param {boolean} includeLegacy - true pour inclure legacy
         * @returns {Promise<Array>} Liste des TimeEntries avec { id, heures, feuille, affectation, description, imputation }
         */
        async function findLinkedTimeEntries(assignmentId, taskId, memberId, includeLegacy) {
            var timeEntriesTable = await grist.docApi.fetchTable('TimeEntries');
            var entries = [];
            
            if (!timeEntriesTable.id) {
                return entries;
            }
            
            for (var i = 0; i < timeEntriesTable.id.length; i++) {
                var affectationId = timeEntriesTable.affectation ? timeEntriesTable.affectation[i] : null;
                var tacheId = timeEntriesTable.tache ? timeEntriesTable.tache[i] : null;
                var membreId = timeEntriesTable.membre ? timeEntriesTable.membre[i] : null;
                
                var isLinked = false;
                var isLegacy = false;
                
                if (affectationId != null && affectationId !== 0) {
                    // TimeEntry avec affectation explicite
                    if (affectationId === assignmentId) {
                        isLinked = true;
                    }
                } else if (includeLegacy) {
                    // PHASE A.2 : TimeEntry legacy sans affectation
                    if (tacheId === taskId && membreId === memberId) {
                        isLinked = true;
                        isLegacy = true;
                    }
                }
                
                if (isLinked) {
                    entries.push({
                        id: timeEntriesTable.id[i],
                        heures: (timeEntriesTable.heures && timeEntriesTable.heures[i] !== undefined) ? timeEntriesTable.heures[i] : null,
                        feuille: (timeEntriesTable.feuille && timeEntriesTable.feuille[i] !== undefined) ? timeEntriesTable.feuille[i] : null,
                        affectation: affectationId,
                        tache: tacheId,
                        membre: membreId,
                        description: timeEntriesTable.description ? timeEntriesTable.description[i] : null,
                        imputation: timeEntriesTable.imputation ? timeEntriesTable.imputation[i] : null,
                        isLegacy: isLegacy
                    });
                }
            }
            
            return entries;
        }
        
        // =========================================================================
        // PHASE A — PRÉCONTRÔLE DU NETTOYAGE
        // =========================================================================
        
        /**
         * Inspecte les TimeEntries d'un membre retiré et détermine si le retrait est possible
         * PHASE A : Charge les Feuilles et résout le vrai statut
         * Utilise exclusivement : findLinkedTimeEntries(), loadSheetsMap(), classifyTimeEntry()
         * @param {number} taskId - ID de la tâche
         * @param {number} memberId - ID du membre
         * @param {number} assignmentId - ID de l'affectation à désactiver
         * @param {boolean} includeLegacy - true pour inclure les TimeEntries legacy
         * @returns {Promise<{ok: boolean, code?: string, lockedEntries: Object[], mutableEntries: number[], conflicts: Object[]}>}
         */
        async function inspectMemberRemoval(taskId, memberId, assignmentId, includeLegacy) {
            var entries = await findLinkedTimeEntries(assignmentId, taskId, memberId, includeLegacy);
            
            if (entries.length === 0) {
                return { ok: true, lockedEntries: [], mutableEntries: [], conflicts: [] };
            }
            
            // Charger les feuilles
            var sheetsById = await loadSheetsMap();
            
            var lockedEntries = [];
            var mutableEntries = [];
            var conflicts = [];
            
            for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                var classification = classifyTimeEntry(entry, sheetsById, { allowLegacy: includeLegacy });
                
                if (classification.status === 'MUTABLE') {
                    mutableEntries.push(entry.id);
                } else if (classification.status === 'PROTECTED') {
                    lockedEntries.push({ id: entry.id, reason: classification.reason });
                } else if (classification.status === 'CONFLICT') {
                    conflicts.push({ id: entry.id, reason: classification.reason });
                }
            }
            
            // PHASE A.5 : Conflits → blocage fail-closed
            if (conflicts.length > 0) {
                return {
                    ok: false,
                    code: 'MEMBER_REMOVE_CONFLICT',
                    conflicts: conflicts,
                    conflict: true
                };
            }
            
            if (lockedEntries.length > 0) {
                return {
                    ok: false,
                    code: 'MEMBER_REMOVE_BLOCKED_BY_PROTECTED_TIME',
                    lockedEntries: lockedEntries,
                    mutableEntries: mutableEntries
                };
            }
            
            return {
                ok: true,
                lockedEntries: [],
                mutableEntries: mutableEntries,
                conflicts: []
            };
        }
        
        /**
         * Précontrôle de TOUS les membres retirés AVANT toute synchronisation
         * PHASE A : Bloquer complètement si AU MOINS un membre a des TimeEntries protégés
         * @param {number} taskId - ID de la tâche
         * @param {Array} existingAssignments - Affectations existantes
         * @param {Array} desiredAssignments - Affectations désirées
         * @returns {Promise<{ok: boolean, code?: string, membersBlocked?: number[], details?: Object[]}>}
         */
        async function precheckMemberRemovals(taskId, existingAssignments, desiredAssignments) {
            // Identifier les membres retirés (dans existing mais pas dans desired)
            var desiredMemberIds = {};
            (desiredAssignments || []).forEach(function(a) {
                desiredMemberIds[a.memberId] = true;
            });
            
            var membersToRemove = [];
            (existingAssignments || []).forEach(function(a) {
                if (a.actif !== false && !desiredMemberIds[a.membre]) {
                    membersToRemove.push({
                        memberId: a.membre,
                        assignmentId: a.id
                    });
                }
            });
            
            if (membersToRemove.length === 0) {
                // Aucun membre retiré, précontrôle OK
                return { ok: true };
            }
            
            // Inspecter chaque membre retiré
            var blockedMembers = [];
            var allDetails = [];
            
            for (var i = 0; i < membersToRemove.length; i++) {
                var member = membersToRemove[i];
                // PHASE A.2 : includeLegacy = true pour inspecter aussi les TimeEntries legacy
                var inspection = await inspectMemberRemoval(taskId, member.memberId, member.assignmentId, true);
                
                if (!inspection.ok) {
                    blockedMembers.push(member.memberId);
                    allDetails.push({
                        memberId: member.memberId,
                        assignmentId: member.assignmentId,
                        code: inspection.code,
                        lockedEntries: inspection.lockedEntries,
                        conflicts: inspection.conflicts,
                        reason: inspection.reason
                    });
                }
            }
            
            if (blockedMembers.length > 0) {
                // PHASE A.2 : Blocage complet, zéro écriture
                var conflictCount = allDetails.reduce(function(sum, d) { return sum + (d.conflicts ? d.conflicts.length : 0); }, 0);
                
                return {
                    ok: false,
                    code: conflictCount > 0 ? 'MEMBER_REMOVAL_CONFLICT' : 'MEMBER_REMOVAL_BLOCKED_BY_PROTECTED_TIME',
                    membersBlocked: blockedMembers,
                    details: allDetails
                };
            }
            
            // Tous les membres retirés peuvent être nettoyés
            return { ok: true };
        }

        // =========================================================================
        // PHASE A — COMMIT TRANSACTIONNEL (TimeEntries + TaskAssignments + Tasks)
        // =========================================================================
        
        /**
         * Commit transactionnel du retrait d'un membre
         * PHASE A.1 : TimeEntries + TaskAssignments dans un seul applyUserActions
         * @param {number} taskId - ID de la tâche
         * @param {number} memberId - ID du membre
         * @param {number} assignmentId - ID de l'affectation
         * @param {boolean} includeLegacy - true pour inclure TimeEntries legacy
         * @param {boolean} deactivateAssignment - true pour désactiver l'affectation (défaut true)
         * @returns {Promise<{ok: boolean, code?: string, actions?: Array, deletedCount?: number}>}
         */
        async function commitMemberRemoval(taskId, memberId, assignmentId, includeLegacy, deactivateAssignment) {
            deactivateAssignment = deactivateAssignment !== false; // défaut true
            
            // 1. Inspecter (déjà fait dans precheck, mais revérifier pour sécurité)
            var inspection = await inspectMemberRemoval(taskId, memberId, assignmentId, includeLegacy);
            
            if (!inspection.ok) {
                // Conflit ou protégé → zéro action
                return {
                    ok: false,
                    code: inspection.code,
                    conflicts: inspection.conflicts,
                    lockedEntries: inspection.lockedEntries
                };
            }
            
            // 2. Construire les actions dans un seul tableau
            var actions = [];
            
            // Supprimer les TimeEntries mutables
            if (inspection.mutableEntries && inspection.mutableEntries.length > 0) {
                inspection.mutableEntries.forEach(function(id) {
                    actions.push(['RemoveRecord', 'TimeEntries', id]);
                });
            }
            
            // Désactiver l'affectation (seulement si deactivateAssignment = true)
            if (deactivateAssignment) {
                actions.push(['UpdateRecord', 'TaskAssignments', assignmentId, { actif: false }]);
            }
            
            // 3. Exécuter dans un SEUL applyUserActions (transactionnel)
            try {
                await grist.docApi.applyUserActions(actions);
                
                // 4. PHASE A.8 : Postcondition — relire et vérifier
                var checkEntries = await findLinkedTimeEntries(assignmentId, taskId, memberId, includeLegacy);
                var sheetsById = await loadSheetsMap();
                var remainingMutable = 0;
                
                for (var i = 0; i < checkEntries.length; i++) {
                    var classification = classifyTimeEntry(checkEntries[i], sheetsById, { allowLegacy: includeLegacy });
                    if (classification.status === 'MUTABLE') {
                        remainingMutable++;
                    }
                }
                
                if (remainingMutable > 0) {
                    // Échec postcondition
                    return {
                        ok: false,
                        code: 'CLEANUP_POSTCONDITION_FAILED',
                        remainingMutable: remainingMutable,
                        deletedCount: inspection.mutableEntries ? inspection.mutableEntries.length : 0
                    };
                }
                
                return {
                    ok: true,
                    actions: actions,
                    deletedCount: inspection.mutableEntries ? inspection.mutableEntries.length : 0
                };
                
            } catch (e) {
                // PHASE A.10 : échec applyUserActions → retour erreur, aucune modification
                return {
                    ok: false,
                    code: 'APPLY_USER_ACTIONS_FAILED',
                    message: e.message,
                    error: e
                };
            }
        }

        // =========================================================================
        // PHASE A — NETTOYAGE APRÈS DÉSACTIVATION (délégué à commitMemberRemoval)
        // =========================================================================
        
        /**
         * Nettoie les TimeEntries mutables d'un membre retiré
         * PHASE A.7 : Délégué à commitMemberRemoval pour approche transactionnelle
         * PHASE A.2 : includeLegacy = true pour inclure les TimeEntries legacy
         * @param {number} taskId - ID de la tâche
         * @param {number} memberId - ID du membre
         * @param {number} assignmentId - ID de l'affectation désactivée
         * @returns {Promise<{ok: boolean, deletedCount?: number, code?: string}>}
         */
        async function cleanMemberTimeEntries(taskId, memberId, assignmentId) {
            // PHASE A.7, A.2 : Délégué à commitMemberRemoval avec includeLegacy = true
            var result = await commitMemberRemoval(taskId, memberId, assignmentId, true);
            return result;
        }

        // =========================================================================
        // Fonction pure de mapping
        // =========================================================================

        /**
         * Construit les affectations désirées depuis les données du formulaire Gantt
         * Fonction PURE de mapping - ne décide PAS si une synchronisation est nécessaire
         * @param {Object} task - La tâche (avec id, dateDebut, dateEcheance)
         * @param {Object} editData - Données du formulaire (assignees, charges, distributionMode)
         * @param {Object} [options] - Options supplémentaires
         * @param {Object} [context] - Contexte avec existingAssignments pour préserver le mode
         * @returns {Array} Tableau d'affectations normalisées
         */
        function buildDesiredAssignments(task, editData, options, context) {
            if (!task || !editData) return [];

            options = options || {};
            context = context || {};

            // Normaliser les données d'entrée
            var assigneeIds = normalizeAssigneeIds(editData.assignees);
            var charges = normalizeCharges(editData.charges);
            
            // PHASE B — Mode de répartition
            // Priorité :
            // 1. distributionMode depuis editData (si l'interface l'envoie explicitement)
            // 2. modeRepartition depuis editData (fallback legacy)
            // 3. null si pas de mode explicite (pour préserver le mode existant)
            var explicitMode = editData.distributionMode || editData.modeRepartition || null;
            
            var assignments = [];

            // Pour chaque assigné, créer une affectation si une charge est définie
            assigneeIds.forEach(function(memberId) {
                // Trouver la charge pour ce membre
                var chargeEntry = charges.find(function(c) { return c.teamId === memberId; });
                var allocatedHours = chargeEntry ? chargeEntry.heures : 0;

                // Règle : ne créer une affectation que si la charge est strictement positive
                if (allocatedHours > 0) {
                    // PHASE B.11, B.12, B.13 : Préserver le mode existant si pas de mode explicite
                    var finalMode = null;
                    
                    if (explicitMode) {
                        // Mode explicite envoyé par l'interface → l'utiliser
                        finalMode = explicitMode;
                    } else if (context.existingAssignments) {
                        // Pas de mode explicite → préserver le mode existant
                        var existingAssignment = context.existingAssignments.find(function(a) {
                            return a.membre === memberId && a.actif !== false;
                        });
                        
                        if (existingAssignment && existingAssignment.modeRepartition) {
                            finalMode = existingAssignment.modeRepartition;
                        }
                    }
                    
                    // Fallback à 'uniforme' si aucun mode déterminé
                    if (!finalMode) {
                        finalMode = 'uniforme';
                    }
                    
                    assignments.push({
                        memberId: memberId,
                        allocatedHours: allocatedHours,
                        startDate: task.dateDebut || null,
                        endDate: task.dateEcheance || null,
                        distributionMode: finalMode,
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
                            // Retourner un résultat structuré même en cas d'erreur
                            planningResult = {
                                success: false,
                                code: 'AUTO_PLANNING_ERROR',
                                failedMemberIds: activeAssignments.map(function(a) { return Number(a.membre); }),
                                blockedMemberIds: [],
                                members: [],
                                summary: {
                                    committed: 0,
                                    blocked: 0,
                                    failed: activeAssignments.length,
                                    alreadyConformant: 0
                                }
                            };
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
                        
                        // PHASE A.11 : Charger les affectations existantes pour le précontrôle
                        var existingAssignments = await assignmentService.loadAssignmentsForTask(taskId);
                        
                        var desiredAssignments = buildDesiredAssignments(taskData, editData, { assignmentsEdited: true }, {
                            existingAssignments: existingAssignments
                        });

                        // PHASE A.1 : Précontrôle AVANT toute synchronisation
                        var precheckResult = await precheckMemberRemovals(taskId, existingAssignments, desiredAssignments);
                        
                        if (!precheckResult.ok) {
                            // PHASE A.2, A.9 : Blocage complet, zéro écriture
                            log('Précontrôle échoué, blocage complet : ' + precheckResult.code);
                            return {
                                ok: false,
                                code: precheckResult.code,
                                message: 'Retrait de membre bloqué par des temps protégés',
                                details: precheckResult.details,
                                membersBlocked: precheckResult.membersBlocked
                            };
                        }

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
                        
                        // PHASE A.2 : Nettoyer les TimeEntries des membres retirés
                        if (result.deactivatedIds && result.deactivatedIds.length > 0) {
                            log('Membres désactivés : ' + result.deactivatedIds.length + ', nettoyage des TimeEntries');
                            
                            // Charger les affectations pour connaître les memberIds désactivés
                            var allAssignments = await assignmentService.loadAssignmentsForTask(taskId);
                            var cleanupFailures = [];
                            
                            for (var i = 0; i < result.deactivatedIds.length; i++) {
                                var deactivatedId = result.deactivatedIds[i];
                                var deactivatedAssignment = allAssignments.find(function(a) { return a.id === deactivatedId; });
                                
                                if (deactivatedAssignment) {
                                    log('Nettoyage pour membre ' + deactivatedAssignment.membre);
                                    
                                    // PHASE A.7, A.8 : Nettoyer par assignmentId exact et vérifier
                                    var cleanupResult = await cleanMemberTimeEntries(
                                        taskId,
                                        deactivatedAssignment.membre,
                                        deactivatedId
                                    );
                                    
                                    if (!cleanupResult.ok) {
                                        // PHASE A.9 : Retourner l'échec
                                        log('Échec nettoyage : ' + cleanupResult.code);
                                        cleanupFailures.push({
                                            memberId: deactivatedAssignment.membre,
                                            assignmentId: deactivatedId,
                                            code: cleanupResult.code,
                                            remaining: cleanupResult.remainingMutable
                                        });
                                    }
                                }
                            }
                            
                            if (cleanupFailures.length > 0) {
                                return {
                                    ok: false,
                                    code: 'MEMBER_CLEANUP_FAILED',
                                    message: 'Nettoyage partiellement échoué',
                                    failures: cleanupFailures,
                                    partialSuccess: true
                                };
                            }
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
         * Retire un membre d'une tâche avec nettoyage des TimeEntries mutables
         * PHASE A - Gestion transactionnelle du cycle de vie
         * @param {number} taskId - ID de la tâche
         * @param {number} memberId - ID du membre à retirer
         * @param {Object} options - Options
         * @returns {Promise<Object>} Résultat du retrait
         */
        /**
         * Retire un membre d'une tâche avec nettoyage transactionnel
         * PHASE A.7 : Délégué à commitMemberRemoval
         * @param {number} taskId - ID de la tâche
         * @param {number} memberId - ID du membre
         * @param {Object} options - Options (skipDeactivation, assignmentAlreadyDeactivated)
         * @returns {Promise<{ok: boolean, code?: string, deletedCount?: number}>}
         */
        async function removeMemberFromTask(taskId, memberId, options) {
            options = options || {};
            var skipDeactivation = options.skipDeactivation === true;
            var assignmentAlreadyDeactivated = options.assignmentAlreadyDeactivated === true;
            
            // 1. Charger l'affectation active
            var assignmentsTable = await grist.docApi.fetchTable('TaskAssignments');
            var targetAssignment = null;
            
            if (assignmentsTable.id) {
                for (var i = 0; i < assignmentsTable.id.length; i++) {
                    if (assignmentsTable.tache[i] === taskId && assignmentsTable.membre[i] === memberId) {
                        if (assignmentAlreadyDeactivated || assignmentsTable.actif[i] !== false) {
                            targetAssignment = {
                                id: assignmentsTable.id[i],
                                tache: assignmentsTable.tache[i],
                                membre: assignmentsTable.membre[i],
                                actif: assignmentsTable.actif[i] !== false
                            };
                            break;
                        }
                    }
                }
            }
            
            if (!targetAssignment) {
                return { ok: true, code: 'NO_ACTIVE_ASSIGNMENT' };
            }
            
            // PHASE A.7 : Délégué à commitMemberRemoval
            // includeLegacy = true pour gérer aussi les TimeEntries legacy
            // deactivateAssignment = false si skipDeactivation ou déjà désactivé
            var deactivateAssignment = !skipDeactivation && !assignmentAlreadyDeactivated;
            var result = await commitMemberRemoval(taskId, memberId, targetAssignment.id, true, deactivateAssignment);
            
            if (!result.ok) {
                return result;
            }
            
            // Si on a désactivé, vérifier la postcondition
            if (deactivateAssignment) {
                var checkTable = await grist.docApi.fetchTable('TaskAssignments');
                var stillActive = false;
                
                if (checkTable.id) {
                    for (var j = 0; j < checkTable.id.length; j++) {
                        if (checkTable.tache[j] === taskId && 
                            checkTable.membre[j] === memberId &&
                            checkTable.actif[j] !== false) {
                            stillActive = true;
                            break;
                        }
                    }
                }
                
                if (stillActive) {
                    return {
                        ok: false,
                        code: 'REMOVE_MEMBER_POSTCONDITION_FAILED',
                        message: 'L\'affectation est toujours active après le retrait'
                    };
                }
            }
            
            return {
                ok: true,
                deletedCount: result.deletedCount,
                assignmentId: targetAssignment.id
            };
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
                
                // 3. PHASE A.8 : Charger les TimeEntries et les feuilles, puis classifier
                var timeEntriesTable = await grist.docApi.fetchTable('TimeEntries');
                var sheetsById = await loadSheetsMap();
                var mutableTimeEntryIds = [];
                var lockedTimeEntryIds = [];
                var conflictEntryIds = [];
                
                if (timeEntriesTable.id) {
                    for (var m = 0; m < timeEntriesTable.id.length; m++) {
                        var tacheId = timeEntriesTable.tache ? timeEntriesTable.tache[m] : null;
                        var membreId = timeEntriesTable.membre ? timeEntriesTable.membre[m] : null;
                        var affectationId = timeEntriesTable.affectation ? timeEntriesTable.affectation[m] : null;
                        
                        // Vérifier si ce TimeEntry est lié à une affectation qu'on va supprimer
                        var linkedAssignment = null;
                        
                        if (affectationId != null && affectationId !== 0) {
                            linkedAssignment = allAssignments.find(function(a) { return a.id === affectationId; });
                        } else {
                            // TimeEntry legacy : chercher par tache + membre
                            linkedAssignment = allAssignments.find(function(a) {
                                return a.tache === tacheId && a.membre === membreId;
                            });
                        }
                        
                        if (linkedAssignment) {
                            var entry = {
                                id: timeEntriesTable.id[m],
                                heures: (timeEntriesTable.heures && timeEntriesTable.heures[m] !== undefined) ? timeEntriesTable.heures[m] : null,
                                feuille: (timeEntriesTable.feuille && timeEntriesTable.feuille[m] !== undefined) ? timeEntriesTable.feuille[m] : null,
                                affectation: affectationId,
                                tache: tacheId,
                                membre: membreId,
                                description: timeEntriesTable.description ? timeEntriesTable.description[m] : null,
                                imputation: timeEntriesTable.imputation ? timeEntriesTable.imputation[m] : null
                            };
                            
                            // PHASE A.3 : Classification centralisée
                            var classification = classifyTimeEntry(entry, sheetsById, { allowLegacy: true });
                            
                            if (classification.status === 'MUTABLE') {
                                mutableTimeEntryIds.push(entry.id);
                            } else if (classification.status === 'PROTECTED') {
                                lockedTimeEntryIds.push(entry.id);
                            } else if (classification.status === 'CONFLICT') {
                                conflictEntryIds.push({ id: entry.id, reason: classification.reason });
                            }
                        }
                    }
                }
                
                // PHASE A.5 : Conflits → blocage fail-closed
                if (conflictEntryIds.length > 0) {
                    console.warn('[TaskAssignment lifecycle]', {
                        phase: 'delete-conflict',
                        taskIds: taskIds,
                        conflictEntryIds: conflictEntryIds
                    });
                    
                    return {
                        ok: false,
                        code: 'TASK_DELETE_CONFLICT',
                        taskIds: taskIds,
                        assignmentIds: assignmentIds,
                        conflicts: conflictEntryIds
                    };
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
                        log('Résultat complet : ' + JSON.stringify(result.planningResult));
                    }
                } catch (error) {
                    log('Erreur planification automatique après dates : ' + error.message);
                    result.planningResult = {
                        success: false,
                        code: 'AUTO_PLANNING_ERROR',
                        failedMemberIds: [],
                        blockedMemberIds: [],
                        members: [],
                        summary: {
                            committed: 0,
                            blocked: 0,
                            failed: 0,
                            alreadyConformant: 0
                        }
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
            removeMemberFromTask: removeMemberFromTask,
            isAvailable: function() { return assignmentService !== null; },
            // Helpers exportés pour tests
            _helpers: {
                normalizeAssigneeIds: normalizeAssigneeIds,
                normalizeCharges: normalizeCharges
            }
        };
    }

    // Export pour le navigateur
    global.createGanttAssignmentIntegration = createGanttAssignmentIntegration;

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));

// Export CommonJS pour tests
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createGanttAssignmentIntegration: globalThis.createGanttAssignmentIntegration
    };
}
