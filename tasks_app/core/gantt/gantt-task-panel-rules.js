/* ============================================================================
 * gantt-task-panel-rules.js — Règles pures du panneau de tâche du Gantt
 * ========================================================================== */
(function (global) {
    'use strict';

    var HOURS_PER_DAY = 7;

    function normalizeId(value) {
        var id = Number(value);
        return Number.isInteger(id) && id > 0 ? id : null;
    }

    function normalizeUnit(value) {
        return value === 'h' ? 'h' : 'j';
    }

    function roundHours(value) {
        return Math.round(value * 1000) / 1000;
    }

    function displayValueToHours(value, unit) {
        var numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue <= 0) return 0;
        return roundHours(numericValue * (normalizeUnit(unit) === 'j' ? HOURS_PER_DAY : 1));
    }

    function hoursToDisplayValue(hours, unit) {
        var numericHours = Number(hours);
        if (!Number.isFinite(numericHours) || numericHours <= 0) return 0;
        var displayValue = normalizeUnit(unit) === 'j' ? numericHours / HOURS_PER_DAY : numericHours;
        return Math.round(displayValue * 100) / 100;
    }

    function chargeHoursForMember(charges, memberId) {
        var normalizedMemberId = normalizeId(memberId);
        if (!normalizedMemberId || !Array.isArray(charges)) return 0;
        var charge = charges.find(function (entry) {
            return normalizeId(entry && entry.teamId) === normalizedMemberId;
        });
        var hours = Number(charge && charge.heures);
        return Number.isFinite(hours) && hours > 0 ? hours : 0;
    }

    function validatePositiveCharges(assigneeIds, charges) {
        var missingMemberIds = (Array.isArray(assigneeIds) ? assigneeIds : [])
            .map(normalizeId)
            .filter(function (id) { return id && chargeHoursForMember(charges, id) <= 0; });
        return {
            ok: missingMemberIds.length === 0,
            missingMemberIds: missingMemberIds
        };
    }

    function sumAssignedChargeHours(assigneeIds, charges) {
        var uniqueMemberIds = [];
        (Array.isArray(assigneeIds) ? assigneeIds : []).forEach(function (memberId) {
            var normalizedId = normalizeId(memberId);
            if (normalizedId && uniqueMemberIds.indexOf(normalizedId) < 0) {
                uniqueMemberIds.push(normalizedId);
            }
        });
        return roundHours(uniqueMemberIds.reduce(function (total, memberId) {
            return total + chargeHoursForMember(charges, memberId);
        }, 0));
    }

    function validateChargeBudget(assigneeIds, charges, estimatedHours) {
        var totalChargeHours = sumAssignedChargeHours(assigneeIds, charges);
        var numericEstimate = Number(estimatedHours);
        var normalizedEstimate = Number.isFinite(numericEstimate) && numericEstimate > 0
            ? roundHours(numericEstimate)
            : 0;
        var excessHours = roundHours(Math.max(0, totalChargeHours - normalizedEstimate));
        return {
            ok: excessHours === 0,
            code: excessHours === 0 ? 'CHARGE_BUDGET_VALID' : 'CHARGE_BUDGET_EXCEEDED',
            totalChargeHours: totalChargeHours,
            estimatedHours: normalizedEstimate,
            excessHours: excessHours
        };
    }

    function sameProject(leftProjectId, rightProjectId) {
        var left = normalizeId(leftProjectId);
        var right = normalizeId(rightProjectId);
        return left === right;
    }

    function filterTasksByProject(tasks, projectId) {
        return (Array.isArray(tasks) ? tasks : []).filter(function (task) {
            return task && sameProject(task.projet, projectId);
        });
    }

    function isMilestone(task) {
        return Boolean(task) && task.type === 'jalon';
    }

    function canBeStructuralParent(task) {
        return Boolean(task) && !isMilestone(task);
    }

    function filterParentTasks(tasks, currentTaskId, projectId, canSetParent) {
        var currentId = normalizeId(currentTaskId);
        return filterTasksByProject(tasks, projectId).filter(function (task) {
            if (!canBeStructuralParent(task) || normalizeId(task.id) === currentId) return false;
            return typeof canSetParent !== 'function' || canSetParent(currentTaskId, task.id);
        });
    }

    function filterDependencyTasks(tasks, projectId, sourceType) {
        return filterTasksByProject(tasks, projectId).filter(function (task) {
            // Un jalon matérialise l'aboutissement de vraies tâches. Il ne peut
            // donc pas dépendre d'un autre jalon.
            return sourceType !== 'jalon' || !isMilestone(task);
        });
    }

    function validateHierarchy(task, tasks, currentTaskId) {
        task = task || {};
        tasks = Array.isArray(tasks) ? tasks : [];
        var taskId = normalizeId(currentTaskId || task.id);
        var parentId = normalizeId(task.parentTask);
        var parent = parentId ? tasks.find(function (candidate) {
            return normalizeId(candidate && candidate.id) === parentId;
        }) : null;

        if (isMilestone(task) && !parentId) {
            return {
                ok: false,
                code: 'MILESTONE_PARENT_REQUIRED',
                message: 'Un jalon doit être rattaché à une tâche du même projet.'
            };
        }

        if (parentId && !parent) {
            return {
                ok: false,
                code: 'PARENT_NOT_FOUND',
                message: 'La tâche parente sélectionnée est introuvable.'
            };
        }

        if (parent && !canBeStructuralParent(parent)) {
            return {
                ok: false,
                code: 'MILESTONE_CANNOT_BE_PARENT',
                message: 'Un jalon ne peut pas contenir une tâche ou un autre jalon.'
            };
        }

        if (parent && !sameProject(parent.projet, task.projet)) {
            return {
                ok: false,
                code: 'PARENT_PROJECT_MISMATCH',
                message: 'La tâche parente doit appartenir au même projet.'
            };
        }

        if (isMilestone(task) && taskId) {
            var hasChildren = tasks.some(function (candidate) {
                return normalizeId(candidate && candidate.parentTask) === taskId;
            });
            if (hasChildren) {
                return {
                    ok: false,
                    code: 'MILESTONE_CHILDREN_FORBIDDEN',
                    message: 'Ce jalon contient déjà des tâches. Détachez-les avant de l’enregistrer comme jalon.'
                };
            }
        }

        return { ok: true, code: 'HIERARCHY_VALID', message: '' };
    }

    function filterCreatableProjects(projects, canCreateTaskInProject) {
        return (Array.isArray(projects) ? projects : []).filter(function (project) {
            if (!project || project.actif === false) return false;
            return typeof canCreateTaskInProject !== 'function' || canCreateTaskInProject(project);
        });
    }

    var api = {
        HOURS_PER_DAY: HOURS_PER_DAY,
        normalizeUnit: normalizeUnit,
        displayValueToHours: displayValueToHours,
        hoursToDisplayValue: hoursToDisplayValue,
        chargeHoursForMember: chargeHoursForMember,
        validatePositiveCharges: validatePositiveCharges,
        sumAssignedChargeHours: sumAssignedChargeHours,
        validateChargeBudget: validateChargeBudget,
        sameProject: sameProject,
        filterTasksByProject: filterTasksByProject,
        isMilestone: isMilestone,
        canBeStructuralParent: canBeStructuralParent,
        filterParentTasks: filterParentTasks,
        filterDependencyTasks: filterDependencyTasks,
        validateHierarchy: validateHierarchy,
        filterCreatableProjects: filterCreatableProjects
    };

    global.GanttTaskPanelRules = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
