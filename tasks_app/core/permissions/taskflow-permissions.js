/* ============================================================================
 * taskflow-permissions.js — Autorisations fonctionnelles communes TaskFlow
 * ----------------------------------------------------------------------------
 * Ce module ne pose aucune ACL Grist. Il applique la matrice fonctionnelle des
 * widgets a partir des relations Team / Projects / Tasks / Actions.
 *
 * Le coeur metier est pur et testable. createGristPermissionRuntime est le fin
 * adaptateur charge de lire l'identite Grist et les tables necessaires.
 * ========================================================================== */

(function (global) {
    'use strict';

    var identityDomain = global && global.TaskFlowIdentity;
    var identityRuntimeModule = global && global.TaskFlowIdentityRuntime;
    if (typeof module !== 'undefined' && module.exports) {
        identityDomain = require('../identity/taskflow-identity.js');
        identityRuntimeModule = require('../identity/taskflow-identity-runtime.js');
    }

    var CONTROLLED_TABLES = [
        'Team',
        'Entites',
        'Programmes',
        'Projects',
        'Tasks',
        'Actions',
        'KanbanSteps',
        'Feuilles',
        'TimeEntries'
    ];

    var PERMISSION_DATA_TABLES = CONTROLLED_TABLES.concat(['TaskAssignments']);

    var RECORD_ACTIONS = [
        'AddRecord',
        'UpdateRecord',
        'RemoveRecord',
        'BulkAddRecord',
        'BulkUpdateRecord',
        'BulkRemoveRecord'
    ];

    function normalizeId(value) {
        if (value === null || value === undefined || value === '') return null;
        var numeric = Number(value);
        return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
    }

    function normalizeRefList(value) {
        if (!Array.isArray(value)) return [];
        var values = value[0] === 'L' ? value.slice(1) : value.slice();
        return values.map(normalizeId).filter(function (id) { return id !== null; });
    }

    function columnarToRows(data) {
        if (!data) return [];
        if (Array.isArray(data)) return data.slice();
        var keys = Object.keys(data);
        if (!keys.length) return [];
        var count = Array.isArray(data[keys[0]]) ? data[keys[0]].length : 0;
        var rows = [];
        for (var i = 0; i < count; i++) {
            var row = {};
            for (var j = 0; j < keys.length; j++) row[keys[j]] = data[keys[j]][i];
            rows.push(row);
        }
        return rows;
    }

    function indexById(rows) {
        var index = new Map();
        (rows || []).forEach(function (row) {
            var id = normalizeId(row && row.id);
            if (id !== null) index.set(id, row);
        });
        return index;
    }

    function isTruthy(value) {
        return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
    }

    function duplicateGristUserIds(team) {
        return identityDomain.findDuplicateGristUserIds(team || []);
    }

    function resolveActorIdentity(options) {
        return identityDomain.resolveActorIdentity(options || {});
    }

    function createSnapshot(data, identity) {
        data = data || {};
        return {
            actor: identity || { identified: false, status: 'IDENTITY_NOT_LOADED' },
            tables: {
                Team: (data.Team || data.team || []).slice(),
                Entites: (data.Entites || data.entites || []).slice(),
                Programmes: (data.Programmes || data.programmes || []).slice(),
                Projects: (data.Projects || data.projects || []).slice(),
                Tasks: (data.Tasks || data.tasks || []).slice(),
                Actions: (data.Actions || data.actions || []).slice(),
                KanbanSteps: (data.KanbanSteps || data.kanbanSteps || []).slice(),
                Feuilles: (data.Feuilles || data.feuilles || []).slice(),
                TimeEntries: (data.TimeEntries || data.timeEntries || []).slice(),
                TaskAssignments: (data.TaskAssignments || data.taskAssignments || []).slice()
            },
            indexes: null
        };
    }

    function ensureIndexes(snapshot) {
        if (!snapshot.indexes) {
            snapshot.indexes = {
                Team: indexById(snapshot.tables.Team),
                Entites: indexById(snapshot.tables.Entites),
                Programmes: indexById(snapshot.tables.Programmes),
                Projects: indexById(snapshot.tables.Projects),
                Tasks: indexById(snapshot.tables.Tasks),
                Actions: indexById(snapshot.tables.Actions),
                KanbanSteps: indexById(snapshot.tables.KanbanSteps),
                Feuilles: indexById(snapshot.tables.Feuilles),
                TimeEntries: indexById(snapshot.tables.TimeEntries),
                TaskAssignments: indexById(snapshot.tables.TaskAssignments)
            };
        }
        return snapshot.indexes;
    }

    function allow(code) {
        return { allowed: true, code: code || 'ALLOWED' };
    }

    function deny(code, message, details) {
        return Object.assign({ allowed: false, code: code, message: message }, details || {});
    }

    function actorId(snapshot) {
        return normalizeId(snapshot && snapshot.actor && snapshot.actor.memberId);
    }

    function requireActor(snapshot) {
        if (!snapshot || !snapshot.actor || !snapshot.actor.identified || actorId(snapshot) === null) {
            var status = snapshot && snapshot.actor && snapshot.actor.status;
            return deny(
                status || 'ACTOR_NOT_IDENTIFIED',
                'Votre compte Grist n\'est pas associe de maniere unique a un membre actif de Team.'
            );
        }
        return null;
    }

    function actorIsAdmin(snapshot) {
        return Boolean(snapshot && snapshot.actor && snapshot.actor.identified && snapshot.actor.isAdmin);
    }

    function isProjectOwner(snapshot, project) {
        return Boolean(project) && normalizeId(project.responsable) === actorId(snapshot);
    }

    function isDirectManagerOfMember(snapshot, memberId) {
        var member = ensureIndexes(snapshot).Team.get(normalizeId(memberId));
        return Boolean(member) && normalizeId(member.responsable) === actorId(snapshot);
    }

    function isDirectManagerOfProjectOwner(snapshot, project) {
        return Boolean(project) && isDirectManagerOfMember(snapshot, project.responsable);
    }

    function canManageProject(snapshot, project) {
        return actorIsAdmin(snapshot) || isProjectOwner(snapshot, project) || isDirectManagerOfProjectOwner(snapshot, project);
    }

    function projectForTask(snapshot, task) {
        if (!task) return null;
        return ensureIndexes(snapshot).Projects.get(normalizeId(task.projet)) || null;
    }

    function taskForAction(snapshot, action) {
        if (!action) return null;
        return ensureIndexes(snapshot).Tasks.get(normalizeId(action.task)) || null;
    }

    function isTaskAssignee(snapshot, task) {
        return Boolean(task) && normalizeRefList(task.assignees).indexOf(actorId(snapshot)) !== -1;
    }

    function isActionOwner(snapshot, action) {
        return Boolean(action) && normalizeId(action.assignee) === actorId(snapshot);
    }

    function canSelectTaskForAction(snapshot, task) {
        if (requireActor(snapshot)) return false;
        if (actorIsAdmin(snapshot)) return true;
        var project = projectForTask(snapshot, task);
        return Boolean((project && canManageProject(snapshot, project)) || isTaskAssignee(snapshot, task));
    }

    function listActionTaskCandidates(snapshot) {
        if (requireActor(snapshot)) return [];
        var taskRows = snapshot && snapshot.tables && Array.isArray(snapshot.tables.Tasks)
            ? snapshot.tables.Tasks
            : [];
        return taskRows.filter(function (task) {
            return canSelectTaskForAction(snapshot, task);
        });
    }

    function recordLabel(table, record) {
        if (!record) return table;
        return record.titre || record.nom || (table + ' #' + (record.id || '?'));
    }

    function canCreateProject(snapshot, proposed) {
        if (actorIsAdmin(snapshot)) return allow('ADMIN');
        var responsibleId = normalizeId(proposed && proposed.responsable);
        if (responsibleId === actorId(snapshot)) return allow('PROJECT_SELF_RESPONSIBLE');
        if (isDirectManagerOfMember(snapshot, responsibleId)) return allow('DIRECT_MANAGER');
        return deny('PROJECT_CREATE_FORBIDDEN', 'Vous ne pouvez creer que votre propre projet ou celui d\'un collaborateur direct.');
    }

    function canUpdateProject(snapshot, current, proposed) {
        if (actorIsAdmin(snapshot)) return allow('ADMIN');
        if (Object.prototype.hasOwnProperty.call(proposed || {}, 'responsable') &&
            normalizeId(proposed.responsable) !== normalizeId(current && current.responsable)) {
            return deny('PROJECT_RESPONSIBLE_CHANGE_ADMIN_REQUIRED', 'Seul un administrateur peut changer le responsable d\'un projet.');
        }
        if (canManageProject(snapshot, current)) return allow('PROJECT_SCOPE');
        return deny('PROJECT_OUTSIDE_SCOPE', 'Ce projet est hors de votre perimetre.', {
            resourceLabel: recordLabel('Projects', current)
        });
    }

    function canCreateTask(snapshot, proposed) {
        if (actorIsAdmin(snapshot)) return allow('ADMIN');
        var project = projectForTask(snapshot, proposed);
        if (project && canManageProject(snapshot, project)) return allow('PROJECT_SCOPE');
        return deny('TASK_CREATE_FORBIDDEN', 'Vous ne pouvez creer une tache que dans un projet dont vous etes responsable ou manager direct.');
    }

    function canUpdateTask(snapshot, current, proposed) {
        if (actorIsAdmin(snapshot)) return allow('ADMIN');
        var project = projectForTask(snapshot, current);
        if (project && canManageProject(snapshot, project)) return allow('PROJECT_SCOPE');
        if (isTaskAssignee(snapshot, current)) {
            var protectedFields = ['projet', 'assignees', 'dependDe', 'parentTask'];
            var changesScope = Object.keys(proposed || {}).some(function (field) {
                return protectedFields.indexOf(field) !== -1;
            });
            if (changesScope) return deny('TASK_SCOPE_FIELDS_ADMIN_OR_MANAGER_REQUIRED', 'Un executant ne peut pas modifier le projet, les affectations ou les dependances de la tache.');
            return allow('TASK_ASSIGNEE');
        }
        return deny('TASK_OUTSIDE_SCOPE', 'La tache « ' + recordLabel('Tasks', current) + ' » est hors de votre perimetre.', {
            resourceLabel: recordLabel('Tasks', current)
        });
    }

    function canDeleteTask(snapshot, current) {
        if (actorIsAdmin(snapshot)) return allow('ADMIN');
        var project = projectForTask(snapshot, current);
        if (project && canManageProject(snapshot, project)) return allow('PROJECT_SCOPE');
        return deny('TASK_DELETE_FORBIDDEN', 'Seul le responsable du projet, son manager direct ou un administrateur peut supprimer cette tache.', {
            resourceLabel: recordLabel('Tasks', current)
        });
    }

    function canCreateAction(snapshot, proposed) {
        if (actorIsAdmin(snapshot)) return allow('ADMIN');
        var task = taskForAction(snapshot, proposed);
        var project = projectForTask(snapshot, task);
        if (task && project && canManageProject(snapshot, project)) return allow('PROJECT_SCOPE');
        if (task && isTaskAssignee(snapshot, task) && normalizeId(proposed.assignee) === actorId(snapshot)) {
            return allow('TASK_ASSIGNEE_OWN_ACTION');
        }
        if (!task && normalizeId(proposed && proposed.assignee) === actorId(snapshot)) return allow('OWN_UNLINKED_ACTION');
        return deny('ACTION_CREATE_FORBIDDEN', 'Vous ne pouvez creer qu\'une action qui vous est assignee sur une tache a laquelle vous etes affecte.');
    }

    function canUpdateAction(snapshot, current, proposed) {
        if (actorIsAdmin(snapshot)) return allow('ADMIN');
        var task = taskForAction(snapshot, current);
        var project = projectForTask(snapshot, task);
        if (task && project && canManageProject(snapshot, project)) return allow('PROJECT_SCOPE');

        if (!isActionOwner(snapshot, current)) {
            return deny('ACTION_OUTSIDE_SCOPE', 'Cette action ne vous appartient pas et son projet est hors de votre perimetre.');
        }

        if (Object.prototype.hasOwnProperty.call(proposed || {}, 'assignee') && normalizeId(proposed.assignee) !== actorId(snapshot)) {
            return deny('ACTION_REASSIGN_FORBIDDEN', 'Un executant ne peut pas reassigner son action.');
        }

        if (Object.prototype.hasOwnProperty.call(proposed || {}, 'task')) {
            var nextTaskId = normalizeId(proposed.task);
            if (nextTaskId !== null) {
                var nextTask = ensureIndexes(snapshot).Tasks.get(nextTaskId);
                if (!nextTask || !isTaskAssignee(snapshot, nextTask)) {
                    return deny('ACTION_TASK_CHANGE_FORBIDDEN', 'Vous ne pouvez rattacher votre action qu\'a une tache a laquelle vous etes affecte.');
                }
            }
        }

        return allow('ACTION_OWNER');
    }

    function canDeleteAction(snapshot, current) {
        if (actorIsAdmin(snapshot)) return allow('ADMIN');
        var task = taskForAction(snapshot, current);
        var project = projectForTask(snapshot, task);
        if (task && project && canManageProject(snapshot, project)) return allow('PROJECT_SCOPE');
        if (isActionOwner(snapshot, current)) return allow('ACTION_OWNER');
        return deny('ACTION_DELETE_FORBIDDEN', 'Vous ne pouvez supprimer que vos propres actions ou celles de votre perimetre projet.');
    }

    function normalizeStatus(value) {
        return String(value || '').trim().toLowerCase();
    }

    function hasExactFields(fields, expected) {
        var actual = Object.keys(fields || {}).sort();
        return actual.length === expected.length && actual.every(function (key, index) {
            return key === expected.slice().sort()[index];
        });
    }

    function hasOnlyFields(fields, allowed) {
        return Object.keys(fields || {}).every(function (key) { return allowed.indexOf(key) !== -1; });
    }

    function sheetForEntry(snapshot, entry) {
        return entry ? ensureIndexes(snapshot).Feuilles.get(normalizeId(entry.feuille)) || null : null;
    }

    function isSheetOwner(snapshot, sheet) {
        return Boolean(sheet) && normalizeId(sheet.membre) === actorId(snapshot);
    }

    function isSheetValidationManager(snapshot, sheet) {
        return Boolean(sheet) && normalizeId(sheet.responsableValidation) === actorId(snapshot);
    }

    function canCreateSheet(snapshot, proposed) {
        if (actorIsAdmin(snapshot)) return allow('ADMIN');
        if (!hasExactFields(proposed, ['membre', 'semaine', 'statut', 'revisionValidation'])) {
            return deny('CRA_SHEET_CREATE_FIELDS_FORBIDDEN', 'La creation d\'une feuille doit utiliser uniquement les champs initiaux du workflow.');
        }
        if (normalizeId(proposed.membre) !== actorId(snapshot) || normalizeStatus(proposed.statut) !== 'brouillon' || Number(proposed.revisionValidation) !== 0) {
            return deny('CRA_SHEET_CREATE_FORBIDDEN', 'Vous ne pouvez creer que votre propre feuille en brouillon.');
        }
        return allow('CRA_SHEET_OWNER_CREATE');
    }

    function canUpdateSheet(snapshot, current, proposed) {
        if (actorIsAdmin(snapshot)) return allow('ADMIN');
        var from = normalizeStatus(current && current.statut);
        var to = Object.prototype.hasOwnProperty.call(proposed || {}, 'statut') ? normalizeStatus(proposed.statut) : from;
        var owner = isSheetOwner(snapshot, current);
        var manager = isSheetValidationManager(snapshot, current);
        var sheetMember = ensureIndexes(snapshot).Team.get(normalizeId(current && current.membre)) || null;

        if (owner && (from === 'brouillon' || from === 'rejete') && to === 'soumis' &&
            hasExactFields(proposed, ['statut', 'responsableValidation', 'soumisPar', 'dateSoumission', 'validePar', 'dateValidation', 'motifRejet', 'motifCorrection', 'revisionValidation']) &&
            normalizeId(proposed.soumisPar) === actorId(snapshot) &&
            normalizeId(proposed.responsableValidation) === normalizeId(sheetMember && sheetMember.responsable) &&
            normalizeId(proposed.responsableValidation) !== null &&
            proposed.validePar == null && proposed.dateValidation == null &&
            Number(proposed.revisionValidation) === Number(current.revisionValidation || 0)) return allow('CRA_SUBMIT');

        if (owner && from === 'soumis' && to === 'brouillon' &&
            hasExactFields(proposed, ['statut', 'responsableValidation', 'soumisPar', 'dateSoumission', 'validePar', 'dateValidation', 'motifRejet', 'motifCorrection'])) return allow('CRA_WITHDRAW');

        if (manager && from === 'soumis' && to === 'valide' &&
            hasExactFields(proposed, ['statut', 'validePar', 'dateValidation', 'revisionValidation', 'motifRejet']) &&
            normalizeId(proposed.validePar) === actorId(snapshot) &&
            Number(proposed.revisionValidation) === Number(current.revisionValidation || 0) + 1) return allow('CRA_VALIDATE');

        if (manager && from === 'soumis' && to === 'rejete' &&
            hasExactFields(proposed, ['statut', 'motifRejet', 'validePar', 'dateValidation']) && String(proposed.motifRejet || '').trim()) return allow('CRA_REJECT');

        if (manager && from === 'valide' && to === 'correction_manager' &&
            hasExactFields(proposed, ['statut', 'motifCorrection']) && String(proposed.motifCorrection || '').trim()) return allow('CRA_OPEN_CORRECTION');

        if (manager && from === 'correction_manager' && to === 'valide' &&
            hasExactFields(proposed, ['statut', 'validePar', 'dateValidation', 'revisionValidation']) &&
            normalizeId(proposed.validePar) === actorId(snapshot) &&
            Number(proposed.revisionValidation) === Number(current.revisionValidation || 0) + 1) return allow('CRA_REVALIDATE');

        if (from === 'brouillon' && to === 'correction_manager' &&
            isDirectManagerOfMember(snapshot, current && current.membre) &&
            hasExactFields(proposed, ['statut', 'responsableValidation', 'motifCorrection']) &&
            normalizeId(proposed.responsableValidation) === actorId(snapshot) && String(proposed.motifCorrection || '').trim()) {
            return allow('CRA_RETROACTIVE_CORRECTION');
        }

        return deny('CRA_SHEET_TRANSITION_FORBIDDEN', 'Transition de feuille ou champs systeme non autorises.');
    }

    var TIME_ENTRY_CREATE_FIELDS = [
        'membre', 'tache', 'date', 'heures', 'imputation', 'description', 'heuresPrevues',
        'capaciteTheorique', 'capaciteDisponible', 'revisionPlan', 'affectation', 'feuille', 'capaciteJour'
    ];

    function canCreateTimeEntry(snapshot, proposed) {
        if (actorIsAdmin(snapshot)) return allow('ADMIN');
        var sheet = ensureIndexes(snapshot).Feuilles.get(normalizeId(proposed && proposed.feuille)) || null;
        if (normalizeId(proposed && proposed.membre) !== actorId(snapshot) || !sheet || !isSheetOwner(snapshot, sheet)) {
            return deny('CRA_TIME_ENTRY_CREATE_FORBIDDEN', 'Vous ne pouvez creer que vos propres saisies dans votre feuille.');
        }
        if (['brouillon', 'rejete'].indexOf(normalizeStatus(sheet.statut)) === -1 || !hasOnlyFields(proposed, TIME_ENTRY_CREATE_FIELDS)) {
            return deny('CRA_TIME_ENTRY_CREATE_FIELDS_FORBIDDEN', 'La feuille est verrouillee ou contient des champs de saisie interdits.');
        }
        var assignment = ensureIndexes(snapshot).TaskAssignments.get(normalizeId(proposed.affectation)) || null;
        if (!assignment || normalizeId(assignment.membre) !== actorId(snapshot) || normalizeId(assignment.tache) !== normalizeId(proposed.tache) || assignment.actif === false || assignment.actif === 0) {
            return deny('CRA_TIME_ENTRY_ASSIGNMENT_REQUIRED', 'Une affectation active correspondant au membre et a la tache est obligatoire.');
        }
        return allow('CRA_TIME_ENTRY_OWNER_CREATE');
    }

    function canUpdateTimeEntry(snapshot, current, proposed) {
        if (actorIsAdmin(snapshot)) return allow('ADMIN');
        var sheet = sheetForEntry(snapshot, current);
        var ownsEntry = normalizeId(current && current.membre) === actorId(snapshot);
        var fields = Object.keys(proposed || {});
        if (ownsEntry && sheet && isSheetOwner(snapshot, sheet) && ['brouillon', 'rejete'].indexOf(normalizeStatus(sheet.statut)) !== -1 &&
            fields.length > 0 && hasOnlyFields(proposed, ['heures', 'feuille'])) return allow('CRA_TIME_ENTRY_OWNER_UPDATE');

        if (sheet && normalizeStatus(sheet.statut) === 'correction_manager' && isSheetValidationManager(snapshot, sheet) &&
            hasExactFields(proposed, ['heures'])) return allow('CRA_TIME_ENTRY_MANAGER_CORRECTION');

        if (ownsEntry && hasExactFields(proposed, ['feuille'])) {
            var targetSheet = ensureIndexes(snapshot).Feuilles.get(normalizeId(proposed.feuille)) || null;
            if (targetSheet && isSheetOwner(snapshot, targetSheet) && ['brouillon', 'rejete'].indexOf(normalizeStatus(targetSheet.statut)) !== -1) {
                return allow('CRA_TIME_ENTRY_OWNER_LINK');
            }
        }

        if (hasExactFields(proposed, ['feuille'])) {
            var correctionSheet = ensureIndexes(snapshot).Feuilles.get(normalizeId(proposed.feuille)) || null;
            if (correctionSheet && normalizeStatus(correctionSheet.statut) === 'correction_manager' && isSheetValidationManager(snapshot, correctionSheet) &&
                normalizeId(correctionSheet.membre) === normalizeId(current && current.membre)) return allow('CRA_TIME_ENTRY_MANAGER_LINK');
        }

        return deny('CRA_TIME_ENTRY_UPDATE_FORBIDDEN', 'Cette saisie est verrouillee ou les champs demandes sont interdits.');
    }

    function canDeleteTimeEntry(snapshot, current) {
        if (actorIsAdmin(snapshot)) return allow('ADMIN');
        var sheet = sheetForEntry(snapshot, current);
        if (normalizeId(current && current.membre) === actorId(snapshot) &&
            (!sheet || (isSheetOwner(snapshot, sheet) && ['brouillon', 'rejete'].indexOf(normalizeStatus(sheet.statut)) !== -1))) {
            return allow('CRA_TIME_ENTRY_OWNER_DELETE');
        }
        return deny('CRA_TIME_ENTRY_DELETE_FORBIDDEN', 'Cette saisie ne peut pas etre supprimee dans son etat actuel.');
    }

    function authorizeRecordMutation(snapshot, mutation) {
        var actorError = requireActor(snapshot);
        if (actorError) return actorError;

        var table = mutation.table;
        var kind = mutation.kind;
        var current = mutation.current;
        var proposed = mutation.proposed || {};

        if (table === 'Team' || table === 'Entites' || table === 'Programmes' || table === 'KanbanSteps') {
            return actorIsAdmin(snapshot)
                ? allow('ADMIN')
                : deny('ADMIN_REQUIRED', 'Cette operation est reservee aux administrateurs.');
        }

        if (table === 'Projects') {
            if (kind === 'create') return canCreateProject(snapshot, proposed);
            if (kind === 'update') return canUpdateProject(snapshot, current, proposed);
            return actorIsAdmin(snapshot)
                ? allow('ADMIN')
                : deny('PROJECT_DELETE_FORBIDDEN', 'Seul un administrateur peut supprimer un projet.');
        }

        if (table === 'Tasks') {
            if (kind === 'create') return canCreateTask(snapshot, proposed);
            if (kind === 'update') return canUpdateTask(snapshot, current, proposed);
            return canDeleteTask(snapshot, current);
        }

        if (table === 'Actions') {
            if (kind === 'create') return canCreateAction(snapshot, proposed);
            if (kind === 'update') return canUpdateAction(snapshot, current, proposed);
            return canDeleteAction(snapshot, current);
        }

        if (table === 'Feuilles') {
            if (kind === 'create') return canCreateSheet(snapshot, proposed);
            if (kind === 'update') return canUpdateSheet(snapshot, current, proposed);
            return actorIsAdmin(snapshot) ? allow('ADMIN') : deny('CRA_SHEET_DELETE_FORBIDDEN', 'Seul un administrateur peut supprimer une feuille.');
        }

        if (table === 'TimeEntries') {
            if (kind === 'create') return canCreateTimeEntry(snapshot, proposed);
            if (kind === 'update') return canUpdateTimeEntry(snapshot, current, proposed);
            return canDeleteTimeEntry(snapshot, current);
        }

        return allow('UNCONTROLLED_TABLE');
    }

    function cloneTables(snapshot) {
        var out = {};
        PERMISSION_DATA_TABLES.forEach(function (table) {
            out[table] = (snapshot.tables[table] || []).map(function (row) { return Object.assign({}, row); });
        });
        return out;
    }

    function copySnapshot(snapshot) {
        return createSnapshot(cloneTables(snapshot), snapshot.actor);
    }

    function expandBulkAction(action) {
        var type = action[0];
        var table = action[1];
        if (type === 'BulkAddRecord') {
            var addIds = Array.isArray(action[2]) ? action[2] : [];
            var addFields = action[3] || {};
            var addCount = addIds.length || Object.keys(addFields).reduce(function (max, key) {
                return Math.max(max, Array.isArray(addFields[key]) ? addFields[key].length : 0);
            }, 0);
            var adds = [];
            for (var i = 0; i < addCount; i++) {
                var addRecord = {};
                Object.keys(addFields).forEach(function (key) { addRecord[key] = addFields[key][i]; });
                adds.push(['AddRecord', table, addIds[i] == null ? null : addIds[i], addRecord]);
            }
            return adds;
        }
        if (type === 'BulkUpdateRecord') {
            var updateIds = Array.isArray(action[2]) ? action[2] : [];
            var updateFields = action[3] || {};
            return updateIds.map(function (id, index) {
                var values = {};
                Object.keys(updateFields).forEach(function (key) { values[key] = updateFields[key][index]; });
                return ['UpdateRecord', table, id, values];
            });
        }
        if (type === 'BulkRemoveRecord') {
            return (Array.isArray(action[2]) ? action[2] : []).map(function (id) {
                return ['RemoveRecord', table, id];
            });
        }
        return [action];
    }

    function normalizeRecordAction(action, snapshot) {
        var type = action[0];
        var table = action[1];
        var id = normalizeId(action[2]);
        var fields = action[3] || {};
        var current = id === null ? null : ensureIndexes(snapshot)[table].get(id) || null;
        if (type === 'AddRecord') {
            return { table: table, kind: 'create', id: id, current: null, proposed: Object.assign({}, fields) };
        }
        if (type === 'UpdateRecord') {
            return { table: table, kind: 'update', id: id, current: current, proposed: Object.assign({}, fields) };
        }
        return { table: table, kind: 'delete', id: id, current: current, proposed: null };
    }

    function applyMutationToSnapshot(snapshot, mutation) {
        var rows = snapshot.tables[mutation.table];
        if (!rows) return;
        if (mutation.kind === 'create') {
            rows.push(Object.assign({ id: mutation.id }, mutation.proposed));
        } else {
            var index = rows.findIndex(function (row) { return normalizeId(row.id) === mutation.id; });
            if (index !== -1 && mutation.kind === 'update') rows[index] = Object.assign({}, rows[index], mutation.proposed);
            if (index !== -1 && mutation.kind === 'delete') rows.splice(index, 1);
        }
        snapshot.indexes = null;
    }

    function authorizeMutationBatch(snapshot, actions) {
        var working = copySnapshot(snapshot);
        var flat = [];
        (actions || []).forEach(function (action) {
            flat = flat.concat(expandBulkAction(action));
        });

        for (var i = 0; i < flat.length; i++) {
            var action = flat[i];
            var type = action && action[0];
            var table = action && action[1];
            if (CONTROLLED_TABLES.indexOf(table) === -1) continue;

            // Les opérations de schéma restent hors du contrôle fonctionnel du
            // POC afin de ne pas bloquer bootstrap et migrations Grist.
            if (RECORD_ACTIONS.indexOf(type) === -1) {
                continue;
            }

            var mutation = normalizeRecordAction(action, working);
            if (mutation.kind !== 'create' && !mutation.current) {
                return deny('RESOURCE_NOT_FOUND', 'Enregistrement introuvable avant controle des droits.', {
                    deniedAction: action,
                    deniedIndex: i,
                    table: table,
                    recordId: mutation.id
                });
            }

            var result = authorizeRecordMutation(working, mutation);
            if (!result.allowed) {
                return Object.assign(result, {
                    deniedAction: action,
                    deniedIndex: i,
                    table: table,
                    recordId: mutation.id
                });
            }
            applyMutationToSnapshot(working, mutation);
        }

        return { allowed: true, code: 'BATCH_ALLOWED', checkedActions: flat.length, nextSnapshot: working };
    }

    function decodeJwtPayload(token) {
        try {
            var parts = String(token || '').split('.');
            if (parts.length !== 3) return null;
            var normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            while (normalized.length % 4) normalized += '=';
            var json;
            if (typeof atob === 'function') {
                json = decodeURIComponent(Array.prototype.map.call(atob(normalized), function (c) {
                    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                }).join(''));
            } else if (typeof Buffer !== 'undefined') {
                json = Buffer.from(normalized, 'base64').toString('utf8');
            } else {
                return null;
            }
            return JSON.parse(json);
        } catch (e) {
            return null;
        }
    }

    var getCurrentGristUser = identityRuntimeModule.getCurrentGristUser;

    function isExactIdentityClaimAction(actions, claim) {
        if (!claim || !claim.allowed || claim.idempotent || !claim.action) return false;
        if (!Array.isArray(actions) || actions.length !== 1) return false;
        var action = actions[0];
        if (!Array.isArray(action) || action[0] !== 'UpdateRecord' || action[1] !== 'Team') return false;
        if (normalizeId(action[2]) !== claim.teamMemberId) return false;
        var fields = action[3];
        if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return false;
        var keys = Object.keys(fields);
        return keys.length === 1 && keys[0] === 'gristUserId' &&
            normalizeId(fields.gristUserId) === claim.gristUserId;
    }

    function createGristPermissionRuntime(grist, options) {
        options = options || {};
        var snapshot = null;
        var valid = false;
        var loading = null;
        var identityRuntime = options.identityRuntime || identityRuntimeModule.createGristIdentityRuntime(grist, {
            onError: options.onError,
            onIdentity: options.onIdentity
        });

        async function refresh(refreshOptions) {
            refreshOptions = refreshOptions || {};
            if (valid && !refreshOptions.force) return snapshot;
            if (loading) return loading;
            loading = (async function () {
                try {
                var identityState = await identityRuntime.refresh({ force: !!refreshOptions.force });
                var existingTables = await grist.docApi.listTables();
                var data = { Team: identityState.team || [] };
                await Promise.all(PERMISSION_DATA_TABLES.map(async function (table) {
                    if (table === 'Team') return;
                    if (existingTables.indexOf(table) === -1) {
                        data[table] = [];
                        return;
                    }
                    data[table] = columnarToRows(await grist.docApi.fetchTable(table));
                }));
                snapshot = createSnapshot(data, identityState.actor);
                valid = true;
                return snapshot;
                } catch (error) {
                    var identity = { identified: false, status: 'PERMISSION_DATA_UNAVAILABLE', memberId: null, member: null, isAdmin: false };
                    snapshot = createSnapshot({}, identity);
                    valid = true;
                    if (typeof options.onError === 'function') options.onError(error);
                    if (typeof options.onIdentity === 'function') options.onIdentity(identity);
                    return snapshot;
                }
            })();
            try {
                return await loading;
            } finally {
                loading = null;
            }
        }

        async function authorize(actions) {
            if (Array.isArray(actions) && actions.length === 1) {
                var action = actions[0];
                if (Array.isArray(action) && action[0] === 'UpdateRecord' && action[1] === 'Team') {
                    var claim = await identityRuntime.buildClaim(action[2]);
                    if (isExactIdentityClaimAction(actions, claim)) {
                        return {
                            allowed: true,
                            code: 'IDENTITY_CLAIM_ALLOWED',
                            checkedActions: 1,
                            identityClaim: true
                        };
                    }
                }
            }
            await refresh({ force: true });
            return authorizeMutationBatch(snapshot, actions);
        }

        return {
            refresh: refresh,
            authorize: authorize,
            invalidate: function () { valid = false; identityRuntime.invalidate(); },
            getSnapshot: function () { return snapshot; },
            getActor: function () { return snapshot && snapshot.actor; },
            getIdentityRuntime: function () { return identityRuntime; }
        };
    }

    var api = {
        CONTROLLED_TABLES: CONTROLLED_TABLES,
        PERMISSION_DATA_TABLES: PERMISSION_DATA_TABLES,
        normalizeId: normalizeId,
        normalizeRefList: normalizeRefList,
        columnarToRows: columnarToRows,
        duplicateGristUserIds: duplicateGristUserIds,
        resolveActorIdentity: resolveActorIdentity,
        createSnapshot: createSnapshot,
        isProjectOwner: isProjectOwner,
        isDirectManagerOfProjectOwner: isDirectManagerOfProjectOwner,
        isTaskAssignee: isTaskAssignee,
        isActionOwner: isActionOwner,
        canSelectTaskForAction: canSelectTaskForAction,
        listActionTaskCandidates: listActionTaskCandidates,
        canCreateProject: canCreateProject,
        canUpdateProject: canUpdateProject,
        canCreateTask: canCreateTask,
        canUpdateTask: canUpdateTask,
        canDeleteTask: canDeleteTask,
        canCreateAction: canCreateAction,
        canUpdateAction: canUpdateAction,
        canDeleteAction: canDeleteAction,
        canCreateSheet: canCreateSheet,
        canUpdateSheet: canUpdateSheet,
        canCreateTimeEntry: canCreateTimeEntry,
        canUpdateTimeEntry: canUpdateTimeEntry,
        canDeleteTimeEntry: canDeleteTimeEntry,
        authorizeRecordMutation: authorizeRecordMutation,
        authorizeMutationBatch: authorizeMutationBatch,
        decodeJwtPayload: decodeJwtPayload,
        getCurrentGristUser: getCurrentGristUser,
        isExactIdentityClaimAction: isExactIdentityClaimAction,
        createGristPermissionRuntime: createGristPermissionRuntime
    };

    global.TaskFlowPermissions = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
