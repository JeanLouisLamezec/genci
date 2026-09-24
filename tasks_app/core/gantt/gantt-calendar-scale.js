/* ==========================================================================
 * gantt-calendar-scale.js — Calculs calendaires de la timeline du Gantt
 * ========================================================================== */
(function (global) {
    'use strict';

    function validDate(value) {
        var date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function calendarDayNumber(date) {
        return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
    }

    function daysForCalendarMonths(startValue, monthCount) {
        var start = validDate(startValue);
        var count = Math.max(0, Number(monthCount) || 0);
        if (!start || !count) return 0;
        var end = new Date(start.getFullYear(), start.getMonth() + count, start.getDate());
        return Math.max(0, calendarDayNumber(end) - calendarDayNumber(start));
    }

    function countMonthCells(startValue, endExclusiveValue) {
        var start = validDate(startValue);
        var endExclusive = validDate(endExclusiveValue);
        if (!start || !endExclusive || endExclusive <= start) return 1;

        var firstMonth = new Date(start.getFullYear(), start.getMonth(), 1);
        var endMonth = new Date(endExclusive.getFullYear(), endExclusive.getMonth(), 1);
        var count = (endMonth.getFullYear() - firstMonth.getFullYear()) * 12 +
            (endMonth.getMonth() - firstMonth.getMonth());
        if (endExclusive > endMonth) count += 1;
        return Math.max(1, count);
    }

    var api = {
        daysForCalendarMonths: daysForCalendarMonths,
        countMonthCells: countMonthCells
    };

    global.GanttCalendarScale = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
