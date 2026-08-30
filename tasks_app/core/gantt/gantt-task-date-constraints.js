/* ============================================================================
 * gantt-task-date-constraints.js — Bornes temporelles des tâches
 * ----------------------------------------------------------------------------
 * Une tâche rattachée à un projet reste dans la plage du projet.
 * Une sous-tâche reste également dans la plage de sa tâche parente.
 * Les bornes sont inclusives et les dates Grist sont exprimées en secondes.
 * ========================================================================== */
(function (global) {
    'use strict';

    function toMillis(value) {
        if (value instanceof Date) return value.getTime();
        if (typeof value === 'number' && Number.isFinite(value)) {
            return Math.abs(value) < 100000000000 ? value * 1000 : value;
        }
        if (typeof value === 'string' && value) {
            var parsed = Date.parse(value);
            return Number.isNaN(parsed) ? null : parsed;
        }
        return null;
    }

    function referenceId(value) {
        if (value == null || value === '' || value === 0 || value === false) return null;
        if (typeof value === 'object') {
            if (value.id != null) return referenceId(value.id);
            if (Array.isArray(value) && value.length > 1 && (value[0] === 'R' || value[0] === 'r')) {
                return referenceId(value[1]);
            }
        }
        return String(value);
    }

    function sameId(left, right) {
        var leftId = referenceId(left);
        var rightId = referenceId(right);
        return leftId != null && rightId != null && leftId === rightId;
    }

    function sameReference(left, right) {
        return referenceId(left) === referenceId(right);
    }

    function findById(records, id) {
        return (Array.isArray(records) ? records : []).find(function (record) {
            return record && sameId(record.id, id);
        }) || null;
    }

    function formatDate(value) {
        var millis = toMillis(value);
        if (millis == null) return 'date inconnue';
        var date = new Date(millis);
        return String(date.getUTCDate()).padStart(2, '0') + '/' +
            String(date.getUTCMonth() + 1).padStart(2, '0') + '/' +
            date.getUTCFullYear();
    }

    function failure(code, message, details) {
        return Object.assign({ ok: false, code: code, message: message }, details || {});
    }

    function validateTaskDates(task, context) {
        task = task || {};
        context = context || {};

        var start = toMillis(task.dateDebut);
        var end = toMillis(task.dateEcheance);
        var parentId = referenceId(task.parentTask);
        var projectId = referenceId(task.projet);
        var scoped = projectId != null || parentId != null;

        if (scoped && (start == null || end == null)) {
            return failure(
                'TASK_DATES_REQUIRED',
                'la date de début et la date de fin de la tâche sont obligatoires.'
            );
        }
        if (start != null && end != null && start > end) {
            return failure(
                'TASK_DATES_REVERSED',
                'la date de début de la tâche ne peut pas dépasser sa date de fin.'
            );
        }

        if (parentId != null) {
            var parent = findById(context.tasks, parentId);
            if (!parent) {
                return failure('PARENT_NOT_FOUND', 'la tâche parente sélectionnée est introuvable.');
            }
            var parentStart = toMillis(parent.dateDebut);
            var parentEnd = toMillis(parent.dateEcheance);
            var parentName = parent.titre || ('Tâche ' + parent.id);
            if (parentStart == null || parentEnd == null || parentStart > parentEnd) {
                return failure(
                    'PARENT_DATES_INVALID',
                    'la tâche parente « ' + parentName + ' » doit avoir une plage de dates valide avant de recevoir une sous-tâche.',
                    { parent: parent }
                );
            }
            if (start < parentStart || end > parentEnd) {
                return failure(
                    'PARENT_RANGE',
                    'la sous-tâche doit rester comprise entre le ' + formatDate(parentStart) + ' et le ' + formatDate(parentEnd) +
                        ', dates de la tâche parente « ' + parentName + ' ».',
                    { parent: parent, allowedStart: parentStart, allowedEnd: parentEnd }
                );
            }
        }

        if (projectId != null) {
            var project = findById(context.projects, projectId);
            if (!project) {
                return failure('PROJECT_NOT_FOUND', 'le projet sélectionné est introuvable.');
            }
            var projectStart = toMillis(project.dateDebut);
            var projectEnd = toMillis(project.dateFin);
            var projectName = project.nom || ('Projet ' + project.id);
            if (projectStart == null || projectEnd == null || projectStart > projectEnd) {
                return failure(
                    'PROJECT_DATES_INVALID',
                    'le projet « ' + projectName + ' » doit avoir une plage de dates valide avant de recevoir une tâche.',
                    { project: project }
                );
            }
            if (start < projectStart || end > projectEnd) {
                return failure(
                    'PROJECT_RANGE',
                    'la tâche doit rester comprise entre le ' + formatDate(projectStart) + ' et le ' + formatDate(projectEnd) +
                        ', dates du projet « ' + projectName + ' ».',
                    { project: project, allowedStart: projectStart, allowedEnd: projectEnd }
                );
            }
        }

        return { ok: true, code: 'VALID' };
    }

    function validateTaskMutation(task, context) {
        context = context || {};
        var taskSet = Array.isArray(context.tasks) ? context.tasks.slice() : [];
        var originalTask = task && task.id != null ? findById(taskSet, task.id) : null;
        var temporalScopeChanged = !originalTask ||
            toMillis(originalTask.dateDebut) !== toMillis(task.dateDebut) ||
            toMillis(originalTask.dateEcheance) !== toMillis(task.dateEcheance) ||
            !sameReference(originalTask.projet, task.projet) ||
            !sameReference(originalTask.parentTask, task.parentTask);
        if (originalTask && !temporalScopeChanged && !context.forceValidation) {
            return { ok: true, code: 'UNCHANGED_TEMPORAL_SCOPE' };
        }
        if (task && task.id != null) {
            var replaced = false;
            taskSet = taskSet.map(function (record) {
                if (!record || !sameId(record.id, task.id)) return record;
                replaced = true;
                return task;
            });
            if (!replaced) taskSet.push(task);
        }

        var mutationContext = Object.assign({}, context, { tasks: taskSet });
        var result = validateTaskDates(task, mutationContext);
        if (!result.ok || !task || task.id == null) return result;

        var boundsChanged = Boolean(context.forceValidation) || !originalTask ||
            toMillis(originalTask.dateDebut) !== toMillis(task.dateDebut) ||
            toMillis(originalTask.dateEcheance) !== toMillis(task.dateEcheance);
        if (!boundsChanged) return result;

        var children = taskSet.filter(function (candidate) {
            return candidate && sameId(candidate.parentTask, task.id);
        });
        for (var index = 0; index < children.length; index += 1) {
            var childResult = validateTaskDates(children[index], mutationContext);
            if (!childResult.ok) return childResult;
        }
        return result;
    }

    var api = {
        toMillis: toMillis,
        formatDate: formatDate,
        referenceId: referenceId,
        validateTaskDates: validateTaskDates,
        validateTaskMutation: validateTaskMutation
    };

    global.GanttTaskDateConstraints = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
