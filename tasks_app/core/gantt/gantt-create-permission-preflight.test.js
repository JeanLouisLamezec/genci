'use strict';

const fs = require('fs');
const path = require('path');

describe('Gantt create-task permission preflight', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'gantt.html'), 'utf8');
    const coreSource = fs.readFileSync(path.join(__dirname, '..', 'taskflow-core.js'), 'utf8');

    test('loads only the Gantt permission tables during startup', () => {
        expect(source).toContain("initialPermissionTables: ['Team', 'Tasks', 'Projects']");
        expect(coreSource).toContain('Array.isArray(opts.initialPermissionTables)');
        expect(coreSource).toContain('{ tables: opts.initialPermissionTables }');
    });

    test('cache-busts the three performance-sensitive browser modules', () => {
        expect(source).toContain('task-assignment-service.js?v=20261002-perf2');
        expect(source).toContain('gantt-task-assignment-integration.js?v=20261002-perf3');
        expect(source).toContain('taskflow-planning-browser.js?v=20261002-perf2');
        expect(source).not.toContain('gantt-task-assignment-integration.js?v=20260827');
    });

    test('refreshes only the permission tables required to create a task', () => {
        const start = source.indexOf('async function openCreateTaskWithParent');
        const end = source.indexOf('// WBS-02: détacher la tâche courante', start);
        const createPanelSource = source.slice(start, end);

        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        expect(createPanelSource).toContain("tables: ['Team', 'Tasks', 'Projects']");
        expect(createPanelSource).toContain('publish: false');
        expect(createPanelSource).not.toContain('force: true');
        expect(createPanelSource).toContain('getCreatableProjects(creationPermissionSnapshot)');
        expect(createPanelSource).not.toContain("'TimeEntries'");
        expect(createPanelSource).not.toContain("'MemberDailyCapacities'");
    });

    test('keeps the scoped snapshot local to the new-task panel', () => {
        expect(source).toContain('panelState.isNew && panelState.creationPermissionSnapshot');
        expect(source).toContain('creationPermissionSnapshot: creationPermissionSnapshot');
    });

    test('reuses assignments already verified by the integration after creation', () => {
        expect(source).toContain('syncResult.verifiedAssignments');
        expect(source).toContain('if (Array.isArray(verifiedAssignments))');
    });
});
