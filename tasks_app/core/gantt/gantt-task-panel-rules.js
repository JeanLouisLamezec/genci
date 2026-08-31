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

    function filterParentTasks(tasks, currentTaskId, projectId, canSetParent) {
        var currentId = normalizeId(currentTaskId);
        return filterTasksByProject(tasks, projectId).filter(function (task) {
            if (!task || normalizeId(task.id) === currentId) return false;
            return typeof canSetParent !== 'function' || canSetParent(currentTaskId, task.id);
        });
    }

    var api = {
        HOURS_PER_DAY: HOURS_PER_DAY,
        normalizeUnit: normalizeUnit,
        displayValueToHours: displayValueToHours,
        hoursToDisplayValue: hoursToDisplayValue,
        chargeHoursForMember: chargeHoursForMember,
        validatePositiveCharges: validatePositiveCharges,
        sameProject: sameProject,
        filterTasksByProject: filterTasksByProject,
        filterParentTasks: filterParentTasks
    };

    global.GanttTaskPanelRules = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
