/* ============================================================================
 * task-assignment-service.js — Service central des affectations
 * ----------------------------------------------------------------------------
 * Source de vérité métier pour les affectations d'une personne à une tâche.
 * 
 * API publique :
 *   createTaskAssignmentService(grist, options)
 *     → retourne un service avec :
 *       - loadAssignmentsForTask(taskId)
 *       - syncTaskAssignments(taskId, desiredAssignments, options)
 *       - deriveLegacyTaskFields(taskId)
 *       - validateDesiredAssignments(taskId, desiredAssignments)
 *       - assignmentsToLegacyCharges(assignments)
 *       - previewLegacyChargesMigration()
 *       - commitLegacyChargesMigration(preview)
 * ============================================================================ */

(function (global) {
    'use strict';

    // =========================================================================
    // Constantes métier
    // =========================================================================
    var DISTRIBUTION_MODES = {
        UNIFORME: 'uniforme',
        PERSONNALISE: 'personnalise'
    };

    var DEFAULT_DISTRIBUTION_MODE = DISTRIBUTION_MODES.UNIFORME;

    // =========================================================================
    // Helpers de date
    // =========================================================================
    
    /**
     * Normalise une date en timestamp Unix (secondes)
     * Accepte : timestamp secondes, timestamp millisecondes, Date, ISO string
     */
    function normalizeDate(dateInput) {
        if (dateInput == null) return null;
        
        // Déjà un timestamp (nombre)
        if (typeof dateInput === 'number') {
            // Si > 10^12, c'est probablement en millisecondes
            if (dateInput > 1e12) {
                return Math.floor(dateInput / 1000);
            }
            return Math.floor(dateInput);
        }
        
        // Objet Date
        if (dateInput instanceof Date) {
            return Math.floor(dateInput.getTime() / 1000);
        }
        
        // String ISO ou autre
        if (typeof dateInput === 'string') {
            var d = new Date(dateInput);
            if (!isNaN(d.getTime())) {
                return Math.floor(d.getTime() / 1000);
            }
        }
        
        return null;
    }

    /**
     * Convertit un timestamp Unix (secondes) en objet Date
     */
    function timestampToDate(timestamp) {
        if (timestamp == null) return null;
        return new Date(timestamp * 1000);
    }

    /**
     * Vérifie si une valeur est un ID Grist valide
     */
    function isValidGristId(id) {
        if (id == null) return false;
        if (typeof id === 'number') return id > 0 && Number.isInteger(id);
        if (typeof id === 'string') {
            var num = parseInt(id, 10);
            return !isNaN(num) && num > 0;
        }
        return false;
    }

    // =========================================================================
    // Validation métier
    // =========================================================================

    /**
     * Valide une affectation individuelle
     * @param {Object} assignment - Affectation à valider
     * @param {Object} context - Contexte de validation (taskId, existingAssignments, etc.)
     * @returns {Object} { valid: boolean, errors: string[], warnings: string[] }
     */
    function validateAssignment(assignment, context) {
        var result = { valid: true, errors: [], warnings: [] };

        // memberId
        if (!isValidGristId(assignment.memberId)) {
            result.errors.push('memberId invalide : ' + JSON.stringify(assignment.memberId));
            result.valid = false;
        }

        // allocatedHours
        if (assignment.allocatedHours == null || typeof assignment.allocatedHours !== 'number') {
            result.errors.push('heuresAllouees doit être un nombre valide');
            result.valid = false;
        } else if (!isFinite(assignment.allocatedHours)) {
            result.errors.push('heuresAllouees doit être fini');
            result.valid = false;
        } else if (assignment.allocatedHours < 0) {
            result.errors.push('heuresAllouees ne peut pas être négatif');
            result.valid = false;
        }

        // startDate
        if (assignment.startDate == null) {
            result.errors.push('dateDebut est requise');
            result.valid = false;
        }

        // endDate
        if (assignment.endDate == null) {
            result.errors.push('dateFin est requise');
            result.valid = false;
        }

        // endDate >= startDate
        if (assignment.startDate != null && assignment.endDate != null) {
            if (assignment.endDate < assignment.startDate) {
                result.errors.push('dateFin doit être >= dateDebut');
                result.valid = false;
            }
        }

        // distributionMode
        if (assignment.distributionMode != null && 
            !Object.values(DISTRIBUTION_MODES).includes(assignment.distributionMode)) {
            result.warnings.push('modeRepartition inconnu : ' + assignment.distributionMode + 
                               ', utilisation de la valeur par défaut : ' + DEFAULT_DISTRIBUTION_MODE);
        }

        // Unicité : vérifier les véritables doublons (plusieurs lignes actives pour même membre)
        // Une ligne existante pour le même membre n'est PAS un doublon bloquant, c'est la ligne à mettre à jour
        if (context && context.existingAssignments) {
            var activeForSameMember = context.existingAssignments.filter(function(a) {
                return a.membre === assignment.memberId && 
                       a.actif !== false;
            });
            // Conflit uniquement s'il y a PLUSIEURS lignes actives pour le même membre
            if (activeForSameMember.length > 1) {
                result.errors.push('Plusieurs affectations actives pour le membre ' + assignment.memberId + ' (conflit de doublons)');
                result.valid = false;
            }
        }

        return result;
    }

    /**
     * Valide une liste d'affectations désirées
     * @param {number} taskId - ID de la tâche
     * @param {Array} desiredAssignments - Liste des affectations désirées
     * @param {Object} gristContext - Contexte Grist (existingAssignments, tasks, members)
     * @returns {Object} { valid: boolean, errors: string[], warnings: string[] }
     */
    function validateDesiredAssignments(taskId, desiredAssignments, gristContext) {
        var result = { valid: true, errors: [], warnings: [] };

        // taskId
        if (!isValidGristId(taskId)) {
            result.errors.push('taskId invalide : ' + JSON.stringify(taskId));
            result.valid = false;
            return result;
        }

        // Vérifier que la tâche existe
        if (gristContext && gristContext.tasks) {
            var taskExists = gristContext.tasks.some(function(t) { return t.id === taskId; });
            if (!taskExists) {
                result.errors.push('La tâche ' + taskId + ' n\'existe pas');
                result.valid = false;
            }
        }

        // Vérifier les doublons dans l'entrée elle-même
        var memberIds = (desiredAssignments || []).map(function(a) { return a.memberId; });
        var uniqueMemberIds = new Set(memberIds);
        if (uniqueMemberIds.size !== memberIds.length) {
            result.errors.push('Doublons détectés dans les affectations désirées (même membre plusieurs fois)');
            result.valid = false;
        }

        // Valider chaque affectation individuellement
        var context = {
            existingAssignments: (gristContext && gristContext.existingAssignments) || [],
            taskId: taskId
        };

        (desiredAssignments || []).forEach(function(assignment, index) {
            var validation = validateAssignment(assignment, context);
            if (!validation.valid) {
                result.valid = false;
                validation.errors.forEach(function(err) {
                    result.errors.push('Affectation ' + index + ' : ' + err);
                });
            }
            result.warnings = result.warnings.concat(validation.warnings);
        });

        // Vérifier que les membres existent
        if (gristContext && gristContext.members) {
            (desiredAssignments || []).forEach(function(assignment, index) {
                if (isValidGristId(assignment.memberId)) {
                    var memberExists = gristContext.members.some(function(m) { return m.id === assignment.memberId; });
                    if (!memberExists) {
                        result.errors.push('Affectation ' + index + ' : le membre ' + assignment.memberId + ' n\'existe pas');
                        result.valid = false;
                    }
                }
            });
        }

        return result;
    }

    // =========================================================================
    // Calcul du diff (fonction pure)
    // =========================================================================

    /**
     * Calcule le diff entre les affectations existantes et désirées
     * @param {Array} existingAssignments - Affectations existantes (depuis Grist)
     * @param {Array} desiredAssignments - Affectations désirées (normalisées)
     * @returns {Object} { creates, updates, deactivations, unchanged, conflicts, warnings }
     */
    function calculateDiff(existingAssignments, desiredAssignments) {
        var result = {
            creates: [],
            updates: [],
            deactivations: [],
            unchanged: [],
            conflicts: [],
            warnings: []
        };

        // Indexer les affectations existantes par memberId (uniquement les actives)
        var existingByMember = {};
        (existingAssignments || []).forEach(function(a) {
            if (a.actif !== false) {
                if (existingByMember[a.membre]) {
                    // Conflit : plusieurs affectations actives pour le même membre
                    result.conflicts.push({
                        memberId: a.membre,
                        assignmentIds: existingByMember[a.membre].concat([a.id]),
                        message: 'Plusieurs affectations actives pour le membre ' + a.membre
                    });
                    existingByMember[a.membre].push(a.id);
                } else {
                    existingByMember[a.membre] = [a.id];
                }
            }
        });

        // Traiter les affectations désirées
        var desiredByMember = {};
        (desiredAssignments || []).forEach(function(desired) {
            var memberId = desired.memberId;
            var existing = existingByMember[memberId] ? 
                existingAssignments.find(function(a) { 
                    return a.membre === memberId && a.actif !== false; 
                }) : null;

            if (!existing) {
                // Création
                result.creates.push(desired);
            } else {
                // Vérifier si changement
                var hasChanges = 
                    Math.abs((desired.allocatedHours || 0) - (existing.heuresAllouees || 0)) > 0.001 ||
                    (desired.startDate || 0) !== (existing.dateDebut || 0) ||
                    (desired.endDate || 0) !== (existing.dateFin || 0) ||
                    (desired.distributionMode || DEFAULT_DISTRIBUTION_MODE) !== (existing.modeRepartition || DEFAULT_DISTRIBUTION_MODE) ||
                    (desired.active !== undefined && desired.active !== existing.actif) ||
                    (desired.comment || '') !== (existing.commentaire || '');

                if (hasChanges) {
                    result.updates.push(Object.assign({}, desired, { id: existing.id }));
                } else {
                    result.unchanged.push(existing.id);
                }
            }

            desiredByMember[memberId] = true;
        });

        // Désactiver les membres qui ne sont plus dans desiredAssignments
        (existingAssignments || []).forEach(function(existing) {
            if (existing.actif !== false && !desiredByMember[existing.membre]) {
                result.deactivations.push({
                    id: existing.id,
                    membre: existing.membre,
                    message: 'Membre retiré de la tâche'
                });
            }
        });

        return result;
    }

    // =========================================================================
    // Projections legacy
    // =========================================================================

    /**
     * Convertit des affectations en format legacy Tasks.charges
     * @param {Array} assignments - Affectations (avec actif=true uniquement)
     * @returns {string} JSON string
     */
    function assignmentsToLegacyCharges(assignments) {
        var charges = (assignments || [])
            .filter(function(a) { return a.actif !== false; })
            .map(function(a) {
                return {
                    teamId: a.membre,
                    heures: a.heuresAllouees || 0
                };
            });

        // Supprimer les doublons et trier par teamId
        var byTeamId = {};
        charges.forEach(function(c) {
            if (!byTeamId[c.teamId]) {
                byTeamId[c.teamId] = c;
            } else {
                // Fusionner les heures en cas de doublon (ne devrait pas arriver)
                byTeamId[c.teamId].heures += c.heures;
            }
        });

        var result = Object.values(byTeamId);
        result.sort(function(a, b) { return (a.teamId || 0) - (b.teamId || 0); });

        return JSON.stringify(result);
    }

    /**
     * Convertit des affectations en format legacy Tasks.assignees
     * @param {Array} assignments - Affectations (avec actif=true uniquement)
     * @returns {Array} Liste des memberIds
     */
    function assignmentsToLegacyAssignees(assignments) {
        var memberIds = (assignments || [])
            .filter(function(a) { return a.actif !== false; })
            .map(function(a) { return a.membre; });

        // Supprimer les doublons et trier
        var unique = [];
        var seen = {};
        memberIds.forEach(function(id) {
            if (!seen[id]) {
                seen[id] = true;
                unique.push(id);
            }
        });
        unique.sort(function(a, b) { return (a || 0) - (b || 0); });

        return unique;
    }

    /**
     * Convertit un tableau d'IDs en format RefList Grist
     * @param {Array} ids - IDs numériques
     * @returns {Array} Format Grist ['L', id1, id2, ...]
     */
    function toGristRefList(ids) {
        return ['L'].concat(ids || []);
    }

    // =========================================================================
    // Service principal
    // =========================================================================

    /**
     * Crée une instance du service TaskAssignments
     * @param {Object} grist - Grist API instance
     * @param {Object} options - Options de configuration
     * @returns {Object} Service API
     */
    function createTaskAssignmentService(grist, options) {
        options = options || {};
        var logEnabled = options.logEnabled || false;

        function log(message) {
            if (logEnabled && typeof console !== 'undefined') {
                console.log('[TaskAssignmentService]', message);
            }
        }

        /**
         * Charge les affectations pour une tâche donnée
         * @param {number} taskId - ID de la tâche
         * @returns {Promise<Array>} Liste des affectations
         */
        async function loadAssignmentsForTask(taskId) {
            if (!grist || !grist.docApi) {
                throw new Error('Grist API non disponible');
            }

            try {
                var table = await grist.docApi.fetchTable('TaskAssignments');
                var assignments = [];
                
                // table est un objet avec des colonnes, on doit le convertir en tableau
                var rowCount = table.id ? table.id.length : 0;
                for (var i = 0; i < rowCount; i++) {
                    if (table.tache && table.tache[i] === taskId) {
                        assignments.push({
                            id: table.id ? table.id[i] : null,
                            tache: table.tache ? table.tache[i] : null,
                            membre: table.membre ? table.membre[i] : null,
                            heuresAllouees: table.heuresAllouees ? table.heuresAllouees[i] : 0,
                            dateDebut: table.dateDebut ? table.dateDebut[i] : null,
                            dateFin: table.dateFin ? table.dateFin[i] : null,
                            modeRepartition: table.modeRepartition ? table.modeRepartition[i] : DEFAULT_DISTRIBUTION_MODE,
                            actif: table.actif ? table.actif[i] : true,
                            commentaire: table.commentaire ? table.commentaire[i] : ''
                        });
                    }
                }

                return assignments;
            } catch (e) {
                log('Erreur lors du chargement des affectations : ' + e.message);
                throw e;
            }
        }

        /**
         * Synchronise les affectations d'une tâche avec les affectations désirées
         * @param {number} taskId - ID de la tâche
         * @param {Array} desiredAssignments - Affectations désirées (format normalisé)
         * @param {Object} syncOptions - Options de synchronisation
         * @returns {Promise<Object>} Résultat de la synchronisation
         */
        async function syncTaskAssignments(taskId, desiredAssignments, syncOptions) {
            syncOptions = syncOptions || {};
            
            if (!grist || !grist.docApi) {
                return {
                    ok: false,
                    code: 'GRIST_NOT_AVAILABLE',
                    message: 'Grist API non disponible'
                };
            }

            try {
                // 1. Charger les affectations existantes et les métadonnées
                var existingAssignments = await loadAssignmentsForTask(taskId);
                log('Affectations existantes pour la tâche ' + taskId + ' : ' + existingAssignments.length);

                // Charger les métadonnées pour validation
                var tasksTable = await grist.docApi.fetchTable('Tasks');
                var teamTable = await grist.docApi.fetchTable('Team');
                
                var gristContext = {
                    existingAssignments: existingAssignments,
                    tasks: tasksTable.id ? tasksTable.id.map(function(id, i) { 
                        return { id: id, titre: tasksTable.titre ? tasksTable.titre[i] : '' }; 
                    }) : [],
                    members: teamTable.id ? teamTable.id.map(function(id, i) {
                        return { id: id, nom: teamTable.nom ? teamTable.nom[i] : '' };
                    }) : []
                };

                // 2. Valider les affectations désirées AVANT toute normalisation
                var validation = validateDesiredAssignments(taskId, desiredAssignments, gristContext);
                if (!validation.valid) {
                    return {
                        ok: false,
                        code: 'VALIDATION_ERROR',
                        message: 'Validation échouée',
                        details: validation.errors,
                        errors: validation.errors,
                        warnings: validation.warnings
                    };
                }

                // 3. Normaliser les affectations désirées (seulement si validation OK)
                var normalized = (desiredAssignments || []).map(function(a) {
                    var allocatedHours = typeof a.allocatedHours === 'number' ? a.allocatedHours : 
                                        (typeof a.heuresAllouees === 'number' ? a.heuresAllouees : null);
                    
                    // Interdire les conversions silencieuses en zéro
                    if (allocatedHours === null || !isFinite(allocatedHours) || allocatedHours < 0) {
                        throw new Error('heuresAllouees invalide : ' + JSON.stringify(a.allocatedHours || a.heuresAllouees));
                    }
                    
                    return {
                        memberId: a.memberId,
                        allocatedHours: allocatedHours,
                        startDate: normalizeDate(a.startDate || a.dateDebut),
                        endDate: normalizeDate(a.endDate || a.dateFin),
                        distributionMode: a.distributionMode || a.modeRepartition || DEFAULT_DISTRIBUTION_MODE,
                        active: a.active !== undefined ? a.active : (a.actif !== undefined ? a.actif : true),
                        comment: a.comment || a.commentaire || ''
                    };
                });

                // 4. Calculer le diff
                var diff = calculateDiff(existingAssignments, normalized);
                log('Diff calculé : ' + JSON.stringify({
                    creates: diff.creates.length,
                    updates: diff.updates.length,
                    deactivations: diff.deactivations.length,
                    unchanged: diff.unchanged.length,
                    conflicts: diff.conflicts.length
                }));

                // 5. Vérifier les conflits bloquants
                if (diff.conflicts.length > 0 && !syncOptions.ignoreConflicts) {
                    return {
                        ok: false,
                        code: 'CONFLICT_DETECTED',
                        message: 'Conflits détectés (doublons actifs)',
                        details: diff.conflicts,
                        conflicts: diff.conflicts
                    };
                }

                // 6. Construire les actions Grist
                var actions = [];
                var createdIds = [];
                var updatedIds = [];
                var deactivatedIds = [];

                // Créations
                diff.creates.forEach(function(a) {
                    var record = {
                        tache: taskId,
                        membre: a.memberId,
                        heuresAllouees: a.allocatedHours,
                        dateDebut: a.startDate,
                        dateFin: a.endDate,
                        modeRepartition: a.distributionMode,
                        actif: a.active,
                        commentaire: a.comment
                    };
                    actions.push(['AddRecord', 'TaskAssignments', null, record]);
                    // Note: On ne peut pas connaître l'ID avant l'exécution, on le mettra à jour après
                });

                // Mises à jour
                diff.updates.forEach(function(a) {
                    var record = {
                        membre: a.memberId,
                        heuresAllouees: a.allocatedHours,
                        dateDebut: a.startDate,
                        dateFin: a.endDate,
                        modeRepartition: a.distributionMode,
                        actif: a.active,
                        commentaire: a.comment
                    };
                    actions.push(['UpdateRecord', 'TaskAssignments', a.id, record]);
                    updatedIds.push(a.id);
                });

                // Désactivations
                diff.deactivations.forEach(function(a) {
                    actions.push(['UpdateRecord', 'TaskAssignments', a.id, { actif: false }]);
                    deactivatedIds.push(a.id);
                });

                // 7. Exécuter les actions et capturer les IDs créés
                if (actions.length > 0) {
                    var actionResults = await grist.docApi.applyUserActions(actions);
                    log('Actions exécutées : ' + actions.length);
                    
                    // Capturer les IDs créés (les AddRecord retournent les nouveaux IDs)
                    // Format Grist : { retValues: [ID1, ID2, ...] }
                    var retValues = actionResults && actionResults.retValues ? actionResults.retValues : actionResults;
                    if (!Array.isArray(retValues)) {
                        retValues = [];
                    }
                    
                    var createdIndex = 0;
                    actions.forEach(function(action, index) {
                        if (action[0] === 'AddRecord' && action[1] === 'TaskAssignments') {
                            if (retValues[index] != null && Number.isInteger(retValues[index]) && retValues[index] > 0) {
                                createdIds.push(retValues[index]);
                            }
                        }
                    });
                }

                // 8. Mettre à jour les champs legacy (seulement si changement)
                var legacyActionsCount = 0;
                if (syncOptions.updateLegacy !== false) {
                    var legacyResult = await deriveLegacyTaskFields(taskId);
                    if (!legacyResult.ok) {
                        log('Erreur mise à jour legacy : ' + legacyResult.message);
                        // Continuer mais signaler l'erreur
                        return {
                            ok: false,
                            code: 'LEGACY_SYNC_PARTIAL',
                            message: 'TaskAssignments synchronisés mais échec mise à jour Tasks',
                            details: legacyResult.message,
                            taskId: taskId,
                            createdIds: createdIds,
                            updatedIds: updatedIds,
                            deactivatedIds: deactivatedIds,
                            unchangedIds: diff.unchanged,
                            warnings: diff.warnings,
                            conflicts: diff.conflicts,
                            actionsExecuted: actions.length
                        };
                    }
                    legacyActionsCount = legacyResult.actionsExecuted || 0;
                }

                // 9. Retourner le résultat avec le compteur total
                return {
                    ok: true,
                    taskId: taskId,
                    createdIds: createdIds,
                    updatedIds: updatedIds,
                    deactivatedIds: deactivatedIds,
                    unchangedIds: diff.unchanged,
                    warnings: diff.warnings,
                    conflicts: diff.conflicts,
                    actionsExecuted: actions.length + legacyActionsCount
                };

            } catch (e) {
                log('Erreur lors de la synchronisation : ' + e.message);
                return {
                    ok: false,
                    code: 'SYNC_ERROR',
                    message: e.message,
                    details: e.stack
                };
            }
        }

        /**
         * Met à jour les champs legacy Tasks.assignees et Tasks.charges
         * à partir des TaskAssignments
         * @param {number} taskId - ID de la tâche
         * @returns {Promise<Object>} Résultat avec actionsExecuted
         */
        async function deriveLegacyTaskFields(taskId) {
            if (!grist || !grist.docApi) {
                return { ok: false, code: 'GRIST_NOT_AVAILABLE', actionsExecuted: 0 };
            }

            try {
                var assignments = await loadAssignmentsForTask(taskId);
                var assignees = assignmentsToLegacyAssignees(assignments);
                var charges = assignmentsToLegacyCharges(assignments);

                // Charger l'état actuel de la tâche pour éviter les écritures inutiles
                var tasksTable = await grist.docApi.fetchTable('Tasks');
                var currentTask = null;
                var taskIndex = -1;
                
                if (tasksTable.id) {
                    for (var i = 0; i < tasksTable.id.length; i++) {
                        if (tasksTable.id[i] === taskId) {
                            taskIndex = i;
                            break;
                        }
                    }
                }
                
                if (taskIndex >= 0) {
                    var currentAssignees = tasksTable.assignees ? tasksTable.assignees[taskIndex] : [];
                    var currentCharges = tasksTable.charges ? tasksTable.charges[taskIndex] : null;
                    
                    // Normaliser currentAssignees pour la comparaison (enlever le 'L' de Grist)
                    var normalizedCurrentAssignees = [];
                    if (Array.isArray(currentAssignees)) {
                        normalizedCurrentAssignees = currentAssignees
                            .filter(function(v) { return v !== 'L'; })
                            .map(function(v) { return Number(v); })
                            .filter(function(v) { return Number.isInteger(v) && v > 0; })
                            .sort(function(a, b) { return a - b; });
                    }
                    
                    // Vérifier si la valeur actuelle est invalide (#KeyError ou autre erreur)
                    var isCurrentAssigneesInvalid = false;
                    if (currentAssignees && typeof currentAssignees === 'string' && currentAssignees.indexOf('#KeyError') >= 0) {
                        isCurrentAssigneesInvalid = true;
                    }
                    
                    // Comparer pour éviter les écritures inutiles
                    var assigneesEqual = !isCurrentAssigneesInvalid && 
                                         JSON.stringify(normalizedCurrentAssignees) === JSON.stringify(assignees);
                    var chargesEqual = (currentCharges || '') === charges;
                    
                    if (assigneesEqual && chargesEqual) {
                        log('Champs legacy inchangés pour la tâche ' + taskId);
                        return { ok: true, assignees: assignees, charges: charges, actionsExecuted: 0 };
                    }
                }

                // Écrire uniquement si changement
                await grist.docApi.applyUserActions([
                    ['UpdateRecord', 'Tasks', taskId, {
                        assignees: toGristRefList(assignees),
                        charges: charges
                    }]
                ]);

                log('Champs legacy mis à jour pour la tâche ' + taskId);
                return { ok: true, assignees: assignees, charges: charges, actionsExecuted: 1 };

            } catch (e) {
                log('Erreur lors de la mise à jour des champs legacy : ' + e.message);
                return {
                    ok: false,
                    code: 'LEGACY_UPDATE_ERROR',
                    message: e.message,
                    actionsExecuted: 0
                };
            }
        }

        /**
         * Prévisualise la migration des données legacy vers TaskAssignments
         * @returns {Promise<Object>} Résultat du dry-run
         */
        async function previewLegacyChargesMigration() {
            if (!grist || !grist.docApi) {
                return {
                    ok: false,
                    code: 'GRIST_NOT_AVAILABLE',
                    message: 'Grist API non disponible'
                };
            }

            var result = {
                tasksScanned: 0,
                assignmentsToCreate: [],
                assignmentsAlreadyPresent: [],
                invalidCharges: [],
                missingMembers: [],
                missingDates: [],
                conflicts: [],
                warnings: []
            };

            try {
                // Charger les tâches
                var tasksTable = await grist.docApi.fetchTable('Tasks');
                var taskCount = tasksTable.id ? tasksTable.id.length : 0;
                result.tasksScanned = taskCount;

                // Charger les affectations existantes
                var assignmentsTable = await grist.docApi.fetchTable('TaskAssignments');
                var existingByTaskMember = {};
                var assignmentCount = assignmentsTable.id ? assignmentsTable.id.length : 0;
                for (var i = 0; i < assignmentCount; i++) {
                    var key = assignmentsTable.tache[i] + ':' + assignmentsTable.membre[i];
                    if (!existingByTaskMember[key]) {
                        existingByTaskMember[key] = [];
                    }
                    existingByTaskMember[key].push({
                        id: assignmentsTable.id[i],
                        heuresAllouees: assignmentsTable.heuresAllouees[i],
                        dateDebut: assignmentsTable.dateDebut[i],
                        dateFin: assignmentsTable.dateFin[i],
                        actif: assignmentsTable.actif[i] !== false
                    });
                }

                // Charger les membres
                var membersTable = await grist.docApi.fetchTable('Team');
                var memberIds = new Set(membersTable.id || []);

                // Traiter chaque tâche
                for (var j = 0; j < taskCount; j++) {
                    var taskId = tasksTable.id[j];
                    var chargesJson = tasksTable.charges ? tasksTable.charges[j] : null;
                    var dateDebut = tasksTable.dateDebut ? tasksTable.dateDebut[j] : null;
                    var dateFin = tasksTable.dateEcheance ? tasksTable.dateEcheance[j] : null;

                    if (!chargesJson) continue;

                    // Parser le JSON
                    var charges;
                    try {
                        charges = typeof chargesJson === 'string' ? JSON.parse(chargesJson) : chargesJson;
                    } catch (e) {
                        result.invalidCharges.push({
                            taskId: taskId,
                            error: 'JSON invalide : ' + e.message
                        });
                        continue;
                    }

                    if (!Array.isArray(charges)) {
                        result.invalidCharges.push({
                            taskId: taskId,
                            error: 'Format attendu : tableau JSON'
                        });
                        continue;
                    }

                    // Vérifier les dates
                    if (dateDebut == null || dateFin == null) {
                        result.missingDates.push({
                            taskId: taskId,
                            dateDebut: dateDebut,
                            dateFin: dateFin
                        });
                    }

                    // Traiter chaque charge
                    for (var k = 0; k < charges.length; k++) {
                        var charge = charges[k];
                        var memberId = charge.teamId;

                        // Vérifier le membre
                        if (!memberIds.has(memberId)) {
                            result.missingMembers.push({
                                taskId: taskId,
                                memberId: memberId
                            });
                            continue;
                        }

                        // Vérifier les heures
                        if (typeof charge.heures !== 'number' || charge.heures < 0 || !isFinite(charge.heures)) {
                            result.invalidCharges.push({
                                taskId: taskId,
                                memberId: memberId,
                                error: 'Heures invalides : ' + charge.heures
                            });
                            continue;
                        }

                        // Vérifier si déjà présent
                        var key = taskId + ':' + memberId;
                        var existing = existingByTaskMember[key];

                        if (existing && existing.length > 0) {
                            // Vérifier si équivalent
                            var equivalent = existing.some(function(e) {
                                return e.actif &&
                                       Math.abs(e.heuresAllouees - charge.heures) < 0.001 &&
                                       e.dateDebut === dateDebut &&
                                       e.dateFin === dateFin;
                            });

                            if (equivalent) {
                                result.assignmentsAlreadyPresent.push({
                                    taskId: taskId,
                                    memberId: memberId
                                });
                            } else {
                                result.conflicts.push({
                                    taskId: taskId,
                                    memberId: memberId,
                                    existing: existing,
                                    desired: charge
                                });
                            }
                        } else {
                            // À créer
                            result.assignmentsToCreate.push({
                                tache: taskId,
                                membre: memberId,
                                heuresAllouees: charge.heures,
                                dateDebut: dateDebut,
                                dateFin: dateFin,
                                modeRepartition: DEFAULT_DISTRIBUTION_MODE,
                                actif: true,
                                commentaire: 'Migration depuis Tasks.charges'
                            });
                        }
                    }
                }

                return result;

            } catch (e) {
                return {
                    ok: false,
                    code: 'PREVIEW_ERROR',
                    message: e.message,
                    details: result
                };
            }
        }

        /**
         * Exécute la migration des données legacy vers TaskAssignments
         * @param {Object} preview - Résultat du dry-run
         * @returns {Promise<Object>} Résultat de la migration
         */
        async function commitLegacyChargesMigration(preview) {
            if (!grist || !grist.docApi) {
                return {
                    ok: false,
                    code: 'GRIST_NOT_AVAILABLE',
                    message: 'Grist API non disponible'
                };
            }

            if (!preview || !preview.assignmentsToCreate) {
                return {
                    ok: false,
                    code: 'INVALID_PREVIEW',
                    message: 'Aperçu invalide'
                };
            }

            try {
                var actions = [];
                var createdCount = 0;

                preview.assignmentsToCreate.forEach(function(a) {
                    actions.push(['AddRecord', 'TaskAssignments', null, a]);
                    createdCount++;
                });

                if (actions.length > 0) {
                    await grist.docApi.applyUserActions(actions);
                }

                return {
                    ok: true,
                    assignmentsCreated: createdCount,
                    tasksScanned: preview.tasksScanned
                };

            } catch (e) {
                return {
                    ok: false,
                    code: 'MIGRATION_ERROR',
                    message: e.message
                };
            }
        }

        // Export public API
        return {
            loadAssignmentsForTask: loadAssignmentsForTask,
            syncTaskAssignments: syncTaskAssignments,
            deriveLegacyTaskFields: deriveLegacyTaskFields,
            validateDesiredAssignments: validateDesiredAssignments,
            assignmentsToLegacyCharges: assignmentsToLegacyCharges,
            assignmentsToLegacyAssignees: assignmentsToLegacyAssignees,
            previewLegacyChargesMigration: previewLegacyChargesMigration,
            commitLegacyChargesMigration: commitLegacyChargesMigration,
            // Helpers exportés pour les tests
            _helpers: {
                normalizeDate: normalizeDate,
                isValidGristId: isValidGristId,
                validateAssignment: validateAssignment,
                calculateDiff: calculateDiff,
                assignmentsToLegacyAssignees: assignmentsToLegacyAssignees,
                toGristRefList: toGristRefList
            }
        };
    }

    // Export
    global.createTaskAssignmentService = createTaskAssignmentService;
    global.TASK_ASSIGNMENT_SERVICE = {
        DISTRIBUTION_MODES: DISTRIBUTION_MODES,
        DEFAULT_DISTRIBUTION_MODE: DEFAULT_DISTRIBUTION_MODE
    };

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
