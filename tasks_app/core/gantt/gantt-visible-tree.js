/* ============================================================================
 * gantt-visible-tree.js — Modèle de lignes du Gantt
 * ----------------------------------------------------------------------------
 * Construit une seule liste ordonnée pour la colonne de gauche et la timeline :
 * Projet -> Tâche -> Sous-tâche.
 *
 * La fenêtre temporelle est traitée comme [rangeStart, rangeEndExclusive). Une
 * tâche est visible si elle chevauche cette fenêtre. Les ancêtres hors période
 * sont conservés uniquement comme contexte ; les descendants hors période ne
 * sont jamais ajoutés implicitement.
 * ========================================================================== */
(function (global) {
    'use strict';

    var WITHOUT_PROJECT = '__without_project__';

    function toMillis(value) {
        if (value instanceof Date) return value.getTime();
        if (typeof value === 'number' && Number.isFinite(value)) {
            // Les dates Grist sont des timestamps Unix en secondes.
            return Math.abs(value) < 100000000000 ? value * 1000 : value;
        }
        if (typeof value === 'string' && value) {
            var parsed = Date.parse(value);
            return Number.isNaN(parsed) ? null : parsed;
        }
        return null;
    }

    function taskInterval(task) {
        if (!task) return null;
        var start = toMillis(task.dateDebut);
        var end = toMillis(task.dateEcheance);
        if (start == null && end == null) return null;
        if (start == null) start = end;
        if (end == null) end = start;
        if (end < start) {
            var swap = start;
            start = end;
            end = swap;
        }
        return { start: start, end: end };
    }

    function taskOverlapsRange(task, rangeStart, rangeEndExclusive) {
        var interval = taskInterval(task);
        var start = toMillis(rangeStart);
        var endExclusive = toMillis(rangeEndExclusive);
        if (!interval || start == null || endExclusive == null || endExclusive <= start) return false;
        return interval.end >= start && interval.start < endExclusive;
    }

    function projectKeyForTask(task, projectById) {
        var raw = task && task.projet;
        if (raw == null || raw === '' || !projectById.has(String(raw))) return WITHOUT_PROJECT;
        return String(raw);
    }

    function sameProject(task, projectKey, projectById) {
        return projectKeyForTask(task, projectById) === projectKey;
    }

    /**
     * État initial du widget : chaque groupe projet est replié. Le groupe
     * « Sans projet » est ajouté uniquement lorsqu'au moins une tâche y tombe.
     */
    function buildDefaultCollapsedProjectIds(tasks, projects) {
        var projectById = new Map((projects || []).map(function (project) {
            return [String(project.id), project];
        }));
        var result = new Set(projectById.keys());
        if ((tasks || []).some(function (task) {
            return projectKeyForTask(task, projectById) === WITHOUT_PROJECT;
        })) {
            result.add(WITHOUT_PROJECT);
        }
        return result;
    }

    function buildVisibleRows(options) {
        options = options || {};
        var tasks = Array.isArray(options.tasks) ? options.tasks : [];
        var projects = Array.isArray(options.projects) ? options.projects : [];
        var filteredTasks = Array.isArray(options.filteredTasks) ? options.filteredTasks : tasks;
        var expandedTaskIds = options.expandedTaskIds instanceof Set
            ? options.expandedTaskIds
            : new Set(options.expandedTaskIds || []);
        var collapsedProjectIds = options.collapsedProjectIds instanceof Set
            ? options.collapsedProjectIds
            : new Set(options.collapsedProjectIds || []);
        var sortTasks = typeof options.sortTasks === 'function'
            ? options.sortTasks
            : function (items) { return items.slice(); };

        var taskById = new Map(tasks.map(function (task) { return [task.id, task]; }));
        var projectById = new Map(projects.map(function (project) { return [String(project.id), project]; }));
        var filteredIds = new Set(filteredTasks.map(function (task) { return task.id; }));
        var directIds = new Set();
        var directByProject = new Map();

        tasks.forEach(function (task) {
            if (!filteredIds.has(task.id) || !taskOverlapsRange(task, options.rangeStart, options.rangeEndExclusive)) return;
            directIds.add(task.id);
            var key = projectKeyForTask(task, projectById);
            if (!directByProject.has(key)) directByProject.set(key, []);
            directByProject.get(key).push(task);
        });

        var orderedProjectKeys = projects
            .map(function (project) { return String(project.id); })
            .filter(function (key) { return directByProject.has(key); });
        if (directByProject.has(WITHOUT_PROJECT)) orderedProjectKeys.push(WITHOUT_PROJECT);

        var rows = [];
        var visibleTaskIds = new Set();

        orderedProjectKeys.forEach(function (projectKey) {
            var directTasks = directByProject.get(projectKey) || [];
            var branchIds = new Set();

            directTasks.forEach(function (task) {
                var current = task;
                var visited = new Set();
                while (current && !visited.has(current.id) && sameProject(current, projectKey, projectById)) {
                    visited.add(current.id);
                    branchIds.add(current.id);
                    current = current.parentTask ? taskById.get(current.parentTask) : null;
                }
            });

            // Une expansion explicite doit toujours produire un résultat visible.
            // Ajouter les enfants qui passent les filtres métier même lorsque leurs
            // dates sont hors de la fenêtre courante ; ils seront rendus « dimmed »
            // et leur barre restera naturellement hors champ sur la timeline.
            var addedExpandedChild = true;
            while (addedExpandedChild) {
                addedExpandedChild = false;
                tasks.forEach(function (task) {
                    var parentId = task && task.parentTask;
                    if (!parentId || branchIds.has(task.id) || !filteredIds.has(task.id)) return;
                    if (!branchIds.has(parentId) || !expandedTaskIds.has(parentId)) return;
                    if (!sameProject(task, projectKey, projectById)) return;
                    branchIds.add(task.id);
                    addedExpandedChild = true;
                });
            }

            var intervalStart = null;
            var intervalEnd = null;
            directTasks.forEach(function (task) {
                var interval = taskInterval(task);
                if (!interval) return;
                if (intervalStart == null || interval.start < intervalStart) intervalStart = interval.start;
                if (intervalEnd == null || interval.end > intervalEnd) intervalEnd = interval.end;
            });

            var project = projectKey === WITHOUT_PROJECT ? null : projectById.get(projectKey);
            rows.push({
                kind: 'project',
                key: projectKey,
                project: project || null,
                label: project ? (project.nom || 'Projet sans nom') : 'Sans projet',
                color: project ? (project.couleur || '#64748b') : '#94a3b8',
                depth: 0,
                taskCount: directTasks.length,
                start: intervalStart,
                end: intervalEnd,
                collapsed: collapsedProjectIds.has(projectKey)
            });

            if (collapsedProjectIds.has(projectKey)) return;

            var childrenByParent = new Map();
            branchIds.forEach(function (id) {
                var task = taskById.get(id);
                if (!task || !task.parentTask || !branchIds.has(task.parentTask)) return;
                if (!childrenByParent.has(task.parentTask)) childrenByParent.set(task.parentTask, []);
                childrenByParent.get(task.parentTask).push(task);
            });

            var roots = [];
            branchIds.forEach(function (id) {
                var task = taskById.get(id);
                if (!task || (task.parentTask && branchIds.has(task.parentTask))) return;
                roots.push(task);
            });

            function walk(task, depth, visited) {
                if (!task || visited.has(task.id)) return;
                var nextVisited = new Set(visited);
                nextVisited.add(task.id);
                rows.push({
                    kind: 'task',
                    task: task,
                    projectKey: projectKey,
                    depth: depth,
                    dimmed: !directIds.has(task.id)
                });
                visibleTaskIds.add(task.id);
                if (!expandedTaskIds.has(task.id)) return;
                sortTasks(childrenByParent.get(task.id) || []).forEach(function (child) {
                    walk(child, depth + 1, nextVisited);
                });
            }

            sortTasks(roots).forEach(function (root) { walk(root, 1, new Set()); });
        });

        return {
            rows: rows,
            directTaskIds: directIds,
            visibleTaskIds: visibleTaskIds,
            projectCount: orderedProjectKeys.length,
            taskCount: directIds.size
        };
    }

    var api = {
        WITHOUT_PROJECT: WITHOUT_PROJECT,
        toMillis: toMillis,
        taskInterval: taskInterval,
        taskOverlapsRange: taskOverlapsRange,
        buildDefaultCollapsedProjectIds: buildDefaultCollapsedProjectIds,
        buildVisibleRows: buildVisibleRows
    };

    global.GanttVisibleTree = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
